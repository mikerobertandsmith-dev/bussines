import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { getEnv, hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { withIdempotency } from "../_shared/idempotency.ts";
import { budgetMessage, readBudget } from "../_shared/budget.ts";
import {
  createPost,
  getJob,
  isTerminalJob,
  jobStatusOf,
  platformLabelOf,
  uploadMedia,
} from "../_shared/mallary.ts";

/**
 * Publish a finished ad design to the user's own social accounts (Mallary).
 *
 * Only the tenant's own delivered design is ever sent — the request names a
 * `delivered_ads` row, which is tenant-scoped, so competitor creative can never
 * reach this path (the guardrail from the blueprint).
 *
 * The whole operation is idempotent on (design, accounts, schedule): a retried
 * submit returns the first result instead of publishing twice. The media is
 * fetched server-side and pushed through Mallary's presigned upload, because a
 * post can only reference Mallary-hosted media.
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  deliveredAdId?: string;
  briefId?: string;
  accountIds?: string[];
  caption?: string;
  /** Absolute ISO timestamp. Omitted means "post now". */
  scheduledFor?: string;
  timezone?: string;
  /** A browser-exported PNG as a data URL, when the design has no hosted file. */
  mediaBase64?: string;
  mediaType?: string;
  mediaFilename?: string;
}

interface AdRow {
  id: string;
  brief_id: string | null;
  name: string;
  file_url: string;
}

interface AccountRow {
  id: string;
  platform: string;
}

/** Media ceiling for a single creative, to keep a request inside function limits. */
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;
/** How long we try to see an immediate post land before leaving it to the webhook. */
const POLL_ATTEMPTS = 3;
const POLL_DELAY_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!hasEnv("MALLARY_API_KEY")) {
      throw new HttpError(
        409,
        "Mallary is not configured on the server. Add MALLARY_API_KEY to the function secrets.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const caption = String(body.caption ?? "").trim();
    if (!caption) throw new HttpError(400, "Write a caption before posting the ad.");

    const accountIds = [...new Set((body.accountIds ?? []).map(String).filter(Boolean))];
    if (!accountIds.length) {
      throw new HttpError(400, "Pick at least one connected account to post to.");
    }

    const scheduledFor = body.scheduledFor ? String(body.scheduledFor) : "";
    const scheduledAt = scheduledFor ? new Date(scheduledFor) : null;
    if (scheduledFor && Number.isNaN(scheduledAt?.getTime() ?? Number.NaN)) {
      throw new HttpError(400, "That schedule time is not a valid date.");
    }
    const isScheduled = Boolean(scheduledAt && scheduledAt.getTime() > Date.now());

    const db = adminClient();

    /* ----------------------------------------------- design + accounts */

    const { data: ad, error: adError } = await loadDeliveredAd(db, businessId, body);
    if (adError) throw new HttpError(500, adError);
    if (!ad) {
      throw new HttpError(
        404,
        "That delivered design is not in this workspace. Open the Ad frame for a delivered design and try again.",
      );
    }

    const { data: accountRows, error: accountError } = await db
      .from("social_accounts")
      .select("id, platform")
      .eq("business_id", businessId)
      .in("id", accountIds);
    if (accountError) throw new HttpError(500, accountError.message);

    const accounts = (accountRows ?? []) as AccountRow[];
    if (!accounts.length) {
      throw new HttpError(409, "None of the chosen accounts belong to this workspace.");
    }
    const platforms = [...new Set(accounts.map((a) => a.platform))];

    // One key per (design, accounts, schedule), so a retry cannot double-post.
    const key = `publish:${ad.id}:${[...accountIds].sort().join("+")}:${scheduledFor || "now"}`;

    const result = await withIdempotency(db, businessId, "mallary", key, async () => {
      // One post is one billed unit. A retried submit returns the stored result
      // above, so this only gates a post that will actually go out.
      const budget = await readBudget(db, businessId, "mallary");
      if (budget.remaining < 1) throw new HttpError(429, budgetMessage("mallary", budget, 1));

      const media = await readMedia(ad, body);
      const mediaUrl = await uploadMedia(media.bytes, media.filename, media.contentType);

      const created = await createPost({
        message: caption,
        platforms,
        mediaUrl,
        scheduledFor: scheduledFor || undefined,
        timezone: body.timezone || undefined,
        webhookUrl: getEnv("INTEGRATIONS_WEBHOOK_URL"),
        idempotencyKey: key,
      });

      let status = isScheduled ? "queued" : jobStatusOf(created.status);
      let permalink = created.jobs.find((job) => job.postUrl)?.postUrl ?? "";

      // An immediate post usually settles within seconds; look briefly, then let
      // the webhook (or a later check) finish the job. A scheduled post is not
      // touched here — it has not been sent yet.
      if (!isScheduled) {
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
          await sleep(POLL_DELAY_MS);
          const job = await getJob(created.jobs[0].jobId);
          if (!job) continue;
          status = jobStatusOf(job.status);
          if (job.postUrl) permalink = job.postUrl;
          if (isTerminalJob(job.status)) break;
        }
      }

      const row = {
        business_id: businessId,
        brief_id: ad.brief_id,
        delivered_ad_id: ad.id,
        account_ids: accountIds,
        platforms,
        caption,
        scheduled_for: scheduledAt ? scheduledAt.toISOString() : null,
        timezone: String(body.timezone ?? ""),
        status,
        provider_job_id: created.jobs[0].jobId,
        batch_id: created.batchId,
        permalink,
        error: "",
        idempotency_key: key,
      };

      const { error: insertError } = await db.from("social_publish_jobs").insert(row);
      if (insertError) throw new HttpError(500, insertError.message);

      await db.from("scan_runs").insert({
        business_id: businessId,
        source_type: "publishing",
        source_name: "Ad publishing",
        status: status === "failed" ? "failed" : "succeeded",
        changes_found: 1,
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      });

      await recordUsage(db, {
        businessId,
        provider: "mallary",
        endpoint: "api/v1/post",
        units: 1,
        detail: `${platforms.map(platformLabelOf).join(", ")}: ${ad.name}`,
      });

      return {
        jobId: created.jobs[0].jobId,
        batchId: created.batchId,
        status,
        permalink,
        platforms,
        scheduledFor: scheduledAt ? scheduledAt.toISOString() : null,
      };
    });

    return json({ ok: true, ...result });
  } catch (error) {
    return failure(error);
  }
});

