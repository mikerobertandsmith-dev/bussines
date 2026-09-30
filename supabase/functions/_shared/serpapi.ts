import { requireEnv } from "./env.ts";
import { fetchJson } from "./http.ts";

/**
 * Thin SerpApi client. Every capability (organic search, Google Maps, local
 * pack, autocomplete) is the same endpoint with a different `engine`, so one
 * helper covers them all. See https://serpapi.com/search-api.
 */
const SERPAPI_BASE = "https://serpapi.com/search";

export type SerpApiParam = string | number | boolean | undefined;

export interface SerpApiOrganicResult {
  position?: number;
  title?: string;
  link?: string;
  snippet?: string;
  rich_snippet?: Record<string, unknown>;
  rich_snippet_table?: string;
}

export interface SerpApiLocalResult {
  position?: number;
  title?: string;
  place_id?: string;
  data_id?: string;
  rating?: number;
  reviews?: number;
  type?: string;
  address?: string;
  phone?: string;
  website?: string;
  hours?: unknown;
  thumbnail?: string;
}

export interface SerpApiSuggestion {
  value?: string;
  relevance?: number;
  type?: string;
}

/** One block of an AI Overview's prose. `list` items carry their own snippets. */
export interface AiOverviewBlock {
  type?: string;
  snippet?: string;
  list?: { snippet?: string }[];
}

/** One source the AI Overview cited. */
export interface AiOverviewReference {
  title?: string;
  link?: string;
  snippet?: string;
}

/**
 * The AI Overview attached to a Google result.
 *
 * On the first response this carries only `page_token`/`serpapi_link`: the overview
 * body is a **second** SerpApi request (`engine=google_ai_overview`). On that second
 * response the same key carries the prose and the citation list.
 */
export interface SerpApiAiOverview {
  page_token?: string;
  serpapi_link?: string;
  text_blocks?: AiOverviewBlock[];
  references?: AiOverviewReference[];
}

export interface SerpApiResponse {
  search_metadata?: { id?: string; status?: string; total_time_taken?: number };
  ai_overview?: SerpApiAiOverview;
  organic_results?: SerpApiOrganicResult[] | Record<string, unknown>;
  /**
   * Not always an array: see `localResultsOf`.
   */
  local_results?: SerpApiLocalResult[] | Record<string, unknown>;
  place_results?: SerpApiLocalResult;
  suggestions?: SerpApiSuggestion[];
  /** Present on the review engines (`google_maps_reviews`, `tripadvisor_reviews`). */
  reviews?: Record<string, unknown>[];
  search_information?: { total_reviews?: number };
  serpapi_pagination?: { next_page_token?: string };
  error?: string;
}

/** Runs one SerpApi search. Cached results (the default) are free on SerpApi. */
/**
 * The whole prose of an AI Overview, as one string.
 *
 * The overview is a tree: paragraphs and headings carry `snippet`, and a list block
 * carries its items under `list`. Both levels are flattened here so a caller can
 * search the answer for a brand name without knowing that shape.
 */
export function aiOverviewText(overview: SerpApiAiOverview | undefined): string {
  const parts: string[] = [];
  for (const block of overview?.text_blocks ?? []) {
    if (typeof block.snippet === "string") parts.push(block.snippet);
    for (const item of block.list ?? []) {
      if (typeof item.snippet === "string") parts.push(item.snippet);
    }
  }
  return parts.join("\n").trim();
}

/**
 * Fetches an AI Overview's body from the token the first Google response returned.
 *
 * Its own request, and one that can legitimately fail — plenty of queries have no
 * overview, and SerpApi answers those with an `error` field on a 200. That is a
 * normal outcome of the scan, not a fault in it, so this answers `null` rather
 * than throwing: an unhandled throw here would abort the whole rankings pass.
 */
