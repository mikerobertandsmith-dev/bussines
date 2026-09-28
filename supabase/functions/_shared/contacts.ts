import { getEnv } from "./env.ts";
import { SOCIAL_PLATFORMS } from "./apify.ts";

/**
 * Apify "Website Contacts Scraper" client — reads a competitor's **own website**
 * and proposes the social profiles it mentions.
 *
 * Separate from `_shared/apify.ts`: that one is pointed at a profile and returns
 * posts, this one is pointed at a website and returns profiles. The transport
 * (start/wait/dataset) is imported from there rather than reimplemented, so the
 * codebase keeps one run/retry/charge path.
 *
 * Everything below was read off the actor's live API and confirmed by a real run
 * whose dataset item is saved as `tests/fixtures/contacts-item.json`, in the same
 * spirit as the field aliases fixed for G2, Capterra, Yelp and X after live smoke
 * tests: an unverified key is worse than a missing feature, because a run that
 * returns nothing is still charged.
 *
 * Actor: `vdrmota/contact-info-scraper` (`9Sk4JJhEma9vBKqrg`), `PAY_PER_EVENT`.
 * See docs/SOURCE_MANAGEMENT_BLUEPRINT.md (Phase 0, Appendix B).
 */

/** The actor's own floor: it rejects a run below this with `max-total-charge-usd-below-minimum`. */
export const CONTACTS_MIN_CHARGE_USD = 0.5;

/**
 * The configured actor id, or "" when this deployment has none.
 *
 * An empty id means "not configured" and the whole feature reports itself
 * unavailable — it is never guessed at, the way an empty per-platform social
 * actor id is not guessed at either. The id is configuration, not a constant, so
 * swapping actors is a secret change rather than a release.
 */
export function contactsActorId(): string {
  return getEnv("APIFY_CONTACTS_ACTOR_ID") ?? "";
}

