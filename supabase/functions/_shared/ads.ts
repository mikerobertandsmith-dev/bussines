import { getEnv } from "./env.ts";
import { toIsoTimestamp } from "./apify.ts";

/**
 * Competitor advertising, read from Meta's Ad Library through Apify.
 *
 * This is the producer behind *Active ad campaigns* on Competition — the tile
 * that counted `competitor_ads` rows, of which there were none, because nothing
 * had ever read the library.
 *
 * ## Why a saved page is required, and why the search modes are not used
 *
 * The library will happily answer a free-text search, and the answer is not the
 * advertiser you asked for. Measured against this deployment: a search for
 * *Patagonia* returned Mapu Lahual Chile, Rue La La, On Water Expeditions and
 * MRCOOL, and the same result set came back with `search_type=page`. Attributing
 * those to a competitor would put another company's campaigns on their profile
 * and into their alerts, which is worse than showing nothing.
 *
 * So an ad is only ever stored against a competitor whose Facebook page is
 * **known** — a handle saved on Competition → Social presence — because that is
 * the one thing the library resolves exactly. The name is still checked against
 * the ad's own advertiser as a final guard, but the page is what makes the
 * attribution truthful. Competitors without one are reported, not guessed at.
 */

/** How the ad library is addressed for one advertiser. */
export interface AdTarget {
  /** The Facebook handle saved for the competitor, without a leading @. */
  handle: string;
}

/** One ad, mapped onto our `competitor_ads` columns. */
export interface ScrapedAd {
  externalId: string;
  /** The platform the ad ran on, as the app labels platforms. */
  platform: string;
  headline: string;
  audience: string;
  focus: string;
  bannerUrl: string;
  landingUrl: string;
  status: "active" | "paused";
  firstSeenAt: string | null;
  /** The advertiser's page name, as the library reports it. */
  advertiser: string;
  /** The advertiser's page handle, from its profile URL. */
  advertiserHandle: string;
}

/**
 * The actor id, as a **bare id** rather than an `owner/name` slug — `startRun`
 * puts it straight into `/v2/actors/{id}/runs`, where an encoded slug is not a
 * valid actor reference. Empty means the deployment has not opted in.
 */
export function adsActorId(): string {
  return getEnv("APIFY_ADS_ACTOR_ID") || "";
}

/** The ceiling for one ad-library run, in dollars. */
export function adsMaxChargeUsd(): number {
  const configured = Number(getEnv("APIFY_ADS_MAX_CHARGE_USD"));
  return Number.isFinite(configured) && configured > 0 ? configured : 0.50;
}