export async function fetchAiOverview(pageToken: string): Promise<SerpApiAiOverview | null> {
  if (!pageToken) return null;
  try {
    const response = await serpApi({
      engine: "google_ai_overview",
      page_token: pageToken,
      hl: "en",
    });
    return response.ai_overview ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether an AI Overview cited a business, and how prominently.
 *
 * "Cited" means the answer names the brand, or lists a source on its domain — the
 * two ways an AI answer actually puts a business in front of someone. The position
 * is the 1-based index of the first of the business's own sources, or 0 when the
 * overview mentioned it only in prose; `cited` is what the panel gates on.
 */
export function citationOf(
  overview: SerpApiAiOverview | undefined,
  domain: string,
  brandName: string,
): { cited: boolean; position: number; sources: number } {
  const sources = overview?.references ?? [];
  const brand = brandName.trim().toLowerCase();

  for (let index = 0; index < sources.length; index += 1) {
    const host = hostnameOf(String(sources[index]?.link ?? ""));
    if (domain && host && (host === domain || host.endsWith(`.${domain}`))) {
      return { cited: true, position: index + 1, sources: sources.length };
    }
  }

  const text = aiOverviewText(overview).toLowerCase();
  if (brand && text.includes(brand)) return { cited: true, position: 0, sources: sources.length };
  return { cited: false, position: 0, sources: sources.length };
}

/**
 * How much one AI answer's treatment of a business is worth, 0–1.
 *
 * The GEO score is a coverage figure — the share of tracked terms whose AI answer
 * puts the business in front of someone — and this is what makes "in front of
 * someone" mean something. Being listed as a *source* is the strong outcome: the
 * answer actually points at the site, and the nearer the top of that list the
 * better. A brand named only in the prose is a passing mention — it tells the
 * reader the name but sends them nowhere — so it is worth less than the weakest
 * listed source.
 *
 * Bounded at 1 so a business cited as the first source for every term scores
 * exactly 100, which is what makes the number comparable between workspaces and
 * across runs.
 */
export function citationWeight(citation: {
  cited: boolean;
  position: number;
  sources: number;
}): number {
  if (!citation.cited) return 0;
  // Listed as a source: the first is worth the full point, the last about 0.6.
  if (citation.position >= 1) {
    const sources = Math.max(1, citation.sources);
    const rank = 1 - ((citation.position - 1) / sources) * 0.4;
    return Number(Math.max(0.6, Math.min(1, rank)).toFixed(3));
  }
  // Named in the prose only, with no listed source of ours.
  return 0.5;
}

export async function serpApi(params: Record<string, SerpApiParam>): Promise<SerpApiResponse> {
  const url = new URL(SERPAPI_BASE);
  url.searchParams.set("api_key", requireEnv("SERPAPI_KEY"));
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetchJson<SerpApiResponse>(url.toString(), {
    timeoutMs: 45_000,
    retries: 1,
  });
  if (response.error) throw new Error(`SerpApi: ${response.error}`);
  return response;
}

/**
 * The organic results as a list, whatever shape SerpApi answered with.
 *
 * The same defensiveness as `localResultsOf`, for the same reason: the engines
 * disagree about whether this is an array or an object, and one unanticipated
 * shape used to take out an entire scan.
 */
export function organicResultsOf(response: SerpApiResponse): SerpApiOrganicResult[] {
  const raw = response.organic_results as unknown;
  if (Array.isArray(raw)) return raw as SerpApiOrganicResult[];
  return [] as SerpApiOrganicResult[];
}

/**
 * The local pack as a list, whatever shape SerpApi answered with.
 *
 * `local_results` is an array on most engines but **an object** on others — the
 * Google engine in mobile device mode answers with the expanded "more places"
 * block, `{ places: [...], more_locations_link }`, and the plain Google engine on
 * desktop omits the key entirely. Every caller wants the list, so every shape is
 * flattened here rather than at each call site: reading `.slice` off the object
 * threw, and because the mobile read ran inside the scan's keyword loop that one
 * shape difference failed the whole run before it persisted anything.
 */
export function localResultsOf(response: SerpApiResponse): SerpApiLocalResult[] {
  const raw = response.local_results as unknown;
  if (Array.isArray(raw)) return raw as SerpApiLocalResult[];
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (Array.isArray(record.places)) return record.places as SerpApiLocalResult[];
    // Otherwise it is keyed by index ("0", "1", …); keep the entries that are
    // listings rather than the scalar extras that ride alongside them.
    return Object.values(record).filter(
      (entry): entry is SerpApiLocalResult =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
    );
  }
  return [];
}

/** Hostname without `www.`, so a stored domain can be matched against result links. */
export function hostnameOf(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(
      /^www\./,
      "",
    );
  } catch {
    return trimmed.replace(/^www\./, "").split("/")[0].toLowerCase();
  }
}

/** Which kind of rich result a `google` organic entry carries, if any. */
export function snippetTypeOf(result: SerpApiOrganicResult | undefined): string {
  if (!result) return "";
  if (result.rich_snippet_table) return "table";
  const rich = result.rich_snippet as Record<string, unknown> | undefined;
  if (!rich) return "";
  for (const key of Object.keys(rich)) {
    if (key === "bottom" || key === "top") continue;
    return key;
  }
  return "rich";
}

/**
 * Finds the organic result that belongs to a business, matching by domain first
 * (exact or subdomain) and falling back to the brand name in the title.
 */
export function findOrganicResult(
  results: SerpApiOrganicResult[],
  domain: string,
  brandName: string,
): SerpApiOrganicResult | undefined {
  const brand = brandName.trim().toLowerCase();
  return results.find((result) => {
    const host = hostnameOf(String(result.link ?? ""));
    if (domain && (host === domain || host.endsWith(`.${domain}`))) return true;
    return Boolean(brand) && String(result.title ?? "").toLowerCase().includes(brand);
  });
}

/** Whether a Google Maps local result is this business, by website or name. */
export function matchLocalPlace(
  place: SerpApiLocalResult,
  domain: string,
  brandName: string,
): boolean {
  const host = hostnameOf(String(place.website ?? ""));
  if (domain && host && (host === domain || host.endsWith(`.${domain}`))) return true;
  const name = String(place.title ?? "").toLowerCase();
  const brand = brandName.trim().toLowerCase();
  return Boolean(brand) && (name === brand || (brand.length > 4 && name.includes(brand)));
}

/** One Google Business Profile completeness check. */
export interface LocalProfileCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Scores a Maps listing 0–100 with a per-check breakdown the UI can render. */
export function buildProfileChecks(place: SerpApiLocalResult): LocalProfileCheck[] {
  const rating = Number(place.rating ?? 0);
  const hours = place.hours as unknown;
  return [
    {
      label: "Website linked",
      ok: Boolean(place.website),
      detail: place.website ? String(place.website) : "No website on the listing",
    },
    {
      label: "Phone number",
      ok: Boolean(place.phone),
      detail: place.phone ? String(place.phone) : "Add a contact number",
    },
    {
      label: "Opening hours",
      ok: Boolean(hours),
      detail: hours ? "Hours published" : "Add opening hours",
    },
    {
      label: "Photos",
      ok: Boolean(place.thumbnail),
      detail: place.thumbnail ? "Photos present" : "Add photos",
    },
    {
      label: "Category set",
      ok: Boolean(place.type),
      detail: String(place.type ?? "Pick a primary category"),
    },
    {
      label: "Rating health",
      ok: rating >= 4.3,
      detail: rating ? `${rating.toFixed(1)} average rating` : "No rating yet",
    },
  ];
}
