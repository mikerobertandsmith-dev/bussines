/**
 * The provider catalogue, mirroring `src/lib/integrations.ts` on the client.
 * Kept as a small duplicate because Edge Functions and the Vite app do not share
 * a module graph. This is the server's source of truth for what a provider needs.
 */
export type IntegrationProvider = "serpapi" | "apify" | "reviews" | "mallary" | "llm";

/**
 * The credentials a provider needs. Two of them are not vendors we buy from but
 * capabilities: `reviews` is assembled from the two readers below (so either key
 * alone switches it on), and `llm` is whatever OpenAI-compatible endpoint
 * `LLM_BASE_URL` points at — Groq by default, with LLM_MODEL choosing the model.
 */
export const PROVIDER_ENV_KEYS: Record<IntegrationProvider, string[]> = {
  serpapi: ["SERPAPI_KEY"],
  apify: ["APIFY_TOKEN"],
  reviews: ["SERPAPI_KEY", "APIFY_TOKEN"],
  mallary: ["MALLARY_API_KEY"],
  llm: ["GROQ_API_KEY"],
};

export const PROVIDERS = Object.keys(PROVIDER_ENV_KEYS) as IntegrationProvider[];

/** A provider is usable once every one of its env keys is present. */
export function providerConfigured(
  provider: IntegrationProvider,
  has: (key: string) => boolean,
): boolean {
  // Review reading is served by SerpApi (Google, TripAdvisor) and Apify
  // (everything else), so one configured reader is enough to start syncing.
  if (provider === "reviews") return has("SERPAPI_KEY") || has("APIFY_TOKEN");
  return PROVIDER_ENV_KEYS[provider].every(has);
}
