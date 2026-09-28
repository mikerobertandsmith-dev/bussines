import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import {
  CONTACTS_MIN_CHARGE_USD,
  contactsActorId,
  contactsCaps,
  contactsInputFor,
  contactsPreviewCapPerHour,
  contactsReuseWindowMinutes,
  previewQuotaMessage,
  reusableWithin,
  reviewContacts,
  scrapeUrl,
  type ContactReview,
  type ContactSuggestion,
  type ContactsCaps,
} from "../_shared/contacts.ts";
import {
  fetchDatasetItems,
  isTerminal,
  startRun,
  waitForRun,
  type ApifyRun,
} from "../_shared/apify.ts";

/**
 * Competitor website contacts discovery (Apify).
 *
 * Reads a competitor's **own website** and proposes the social profiles it
 * mentions, for a human to accept. It never writes `competitor_social`: every
 * accepted handle becomes a billed scrape target, and a footer link can just as
 * easily belong to the site's web agency, so the writing stays deliberate.
 *
 * Three modes in one handler, because they share every line of the run logic:
 *   - **preview** `{ url }` — what onboarding calls, before a competitor row
 *     exists. Authors nothing (there is nothing to attach to) and returns the
 *     run id so a slow run can still be collected.
 *   - **stored** `{ businessId, competitorId }` — reads the competitor's stored
 *     website, advances `contacts_status`, and keeps `contacts_run_id` when a run
 *     outlives our wait so the next call collects it rather than paying twice.
 *   - **collect** `{ runId }` — pick up a run we stopped waiting for. The run is
 *     resolved **from the ledger**, so it can only ever be collected by the
 *     account that started it.
 *
 * Every run is recorded in `contacts_discovery_runs` (migration `0020`), which is
 * what turns the four cost guarantees below into database facts rather than
 * read-then-write hopes:
 *   1. a preview run counts against its **user's** hourly allowance, because
 *      there is no tenant to bill yet;
 *   2. a stored run is claimed by a unique index before anything is started, so
 *      a double-click cannot buy two runs;
 *   3. a read taken minutes ago is replayed from the ledger instead of paid for
 *      again (send `force: true` to insist on a fresh one);
 *   4. its cost is recorded once, at collection, and attributed to the caller's
 *      workspace when they have one.
 *
 * `APIFY_MAX_ITEMS` is deliberately not a guard here — this actor bills per
 * event, so a result-count cap does not bound it. The page ceiling, the dollar
 * cap and the four rules above are what do.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  /** Preview mode: the website to read. */
  url?: string;
  /** A label for the log line, so a preview run is attributable afterwards. */
  label?: string;
  /** Stored mode: read this competitor's stored website. */
  businessId?: string;
  competitorId?: string;
  /** Collect mode: pick up a run we stopped waiting for. */
  runId?: string;
  /** Stored mode: read the site again even inside the reuse window. */
  force?: boolean;
}

interface CompetitorRow {
  id: string;
  name: string;
  website: string;
  contacts_status: string;
  contacts_run_id: string;
}

/** One row of the discovery ledger. */
interface LedgerRow {
  id: string;
  user_id: string;
  business_id: string | null;
  competitor_id: string | null;
  mode: string;
  run_id: string;
  scanned_url: string;
  status: string;
  suggestions: unknown;
  unmonitored: string[] | null;
  cost_usd: number | string;
  updated_at?: string;
}

/** How long one invocation will wait for its run, in total. */
const WAIT_BUDGET_MS = 60_000;

/** Postgres' unique-violation code, which is how a losing claim is recognised. */
const UNIQUE_VIOLATION = "23505";

/**
 * How long a stored-run claim may sit uncollected before it is treated as
 * abandoned. Covers the invocation dying mid-run (a deploy, a timeout): without
 * this the one-live-run index would lock that competitor out permanently.
 */
const STALE_CLAIM_MINUTES = 30;

