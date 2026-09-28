import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { affordableCount, budgetMessage, readBudget } from "../_shared/budget.ts";
import { DEFAULT_KEYWORDS, MAX_KEYWORDS, clampInt, resolveKeywords } from "../_shared/keywords.ts";
import {
  findOrganicResult,
  hostnameOf,
  matchLocalPlace,
  serpApi,
  type SerpApiLocalResult,
} from "../_shared/serpapi.ts";

/**
 * Competitor benchmarking (SerpApi).
 *
 * One organic search per tracked keyword gives every business's presence in the
 * Google top 10, which becomes the **Share of Voice** comparison. One Maps search
 * per competitor supplies rating and review counts for the **Competitor Review
 * Gap**. Results replace the tenant's previous row so the panel is always current.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
const TOP_N = 10;

interface Body {
  businessId?: string;
  keywords?: string[];
  location?: string;
  limit?: number;
}

interface CompetitorRow {
  id: string;
  name: string;
  website: string;
}

/** Best local result for a business: explicit place, matched listing, else first. */
function pickPlace(
  response: { place_results?: SerpApiLocalResult; local_results?: SerpApiLocalResult[] },
  domain: string,
  name: string,
): SerpApiLocalResult | undefined {
  if (response.place_results) return response.place_results;
  const candidates = response.local_results ?? [];
  return candidates.find((entry) => matchLocalPlace(entry, domain, name)) ?? candidates[0];
}

