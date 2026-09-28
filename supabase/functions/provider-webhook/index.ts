import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { getEnv } from "../_shared/env.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { stableEventId, verifyHmacSignature } from "../_shared/webhookVerify.ts";
import { isReviewWebhookEvent } from "../_shared/reviews.ts";
import { platformLabelOf as mallaryPlatformLabel } from "../_shared/mallary.ts";

/**
 * Inbound provider webhook (Mallary publishing).
 *
 * This is what makes "get notified when it happens" real-time instead of polled:
 * `post.scheduled` / `post.published` / `post.partial` / `post.failed` advance the
 * matching `social_publish_jobs` row and capture its permalink.
 *
 * Reviews are no longer here: SerpApi and Apify are pull-only, so a review sync
 * runs from the workspace instead of arriving as an event. A review payload is
 * still acknowledged (and dropped) rather than erroring, so a provider that was
 * configured before the switch stops retrying instead of hammering us.
 *
 * It is unauthenticated by Clerk (a provider has no session), so:
 *   1. the HMAC signature is verified over the raw body before anything is read;
 *   2. the tenant is resolved from a row *we* wrote (a job's batch id) — never
 *      from an id in the payload;
 *   3. a payload we cannot place is acknowledged and dropped, not guessed at.
 *
 * Deploy with `--no-verify-jwt` (the platform JWT check cannot apply here).
 */
interface WebhookBody {
  event?: unknown;
  type?: unknown;
  event_id?: unknown;
  data?: unknown;
}

/** Header names providers use for the signature. */
const SIGNATURE_HEADERS = [
  "x-mallary-signature",
  "x-mallary-payload-signature",
  "x-webhook-signature",
  "x-hub-signature-256",
  "x-signature",
];

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/** "post.published" from either `event` or `type`. */
function eventName(body: WebhookBody): string {
  return firstString(body.event, body.type).toLowerCase();
}

function dataPayload(body: WebhookBody): Record<string, unknown> {
  const data = body.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

/** The signature from whichever header the provider set. */
function signatureFrom(req: Request): string | null {
  for (const header of SIGNATURE_HEADERS) {
    const value = req.headers.get(header);
    if (value) return value;
  }
  return null;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    // The raw body is required: re-serialising the JSON would change the bytes
    // and break the signature.
    const raw = await req.text();
    let body: WebhookBody = {};
    try {
      body = JSON.parse(raw) as WebhookBody;
    } catch {
      throw new HttpError(400, "The webhook body is not valid JSON.");
    }

    const event = eventName(body);

    const secret = getEnv("MALLARY_WEBHOOK_SECRET") ?? getEnv("INTEGRATIONS_WEBHOOK_SECRET");
    if (!secret) {
      throw new HttpError(503, "No webhook secret is configured for Mallary.");
    }

    const valid = await verifyHmacSignature(secret, raw, signatureFrom(req));
    if (!valid) throw new HttpError(401, "Invalid webhook signature.");

    const db = adminClient();

    // Claim the event before applying it. A provider retries on any non-2xx and
    // may deliver twice, so a duplicate must be acknowledged without re-running
    // its write (most important for `post.published`).
    const eventId = stableEventId([body.event_id, dataPayload(body).event_id], raw);
    const { error: claimError } = await db
      .from("webhook_events")
      .insert({ provider: "mallary", event_id: eventId, event });

    if (claimError) {
      if (/duplicate|unique|conflict/i.test(claimError.message)) {
        return json({ ok: true, duplicate: true, event });
      }
      throw new HttpError(500, claimError.message);
    }

    // A review event means an old Reviewflowz configuration is still pointed at
    // this URL. Acknowledge it so it stops retrying.
    if (isReviewWebhookEvent(event)) {
      return json({ ok: true, ignored: "reviews are pulled by the gateway, not pushed" });
    }

    return await handleMallary(db, event, dataPayload(body));
  } catch (error) {
    return failure(error);
  }
});

/* ----------------------------------------------------------- Mallary */

/** Advances a publishing job from a Mallary lifecycle event. */
async function handleMallary(
  db: ReturnType<typeof adminClient>,
  event: string,
  data: Record<string, unknown>,
): Promise<Response> {
  const batchId = firstString(data.batch_id, data.batchId);
  const jobId = firstString(data.jobId, data.job_id, data.id);
  const platform = firstString(data.platform).toLowerCase();
  const postUrl = firstString(
    data.platform_post_url,
    data.post_url,
    data.url,
    data.permalink,
  );
  const errorMessage = firstString(data.error, data.message, data.detail);

  if (!batchId && !jobId) return json({ ok: true, ignored: "no job reference" });

  // Resolve the tenant from a job we created — never from the payload alone.
  let query = db.from("social_publish_jobs").select("id, business_id, platforms").limit(1);
  query = batchId ? query.eq("batch_id", batchId) : query.eq("provider_job_id", jobId);

  const { data: rows, error } = await query;
  if (error) throw new HttpError(500, error.message);
  const job = (rows ?? [])[0] as { id: string; business_id: string; platforms: string[] } | undefined;
  if (!job) return json({ ok: true, ignored: "no publishing job matches this event" });

  if (event === "post.scheduled") {
    await db.from("social_publish_jobs").update({ status: "queued" }).eq("id", job.id);
    return json({ ok: true, event, jobId: job.id });
  }

  if (event === "post.failed") {
    await db
      .from("social_publish_jobs")
      .update({
        status: "failed",
        error: (errorMessage || "Mallary could not publish this post.").slice(0, 300),
      })
      .eq("id", job.id);
    return json({ ok: true, event, jobId: job.id });
  }

  if (event === "post.published" || event === "post.partial") {
    const status = event === "post.partial" ? "partial" : "published";
    await db
      .from("social_publish_jobs")
      .update({
        status,
        permalink: postUrl,
        error:
          event === "post.partial"
            ? `Published to some platforms only${platform ? ` (last: ${mallaryPlatformLabel(platform)})` : ""}.`
            : "",
      })
      .eq("id", job.id);
    return json({ ok: true, event, jobId: job.id });
  }

  // Auto-reply and any other event are acknowledged so the provider stops retrying.
  return json({ ok: true, ignored: event });
}
