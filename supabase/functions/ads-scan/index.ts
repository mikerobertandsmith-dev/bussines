import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv, hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import { clampInt } from "../_shared/keywords.ts";
import { fetchDatasetItems, isTerminal, startRun, waitForRun } from "../_shared/apify.ts";
import {
  adLibraryUrlFor,
  adsActorId,
  adsMaxChargeUsd,
  adsMaxTargets,
  adsResultsLimit,
  advertiserMatches,
  normaliseAds,
  type ScrapedAd,
} from "../_shared/ads.ts";

/**
 * Competitor advertising scan (Apify → Meta Ad Library).
 *
 * This is the producer for *Active ad campaigns* on Competition. The tile counts
 * `competitor_ads` rows with an `active` status, and nothing had ever written that
 * table, so it read 0 for every rival however much they advertised.
 *
 * ## Addressable advertisers only
 *
 * An ad is stored against a competitor only when that competitor's **Facebook
 * page is known** — a handle saved on Competition → Social presence. Meta's
 * library answers free-text searches, but not with the advertiser you asked for:
 * measured here, a search for *Patagonia* returned Mapu Lahual Chile, Rue La La,
 * On Water Expeditions and MRCOOL, and `search_type=page` returned the same set.
 * Filing those under a competitor would put another company's campaigns on their
 * profile and into their alerts. Competitors without a saved page are reported in
 * `skipped` with what to do about it, and nothing is guessed.
 *
 * One run covers every addressable competitor: the actor accepts a list of page
 * URLs, which keeps this to a single actor job and a single spend rather than one
 * per rival.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  /** Scans one competitor's ads only. */
  competitorId?: string;
}

interface CompetitorRow {
  id: string;
  name: string;
}

interface SocialRow {
  competitor_id: string;
  platform: string;
  handle: string;
}

/** One advertiser we will read the library for. */
interface Target {
  competitorId: string;
  name: string;
  handle: string;
}

