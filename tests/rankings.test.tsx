import { describe, expect, it } from "vitest";
import { latestDesktopScan, mergeSeoRankings } from "../src/lib/rankings";
import type { RankRow, SerpRanking } from "../src/lib/types";

function scan(overrides: Partial<SerpRanking> & { keyword: string }): SerpRanking {
  return {
    device: "desktop",
    location: "Kenya",
    position: 5,
    url: "",
    title: "",
    snippetType: "",
    isRichResult: false,
    previousPosition: null,
    previousIsRichResult: null,
    previousSnippetType: "",
    checkedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function tracked(overrides: Partial<RankRow> & { keyword: string }): RankRow {
  return { volume: 1000, position: null, change: 0, ...overrides };
}

describe("mergeSeoRankings", () => {
  it("replaces a tracked placeholder with the live position from the scan", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "velvet lip kit", position: null })],
      [scan({ keyword: "velvet lip kit", position: 3 })],
    );

    expect(rows).toEqual([{ keyword: "velvet lip kit", volume: 1000, position: 3, change: 0 }]);
  });

  it("turns a previous position into movement, positive when the keyword moved up", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "up" }), tracked({ keyword: "down" })],
      [
        scan({ keyword: "up", position: 4, previousPosition: 9 }),
        scan({ keyword: "down", position: 7, previousPosition: 2 }),
      ],
    );

    expect(rows.find((r) => r.keyword === "up")?.change).toBe(5);
    expect(rows.find((r) => r.keyword === "down")?.change).toBe(-5);
  });

  it("leaves a keyword we have not scanned on its tracked values", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "never scanned", position: 11, change: 2 })],
      [scan({ keyword: "another term", position: 1 })],
    );

    expect(rows[0]).toMatchObject({ position: 11, change: 2 });
  });

  it("keeps 'not in the results' distinct from a rank of zero", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "missing", position: 9 })],
      [scan({ keyword: "missing", position: null, previousPosition: 9 })],
    );

    expect(rows[0].position).toBeNull();
    // No longer ranked: there is no movement to report.
    expect(rows[0].change).toBe(0);
  });

  it("ignores mobile rows and sorts unranked terms last", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "desktop term" }), tracked({ keyword: "unranked term", position: 8 })],
      [
        scan({ keyword: "desktop term", device: "mobile", position: 2 }),
        scan({ keyword: "unranked term", position: null, previousPosition: 8 }),
      ],
    );

    expect(rows.map((r) => r.keyword)).toEqual(["desktop term", "unranked term"]);
    expect(rows[0].position).toBeNull();
  });

  it("uses the newest scan when a keyword has been scanned more than once", () => {
    const rows = mergeSeoRankings(
      [tracked({ keyword: "velvet lip kit" })],
      [
        scan({ keyword: "velvet lip kit", position: 8, checkedAt: "2026-09-01T00:00:00.000Z" }),
        scan({ keyword: "velvet lip kit", position: 2, checkedAt: "2026-09-20T00:00:00.000Z" }),
      ],
    );

    expect(rows[0].position).toBe(2);
  });
});

describe("latestDesktopScan", () => {
  it("returns undefined when the keyword was only scanned on mobile", () => {
    const found = latestDesktopScan(
      [scan({ keyword: "velvet lip kit", device: "mobile", position: 3 })],
      "velvet lip kit",
    );

    expect(found).toBeUndefined();
  });
});
