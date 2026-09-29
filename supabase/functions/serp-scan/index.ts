import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { affordableCount, budgetMessage, readBudget } from "../_shared/budget.ts";
import {
  DEFAULT_KEYWORDS,
  MAX_KEYWORDS,
  clampInt,
  resolveKeywords,
} from "../_shared/keywords.ts";
import {
  buildProfileChecks,
  findOrganicResult,
  hostnameOf,
  matchLocalPlace,
  serpApi,
  snippetTypeOf,
} from "../_shared/serpapi.ts";
import {
  standingsByKeyword,
  summariseRankings,
  type RankingRow,
} from "../_shared/seo.ts";

/**
 * Google search & local scan (SerpApi).
 *
 * For the tenant's tracked keywords it records, per device:
 *   - our organic position and whether our result carries a rich snippet;
 *   - the local map 3-pack and whether we are in it;
 * and once per run it refreshes our Google Business Profile health.
 *
 * It also writes the workspace's **search visibility** back onto the business row
 * — `seo_score`, `top10_count`, `avg_position` (each with its `previous_*`
 * counterpart) and `rankings_checked_at` — derived from the standings this scan
 * holds. The My Business health card reads those columns, so without this pass the
 * card would show the figures onboarding wrote rather than anything a scan found.
 * The derivation lives in `_shared/seo.ts`.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
type Device = "desktop" | "mobile";

interface Body {
  businessId?: string;
  keywords?: string[];
  devices?: Device[];
  location?: string;
  limit?: number;
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
      // The score columns come along so each one's previous value — which is what
      // the card shows movement against — can be carried over on the write below.
      .select(
        "id, brand_name, primary_domain, country, seo_score, top10_count, avg_position",
      )
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const brandName = String(business.brand_name ?? "");
    const domain = hostnameOf(String(business.primary_domain ?? ""));
    const location = String(body.location ?? business.country ?? "").trim();

    const devices: Device[] = (
      body.devices?.length ? body.devices : ["desktop", "mobile"]
    ).filter((d): d is Device => d === "desktop" || d === "mobile");

    const allKeywords = await resolveKeywords(db, businessId, body.keywords);
    if (!allKeywords.length) {
      throw new HttpError(
        409,
        "No tracked keywords yet. Find some keywords on My Business, then run the scan again.",
      );
    }
    const requested = Math.min(clampInt(body.limit, 1, MAX_KEYWORDS, DEFAULT_KEYWORDS), allKeywords.length);

    // Spend is planned before it happens: one search per keyword × device, plus
    // the Business profile lookup below. A run trims itself to whatever the
    // workspace has left this month rather than overshooting the budget.
    const budget = await readBudget(db, businessId, "serpapi");
    const unitsPerKeyword = devices.length;
    const affordable = affordableCount(budget.remaining, unitsPerKeyword, 1);
    if (affordable < 1) throw new HttpError(429, budgetMessage("serpapi", budget, unitsPerKeyword + 1));

    const keywords = allKeywords.slice(0, Math.min(requested, affordable));
    const capped = keywords.length < requested;

    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    // Snapshot the previous scan so the app can alert on a drop out of the pack
    // or a lost rich snippet (the upsert below overwrites the current row).
    const { data: priorRankings } = await db
      .from("serp_rankings")
      .select("keyword, device, location, position, is_rich_result, snippet_type")
      .eq("business_id", businessId);
    const priorRankingByKey = new Map<string, Record<string, unknown>>();
    for (const row of priorRankings ?? []) {
      priorRankingByKey.set(
        `${row.keyword}|${row.device}|${row.location}`,
        row as Record<string, unknown>,
      );
    }

    const { data: priorPacks } = await db
      .from("local_pack_rankings")
      .select("keyword, location, in_pack, pack_position")
      .eq("business_id", businessId);
    const priorPackByKey = new Map<string, Record<string, unknown>>();
    for (const row of priorPacks ?? []) {
      priorPackByKey.set(`${row.keyword}|${row.location}`, row as Record<string, unknown>);
    }

    /* ------------------------------------------- Google Business Profile health */
    let healthRow: Record<string, unknown> | null = null;
    const mapsResponse = await serpApi({
      engine: "google_maps",
      type: "search",
      q: `${brandName} ${location}`.trim(),
      hl: "en",
    });
    const candidates = mapsResponse.local_results ?? [];
    const place =
      mapsResponse.place_results ??
      candidates.find((entry) => matchLocalPlace(entry, domain, brandName)) ??
      candidates[0];

    if (place) {
      const checks = buildProfileChecks(place);
      const passed = checks.filter((check) => check.ok).length;
      healthRow = {
        business_id: businessId,
        place_id: String(place.place_id ?? place.data_id ?? hostnameOf(String(place.website ?? ""))),
        label: String(place.title ?? brandName),
        score: Math.round((passed / checks.length) * 100),
        checks,
        reviews_count: Number(place.reviews ?? 0),
        average_rating: Number(place.rating ?? 0),
        address: String(place.address ?? ""),
        category: String(place.type ?? ""),
        website: String(place.website ?? ""),
        checked_at: checkedAt,
      };
      if (!String(healthRow.place_id)) healthRow = null;
    }
    const ourPlaceId = healthRow ? String(healthRow.place_id) : "";

    /* --------------------------------------------- organic rank + local 3-pack */
    const rankingRows: Record<string, unknown>[] = [];
    const packRows: Record<string, unknown>[] = [];

    for (const keyword of keywords) {
      for (const device of devices) {
        const response = await serpApi({
          engine: "google",
          q: keyword,
          location: location || undefined,
          device,
          num: 100,
          hl: "en",
        });

        const match = findOrganicResult(response.organic_results ?? [], domain, brandName);
        const prior = priorRankingByKey.get(`${keyword}|${device}|${location}`);
        rankingRows.push({
          business_id: businessId,
          keyword,
          device,
          location,
          position: match?.position ?? null,
          url: match ? String(match.link ?? "") : "",
          title: match ? String(match.title ?? "") : "",
          snippet_type: snippetTypeOf(match),
          is_rich_result: Boolean(match?.rich_snippet || match?.rich_snippet_table),
          previous_position: prior ? prior.position ?? null : null,
          previous_is_rich_result: prior ? prior.is_rich_result ?? null : null,
          previous_snippet_type: prior ? String(prior.snippet_type ?? "") : "",
          checked_at: checkedAt,
        });

        const pack = (response.local_results ?? []).slice(0, 3).map((entry, index) => ({
          position: Number(entry.position ?? index + 1),
          name: String(entry.title ?? ""),
          place_id: String(entry.place_id ?? entry.data_id ?? ""),
          rating: Number(entry.rating ?? 0),
          reviews: Number(entry.reviews ?? 0),
        }));

        if (pack.length) {
          const ours =
            pack.find((entry) => ourPlaceId && entry.place_id === ourPlaceId) ??
            pack.find((entry) => matchLocalPlace({ title: entry.name }, domain, brandName));
          const priorPack = priorPackByKey.get(`${keyword}|${location}`);
          packRows.push({
            business_id: businessId,
            keyword,
            location,
            in_pack: Boolean(ours),
            pack_position: ours?.position ?? null,
            place_id: ourPlaceId,
            pack,
            previous_in_pack: priorPack ? priorPack.in_pack ?? null : null,
            previous_pack_position: priorPack ? priorPack.pack_position ?? null : null,
            checked_at: checkedAt,
          });
        }
      }
    }

    /* ------------------------------------------------------------------ persist */
    if (rankingRows.length) {
      const { error } = await db
        .from("serp_rankings")
        .upsert(rankingRows, { onConflict: "business_id,keyword,device,location" });
      if (error) throw new HttpError(500, error.message);
    }

    if (packRows.length) {
      const { error } = await db
        .from("local_pack_rankings")
        .upsert(packRows, { onConflict: "business_id,keyword,location" });
      if (error) throw new HttpError(500, error.message);
    }

    if (healthRow) {
      const { error } = await db
        .from("local_profile_health")
        .upsert(healthRow, { onConflict: "business_id,place_id" });
      if (error) throw new HttpError(500, error.message);
    }

    /* ------------------------------------------------- search visibility scores */
    // Read back **every** desktop standing we hold, not just this run's: a run
    // trimmed by the monthly budget covers fewer keywords, and a score computed
    // from that slice would fall simply because less budget was left. Desktop is
    // the set the Search tab renders, so the headline and the table agree.
    const { data: standingRows } = await db
      .from("serp_rankings")
      .select("keyword, position, is_rich_result")
      .eq("business_id", businessId)
      .eq("device", "desktop");
    const summary = summariseRankings(
      standingsByKeyword((standingRows ?? []) as RankingRow[]),
    );

    // Nothing scanned yet — leave the row alone rather than overwriting an
    // onboarding figure with a blank one.
    if (summary.terms) {
      const { error } = await db
        .from("businesses")
        .update({
          previous_seo_score: business.seo_score ?? null,
          seo_score: summary.seoScore,
          previous_top10_count: business.top10_count ?? null,
          top10_count: summary.top10Count,
          ranked_count: summary.rankedCount,
          previous_avg_position: business.avg_position ?? null,
          // Null, not 0, when we appear for nothing: the card shows a dash, and a
          // stored zero would read as "position zero".
          avg_position: summary.avgPosition || null,
          rankings_checked_at: checkedAt,
        })
        .eq("id", businessId);
      if (error) throw new HttpError(500, error.message);
    }

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "seo",
      source_name: "Google search & local scan",
      status: "succeeded",
      changes_found: rankingRows.length + packRows.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google",
      units: keywords.length * devices.length,
      detail: `${keywords.length} keywords × ${devices.length} devices${capped ? " (monthly budget reached)" : ""}`,
    });
    if (healthRow) {
      await recordUsage(db, {
        businessId,
        provider: "serpapi",
        endpoint: "google_maps",
        units: 1,
        detail: "Business profile health",
      });
    }

    return json({
      keywords: keywords.length,
      rankings: rankingRows.length,
      packKeywords: packRows.length,
      placeId: ourPlaceId,
      /** The search visibility written onto the business row, for the caller. */
      search: {
        seoScore: summary.seoScore,
        top10Count: summary.top10Count,
        rankedCount: summary.rankedCount,
        avgPosition: summary.avgPosition,
        terms: summary.terms,
      },
      /** True when the monthly budget, not the tracked list, cut the run short. */
      capped,
    });
  } catch (error) {
    return failure(error);
  }
});
