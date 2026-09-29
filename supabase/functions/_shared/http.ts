import { HttpError } from "./errors.ts";

/** Parses a JSON request body, returning `{}` for GET or malformed input. */
export async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T> {
  if (req.method === "GET" || req.method === "HEAD") return {} as T;
  try {
    const body = await req.json();
    return (body && typeof body === "object" ? body : {}) as T;
  } catch {
    return {} as T;
  }
}

export interface FetchJsonOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** Abort a single attempt after this long. */
  timeoutMs?: number;
  /** How many times to retry a transient failure (429 / 5xx / network). */
  retries?: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Whose API a URL belongs to, so a refusal can name it. */
function providerOf(url: string): string {
  if (url.includes("apify.com")) return "Apify";
  if (url.includes("serpapi.com")) return "SerpApi";
  return "The provider";
}

/**
 * A provider's refusal, in words the user can act on.
 *
 * `Provider request failed (403)` is technically accurate and practically
 * useless: it is what the pages showed on 2026-09-29 while **every** Apify-backed
 * panel looked broken — supplier catalogue reads, competitor inventory, social,
 * traffic and advertising all at once — because the account had spent its $5
 * monthly allowance ($5.07). Nothing said so, so the most useful thing this
 * function does is distinguish the two refusals that are nobody's bug and not
 * worth retrying:
 *
 *   - the account's monthly allowance is spent, which is a billing state; and
 *   - the plan does not include the feature, which is an upgrade state.
 *
 * Everything else keeps the raw status and body, because an unexplained refusal
 * is still better than a guessed explanation.
 */
export function providerRefusal(status: number, body: string, url: string): string {
  const provider = providerOf(url);
  const text = body.toLowerCase();
  // The provider's own words, kept for diagnosis after the explanation.
  const quoted = body.replace(/\s+/g, " ").slice(0, 200);

  if (/usage hard limit|monthly usage limit|monthly usage hard limit|quota exceeded|insufficient (credit|funds)/.test(text)) {
    return (
      `${provider} has reached this account's monthly usage limit, so it is refusing every run ` +
      `until the new monthly cycle starts — this is a billing state, not a broken scan, and it ` +
      `affects every panel that reads ${provider} at once. Raise the plan's limit in the ${provider} ` +
      `console, or wait for the cycle to reset. ${provider} said: ${quoted}`
    );
  }
  if (text.includes("platform-feature-disabled") || /not (included|available) (in|on) (your|this) plan|upgrade (your )?plan/.test(text)) {
    return (
      `${provider} refused this request because the account's plan does not include the feature. ` +
      `Upgrade the ${provider} plan, or switch the actor id to one this plan covers. ` +
      `${provider} said: ${quoted}`
    );
  }
  if (status === 401 || status === 403) {
    return (
      `${provider} refused the credentials for this request (${status}). Check that the API token on ` +
      `the server is current and has access to this resource. ${provider} said: ${quoted}`
    );
  }
  return `Provider request failed (${status}): ${body.slice(0, 300)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON fetch with a timeout and exponential backoff. Retries only transient
 * failures; a 4xx that is not rate limiting fails fast with a readable message.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { method = "GET", headers = {}, body, timeoutMs = 30_000, retries = 2 } = options;

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
          lastError = new HttpError(response.status, `${url} → ${response.status}`);
          await sleep(2 ** attempt * 500);
          attempt += 1;
          continue;
        }
        throw new HttpError(
          // A spent monthly allowance is the caller's to fix by paying, so it is
          // reported as 429 (the same "you are out of allowance" shape
          // `_shared/budget.ts` uses) rather than as a provider fault.
          /usage hard limit|monthly usage limit|quota exceeded/i.test(text) ? 429 : response.status === 429 ? 429 : 502,
          providerRefusal(response.status, text, url),
          // Kept alongside the outward status: a 400 and a 500 both surface as
          // 502, but only one of them means the request has to change.
          response.status,
        );
      }

      return (await response.json()) as T;
    } catch (cause) {
      clearTimeout(timer);
      // A deliberate HttpError (bad request, auth failure) must not be retried.
      if (cause instanceof HttpError && cause.status !== 429 && cause.status < 500) throw cause;
      // A spent monthly allowance is raised as 429 so callers stop and report it,
      // but the *provider* answered 403 — retrying it just waits twice before
      // saying the same thing. Retry on the provider's status, not on the code we
      // chose to surface, whenever the provider gave us one.
      if (
        cause instanceof HttpError &&
        cause.providerStatus !== undefined &&
        !RETRYABLE_STATUS.has(cause.providerStatus)
      ) {
        throw cause;
      }
      lastError = cause;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 500);
      attempt += 1;
    }
  }

  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(502, lastError instanceof Error ? lastError.message : "Provider request failed.");
}