/** A positive number from the environment, or the fallback. */
function positiveEnv(key: string, fallback: number): number {
  const value = Number(getEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function boolEnv(key: string, fallback = false): boolean {
  const raw = getEnv(key);
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

/** What one discovery run is allowed to cost and how far it may crawl. */
export interface ContactsCaps {
  /** Hard page ceiling, sent as the actor's own `maxRequests`. */
  maxPages: number;
  /**
   * Ceiling for this run, in dollars. Never below the actor's own minimum, which
   * is why it is its own setting and not the shared `APIFY_MAX_CHARGE_USD` — that
   * one defaults to $0.25 and Apify refuses this actor outright below $0.50.
   */
  maxChargeUsd: number;
  /** Links away from the start URL. 1 = the home page plus one hop. */
  maxDepth: number;
  /** Apify's own kill switch for the run, in seconds. */
  timeoutSecs: number;
  /** Pull follower counts etc. per profile. Off: it bills each profile separately. */
  enrichProfiles: boolean;
}

/**
 * A number from the environment where 0 is a meaningful value, or the fallback.
 * `positiveEnv` cannot express "off", and for the reuse window 0 means exactly
 * that: never reuse a previous read, always pay for a fresh one.
 */
function nonNegativeEnv(key: string, fallback: number): number {
  const raw = getEnv(key);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * How many preview runs one signed-in user may start per hour.
 *
 * Preview mode is the one path with no tenant to bill against (see
 * `docs/SOURCE_MANAGEMENT_BLUEPRINT.md` Phase 3, decision 2), so a count per
 * user is what stands between it and a scripted loop. Every run is now also
 * recorded in `contacts_discovery_runs`, so whatever it spends is at least
 * attributable — and counted again against the workspace once one exists.
 */
export function contactsPreviewCapPerHour(): number {
  return Math.round(positiveEnv("APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR", 10));
}

/**
 * How long a finished read is reused rather than repeated.
 *
 * This is the idempotency window for a *user* action, not a cadence: pressing
 * "Find socials from their site" twice is far more likely to be a double-click
 * than a request for a second, identical read, and each read bills the same
 * pages again. Default 2 minutes; set it to `0` for no reuse at all.
 */
export function contactsReuseWindowMinutes(): number {
  return nonNegativeEnv("APIFY_CONTACTS_REUSE_WINDOW_MINUTES", 2);
}

/** The refusal when a user has spent their hourly preview allowance. */
export function previewQuotaMessage(used: number, cap: number): string {
  return (
    `You have started ${used} website reads in the last hour, which is the limit (${cap}). ` +
    `Each one is a paid scrape. Finish setting up your workspace — reads there are counted ` +
    `against its own monthly budget — or try again in an hour.`
  );
}

/**
 * Whether a finished read is recent enough to replay instead of paying for the
 * same pages a second time. A window of 0 means never reuse.
 */
export function reusableWithin(
  scannedAt: string | null | undefined,
  windowMinutes: number,
  now = Date.now(),
): boolean {
  if (windowMinutes <= 0 || !scannedAt) return false;
  const at = new Date(scannedAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at < windowMinutes * 60_000;
}

export function contactsCaps(): ContactsCaps {
  return {
    maxPages: Math.round(positiveEnv("APIFY_CONTACTS_MAX_PAGES", 5)),
    // Floored, not just defaulted: a ceiling below the actor's minimum is not a
    // tighter cap, it is a run that never starts.
    maxChargeUsd: Math.max(
      CONTACTS_MIN_CHARGE_USD,
      positiveEnv("APIFY_CONTACTS_MAX_CHARGE_USD", CONTACTS_MIN_CHARGE_USD),
    ),
    maxDepth: Math.round(positiveEnv("APIFY_CONTACTS_MAX_DEPTH", 1)),
    timeoutSecs: Math.round(positiveEnv("APIFY_CONTACTS_RUN_TIMEOUT_SECS", 120)),
    enrichProfiles: boolEnv("APIFY_CONTACTS_ENRICH_PROFILES"),
  };
}

/**
 * The website to read, as a bare `https://host`, or "" when it cannot be read as
 * one. The server twin of `normaliseWebsite` in `src/lib/format.ts` (the gateway
 * cannot import from `src/`), so a URL reaches the actor in the same shape the
 * app stored it.
 */
export function scrapeUrl(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.hostname ? `${url.protocol}//${url.host}` : "";
  } catch {
    return "";
  }
}

/**
 * The actor input for one website.
 *
 * Every key was read off the actor's live `inputSchema`. `proxyConfig` and
 * `startUrls` are the only required ones, and the paid extras stay off:
 * `useBrowser` (+$0.003/page) and a residential proxy (+$0.002/page) bill every
 * page twice, and neither is needed to read a footer. `maximumLeadsEnrichmentRecords`
 * is pinned at 0 — lead enrichment returns employees' names, emails and mobile
 * numbers, and that personal data is neither wanted nor stored.
 */
export function contactsInputFor(url: string, caps: ContactsCaps): Record<string, unknown> {
  return {
    startUrls: [{ url }],
    proxyConfig: { useApifyProxy: true },
    // The real cost guard. This actor bills per event, so `maxItems` does not
    // bound it; the page ceiling and the dollar cap are what do.
    maxRequests: caps.maxPages,
    maxRequestsPerStartUrl: caps.maxPages,
    maxDepth: caps.maxDepth,
    sameDomain: true,
    // One result row per start URL, rather than one per page crawled.
    mergeContacts: true,
    useBrowser: false,
    maximumLeadsEnrichmentRecords: 0,
    scrapeSocialMediaProfiles: {
      facebooks: caps.enrichProfiles,
      instagrams: caps.enrichProfiles,
      youtubes: caps.enrichProfiles,
      tiktoks: caps.enrichProfiles,
      twitters: caps.enrichProfiles,
    },
  };
}

/* -------------------------------------------------------------- normalising */

/** One profile the actor reported, on our own platform keys. */
export interface ContactSuggestion {
  platform: string;
  handle: string;
  url: string;
  monitorable: boolean;
}

export interface ContactReview {
  /** Every profile found, including the ones we cannot monitor. */
  suggestions: ContactSuggestion[];
  /** Display labels for those we have no scraper for — shown, never written. */
  unmonitored: string[];
}

/**
 * The actor's plural array fields, mapped onto our platform keys.
 *
 * The arrays hold URLs, so the work here is handle extraction rather than field
 * guessing — but two field names still matter: X's is `twitters` (not `x` or
 * `twitter`), and LinkedIn's is `linkedIns` with a capital I. Either would
 * otherwise silently produce nothing while the run was still charged.
 *
 * A key that is not in the gateway's `SOCIAL_PLATFORMS` catalogue is one we have
 * no actor for: listed at the end, reported as "found, not monitored", and never
 * written, rather than stored as a row no scan could ever fill.
 */
const ACTOR_FIELDS: { field: string; platform: string; label: string }[] = [
  { field: "instagrams", platform: "instagram", label: "Instagram" },
  { field: "tiktoks", platform: "tiktok", label: "TikTok" },
  { field: "facebooks", platform: "facebook", label: "Facebook" },
  { field: "twitters", platform: "x", label: "X" },
  { field: "youtubes", platform: "youtube", label: "YouTube" },
  { field: "linkedIns", platform: "linkedin", label: "LinkedIn" },
  { field: "threads", platform: "threads", label: "Threads" },
  { field: "snapchats", platform: "snapchat", label: "Snapchat" },
  { field: "telegrams", platform: "telegram", label: "Telegram" },
  { field: "reddits", platform: "reddit", label: "Reddit" },
  { field: "discords", platform: "discord", label: "Discord" },
  { field: "pinterests", platform: "pinterest", label: "Pinterest" },
  { field: "whatsapps", platform: "whatsapp", label: "WhatsApp" },
];

/**
 * Path segments that sit in front of the real handle, so `youtube.com/user/gearfork`
 * and `linkedin.com/company/acme` resolve to `gearfork` and `acme`.
 */
const PATH_PREFIXES = new Set([
  "user",
  "channel",
  "c",
  "company",
  "school",
  "in",
  "watch",
  "video",
  "v",
  "pages",
  "share",
  "add",
  "profile.php",
]);

/** An array of URL strings from an actor item, ignoring anything else. */
function urlList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

/**
 * The bare handle in a profile URL: `https://www.instagram.com/brand/` → `brand`,
 * `https://www.tiktok.com/@brand` → `brand`.
 *
 * Returns "" for anything that is not one profile — a relative path, a domain
 * with no profile on it, a `mailto:`. A domain is the important case: storing
 * "instagram.com" as a handle would build a profile URL around it and scrape
 * nothing while still being billed.
 */
export function profileHandle(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw || raw.startsWith("/") || raw.startsWith("#")) return "";

  // No scheme, no path: a bare handle, or a domain masquerading as one.
  if (!raw.includes("/") && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const bare = raw.replace(/^@/, "").trim();
    // A username is letters, digits, dots, dashes and underscores. Anything else
    // is prose that happened to land in the field, not a profile.
    if (!/^[A-Za-z0-9._-]+$/.test(bare)) return "";
    return /^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(bare) ? "" : bare;
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";

  const segments = url.pathname.split("/").filter(Boolean);
  if (!segments.length) return "";

  const candidate =
    segments.length > 1 && PATH_PREFIXES.has(segments[0].toLowerCase()) ? segments[1] : segments[0];
  const handle = candidate.replace(/^@/, "").trim();
  return handle;
}

/**
 * One dataset item → the profiles worth proposing.
 *
 * Emails, phones and `leadsEnrichment` are dropped on the floor here, deliberately:
 * lead enrichment is personal data under GDPR and is switched off in the input as
 * well, so this is the second half of the same boundary rather than a duplicate
 * guard.
 */
export function normaliseContacts(item: Record<string, unknown>): ContactReview {
  const suggestions: ContactSuggestion[] = [];
  const unmonitored: string[] = [];
  const seen = new Set<string>();

  for (const entry of ACTOR_FIELDS) {
    for (const url of urlList(item[entry.field])) {
      const handle = profileHandle(url);
      if (!handle) continue;

      // `monitorable` is decided by the gateway's own platform catalogue rather
      // than by this table: a platform with no actor is evidence, not a target.
      const monitorable = Object.prototype.hasOwnProperty.call(
        SOCIAL_PLATFORMS,
        entry.platform,
      );

      const key = `${entry.platform}|${handle.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      suggestions.push({ platform: entry.platform, handle, url, monitorable });
      if (!monitorable && !unmonitored.includes(entry.label)) unmonitored.push(entry.label);
    }
  }

  return { suggestions, unmonitored };
}

/**
 * A whole dataset — one item per start URL with `mergeContacts` on, but folded
 * the same way if the actor ever returns several.
 */
export function reviewContacts(items: Record<string, unknown>[]): ContactReview {
  const suggestions: ContactSuggestion[] = [];
  const unmonitored: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const review = normaliseContacts(item);
    for (const suggestion of review.suggestions) {
      const key = `${suggestion.platform}|${suggestion.handle.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(suggestion);
    }
    for (const label of review.unmonitored) {
      if (!unmonitored.includes(label)) unmonitored.push(label);
    }
  }

  return { suggestions, unmonitored };
}
