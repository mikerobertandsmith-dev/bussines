import { failure, json, preflight } from "../_shared/cors.ts";
import { requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { PROVIDERS, inactiveFeaturesFor, providerConfigured } from "../_shared/providers.ts";
import { monthlyCap, monthlyUsdCap } from "../_shared/budget.ts";

/**
 * Reports which providers the server holds credentials for, and the per-workspace
 * monthly caps each one is enforced against (0 means uncapped).
 *
 * Requires a valid signed-in caller so a deployment's configuration is not
 * public, but it reveals nothing beyond one boolean, two ceilings and whether a
 * named feature is switched off — no keys, no connection details, no tenant
 * data. Caps live here rather than only in the gateway because the app needs them
 * to show a usage bar and to warn before a scan is refused.
 *
 * Deploy with `--no-verify-jwt`: the bearer token is a Clerk session token and
 * is verified inside the function (see `_shared/auth.ts`).
 */
Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    await requireCaller(req);

    const providers = PROVIDERS.map((provider) => ({
      provider,
      configured: providerConfigured(provider, hasEnv),
      // Billable units per month (searches / profile syncs / posts), 0 = uncapped.
      cap: monthlyCap(provider),
      // Monthly dollar allowance, 0 = uncapped. Apify and (when LLM_MONTHLY_CHARGE_USD
      // is set) AI drafting are billed this way; the rest are capped in units.
      capUsd: monthlyUsdCap(provider),
      // Features this provider could serve but cannot on this deployment, named
      // so the panel explains them instead of showing a provider as half-broken.
      inactiveFeatures: inactiveFeaturesFor(provider, hasEnv),
    }));

    return json({ providers });
  } catch (error) {
    return failure(error);
  }
});
