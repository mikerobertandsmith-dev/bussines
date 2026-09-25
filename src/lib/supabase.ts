import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dbEnabled, env } from "./env";

/**
 * Supabase is configured with Clerk as a "third-party auth" provider, so every
 * request has to carry a fresh Clerk session token. Clerk rotates those tokens,
 * hence the callback instead of a static key.
 */
let accessTokenProvider: (() => Promise<string | null>) | null = null;

export function setAccessTokenProvider(provider: (() => Promise<string | null>) | null) {
  accessTokenProvider = provider;
}

async function currentAccessToken(): Promise<string | null> {
  if (!accessTokenProvider) return null;
  try {
    return await accessTokenProvider();
  } catch {
    return null;
  }
}

export const supabase: SupabaseClient | null = dbEnabled
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      accessToken: currentAccessToken,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.",
    );
  }
  return supabase;
}
