import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { HttpError } from "./errors.ts";
import { getEnv } from "./env.ts";
import type { IntegrationProvider } from "./providers.ts";

/**
 * Per-tenant monthly budgets, so a scan loop cannot quietly burn a provider's
 * free tier (and, later, a paid plan's allowance).
 *
 * Usage is read back from `api_usage_log`, which every provider call already
 * writes, rather than a separate counter — one source of truth, and the numbers
 * the Integrations panel shows are the numbers the caps are enforced against.
 *
 * Two shapes of allowance exist because providers bill differently: SerpApi
 * charges per search (units), Apify charges per result in dollars, so it is
 * capped by spend.
 */

/** A provider's month-to-date unit usage against its monthly allowance. */
export interface Budget {
  /** The monthly allowance in billable units. */
  cap: number;
  /** Units already recorded this month. */
  used: number;
  /** Units still available; `Infinity` when the provider is uncapped. */
  remaining: number;
}

/** A provider's month-to-date spend against its monthly dollar allowance. */
export interface SpendBudget {
  capUsd: number;
  spentUsd: number;
  /** Dollars still available; `Infinity` when the provider is uncapped. */
  remainingUsd: number;
}

/**
 * Defaults, chosen from each provider's entry-level plan:
 *   SerpApi     — 250 searches/month on the free tier.
 *   Mallary     — posts are what it bills; a Free plan has no scheduling.
 *
 * `reviews` has no cap of its own on purpose: it is not a vendor we buy from,
 * and each of its reads is logged against the SerpApi or Apify allowance that
 * actually pays for it, so those caps already bound it.
 */
const DEFAULT_MONTHLY_CAP: Partial<Record<IntegrationProvider, number>> = {
  serpapi: 250,
  mallary: 50,
};

/** The environment variable that overrides each provider's unit cap. */
const MONTHLY_CAP_ENV: Partial<Record<IntegrationProvider, string>> = {
  serpapi: "SERPAPI_MONTHLY_CAP",
  mallary: "MALLARY_MONTHLY_CAP",
};

/** Apify's free plan includes $5 of platform credit a month. */
const DEFAULT_MONTHLY_USD_CAP: Partial<Record<IntegrationProvider, number>> = {
  apify: 5,
};

/**
 * The environment variable that overrides each provider's dollar cap. A provider
 * with no default here is uncapped until someone sets its variable — which is how
 * `llm` works: drafting is user-triggered and cheap, so it is *logged but never
 * refused*, and a ceiling can be switched on later without touching code.
 */
const MONTHLY_USD_CAP_ENV: Partial<Record<IntegrationProvider, string>> = {
  apify: "APIFY_MONTHLY_CHARGE_USD",
  llm: "LLM_MONTHLY_CHARGE_USD",
};

/** Human names, for the "out of budget" message. */
export const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  serpapi: "SerpApi",
  apify: "Apify",
  reviews: "Reviews",
  mallary: "Mallary.ai",
  llm: "AI drafting",
};

function configuredCap(envKey: string, fallback: number): number {
  const raw = getEnv(envKey);
  if (raw === undefined) return fallback;

  const configured = Number(raw);
  if (!Number.isFinite(configured) || configured < 0) return fallback;
  // An explicit 0 means "no cap", for workspaces on a paid plan.
  return configured;
}

/**
 * The monthly allowance for a provider, in that provider's billable units
 * (searches for SerpApi, posts for Mallary).
 * A provider with no default returns 0, meaning uncapped.
 */
export function monthlyCap(provider: IntegrationProvider): number {
  const fallback = DEFAULT_MONTHLY_CAP[provider];
  const envKey = MONTHLY_CAP_ENV[provider];
  if (!fallback || !envKey) return 0;
  return configuredCap(envKey, fallback);
}

/** The monthly dollar allowance for a provider, or 0 when it is uncapped. */
export function monthlyUsdCap(provider: IntegrationProvider): number {
  const envKey = MONTHLY_USD_CAP_ENV[provider];
  if (!envKey) return 0;
  // Read the *provider's own* variable. This used to hard-code Apify's, which
  // would have made any second dollar-capped provider enforce Apify's ceiling.
  return configuredCap(envKey, DEFAULT_MONTHLY_USD_CAP[provider] ?? 0);
}

