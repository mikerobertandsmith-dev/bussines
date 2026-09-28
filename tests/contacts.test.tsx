import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contactsActorId,
  contactsCaps,
  contactsInputFor,
  contactsPreviewCapPerHour,
  contactsReuseWindowMinutes,
  normaliseContacts,
  previewQuotaMessage,
  profileHandle,
  reusableWithin,
  reviewContacts,
  scrapeUrl,
  type ContactsCaps,
} from "../supabase/functions/_shared/contacts";
import fixture from "./fixtures/contacts-item.json";

/**
 * `_shared/contacts.ts` reads its configuration through `Deno.env`, which the
 * browser test runner does not have. A minimal double is enough: the module only
 * touches it inside function calls.
 */
const denoEnv = new Map<string, string>();
vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
afterEach(() => denoEnv.clear());

const CAPS: ContactsCaps = {
  maxPages: 5,
  maxChargeUsd: 0.5,
  maxDepth: 1,
  timeoutSecs: 120,
  enrichProfiles: false,
};

/** The dataset item from the real run recorded in Phase 0. */
const liveItem = fixture[0] as Record<string, unknown>;

describe("website contacts normaliser", () => {
  it("reads the live fixture into our platform keys, with bare handles", () => {
    const review = normaliseContacts(liveItem);

    expect(review.suggestions.map((s) => `${s.platform}:${s.handle}`)).toEqual([
      "instagram:cotopaxi",
      "tiktok:cotopaxiofficial",
      "facebook:Cotopaxi-507703575971618",
      // The actor's field is `twitters`, not `x` — the one mapping that would
      // otherwise silently produce nothing while still being billed.
      "x:cotopaxi",
      "youtube:GearForGood",
    ]);
  });

  it("marks only the platforms we have an actor for as monitorable", () => {
    const review = normaliseContacts(liveItem);

    expect(review.suggestions.filter((s) => s.monitorable).map((s) => s.platform)).toEqual([
      "instagram",
      "tiktok",
      "facebook",
      "x",
    ]);
    expect(review.suggestions.find((s) => s.platform === "youtube")?.monitorable).toBe(false);
    // Shown, never written — this is what the "found, not monitored" line reads.
    expect(review.unmonitored).toEqual(["YouTube"]);
  });

  it("keeps the URL it found, so a proposal can be checked before it is accepted", () => {
    const review = normaliseContacts(liveItem);
    expect(review.suggestions.find((s) => s.platform === "instagram")?.url).toBe(
      "https://www.instagram.com/cotopaxi",
    );
  });

  it("drops emails, phones and lead enrichment — the personal data the actor may return", () => {
    const review = normaliseContacts({
      instagrams: ["https://www.instagram.com/brand"],
      emails: ["hello@brand.com"],
      phones: ["+441234567890"],
      phonesUncertain: ["507703575971618"],
      leadsEnrichment: [
        {
          fullName: "Ada Lovelace",
          email: "ada@brand.com",
          linkedinProfile: "https://linkedin.com/in/ada",
        },
      ],
    });

    const serialised = JSON.stringify(review);
    expect(serialised).not.toContain("brand.com");
    expect(serialised).not.toContain("Ada Lovelace");
    expect(serialised).not.toContain("507703575971618");
    // Structurally impossible to leak: the suggestion carries four fields and no more.
    expect(Object.keys(review.suggestions[0]).sort()).toEqual([
      "handle",
      "monitorable",
      "platform",
      "url",
    ]);
  });

  it("ignores anything that is not one profile", () => {
    const review = normaliseContacts({
      instagrams: [
        "/instagram",
        "https://www.instagram.com/",
        "instagram.com",
        "not a url",
        "mailto:hi@brand.com",
        "https://www.instagram.com/realbrand/",
      ],
      facebooks: [null, 42, ""],
    });

    expect(review.suggestions.map((s) => s.handle)).toEqual(["realbrand"]);
  });

  it("proposes one profile per platform per handle, however often it is listed", () => {
    const review = normaliseContacts({
      twitters: ["https://x.com/brand", "https://twitter.com/brand"],
      instagrams: ["https://www.instagram.com/brand/"],
    });

    expect(review.suggestions.map((s) => `${s.platform}:${s.handle}`)).toEqual([
      "instagram:brand",
      "x:brand",
    ]);
  });

  it("folds several dataset items into one review", () => {
    const review = reviewContacts([
      liveItem,
      { instagrams: ["https://www.instagram.com/othermob"] },
    ]);

    expect(
      review.suggestions.filter((s) => s.platform === "instagram").map((s) => s.handle),
    ).toEqual(["cotopaxi", "othermob"]);
  });
});