const MIN_CHARGE_USD = 0.01;
/** How long we hold the request open; the actor is usually through in under a minute. */
const WAIT_BUDGET_MS = 110_000;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // In the handler scope (not the try) so the helper below, which runs only after
  // the caller is authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let businessId = "";

  try {
    if (!hasEnv("APIFY_TOKEN")) {
      throw new HttpError(409, "Apify is not configured on the server. Add APIFY_TOKEN.");
    }
    const actorId = adsActorId();
    if (!actorId) {
      throw new HttpError(
        409,
        "Competitor advertising is not configured on the server. Add APIFY_ADS_ACTOR_ID.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    db = adminClient();
    const startedAt = new Date().toISOString();
    const checkedAt = startedAt;

    /* ------------------------------------------------------------ targets */

    const { data: competitorRows, error: competitorError } = await db
      .from("competitors")
      .select("id, name")
      .eq("business_id", businessId);
    if (competitorError) throw new HttpError(500, competitorError.message);
    const competitors = (competitorRows ?? []) as CompetitorRow[];

    if (!competitors.length) {
      return json({
        status: "unavailable",
        scanned: 0,
        ads: 0,
        active: 0,
        running: false,
        skipped: [],
        reason: "Add a competitor first — the ad library is read per advertiser.",
      });
    }

    const { data: socialRows, error: socialError } = await db
      .from("competitor_social")
      .select("competitor_id, platform, handle")
      .in(
        "competitor_id",
        competitors.map((competitor) => competitor.id),
      );
    if (socialError) throw new HttpError(500, socialError.message);

    // The Ad Library is Meta's, so only a Facebook page is addressable — an
    // Instagram handle is not a page id the library accepts.
    const facebookByCompetitor = new Map<string, string>();
    for (const row of (socialRows ?? []) as SocialRow[]) {
      if (!String(row.platform ?? "").toLowerCase().startsWith("facebook")) continue;
      const handle = String(row.handle ?? "").trim();
      if (handle) facebookByCompetitor.set(row.competitor_id, handle);
    }

    const skipped: { competitor: string; reason: string }[] = [];
    const targets: Target[] = [];
    for (const competitor of competitors) {
      if (body.competitorId && competitor.id !== body.competitorId) continue;
      const handle = facebookByCompetitor.get(competitor.id);
      if (!handle) {
        skipped.push({
          competitor: competitor.name,
          reason:
            "no Facebook page saved — add it on Competition → Social presence, then scan again",
        });
        continue;
      }
      targets.push({ competitorId: competitor.id, name: competitor.name, handle });
    }

    if (!targets.length) {
      // Nothing was asked of a provider, so this is not reported as a scan that
      // ran — it is a configuration state, and it says which.
      return json({
        status: "unavailable",
        scanned: 0,
        ads: 0,
        active: 0,
        running: false,
        skipped,
        reason:
          "No competitor has a Facebook page saved, so the ad library has no advertiser to read. Add one on Competition → Social presence, then run the scan again.",
      });
    }

    const maxTargets = adsMaxTargets();
    const selected = targets.slice(0, maxTargets);
    const resultsLimit = adsResultsLimit();

    /* ------------------------------------------------------------- budget */

    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < MIN_CHARGE_USD) {
      throw new HttpError(429, spendMessage(spend, MIN_CHARGE_USD));
    }
    const maxChargeUsd = Number(Math.min(adsMaxChargeUsd(), spend.remainingUsd).toFixed(4));

    /* ------------------------------------------------------- start and wait */

    const run = await startRun(
      actorId,
      {
        startUrls: selected.map((target) => ({ url: adLibraryUrlFor(target.handle) })),
        // Per advertiser, which is what the actor's own label says.
        resultsLimit,
      },
      {
        maxItems: resultsLimit * selected.length,
        maxTotalChargeUsd: maxChargeUsd,
        timeoutSecs: clampInt(getEnv("APIFY_ADS_RUN_TIMEOUT_SECS"), 30, 3600, 300),
      },
    );

    const deadline = Date.now() + WAIT_BUDGET_MS;
    let current = run;
    while (!isTerminal(current.status) && Date.now() < deadline) {
      const secondsLeft = Math.floor((deadline - Date.now()) / 1000);
      if (secondsLeft <= 0) break;
      current = await waitForRun(current.id, Math.min(60, secondsLeft));
    }

    if (!isTerminal(current.status)) {
      return json({
        status: current.status,
        running: true,
        scanned: selected.length,
        ads: 0,
        active: 0,
        skipped,
        costUsd: 0,
        message: "The ad-library read is still running. Run the scan again in a minute.",
      });
    }

    if (current.status !== "SUCCEEDED") {
      const detail = current.statusMessage ?? current.status;
      await recordUsage(db, {
        businessId,
        provider: "apify",
        endpoint: `actors/${actorId}`,
        units: 0,
        costUsd: current.usageTotalUsd,
        status: "error",
        detail: detail.slice(0, 300),
      });
      await writeRun("failed", 0, startedAt, detail);
      throw new HttpError(502, `The ad library could not be read: ${detail}`);
    }

    /* --------------------------------------------------- normalise and write */

    const items = await fetchDatasetItems(current.defaultDatasetId, resultsLimit * selected.length);
    const ads = normaliseAds(items);

    let written = 0;
    let active = 0;
    const read: string[] = [];
    const empty: string[] = [];

    for (const target of selected) {
      const theirs = ads.filter((ad) => advertiserMatches(target, ad, target.name));
      if (!theirs.length) {
        empty.push(target.name);
        // Their page was read and had nothing live. Clearing their old rows is
        // the honest write: a campaign that has stopped must stop showing.
        await replaceAds(target, []);
        continue;
      }
      await replaceAds(target, theirs);
      const live = theirs.filter((ad) => ad.status === "active").length;
      written += theirs.length;
      active += live;
      read.push(target.name);
      await saveAdsRunning(target, live);
    }

    const unmatched = ads.length - written;

    await recordUsage(db, {
      businessId,
      provider: "apify",
      endpoint: `actors/${actorId}`,
      units: ads.length,
      costUsd: current.usageTotalUsd,
      detail: `${selected.length} advertisers, ${written} ads`,
    });

    await writeRun("succeeded", written, startedAt, "");

    return json({
      status: "done",
      running: false,
      /** True when `APIFY_ADS_MAX_TARGETS` cut the list short. */
      capped: targets.length > selected.length,
      scanned: selected.length,
      ads: written,
      active,
      read,
      /** Advertisers whose page is public and currently running nothing. */
      empty,
      /** Results the library returned for someone else, so a miss is visible. */
      unmatched,
      skipped,
      costUsd: current.usageTotalUsd,
      checkedAt,
      message: written
        ? `${active} active Meta ad${active === 1 ? "" : "s"} across ${read.length} competitor page${read.length === 1 ? "" : "s"}.`
        : `The ad library returned no campaigns for ${selected.length} competitor page${selected.length === 1 ? "" : "s"}.`,
    });
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * Restates one competitor's ads.
   *
   * Delete-then-insert rather than upsert: the library re-lists the same ads every
   * run, and the table has no unique key on the library's id to upsert against. The
   * whole set is replaced so a campaign that has stopped running stops being
   * counted, which is the point of an "active campaigns" tile. `first_seen_at` is
   * the ad's **own** start date from the library, not when we read it, so an ad's
   * history survives the rewrite.
   */
  async function replaceAds(target: Target, theirs: ScrapedAd[]): Promise<void> {
    const { error: deleteError } = await db
      .from("competitor_ads")
      .delete()
      .eq("business_id", businessId)
      .eq("competitor_id", target.competitorId);
    if (deleteError) throw new HttpError(500, deleteError.message);
    if (!theirs.length) return;

    const payload = theirs.map((ad) => ({
      business_id: businessId,
      competitor_id: target.competitorId,
      platform: ad.platform,
      headline: ad.headline || `${ad.advertiser} campaign`,
      audience: ad.audience || null,
      focus: ad.focus || null,
      status: ad.status,
      banner_url: ad.bannerUrl || null,
      landing_url: ad.landingUrl || null,
      first_seen_at: ad.firstSeenAt ?? new Date().toISOString(),
    }));
    const { error } = await db.from("competitor_ads").insert(payload);
    if (error) throw new HttpError(500, error.message);
  }

  /**
   * The per-channel "Ads live" figure on Competition → Social presence.
   *
   * That panel counts the ads running on one platform, which is exactly the number
   * this run just read for that competitor's Facebook page.
   */
  async function saveAdsRunning(target: Target, live: number): Promise<void> {
    const { error } = await db
      .from("competitor_social")
      .update({ ads_running: live })
      .eq("business_id", businessId)
      .eq("competitor_id", target.competitorId)
      .ilike("platform", "facebook%");
    if (error) throw new HttpError(500, error.message);
  }

  /** Records the attempt in the history the pages show. Best effort. */
  async function writeRun(
    status: "succeeded" | "failed",
    changes: number,
    started: string,
    error: string,
  ): Promise<void> {
    await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "ads",
      source_name: "Competitor advertising",
      status,
      changes_found: changes,
      error: error ? error.slice(0, 500) : null,
      started_at: started,
      finished_at: new Date().toISOString(),
    });
  }
});
