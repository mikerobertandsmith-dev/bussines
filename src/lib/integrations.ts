import { supabase } from "./supabase";
import type {
  AdAngle,
  ApiUsage,
  IntegrationConnection,
  IntegrationProvider,
  KeywordCluster,
  KeywordIdea,
  ProviderStatus,
  ReviewConnection,
  ScanRun,
  SocialAccount,
} from "./types";

/**
 * The Integrations layer is the browser's only view of the provider gateway.
 *
 * Provider API keys are read solely by the Supabase Edge Functions
 * (`supabase/functions/*`), never here. This module knows two things: the static
 * catalogue the UI renders, and how to ask the gateway which providers the
 * server is actually configured for. See docs/API_INTEGRATION_BLUEPRINT.md.
 */

interface ProviderMeta {
  label: string;
  description: string;
  /** Environment variables the server needs before this provider can run. */
  envKeys: string[];
}

/** Display order and copy for each provider. */
export const PROVIDER_CATALOG: Record<IntegrationProvider, ProviderMeta> = {
  serpapi: {
    label: "SerpApi",
    description:
      "Google organic and local rankings, rich snippets and autocomplete for you and your competitors.",
    envKeys: ["SERPAPI_KEY"],
  },
  apify: {
    label: "Apify",
    description: "Scrapes competitors' recent public social posts so their activity becomes a signal.",
    envKeys: ["APIFY_TOKEN"],
  },
  reviews: {
    label: "Reviews",
    description:
      "Monitors Google, TripAdvisor, Yelp, Trustpilot, G2 and Capterra reviews through your SerpApi and Apify accounts.",
    // Either reader is enough to switch the integration on.
    envKeys: ["SERPAPI_KEY", "APIFY_TOKEN"],
  },
  mallary: {
    label: "Mallary.ai",
    description: "Publishes your finished ad designs to the social accounts you connect.",
    envKeys: ["MALLARY_API_KEY"],
  },
  llm: {
    label: "AI drafting",
    description:
      "Drafts review replies, ad angles and keyword themes from data you already monitor. Every draft is yours to edit — nothing is ever sent for you.",
    envKeys: ["GROQ_API_KEY"],
  },
};

export const PROVIDER_ORDER: IntegrationProvider[] = [
  "serpapi",
  "apify",
  "reviews",
  "llm",
  "mallary",
];

/** Aggregate raw usage rows (one per provider call) into per-provider totals. */
export function aggregateUsage(rows: ApiUsage[]): Map<IntegrationProvider, ApiUsage> {
  const totals = new Map<IntegrationProvider, ApiUsage>();
  for (const row of rows) {
    const current = totals.get(row.provider) ?? {
      provider: row.provider,
      requests: 0,
      units: 0,
      costUsd: 0,
      errors: 0,
    };
    current.requests += row.requests;
    current.units += row.units;
    current.costUsd += row.costUsd;
    current.errors += row.errors;
    totals.set(row.provider, current);
  }
  return totals;
}

/**
 * What the server reports per provider: whether it holds a key, and the monthly
 * caps it enforces (0 means uncapped). Usage is counted from `api_usage_log`.
 */
export interface ProviderConfig {
  configured: boolean;
  cap: number;
  capUsd: number;
  /**
   * Features the provider could serve that this deployment has switched off,
   * as ready copy. Not a credential problem — Apify still runs social scans
   * without a contacts actor id, and saying so is the point.
   */
  inactiveFeatures: string[];
}

/** How far a provider is into its monthly allowance, as a percentage. */
export function providerUsage(status: ProviderStatus): { pct: number; capped: boolean } {
  const byUnits = status.cap > 0 ? (status.units / status.cap) * 100 : 0;
  const bySpend = status.capUsd > 0 ? (status.costUsd / status.capUsd) * 100 : 0;
  return { pct: Math.max(byUnits, bySpend), capped: status.cap > 0 || status.capUsd > 0 };
}

/** Where a provider sits against its allowance, for colour: ok → warn → full. */
export type UsageLevel = "ok" | "warn" | "full";

/**
 * One provider's month-to-date usage, shaped for the usage panel: the numbers
 * recorded against the allowance the gateway enforces, plus how full it is.
 */
export interface UsageBar {
  provider: IntegrationProvider;
  label: string;
  /** Billable units recorded this month (searches / syncs / posts). */
  units: number;
  /** Monthly unit allowance, 0 when the provider is uncapped. */
  cap: number;
  costUsd: number;
  /** Monthly dollar allowance, 0 when uncapped. */
  capUsd: number;
  requests: number;
  errors: number;
  /** 0–100+, how far into the allowance the provider is. 0 when uncapped. */
  pct: number;
  capped: boolean;
  level: UsageLevel;
}

/** The same 80%/100% thresholds the budget alerts use. */
export function usageLevel(pct: number): UsageLevel {
  if (pct >= 100) return "full";
  if (pct >= 80) return "warn";
  return "ok";
}

