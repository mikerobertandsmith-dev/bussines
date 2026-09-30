import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { readSpend, spendMessage } from "../_shared/budget.ts";
import {
  catalogueKey,
  catalogueUrl,
  normaliseCatalogue,
  safeItemKind,
  safeStockState,
  sourceSettlement,
  siteActorHint,
  siteActorId,
  siteCaps,
  siteInputFor,
  type ScrapedProduct,
  type SiteCaps,
} from "../_shared/site.ts";
import {
  fetchDatasetItems,
  isTerminal,
  startRun,
  waitForRun,
  type ApifyRun,
} from "../_shared/apify.ts";

/**
 * Reads a watched **competitor's website catalogue** — their product pages — and
 * turns it into change rows. This is the scan the Competition page's
 * pull-to-refresh runs, and the reason `scan_runs` no longer holds rows that only
 * say `queued`: a site read now happens here, for real.
 *
 * Both the source and the products live in the competitor tables
 * (`competitors` / `competitor_items`), and the read runs through the product
 * catalogue actor named by `APIFY_SITE_ACTOR_ID`. It does need that secret. The
 * fallback to `APIFY_CONTACTS_ACTOR_ID` still starts a run, but that actor returns
 * contact details and no product rows, so the scan bills, reports success and
 * writes nothing — see `_shared/site.ts` for the measurement.
 *
 * ## What a row in `competitor_items` means
 *
 * A **change**, not a snapshot. `competitor_items.change` is the enum the page
 * filters on ("New products", "Price moves", "Stock moves"), and every one of the
 * three means a difference from the previous read. So a product that was read
 * again unchanged is *not* written: writing it as `new_product` (the only value
 * left over) would relabel the whole catalogue as new on every scan, which is
 * exactly the signal the page exists to show.
 *
 * The comparison is against the newest existing row **per product**, keyed by
 * `catalogueKey(sku, product)` — the SKU when the page publishes one, the
 * normalised name otherwise. Both sides must derive that key the same way or
 * everything looks new, which is why the helper lives in `_shared/site.ts`.
 *
 * A product that disappears is deliberately *not* reported as `removed`: this is a
 * bounded crawl, not an exhaustive one, so absence proves nothing.
 *
 * ## Cost
 *
 * Same contract as every other Apify function here: the run is planned against the
 * workspace's remaining monthly dollars first (and refused with a 429 when nothing
 * fits), `maxItems` / `maxTotalChargeUsd` / `timeout` are also sent to Apify, and
 * the cost is recorded exactly once — when the run is collected.
 *
 * A crawl outlives one browser request, so the run id is held on the source row
 * (`competitors.site_run_id`, migration `0021`) and the next scan **collects** it
 * instead of starting — and paying for — a second one.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */

interface Body {
  /** The workspace the source belongs to. Required: this writes tenant data. */
  businessId?: string;
  /** The competitor row to read. */
  sourceId?: string;
}

/** The columns the handler needs off `competitors`. */
interface SourceRow {
  id: string;
  name: string;
  website: string;
  cadence: string;
  /** Set while a crawl we stopped waiting for is still being collected. */
  site_run_id: string | null;
}

/** An existing product row, as the diff needs it. */
interface ItemRow {
  sku: string | null;
  product: string | null;
  price: number | string | null;
  stock: string | null;
}

/** The last state we hold for one product. */
interface KnownItem {
  price: number;
  stock: string;
}

/** How long one invocation waits for its crawl, in total. */
const WAIT_BUDGET_MS = 90_000;

/**
 * The floor a run has to clear to be worth starting.
 *
 * A crawl actor bills per page or per result and refuses a run below its own
 * minimum, so there is no point trimming the ceiling to a fraction of a cent: the
 * refusal names the floor instead.
 */
const SITE_MIN_CHARGE_USD = 0.01;

/**
 * How many existing rows are read to build the "what did we see last time" index.
 * Also Supabase's own return cap. One change row per product per scan means a
 * source would need a thousand separate changes before this truncates — and if it
 * ever did, the oldest products would simply be re-reported once as new.
 */
