import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchJson, providerRefusal } from "../supabase/functions/_shared/http.ts";
import { HttpError } from "../supabase/functions/_shared/errors.ts";

/**
 * The refusal bodies below are **verbatim** from the live providers. The Apify one
 * is what every Apify-backed panel returned on 2026-09-29, and it is the reason
 * this function exists: it arrived as `Provider request failed (403)` with the
 * explanation stripped, so competitor inventory, social, traffic and advertising
 * all looked like separate broken features when they were one spent allowance.
 */
const APIFY_LIMIT =
  '{\n  "error": {\n    "type": "platform-feature-disabled",\n    "message": "Monthly usage hard limit exceeded"\n  }\n}';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("providerRefusal", () => {
  it("names the spent monthly allowance and says what fixes it", () => {
    const message = providerRefusal(403, APIFY_LIMIT, "https://api.apify.com/v2/actors/x/runs");
    expect(message).toContain("Apify has reached this account's monthly usage limit");
    expect(message).toContain("affects every panel that reads Apify at once");
    // The provider's own words survive, so the diagnosis is checkable.
    expect(message).toContain("Monthly usage hard limit exceeded");
  });

  it("distinguishes a plan limitation from a spent allowance", () => {
    // `platform-feature-disabled` covers both, so the message is matched before
    // the type is.
    const message = providerRefusal(
      403,
      '{"error":{"type":"platform-feature-disabled","message":"Monthly usage hard limit exceeded"}}',
      "https://api.apify.com/v2/actors/x/runs",
    );
    expect(message).toContain("monthly usage limit");
    expect(message).not.toContain("plan does not include");
  });

  it("calls out a feature the plan does not cover", () => {
    const message = providerRefusal(
      403,
      '{"error":{"type":"platform-feature-disabled","message":"Custom proxies are not available on your plan"}}',
      "https://api.apify.com/v2/actors/x/runs",
    );
    expect(message).toContain("does not include the feature");
    expect(message).toContain("Upgrade the Apify plan");
  });

  it("tells the difference between bad credentials and a spent allowance", () => {
    const message = providerRefusal(401, '{"error":"Invalid API key"}', "https://serpapi.com/search");
    expect(message).toContain("refused the credentials");
    expect(message).toContain("SerpApi");
    expect(message).not.toContain("monthly usage limit");
  });

  it("leaves anything unrecognised as the raw status and body", () => {
    // An unexplained refusal is better than a guessed explanation.
    const message = providerRefusal(503, "upstream is on fire", "https://example.com/x");
    expect(message).toBe("Provider request failed (503): upstream is on fire");
  });
});

describe("fetchJson", () => {
  it("raises a spent allowance as 429, so the caller stops rather than retrying", async () => {
    const calls = vi.fn(
      async () => new Response(APIFY_LIMIT, { status: 403, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", calls);

    await expect(
      fetchJson("https://api.apify.com/v2/actors/x/runs", { retries: 2 }),
    ).rejects.toMatchObject({ status: 429 });

    // 403 is not in the retryable set, so it must fail fast: retrying a spent
    // allowance three times costs the user nothing but makes the page wait.
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("keeps the provider's status alongside the outward one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 400 })),
    );

    const error = await fetchJson("https://api.apify.com/v2/x", { retries: 0 }).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(502);
    expect((error as HttpError).providerStatus).toBe(400);
  });
});
