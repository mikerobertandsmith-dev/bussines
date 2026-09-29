import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Row } from "./helpers/fakePostgres.ts";
import {
  BUSINESS_ID,
  SERPAPI_KEY,
  fakeSerpApi,
  reset,
  seedBusiness,
  seedCompetitor,
  seedKeyword,
  seedOrganic,
  seedPlace,
  seedRows,
  state,
} from "./helpers/serpCompetitors";

/**
 * The real `serp-competitors` handler, driven end to end with only the boundaries
 * it cannot run without faked: Clerk's identity check, Postgres and SerpApi.
 * Everything between them is shipped code — the handler, `_shared/keywords.ts`,
 * the budget arithmetic and every row it writes.
 *
 * Two defects this file exists to keep fixed, both of which looked like "the pages
 * do not pull":
 *
 *   1. The Maps lookup already returned each rival's **stars and review count**,
 *      and they went to `competitor_review_gap` and nowhere else — while the
 *      Competition panels read the competitor row. Every page showed a zero beside
 *      a figure we had paid for.
 *   2. A run with **no tracked keywords** refuses with a 409. Nothing said so on
 *      the page, so an empty My Business looked like a broken scan.
 */

const denoEnv = new Map<string, string>();
let handler: ((req: Request) => Promise<Response>) | null = null;

/** `Deno.serve` runs at module load, so the handler is captured here. */
function stubDeno() {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => denoEnv.get(name) },
    serve: (fn: (req: Request) => Promise<Response>) => {
      handler = fn;
    },
  });
}

stubDeno();

vi.mock("../supabase/functions/_shared/supabaseAdmin.ts", async () => {
  const helper = await import("./helpers/serpCompetitors");
  return { adminClient: helper.adminClient };
});

vi.mock("../supabase/functions/_shared/auth.ts", async () => {
  const helper = await import("./helpers/serpCompetitors");
  return { requireCaller: helper.requireCaller, assertBusinessOwned: helper.assertBusinessOwned };
});

await import("../supabase/functions/serp-competitors/index.ts");

