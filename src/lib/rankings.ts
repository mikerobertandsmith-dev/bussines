import type { RankRow, SerpRanking } from "./types";

/**
 * Overlays the live Google positions from `serp_rankings` onto the tracked
 * keyword rows the My Business → SEO tab renders.
 *
 * The tracked list is the source of truth for *which* terms we watch; the scan
 * is the source of truth for *where we sit* on them. A keyword we have not
 * scanned yet keeps whatever its tracked row carries, so the table never
 * invents a rank. `position: null` means "not in the results we fetched".
 */

/** The newest desktop scan for a keyword, or undefined when there is none. */
export function latestDesktopScan(
  scans: SerpRanking[],
  keyword: string,
): SerpRanking | undefined {
  let best: SerpRanking | undefined;
  for (const scan of scans) {
    if (scan.device !== "desktop" || scan.keyword !== keyword) continue;
    if (!best || scan.checkedAt > best.checkedAt) best = scan;
  }
  return best;
}

/** Best rank first; keywords we do not appear for sort to the bottom. */
function byPosition(a: RankRow, b: RankRow): number {
  return (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY);
}

/**
 * The SEO table's rows: tracked keywords, with the live position and movement
 * since the previous scan folded in. `change` is an improvement, so a positive
 * number means the keyword moved *up* (matching `DeltaPill`'s tone).
 */
export function mergeSeoRankings(tracked: RankRow[], scans: SerpRanking[]): RankRow[] {
  return tracked
    .map((row) => {
      const scan = latestDesktopScan(scans, row.keyword);
      if (!scan) return row;
      return {
        ...row,
        position: scan.position,
        change:
          scan.position !== null && scan.previousPosition !== null
            ? scan.previousPosition - scan.position
            : 0,
      };
    })
    .sort(byPosition);
}