/** How many ads to read per advertiser, so one prolific page cannot run away. */
export function adsResultsLimit(): number {
  const configured = Number(getEnv("APIFY_ADS_RESULTS_LIMIT"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(200, configured) : 30;
}

/** How many advertisers one run may cover. */
export function adsMaxTargets(): number {
  const configured = Number(getEnv("APIFY_ADS_MAX_TARGETS"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(25, configured) : 10;
}

/**
 * The Ad Library URL for one advertiser's own page.
 *
 * Pointing the actor at the page URL (rather than a search) is what makes the
 * result set exactly that advertiser's ads. `active_status=all` on purpose: an ad
 * that has just been switched off is a signal — the tile counts the active ones,
 * and the row that turned paused is what says the campaign ended.
 */
export function adLibraryUrlFor(handle: string): string {
  const clean = handle.trim().replace(/^@/, "").replace(/\/+$/, "");
  return `https://www.facebook.com/${clean}/`;
}

/** Case- and punctuation-insensitive, so "Patagonia, Inc." matches "patagonia inc". */
export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The handle in a Facebook profile URL: `https://www.facebook.com/patagonia/` →
 * `patagonia`. Query strings and the `people/…` form are handled too.
 */
export function handleFromProfileUrl(url: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  const withoutQuery = trimmed.split("?")[0].replace(/\/+$/, "");
  const segments = withoutQuery.split("/").filter(Boolean);
  const last = segments.at(-1) ?? "";
  if (last.toLowerCase() === "people" || last.toLowerCase() === "profile.php") return "";
  // Facebook page URLs may carry an id after the name ("/patagonia-12345"); the
  // name is the part that identifies the advertiser.
  return last.replace(/-\d+$/, "");
}

/**
 * True when an ad's advertiser is the advertiser we asked about.
 *
 * Exact on the normalised name, or on the handle. Deliberately not "contains":
 * *Helados Patagonia* and *Patagonia* share a word, and exactly that near-miss is
 * what the raw search returned for this deployment's own competitor list.
 */
export function advertiserMatches(target: AdTarget, ad: ScrapedAd, competitorName: string): boolean {
  const wanted = normaliseName(competitorName);
  const handle = normaliseName(target.handle);
  if (wanted && normaliseName(ad.advertiser) === wanted) return true;
  if (handle && normaliseName(ad.advertiserHandle) === handle) return true;
  return false;
}

/** First non-empty string, or "" — the library's keys drift between builds. */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** The first image URL in a `snapshot.images` array, which may be objects or strings. */
function firstImage(value: unknown): string {
  if (!Array.isArray(value)) return typeof value === "string" ? value : "";
  for (const entry of value) {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      const image = entry as Record<string, unknown>;
      const url = firstString(
        image.originalImageUrl,
        image.original_image_url,
        image.resizedImageUrl,
        image.url,
        image.videoPreviewImageUrl,
        image.video_preview_image_url,
      );
      if (url) return url;
    }
  }
  return "";
}

/**
 * The platforms an ad ran on, as the app labels them.
 *
 * The library reports these upper-cased and in pages' own vocabulary
 * (`["FACEBOOK", "INSTAGRAM"]`), while `competitor_ads.platform` holds labels the
 * UI prints directly. An ad that ran on both is a Meta ad; one that only ran on
 * Instagram is an Instagram ad, and saying "Meta" for it would overstate where it
 * appeared.
 */
export function platformLabel(publisherPlatform: unknown): string {
  const list = (Array.isArray(publisherPlatform) ? publisherPlatform : [publisherPlatform])
    .map((entry) => String(entry ?? "").toLowerCase())
    .filter(Boolean);
  if (list.includes("instagram") && !list.includes("facebook")) return "Instagram Ads";
  return "Meta Ads";
}

/**
 * Where the ad was aimed, as far as the library discloses.
 *
 * Meta publishes the countries an ad reached (and, for EU/UK ads, a small amount
 * more); it does not publish interests, ages or lookalikes. So this is a country
 * list, and it is left empty rather than invented when the library says nothing —
 * the panels treat an empty audience as "not disclosed" instead of printing a
 * claim nothing measured.
 */
export function audienceLabel(countries: unknown): string {
  const codes = (Array.isArray(countries) ? countries : [])
    .map((entry) => (typeof entry === "string" ? entry.trim().toUpperCase() : ""))
    .filter((code) => /^[A-Z]{2}$/.test(code));
  if (!codes.length) return "";
  return `Reached in ${[...new Set(codes)].join(", ")}`;
}

/** One dataset item → an ad, or null when it has no usable identity. */
export function normaliseAd(item: Record<string, unknown>): ScrapedAd | null {
  if (!item || typeof item !== "object") return null;
  const snapshot = (item.snapshot ?? {}) as Record<string, unknown>;
  const body = (snapshot.body ?? {}) as Record<string, unknown>;

  const externalId = firstString(item.adArchiveID, item.adArchiveId, item.adId, item.adId);
  if (!externalId) return null;

  const advertiser = firstString(snapshot.pageName, item.pageName);
  const headline = firstString(
    snapshot.title,
    typeof snapshot.body === "string" ? snapshot.body : "",
    body.text,
    snapshot.caption,
  );
  if (!headline && !advertiser) return null;

  return {
    externalId,
    platform: platformLabel(item.publisherPlatform),
    headline: headline.slice(0, 300),
    audience: audienceLabel(snapshot.targetedOrReachedCountries ?? item.targetedOrReachedCountries),
    // The call to action is the closest thing the library discloses to the
    // creative's angle ("Shop now", "Sign up"), so it is what `focus` holds.
    focus: firstString(snapshot.ctaText),
    bannerUrl: firstImage(snapshot.images) || firstImage(snapshot.videos) || firstImage(snapshot.extraImages),
    landingUrl: firstString(snapshot.linkUrl, snapshot.caption),
    // The library reports ads as running or not; there is no third state, and the
    // enum on our side has none either.
    status: item.isActive === true || item.isActive === "true" ? "active" : "paused",
    firstSeenAt: toIsoTimestamp(item.startDateFormatted ?? item.startDate),
    advertiser,
    advertiserHandle: handleFromProfileUrl(firstString(snapshot.pageProfileUri)),
  };
}

/** A whole dataset, dropping unusable items and duplicates. */
export function normaliseAds(items: Record<string, unknown>[]): ScrapedAd[] {
  const byId = new Map<string, ScrapedAd>();
  for (const item of items) {
    const ad = normaliseAd(item);
    if (ad) byId.set(ad.externalId, ad);
  }
  return [...byId.values()];
}
