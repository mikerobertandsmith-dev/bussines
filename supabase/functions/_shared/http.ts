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
          response.status === 429 ? 429 : 502,
          `Provider request failed (${response.status}): ${text.slice(0, 300)}`,
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
      lastError = cause;
      if (attempt >= retries) break;
      await sleep(2 ** attempt * 500);
      attempt += 1;
    }
  }

  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(502, lastError instanceof Error ? lastError.message : "Provider request failed.");
}
