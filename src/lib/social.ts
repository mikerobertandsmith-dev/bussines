import type { SocialChannel, SocialPost } from "./types";

/**
 * Derived competitor-social insights.
 *
 * Nothing here is stored: cadence, averages and records are computed from the
 * posts we actually scraped, so a panel can never drift from the rows behind it.
 */

/** Display names for the platform keys `social_posts.platform` stores. */
const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  x: "X",
};

/**
 * The platforms the Apify gateway can scrape, as the keys it stores against.
 * These are the only values worth offering when a competitor handle is added: a
 * platform with no actor wired up is skipped by the scan rather than guessed at.
 */
export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook", "x"] as const;

/**
 * A stored platform label mapped onto one of those keys, or null when the
 * gateway has no scraper for it. Competitor rows imported from elsewhere may
 * carry display labels ("X (Twitter)", "YouTube"), so those are matched too.
 */
export function socialPlatformOf(value: string): string | null {
  const key = value.trim().toLowerCase();
  if ((SOCIAL_PLATFORMS as readonly string[]).includes(key)) return key;
  if (key.startsWith("instagram")) return "instagram";
  if (key.startsWith("tiktok")) return "tiktok";
  if (key.startsWith("facebook")) return "facebook";
  if (key === "x" || key.startsWith("x ") || key.startsWith("twitter")) return "x";
  return null;
}

export function platformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  return PLATFORM_LABELS[key] ?? platform;
}

/** The stored key for a platform label, for comparing channels across rows. */
export function socialPlatformKey(platform: string): string {
  return socialPlatformOf(platform) ?? platform.trim().toLowerCase();
}

/**
 * Replaces one platform's channel, or appends it when that platform is new, so a
 * competitor keeps a single handle per platform the way the unique index on
 * `competitor_social` requires.
 */
export function mergeSocialChannel(
  channels: SocialChannel[],
  channel: SocialChannel,
): SocialChannel[] {
  const wanted = socialPlatformKey(channel.platform);
  if (!channels.some((existing) => socialPlatformKey(existing.platform) === wanted)) {
    return [...channels, channel];
  }
  return channels.map((existing) =>
    socialPlatformKey(existing.platform) === wanted ? channel : existing,
  );
}

/**
 * Whatever the user pasted, reduced to the bare handle a scraper addresses a
 * profile by: `@rei`, `rei` and `https://www.instagram.com/rei/` all become
 * `rei`.
 *
 * This is not cosmetic. The gateway strips a leading `@` and then builds the
 * profile URL around the result, so a pasted *URL* would be embedded in that URL
 * and the scan would quietly return nothing. An empty result means the input was
 * not a handle, and the caller should say so.
 */
