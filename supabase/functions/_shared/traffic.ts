import { getEnv } from "./env.ts";

/**
 * Website traffic, read from SimilarWeb through Apify.
 *
 * This is the producer behind the traffic panels on My Business and Competition:
 * monthly visits and the channel mix, for our own domain and for every rival's.
 * Nothing wrote those tables before, so the panels could only ever be empty — the
 * pages showed a chart with no series and a "Monthly visits" tile reading 0 while
 * the competitor's own site plainly had visitors.
 *
 * ## What it measures, and what it does not
 *
 * SimilarWeb publishes **estimates**, and they are modelled rather than counted —
 * a third party's traffic figure is always an estimate, and the panels say
 * "estimated" for that reason. It reports a monthly visit series, the share each
 * channel contributed, and a rank. It does **not** report which search surfaces
 * sent the visits, so the "Search surfaces" list has no source here and is left
 * empty rather than filled with a number nothing measured.
 *
 * The field names below were read off the actor's live output
 * (`curious_coder/similarweb-scraper`, input `{ domains: [...] }`), not guessed.
 */

/** One channel's share of a domain's visits. `share` is a percentage, 0–100. */
export interface TrafficChannel {
  label: string;
  share: number;
}

/** One month of the visit series. `sortOrder` is months since the epoch, so the
 *  rows sort chronologically however they are stored. */
export interface TrafficPointRow {
  label: string;
  value: number;
  sortOrder: number;
}

/** One domain's traffic, mapped onto our own columns. */
export interface DomainTraffic {
  domain: string;
  /** Visits in the latest month SimilarWeb reports. */
  visits: number;
  /** Percent change against the previous month; 0 when there is nothing to compare. */
  visitsChange: number;
  series: TrafficPointRow[];
  channels: TrafficChannel[];
}

/**
 * The actor id, as a **bare id** rather than an `owner/name` slug.
 *
 * `startRun` puts the id straight into `/v2/actors/{id}/runs`, and an encoded slug
 * is not a valid actor reference there — the same trap `site-scan` documents for
 * its own actor. Empty means the deployment has not opted in, and the panel reports
 * the feature as off rather than spending.
 */
export function trafficActorId(): string {
  return getEnv("APIFY_TRAFFIC_ACTOR_ID") || "";
}

/** The ceiling for one traffic run, in dollars. */
export function trafficMaxChargeUsd(): number {
  const configured = Number(getEnv("APIFY_TRAFFIC_MAX_CHARGE_USD"));
  return Number.isFinite(configured) && configured > 0 ? configured : 0.25;
}

/** How many domains one run may price, so a big workspace cannot run away. */
export function trafficMaxDomains(): number {
  const configured = Number(getEnv("APIFY_TRAFFIC_MAX_DOMAINS"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(50, configured) : 12;
}

/** A domain as the actor wants it: hostname only, no scheme, no `www.`. */
export function trafficDomain(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

/** "SearchOrganic" → "Search organic", so a channel reads like a channel. */
function channelLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * Months since the epoch for a `YYYY-MM-DD` label, which is what the loader sorts
 * a metric series by. An unparseable date sorts last rather than throwing.
 */
function monthOrder(label: string): number {
  const parsed = Date.parse(`${label}T00:00:00Z`);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 86_400_000);
}

/** Percent change between the last two points, or 0 when there is no comparison. */
function changeOf(series: TrafficPointRow[]): number {
  if (series.length < 2) return 0;
  const previous = series[series.length - 2].value;
  const latest = series[series.length - 1].value;
  if (!previous) return 0;
  return Number((((latest - previous) / previous) * 100).toFixed(1));
}

/** Numbers arriving as strings ("1911397") are common in scraped output. */
function numberOf(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value.replace(/[,\s]/g, "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * One dataset item → one domain's traffic, or null when it is not usable.
 *
 * A domain with no visit figure at all is dropped rather than stored as zero:
 * "SimilarWeb has nothing for this site" and "this site had no visitors" are
 * different facts, and a stored zero would read as the second.
 */
export function normaliseTraffic(item: Record<string, unknown>): DomainTraffic | null {
  if (!item || typeof item !== "object") return null;
  const domain = trafficDomain(String(item.domain ?? ""));
  if (!domain) return null;

  const estimated = (item.estimatedMonthlyVisits ?? {}) as Record<string, unknown>;
  const series: TrafficPointRow[] = Object.entries(estimated)
    .map(([label, value]) => ({ label, value: numberOf(value), sortOrder: monthOrder(label) }))
    .filter((point) => point.value > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // `visits` is SimilarWeb's own headline figure for the latest month; the series'
  // last point is the same number and stands in when the field is absent.
  const visits = numberOf(item.visits) || series.at(-1)?.value || 0;
  if (!visits) return null;

  const sources = (item.trafficSources ?? {}) as Record<string, unknown>;
  const channels: TrafficChannel[] = Object.entries(sources)
    .map(([key, value]) => ({ label: channelLabel(key), share: numberOf(value) * 100 }))
    .filter((channel) => channel.label && channel.share > 0)
    .map((channel) => ({ label: channel.label, share: Number(channel.share.toFixed(2)) }))
    .sort((a, b) => b.share - a.share);

  return { domain, visits, visitsChange: changeOf(series), series, channels };
}

/** Every domain in a dataset item set, so a caller can match one back to a rival. */
export function byDomain(items: Record<string, unknown>[]): Map<string, DomainTraffic> {
  const map = new Map<string, DomainTraffic>();
  for (const item of items) {
    const traffic = normaliseTraffic(item);
    if (traffic) map.set(traffic.domain, traffic);
  }
  return map;
}
