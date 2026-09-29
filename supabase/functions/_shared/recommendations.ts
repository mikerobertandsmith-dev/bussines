import { decodeEntities } from "./site.ts";

/**
 * Turning the competitor catalogue we already read into a **buy list**.
 *
 * `inventory_recommendations` is the table the Buy list tab renders, and it had no
 * writer at all: the tab was empty for every workspace, with an empty state that
 * read like a broken scan. Nothing needs to be bought from a provider to fill it —
 * `competitor_items` already holds what each rival listed and when, and a rival
 * adding a product is the demand signal a buyer acts on.
 *
 * ## What each row claims, and what it does not
 *
 * This is deliberately **inference from a rival's shelf**, not a demand forecast
 * and not a supplier quote. So:
 *
 *   - `competitor_ref` says whose shelf it came from, always.
 *   - `reason` names that rival and the date, so the claim is checkable.
 *   - `estimated_price` is the rival's own price, which is what we know — not a
 *     wholesale cost. `margin_pct` and `suggested_qty` are left null rather than
 *     guessed, because we hold no sales or cost data to base them on.
 *   - `priority` is `high` only on two overlapping signals: more than one rival
 *     stocking the same thing, or a tracked search term matching the product name.
 *     A single rival listing one item is `medium` at most, because one listing is
 *     weak evidence and a buy list that cries wolf is ignored.
 */

/** One candidate, as the caller read it out of the competitor catalogue. */
export interface RecommendationSource {
  competitor: string;
  product: string;
  price: number;
  detectedAt: string;
  url: string;
}

/** A tracked search term, with the volume the last keyword scan stored. */
export interface RecommendationKeyword {
  keyword: string;
  volume: number;
}

/** One row of `inventory_recommendations`, ready to insert. */
export interface DerivedRecommendation {
  product: string;
  /** The rival whose shelf it came from. */
  category: string;
  competitorRef: string;
  estimatedPrice: number | null;
  trafficPotential: number;
  priority: "high" | "medium" | "low";
  reason: string;
}

/**
 * Gift cards are catalogued like products by every storefront and can never be
 * stocked, so they are dropped rather than listed as something to buy.
 */
const NOT_STOCKABLE = /gift\s*(card|certificate|voucher)|e-?gift|digital download/i;

/** Words too common to be evidence of a match between a term and a product name. */
const STOP_WORDS = new Set([
  "the", "and", "for", "with", "a", "an", "of", "in", "to", "on", "by",
  "men", "mens", "women", "womens", "unisex", "kids", "new",
]);

/** Words in a name, lowercased, entities decoded, punctuation dropped. */
export function nameWords(value: string): string[] {
  return decodeEntities(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** A product name reduced to a comparable key. */
export function productKey(value: string): string {
  return nameWords(value).join(" ");
}

/** How many days old a reading is, from an ISO timestamp or date. */
function ageInDays(value: string, now: number): number {
  const at = Date.parse(value);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : (now - at) / 86_400_000;
}

/** `2026-09-29` → `29 Sep`, so a reason reads like a sentence. */
function shortDate(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * The tracked term a product name answers, if any.
 *
 * Matched on the term's *meaningful* words all appearing in the name — so
 * "fleece jacket" matches "Fleece Jacket - Men's" but not "Jacket" alone, and a
 * single shared word like "jacket" is not enough to claim the term's volume.
 */
export function matchingKeyword(
  words: string[],
  keywords: RecommendationKeyword[],
): RecommendationKeyword | null {
  const present = new Set(words);
  let best: RecommendationKeyword | null = null;
  for (const keyword of keywords) {
    const needed = nameWords(keyword.keyword).filter((word) => !STOP_WORDS.has(word));
    if (needed.length < 2) continue;
    if (!needed.every((word) => present.has(word))) continue;
    if (!best || keyword.volume > best.volume) best = keyword;
  }
  return best;
}

/**
 * Derives the buy list from readings we already hold.
 *
 * `existing` is every product key the workspace already has a recommendation for,
 * so re-running this never duplicates a row — and, because the user's star lives on
 * `buy_list_items` pointing at the recommendation id, a row that already exists is
 * never rewritten out from under a decision they have made about it.
 */
export function deriveRecommendations(input: {
  items: readonly RecommendationSource[];
  keywords: readonly RecommendationKeyword[];
  existing: ReadonlySet<string>;
  limit: number;
  /** Injectable for a stable test; defaults to now. */
  now?: number;
}): DerivedRecommendation[] {
  const now = input.now ?? Date.now();

  // How many *distinct* rivals listed each product: the one signal here that is
  // about the market rather than about a single shelf.
  const rivalsByKey = new Map<string, Set<string>>();
  for (const item of input.items) {
    const key = productKey(item.product);
    if (!key) continue;
    const rivals = rivalsByKey.get(key) ?? new Set<string>();
    rivals.add(item.competitor);
    rivalsByKey.set(key, rivals);
  }

  const candidates: { recommendation: DerivedRecommendation; rank: number; age: number }[] = [];
  const seen = new Set<string>();

  for (const item of input.items) {
    const key = productKey(item.product);
    if (!key || input.existing.has(key) || seen.has(key)) continue;
    if (NOT_STOCKABLE.test(item.product)) continue;
    seen.add(key);

    const product = decodeEntities(item.product).trim();
    const rivals = [...(rivalsByKey.get(key) ?? new Set<string>())];
    const keyword = matchingKeyword(nameWords(item.product), [...input.keywords]);
    const crowded = rivals.length > 1;
    const age = ageInDays(item.detectedAt, now);
    const fresh = age <= 7;

    const priority: DerivedRecommendation["priority"] = crowded || keyword ? "high" : fresh ? "medium" : "low";

    const signals: string[] = [];
    signals.push(
      crowded
        ? `${rivals.length} rivals stock it (${rivals.slice(0, 3).join(", ")})`
        : `${item.competitor} listed it`,
    );
    if (fresh) signals.push(`first seen ${shortDate(item.detectedAt)}`);
    if (keyword) {
      // The volume is only quoted when something measured one. A tracked term with
      // a stored 0 — every hand-added term, since nothing reads volumes for them —
      // would otherwise be presented as a measured "0 searches a month".
      signals.push(
        keyword.volume > 0
          ? `answers your tracked term "${keyword.keyword}" (${keyword.volume.toLocaleString()}/mo)`
          : `answers your tracked term "${keyword.keyword}"`,
      );
    }

    candidates.push({
      recommendation: {
        product,
        category: item.competitor,
        competitorRef: item.competitor,
        // The rival's own shelf price is what we hold. It is not a cost, and the
        // column is read as an estimate.
        estimatedPrice: item.price > 0 ? Math.round(item.price * 100) / 100 : null,
        trafficPotential: keyword?.volume ?? 0,
        priority,
        reason: signals.join(" · "),
      },
      // Order: strongest evidence first, then the biggest term, then the newest.
      rank: (crowded ? 2 : 0) + (keyword ? 2 : 0) + (fresh ? 1 : 0),
      age,
    });
  }

  return candidates
    .sort((a, b) => b.rank - a.rank || b.recommendation.trafficPotential - a.recommendation.trafficPotential || a.age - b.age)
    .slice(0, Math.max(0, input.limit))
    .map((candidate) => candidate.recommendation);
}
