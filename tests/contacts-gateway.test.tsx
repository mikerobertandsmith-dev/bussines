import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyDb,
  fakeApify,
  minutesAgo,
  seedBusiness,
  seedCompetitor,
  seedFinishedRun,
  state,
} from "./helpers/contactsGateway";

/**
 * The real `web-contacts-scan` handler, driven end to end with only the two
 * boundaries it cannot run without faked: Clerk's identity check and Postgres.
 * Everything between them is shipped code — the handler, the Apify client, the
 * contacts normaliser, the caps and `recordUsage`.
 *
 * This is what makes the cost guarantees checkable without a session, a tenant
 * or an Apify account. See `tests/helpers/contactsGateway.ts` for what is
 * substituted and why.
 */

const denoEnv = new Map<string, string>();
let handler: ((req: Request) => Promise<Response>) | null = null;

// Stubbed before the function is imported: `Deno.serve` runs at module load.
vi.stubGlobal("Deno", {
  env: { get: (name: string) => denoEnv.get(name) },
  serve: (fn: (req: Request) => Promise<Response>) => {
    handler = fn;
  },
});

vi.mock("../supabase/functions/_shared/supabaseAdmin.ts", async () => {
  const helper = await import("./helpers/contactsGateway");
  return { adminClient: helper.adminClient };
});

vi.mock("../supabase/functions/_shared/auth.ts", async () => {
  const helper = await import("./helpers/contactsGateway");
  return { requireCaller: helper.requireCaller, assertBusinessOwned: helper.assertBusinessOwned };
});

await import("../supabase/functions/web-contacts-scan/index.ts");

/** One dataset item, shaped like the live actor's output. */
const LIVE_ITEM = {
  instagrams: ["https://www.instagram.com/cotopaxi"],
  twitters: ["https://x.com/cotopaxi"],
  youtubes: ["https://www.youtube.com/user/GearForGood"],
};

/** A proposal stored on a ledger row, for the replay path. */
const STORED_SUGGESTION = {
  platform: "instagram",
  handle: "meteorbeauty",
  url: "https://www.instagram.com/meteorbeauty",
  monitorable: true,
};

async function call(payload: Record<string, unknown>, userId = "user-a") {
  if (!handler) throw new Error("the handler was never captured");
  state.userId = userId;
  const response = await handler(
    new Request("http://localhost/functions/v1/web-contacts-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
      body: JSON.stringify(payload),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const runs = () => state.db.contacts_discovery_runs;
const usage = () => state.db.api_usage_log;
const competitor = () => state.db.competitors.find((row) => row.id === "comp-1")!;

beforeEach(() => {
  denoEnv.clear();
  denoEnv.set("APIFY_TOKEN", "apify-token");
  denoEnv.set("APIFY_CONTACTS_ACTOR_ID", "9Sk4JJhEma9vBKqrg");
  state.db = emptyDb();
  state.userId = "user-a";
});

afterEach(() => {
  // `fetch` is re-stubbed per test by `fakeApify`; the `Deno` double stays,
  // because the module under test reads it on every call.
  vi.unstubAllGlobals();
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => denoEnv.get(name) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn;
    },
  });
});

