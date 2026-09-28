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

export interface SerpApiResponse {
  search_metadata?: { id?: string; status?: string; total_time_taken?: number };
  organic_results?: SerpApiOrganicResult[];
  local_results?: SerpApiLocalResult[];
  place_results?: SerpApiLocalResult;
  suggestions?: SerpApiSuggestion[];
  /** Present on the review engines (`google_maps_reviews`, `tripadvisor_reviews`). */
  reviews?: Record<string, unknown>[];
  search_information?: { total_reviews?: number };
  serpapi_pagination?: { next_page_token?: string };
  error?: string;
}

/** Runs one SerpApi search. Cached results (the default) are free on SerpApi. */
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
