import { describe, expect, it } from "vitest";
import {
  isRecentPost,
  mergeSocialChannel,
  normaliseSocialHandle,
  platformLabel,
  socialPlatformOf,
  summariseSocial,
} from "../src/lib/social";
import { buildAlerts } from "../src/lib/alerts";
import { sampleWorkspace } from "../src/data/sample";
import {
  engagementRate,
  inputFor,
  normalisePost,
  normalisePosts,
  platformOf,
  tagsInCaption,
  toIsoTimestamp,
} from "../supabase/functions/_shared/apify";
import type { SocialPost } from "../src/lib/types";

/** A post with sensible defaults, so each test only states what it is about. */
function post(overrides: Partial<SocialPost> & { postedAt: string }): SocialPost {
  return {
    id: overrides.externalId ?? "p",
    competitorId: "comp-1",
    platform: "instagram",
    externalId: "p",
    url: "",
    caption: "",
    mediaUrl: "",
    mediaType: "Image",
    hashtags: [],
    mentions: [],
    likes: 0,
    comments: 0,
    shares: 0,
    views: 0,
    engagementRate: 0,
    scrapedAt: overrides.postedAt,
    ...overrides,
  };
}

const NOW = new Date("2026-09-27T12:00:00.000Z");
const at = (daysAgo: number, hoursAgo = 0) =>
  new Date(NOW.getTime() - daysAgo * 86_400_000 - hoursAgo * 3_600_000).toISOString();

describe("summariseSocial", () => {
  it("measures cadence, averages and the posts-per-day window from the posts themselves", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "a", postedAt: at(0, 2), engagementRate: 8 }),
        post({ externalId: "b", postedAt: at(0, 9), engagementRate: 5 }),
        post({ externalId: "c", postedAt: at(0, 20), engagementRate: 3 }),
        post({ externalId: "d", postedAt: at(3), engagementRate: 4 }),
        post({ externalId: "e", postedAt: at(8), engagementRate: 2 }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.posts).toBe(5);
    expect(insight.postsLast24Hours).toBe(3);
    expect(insight.postsLast7Days).toBe(4);
    // Five posts inside a 30-day window → 5 / (30/7) per week.
    expect(insight.postsPerWeek).toBe(1.2);
    expect(insight.averageEngagement).toBe(4.4);
    expect(insight.bestPost?.externalId).toBe("a");
  });

  it("keeps the pre-window best post as the record to beat", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "recent", postedAt: at(2), engagementRate: 8.1 }),
        post({ externalId: "old", postedAt: at(60), engagementRate: 4.4 }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.bestPost?.externalId).toBe("recent");
    expect(insight.previousBest?.externalId).toBe("old");
  });

  it("counts only this competitor's posts and ranks their hashtags", () => {
    const insight = summariseSocial(
      [
        post({ externalId: "a", postedAt: at(1), hashtags: ["velvet", "nairobi"] }),
        post({ externalId: "b", postedAt: at(2), hashtags: ["velvet"] }),
        post({ externalId: "other", competitorId: "comp-2", postedAt: at(1) }),
      ],
      "comp-1",
      NOW,
    );

    expect(insight.posts).toBe(2);
    expect(insight.topHashtags[0]).toEqual({ tag: "velvet", count: 2 });
  });

  it("returns an empty insight for a competitor we have no posts for", () => {
    const insight = summariseSocial([], "comp-missing", NOW);

    expect(insight.posts).toBe(0);
    expect(insight.bestPost).toBeNull();
    expect(insight.postsPerWeek).toBe(0);
  });
});

describe("platform helpers", () => {
  it("labels platform keys and passes unknown ones through", () => {
    expect(platformLabel("instagram")).toBe("Instagram");
    expect(platformLabel("x")).toBe("X");
    expect(platformLabel("Mastodon")).toBe("Mastodon");
  });

  it("maps the stored competitor platform labels onto scraper platforms", () => {
    expect(platformOf("X (Twitter)")).toBe("x");
    expect(platformOf("Instagram")).toBe("instagram");
    expect(platformOf("YouTube")).toBeNull();
  });

  it("marks posts from the last 48 hours as new", () => {
    expect(isRecentPost(post({ postedAt: at(1) }), NOW)).toBe(true);
    expect(isRecentPost(post({ postedAt: at(5) }), NOW)).toBe(false);
  });
});

