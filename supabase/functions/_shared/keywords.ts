import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Shared keyword resolution for the SerpApi gateway functions.
 *
 * Both `serp-scan` and `serp-competitors` scan the same tracked term set, so the
 * selection logic lives here rather than being duplicated per function.
 */

/** Hard cap per run — SerpApi's free tier is 250 searches a month. */
export const MAX_KEYWORDS = 25;
/** What a "Scan now" with no explicit list falls back to. */
export const DEFAULT_KEYWORDS = 5;

/** Rounds a numeric input into `[min, max]`, falling back when unparseable. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** Trims, drops blanks and removes duplicates while preserving order. */
export function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

/**
 * Keywords to scan: the request's explicit list, else our tracked SEO terms,
 * else the competitor terms we monitor. Tracked terms are what a gap is measured
 * against, so ranking for them is still the right signal when we have none.
 */
export async function resolveKeywords(
  db: SupabaseClient,
  businessId: string,
  requested: string[] | undefined,
): Promise<string[]> {
  const explicit = unique(requested ?? []);
  if (explicit.length) return explicit.slice(0, MAX_KEYWORDS);

  const { data: mine } = await db
    .from("my_keywords")
    .select("keyword")
    .eq("business_id", businessId)
    .eq("kind", "seo")
    .limit(MAX_KEYWORDS);
  const fromMine = unique((mine ?? []).map((r) => String(r.keyword ?? "")));
  if (fromMine.length) return fromMine.slice(0, MAX_KEYWORDS);

  const { data: theirs } = await db
    .from("competitor_keywords")
    .select("keyword")
    .eq("business_id", businessId)
    .limit(MAX_KEYWORDS);
  return unique((theirs ?? []).map((r) => String(r.keyword ?? ""))).slice(0, MAX_KEYWORDS);
}