const LEDGER_COLUMNS =
  "id, user_id, business_id, competitor_id, mode, run_id, scanned_url, status, suggestions, unmonitored, cost_usd, updated_at";

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // Held in the handler scope (not the try) so the helpers below, which only run
  // after the caller has been authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let caps: ContactsCaps;
  let userId = "";
  let businessId: string | null = null;
  let competitorId = "";

  try {
    // Authenticated in every mode, preview included: onboarding happens before a
    // business row exists, but the person doing it is signed in.
    const caller = await requireCaller(req);
    userId = caller.userId;
    const body = await readJsonBody<Body>(req);

    if (!hasEnv("APIFY_TOKEN")) {
      return unavailable("APIFY_TOKEN is not set on the server, so no actor run can be started.");
    }
    const actorId = contactsActorId();
    if (!actorId) {
      return unavailable(
        "Website discovery is not available on this deployment — set APIFY_CONTACTS_ACTOR_ID to the actor id that scrapes a site's contact details.",
      );
    }

    db = adminClient();
    caps = contactsCaps();
    const runId = String(body.runId ?? "");

    /* -------------------------------------------------- collect a slow run */

    if (runId && !body.competitorId) {
      // Resolved from our own ledger, never from the request: a run id on its own
      // must not be enough to read another account's proposals.
      const row = await ledgerForRun(runId);
      businessId = row.business_id;
      competitorId = row.competitor_id ?? "";

      const run = await waitForRun(runId, 0);
      if (!isTerminal(run.status)) {
        return json({
          status: "running",
          runId: run.id,
          competitorId: competitorId || undefined,
          scannedUrl: row.scanned_url,
          suggestions: [],
          unmonitored: [],
        });
      }

      const review = await reviewRun(run, caps);
      // Collected now, so the cost is logged now — and only now.
      await settleLedger(row.id, run, review);
      await markCompetitorOutcome(run);
      await logRun(run, review, row.scanned_url, endpointFor(row.mode), businessId);

      return json({
        status: run.status === "SUCCEEDED" ? "done" : "failed",
        runId: run.id,
        competitorId: competitorId || undefined,
        scannedUrl: row.scanned_url,
        suggestions: review.suggestions,
        unmonitored: review.unmonitored,
        costUsd: run.usageTotalUsd,
        reason: run.status === "SUCCEEDED" ? undefined : failureReason(run),
      });
    }

    /* ------------------------------------------------------- stored mode */

    if (body.competitorId || body.businessId) {
      competitorId = String(body.competitorId ?? "");
      businessId = String(body.businessId ?? "");
      await assertBusinessOwned(userId, businessId);

      const competitor = await loadCompetitor();
      const website = scrapeUrl(competitor.website);
      if (!website) {
        throw new HttpError(
          409,
          `${competitor.name} has no readable website on file. Add one before looking for their socials.`,
        );
      }

      // A run we stopped waiting for is not thrown away: collect it first, and do
      // not start a second one, which would pay for the same pages twice. Its
      // ledger row is settled by the same call that settles the competitor.
      if (competitor.contacts_status === "running" && competitor.contacts_run_id) {
        const inFlight = competitor.contacts_run_id;
        const ledgerId = await ledgerIdForRun(inFlight);
        const run = await lookupRun(inFlight);

        if (!run) {
          // Gone rather than unreachable — an expired or deleted run. Clear both
          // pointers and fall through to a fresh read. Leaving them set would
          // strand the competitor on "checking…" permanently, and the ledger's
          // one-live-run index would refuse every later claim for it.
          await markCompetitor("idle", { contacts_run_id: "", contacts_error: null });
          if (ledgerId) await failLedger(ledgerId, "The run is no longer available at Apify.");
        } else if (!isTerminal(run.status)) {
          return json({
            status: "running",
            runId: run.id,
            competitorId,
            scannedUrl: website,
            suggestions: [],
            unmonitored: [],
          });
        } else {
          return await finishStored(run, website, ledgerId);
        }
      }

      // Idempotency for a *click*: a read taken moments ago is replayed from the
      // ledger rather than repeated, so a double-click or a page reload cannot
      // buy the same pages twice.
      if (!body.force) {
        const replay = await recentRead();
        if (replay) {
          return json({
            status: "done",
            competitorId,
            scannedUrl: replay.scanned_url || website,
            suggestions: asSuggestions(replay.suggestions),
            unmonitored: replay.unmonitored ?? [],
            costUsd: Number(replay.cost_usd ?? 0),
            cached: true,
          });
        }
      }

      const { maxChargeUsd } = await affordableCharge();

      // Claim the one-live-run slot *before* spending anything. Two concurrent
      // clicks race here and exactly one wins, which is the whole point of doing
      // it in the database rather than by reading `contacts_status` first.
      await expireStaleClaims();
      const ledgerId = await claimStoredRun(website);
      if (!ledgerId) {
        // Another request owns the run: report it as in flight rather than
        // starting a second one, and hand back nothing that was charged.
        return json({
          status: "running",
          runId: await liveStoredRunId(),
          competitorId,
          scannedUrl: website,
          suggestions: [],
          unmonitored: [],
        });
      }

      let run: ApifyRun;
      try {
        run = await start(actorId, website, caps, maxChargeUsd);
      } catch (cause) {
        // The row must not keep saying "idle" after a run that never started, or
        // the button would keep inviting a retry with no trace of what happened.
        // The claim is released too, or the next attempt would look "in flight".
        const message = cause instanceof Error ? cause.message : "The run could not be started.";
        await failLedger(ledgerId, message);
        await markCompetitor("failed", { contacts_run_id: "", contacts_error: message.slice(0, 300) });
        throw cause;
      }

      await attachRunId(ledgerId, run.id);
      const finished = await waitOut(run);

      if (!isTerminal(finished.status)) {
        // Keep the run id on the row. No usage is logged yet, so the cost is
        // counted once — when it is collected.
        await markCompetitor("running", { contacts_run_id: finished.id, contacts_error: null });
        return json({
          status: "running",
          runId: finished.id,
          competitorId,
          scannedUrl: website,
          suggestions: [],
          unmonitored: [],
        });
      }

      return await finishStored(finished, website, ledgerId);
    }

    /* ------------------------------------------------------ preview mode */

    const url = scrapeUrl(String(body.url ?? ""));
    if (!url) {
      throw new HttpError(400, "A website URL is required to look for social profiles.");
    }

    // No workspace to bill here, because the business row does not exist yet — so
    // the allowance is the caller's, counted from the ledger. A user who has
    // already finished setup still has their spend attributed to their
    // workspace, and the per-run ceiling bounds any single run.
    const cap = contactsPreviewCapPerHour();
    const used = await previewRunsThisHour();
    if (used >= cap) throw new HttpError(429, previewQuotaMessage(used, cap));

    const ledgerId = await claimPreviewRun(url);

    let run: ApifyRun;
    try {
      run = await start(actorId, url, caps, caps.maxChargeUsd);
    } catch (cause) {
      await failLedger(ledgerId, cause instanceof Error ? cause.message : "The run could not be started.");
      throw cause;
    }

    await attachRunId(ledgerId, run.id);
    const finished = await waitOut(run);

    if (!isTerminal(finished.status)) {
      return json({
        status: "running",
        runId: finished.id,
        scannedUrl: url,
        suggestions: [],
        unmonitored: [],
      });
    }

    const review = await reviewRun(finished, caps);
    await settleLedger(ledgerId, finished, review);
    await logRun(finished, review, url, "contacts:preview", businessId);

    return json({
      status: finished.status === "SUCCEEDED" ? "done" : "failed",
      runId: finished.id,
      scannedUrl: url,
      suggestions: review.suggestions,
      unmonitored: review.unmonitored,
      costUsd: finished.usageTotalUsd,
      reason: finished.status === "SUCCEEDED" ? undefined : failureReason(finished),
    });
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * A configuration state rather than a failure: the surface explains itself and
   * the actor id is never guessed at. Returning 200 keeps that out of the error
   * path, which is the difference between "this deployment cannot do it" and
   * "your request went wrong".
   */
  function unavailable(reason: string) {
    return json({
      status: "unavailable",
      scannedUrl: "",
      suggestions: [],
      unmonitored: [],
      reason,
    });
  }

  function failureReason(run: ApifyRun): string {
    const detail = run.statusMessage ?? run.status;
    return `The scraper did not finish cleanly: ${detail}`;
  }

  function endpointFor(mode: string): string {
    return mode === "stored" ? "contacts:stored" : "contacts:preview";
  }

  async function loadCompetitor(): Promise<CompetitorRow> {
    const { data, error } = await db
      .from("competitors")
      .select("id, name, website, contacts_status, contacts_run_id")
      .eq("id", competitorId)
      .eq("business_id", businessId ?? "")
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "That competitor is not in this workspace.");
    return data as CompetitorRow;
  }

  /**
   * Looks a run up at Apify, separating "gone" from "could not ask".
   *
   * Returns null only for a provider `404` — the run no longer exists — which is
   * the one answer that justifies abandoning it. Every other failure stays an
   * error, because clearing the pointer on a *transient* one would start a fresh
   * run for pages that are already being paid for: retrying costs nothing, a
   * second run costs money.
   *
   * The `404` is read out of the message because `_shared/http.ts` folds the
   * provider's status into the text (`Provider request failed (404): …`) rather
   * than keeping it on the error. Reformatting that message would silently turn
   * this back into a permanent dead end, so the pattern is deliberately narrow.
   */
  async function lookupRun(apifyRunId: string): Promise<ApifyRun | null> {
    try {
      return await waitForRun(apifyRunId, 0);
    } catch (cause) {
      if (cause instanceof HttpError && /\(404\)/.test(cause.message)) return null;
      const detail = cause instanceof Error ? cause.message : "the run could not be read";
      throw new HttpError(
        503,
        `Could not check the read already in flight (${detail}). Try again in a moment — it may still be running.`,
      );
    }
  }

  /**
   * The caller's own workspace, when they already have one.
   *
   * Preview mode has no `businessId` in the body by design — onboarding runs
   * before the row exists — but a user who has finished setup and is discovering
   * from somewhere else does have one, and their spend belongs in its allowance
   * rather than nowhere.
   */
  async function ownedBusinessId(): Promise<string | null> {
    const { data, error } = await db
      .from("businesses")
      .select("id")
      .eq("owner_user_id", userId)
      .limit(1)
      .maybeSingle();
    if (error) return null;
    return data ? String((data as { id: string }).id) : null;
  }

  /** How many preview runs this user has started in the last hour. */
  async function previewRunsThisHour(): Promise<number> {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error } = await db
      .from("contacts_discovery_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("mode", "preview")
      .gte("created_at", since);
    // Fails closed: without a count we cannot prove the user is inside their
    // allowance, and guessing in their favour is what lets a loop run unbounded.
    if (error) {
      throw new HttpError(
        503,
        `Could not check your website-read allowance (${error.message}). Try again in a moment.`,
      );
    }
    return count ?? 0;
  }

  /**
   * Claims the one live stored run for a competitor, or null when it is taken.
   *
   * The row is written *before* the actor is asked to do anything, with an empty
   * `run_id` filled in once Apify answers. That order matters: the claim has to
   * happen before the spend, or two requests could both get past it.
   */
  async function claimStoredRun(url: string): Promise<string | null> {
    return await insertClaim("stored", url, competitorId, true);
  }

  /** A preview claim. No competitor, so the one-live index cannot collide here. */
  async function claimPreviewRun(url: string): Promise<string> {
    const claimed = await insertClaim("preview", url, null, false);
    if (!claimed) throw new HttpError(500, "Could not record the website read.");
    return claimed;
  }

  async function insertClaim(
    mode: "preview" | "stored",
    url: string,
    target: string | null,
    allowConflict: boolean,
  ): Promise<string | null> {
    const resolvedBusiness = businessId ?? (await ownedBusinessId());
    const { data, error } = await db
      .from("contacts_discovery_runs")
      .insert({
        user_id: userId,
        business_id: resolvedBusiness,
        competitor_id: target,
        mode,
        actor_id: contactsActorId(),
        scanned_url: url,
        status: "running",
      })
      .select("id")
      .single();

    if (error) {
      // The one-live-run index rejected a second concurrent claim for this
      // competitor — the expected way two clicks collide, not an error to raise.
      if (allowConflict && error.code === UNIQUE_VIOLATION) return null;
      throw new HttpError(500, error.message);
    }

    // Remember it, so the log line attributes the spend to the same workspace.
    if (mode === "preview") businessId = resolvedBusiness;
    return String((data as { id: string }).id);
  }

  /**
   * Releases claims whose invocation never came back — a deploy or a timeout
   * mid-run. Without this the one-live-run index would lock the competitor out
   * of discovery permanently.
   */
  async function expireStaleClaims(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
    const { error } = await db
      .from("contacts_discovery_runs")
      .update({
        status: "failed",
        error: `The read was never collected within ${STALE_CLAIM_MINUTES} minutes and is being retried.`,
      })
      .eq("competitor_id", competitorId)
      .eq("mode", "stored")
      .eq("status", "running")
      .lt("created_at", cutoff);
    if (error) throw new HttpError(500, error.message);
  }

  async function attachRunId(ledgerId: string, apifyRunId: string): Promise<void> {
    await updateLedger(ledgerId, { run_id: apifyRunId });
  }

  async function failLedger(ledgerId: string, message: string): Promise<void> {
    await updateLedger(ledgerId, { status: "failed", error: message.slice(0, 300) });
  }

  /** Records how a run ended. Called once, at collection. */
  async function settleLedger(
    ledgerId: string,
    run: ApifyRun,
    review: ContactReview,
  ): Promise<void> {
    await updateLedger(ledgerId, {
      status: run.status === "SUCCEEDED" ? "done" : "failed",
      suggestions: review.suggestions,
      unmonitored: review.unmonitored,
      suggestion_count: review.suggestions.length,
      cost_usd: Number(run.usageTotalUsd ?? 0),
      run_id: run.id,
      error: run.status === "SUCCEEDED" ? null : failureReason(run).slice(0, 300),
    });
  }

  async function updateLedger(ledgerId: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await db.from("contacts_discovery_runs").update(patch).eq("id", ledgerId);
    if (error) throw new HttpError(500, error.message);
  }

  /** The ledger row for a run, restricted to the caller's own rows. */
  async function ledgerForRun(runId: string): Promise<LedgerRow> {
    const { data, error } = await db
      .from("contacts_discovery_runs")
      .select(LEDGER_COLUMNS)
      .eq("run_id", runId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) {
      // Deliberately the same answer for "no such run" and "someone else's run":
      // a distinguishable 403 would confirm that a guessed id exists.
      throw new HttpError(404, "That discovery run is not in this account.");
    }
    return data as LedgerRow;
  }

  /** The ledger row id for one of our Apify runs, when it is one we started. */
  async function ledgerIdForRun(apifyRunId: string): Promise<string | undefined> {
    const { data, error } = await db
      .from("contacts_discovery_runs")
      .select("id")
      .eq("run_id", apifyRunId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    return data ? String((data as { id: string }).id) : undefined;
  }

  /** The most recent stored read for this competitor, when it is still fresh. */
  async function recentRead(): Promise<LedgerRow | null> {
    const { data, error } = await db
      .from("contacts_discovery_runs")
      .select(LEDGER_COLUMNS)
      .eq("competitor_id", competitorId)
      .eq("mode", "stored")
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;

    const row = data as LedgerRow;
    return reusableWithin(row.updated_at, contactsReuseWindowMinutes()) ? row : null;
  }

  /** The in-flight stored run's Apify id, for the response when a claim lost. */
  async function liveStoredRunId(): Promise<string> {
    const { data } = await db
      .from("contacts_discovery_runs")
      .select("run_id")
      .eq("competitor_id", competitorId)
      .eq("mode", "stored")
      .eq("status", "running")
      .limit(1)
      .maybeSingle();
    return data ? String((data as { run_id: string }).run_id ?? "") : "";
  }

  function asSuggestions(value: unknown): ContactSuggestion[] {
    return Array.isArray(value) ? (value as ContactSuggestion[]) : [];
  }

  /** The per-run ceiling, trimmed to what the workspace has left this month. */
  async function affordableCharge(): Promise<{ maxChargeUsd: number }> {
    // A workspace is required in stored mode, so this always has a tenant to ask.
    const spend = await readSpend(db, businessId ?? "", "apify");
    if (spend.remainingUsd < CONTACTS_MIN_CHARGE_USD) {
      // This actor cannot run below its own minimum, so there is nothing to trim
      // down to — the refusal names the floor rather than the cap.
      throw new HttpError(429, spendMessage(spend, CONTACTS_MIN_CHARGE_USD));
    }
    return { maxChargeUsd: Number(Math.min(caps.maxChargeUsd, spend.remainingUsd).toFixed(4)) };
  }

  async function start(
    actorIdValue: string,
    url: string,
    limits: ContactsCaps,
    maxTotalChargeUsd: number,
  ): Promise<ApifyRun> {
    return await startRun(actorIdValue, contactsInputFor(url, limits), {
      // Page-count cap on the dataset, which with `mergeContacts` is one row per
      // start URL. The real guards are `maxRequests` in the input and the dollars.
      maxItems: limits.maxPages,
      maxTotalChargeUsd,
      timeoutSecs: limits.timeoutSecs,
    });
  }

  /** Waits for a run in bounded windows, and returns it however it stands. */
  async function waitOut(run: ApifyRun): Promise<ApifyRun> {
    const deadline = Date.now() + WAIT_BUDGET_MS;
    let current = run;
    while (!isTerminal(current.status) && Date.now() < deadline) {
      const secondsLeft = Math.floor((deadline - Date.now()) / 1000);
      if (secondsLeft <= 0) break;
      current = await waitForRun(current.id, Math.min(60, secondsLeft));
    }
    return current;
  }

  /** Reads a finished run's dataset into suggestions. */
  async function reviewRun(run: ApifyRun, limits: ContactsCaps): Promise<ContactReview> {
    if (run.status !== "SUCCEEDED" || !run.defaultDatasetId) {
      return { suggestions: [], unmonitored: [] };
    }
    const items = await fetchDatasetItems(run.defaultDatasetId, limits.maxPages);
    return reviewContacts(items);
  }

  /** Records the cost of one collected run, exactly once. */
  async function logRun(
    run: ApifyRun,
    review: ContactReview,
    url: string,
    endpoint: string,
    attributedTo: string | null,
  ): Promise<void> {
    await recordUsage(db, {
      businessId: attributedTo,
      provider: "apify",
      endpoint,
      // One site read, whatever it cost — the dollars are the unit this actor bills.
      units: 1,
      costUsd: run.usageTotalUsd,
      status: run.status === "SUCCEEDED" ? "ok" : "error",
      detail: `${url || "unknown site"}: ${review.suggestions.length} profiles`.slice(0, 300),
    });
  }

  /**
   * Stores the outcome of a run against the competitor.
   *
   * A scrape that ran and found nothing is `done`, not `failed`: the site is
   * simply not publishing its socials, and the surface says so. Preview runs have
   * no competitor, so this is a no-op for them.
   */
  async function markCompetitorOutcome(run: ApifyRun): Promise<void> {
    if (!competitorId) return;
    const ok = run.status === "SUCCEEDED";
    await markCompetitor(ok ? "done" : "failed", {
      contacts_run_id: "",
      contacts_scanned_at: new Date().toISOString(),
      contacts_error: ok ? null : failureReason(run).slice(0, 300),
    });
  }

  /** Settles a finished stored run everywhere it is recorded, and answers. */
  async function finishStored(run: ApifyRun, website: string, ledgerId?: string) {
    const review = await reviewRun(run, caps);
    const ok = run.status === "SUCCEEDED";

    if (ledgerId) await settleLedger(ledgerId, run, review);
    await markCompetitorOutcome(run);
    await logRun(run, review, website, "contacts:stored", businessId);

    return json({
      status: ok ? "done" : "failed",
      runId: run.id,
      competitorId,
      scannedUrl: website,
      suggestions: review.suggestions,
      unmonitored: review.unmonitored,
      costUsd: run.usageTotalUsd,
      reason: ok ? undefined : failureReason(run),
    });
  }

  async function markCompetitor(status: string, fields: Record<string, unknown>): Promise<void> {
    const { error } = await db
      .from("competitors")
      .update({ contacts_status: status, ...fields })
      .eq("id", competitorId);
    if (error) throw new HttpError(500, error.message);
  }
});