/** Where the current calendar month starts, as an ISO timestamp. */
function monthStart(now = new Date()): string {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Sums one column of the tenant's usage log for the current month.
 *
 * Fails closed: if the log cannot be read we cannot prove the workspace is
 * inside its budget, so the caller gets a retryable error instead of spending.
 */
async function monthToDate(
  db: SupabaseClient,
  businessId: string,
  provider: IntegrationProvider,
  column: "units" | "cost_usd",
): Promise<number> {
  const { data, error } = await db
    .from("api_usage_log")
    .select(column)
    .eq("business_id", businessId)
    .eq("provider", provider)
    .gte("created_at", monthStart())
    .limit(5000);

  if (error) {
    throw new HttpError(
      503,
      `Could not check this workspace's ${provider} budget (${error.message}). Try again in a moment.`,
    );
  }

  return (data ?? []).reduce(
    (sum, row) => sum + Number((row as Record<string, unknown>)[column] ?? 0),
    0,
  );
}

/** Reads a tenant's month-to-date search usage. */
export async function readBudget(
  db: SupabaseClient,
  businessId: string,
  provider: IntegrationProvider,
): Promise<Budget> {
  const cap = monthlyCap(provider);
  if (!cap) return { cap: 0, used: 0, remaining: Number.POSITIVE_INFINITY };

  const used = await monthToDate(db, businessId, provider, "units");
  return { cap, used, remaining: Math.max(0, cap - used) };
}

/** Reads a tenant's month-to-date spend for a provider. */
export async function readSpend(
  db: SupabaseClient,
  businessId: string,
  provider: IntegrationProvider,
): Promise<SpendBudget> {
  const capUsd = monthlyUsdCap(provider);
  if (!capUsd) return { capUsd: 0, spentUsd: 0, remainingUsd: Number.POSITIVE_INFINITY };

  const spentUsd = await monthToDate(db, businessId, provider, "cost_usd");
  return { capUsd, spentUsd, remainingUsd: Math.max(0, capUsd - spentUsd) };
}

/**
 * How many items of `unitsPerItem` each fit in the remaining budget, once
 * `reserve` units are held back for the fixed calls a run always makes (a Maps
 * lookup, say). `Infinity` when the provider is uncapped.
 */
export function affordableCount(
  remaining: number,
  unitsPerItem: number,
  reserve = 0,
): number {
  if (!Number.isFinite(remaining)) return Number.POSITIVE_INFINITY;
  const usable = Math.max(0, remaining - reserve);
  return Math.floor(usable / Math.max(1, unitsPerItem));
}

/** The "out of budget" message, with the arithmetic that produced it. */
export function budgetMessage(
  provider: IntegrationProvider,
  budget: Budget,
  unitsNeeded: number,
): string {
  const label = PROVIDER_LABELS[provider];
  const envKey = MONTHLY_CAP_ENV[provider] ?? "its monthly cap";
  return (
    `This workspace has used its ${budget.cap} ${label} units for this month ` +
    `(${budget.used} recorded, ${budget.remaining} left, and one run needs ${unitsNeeded}). ` +
    `Raise ${envKey}, or wait for the new month.`
  );
}

/** The "nothing left to spend" message for a spend-capped provider. */
export function spendMessage(
  budget: SpendBudget,
  neededUsd: number,
  provider: IntegrationProvider = "apify",
): string {
  const label = PROVIDER_LABELS[provider];
  const envKey = MONTHLY_USD_CAP_ENV[provider] ?? "its monthly cap";
  return (
    `This workspace has spent its $${budget.capUsd.toFixed(2)} ${label} budget for this month ` +
    `($${budget.spentUsd.toFixed(2)} recorded, $${budget.remainingUsd.toFixed(2)} left, and one run needs ` +
    `$${neededUsd.toFixed(2)}). Raise ${envKey}, or wait for the new month.`
  );
}