describe("Apify normalisation", () => {
  it("reads the Instagram scraper's own field names", () => {
    const normalised = normalisePost(
      {
        id: "12345",
        shortCode: "C7xKq1",
        url: "https://www.instagram.com/p/C7xKq1/",
        caption: "Restock day #velvetlipkit thanks @glowmart",
        displayUrl: "https://cdn.example.com/a.jpg",
        type: "Image",
        likesCount: 14_200,
        commentsCount: 640,
        timestamp: "2026-09-27T09:30:00.000Z",
      },
      "instagram",
    );

    expect(normalised).toMatchObject({
      externalId: "12345",
      caption: "Restock day #velvetlipkit thanks @glowmart",
      likes: 14_200,
      comments: 640,
      mediaType: "Image",
      postedAt: "2026-09-27T09:30:00.000Z",
    });
    expect(normalised?.hashtags).toEqual(["velvetlipkit"]);
    expect(normalised?.mentions).toEqual(["glowmart"]);
  });

  it("falls back to aliases when an actor renames its fields", () => {
    const normalised = normalisePost(
      { shortCode: "ABC", text: "Morning drop", imageUrl: "https://cdn.example.com/b.jpg", likes: 12 },
      "instagram",
    );

    expect(normalised).toMatchObject({
      externalId: "ABC",
      caption: "Morning drop",
      mediaUrl: "https://cdn.example.com/b.jpg",
      likes: 12,
      url: "https://www.instagram.com/p/ABC/",
    });
  });

  it("drops items with no identity and de-duplicates repeats", () => {
    const items = [
      { caption: "no id here" },
      { id: "same", caption: "first" },
      { id: "same", caption: "second" },
    ];

    expect(normalisePost(items[0], "instagram")).toBeNull();
    expect(normalisePosts(items, "instagram")).toHaveLength(1);
    expect(normalisePosts(items, "instagram")[0].caption).toBe("second");
  });

  it("computes engagement against the profile's followers", () => {
    expect(engagementRate(14_200, 640, 184_000)).toBe(8.065);
    // A post for a profile with no followers recorded cannot have a rate.
    expect(engagementRate(100, 10, 0)).toBe(0);
  });

  it("parses timestamps in seconds, milliseconds and ISO form", () => {
    expect(toIsoTimestamp(1_790_000_000)).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoTimestamp(1_790_000_000_000)).toBe("2026-09-21T14:13:20.000Z");
    expect(toIsoTimestamp("not a date")).toBeNull();
  });

  it("extracts hashtags and mentions from a caption", () => {
    expect(tagsInCaption("Restock #velvetlipkit with @glowmart", "#")).toEqual(["velvetlipkit"]);
    expect(tagsInCaption("Restock #velvetlipkit with @glowmart", "@")).toEqual(["glowmart"]);
  });

  it("sends the Instagram scraper its documented input shape", () => {
    expect(inputFor("instagram", "x", 30, "1 month")).toMatchObject({
      directUrls: ["https://www.instagram.com/x/"],
      resultsType: "posts",
      resultsLimit: 30,
      onlyPostsNewerThan: "1 month",
    });
  });

  it("sends each platform the input keys its actor actually accepts", () => {
    // Facebook's actor marks `startUrls` required, so a URL has to go there.
    expect(inputFor("facebook", "acme", 30, "1 month")).toMatchObject({
      startUrls: [{ url: "https://www.facebook.com/acme/" }],
      resultsLimit: 30,
    });
    // TikTok's actor is addressed by username and counts with `resultsPerPage`.
    expect(inputFor("tiktok", "@acme", 30, "2026-09-01")).toMatchObject({
      profiles: ["acme"],
      resultsPerPage: 30,
      oldestPostDateUnified: "2026-09-01",
    });
    // X's actor is addressed by handle and caps output with `maxItems`.
    expect(inputFor("x", "@acme", 30, "2026-09-01")).toMatchObject({
      twitterHandles: ["acme"],
      maxItems: 30,
      start: "2026-09-01",
    });
  });

  it("never sends the keys the non-Instagram actors reject", () => {
    for (const platform of ["tiktok", "facebook", "x"] as const) {
      expect(inputFor(platform, "acme", 30, "1 month")).not.toHaveProperty("directUrls");
    }
    expect(inputFor("tiktok", "acme", 30, "1 month")).not.toHaveProperty("resultsLimit");
    expect(inputFor("x", "acme", 30, "1 month")).not.toHaveProperty("resultsLimit");
    // A relative `since` is not a date, so it must not reach a date-only field.
    expect(inputFor("tiktok", "acme", 30, "1 month")).not.toHaveProperty("oldestPostDateUnified");
    expect(inputFor("x", "acme", 30, "1 month")).not.toHaveProperty("start");
  });
});

