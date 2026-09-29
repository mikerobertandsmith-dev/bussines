import { describe, expect, it } from "vitest";

import {
  adLibraryUrlFor,
  advertiserMatches,
  audienceLabel,
  handleFromProfileUrl,
  normaliseAd,
  normaliseAds,
  normaliseName,
  platformLabel,
} from "../supabase/functions/_shared/ads.ts";

/** Copied from a live `apify/facebook-ads-scraper` dataset item, keys trimmed to the ones we read. */
const liveItem = {
  inputUrl: "https://www.facebook.com/ads/library/?q=patagonia",
  pageID: "1190977961065154",
  pageName: "Mapu Lahual Chile",
  adArchiveID: "2424846377934251",
  collationCount: 1,
  isActive: true,
  publisherPlatform: ["FACEBOOK", "INSTAGRAM"],
  startDateFormatted: "2025-12-29T08:00:00.000Z",
  endDateFormatted: "2026-09-29T07:00:00.000Z",
  targetedOrReachedCountries: [],
  snapshot: {
    pageName: "Mapu Lahual Chile",
    pageProfileUri: "https://www.facebook.com/mapulahualchile/",
    title: "Home - Mapu Lahual",
    body: { text: "Comenzamos una nueva temporada" },
    caption: "mapulahualchile.cl",
    ctaText: "Learn more",
    ctaType: "LEARN_MORE",
    linkUrl: "http://www.mapulahualchile.cl/",
    displayFormat: "IMAGE",
    images: [{ originalImageUrl: "https://scontent.xx.fbcdn.net/ad.jpg", imageCrops: [] }],
    videos: [],
  },
};

describe("adLibraryUrlFor", () => {
  it("points the actor at the advertiser's own page, which is the only exact address", () => {
    expect(adLibraryUrlFor("@patagonia")).toBe("https://www.facebook.com/patagonia/");
    expect(adLibraryUrlFor("patagonia/")).toBe("https://www.facebook.com/patagonia/");
  });
});

describe("normaliseName / handleFromProfileUrl", () => {
  it("ignores case and punctuation, so a name can be compared to itself", () => {
    expect(normaliseName("Patagonia, Inc.")).toBe("patagonia inc");
    expect(normaliseName("The North Face")).toBe("the north face");
  });

  it("pulls the handle out of a profile URL and drops a trailing page id", () => {
    expect(handleFromProfileUrl("https://www.facebook.com/mapulahualchile/")).toBe(
      "mapulahualchile",
    );
    expect(handleFromProfileUrl("https://www.facebook.com/patagonia-12345")).toBe("patagonia");
    expect(handleFromProfileUrl("")).toBe("");
  });
});

describe("advertiserMatches", () => {
  const target = { handle: "patagonia" };

  it("accepts the advertiser we asked for, by name or by handle", () => {
    expect(
      advertiserMatches(target, { advertiser: "Patagonia", advertiserHandle: "patagonia" }, "Patagonia"),
    ).toBe(true);
    expect(
      advertiserMatches(
        { handle: "mapulahualchile" },
        { advertiser: "Mapu Lahual Chile", advertiserHandle: "mapulahualchile" },
        "Mapu Lahual Chile",
      ),
    ).toBe(true);
  });

  it("rejects a look-alike, which is what the raw search actually returned", () => {
    // A search for *Patagonia* returned this exact advertiser. A "contains" match
    // would file another company's campaign under the competitor and alert on it.
    expect(
      advertiserMatches(
        { handle: "patagonia" },
        { advertiser: "Helados Patagonia", advertiserHandle: "heladospatagonia" },
        "Patagonia",
      ),
    ).toBe(false);
    expect(
      advertiserMatches(
        { handle: "patagonia" },
        { advertiser: "MRCOOL", advertiserHandle: "mrcool" },
        "Patagonia",
      ),
    ).toBe(false);
  });
});

describe("platformLabel / audienceLabel", () => {
  it("names the placement the ad actually ran in", () => {
    expect(platformLabel(["FACEBOOK", "INSTAGRAM"])).toBe("Meta Ads");
    expect(platformLabel(["INSTAGRAM"])).toBe("Instagram Ads");
    expect(platformLabel([])).toBe("Meta Ads");
  });

  it("states reach only when the library discloses it, otherwise claims nothing", () => {
    expect(audienceLabel(["US", "GB"])).toBe("Reached in US, GB");
    expect(audienceLabel([])).toBe("");
    expect(audienceLabel(["US", "US"])).toBe("Reached in US");
  });
});

describe("normaliseAd", () => {
  it("reads a live item into the columns `competitor_ads` holds", () => {
    const ad = normaliseAd(liveItem);
    expect(ad).not.toBeNull();
    if (!ad) return;

    expect(ad.externalId).toBe("2424846377934251");
    expect(ad.platform).toBe("Meta Ads");
    expect(ad.headline).toBe("Home - Mapu Lahual");
    expect(ad.status).toBe("active");
    expect(ad.bannerUrl).toBe("https://scontent.xx.fbcdn.net/ad.jpg");
    expect(ad.landingUrl).toBe("http://www.mapulahualchile.cl/");
    expect(ad.focus).toBe("Learn more");
    // The library's own start date, not the moment we read it.
    expect(ad.firstSeenAt).toBe("2025-12-29T08:00:00.000Z");
    expect(ad.advertiserHandle).toBe("mapulahualchile");
  });

  it("calls an ad that is no longer running paused", () => {
    expect(normaliseAd({ ...liveItem, isActive: false })?.status).toBe("paused");
  });

  it("falls back to the ad body when the creative has no title", () => {
    const ad = normaliseAd({
      ...liveItem,
      snapshot: { ...liveItem.snapshot, title: "", body: { text: "Autumn layering looks" } },
    });
    expect(ad?.headline).toBe("Autumn layering looks");
  });

  it("drops an item with no id, or with nothing that identifies it", () => {
    expect(normaliseAd({ ...liveItem, adArchiveID: undefined, adArchiveId: undefined, adId: undefined })).toBeNull();
    expect(normaliseAd({ adArchiveID: "1", snapshot: {} })).toBeNull();
  });

  it("de-duplicates a dataset that lists the same ad twice", () => {
    expect(normaliseAds([liveItem, liveItem])).toHaveLength(1);
  });
});
