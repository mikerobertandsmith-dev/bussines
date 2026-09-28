import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv, hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import { clampInt } from "../_shared/keywords.ts";
import {
  SOCIAL_PLATFORMS,
  actorFor,
  engagementRate,
  fetchDatasetItems,
  inputFor,
  isTerminal,
  normalisePosts,
  platformOf,
  startRun,
  waitForRun,
  type ApifyRun,
  type SocialPlatform,
} from "../_shared/apify.ts";

/**
 * Competitor social scan (Apify).
 *
 * For each competitor handle the workspace already records, this starts one
 * Apify actor run, waits a bounded while for it, and stores whatever public
 * posts came back as **signal** — captions, engagement, media URLs. Nothing
 * here republishes competitor creative; the app only ever builds original ads.
 *
 * Cost safety, in layers:
 *   - per run: `maxItems` caps charged results and `maxTotalChargeUsd` caps the
 *     spend, both configurable and both sent to Apify itself;
 *   - per workspace per month: `readSpend()` against `APIFY_MONTHLY_CHARGE_USD`,
 *     which also tightens the per-run ceiling to whatever is left;
 *   - per invocation: a hard cap on how many targets we touch.
 *
 * A run that outlives our wait is not thrown away: its id is stored on the
 * target and the next scan collects it before starting anything new. That is
 * also where the Phase 3/4 `provider-webhook` will slot in.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  competitorId?: string;
  platforms?: string[];
  limit?: number;
  /** Scrape even when the cadence says the target is not due yet. */
  force?: boolean;
  /** `onlyPostsNewerThan` override (a date, or e.g. "2 weeks"). */
  since?: string;
}

interface CompetitorRow {
  id: string;
  name: string;
  cadence: string;
}

interface SocialRow {
  competitor_id: string;
  platform: string;
  handle: string;
  followers: number;
}

interface TargetRow {
  id: string;
  competitor_id: string;
  platform: string;
  last_scraped_at: string | null;
  last_run_id: string;
  last_run_status: string;
}

/** One handle we intend to scrape, with the state of its last scrape. */
interface Target {
  competitorId: string;
  name: string;
  platform: SocialPlatform;
  handle: string;
  followers: number;
  since: string;
  state?: TargetRow;
}

/** Hard caps per invocation and per run, so a scan cannot run away. */
const MAX_TARGETS = 5;
const DEFAULT_TARGETS = 2;
const DEFAULT_MAX_ITEMS = 30;
const MIN_CHARGE_USD = 0.01;
/** How long we will wait across all the runs we started, in total. */
const WAIT_BUDGET_MS = 90_000;

/** How long a cadence keeps a target "not due yet". */
const CADENCE_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 6 * 24,
  monthly: 26 * 24,
};