/** The delivered design the caller named, either directly or via its brief. */
async function loadDeliveredAd(
  db: ReturnType<typeof adminClient>,
  businessId: string,
  body: Body,
): Promise<{ data: AdRow | null; error: string | null }> {
  const columns = "id, brief_id, name, file_url";

  if (body.deliveredAdId) {
    const { data, error } = await db
      .from("delivered_ads")
      .select(columns)
      .eq("id", String(body.deliveredAdId))
      .eq("business_id", businessId)
      .maybeSingle();
    return { data: (data as AdRow) ?? null, error: error?.message ?? null };
  }

  if (body.briefId) {
    const { data, error } = await db
      .from("delivered_ads")
      .select(columns)
      .eq("brief_id", String(body.briefId))
      .eq("business_id", businessId)
      .order("delivered_at", { ascending: false })
      .limit(1);
    if (error) return { data: null, error: error.message };
    return { data: ((data ?? [])[0] as AdRow) ?? null, error: null };
  }

  return { data: null, error: null };
}

interface MediaPayload {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}

/**
 * The bytes to publish: a browser-exported data URL when the design has no
 * hosted file, otherwise the delivered creative fetched from its public URL.
 */
async function readMedia(ad: AdRow, body: Body): Promise<MediaPayload> {
  if (body.mediaBase64) {
    const bytes = decodeDataUrl(String(body.mediaBase64));
    if (!bytes) throw new HttpError(400, "The exported image could not be read.");
    return {
      bytes,
      filename: String(body.mediaFilename ?? `${ad.id}.png`),
      contentType: String(body.mediaType ?? "image/png"),
    };
  }

  if (!ad.file_url) {
    throw new HttpError(
      409,
      "This design has no file to publish yet. Export it from the Ad frame, or wait for the delivered file.",
    );
  }

  const response = await fetch(ad.file_url);
  if (!response.ok) {
    throw new HttpError(502, `Could not read the delivered design (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_MEDIA_BYTES) {
    throw new HttpError(413, "That design is larger than the 15 MB publishing limit.");
  }

  const contentType = response.headers.get("content-type") || contentTypeFor(ad.file_url);
  return {
    bytes: new Uint8Array(buffer),
    filename: filenameFor(ad.file_url, contentType),
    contentType,
  };
}

/** Decodes a `data:<type>;base64,<bytes>` URL, or null when it is malformed. */
function decodeDataUrl(value: string): Uint8Array | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(value.trim());
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function contentTypeFor(url: string): string {
  const extension = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  return "image/png";
}

function filenameFor(url: string, contentType: string): string {
  const name = url.split(/[?#]/)[0].split("/").pop();
  if (name && name.includes(".")) return name;
  const extension = contentType.split("/")[1] ?? "png";
  return `ad.${extension === "jpeg" ? "jpg" : extension}`;
}
