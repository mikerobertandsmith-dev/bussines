import { HttpError } from "./errors.ts";
import { getEnv, hasEnv, requireEnv } from "./env.ts";
import { fetchJson } from "./http.ts";

/**
 * The model client behind the AI drafting tasks in `ai-draft`.
 *
 * Groq speaks the OpenAI chat-completions shape, so this is a plain HTTP POST
 * with no SDK — which keeps the provider swappable (blueprint §6.5): point
 * `LLM_BASE_URL` at any OpenAI-compatible endpoint and nothing else changes.
 *
 * Every task asks for JSON, but a model can still answer with prose, a code
 * fence, or a shape we did not ask for. So the reply is *parsed and validated
 * here* rather than trusted, and one corrective retry is allowed before the
 * caller gets a clear error instead of a half-built draft.
 *
 * Nothing in this module writes anything. AI output is always a draft the user
 * confirms — see the guardrail in `ai-draft/index.ts`.
 */

/** Groq's production-tier 120B model; override with LLM_MODEL. */
export const DEFAULT_LLM_MODEL = "openai/gpt-oss-120b";
const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * The default model's published rates, per 1M tokens. Usage is costed from
 * these so the Plan usage panel shows real dollars — see `llmCostUsd`.
 */
const DEFAULT_INPUT_USD_PER_MTOK = 0.15;
const DEFAULT_OUTPUT_USD_PER_MTOK = 0.6;

/** How long one completion may take before we give up on it. */
const REQUEST_TIMEOUT_MS = 45_000;

/** True when the server holds a key for the drafting endpoint. */
export function llmConfigured(): boolean {
  return hasEnv("GROQ_API_KEY");
}

export function draftModel(): string {
  return getEnv("LLM_MODEL") || DEFAULT_LLM_MODEL;
}

function baseUrl(): string {
  return (getEnv("LLM_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function rateUsd(envKey: string, fallback: number): number {
  const raw = Number(getEnv(envKey));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/**
 * What one call cost, from its token counts and the configured rates. Rounded to
 * six decimals because that is the precision `api_usage_log.cost_usd` now stores
 * (see `0018_keyword_clusters.sql`): a drafting call costs a few hundredths of a
 * cent, and rounding to four would record every one of them as zero.
 */
export function llmCostUsd(promptTokens: number, completionTokens: number): number {
  const input = rateUsd("LLM_INPUT_USD_PER_MTOK", DEFAULT_INPUT_USD_PER_MTOK);
  const output = rateUsd("LLM_OUTPUT_USD_PER_MTOK", DEFAULT_OUTPUT_USD_PER_MTOK);
  const cost = (promptTokens / 1_000_000) * input + (completionTokens / 1_000_000) * output;
  return Number(cost.toFixed(6));
}

/** The parts of a chat-completions reply we read. */
interface RawCompletion {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  model?: unknown;
}

/** One validated draft, with what it cost to produce. */
export interface DraftResult<T> {
  data: T;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export interface DraftRequest<T> {
  /** The instructions. Also where the output's JSON shape is stated. */
  system: string;
  /** The material to work from, delimited and marked as untrusted data. */
  user: string;
  /**
   * Turns the parsed reply into `T`, or returns null when the model ignored the
   * shape we asked for. Null triggers the one corrective retry.
   */
  parse: (raw: Record<string, unknown>) => T | null;
  maxTokens?: number;
}

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Asks the model for one JSON object and returns it validated.
 *
 * Two attempts at most: the second exists because a model that answers with
 * prose or the wrong shape usually corrects itself when told exactly what was
 * wrong. A second failure is a 502 — the caller reports it rather than shipping
 * a half-parsed draft to the user.
 */
export async function completeJson<T>(request: DraftRequest<T>): Promise<DraftResult<T>> {
  const key = requireEnv("GROQ_API_KEY");
  const model = draftModel();
  const messages: Message[] = [
    { role: "system", content: request.system },
    { role: "user", content: request.user },
  ];

  let promptTokens = 0;
  let completionTokens = 0;
  let problem = "the reply was not the JSON we asked for";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchJson<RawCompletion>(`${baseUrl()}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: {
        model,
        messages,
        // JSON mode. The word "JSON" has to appear in the prompt for an
        // OpenAI-compatible endpoint to honour this, which is why every task
        // prompt in `ai-draft` states its output shape explicitly.
        response_format: { type: "json_object" },
        max_completion_tokens: request.maxTokens ?? 900,
        // Low, not zero: drafting should sound like a person, not a template.
        temperature: 0.4,
      },
      timeoutMs: REQUEST_TIMEOUT_MS,
      // Groq rate-limits per minute, so one backoff retry is worth having. A
      // rejected key or a malformed body fails fast instead.
      retries: 1,
    });

    const usage = response.usage ?? {};
    promptTokens += Number(usage.prompt_tokens ?? 0) || 0;
    completionTokens += Number(usage.completion_tokens ?? 0) || 0;

    const content = response.choices?.[0]?.message?.content;
    const object = parseJsonObject(content);
    const data = object === null ? null : request.parse(object);
    if (data !== null) {
      return {
        data,
        model: typeof response.model === "string" && response.model ? response.model : model,
        promptTokens,
        completionTokens,
        costUsd: llmCostUsd(promptTokens, completionTokens),
      };
    }

    problem = object === null ? "the reply was not valid JSON" : "the reply ignored the JSON shape asked for";
    messages.push({ role: "assistant", content: typeof content === "string" ? content : "" });
    messages.push({
      role: "user",
      content: `That reply ${problem}. Send the same answer again as JSON only — no prose, no explanation, no code fences.`,
    });
  }

  throw new HttpError(
    502,
    `The drafting model did not return usable JSON (${problem}). Try again in a moment.`,
  );
}

/**
 * The object inside a JSON-mode reply, or null when there is not one. Code
 * fences are stripped rather than rejected: smaller models wrap their JSON in
 * them even when told not to, and that is not worth a retry.
 */
function parseJsonObject(content: unknown): Record<string, unknown> | null {
  if (typeof content !== "string") return null;
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    // Arrays are rejected here on purpose: every task answers with an object, so
    // a bare array means the model answered something else.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ helpers */

/** A trimmed string from a model reply, or "" when it is not usable. */
export function textOf(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * The strings in a model-supplied array, cleaned and de-duplicated.
 *
 * `allowedLower` is the important part: when a task must only reuse values we
 * already hold (keyword clusters, say), anything the model invented is dropped
 * here rather than shown to the user as a real suggestion.
 */
export function listOf(
  value: unknown,
  options: { max: number; maxLength: number; allowedLower?: Set<string> },
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of value) {
    const text = textOf(entry, options.maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (options.allowedLower && !options.allowedLower.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= options.max) break;
  }

  return out;
}