describe("demo social data and alerts", () => {
  it("fires the posting-burst and new-record alerts from the sample posts", () => {
    const alerts = buildAlerts(sampleWorkspace());
    const titles = alerts.map((alert) => alert.title);

    expect(titles.some((title) => title.includes("3 posts in 24 hours"))).toBe(true);
    expect(titles.some((title) => title.includes("beat their 30-day engagement record"))).toBe(true);
  });

  it("does not invent an alert for a competitor with a quiet profile", () => {
    const alerts = buildAlerts(sampleWorkspace());

    expect(alerts.some((alert) => alert.id === "alert-social-burst-comp-stitchline")).toBe(false);
    expect(alerts.some((alert) => alert.id === "alert-social-record-comp-tecwave")).toBe(false);
  });
});

/**
 * The X actor counts with Twitter's vocabulary — `likeCount`, `replyCount`,
 * `retweetCount` — not Instagram's, and this item is a real captured one. Read
 * only the Instagram names and the engagement card silently shows zeroes.
 */
describe("competitor handle normalising", () => {
  it("reduces a pasted profile URL to the bare handle the scraper addresses", () => {
    // The gateway strips a leading "@" and then builds the profile URL around the
    // result, so anything else left in there breaks the URL it sends the actor.
    expect(normaliseSocialHandle("@rei")).toBe("rei");
    expect(normaliseSocialHandle("rei")).toBe("rei");
    expect(normaliseSocialHandle("  rei  ")).toBe("rei");
    expect(normaliseSocialHandle("https://www.instagram.com/arcteryx/")).toBe("arcteryx");
    expect(normaliseSocialHandle("instagram.com/arcteryx")).toBe("arcteryx");
    expect(normaliseSocialHandle("https://www.tiktok.com/@glowmart")).toBe("glowmart");
    expect(normaliseSocialHandle("https://x.com/REI?lang=en")).toBe("REI");
    expect(normaliseSocialHandle("facebook.com/GlowMartBeauty/")).toBe("GlowMartBeauty");
  });

  it("refuses a bare domain rather than scraping it as if it were a username", () => {
    expect(normaliseSocialHandle("instagram.com")).toBe("");
    expect(normaliseSocialHandle("")).toBe("");
    expect(normaliseSocialHandle("   ")).toBe("");
  });

  it("maps the stored platform labels onto the keys the gateway scrapes", () => {
    expect(socialPlatformOf("instagram")).toBe("instagram");
    expect(socialPlatformOf("Instagram")).toBe("instagram");
    expect(socialPlatformOf("X (Twitter)")).toBe("x");
    expect(socialPlatformOf("Twitter")).toBe("x");
    expect(socialPlatformOf("TikTok")).toBe("tiktok");
    // A platform with no actor wired up is not a target the scan can use.
    expect(socialPlatformOf("YouTube")).toBeNull();
    expect(socialPlatformOf("Pinterest")).toBeNull();
  });

  it("keeps one channel per platform, whichever spelling the row uses", () => {
    const existing = [
      {
        platform: "Instagram",
        handle: "@old",
        followers: 10,
        engagementRate: 1,
        postsPerWeek: 1,
        adsRunning: 0,
      },
    ];
    const merged = mergeSocialChannel(existing, {
      platform: "instagram",
      handle: "new",
      followers: 0,
      engagementRate: 0,
      postsPerWeek: 0,
      adsRunning: 0,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].handle).toBe("new");
  });

  it("appends a platform that is not tracked yet", () => {
    const merged = mergeSocialChannel([], {
      platform: "tiktok",
      handle: "glowmart",
      followers: 0,
      engagementRate: 0,
      postsPerWeek: 0,
      adsRunning: 0,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].platform).toBe("tiktok");
  });
});

describe("live X actor field names", () => {
  it("reads likeCount, replyCount and retweetCount", () => {
    const post = normalisePost(
      {
        type: "tweet",
        id: "1587474547443474432",
        url: "https://x.com/REI/status/1587474547443474432",
        text: "Our holiday gift center is here!",
        retweetCount: 72,
        replyCount: 211,
        likeCount: 155,
        quoteCount: 6,
        createdAt: "Tue Nov 01 16:00:00 +0000 2022",
        lang: "en",
      },
      "x",
    );

    expect(post).toMatchObject({
      externalId: "1587474547443474432",
      likes: 155,
      comments: 211,
      shares: 72,
    });
    expect(post?.postedAt).toBe("2022-11-01T16:00:00.000Z");
    expect(post?.url).toBe("https://x.com/REI/status/1587474547443474432");
  });

  it("takes a media URL out of X's nested media block", () => {
    expect(
      normalisePost({ id: "1", text: "hi", media: [{ media_url_https: "https://pbs.twimg.com/media/x.jpg" }] }, "x")?.mediaUrl,
    ).toBe("https://pbs.twimg.com/media/x.jpg");
    expect(normalisePost({ id: "2", text: "hi", media: "https://pbs.twimg.com/media/y.jpg" }, "x")?.mediaUrl).toBe(
      "https://pbs.twimg.com/media/y.jpg",
    );
  });
});
