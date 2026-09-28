import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { IntegrationProvider } from "./providers.ts";

export interface UsageInput {
  businessId: string | null;
  provider: IntegrationProvider;
  endpoint: string;
  /** Searches / results / posts — whatever the provider bills on. */
  units?: number;
  costUsd?: number;
  status?: "ok" | "error";
  detail?: string;
}

/**
 * Records one provider call for the tenant's usage/cost readout. Best effort by
 * design: logging must never turn a successful provider call into a failure.
 */
export async function recordUsage(client: SupabaseClient, input: UsageInput): Promise<void> {
  try {
    await client.from("api_usage_log").insert({
      business_id: input.businessId,
      provider: input.provider,
      endpoint: input.endpoint,
      units: input.units ?? 1,
      cost_usd: input.costUsd ?? 0,
      status: input.status ?? "ok",
      detail: input.detail ?? null,
    });
  } catch (error) {
    console.error("[gateway] could not record usage", error);
  }
}
