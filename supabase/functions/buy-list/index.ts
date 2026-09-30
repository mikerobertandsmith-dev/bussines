import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { clampInt } from "../_shared/keywords.ts";
import {
  deriveRecommendations,
  productKey,
  type RecommendationKeyword,
  type RecommendationSource,
} from "../_shared/recommendations.ts";
import { getEnv } from "../_shared/env.ts";

/**
 * Builds the **buy list** from readings we already hold.
 *
 * `inventory_recommendations` is what the Buy list tab renders and nothing had ever
 * written it, so the tab was empty in every workspace with an empty state that read
 * like a failed scan. No provider is needed to fill it: `competitor_items` already
 * holds what each rival listed, at what price, and when — and a rival adding a
 * product to their shelf is the demand signal a buyer acts on.
 *
 * ## What it writes, and what it refuses to invent
 *
 * Every row names the rival it came from in `competitor_ref` and says why in
 * `reason`, so the claim is checkable. It writes the rival's **shelf price** as
 * `estimated_price`, because that is what we measured — not a cost. `margin_pct`
 * and `suggested_qty` are left null: we hold no cost or sales data, and a number
 * invented for those columns would be acted on as though it were a calculation.
 *
 * ## It never deletes, and never rewrites a row the user has acted on
 *
 * The user's star lives in `buy_list_items` pointing at a recommendation id, so
 * re-deriving over an existing row could throw away a decision. Products already
 * having a recommendation are skipped instead, which also makes a repeat run
 * cheap and idempotent.
 *
 * It costs nothing and calls no provider, so it records no `scan_runs` row and logs
 * no usage — a scan row for a read that never happened is the thing `scan_runs`
 * exists to prevent.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  /** How many suggestions one run may add. Defaults to 12. */
  limit?: number;
}

interface CompetitorRow {
  id: string;
  name: string;
}

interface ItemRow {
  competitor_id: string;
  product: string;
  price: number | string | null;
  detected_at: string | null;
  url: string | null;
}

/** The catalogue reading this may draw on. Beyond this the newest still win. */
const ITEM_SCAN_LIMIT = 600;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const db = adminClient();
    const limit = clampInt(body.limit ?? getEnv("BUY_LIST_LIMIT"), 1, 50, 12);

    const { data: competitorData, error: competitorError } = await db
      .from("competitors")
      .select("id, name")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);
    const competitors = (competitorData ?? []) as CompetitorRow[];
    const nameById = new Map(competitors.map((c) => [c.id, c.name]));

    if (!competitors.length) {
      return json({
        status: "unavailable",
        created: 0,
        considered: 0,
        reason:
          "No competitors yet. The buy list is built from what rivals put on their shelves — add one on Competition and run a catalogue scan first.",
      });
    }

    // Only what a rival *added*. A price move on something already stocked is not
    // a reason to start stocking it.
    const { data: itemData, error: itemError } = await db
      .from("competitor_items")
      .select("competitor_id, product, price, detected_at, url")
      .eq("business_id", businessId)
      .eq("change", "new_product")
      .order("detected_at", { ascending: false })
      .limit(ITEM_SCAN_LIMIT);
    if (itemError) throw new HttpError(500, itemError.message);
    const itemRows = (itemData ?? []) as ItemRow[];

    if (!itemRows.length) {
      return json({
        status: "done",
        created: 0,
        considered: 0,
        reason:
          "No new competitor products on file yet. The suggestions are built from what rivals have newly listed, so run a catalogue scan on Competition first.",
      });
    }

    const { data: keywordData, error: keywordError } = await db
      .from("my_keywords")
      .select("keyword, volume")
      .eq("business_id", businessId);
    if (keywordError) throw new HttpError(500, keywordError.message);
    const keywords: RecommendationKeyword[] = (keywordData ?? []).map((row) => ({
      keyword: String(row.keyword ?? ""),
      volume: Number(row.volume ?? 0),
    }));

    // Everything already recommended, so a repeat run adds only what is new.
    const { data: existingData, error: existingError } = await db
      .from("inventory_recommendations")
      .select("product")
      .eq("business_id", businessId);
    if (existingError) throw new HttpError(500, existingError.message);
    const existing = new Set((existingData ?? []).map((row) => productKey(String(row.product ?? ""))));

    const items: RecommendationSource[] = itemRows.map((row) => ({
      competitor: nameById.get(row.competitor_id) ?? "A competitor",
      product: String(row.product ?? ""),
      price: Number(row.price ?? 0),
      detectedAt: row.detected_at ?? new Date().toISOString(),
      url: String(row.url ?? ""),
    }));

    const derived = deriveRecommendations({ items, keywords, existing, limit });

    if (!derived.length) {
      return json({
        status: "done",
        created: 0,
        considered: items.length,
        reason:
          "Nothing new to suggest — every product the tracked rivals listed is already on the buy list.",
      });
    }

    const { error: insertError } = await db.from("inventory_recommendations").insert(
      derived.map((recommendation) => ({
        business_id: businessId,
        product: recommendation.product,
        category: recommendation.category,
        estimated_price: recommendation.estimatedPrice,
        traffic_potential: recommendation.trafficPotential,
        reason: recommendation.reason,
        priority: recommendation.priority,
        competitor_ref: recommendation.competitorRef,
      })),
    );
    if (insertError) throw new HttpError(500, insertError.message);

    return json({
      status: "done",
      created: derived.length,
      considered: items.length,
      /** True when `limit`, not the catalogue, cut the list short. */
      capped: derived.length >= limit,
      /** Suggestions already on file — what a repeat run skips. */
      alreadyOnFile: existing.size,
      samples: derived.slice(0, 3).map((row) => ({ product: row.product, reason: row.reason })),
      message: `${derived.length} suggestion${derived.length === 1 ? "" : "s"} from ${competitors.length} tracked rival${competitors.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return failure(error);
  }
});
