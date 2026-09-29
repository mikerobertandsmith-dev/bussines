import { vi } from "vitest";
import { HttpError } from "../../supabase/functions/_shared/errors.ts";
import { adminClientFor, jsonResponse, type Row, type Tables } from "./fakePostgres.ts";

/**
 * The three boundaries `serp-competitors` cannot run without, faked so the real
 * handler can be driven in a test: Clerk's identity check, Postgres, and
 * SerpApi's HTTP API.
 *
 * Everything between them is shipped code — the handler, `_shared/keywords.ts`
 * (which decides what a keyword set *is*), the budget arithmetic, the SerpApi
 * client, and every row it writes. The fixtures and the handler share one store,
 * so a test seeds a competitor, runs the benchmark, and reads back the row the
 * handler updated rather than a copy of it.
 *
 * The SerpApi fake is deliberate about the part that matters: the Maps listing it
 * returns carries a real `rating` and `reviews`, so a test can say "this rival
 * rated 4.6 with 12,000 reviews" and then assert what the handler stored. Those
 * two figures used to reach `competitor_review_gap` and nowhere else, which left
 * the Competition panels showing zeros beside a value we had already paid for.
 */

/* ------------------------------------------------------------------ state */

export const state: {
  userId: string;
  tables: Tables;
  /** Every SerpApi request the run made, for asserting on cost and shape. */
  searches: Array<{ engine: string; q: string }>;
  /** The Maps listing each query should return, keyed by the query's first word. */
  places: Map<string, Row>;
  /** Organic results per keyword, in the order they should be found. */
  organic: Map<string, Row[]>;
} = {
  userId: "user-a",
  tables: {},
  searches: [],
  places: new Map(),
  organic: new Map(),
};

/** The service-role client, as far as the handler is concerned. */
export function adminClient() {
  return adminClientFor(state.tables);
}

/** The Clerk check, replaced by an identity the test sets. */
export async function requireCaller() {
  if (!state.userId) throw new HttpError(401, "Missing bearer token.");
  return { userId: state.userId };
}

/** Tenant ownership, kept real: it is the guard every handler leans on. */
export async function assertBusinessOwned(callerUserId: string, businessId: string) {
  const business = (state.tables.businesses ?? []).find((row) => row.id === businessId);
  if (!business || business.owner_user_id !== callerUserId) {
    throw new HttpError(403, "You do not have access to this business.");
  }
  return business;
}

/* ---------------------------------------------------------------- serpapi */

/** The key the handler requires before it will run at all. */
export const SERPAPI_KEY = "serpapi-key";

/**
 * Answers SerpApi from the fixtures below.
 *
 * `google` returns the organic list for the keyword asked about; `google_maps`
 * returns the listing whose key is the query's first word, which is how the
 * handler addresses a business — it searches `"{name} {location}"`.
 */
export function fakeSerpApi() {
  vi.stubGlobal("fetch", async (input: unknown) => {
    const url = new URL(String(input));
    const engine = url.searchParams.get("engine") ?? "";
    const q = url.searchParams.get("q") ?? "";
    state.searches.push({ engine, q });

    if (engine === "google_maps") {
      const place = state.places.get(q.split(" ")[0] ?? "");
      return jsonResponse(place ? { place_results: { ...place } } : {});
    }

    return jsonResponse({ organic_results: (state.organic.get(q) ?? []).map((row) => ({ ...row })) });
  });
}

/* --------------------------------------------------------------- fixtures */

export const BUSINESS_ID = "biz-1";

export function seedBusiness(overrides: Partial<Row> = {}): Row {
  const row = {
    id: BUSINESS_ID,
    owner_user_id: "user-a",
    brand_name: "GlowHouse",
    primary_domain: "glowhouse.com",
    country: "United States",
    ...overrides,
  };
  state.tables.businesses = [row];
  return row;
}

export function seedCompetitor(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: `comp-${(state.tables.competitors ?? []).length + 1}`,
    business_id: BUSINESS_ID,
    name: "GlowMart",
    website: "https://glowmart.com",
    rating: null,
    review_count: 0,
    ...overrides,
  };
  state.tables.competitors = [...(state.tables.competitors ?? []), row];
  return row;
}

/** One tracked term, in the shape `saveKeywordIdea` writes. */
export function seedKeyword(keyword: string, volume = 0, kind = "seo"): Row {
  const row = { business_id: BUSINESS_ID, keyword, kind, volume, position: 0, change: 0 };
  state.tables.my_keywords = [...(state.tables.my_keywords ?? []), row];
  return row;
}

/** A Maps listing, as SerpApi returns one. */
export function seedPlace(key: string, overrides: Partial<Row> = {}): Row {
  const place = {
    title: key,
    place_id: `place-${key.toLowerCase()}`,
    website: `https://${key.toLowerCase()}.com`,
    rating: 4.5,
    reviews: 1000,
    ...overrides,
  };
  state.places.set(key, place);
  return place;
}

/** One organic result for a keyword, at the position it should be found at. */
export function seedOrganic(keyword: string, position: number, link: string, title: string): Row {
  const row = { position, link, title };
  state.organic.set(keyword, [...(state.organic.get(keyword) ?? []), row]);
  return row;
}

/** A row this tenant already holds, for the tables the handler reads first. */
export function seedRows(table: string, rows: Row[]): void {
  state.tables[table] = [...(state.tables[table] ?? []), ...rows];
}

export function reset(): void {
  state.userId = "user-a";
  state.tables = {};
  state.searches = [];
  state.places = new Map();
  state.organic = new Map();
  vi.unstubAllGlobals();
}