export function normaliseSocialHandle(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  const withoutQuery = trimmed.split(/[?#]/)[0];
  const withoutScheme = withoutQuery.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const segments = withoutScheme.split("/").filter(Boolean);

  // A profile URL puts the handle in the first path segment after the host;
  // a bare handle is already the whole string.
  const candidate = segments.length > 1 ? segments[1] : (segments[0] ?? "");
  const handle = candidate.replace(/^@/, "").trim();

  // "instagram.com" with no profile path is a paste slip rather than a handle —
  // return nothing so the caller can ask for the profile itself instead of
  // scraping the domain as if it were a username.
  if (segments.length <= 1 && /^[a-z0-9-]+(\.[a-z]{2,})+$/i.test(handle)) return "";

  return handle;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function postedTime(post: SocialPost): number {
  if (!post.postedAt) return Number.NaN;
  return new Date(post.postedAt).getTime();
}

/** Posting volume and engagement for one competitor, as the tabs display it. */
export interface CompetitorSocialInsight {
  competitorId: string;
  posts: number;
  /** Posts published in the last 7 days. */
  postsLast7Days: number;
  /** Posts published in the last 24 hours — what the burst alert watches. */
  postsLast24Hours: number;
  /** Posts per week averaged over the last four weeks. */
  postsPerWeek: number;
  averageEngagement: number;
  /** Their best-engaging post in the window, which is the one to beat. */
  bestPost: SocialPost | null;
  /** Their best-engaging post before the window — the record to beat. */
  previousBest: SocialPost | null;
  topHashtags: { tag: string; count: number }[];
  latestPostAt: string | null;
}

const EMPTY_INSIGHT = (competitorId: string): CompetitorSocialInsight => ({
  competitorId,
  posts: 0,
  postsLast7Days: 0,
  postsLast24Hours: 0,
  postsPerWeek: 0,
  averageEngagement: 0,
  bestPost: null,
  previousBest: null,
  topHashtags: [],
  latestPostAt: null,
});

/** The post with the highest engagement; ties go to the newer one. */
function highestEngagement(posts: SocialPost[]): SocialPost | null {
  let best: SocialPost | null = null;
  for (const post of posts) {
    if (!best) {
      best = post;
      continue;
    }
    if (post.engagementRate > best.engagementRate) best = post;
    else if (
      post.engagementRate === best.engagementRate &&
      (postedTime(post) || 0) > (postedTime(best) || 0)
    ) {
      best = post;
    }
  }
  return best;
}

/**
 * Summarises one competitor's posts. `windowDays` is the period the headline
 * numbers describe (posts per week, best post); posts older than it still feed
 * `previousBest`, which is what makes a "new record" meaningful.
 */
export function summariseSocial(
  posts: SocialPost[],
  competitorId: string,
  now: Date = new Date(),
  windowDays = 30,
): CompetitorSocialInsight {
  const theirs = posts.filter((post) => post.competitorId === competitorId);
  if (!theirs.length) return EMPTY_INSIGHT(competitorId);

  const nowMs = now.getTime();
  const windowStart = nowMs - windowDays * DAY_MS;
  const inWindow = theirs.filter((post) => {
    const at = postedTime(post);
    return Number.isFinite(at) && at >= windowStart;
  });

  const hashtagCounts = new Map<string, number>();
  for (const post of inWindow) {
    for (const tag of post.hashtags) {
      const key = tag.toLowerCase();
      hashtagCounts.set(key, (hashtagCounts.get(key) ?? 0) + 1);
    }
  }

  const latest = theirs
    .map(postedTime)
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => b - a)[0];

  return {
    competitorId,
    posts: theirs.length,
    postsLast7Days: theirs.filter((post) => {
      const at = postedTime(post);
      return Number.isFinite(at) && at >= nowMs - 7 * DAY_MS;
    }).length,
    postsLast24Hours: theirs.filter((post) => {
      const at = postedTime(post);
      return Number.isFinite(at) && at >= nowMs - DAY_MS;
    }).length,
    postsPerWeek: Number((inWindow.length / (windowDays / 7)).toFixed(1)),
    averageEngagement: inWindow.length
      ? Number(
          (inWindow.reduce((sum, post) => sum + post.engagementRate, 0) / inWindow.length).toFixed(2),
        )
      : 0,
    bestPost: highestEngagement(inWindow),
    previousBest: highestEngagement(
      theirs.filter((post) => {
        const at = postedTime(post);
        return Number.isFinite(at) && at < windowStart;
      }),
    ),
    topHashtags: [...hashtagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, 5),
    latestPostAt: latest ? new Date(latest).toISOString() : null,
  };
}

/** True when a post arrived within the last `hours` — the "new" marker. */
export function isRecentPost(post: SocialPost, now: Date = new Date(), hours = 48): boolean {
  const at = postedTime(post);
  return Number.isFinite(at) && at >= now.getTime() - hours * 60 * 60 * 1000;
}

/** The engagement rate a post needs to beat to be a new record for them. */
export function recordToBeat(insight: CompetitorSocialInsight): number {
  return insight.previousBest?.engagementRate ?? 0;
}
