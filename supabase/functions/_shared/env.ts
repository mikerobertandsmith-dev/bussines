import { HttpError } from "./errors.ts";

/**
 * Reads a server-side secret. Edge Function environment variables are set with
 * `supabase secrets set`, so they exist only here — never in the browser.
 */
export function getEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

export function hasEnv(name: string): boolean {
  return getEnv(name) !== undefined;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) throw new HttpError(500, `The server is missing the ${name} environment variable.`);
  return value;
}