/**
 * The providers worth showing in the usage panel: any with recorded calls this
 * month, plus any the gateway caps (so an untouched allowance is still visible).
 * Providers with neither stay out, keeping the panel to what matters.
 */
export function buildUsageBars(status: ProviderStatus[]): UsageBar[] {
  return status
    .filter((provider) => provider.requests > 0 || provider.cap > 0 || provider.capUsd > 0)
    .map((provider) => {
      const { pct, capped } = providerUsage(provider);
      return {
        provider: provider.provider,
        label: provider.label,
        units: provider.units,
        cap: provider.cap,
        costUsd: provider.costUsd,
        capUsd: provider.capUsd,
        requests: provider.requests,
        errors: provider.errors,
        pct,
        capped,
        level: usageLevel(pct),
      };
    });
}

/** A connection the provider rejected — the user has to reconnect it. */
export interface ReconnectItem {
  provider: IntegrationProvider;
  label: string;
}

/**
 * Whether the workspace is actually monitoring: what failed recently, what is
 * still running, and which connections the provider has rejected. Reads only
 * rows the app already holds, so it costs no provider calls.
 */
export interface WorkspaceHealth {
  /** Failed scans from the last 7 days, newest first. */
  failedScans: ScanRun[];
  /** Scans queued or still running — nothing to act on, just not finished. */
  pendingScans: number;
  /** Connections needing a reconnect, across every provider. */
  needsReconnect: ReconnectItem[];
  /** True when nothing is failing and nothing needs reconnecting. */
  ok: boolean;
}

/** How far back a failed scan still counts as "recent and worth showing". */
const HEALTH_WINDOW_DAYS = 7;

/** Builds the workspace health summary from rows the app already has. */
export function buildWorkspaceHealth(input: {
  scanRuns: ScanRun[];
  integrationConnections: IntegrationConnection[];
  reviewConnections: ReviewConnection[];
  socialAccounts: SocialAccount[];
  now?: Date;
}): WorkspaceHealth {
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() - HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const failedScans = input.scanRuns
    .filter((run) => run.status === "failed" && run.startedAt >= cutoff)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const pendingScans = input.scanRuns.filter(
    (run) => run.status === "queued" || run.status === "running",
  ).length;

  const needsReconnect: ReconnectItem[] = [];
  for (const connection of input.integrationConnections) {
    if (connection.status !== "needs_reauth") continue;
    needsReconnect.push({
      provider: connection.provider,
      label: connection.label || PROVIDER_CATALOG[connection.provider].label,
    });
  }
  for (const connection of input.reviewConnections) {
    if (connection.status !== "needs_reauth") continue;
    needsReconnect.push({
      provider: connection.provider,
      label: connection.label || connection.handle,
    });
  }
  for (const account of input.socialAccounts) {
    if (account.status !== "needs_reauth") continue;
    needsReconnect.push({
      provider: account.provider,
      label: account.displayName || account.handle,
    });
  }

  return {
    failedScans,
    pendingScans,
    needsReconnect,
    ok: failedScans.length === 0 && needsReconnect.length === 0,
  };
}

/** Build the `ProviderStatus[]` the Integrations panel renders. */
export function buildProviderStatus(input: {
  connections: IntegrationConnection[];
  usage: ApiUsage[];
  config: Partial<Record<IntegrationProvider, ProviderConfig>>;
}): ProviderStatus[] {
  const usage = aggregateUsage(input.usage);
  const counts = new Map<IntegrationProvider, number>();
  for (const connection of input.connections) {
    counts.set(connection.provider, (counts.get(connection.provider) ?? 0) + 1);
  }

  return PROVIDER_ORDER.map((provider) => {
    const meta = PROVIDER_CATALOG[provider];
    const totals = usage.get(provider);
    const config = input.config[provider];
    return {
      provider,
      label: meta.label,
      description: meta.description,
      envKeys: meta.envKeys,
      configured: config?.configured === true,
      inactiveFeatures: config?.inactiveFeatures ?? [],
      connections: counts.get(provider) ?? 0,
      requests: totals?.requests ?? 0,
      costUsd: Number((totals?.costUsd ?? 0).toFixed(2)),
      units: totals?.units ?? 0,
      errors: totals?.errors ?? 0,
      cap: config?.cap ?? 0,
      capUsd: config?.capUsd ?? 0,
    };
  });
}

/**
 * Asks the gateway which providers the server holds credentials for, and the
 * monthly caps it enforces. Best effort: if the function is not deployed yet (or
 * the call fails) every provider reports as unconfigured with no cap, and the UI
 * shows connect prompts.
 */
export async function fetchProviderConfig(): Promise<
  Partial<Record<IntegrationProvider, ProviderConfig>>
> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.functions.invoke("integrations-status", { body: {} });
    if (error || !data || typeof data !== "object") return {};
    const providers = (data as { providers?: unknown }).providers;
    if (!Array.isArray(providers)) return {};

    const map: Partial<Record<IntegrationProvider, ProviderConfig>> = {};
    for (const entry of providers) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as {
        provider?: unknown;
        configured?: unknown;
        cap?: unknown;
        capUsd?: unknown;
        inactiveFeatures?: unknown;
      };
      const provider = record.provider;
      if (
        provider !== "serpapi" &&
        provider !== "apify" &&
        provider !== "reviews" &&
        provider !== "mallary" &&
        provider !== "llm"
      ) {
        continue;
      }
      map[provider] = {
        configured: record.configured === true,
        cap: Number(record.cap ?? 0) || 0,
        capUsd: Number(record.capUsd ?? 0) || 0,
        // An older deployment does not send this at all — an absent list is "
        // nothing known to be off", never undefined in the UI.
        inactiveFeatures: Array.isArray(record.inactiveFeatures)
          ? record.inactiveFeatures.filter((item): item is string => typeof item === "string")
          : [],
      };
    }
    return map;
  } catch {
    return {};
  }
}

/* ----------------------------------------------------------- gateway calls */

interface GatewayErrorBody {
  error?: string;
}

/** Pulls the `{ error }` message out of a failed function response. */
async function readErrorBody(error: unknown): Promise<string | null> {
  const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
  if (!context?.json) return null;
  try {
    const parsed = (await context.json()) as GatewayErrorBody;
    return typeof parsed?.error === "string" ? parsed.error : null;
  } catch {
    return null;
  }
}

/**
 * Calls one of the provider gateway Edge Functions. The browser never holds a
 * provider key: this only reaches our own function, which does the provider call
 * server-side and writes the result to Supabase.
 */
export async function invokeGateway<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const message = await readErrorBody(error);
    throw new Error(message ?? `The ${name} service could not be reached.`);
  }
  if (data && typeof data === "object" && typeof (data as GatewayErrorBody).error === "string") {
    throw new Error((data as GatewayErrorBody).error as string);
  }
  return data as T;
}

export interface SerpScanResult {
  keywords: number;
  rankings: number;
  packKeywords: number;
  placeId: string;
  /** True when the workspace's monthly budget, not the tracked list, cut the run short. */
  capped: boolean;
}

export interface KeywordIdeasResult {
  seed: string;
  ideas: KeywordIdea[];
}

export interface SocialScanResult {
  scanned: number;
  /** Posts upserted by this run (a re-scrape refreshes metrics on the same rows). */
  posts: number;
  /** Runs still working when our wait ran out; the next scan collects them. */
  running: number;
  /** True when the per-scan handle limit, not the cadence, cut the list short. */
  capped: boolean;
  /** True when the monthly Apify allowance lowered the per-run spend ceiling. */
  spendLimited: boolean;
  skipped: { handle: string; reason: string }[];
  errors: string[];
  message?: string;
}

export interface ReviewSyncResult {
  /** Profiles that synced successfully. */
  profiles: number;
  /** Reviews upserted by this run (a re-sync refreshes the same rows). */
  reviews: number;
  /** Negative reviews found, which the app flags for a reply. */
  flagged: number;
  newReviews: number;
  averageRating: number;
  sources: number;
  /**
   * Profiles whose scrape was still running. Their run is kept on the
   * connection, so the next sync collects it — and it is only charged once.
   */
  running: number;
  skipped: { profile: string; reason: string }[];
  errors: string[];
}

export interface ReviewReplyResult {
  ok: boolean;
  replyText: string;
  repliedAt: string | null;
  alreadyReplied: boolean;
}

export interface PublishAdResult {
  ok: boolean;
  jobId: string;
  batchId: string;
  /** queued | publishing | published | partial | failed */
  status: string;
  permalink: string;
  platforms: string[];
  /** Set when the post was scheduled rather than sent now. */
  scheduledFor: string | null;
}

export interface SocialAccountsResult {
  accounts: number;
  platforms: string[];
}

export interface CompetitorBenchmarkResult {
  keywords: number;
  competitors: number;
  ourShare: number;
  ourTop10: number;
  rows: number;
  /** True when the workspace's monthly budget, not the tracked list, cut the run short. */
  capped: boolean;
}

/* ------------------------------------------------------------- AI drafting */

/**
 * The fields every drafting call returns about itself, so the UI can show what
 * a draft cost without a second request.
 */
interface DraftMeta {
  model: string;
  /** Prompt + completion tokens, the unit the model bills on. */
  tokens: number;
  costUsd: number;
}

/** A drafted reply to one of our reviews. Never sent — see `sendReviewReply`. */
export interface ReplyDraftResult extends DraftMeta {
  reviewId: string;
  reply: string;
  /** apologetic | grateful | reassuring | factual */
  tone: string;
  /** Always false: the composer sends, not the model. */
  sent: boolean;
}

export interface AngleDraftResult extends DraftMeta {
  angles: AdAngle[];
  /** The competitor whose post prompted these, when we know which one. */
  competitor: string;
  source: {
    postId: string;
    platform: string;
    caption: string;
    likes: number;
    comments: number;
    engagementRate: number;
  };
}

export interface ClusterDraftResult extends DraftMeta {
  seed: string;
  clusters: KeywordCluster[];
  /** Suggestion rows the labels were written to. */
  grouped: number;
}

