import { describe, expect, it } from "vitest";
import {
  pointsFor,
  standingsByKeyword,
  summariseRankings,
  type TermStanding,
} from "../supabase/functions/_shared/seo";

/**
 * The search visibility `serp-scan` writes back onto the business row.
 *
 * The My Business health card shows these figures as scan results, so the thing
 * worth pinning down is that they are derived from the standings and say what the
 * card claims: a score that cannot be produced from nowhere, a top-10 count that
 * counts terms rather than checks, and an average that ignores terms we do not
 * rank for instead of counting them as position zero.
 */

describe("search visibility points", () => {
  it("pays by band, and pays a tracked term we do not rank for nothing", () => {
    expect(pointsFor({ position: null, isRichResult: false })).toBe(0);
    expect(pointsFor({ position: 1, isRichResult: false })).toBe(100);
    expect(pointsFor({ position: 3, isRichResult: false })).toBe(100);
    // Page one, outside the click-magnet zone.
    expect(pointsFor({ position: 4, isRichResult: false })).toBe(70);
    expect(pointsFor({ position: 10, isRichResult: false })).toBe(70);
    expect(pointsFor({ position: 11, isRichResult: false })).toBe(40);
    expect(pointsFor({ position: 20, isRichResult: false })).toBe(40);
    expect(pointsFor({ position: 21, isRichResult: false })).toBe(15);
    expect(pointsFor({ position: 50, isRichResult: false })).toBe(15);
    expect(pointsFor({ position: 51, isRichResult: false })).toBe(5);
    expect(pointsFor({ position: 400, isRichResult: false })).toBe(5);
  });

  it("credits a rich snippet, without letting it push a term past a perfect score", () => {
    expect(pointsFor({ position: 6, isRichResult: true })).toBe(80);
    // 100 + 10 would be a score no term can contribute; the cap is the point.
    expect(pointsFor({ position: 1, isRichResult: true })).toBe(100);
    // A rich snippet on a term we do not rank for is still nothing: the position
    // is the evidence, and a snippet we cannot see cannot be credited.
    expect(pointsFor({ position: null, isRichResult: true })).toBe(0);
  });

  it("treats an impossible position as not ranking", () => {
    // SerpApi positions are 1-based; a 0 or a negative is a malformed row, not the
    // best possible rank.
    expect(pointsFor({ position: 0, isRichResult: false })).toBe(0);
    expect(pointsFor({ position: -1, isRichResult: false })).toBe(0);
  });
});

describe("search visibility summary", () => {
  it("answers nothing at all for a workspace with no standings", () => {
    expect(summariseRankings([])).toEqual({
      seoScore: 0,
      top10Count: 0,
      rankedCount: 0,
      avgPosition: 0,
      terms: 0,
    });
  });

  it("averages every tracked term, but only positions for the average position", () => {
    const standings: TermStanding[] = [
      { position: 3, isRichResult: false },
      { position: 12, isRichResult: false },
      { position: null, isRichResult: false },
      { position: 5, isRichResult: true },
    ];

    const summary = summariseRankings(standings);

    // 100 + 40 + 0 + (70 + 10) = 220, over all four tracked terms.
    expect(summary.seoScore).toBe(55);
    // Two of the four sit in the top 10 — terms, not keyword×device checks.
    expect(summary.top10Count).toBe(2);
    expect(summary.rankedCount).toBe(3);
    // (3 + 12 + 5) / 3 — the term we do not rank for is left out, not read as 0.
    expect(summary.avgPosition).toBe(6.7);
    expect(summary.terms).toBe(4);
  });

  it("reports no average position rather than zero when we rank for nothing", () => {
    const summary = summariseRankings([
      { position: null, isRichResult: false },
      { position: null, isRichResult: true },
    ]);

    expect(summary).toEqual({
      seoScore: 0,
      top10Count: 0,
      rankedCount: 0,
      avgPosition: 0,
      terms: 2,
    });
  });
});

describe("standings folded from ranking rows", () => {
  it("keeps one standing per term, on its best device, with a rich result from either", () => {
    const standings = standingsByKeyword([
      { keyword: "lip kit", position: 8, is_rich_result: false },
      { keyword: "lip kit", position: 3, is_rich_result: true },
      { keyword: "gan charger", position: "22", is_rich_result: null },
      { keyword: "brake pads", position: null, is_rich_result: false },
    ]);

    expect(standings).toEqual([
      { position: 3, isRichResult: true },
      { position: 22, isRichResult: false },
      { position: null, isRichResult: false },
    ]);
  });

  it("reads a malformed position as \"not ranking\" instead of a rank", () => {
    const [standing] = standingsByKeyword([
      { keyword: "serum", position: 0, is_rich_result: false },
    ]);
    expect(standing).toEqual({ position: null, isRichResult: false });
  });
});
