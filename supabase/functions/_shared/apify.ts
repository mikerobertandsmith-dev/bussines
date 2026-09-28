import { getEnv } from "./env.ts";
import { fetchJson } from "./http.ts";
import { HttpError } from "./errors.ts";

/**
 * Apify client for competitor social monitoring.
 *
 * Only *public* competitor posts are pulled, and they are stored as a market
 * signal — captions, metrics, media URLs — never republished as creative. See
 * docs/API_INTEGRATION_BLUEPRINT.md (Phase 2).
 *
 * Contract used here (checked against the Apify API reference before writing):
 *   POST /v2/actors/{actorId}/runs?maxItems&maxTotalChargeUsd&timeout  (body = input)
 *   GET  /v2/actor-runs/{runId}?waitForFinish=60
 *   GET  /v2/datasets/{datasetId}/items?clean=true&limit=N
 * Auth is `Authorization: Bearer $APIFY_TOKEN` so the token never lands in a URL.
 * Async runs are capped at 300s by Apify, so we wait in bounded windows and
 * report a run that is still going instead of blocking the function forever.
 */
const APIFY_BASE = "https://api.apify.com/v2";

/** Platforms we can address, and the actor + profile URL each one needs. */
export type SocialPlatform = "instagram" | "tiktok" | "facebook" | "x";

interface PlatformConfig {
  label: string;
  /** Environment variable holding the actor id. */
  envKey: string;
  /** Used when the env var is empty — only for an actor whose input we know. */
  defaultActorId?: string;
  /** The public profile URL an actor can be pointed at. */
  profileUrl: (handle: string) => string;
}

const clean = (handle: string) => handle.trim().replace(/^@/, "");

export const SOCIAL_PLATFORMS: Record<SocialPlatform, PlatformConfig> = {
  instagram: {
    label: "Instagram",
    envKey: "APIFY_INSTAGRAM_ACTOR_ID",
    defaultActorId: "apify/instagram-scraper",
    profileUrl: (handle) => `https://www.instagram.com/${clean(handle)}/`,
  },
  tiktok: {
    label: "TikTok",
    envKey: "APIFY_TIKTOK_ACTOR_ID",
    profileUrl: (handle) => `https://www.tiktok.com/@${clean(handle)}`,
  },
  facebook: {
    label: "Facebook",
    envKey: "APIFY_FACEBOOK_ACTOR_ID",
    profileUrl: (handle) => `https://www.facebook.com/${clean(handle)}/`,
  },
  x: {
    label: "X",
    envKey: "APIFY_X_ACTOR_ID",
    profileUrl: (handle) => `https://x.com/${clean(handle)}`,
  },
};

/** Maps a `competitor_social.platform` label onto a platform we support. */
export function platformOf(value: string): SocialPlatform | null {
  const normalised = value.trim().toLowerCase();
  if (normalised.startsWith("instagram")) return "instagram";
  if (normalised.startsWith("tiktok")) return "tiktok";
  if (normalised.startsWith("facebook")) return "facebook";
  if (normalised === "x" || normalised.startsWith("x ") || normalised.startsWith("twitter")) {
    return "x";
  }
  return null;
}

/**
 * The actor id for a platform: the configured one, else the built-in default
 * (Instagram). Empty string means "not configured on this deployment", and the
 * platform is skipped rather than guessed at.
 */
export function actorFor(platform: SocialPlatform): string {
  const config = SOCIAL_PLATFORMS[platform];
  return getEnv(config.envKey) || config.defaultActorId || "";
}

export function isPlatformConfigured(platform: SocialPlatform): boolean {
  return actorFor(platform).length > 0;
}

/**
 * Actor input, per platform.
 *
 * Each platform is scraped by a different community actor with its own input
 * schema, so every shape below was read off that actor's live schema
 * (`GET /v2/acts/{owner}~{name}/builds/default` → `inputSchema`) rather than
 * guessed. An unrecognised key is not harmless: the actor either refuses to
 * start (because the field it *does* require is missing) or ignores the key and
 * returns nothing — and a run that returns nothing is still charged.
 *
 *   instagram → apify/instagram-scraper       directUrls + resultsLimit
 *   facebook  → apify/facebook-posts-scraper  startUrls (required) + resultsLimit
 *   tiktok    → clockworks/tiktok-scraper     profiles + resultsPerPage
 *   x         → apidojo/tweet-scraper         twitterHandles + maxItems
 *
 * `handle` is the public handle the workspace stored, which is what the
 * username-addressed actors want; the URL-addressed actors get the profile URL
 * derived from it.
 */