const KNOWN_ROW_LIMIT = 1000;

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  // Held in the handler scope (not the try) so the helpers below, which only run
  // after the caller has been authenticated, can close over them.
  let db: ReturnType<typeof adminClient>;
  let caps: SiteCaps;
  let sourceId = "";
  let businessId = "";
  let source: SourceRow;
  /** When this invocation began the read, for the `scan_runs` row. */
  let startedAt = new Date().toISOString();

  try {
    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);

    sourceId = String(body.sourceId ?? "");
    businessId = String(body.businessId ?? "");

    if (!hasEnv("APIFY_TOKEN")) {
      return unavailable("APIFY_TOKEN is not set on the server, so no catalogue read can be started.");
    }
    const actorId = siteActorId();
    if (!actorId) return unavailable(siteActorHint());

    if (!sourceId) throw new HttpError(400, "A source is required to scan a watched site.");
    await assertBusinessOwned(caller.userId, businessId);

    db = adminClient();
    caps = siteCaps();
    source = await loadSource();

    const website = catalogueUrl(source.website);
    if (!website) {
      throw new HttpError(
        409,
        `${source.name} has no readable website on file. Add one before scanning its catalogue.`,
      );
    }

    /* -------------------------------------------- collect a crawl in flight */

    if (source.site_run_id) {
      const inFlight = await lookupRun(source.site_run_id);

      if (inFlight && !isTerminal(inFlight.status)) {
        return running(inFlight.id, website);
      }

      if (inFlight) {
        return await finish(inFlight, website);
      }

      // Gone rather than unreachable — an expired or deleted run. Clear the
      // pointer and fall through to a fresh read; leaving it set would strand the
      // source on "checking…" and make every later scan wait on a run that no
      // longer exists.
      await patchSource({
        site_run_id: null,
        site_error: "The previous read is no longer available at Apify.",
      });
    }

    /* --------------------------------------------------------------- start */

    const maxChargeUsd = await affordableCharge();
    startedAt = new Date().toISOString();

    let run: ApifyRun;
    try {
      run = await startRun(actorId, siteInputFor(website, caps), {
        maxItems: caps.maxItems,
        maxTotalChargeUsd: maxChargeUsd,
        timeoutSecs: caps.timeoutSecs,
      });
    } catch (cause) {
      // A run that never started must not leave a claim behind: the row would
      // otherwise wait on a run id that does not exist, and the next scan would
      // treat the source as still busy.
      const message = cause instanceof Error ? cause.message : "The read could not be started.";
      await patchSource({ site_run_id: null, site_error: message.slice(0, 300) });
      throw cause;
    }

    await patchSource({ site_run_id: run.id, site_error: null });

    const finished = await waitOut(run);
    if (!isTerminal(finished.status)) {
      // The run id stays on the row, and no usage is logged yet, so the cost is
      // counted once — when the next scan collects it.
      return running(finished.id, website);
    }

    return await finish(finished, website);
  } catch (error) {
    return failure(error);
  }

  /* ------------------------------------------------------------- helpers */

  /**
   * A configuration state rather than a failure: the actor id is never guessed at,
   * and returning 200 keeps "this deployment cannot do it" out of the error path.
   */
  function unavailable(reason: string) {
    return json({
      status: "unavailable",
      sourceId,
      scannedUrl: "",
      items: 0,
      changes: 0,
      reason,
    });
  }

  /** A crawl we are not waiting for any longer; the next scan collects it. */
  function running(runId: string, website: string): Response {
    return json({
      status: "running",
      sourceId,
      scannedUrl: website,
      runId,
      items: 0,
      changes: 0,
    });
  }

  function failureReason(run: ApifyRun): string {
    const detail = run.statusMessage ?? run.status;
    return `The site read did not finish cleanly: ${detail}`;
  }

  async function loadSource(): Promise<SourceRow> {
    const { data, error } = await db
      .from("competitors")
      .select("id, name, website, cadence, site_run_id")
      .eq("id", sourceId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data) throw new HttpError(404, "That competitor is not in this workspace.");
    return data as unknown as SourceRow;
  }

  /**
   * Looks a run up at Apify, separating "gone" from "could not ask".
   *
   * Returns null only for a provider `404` — the run no longer exists — which is
   * the one answer that justifies abandoning it. Every other failure stays an
   * error, because clearing the pointer on a *transient* one would start a fresh
   * run for pages that are already being paid for: retrying costs nothing, a
   * second run costs money. The `404` is matched in the message because
   * `_shared/http.ts` folds the provider's status into the text.
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

  /** The per-run ceiling, trimmed to what the workspace has left this month. */
  async function affordableCharge(): Promise<number> {
    const spend = await readSpend(db, businessId, "apify");
    if (spend.remainingUsd < SITE_MIN_CHARGE_USD) {
      throw new HttpError(429, spendMessage(spend, SITE_MIN_CHARGE_USD));
    }
    return Number(Math.min(caps.maxChargeUsd, spend.remainingUsd).toFixed(4));
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

  /**
   * Reads a finished run's dataset.
   *
   * The dataset is fetched for **any** terminal status, not just `SUCCEEDED`: a
   * crawl that hit its own timeout (`TIMED-OUT`) still wrote every page it got
   * through, and a partial catalogue is a usable change feed rather than nothing.
   * That is why the outcome below is decided by whether products came back, not
   * by the status alone.
   */
  async function readCatalogue(run: ApifyRun): Promise<ScrapedProduct[]> {
    if (!run.defaultDatasetId) return [];
    const items = await fetchDatasetItems(run.defaultDatasetId, caps.maxItems);
    return normaliseCatalogue(items, caps.maxItems);
  }

  /** Settles a finished run everywhere it is recorded, and answers. */
  async function finish(run: ApifyRun, website: string) {
    const scraped = await readCatalogue(run);
    const ok = run.status === "SUCCEEDED" || scraped.length > 0;
    const changes = ok ? await writeItems(scraped) : 0;
    const collectedAt = new Date().toISOString();

    // The patch is built by `_shared/site.ts`, which knows the shape of the
    // `competitors` row: this update is the one that settles it — items are
    // already written by now, so a rejected update would leave the catalogue in
    // place and the run uncollected.
    await patchSource(
      sourceSettlement({
        ok,
        collectedAt,
        error: failureReason(run).slice(0, 300),
      }),
    );

    await insertRun(run, ok, changes, collectedAt);
    await logUsage(run, website, scraped.length, changes, ok);

    return json({
      status: ok ? "done" : "failed",
      sourceId,
      scannedUrl: website,
      runId: run.id,
      items: scraped.length,
      changes,
      costUsd: run.usageTotalUsd,
      reason: ok ? undefined : failureReason(run),
    });
  }

  /**
   * Writes one row per product that **changed**, and answers how many.
   *
   * The index is built newest-first, so the first row seen for a key is the state
   * we last held. A product we have never seen is `new_product` with its own price
   * and stock as the previous values (there is no earlier read to compare to, and
   * storing the current values keeps `previousPrice` a number as the app expects).
   * An unchanged product writes nothing at all.
   */
  async function writeItems(scraped: ScrapedProduct[]): Promise<number> {
    if (!scraped.length) return 0;
    const known = await newestByKey();
    const detectedAt = new Date().toISOString();
    const rows: Record<string, unknown>[] = [];

    for (const product of scraped) {
      const previous = known.get(product.key);

      if (!previous) {
        rows.push({
          ...itemRow(product, detectedAt),
          change: "new_product",
          previous_price: product.price,
          previous_stock: product.stock,
        });
        continue;
      }

      const priceMoved = Math.abs(previous.price - product.price) >= 0.01;
      const stockMoved = previous.stock !== product.stock;
      // Unchanged: not a change, so not a row.
      if (!priceMoved && !stockMoved) continue;

      rows.push({
        ...itemRow(product, detectedAt),
        change: priceMoved ? "price_change" : "stock_change",
        previous_price: previous.price,
        previous_stock: previous.stock,
      });
    }

    if (!rows.length) return 0;
    const { error } = await db.from("competitor_items").insert(rows);
    if (error) throw new HttpError(500, error.message);
    return rows.length;
  }

  /** One item row's source-owned columns; the change columns are set per case. */
  function itemRow(product: ScrapedProduct, detectedAt: string): Record<string, unknown> {
    return {
      business_id: businessId,
      competitor_id: sourceId,
      product: product.product,
      sku: product.sku || null,
      category: product.category || null,
      // What the site published it as — a product, a service, or a price plan. The
      // catalogue labels each row with it, so a business whose site is its pricing
      // page no longer reads as "publishes no catalogue".
      kind: safeItemKind(product.kind),
      price: product.price,
      stock: safeStockState(product.stock),
      url: product.url || null,
      detected_at: detectedAt,
    };
  }

  /** The current state we hold for each product of this source, by catalogue key. */
  async function newestByKey(): Promise<Map<string, KnownItem>> {
    const { data, error } = await db
      .from("competitor_items")
      .select("sku, product, price, stock, detected_at")
      .eq("competitor_id", sourceId)
      .order("detected_at", { ascending: false })
      .limit(KNOWN_ROW_LIMIT);
    if (error) throw new HttpError(500, error.message);

    const index = new Map<string, KnownItem>();
    for (const row of (data ?? []) as ItemRow[]) {
      const key = catalogueKey(row.sku ?? "", row.product ?? "");
      // Newest first, so the first row for a key is the one to compare against.
      if (index.has(key)) continue;
      index.set(key, {
        price: Number(row.price ?? 0),
        stock: safeStockState(String(row.stock ?? "in_stock")),
      });
    }
    return index;
  }

  /** One `scan_runs` row for the read, so the page's history shows it. */
  async function insertRun(
    run: ApifyRun,
    ok: boolean,
    changes: number,
    finishedAt: string,
  ): Promise<void> {
    const { error } = await db.from("scan_runs").insert({
      business_id: businessId,
      source_type: "competitor",
      source_id: sourceId,
      source_name: source.name,
      status: ok ? "succeeded" : "failed",
      changes_found: changes,
      error: ok ? null : failureReason(run).slice(0, 300),
      started_at: startedAt,
      finished_at: finishedAt,
    });
    if (error) throw new HttpError(500, error.message);
  }

  /** Records the cost of one collected read, exactly once. */
  async function logUsage(
    run: ApifyRun,
    website: string,
    found: number,
    changes: number,
    ok: boolean,
  ): Promise<void> {
    await recordUsage(db, {
      businessId,
      provider: "apify",
      endpoint: "site:competitor",
      // One site read, whatever it cost — the dollars are the unit this bills.
      units: 1,
      costUsd: run.usageTotalUsd,
      status: ok ? "ok" : "error",
      detail: `${website}: ${found} products, ${changes} changes`.slice(0, 300),
    });
  }

  async function patchSource(patch: Record<string, unknown>): Promise<void> {
    const { error } = await db
      .from("competitors")
      .update(patch)
      .eq("id", sourceId)
      .eq("business_id", businessId);
    if (error) throw new HttpError(500, error.message);
  }
});
