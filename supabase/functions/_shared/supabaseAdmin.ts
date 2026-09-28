import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEnv } from "./env.ts";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses row level security, so it is only ever used
 * inside the gateway after the caller has been authenticated and their tenant
 * ownership checked. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected
 * into Edge Functions by Supabase automatically.
 */
export function adminClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