export function inputFor(
  platform: SocialPlatform,
  handle: string,
  limit: number,
  since: string,
): Record<string, unknown> {
  const url = SOCIAL_PLATFORMS[platform].profileUrl(handle);
  const bare = handle.trim().replace(/^@/, "");
  // Scans are incremental, so pass `since` on as a date filter where the actor
  // has one — but only when it really is a date. A relative value like
  // "1 month" is valid for Instagram's `onlyPostsNewerThan` and not for the
  // date fields below, so it is omitted there rather than sent and rejected.
  const sinceDate = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : "";

  switch (platform) {
    case "instagram":
      return {
        directUrls: [url],
        resultsType: "posts",
        resultsLimit: limit,
        onlyPostsNewerThan: since,
        addParentData: true,
      };
    case "facebook":
      return {
        startUrls: [{ url }],
        resultsLimit: limit,
        onlyPostsNewerThan: since,
      };
    case "tiktok":
      return {
        profiles: [bare],
        resultsPerPage: limit,
        profileSorting: "latest",
        ...(sinceDate ? { oldestPostDateUnified: sinceDate } : {}),
      };
    case "x":
      return {
        twitterHandles: [bare],
        maxItems: limit,
        sort: "Latest",
        ...(sinceDate ? { start: sinceDate } : {}),
      };
  }
}

/* ------------------------------------------------------------------ runs */

export interface ApifyRun {
  id: string;
  status: string;
  defaultDatasetId: string;
  usageTotalUsd: number;
  statusMessage?: string;
}

interface RawRun {
  data?: Partial<ApifyRun>;
}

const TERMINAL_STATUS = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUS.has(status);
}

function toRun(raw: RawRun): ApifyRun {
  const data = raw?.data ?? {};
  return {
    id: String(data.id ?? ""),
    status: String(data.status ?? ""),
    defaultDatasetId: String(data.defaultDatasetId ?? ""),
    usageTotalUsd: Number(data.usageTotalUsd ?? 0),
    statusMessage: data.statusMessage ? String(data.statusMessage) : undefined,
  };
}

function authHeaders(): Record<string, string> {
  const token = getEnv("APIFY_TOKEN");
  if (!token) throw new HttpError(409, "Apify is not configured on the server. Add APIFY_TOKEN.");
  return { Authorization: `Bearer ${token}` };
}

export interface StartRunOptions {
  /** Cap on charged dataset items (pay-per-result actors). */
  maxItems: number;
  /** Hard ceiling on what this single run may cost. */
  maxTotalChargeUsd: number;
  /** Apify's own run timeout, in seconds. */
  timeoutSecs: number;
}

/**
 * Starts one actor run. The run is left asynchronous on purpose: we hold the
 * run id so its status and cost stay observable while it works.
 */
export async function startRun(
  actorId: string,
  input: Record<string, unknown>,
  options: StartRunOptions,
): Promise<ApifyRun> {
  const url = new URL(`${APIFY_BASE}/actors/${encodeURIComponent(actorId)}/runs`);
  url.searchParams.set("maxItems", String(options.maxItems));
  url.searchParams.set("maxTotalChargeUsd", String(options.maxTotalChargeUsd));
  url.searchParams.set("timeout", String(options.timeoutSecs));

  const response = await fetchJson<RawRun>(url.toString(), {
    method: "POST",
    headers: authHeaders(),
    body: input,
    timeoutMs: 30_000,
    retries: 1,
  });
  const run = toRun(response);
  if (!run.id) throw new HttpError(502, "Apify did not return a run id.");
  return run;
}

/**
 * Waits for a run in one bounded window (`waitForFinish` is capped at 60s by
 * Apify) and returns the run as it stands — terminal or not.
 */
