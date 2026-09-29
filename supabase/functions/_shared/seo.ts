/**
 * Search-visibility scoring for `serp-scan`.
 *
 * The My Business health card reads its SEO score straight off the business row.
 * Nothing derived that number before, so it sat at whatever onboarding wrote —
 * a figure no scan produced. These helpers are the derivation: `serp-scan` writes
 * the rankings, then reads them back and turns them into the score, the top-10
 * count and the average position on the same pass, so the card cannot show a
 * number that came from nowhere.
 *
 * ## What is counted
 *
 * One standing per **tracked term**, from the keyword's **desktop** rows. The
 * Search tab renders the desktop standings, so counting the same set is what
 * keeps the headline and the table from disagreeing; the scan still stores a
 * mobile row per term, and the table's device toggle shows it. A term absent from
 * the results we fetched counts as zero points rather than being skipped — not
 * ranking for a term you track is a fact about your visibility, not missing data.
 *
 * Nothing here is a guess about a provider's field names: it reads `position` and
 * `is_rich_result`, which `serp-scan` itself wrote from SerpApi's response.
 */

/** One tracked term's standing, as far as the scan could see. */
export interface TermStanding {
  /** Best (lowest) position found, 1-based. `null` when we are not in the results. */
  position: number | null;
  /** Whether our result carried a rich snippet. */
  isRichResult: boolean;
}

/** The rows `serp-scan` reads back to build the standings, in their column names. */
export interface RankingRow {
  keyword: string;
  position: number | string | null;
  is_rich_result: boolean | null;
}

/**
 * Points a term earns, by where it sits.
 *
 * The bands are the ones that mean something to a shop: the top 3 is the
 * click-magnet zone, the rest of page one is worth far less, and anything past 50
 * is barely visibility at all. They are deliberately coarse — a score that moved
 * a point for every position would be noise, not a trend.
 */
const BANDS: { upTo: number; points: number }[] = [
  { upTo: 3, points: 100 },
  { upTo: 10, points: 70 },
  { upTo: 20, points: 40 },
  { upTo: 50, points: 15 },
  { upTo: Number.POSITIVE_INFINITY, points: 5 },
];

/**
 * A rich snippet earns a small credit on top of the band.
 *
 * It is the same position earning more clicks — reviews, price, availability —
 * which is what the score is a proxy for. Capped, so a rich result can never push
 * a term past a perfect 100.
 */
const RICH_CREDIT = 10;

/** The points one term contributes to the score. */
export function pointsFor(standing: TermStanding): number {
  const position = standing.position;
  if (position === null || !Number.isFinite(position) || position <= 0) return 0;
  const band = BANDS.find((entry) => position <= entry.upTo)?.points ?? 0;
  return Math.min(100, band + (standing.isRichResult ? RICH_CREDIT : 0));
}

/** What one scan's standings say about the workspace. */
export interface SearchSummary {
  /** 0–100, the mean of every tracked term's points. */
  seoScore: number;
  /** Tracked terms sitting in the top 10. */
  top10Count: number;
  /** Tracked terms we appear for at all. */
  rankedCount: number;
  /** Mean position across the terms we appear for; 0 when we appear for none. */
  avgPosition: number;
  /** Tracked terms the summary was computed over. */
  terms: number;
}

/**
 * The score, the top-10 count and the average position, from the standings.
 *
 * An empty list answers zeros rather than throwing: with nothing scanned there is
 * no score to report, and `serp-scan` does not write the summary at all in that
 * case, which keeps an onboarding figure from being overwritten by a blank one.
 */
export function summariseRankings(standings: TermStanding[]): SearchSummary {
  if (!standings.length) {
    return { seoScore: 0, top10Count: 0, rankedCount: 0, avgPosition: 0, terms: 0 };
  }

  let points = 0;
  let top10Count = 0;
  let rankedCount = 0;
  let positionSum = 0;

  for (const standing of standings) {
    points += pointsFor(standing);
    const position = standing.position;
    if (position === null || !Number.isFinite(position) || position <= 0) continue;
    rankedCount += 1;
    positionSum += position;
    if (position <= 10) top10Count += 1;
  }

  return {
    seoScore: Math.round(points / standings.length),
    top10Count,
    rankedCount,
    // One decimal: the card shows it as "12.4", and a wider figure would read as
    // precision the position data does not have.
    avgPosition: rankedCount ? Number((positionSum / rankedCount).toFixed(1)) : 0,
    terms: standings.length,
  };
}

/**
 * One standing per keyword from the rows of a scan.
 *
 * `serp-scan` stores a row per keyword **per device**; the card counts terms, so
 * the rows are folded here. The best position across the devices present wins,
 * and a rich result on any of them counts — after the fold there is exactly one
 * standing per term, and no term is counted twice.
 */
export function standingsByKeyword(rows: RankingRow[]): TermStanding[] {
  const byKeyword = new Map<string, TermStanding>();

  for (const row of rows) {
    const raw = typeof row.position === "string" ? Number(row.position) : row.position;
    const position = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
    const rich = Boolean(row.is_rich_result);
    const current = byKeyword.get(row.keyword);

    if (!current) {
      byKeyword.set(row.keyword, { position, isRichResult: rich });
      continue;
    }

    current.isRichResult = current.isRichResult || rich;
    if (position !== null && (current.position === null || position < current.position)) {
      current.position = position;
    }
  }

  return [...byKeyword.values()];
}
