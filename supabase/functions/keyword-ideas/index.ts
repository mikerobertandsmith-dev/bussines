import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { affordableCount, budgetMessage, readBudget } from "../_shared/budget.ts";
import { serpApi } from "../_shared/serpapi.ts";

/** Suggestions we keep per seed. */
const MAX_IDEAS = 20;
/** Intent words people actually type, probed only when the caller asks. */
const EXPANSION_PREFIXES = ["best", "how to", "cheap"];

/**
 * Keyword ideas from Google Autocomplete (SerpApi `engine=google_autocomplete`).
 *
 * Suggestions are stored per seed so the UI can show relevance and the user can
 * promote one into their tracked keywords. Deploy with `--no-verify-jwt`.
 */
interface Body {
  businessId?: string;
  seed?: string;
  country?: string;
  language?: string;
  /** Probe the intent-word prefixes as well, for a wider suggestion set. */
  expand?: boolean;
}

function mapIdea(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    seed: String(row.seed ?? ""),
    suggestion: String(row.suggestion ?? ""),
    relevance: Number(row.relevance ?? 0),
    source: String(row.source ?? "autocomplete"),
    savedAsKeyword: Boolean(row.saved_as_keyword),
    createdAt: String(row.created_at ?? ""),
  };
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!hasEnv("SERPAPI_KEY")) {
      throw new HttpError(
        409,
        "SerpApi is not configured on the server. Add SERPAPI_KEY to the function secrets.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const seed = String(body.seed ?? "").trim();
    if (seed.length < 2) {
      throw new HttpError(400, "Type at least two characters to search for keyword ideas.");
    }

    const db = adminClient();

    // The seed query, plus — when asked — the intent-word probes that surface the
    // "best X" / "how to X" phrasing people actually search. Each probe is one
    // SerpApi search, so the expansion is budget-checked exactly like a scan.
    const probes = body.expand
      ? [seed, ...EXPANSION_PREFIXES.map((prefix) => `${prefix} ${seed}`)]
      : [seed];
    const budget = await readBudget(db, businessId, "serpapi");
    const affordable = affordableCount(budget.remaining, 1);
    if (affordable < 1) throw new HttpError(429, budgetMessage("serpapi", budget, 1));
    const queries = probes.slice(0, Math.min(probes.length, affordable));

    // Merge the probes, keeping the highest relevance seen for each suggestion.
    const found = new Map<string, { suggestion: string; relevance: number }>();
    for (const query of queries) {
      const response = await serpApi({
        engine: "google_autocomplete",
        q: query,
        gl: body.country || undefined,
        hl: body.language || "en",
        // Cached suggestions are free; accept the cache unless it is stale.
        no_cache: false,
      });
      for (const entry of response.suggestions ?? []) {
        const suggestion = String(entry.value ?? "").trim();
        if (!suggestion) continue;
        const relevance = Math.round(Number(entry.relevance ?? 0));
        const known = found.get(suggestion);
        if (!known || relevance > known.relevance) found.set(suggestion, { suggestion, relevance });
      }
    }

    const suggestions = [...found.values()]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, MAX_IDEAS);

    if (suggestions.length) {
      const { error } = await db.from("keyword_ideas").upsert(
        suggestions.map((entry) => ({
          business_id: businessId,
          seed,
          suggestion: entry.suggestion,
          relevance: entry.relevance,
          source: "autocomplete",
        })),
        { onConflict: "business_id,seed,suggestion" },
      );
      if (error) throw new HttpError(500, error.message);
    }

    await recordUsage(db, {
      businessId,
      provider: "serpapi",
      endpoint: "google_autocomplete",
      units: queries.length,
      detail: queries.length > 1 ? `${seed} (+${queries.length - 1} intent probes)` : seed,
    });

    const { data: saved } = await db
      .from("keyword_ideas")
      .select("*")
      .eq("business_id", businessId)
      .eq("seed", seed)
      .order("relevance", { ascending: false })
      .limit(20);

    return json({ seed, ideas: (saved ?? []).map((row) => mapIdea(row as Record<string, unknown>)) });
  } catch (error) {
    return failure(error);
  }
});