export async function waitForRun(runId: string, waitSeconds = 60): Promise<ApifyRun> {
  const url = new URL(`${APIFY_BASE}/actor-runs/${encodeURIComponent(runId)}`);
  url.searchParams.set("waitForFinish", String(Math.min(60, Math.max(0, waitSeconds))));

  const response = await fetchJson<RawRun>(url.toString(), {
    headers: authHeaders(),
    // The request is legitimately slow, so give it room and do not retry it:
    // a retry would wait all over again.
    timeoutMs: (Math.min(60, waitSeconds) + 15) * 1000,
    retries: 0,
  });
  return toRun(response);
}

/** Items from a finished run's default dataset. */
export async function fetchDatasetItems(
  datasetId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set("clean", "true");
  url.searchParams.set("limit", String(limit));

  const items = await fetchJson<unknown>(url.toString(), {
    headers: authHeaders(),
    timeoutMs: 60_000,
    retries: 1,
  });
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/* -------------------------------------------------------------- normalising */

/** One provider post, mapped onto our own columns. */
export interface ScrapedPost {
  externalId: string;
  url: string;
  caption: string;
  mediaUrl: string;
  mediaType: string;
  hashtags: string[];
  mentions: string[];
  likes: number;
  comments: number;
  shares: number;
  views: number;
  postedAt: string | null;
}

/**
 * Actors are third-party and their field names drift, so every read here tries
 * the known aliases and falls back to a sane default rather than failing a run
 * over a renamed key.
 */
function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function firstNumber(...values: unknown[]): number {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** An array of strings, or a whitespace/comma separated string. */
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[\s,]+/)
      .map((entry) => entry.replace(/^[#@]/, "").trim())
      .filter(Boolean);
  }
  return [];
}

/** Hashtags / mentions as they appear in a caption, for actors that omit them. */
export function tagsInCaption(caption: string, sigil: "#" | "@"): string[] {
  const matches = caption.match(new RegExp(`${sigil}[\\p{L}\\p{N}_.]+`, "gu")) ?? [];
  return [...new Set(matches.map((match) => match.slice(1)))];
}

/**
 * A media URL out of an actor's nested media block — X's `media` array holds
 * objects, Instagram-style `images` hold plain strings, and either may simply be
 * a string.
 */
function mediaFrom(item: Record<string, unknown>): string {
  const candidates = [item.media, item.extendedEntities];
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate;
    const list = Array.isArray(candidate) ? candidate : [candidate];
    for (const entry of list) {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const media = entry as Record<string, unknown>;
        const url = firstString(media.mediaUrl, media.url, media.media_url_https, media.thumbnailUrl);
        if (url) return url;
        const nested = media.media_urls ?? media.mediaUrls ?? media.photos;
        if (Array.isArray(nested)) {
          const first = firstString(...nested);
          if (first) return first;
        }
      }
    }
  }
  return "";
}

/** ISO timestamp from an ISO string or a unix timestamp (seconds or millis). */
export function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1e12 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value.trim());
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

/** Engagement as a percentage of the profile's followers. */
export function engagementRate(likes: number, comments: number, followers: number): number {
  if (followers <= 0) return 0;
  return Number((((likes + comments) / followers) * 100).toFixed(3));
}

/**
 * The first value that parses to a non-negative number, or null when none does.
 *
 * Deliberately not `firstNumber`, which substitutes 0 for "not found": a dataset
 * that never states a profile's follower count must not be read as "zero
 * followers", because that would make a real engagement rate impossible to tell
 * apart from a missing one.
 */
