import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUsageBars,
  buildWorkspaceHealth,
  providerUsage,
  usageLevel,
} from "../src/lib/integrations";
import { buildAlerts } from "../src/lib/alerts";
import { sampleWorkspace } from "../src/data/sample";
import {
  PROVIDER_LABELS,
  budgetMessage,
  monthlyCap,
  monthlyUsdCap,
  spendMessage,
} from "../supabase/functions/_shared/budget";
import { stableEventId, verifyHmacSignature } from "../supabase/functions/_shared/webhookVerify";
import type {
  IntegrationConnection,
  ProviderStatus,
  ReviewConnection,
  ScanRun,
  SocialAccount,
} from "../src/lib/types";

/**
 * `_shared/budget.ts` reads caps through `Deno.env`, which the browser test
 * runner does not have. A minimal double is enough: the module only touches it
 * inside function calls.
 */
const denoEnv = new Map<string, string>();
vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
afterEach(() => denoEnv.clear());

/** A provider status with only the fields a test cares about overridden. */
function status(overrides: Partial<ProviderStatus> & { provider: ProviderStatus["provider"] }) {
  return {
    label: PROVIDER_LABELS[overrides.provider],
    description: "",
    envKeys: [],
    configured: true,
    connections: 0,
    requests: 0,
    costUsd: 0,
    units: 0,
    errors: 0,
    cap: 0,
    capUsd: 0,
    ...overrides,
  } satisfies ProviderStatus;
}

