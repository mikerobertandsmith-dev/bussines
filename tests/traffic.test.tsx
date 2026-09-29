import { afterEach, describe, expect, it, vi } from "vitest";

import {
  byDomain,
  normaliseTraffic,
  trafficActorId,
  trafficDomain,
  trafficMaxChargeUsd,
  trafficMaxDomains,
} from "../supabase/functions/_shared/traffic.ts";

/**
 * `_shared/traffic.ts` reads its configuration through `Deno.env`, which the
 * browser test runner does not have. A minimal double is enough: the module only
 * touches it inside function calls.
 */
const denoEnv = new Map<string, string>();
vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
afterEach(() => denoEnv.clear());

/**
 * The traffic panels read whatever these functions produce, so this file pins the
 * shapes against the actor's **real** output rather than an invented fixture.
 * Every value in `patagoniaItem` was copied from a live
 * `curious_coder/similarweb-scraper` dataset item — including `visits` arriving as
 * a string, which is the detail a hand-written fixture would have got wrong.
 */
const patagoniaItem = {
  domain: "patagonia.com",
  globalRank: 3433,
  visits: "10435813",
  estimatedMonthlyVisits: {
    "2026-06-01": 7328027,
    "2026-07-01": 7479613,
    "2026-08-01": 10435813,
  },
  trafficSources: {
    SocialOrganic: 0.030150196033628018,
    SocialPaid: 0.015539984700349419,
    Mail: 0.06449930983376358,
    SearchOrganic: 0.32709975474183,
    SearchPaid: 0.15665853009866615,
    Direct: 0.2893418397917854,
  },
};

describe("trafficDomain", () => {
  it("reduces any URL form the workspace stores to the hostname the actor wants", () => {
    expect(trafficDomain("https://www.Patagonia.com/shop?x=1")).toBe("patagonia.com");
    expect(trafficDomain("patagonia.com")).toBe("patagonia.com");
    expect(trafficDomain("www.patagonia.com/")).toBe("patagonia.com");
    expect(trafficDomain("")).toBe("");
  });
});

describe("normaliseTraffic", () => {
  it("reads a live item into visits, a chronological series and channel shares", () => {
    const traffic = normaliseTraffic(patagoniaItem);
    expect(traffic).not.toBeNull();
    if (!traffic) return;

    // `visits` arrives as a string from the actor and must still land as a number.
    expect(traffic.visits).toBe(10435813);
    expect(traffic.domain).toBe("patagonia.com");

    // Oldest first, so the chart draws left to right without the caller sorting.
    expect(traffic.series.map((point) => point.label)).toEqual([
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(traffic.series.map((point) => point.sortOrder)).toEqual(
      [...traffic.series.map((point) => point.sortOrder)].sort((a, b) => a - b),
    );

    // Growth is against the previous month: 7479613 → 10435813.
    expect(traffic.visitsChange).toBe(39.5);

    // Fractions become percentages, largest first.
    expect(traffic.channels[0]).toEqual({ label: "Search organic", share: 32.71 });
    expect(traffic.channels.some((channel) => channel.label === "Social paid")).toBe(true);
  });

  it("treats a domain with no figure as unknown, not as zero visits", () => {
    // "SimilarWeb has nothing for this site" and "this site had no visitors" are
    // different facts; storing 0 would report the second while meaning the first.
    expect(normaliseTraffic({ domain: "brand-new.example" })).toBeNull();
    expect(normaliseTraffic({ domain: "brand-new.example", visits: "0" })).toBeNull();
  });

  it("leaves the change at 0 when there is only one month to compare", () => {
    const traffic = normaliseTraffic({
      domain: "one.example",
      visits: "500",
      estimatedMonthlyVisits: { "2026-08-01": 500 },
    });
    expect(traffic?.visitsChange).toBe(0);
  });
});

describe("byDomain", () => {
  it("keys usable items by domain and drops the rest", () => {
    const found = byDomain([patagoniaItem, { domain: "unknown.example" }, {} as never]);
    expect([...found.keys()]).toEqual(["patagonia.com"]);
  });
});

describe("configuration", () => {
  it("reports the feature as off until the actor id is set", () => {
    // An unset id means "this deployment has not opted in", and the gate is what
    // keeps the panel from calling the feature configured while it bills nothing.
    expect(trafficActorId()).toBe("");
    denoEnv.set("APIFY_TRAFFIC_ACTOR_ID", "yOYYzj2J5K88boIVO");
    expect(trafficActorId()).toBe("yOYYzj2J5K88boIVO");
  });

  it("defaults the caps and honours a configured ceiling", () => {
    expect(trafficMaxDomains()).toBe(12);
    expect(trafficMaxChargeUsd()).toBe(0.25);

    denoEnv.set("APIFY_TRAFFIC_MAX_DOMAINS", "4");
    denoEnv.set("APIFY_TRAFFIC_MAX_CHARGE_USD", "0.1");
    expect(trafficMaxDomains()).toBe(4);
    expect(trafficMaxChargeUsd()).toBe(0.1);

    // A zero or nonsense ceiling falls back rather than disabling the guard.
    denoEnv.set("APIFY_TRAFFIC_MAX_CHARGE_USD", "0");
    expect(trafficMaxChargeUsd()).toBe(0.25);
  });
});