function firstCount(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed =
      typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
    if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/**
 * Where a post item keeps the profile object, across the platform actors.
 *
 * `metaData` is the one that matters in practice and is verified against a live
 * `apify/instagram-scraper` dataset: a post item carries no follower field of its
 * own, but nests the whole profile under `metaData` (`followersCount`, `postsCount`,
 * `businessCategoryName` …). `authorMeta` is the TikTok scraper's equivalent,
 * holding `fans`; the rest are the author-shaped names other actors use.
 */
const AUTHOR_KEYS = [
  "metaData",
  "authorMeta",
  "owner",
  "author",
  "user",
  "profile",
  "ownerProfile",
  "channel",
] as const;

/**
 * The monitored profile's follower count, when the scraped dataset reports one.
 *
 * Post-oriented actors disagree on whether a *post* item carries it and on what
 * they call it — `followersCount` on Instagram-flavoured output, `follower_count`
 * elsewhere, often nested under the author object — so every common spelling is
 * read. This is the only place `competitor_social.followers` can come from, and
 * without it `engagementRate` is structurally 0% for every workspace.
 *
 * `null` means "this dataset does not say", which the caller keeps distinct from
 * a genuine zero.
 */
export function followersFrom(items: Record<string, unknown>[]): number | null {
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const direct = firstCount(
      item.followersCount,
      item.followers,
      item.followerCount,
      item.followers_count,
      item.follower_count,
      item.subscriberCount,
      item.subscribers,
      // TikTok's own word for the same number.
      item.fans,
      item.userFollowersCount,
      item.ownerFollowersCount,
    );
    if (direct !== null) return direct;

    for (const key of AUTHOR_KEYS) {
      const nested = item[key];
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
      const record = nested as Record<string, unknown>;
      const found = firstCount(
        record.followersCount,
        record.followers,
        record.followerCount,
        record.followers_count,
        record.follower_count,
        record.subscriberCount,
        record.fans,
      );
      if (found !== null) return found;
    }
  }
  return null;
}

/** One raw dataset item → a post, or null when it has no usable identity. */
export function normalisePost(
  item: Record<string, unknown>,
  platform: SocialPlatform,
): ScrapedPost | null {
  const shortCode = firstString(item.shortCode, item.code);
  const externalId = firstString(item.id, item.postId, shortCode, item.url, item.postUrl);
  if (!externalId) return null;

  const caption = firstString(item.caption, item.text, item.description);
  // Instagram exposes `displayUrl`/`images`, X nests media under `media`
  // (`extendedEntities` when it is a video), so both shapes are read here.
  const mediaUrl = firstString(
    item.displayUrl,
    item.videoUrl,
    item.thumbnailUrl,
    item.imageUrl,
    item.mediaUrl,
    Array.isArray(item.images) ? firstString(...item.images) : "",
    mediaFrom(item),
  );

  return {
    externalId,
    url:
      firstString(item.url, item.postUrl) ||
      (platform === "instagram" && shortCode
        ? `https://www.instagram.com/p/${shortCode}/`
        : ""),
    caption,
    mediaUrl,
    mediaType: firstString(item.type, item.productType, item.mediaType) || (item.videoUrl ? "Video" : ""),
    hashtags: (() => {
      const declared = stringList(item.hashtags);
      return declared.length ? declared : tagsInCaption(caption, "#");
    })(),
    mentions: (() => {
      const declared = stringList(item.mentions);
      return declared.length ? declared : tagsInCaption(caption, "@");
    })(),
    // X reports `likeCount`/`replyCount`/`retweetCount` rather than the
    // Instagram names, so both vocabularies are read; a missed one shows as a
    // silent zero on the engagement card rather than an error.
    likes: firstNumber(item.likesCount, item.likes, item.likeCount),
    comments: firstNumber(item.commentsCount, item.comments, item.commentCount, item.replyCount),
    shares: firstNumber(
      item.sharesCount,
      item.shares,
      item.shareCount,
      item.retweetCount,
      item.quoteCount,
    ),
    views: firstNumber(
      item.videoViewCount,
      item.videoPlayCount,
      item.viewCount,
      item.views,
      item.playCount,
    ),
    postedAt: toIsoTimestamp(item.timestamp ?? item.takenAtTimestamp ?? item.takenAt ?? item.createdAt),
  };
}

/** Normalises a whole dataset, dropping unusable items and duplicate posts. */
export function normalisePosts(
  items: Record<string, unknown>[],
  platform: SocialPlatform,
): ScrapedPost[] {
  const byId = new Map<string, ScrapedPost>();
  for (const item of items) {
    const post = normalisePost(item, platform);
    if (post) byId.set(post.externalId, post);
  }
  return [...byId.values()];
}