describe("profile handle", () => {
  it("reduces every profile URL form the actor returns", () => {
    expect(profileHandle("https://www.instagram.com/brand/")).toBe("brand");
    expect(profileHandle("https://www.tiktok.com/@brand")).toBe("brand");
    expect(profileHandle("https://www.facebook.com/Brand-507703575971618")).toBe(
      "Brand-507703575971618",
    );
    expect(profileHandle("https://x.com/brand")).toBe("brand");
    // On these two the handle sits behind a path segment.
    expect(profileHandle("https://www.youtube.com/user/GearForGood")).toBe("GearForGood");
    expect(profileHandle("https://www.linkedin.com/company/acme")).toBe("acme");
    expect(profileHandle("@brand")).toBe("brand");
  });

  it("refuses a domain, a bare path and a non-http scheme", () => {
    // The domain case matters most: storing "instagram.com" as a handle would
    // build a profile URL around it and scrape nothing while still being charged.
    expect(profileHandle("instagram.com")).toBe("");
    expect(profileHandle("https://www.instagram.com/")).toBe("");
    expect(profileHandle("/brand")).toBe("");
    expect(profileHandle("mailto:hi@brand.com")).toBe("");
    expect(profileHandle("")).toBe("");
  });
});

describe("actors input", () => {
  it("sends exactly the shape the actor's live schema requires", () => {
    expect(contactsInputFor("https://competitor.com", CAPS)).toEqual({
      startUrls: [{ url: "https://competitor.com" }],
      proxyConfig: { useApifyProxy: true },
      maxRequests: 5,
      maxRequestsPerStartUrl: 5,
      maxDepth: 1,
      sameDomain: true,
      mergeContacts: true,
      // The paid extras: the browser bills every page twice, and enrichment bills
      // each profile separately.
      useBrowser: false,
      maximumLeadsEnrichmentRecords: 0,
      scrapeSocialMediaProfiles: {
        facebooks: false,
        instagrams: false,
        youtubes: false,
        tiktoks: false,
        twitters: false,
      },
    });
  });

  it("only switches profile enrichment on when it is asked for", () => {
    const input = contactsInputFor("https://competitor.com", { ...CAPS, enrichProfiles: true });
    const profiles = input.scrapeSocialMediaProfiles as Record<string, boolean>;
    expect(profiles.instagrams).toBe(true);
    // The browser stays off whatever else is configured: it is a per-page charge.
    expect(input.useBrowser).toBe(false);
  });
});