/** Percent of tracked terms a business appears in the top 10 for. */
function sharePct(count: number, terms: number): number {
  if (!terms) return 0;
  return Number(((count / terms) * 100).toFixed(2));
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!hasEnv("SERPAPI_KEY")) {
      throw new HttpError(
        409,
        "SerpApi is not configured on the server. Add SERPAPI_KEY to the function secrets.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const db = adminClient();
    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id, brand_name, primary_domain, country")
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const brandName = String(business.brand_name ?? "");
    const ourDomain = hostnameOf(String(business.primary_domain ?? ""));
    const location = String(body.location ?? business.country ?? "").trim();

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name, website")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);

    const competitors = (competitorRows ?? []) as CompetitorRow[];
    if (!competitors.length) {
      throw new HttpError(
        409,
        "No competitors to benchmark yet. Add competitor websites, then run the benchmark again.",
      );
    }

    const allKeywords = await resolveKeywords(db, businessId, body.keywords);
    if (!allKeywords.length) {
      throw new HttpError(
        409,
        "No tracked keywords yet. Find some keywords on My Business, then run the benchmark again.",
      );
    }
    const requested = Math.min(
      clampInt(body.limit, 1, MAX_KEYWORDS, DEFAULT_KEYWORDS),
      allKeywords.length,
    );

    // One organic search per keyword, plus a Maps lookup for us and one per
    // competitor — planned before the first call so the run cannot overshoot
    // the workspace's monthly budget.
    const unitsPerKeyword = 1;
    const mapsReserve = 1 + competitors.length;
    const budget = await readBudget(db, businessId, "serpapi");
    const affordable = affordableCount(budget.remaining, unitsPerKeyword, mapsReserve);
    if (affordable < 1) {
      throw new HttpError(429, budgetMessage("serpapi", budget, unitsPerKeyword + mapsReserve));
    }

    const keywords = allKeywords.slice(0, Math.min(requested, affordable));
    const capped = keywords.length < requested;

    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    /* ---------------------------------------------------- Share of Voice */
    const ourTop10 = { count: 0 };
    const theirTop10 = new Map<string, number>();
    for (const competitor of competitors) theirTop10.set(competitor.id, 0);

    for (const keyword of keywords) {
      const response = await serpApi({
        engine: "google",
        q: keyword,
        location: location || undefined,
        device: "desktop",
        num: 20,
        hl: "en",
      });
      const results = response.organic_results ?? [];

      const ours = findOrganicResult(results, ourDomain, brandName);
      if (ours?.position !== undefined && ours.position <= TOP_N) ourTop10.count += 1;

      for (const competitor of competitors) {
        const domain = hostnameOf(String(competitor.website ?? ""));
        const match = findOrganicResult(results, domain, String(competitor.name ?? ""));
        if (match?.position !== undefined && match.position <= TOP_N) {
          theirTop10.set(competitor.id, (theirTop10.get(competitor.id) ?? 0) + 1);
        }
      }
    }

    const termCount = keywords.length;
    const ourShare = sharePct(ourTop10.count, termCount);

    // Snapshot our previous share so the app can alert when it crosses the
    // threshold (the upsert below overwrites the current row).
    const { data: priorSov } = await db
      .from("competitor_share_of_voice")
      .select("competitor_id, our_share")
      .eq("business_id", businessId);
    const priorShare = new Map<string, number>();
    for (const row of priorSov ?? []) {
      priorShare.set(String(row.competitor_id), Number(row.our_share ?? 0));
    }

    // The same snapshot for the review gap, so a widening gap can raise its own
    // alert (Phase 3) once this row is replaced below.
    const { data: priorGap } = await db
      .from("competitor_review_gap")
      .select("competitor_id, review_gap")
      .eq("business_id", businessId);
    const priorGapById = new Map<string, number>();
    for (const row of priorGap ?? []) {
      priorGapById.set(String(row.competitor_id), Number(row.review_gap ?? 0));
    }

    const sovRows = competitors.map((competitor) => ({
      business_id: businessId,
      competitor_id: competitor.id,
      competitor_name: String(competitor.name ?? ""),
      keyword_set: "tracked",
      term_count: termCount,
      our_top10: ourTop10.count,
      their_top10: theirTop10.get(competitor.id) ?? 0,
      our_share: ourShare,
      their_share: sharePct(theirTop10.get(competitor.id) ?? 0, termCount),
      previous_our_share: priorShare.has(competitor.id) ? priorShare.get(competitor.id) : null,
      checked_at: checkedAt,
    }));

    /* ------------------------------------------------ Competitor Review Gap */
    const oursMaps = await serpApi({
      engine: "google_maps",
      type: "search",
      q: `${brandName} ${location}`.trim(),
      hl: "en",
    });
    const ourPlace = pickPlace(oursMaps, ourDomain, brandName);

    const gapRows: Record<string, unknown>[] = [];
    let mapsCalls = 1;
    for (const competitor of competitors) {
      const name = String(competitor.name ?? "");
      const domain = hostnameOf(String(competitor.website ?? ""));
      const theirMaps = await serpApi({
        engine: "google_maps",
        type: "search",
        q: `${name} ${location}`.trim(),
        hl: "en",
      });
      mapsCalls += 1;
      const theirPlace = pickPlace(theirMaps, domain, name);

      const ourReviews = Number(ourPlace?.reviews ?? 0);
      const theirReviews = Number(theirPlace?.reviews ?? 0);
      const ourRating = Number(ourPlace?.rating ?? 0);
      const theirRating = Number(theirPlace?.rating ?? 0);

      gapRows.push({
        business_id: businessId,
        competitor_id: competitor.id,
        competitor_name: name,
        place_id: String(theirPlace?.place_id ?? theirPlace?.data_id ?? ""),
        our_reviews: ourReviews,
        their_reviews: theirReviews,
        review_gap: theirReviews - ourReviews,
        our_rating: ourRating,
        their_rating: theirRating,
        rating_gap: Number((ourRating - theirRating).toFixed(2)),
        previous_review_gap: priorGapById.has(competitor.id)
          ? (priorGapById.get(competitor.id) ?? null)
          : null,
        checked_at: checkedAt,
      });
    }

    /* ------------------------------------------------------------ persist */
    const { error: sovError } = await db
      .from("competitor_share_of_voice")
      .upsert(sovRows, { onConflict: "business_id,competitor_id" });
    if (sovError) throw new HttpError(500, sovError.message);

    const { error: gapError } = await db
      .from("competitor_review_gap")
      .upsert(gapRows, { onConflict: "business_id,competitor_id" });
    if (gapError) throw new HttpError(500, gapError.message);

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "seo",
      source_name: "Competitor local benchmark",
      status: "succeeded",
      changes_found: sovRows.length + gapRows.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google",
      units: termCount,
      detail: `${termCount} keywords for share of voice${capped ? " (monthly budget reached)" : ""}`,
    });
    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google_maps",
      units: mapsCalls,
      detail: `${competitors.length} competitor maps listings`,
    });

    return json({
      keywords: termCount,
      competitors: competitors.length,
      ourShare,
      ourTop10: ourTop10.count,
      rows: sovRows.length + gapRows.length,
      /** True when the monthly budget, not the tracked list, cut the run short. */
      capped,
    });
  } catch (error) {
    return failure(error);
  }
});