describe("preview mode", () => {
  it("records one run and logs its cost once", async () => {
    seedBusiness();
    const apify = fakeApify({ items: [LIVE_ITEM] });

    const res = await call({ url: "https://glowmartbeauty.com/shop" });

    expect(res.body.status).toBe("done");
    // Everything found is reported, including what we cannot monitor — it is
    // flagged rather than dropped, which is what the "Found, not monitored"
    // line renders.
    expect(res.body.suggestions.map((s: any) => s.platform)).toEqual(["instagram", "x", "youtube"]);
    expect(res.body.suggestions.filter((s: any) => s.monitorable)).toHaveLength(2);
    expect(res.body.unmonitored).toEqual(["YouTube"]);
    // The site is read as its host, whatever path was sent.
    expect(res.body.scannedUrl).toBe("https://glowmartbeauty.com");

    expect(runs()).toHaveLength(1);
    expect(runs()[0]).toMatchObject({
      mode: "preview",
      status: "done",
      user_id: "user-a",
      // A signed-in user who already owns a workspace has their spend land in it.
      business_id: "biz-1",
    });
    expect(runs()[0].run_id).toBeTruthy();
    // Counts everything the site yielded, monitorable or not.
    expect(runs()[0].suggestion_count).toBe(3);

    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({
      provider: "apify",
      endpoint: "contacts:preview",
      business_id: "biz-1",
      status: "ok",
    });
    expect(usage()[0].cost_usd).toBeCloseTo(apify.costUsd, 6);
  });

  it("refuses past the per-user hourly allowance, without starting a run", async () => {
    seedBusiness();
    for (let i = 0; i < 10; i += 1) {
      seedFinishedRun({ mode: "preview", status: "done", competitor_id: null });
    }
    const apify = fakeApify();

    const res = await call({ url: "https://glowmartbeauty.com" });

    expect(res.status).toBe(429);
    expect(res.body.error).toContain("10 website reads in the last hour");
    expect(apify.starts).toBe(0);
    // Nothing is even claimed, so there is no row to clean up afterwards.
    expect(runs()).toHaveLength(10);
    expect(usage()).toHaveLength(0);
  });

  it("counts the allowance per user, so one account cannot exhaust another's", async () => {
    seedBusiness();
    for (let i = 0; i < 10; i += 1) {
      seedFinishedRun({ mode: "preview", status: "done", competitor_id: null, user_id: "user-b" });
    }
    fakeApify({ items: [LIVE_ITEM] });

    const res = await call({ url: "https://glowmartbeauty.com" }, "user-a");

    expect(res.body.status).toBe("done");
  });
});

describe("collect mode", () => {
  it("refuses another account's run, and the owner can still collect it", async () => {
    seedBusiness();
    const theirs = seedFinishedRun({
      user_id: "user-b",
      mode: "preview",
      status: "done",
      competitor_id: null,
      run_id: "run-belongs-to-b",
      scanned_url: "https://theirs.com",
    });
    const apify = fakeApify({ items: [LIVE_ITEM] });

    // The run id is a UUID, so a guessed one is unlikely — but if it leaks, it
    // must not be enough on its own. This is the cross-account fix.
    const stolen = await call({ runId: "run-belongs-to-b" }, "user-a");
    expect(stolen.status).toBe(404);
    expect(stolen.body.error).toBe("That discovery run is not in this account.");
    // Refused before the provider was ever asked, so no data and no cost.
    expect(apify.calls).toHaveLength(0);
    expect(usage()).toHaveLength(0);

    // The pairing is the check: the same call by the account that owns it works.
    const own = await call({ runId: "run-belongs-to-b" }, "user-b");
    expect(own.body.status).toBe("done");
    expect(own.body.scannedUrl).toBe("https://theirs.com");
    expect(own.body.suggestions.map((s: any) => s.platform)).toEqual([
      "instagram",
      "x",
      "youtube",
    ]);
    expect(runs().find((row) => row.id === theirs.id)!.status).toBe("done");
    expect(usage()).toHaveLength(1);
  });

  it("answers 'running' for a run that has not finished, without charging for it", async () => {
    seedBusiness();
    seedFinishedRun({
      user_id: "user-a",
      mode: "preview",
      status: "running",
      competitor_id: null,
      run_id: "run-still-going",
    });
    const apify = fakeApify();
    apify.statuses.set("run-still-going", "RUNNING");

    const res = await call({ runId: "run-still-going" });
    expect(res.body.status).toBe("running");
    // A run that has not finished has not been charged, so nothing is logged.
    expect(usage()).toHaveLength(0);
  });
});

