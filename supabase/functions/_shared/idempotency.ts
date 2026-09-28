import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "./errors.ts";
import type { IntegrationProvider } from "./providers.ts";

/**
 * Runs `work` at most once per (business, provider, key).
 *
 * A client retry after a timeout would otherwise create a duplicate social post
 * or review reply. The first call stores its response; a repeat call returns the
 * stored response without re-running the side effect.
 */
export async function withIdempotency<T>(
  client: SupabaseClient,
  businessId: string,
  provider: IntegrationProvider,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!key) throw new HttpError(400, "An idempotency key is required.");

  const existing = await client
    .from("integration_idempotency")
    .select("response")
    .eq("business_id", businessId)
    .eq("provider", provider)
    .eq("key", key)
    .maybeSingle();

  if (existing.data) return (existing.data as { response: T }).response;

  const result = await work();

  // A racing duplicate hits the unique constraint; `ignoreDuplicates` keeps this
  // call from failing, and both callers get an equivalent result.
  await client
    .from("integration_idempotency")
    .upsert(
      { business_id: businessId, provider, key, response: result as Record<string, unknown> },
      { onConflict: "business_id,provider,key", ignoreDuplicates: true },
    );

  return result;
}