function scanRun(overrides: Partial<ScanRun> & { id: string }): ScanRun {
  return {
    sourceType: "reviews",
    sourceId: null,
    sourceName: "Google Business Profile",
    status: "failed",
    changesFound: 0,
    error: "The review scan failed.",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-27T12:00:00.000Z");
const daysBeforeNow = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("monthly provider caps", () => {
  it("falls back to each provider's entry-level allowance", () => {
    expect(monthlyCap("serpapi")).toBe(250);
    expect(monthlyCap("mallary")).toBe(50);
    expect(monthlyUsdCap("apify")).toBe(5);
  });

  it("leaves Apify uncapped in units, since it bills in dollars", () => {
    expect(monthlyCap("apify")).toBe(0);
    expect(monthlyUsdCap("serpapi")).toBe(0);
  });

  it("leaves reviews uncapped, since each read is billed to the reader that served it", () => {
    expect(monthlyCap("reviews")).toBe(0);

    // Not a provider we buy from, so there is no allowance to override.
    denoEnv.set("REVIEWS_MONTHLY_CAP", "10");
    expect(monthlyCap("reviews")).toBe(0);
  });

  it("lets an env var raise the cap", () => {
    denoEnv.set("SERPAPI_MONTHLY_CAP", "5000");
    denoEnv.set("APIFY_MONTHLY_CHARGE_USD", "250.5");

    expect(monthlyCap("serpapi")).toBe(5000);
    expect(monthlyUsdCap("apify")).toBe(250.5);
  });

  it("treats an explicit 0 as uncapped, and ignores nonsense", () => {
    denoEnv.set("MALLARY_MONTHLY_CAP", "0");
    expect(monthlyCap("mallary")).toBe(0);

    denoEnv.set("MALLARY_MONTHLY_CAP", "not a number");
    expect(monthlyCap("mallary")).toBe(50);

    denoEnv.set("SERPAPI_MONTHLY_CAP", "-10");
    expect(monthlyCap("serpapi")).toBe(250);
  });

  it("explains the arithmetic behind a refusal, naming the env var to raise", () => {
    const message = budgetMessage(
      "serpapi",
      { cap: 250, used: 240, remaining: 10 },
      50,
    );
    expect(message).toContain("250 SerpApi units");
    expect(message).toContain("240 recorded");
    expect(message).toContain("SERPAPI_MONTHLY_CAP");

    expect(
      spendMessage({ capUsd: 5, spentUsd: 4.9, remainingUsd: 0.1 }, 0.35),
    ).toContain("APIFY_MONTHLY_CHARGE_USD");
  });
});

describe("usage readout", () => {
  it("measures units and spend against their caps, taking the fuller one", () => {
    // 60% of the unit cap, but 120% of the dollar cap.
    const provider = status({
      provider: "apify",
      units: 60,
      cap: 100,
      costUsd: 6,
      capUsd: 5,
    });

    expect(providerUsage(provider)).toEqual({ pct: 120, capped: true });
  });

  it("reports an uncapped provider as uncapped whatever it has spent", () => {
    expect(providerUsage(status({ provider: "apify", costUsd: 40 }))).toEqual({
      pct: 0,
      capped: false,
    });
  });

  it("warns at 80% and calls 100% full — the same thresholds as the alerts", () => {
    expect(usageLevel(0)).toBe("ok");
    expect(usageLevel(79.9)).toBe("ok");
    expect(usageLevel(80)).toBe("warn");
    expect(usageLevel(99.9)).toBe("warn");
    expect(usageLevel(100)).toBe("full");
    expect(usageLevel(140)).toBe("full");
  });

  it("shows providers that were used or capped, and hides untouched uncapped ones", () => {
    const bars = buildUsageBars([
      status({ provider: "serpapi", units: 55, cap: 250, requests: 61, errors: 3 }),
      status({ provider: "apify", costUsd: 4.4, capUsd: 5, requests: 12 }),
      // Capped by default, so an untouched allowance is still worth showing.
      status({ provider: "mallary", cap: 50 }),
      // Neither used nor capped: nothing to say. Review reads are billed to
      // SerpApi or Apify, so the reviews slot is never capped on its own.
      status({ provider: "reviews" }),
    ]);

    expect(bars.map((bar) => bar.provider)).toEqual(["serpapi", "apify", "mallary"]);
    expect(bars[0]).toMatchObject({ pct: 22, level: "ok", requests: 61, errors: 3 });
    expect(bars[1]).toMatchObject({ level: "warn", costUsd: 4.4, capUsd: 5 });
    expect(bars[1].pct).toBeCloseTo(88);
    expect(bars[2]).toMatchObject({ units: 0, pct: 0, level: "ok" });
  });
});

describe("workspace health", () => {
  const failing = scanRun({ id: "run-1", startedAt: daysBeforeNow(1) });

  it("is healthy with no failures and no reconnects", () => {
    const health = buildWorkspaceHealth({
      scanRuns: [scanRun({ id: "run-ok", status: "succeeded" })],
      integrationConnections: [],
      reviewConnections: [],
      socialAccounts: [],
      now: NOW,
    });

    expect(health.ok).toBe(true);
    expect(health.failedScans).toEqual([]);
    expect(health.needsReconnect).toEqual([]);
  });

  it("lists recent failures newest first and ignores successes and stale ones", () => {
    const health = buildWorkspaceHealth({
      scanRuns: [
        failing,
        scanRun({ id: "run-2", startedAt: daysBeforeNow(2) }),
        scanRun({ id: "run-old", startedAt: daysBeforeNow(30) }),
        scanRun({ id: "run-ok", status: "succeeded" }),
      ],
      integrationConnections: [],
      reviewConnections: [],
      socialAccounts: [],
      now: NOW,
    });

    expect(health.ok).toBe(false);
    expect(health.failedScans.map((run) => run.id)).toEqual(["run-1", "run-2"]);
  });

  it("counts queued and running scans without treating them as failures", () => {
    const health = buildWorkspaceHealth({
      scanRuns: [
        scanRun({ id: "a", status: "running" }),
        scanRun({ id: "b", status: "queued" }),
        scanRun({ id: "c", status: "succeeded" }),
      ],
      integrationConnections: [],
      reviewConnections: [],
      socialAccounts: [],
      now: NOW,
    });

    expect(health.pendingScans).toBe(2);
    expect(health.ok).toBe(true);
  });

  it("collects every connection a provider has rejected, from all three lists", () => {
    const connection: IntegrationConnection = {
      id: "c1",
      provider: "serpapi",
      kind: "maps_place",
      externalId: "place",
      label: "Maps place",
      handle: "",
      status: "needs_reauth",
      meta: {},
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    };
    const review: ReviewConnection = {
      id: "c2",
      provider: "reviews",
      platform: "google",
      handle: "yourretailbrand",
      label: "Google reviews",
      status: "needs_reauth",
      lastSyncedAt: null,
      lastError: "401",
      createdAt: NOW.toISOString(),
    };
    const account: SocialAccount = {
      id: "c3",
      provider: "mallary",
      platform: "instagram",
      displayName: "Your Retail Brand",
      handle: "@yourretailbrand",
      avatarUrl: "",
      status: "needs_reauth",
      connectedAt: NOW.toISOString(),
    };

    const health = buildWorkspaceHealth({
      scanRuns: [],
      integrationConnections: [connection, { ...connection, id: "c4", status: "active" }],
      reviewConnections: [review],
      socialAccounts: [account],
      now: NOW,
    });

    expect(health.needsReconnect.map((item) => item.label)).toEqual([
      "Maps place",
      "Google reviews",
      "Your Retail Brand",
    ]);
    expect(health.ok).toBe(false);
  });
});

describe("budget alerts", () => {
  it("stays quiet while a workspace is inside its allowance", () => {
    const data = sampleWorkspace();
    data.providerStatus = [status({ provider: "serpapi", units: 100, cap: 250, requests: 110 })];

    expect(buildAlerts(data).some((alert) => alert.id.startsWith("alert-budget-"))).toBe(false);
  });

  it("warns at 80% and escalates once the allowance is gone", () => {
    const data = sampleWorkspace();

    data.providerStatus = [status({ provider: "serpapi", units: 200, cap: 250, requests: 205 })];
    const warn = buildAlerts(data).find((alert) => alert.id === "alert-budget-serpapi");
    expect(warn?.severity).toBe("watch");
    expect(warn?.title).toBe("SerpApi budget at 80%");

    data.providerStatus = [status({ provider: "serpapi", units: 250, cap: 250, requests: 260 })];
    const full = buildAlerts(data).find((alert) => alert.id === "alert-budget-serpapi");
    expect(full?.severity).toBe("urgent");
    expect(full?.detail).toContain("refused");
  });

  it("warns on spend for a provider that bills in dollars", () => {
    const data = sampleWorkspace();
    data.providerStatus = [
      status({ provider: "apify", costUsd: 4.6, capUsd: 5, requests: 30, units: 900 }),
    ];

    const alert = buildAlerts(data).find((item) => item.id === "alert-budget-apify");
    expect(alert?.severity).toBe("watch");
    expect(alert?.detail).toContain("$4.60 of $5.00 monthly spend used");
  });

  it("says nothing about the demo workspace's unconfigured providers", () => {
    expect(
      buildAlerts(sampleWorkspace()).some((alert) => alert.id.startsWith("alert-budget-")),
    ).toBe(false);
  });
});

describe("webhook event ids", () => {
  it("prefers the provider's own event id, in the order given", () => {
    expect(stableEventId(["evt_123", "evt_456"], "{}")).toBe("evt_123");
    expect(stableEventId([null, "  ", "evt_456"], "{}")).toBe("evt_456");
    expect(stableEventId([undefined, 90210], "{}")).toBe("90210");
  });

  it("fingerprints the body when the provider sends no id, so a retry is one event", () => {
    const body = JSON.stringify({ type: "review.created", review: { id: "r1" } });
    const first = stableEventId([], body);

    expect(first).toMatch(/^body-[0-9a-f]+$/);
    expect(stableEventId([], body)).toBe(first);
  });

  it("gives different bodies different ids, so a real second event still lands", () => {
    expect(stableEventId([], '{"a":1}')).not.toBe(stableEventId([], '{"a":2}'));
  });
});

describe("webhook signature verification", () => {
  const SECRET = "shhh";
  const BODY = '{"type":"post.published"}';

  /** The hex digest a provider would sign the body with. */
  async function sign(body: string, secret = SECRET): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  it("accepts a correct signature, however it is prefixed or cased", async () => {
    const signature = await sign(BODY);

    expect(await verifyHmacSignature(SECRET, BODY, signature)).toBe(true);
    expect(await verifyHmacSignature(SECRET, BODY, `sha256=${signature}`)).toBe(true);
    expect(await verifyHmacSignature(SECRET, BODY, `sha256=${signature.toUpperCase()}`)).toBe(true);
  });

  it("rejects a tampered body, the wrong secret, a missing signature and no secret", async () => {
    const signature = await sign(BODY);

    expect(await verifyHmacSignature(SECRET, '{"type":"post.failed"}', signature)).toBe(false);
    expect(await verifyHmacSignature("other-secret", BODY, signature)).toBe(false);
    expect(await verifyHmacSignature(SECRET, BODY, null)).toBe(false);
    expect(await verifyHmacSignature(SECRET, BODY, "")).toBe(false);
    expect(await verifyHmacSignature("", BODY, signature)).toBe(false);
  });
});