describe("stored mode", () => {
  it("replays a read taken moments ago instead of paying for it twice", async () => {
    seedBusiness();
    seedCompetitor();
    const recent = seedFinishedRun({
      updated_at: minutesAgo(0.5),
      suggestions: [STORED_SUGGESTION],
      suggestion_count: 1,
    });
    const apify = fakeApify();

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" });

    expect(res.body.status).toBe("done");
    expect(res.body.cached).toBe(true);
    expect(res.body.suggestions).toEqual([STORED_SUGGESTION]);
    expect(apify.starts).toBe(0);
    expect(usage()).toHaveLength(0);
    // The competitor is left alone: a replay is not a new read.
    expect(competitor().contacts_status).toBe("idle");
    expect(runs()).toHaveLength(1);
    expect(runs()[0].id).toBe(recent.id);
  });

  it("reads afresh once the window has passed", async () => {
    seedBusiness();
    seedCompetitor();
    seedFinishedRun({ updated_at: minutesAgo(10), suggestions: [STORED_SUGGESTION] });
    const apify = fakeApify({ items: [LIVE_ITEM] });

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" });

    expect(res.body.cached).toBeUndefined();
    expect(apify.starts).toBe(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].endpoint).toBe("contacts:stored");
    // The old row plus this read's claim — never a second row for one run.
    expect(runs()).toHaveLength(2);
    expect(competitor().contacts_status).toBe("done");
    expect(competitor().contacts_run_id).toBe("");
  });

  it("honours force, which skips the replay", async () => {
    seedBusiness();
    seedCompetitor();
    seedFinishedRun({ updated_at: minutesAgo(0.5), suggestions: [STORED_SUGGESTION] });
    const apify = fakeApify({ items: [LIVE_ITEM] });

    const res = await call({ businessId: "biz-1", competitorId: "comp-1", force: true });

    expect(res.body.cached).toBeUndefined();
    expect(apify.starts).toBe(1);
  });

  it("buys one run when the button is double-clicked", async () => {
    seedBusiness();
    seedCompetitor();
    const apify = fakeApify({ items: [LIVE_ITEM] });

    const [first, second] = await Promise.all([
      call({ businessId: "biz-1", competitorId: "comp-1" }),
      call({ businessId: "biz-1", competitorId: "comp-1" }),
    ]);

    // The invariant: one run, one charge, one run id in both answers.
    expect(apify.starts).toBe(1);
    expect(usage()).toHaveLength(1);
    const stored = runs().filter((row) => row.mode === "stored");
    expect(stored).toHaveLength(1);

    const ids = [first.body.runId, second.body.runId].filter(Boolean);
    expect(new Set(ids).size).toBe(1);
    expect([first.body.status, second.body.status]).toContain("done");
  });

  it("clears a run whose Apify id is gone, and reads afresh", async () => {
    seedBusiness();
    seedCompetitor({ contacts_status: "running", contacts_run_id: "ghost-run" });
    const ghost = seedFinishedRun({
      run_id: "ghost-run",
      status: "running",
      updated_at: minutesAgo(1),
    });
    const apify = fakeApify({ items: [LIVE_ITEM] });
    apify.gone.add("ghost-run");

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" });

    // No error reaches the user, and a real read happens.
    expect(res.body.status).toBe("done");
    expect(apify.starts).toBe(1);

    // The abandoned claim is released, which is what lets the new one through:
    // the one-live-run index would have refused it otherwise.
    expect(runs().find((row) => row.id === ghost.id)!.status).toBe("failed");
    expect(runs()).toHaveLength(2);
    expect(competitor().contacts_status).toBe("done");
    // Only the new run is charged — the ghost bought nothing.
    expect(usage()).toHaveLength(1);
  });

  it("does not read again when Apify cannot be reached at all", async () => {
    seedBusiness();
    seedCompetitor({ contacts_status: "running", contacts_run_id: "flaky-run" });
    const apify = fakeApify();
    apify.broken.add("flaky-run");

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" });

    // A transient failure must not be read as "gone": that would start a second
    // run for pages that are already being paid for.
    expect(res.status).toBe(503);
    expect(res.body.error).toContain("Could not check the read already in flight");
    expect(apify.starts).toBe(0);
    expect(competitor().contacts_run_id).toBe("flaky-run");
    expect(usage()).toHaveLength(0);
  });

  it("refuses a competitor with no readable website", async () => {
    seedBusiness();
    seedCompetitor({ website: "not a url" });
    const apify = fakeApify();

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("has no readable website on file");
    expect(apify.starts).toBe(0);
  });

  it("refuses a workspace the caller does not own", async () => {
    seedBusiness("biz-1", "user-a");
    seedCompetitor();
    fakeApify();

    const res = await call({ businessId: "biz-1", competitorId: "comp-1" }, "user-b");

    expect(res.status).toBe(403);
    expect(usage()).toHaveLength(0);
  });
});

describe("configuration", () => {
  it("reports itself unavailable when no actor id is set, and invents none", async () => {
    denoEnv.delete("APIFY_CONTACTS_ACTOR_ID");
    const apify = fakeApify();

    const res = await call({ url: "https://glowmartbeauty.com" });

    expect(res.body.status).toBe("unavailable");
    expect(res.body.reason).toContain("APIFY_CONTACTS_ACTOR_ID");
    expect(apify.calls).toHaveLength(0);
    expect(runs()).toHaveLength(0);
  });
});