/** A positive number from the environment, or the fallback. */
function positiveNumberEnv(key: string, fallback: number): number {
  const value = Number(getEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isDue(lastScrapedAt: string | null, cadence: string): boolean {
  if (!lastScrapedAt) return true;
  const window = CADENCE_HOURS[cadence] ?? CADENCE_HOURS.weekly;
  const elapsedHours = (Date.now() - new Date(lastScrapedAt).getTime()) / 3_600_000;
  return !Number.isFinite(elapsedHours) || elapsedHours >= window;
}

/** Private or removed profiles are a normal outcome, not a broken scan. */
function isSkipMessage(message: string): boolean {
  return /private|not found|does not exist|unavailable|no posts|empty/i.test(message);
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // Held in the handler scope (not the try) so the helper functions below, which
  // run only after the caller has been authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let businessId = "";

  try {
    if (!hasEnv("APIFY_TOKEN")) {
      throw new HttpError(409, "Apify is not configured on the server. Add APIFY_TOKEN.");
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    db = adminClient();
    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    const maxItems = clampInt(getEnv("APIFY_MAX_ITEMS"), 1, 500, DEFAULT_MAX_ITEMS);
    const configuredCharge = positiveNumberEnv("APIFY_MAX_CHARGE_USD", 0.25);

    /* ----------------------------------------------------------- targets */

    const { data: business, error: businessError } = await db
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .single();
    if (businessError || !business) throw new HttpError(404, "Business not found.");

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name, cadence")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);
    const competitors = (competitorRows ?? []) as CompetitorRow[];
    if (!competitors.length) {
      throw new HttpError(
        409,
        "No competitors to watch yet. Add competitor websites, then run the scan again.",
      );
    }
    const competitorById = new Map(competitors.map((c) => [c.id, c]));

    // The handles the workspace has declared are the monitoring list — one row
    // per competitor per platform, added on Competition → Social presence. The
    // targets table only stores how each of them was last scraped.
    const { data: socialRows, error: socialError } = await db
      .from("competitor_social")
      .select("competitor_id, platform, handle, followers")
      .in(
        "competitor_id",
        competitors.map((c) => c.id),
      );
    if (socialError) throw new HttpError(500, socialError.message);

    const { data: stateRows, error: stateError } = await db
      .from("social_monitor_targets")
      .select("id, competitor_id, platform, last_scraped_at, last_run_id, last_run_status")
      .eq("business_id", businessId);
    if (stateError) throw new HttpError(500, stateError.message);

    const stateByKey = new Map<string, TargetRow>();
    for (const row of (stateRows ?? []) as TargetRow[]) {
      stateByKey.set(`${row.competitor_id}|${row.platform}`, row);
    }

    const wanted = new Set<SocialPlatform>();
    for (const value of body.platforms ?? []) {
      const platform = platformOf(String(value));
      if (platform) wanted.add(platform);
    }

    const skipped: { handle: string; reason: string }[] = [];
    const due: Target[] = [];

    for (const row of (socialRows ?? []) as SocialRow[]) {
      const label = `${row.platform} ${row.handle}`.trim();
      const platform = platformOf(String(row.platform ?? ""));

      if (!platform) {
        skipped.push({ handle: label, reason: "no scraper for this platform" });
        continue;
      }
      if (body.competitorId && row.competitor_id !== body.competitorId) continue;
      if (wanted.size && !wanted.has(platform)) continue;
      if (!actorFor(platform)) {
        skipped.push({
          handle: label,
          reason: `${SOCIAL_PLATFORMS[platform].envKey} is not set on the server`,
        });
        continue;
      }

      const competitor = competitorById.get(row.competitor_id);
      if (!competitor) continue;

      const state = stateByKey.get(`${row.competitor_id}|${platform}`);
      if (!body.force && state && !isDue(state.last_scraped_at, competitor.cadence)) {
        skipped.push({
          handle: label,
          reason: `not due yet (${competitor.cadence} cadence — send force to scrape anyway)`,
        });
        continue;
      }

      due.push({
        competitorId: row.competitor_id,
        name: competitor.name,
        platform,
        handle: String(row.handle ?? ""),
        followers: Number(row.followers ?? 0),
        // Incremental by default: posts newer than the last successful scrape,
        // so a repeat scan is cheap and still catches everything new.
        since: body.since ?? state?.last_scraped_at?.slice(0, 10) ?? "1 month",
        state,
      });
    }

    const limit = clampInt(body.limit, 1, MAX_TARGETS, DEFAULT_TARGETS);
    const selected = due.slice(0, limit);

    /* ------------------------------------------- collect in-flight runs */
    // A previous scan may have left runs working; if they have finished, their
    // posts are ingested now, and their cost is logged once — here, not twice.
    let posts = 0;
    for (const target of due) {
      const runId = target.state?.last_run_id ?? "";
      if (!runId || isTerminal(target.state?.last_run_status ?? "")) continue;
      const run = await waitForRun(runId, 0);
      if (!isTerminal(run.status)) continue;
      posts += await collectRun(run, target, maxItems, checkedAt);
    }

    if (!selected.length) {
      return json({
        scanned: 0,
        posts,
        running: 0,
        capped: false,
        skipped,
        errors: [],
        message: due.length
          ? `Nothing started — a scan starts at most ${limit} target${limit === 1 ? "" : "s"}.`
          : "No monitorable handles are due. Send force to scrape them anyway.",
      });
    }

    /* ------------------------------------------------------------ budget */

    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < MIN_CHARGE_USD) {
      throw new HttpError(429, spendMessage(spend, MIN_CHARGE_USD));
    }
    // Never let one run exceed what the workspace has left for the month.
    const maxChargeUsd = Number(Math.min(configuredCharge, spend.remainingUsd).toFixed(4));

    /* ------------------------------------------------- start the runs */

    const started: { run: ApifyRun; target: Target; actorId: string }[] = [];
    const errors: string[] = [];

    for (const target of selected) {
      try {
        const actorId = actorFor(target.platform);
        const run = await startRun(
          actorId,
          inputFor(target.platform, target.handle, maxItems, target.since),
          {
            maxItems,
            maxTotalChargeUsd: maxChargeUsd,
            // Apify's own kill switch for the run. It is deliberately longer than
            // our wait: a run we stop waiting for keeps working and the next scan
            // collects it.
            timeoutSecs: clampInt(getEnv("APIFY_RUN_TIMEOUT_SECS"), 30, 3600, 300),
          },
        );
        started.push({ run, target, actorId });
        await saveTarget(target, run, "");
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The Apify run could not start.";
        errors.push(`${target.name} (${target.platform}): ${message}`);
        await saveTarget(target, null, message);
      }
    }

    /* -------------------------------------------------- wait and ingest */

    const deadline = Date.now() + WAIT_BUDGET_MS;
    let running = 0;

    for (const { run, target, actorId } of started) {
      let current = run;
      while (!isTerminal(current.status) && Date.now() < deadline) {
        const secondsLeft = Math.floor((deadline - Date.now()) / 1000);
        if (secondsLeft <= 0) break;
        current = await waitForRun(current.id, Math.min(60, secondsLeft));
      }

      if (!isTerminal(current.status)) {
        // Still working: keep the run id on the target so the next scan collects
        // it, and log no usage yet so the cost is only counted once.
        running += 1;
        await saveTarget(target, current, "");
        continue;
      }

      posts += await collectRun(current, target, maxItems, checkedAt);

      // A finished-but-unsuccessful run still costs something, and a private
      // profile is a normal outcome rather than a broken scan.
      if (current.status !== "SUCCEEDED") {
        const detail = `${target.platform} ${target.handle}: ${current.statusMessage ?? current.status}`;
        if (isSkipMessage(current.statusMessage ?? "")) {
          skipped.push({ handle: `${target.platform} ${target.handle}`, reason: detail });
        } else {
          errors.push(`${target.name}: ${detail}`);
        }
        await recordUsage(db, {
          businessId,
          provider: "apify",
          endpoint: `actors/${actorId}`,
          units: 0,
          costUsd: current.usageTotalUsd,
          status: "error",
          detail: detail.slice(0, 300),
        });
      }
    }

    const scanned = started.length;

    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "social",
      source_name: "Competitor social scan",
      status: started.length && !errors.length ? "succeeded" : errors.length ? "failed" : "succeeded",
      changes_found: posts,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    if (!scanned && !posts && errors.length) throw new HttpError(502, errors[0]);

    return json({
      scanned,
      posts,
      running,
      /** True when the per-scan target limit, not the cadence, cut the list short. */
      capped: due.length > selected.length,
      /** True when the monthly allowance lowered the per-run spend ceiling. */
      spendLimited: maxChargeUsd < configuredCharge,
      skipped,
      errors,
    });
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * Reads a finished run's dataset, normalises the posts and upserts them, then
   * records the run's usage exactly once, with the cost Apify reported.
   */
  async function collectRun(
    run: ApifyRun,
    target: Target,
    maxItems: number,
    checkedAt: string,
  ): Promise<number> {
    if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
      // Nothing to read — the caller logs the failure and its cost.
      await saveTarget(target, run, "");
      return 0;
    }

    const items = await fetchDatasetItems(run.defaultDatasetId, maxItems);
    const normalised = normalisePosts(items, target.platform);

    if (normalised.length) {
      const { error } = await db.from("social_posts").upsert(
        normalised.map((post) => ({
          business_id: businessId,
          competitor_id: target.competitorId,
          platform: target.platform,
          external_id: post.externalId,
          url: post.url,
          caption: post.caption,
          media_url: post.mediaUrl,
          media_type: post.mediaType,
          hashtags: post.hashtags,
          mentions: post.mentions,
          likes: post.likes,
          comments: post.comments,
          shares: post.shares,
          views: post.views,
          engagement_rate: engagementRate(post.likes, post.comments, target.followers),
          posted_at: post.postedAt,
          scraped_at: checkedAt,
        })),
        { onConflict: "business_id,platform,external_id" },
      );
      if (error) throw new HttpError(500, error.message);
    }

    await recordUsage(db, {
      businessId,
      provider: "apify",
      endpoint: "actors",
      units: normalised.length,
      costUsd: run.usageTotalUsd,
      detail: `${target.platform} ${target.handle}: ${normalised.length} posts`,
    });

    await saveTarget(target, run, "");
    return normalised.length;
  }

  /** Upserts the scrape state for one handle. */
  async function saveTarget(target: Target, run: ApifyRun | null, error: string): Promise<void> {
    const finished = run !== null && isTerminal(run.status);
    const { error: upsertError } = await db.from("social_monitor_targets").upsert(
      {
        business_id: businessId,
        competitor_id: target.competitorId,
        platform: target.platform,
        handle: target.handle,
        actor_id: actorFor(target.platform),
        last_scraped_at: finished
          ? new Date().toISOString()
          : (target.state?.last_scraped_at ?? null),
        // A run we failed to start leaves the previous run id in place: it may
        // still be the one the next scan wants to collect.
        last_run_id: run?.id ?? target.state?.last_run_id ?? "",
        last_run_status: run?.status ?? target.state?.last_run_status ?? "",
        last_error: error,
      },
      { onConflict: "business_id,competitor_id,platform" },
    );
    if (upsertError) throw new HttpError(500, upsertError.message);
  }
});