describe("contacts caps", () => {
  it("never plans a run below the actor's published minimum", () => {
    // Apify refuses the run outright below $0.50 with
    // `max-total-charge-usd-below-minimum`, so a smaller cap is not a tighter
    // guard — it is a run that never starts.
    denoEnv.set("APIFY_CONTACTS_MAX_CHARGE_USD", "0.25");
    expect(contactsCaps().maxChargeUsd).toBe(0.5);

    denoEnv.set("APIFY_CONTACTS_MAX_CHARGE_USD", "2");
    expect(contactsCaps().maxChargeUsd).toBe(2);
  });

  it("defaults the page ceiling, depth and timeout that bound the crawl", () => {
    expect(contactsCaps()).toMatchObject({ maxPages: 5, maxDepth: 1, timeoutSecs: 120 });

    denoEnv.set("APIFY_CONTACTS_MAX_PAGES", "2");
    denoEnv.set("APIFY_CONTACTS_MAX_DEPTH", "0");
    expect(contactsCaps()).toMatchObject({ maxPages: 2, maxDepth: 1, timeoutSecs: 120 });
  });

  it("reports an actor id only when one is configured, and trims it", () => {
    // Empty means "not configured", and the feature says so rather than guessing
    // at an id — the whole reason the id is configuration and not a constant.
    expect(contactsActorId()).toBe("");
    denoEnv.set("APIFY_CONTACTS_ACTOR_ID", " 9Sk4JJhEma9vBKqrg ");
    expect(contactsActorId()).toBe("9Sk4JJhEma9vBKqrg");
  });
});

describe("preview allowance", () => {
  it("defaults a per-user hourly cap on the one path with no workspace to bill", () => {
    // Preview mode runs before a business row exists, so there is no tenant to
    // count against. This cap is what bounds a scripted loop instead.
    expect(contactsPreviewCapPerHour()).toBe(10);

    denoEnv.set("APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR", "3");
    expect(contactsPreviewCapPerHour()).toBe(3);
  });

  it("falls back rather than uncapping when the value is nonsense", () => {
    // "Unset" is not "unlimited" here: 0 would be an unbounded allowance, and
    // `positiveEnv` rejects it, which is the safe direction.
    denoEnv.set("APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR", "0");
    expect(contactsPreviewCapPerHour()).toBe(10);
    denoEnv.set("APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR", "lots");
    expect(contactsPreviewCapPerHour()).toBe(10);
  });

  it("says how many reads were used and what the limit is", () => {
    const message = previewQuotaMessage(10, 10);
    expect(message).toContain("10 website reads in the last hour");
    expect(message).toContain("the limit (10)");
    // The way out, stated rather than left to be guessed at.
    expect(message).toContain("try again in an hour");
  });
});

describe("reuse window", () => {
  it("defaults to two minutes, and can be switched off entirely", () => {
    expect(contactsReuseWindowMinutes()).toBe(2);

    // 0 is a meaningful value here, not a missing one: never reuse, always pay
    // for a fresh read. `positiveEnv` could not express that, which is why this
    // cap has its own reader.
    denoEnv.set("APIFY_CONTACTS_REUSE_WINDOW_MINUTES", "0");
    expect(contactsReuseWindowMinutes()).toBe(0);

    denoEnv.set("APIFY_CONTACTS_REUSE_WINDOW_MINUTES", "15");
    expect(contactsReuseWindowMinutes()).toBe(15);
  });

  it("reuses only a read taken inside the window", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

    expect(reusableWithin(minutesAgo(1), 2, now)).toBe(true);
    expect(reusableWithin(minutesAgo(3), 2, now)).toBe(false);
  });

  it("never reuses when there is nothing to reuse or reuse is off", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    const fresh = new Date(now - 1_000).toISOString();

    expect(reusableWithin(null, 2, now)).toBe(false);
    expect(reusableWithin(undefined, 2, now)).toBe(false);
    expect(reusableWithin("", 2, now)).toBe(false);
    // An unparseable timestamp must not read as "just now" — `NaN < x` is false,
    // and the guard makes that explicit rather than incidental.
    expect(reusableWithin("not a date", 2, now)).toBe(false);
    expect(reusableWithin(fresh, 0, now)).toBe(false);
  });
});

describe("scrape url", () => {
  it("reduces a typed website to the host the actor is pointed at", () => {
    expect(scrapeUrl("competitor.com")).toBe("https://competitor.com");
    expect(scrapeUrl("https://competitor.com/shop")).toBe("https://competitor.com");
    expect(scrapeUrl("not a url")).toBe("");
    expect(scrapeUrl("")).toBe("");
  });
});