async function runBenchmark(payload: Record<string, unknown> = {}, userId = "user-a") {
  if (!handler) throw new Error("the handler was never captured");
  state.userId = userId;
  const response = await handler(
    new Request("http://localhost/functions/v1/serp-competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test" },
      body: JSON.stringify({ businessId: BUSINESS_ID, ...payload }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const rows = (table: string): Row[] => state.tables[table] ?? [];
const competitor = (id: string) => rows("competitors").find((row) => row.id === id)!;

beforeEach(() => {
  vi.unstubAllGlobals();
  reset();
  stubDeno();
  fakeSerpApi();
  denoEnv.clear();
  denoEnv.set("SERPAPI_KEY", SERPAPI_KEY);
  seedBusiness();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** One rival that ranks, one that does not, both with a Maps listing. */
function seedTwoRivals() {
  const glowMart = seedCompetitor({ id: "comp-1", name: "GlowMart", website: "https://glowmart.com" });
  const trailCo = seedCompetitor({
    id: "comp-2",
    name: "TrailCo",
    website: "https://trailco.com",
    // An earlier benchmark already rated this one.
    rating: 4.1,
    review_count: 800,
  });
  seedPlace("GlowHouse", { rating: 4.8, reviews: 500 });
  seedPlace("GlowMart", { rating: 4.6, reviews: 12000 });
  seedPlace("TrailCo", { rating: 3.9, reviews: 900 });
  seedKeyword("fleece jacket", 1900);
  seedOrganic("fleece jacket", 4, "https://glowhouse.com/fleece", "GlowHouse fleece jacket");
  seedOrganic("fleece jacket", 8, "https://glowmart.com/fleece", "GlowMart fleece jacket");
  return { glowMart, trailCo };
}

describe("competitor benchmark — the figures it pays for reach the page", () => {
  it("stores each rival's rating and review count, with a truthful previous figure", async () => {
    seedTwoRivals();

    const outcome = await runBenchmark();

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ keywords: 1, competitors: 2, ourTop10: 1, ourShare: 100 });

    // The value the page shows, and where it came from.
    const mart = competitor("comp-1");
    expect(mart.rating).toBe(4.6);
    expect(mart.review_count).toBe(12000);
    // Never measured before, so there is no movement to claim.
    expect(mart.previous_rating).toBe(4.6);
    expect(mart.last_scan_at).toBeTruthy();

    // Measured before: the *earlier* reading is what remains as previous. Copying
    // the new value over it would make every movement read as none.
    const trail = competitor("comp-2");
    expect(trail.rating).toBe(3.9);
    expect(trail.previous_rating).toBe(4.1);
    expect(trail.review_count).toBe(900);

    // The gap table holds the same figures — the two must agree, since the page
    // reads one of them for the headline and the other for the gap.
    const gap = (id: string) => rows("competitor_review_gap").find((row) => row.competitor_id === id)!;
    expect(gap("comp-1")).toMatchObject({ their_rating: 4.6, their_reviews: 12000, our_rating: 4.8 });
    expect(gap("comp-2")).toMatchObject({ their_rating: 3.9, their_reviews: 900 });
  });

  it("also fills the panels that read the other three tables", async () => {
    seedTwoRivals();

    await runBenchmark();

    // Share of voice: one row per rival, from the organic results already fetched.
    const sov = rows("competitor_share_of_voice");
    expect(sov).toHaveLength(2);
    expect(sov.find((row) => row.competitor_id === "comp-1")).toMatchObject({
      our_top10: 1,
      their_top10: 1,
      our_share: 100,
    });
    expect(sov.find((row) => row.competitor_id === "comp-2")).toMatchObject({ their_top10: 0 });

    // Keyword gap: one row per term per rival whether or not either side ranked —
    // a term we place for and they do not *is* the gap.
    const keywords = rows("competitor_keywords");
    expect(keywords).toHaveLength(2);
    expect(keywords.find((row) => row.competitor_id === "comp-1")).toMatchObject({
      keyword: "fleece jacket",
      volume: 1900,
      our_rank: 4,
      their_rank: 8,
    });
    expect(keywords.find((row) => row.competitor_id === "comp-2")).toMatchObject({
      our_rank: 4,
      their_rank: null,
    });

    // Review trend: one point per rival per month, from the count just read.
    const trend = rows("competitor_metrics").filter((row) => row.kind === "review_trend");
    expect(trend).toHaveLength(2);
    expect(trend.find((row) => row.competitor_id === "comp-1")?.value).toBe(12000);

    // And the run is visible in the history the pages show.
    expect(rows("scan_runs")[0]).toMatchObject({ source_type: "seo", status: "succeeded" });
  });

  it("counts reviews this month as growth since the earlier benchmark of the same month", async () => {
    seedTwoRivals();
    // This month already has a point for GlowMart, from a week ago.
    seedRows("competitor_metrics", [
      {
        business_id: BUSINESS_ID,
        competitor_id: "comp-1",
        kind: "review_trend",
        label: new Date().toISOString().slice(0, 7),
        value: 11000,
        sort_order: 0,
      },
    ]);

    await runBenchmark();

    expect(competitor("comp-1").reviews_this_month).toBe(1000);
    // No earlier point for TrailCo this month, so its growth is not knowable yet —
    // and 0 says exactly that rather than inventing a figure.
    expect(competitor("comp-2").reviews_this_month).toBe(0);
  });

  it("replaces last run's keyword rows instead of stacking a second copy", async () => {
    seedTwoRivals();
    const longAgo = new Date(Date.now() - 86_400_000).toISOString();
    seedRows("competitor_keywords", [
      { business_id: BUSINESS_ID, competitor_id: "comp-1", keyword: "old term", created_at: longAgo },
      // Another tenant's row, which no run may touch.
      { business_id: "biz-2", competitor_id: "comp-9", keyword: "their term", created_at: longAgo },
    ]);

    await runBenchmark();

    const keywords = rows("competitor_keywords");
    // This tenant's own rows are replaced — the stale "old term" is gone, and the
    // term just measured takes its place.
    const mine = keywords.filter((row) => row.business_id === BUSINESS_ID);
    expect(mine.map((row) => row.keyword)).toEqual(["fleece jacket", "fleece jacket"]);
    // And the prune is scoped to the tenant: the other business's row survives,
    // which is the difference between a scoped delete and an unscoped one.
    expect(keywords.filter((row) => row.business_id === "biz-2")).toHaveLength(1);
  });

  it("refuses with a 409 that says where to add a keyword, when nothing is tracked", async () => {
    seedCompetitor();

    const outcome = await runBenchmark();

    expect(outcome.status).toBe(409);
    expect(outcome.body.error).toContain("No tracked keywords yet");
    expect(outcome.body.error).toContain("My Business");
    // Refused before the first provider call: a refusal must not cost a search.
    expect(state.searches).toHaveLength(0);
  });

  it("falls back to the rival terms a run has already stored", async () => {
    seedCompetitor();
    seedPlace("GlowHouse", { rating: 4.8, reviews: 500 });
    seedPlace("GlowMart", { rating: 4.6, reviews: 12000 });
    seedRows("competitor_keywords", [
      { business_id: BUSINESS_ID, competitor_id: "comp-1", keyword: "fleece jacket" },
    ]);

    const outcome = await runBenchmark();

    expect(outcome.status).toBe(200);
    expect(outcome.body.keywords).toBe(1);
    // One organic search for the term, plus a Maps lookup for us and each rival.
    expect(state.searches.filter((call) => call.engine === "google")).toHaveLength(1);
    expect(state.searches.filter((call) => call.engine === "google_maps")).toHaveLength(2);
  });
});
