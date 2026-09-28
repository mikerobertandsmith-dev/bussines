import { getEnv } from "./env.ts";
import { fetchJson } from "./http.ts";
import { HttpError } from "./errors.ts";

/**
 * Mallary client for publishing finished ad designs.
 *
 * Contract confirmed against the provider's public docs (docs.mallary.ai):
 *   POST {base}/api/v1/upload  { filename, type }
 *        → { uploadUrl, mediaUrl, headers }   then PUT the bytes to `uploadUrl`
 *   POST {base}/api/v1/post    { message, platforms[], media[{ url }],
 *                               scheduled_at, scheduled_timezone, webhook_url }
 *        header `Idempotency-Key` → { status, batch_id, jobs: [{ platform, jobId,
 *                                   platform_post_id, platform_post_url }] }
 *   GET  {base}/api/v1/jobs/{id} → { data: { job: { status, platform_post_url, … } } }
 *   GET  {base}/api/v1/platforms → connected platforms for the account
 *
 * Auth is `Authorization: Bearer $MALLARY_API_KEY`; base URL defaults to
 * https://mallary.ai. Media must be hosted on Mallary's CDN before it is posted,
 * so a public design URL is fetched server-side and re-uploaded through the
 * presigned flow.
 */

export type MallaryPlatform =
  | "facebook"
  | "instagram"
  | "x"
  | "twitter"
  | "tiktok"
  | "linkedin"
  | "youtube"
  | "pinterest"
  | "reddit"
  | "threads"
  | "bluesky";

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X",
  twitter: "X",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  pinterest: "Pinterest",
  reddit: "Reddit",
  threads: "Threads",
  bluesky: "Bluesky",
};

export function platformLabelOf(platform: string): string {
  return PLATFORM_LABELS[platform.trim().toLowerCase()] ?? platform;
}

function baseUrl(): string {
  return (getEnv("MALLARY_BASE_URL") ?? "https://mallary.ai").replace(/\/+$/, "");
}

function authHeaders(): Record<string, string> {
  const key = getEnv("MALLARY_API_KEY");
  if (!key) {
    throw new HttpError(409, "Mallary is not configured on the server. Add MALLARY_API_KEY.");
  }
  return { Authorization: `Bearer ${key}` };
}

/* -------------------------------------------------------------- media */

/**
 * Uploads bytes to Mallary's CDN and returns the public media URL the post
 * request expects. Two steps by design: ask for a presigned URL, then PUT the
 * bytes to it (the second call goes to storage, not the JSON API).
 */
export async function uploadMedia(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string> {
  const ticket = await fetchJson<{
    uploadUrl?: string;
    mediaUrl?: string;
    headers?: Record<string, string>;
  }>(`${baseUrl()}/api/v1/upload`, {
    method: "POST",
    headers: authHeaders(),
    body: { filename, type: contentType },
    timeoutMs: 30_000,
    retries: 1,
  });

  if (!ticket.uploadUrl || !ticket.mediaUrl) {
    throw new HttpError(502, "Mallary did not return an upload URL and media URL.");
  }

  const response = await fetch(ticket.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...(ticket.headers ?? {}) },
    body: bytes,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(502, `Mallary media upload failed (${response.status}): ${detail.slice(0, 200)}`);
  }

  return ticket.mediaUrl;
}

/* --------------------------------------------------------------- posts */

export interface PostJob {
  platform: string;
  jobId: string;
  postUrl: string;
}

export interface CreatedPost {
  batchId: string;
  jobs: PostJob[];
  status: string;
}

interface RawPostResponse {
  status?: string;
  batch_id?: string;
  jobs?: {
    platform?: string;
    jobId?: string;
    job_id?: string;
    platform_post_url?: string;
  }[];
}

/** Creates the post (or schedules it). `idempotencyKey` is sent to Mallary too. */
export async function createPost(params: {
  message: string;
  platforms: string[];
  mediaUrl: string;
  scheduledFor?: string;
  timezone?: string;
  webhookUrl?: string;
  idempotencyKey: string;
}): Promise<CreatedPost> {
  const response = await fetchJson<RawPostResponse>(`${baseUrl()}/api/v1/post`, {
    method: "POST",
    headers: { ...authHeaders(), "Idempotency-Key": params.idempotencyKey },
    body: {
      message: params.message,
      platforms: params.platforms,
      media: [{ url: params.mediaUrl }],
      ...(params.scheduledFor ? { scheduled_at: params.scheduledFor } : {}),
      ...(params.timezone ? { scheduled_timezone: params.timezone } : {}),
      ...(params.webhookUrl ? { webhook_url: params.webhookUrl } : {}),
    },
    timeoutMs: 45_000,
    retries: 1,
  });

  const jobs = (response.jobs ?? [])
    .map((job) => ({
      platform: String(job.platform ?? ""),
      jobId: String(job.jobId ?? job.job_id ?? ""),
      postUrl: String(job.platform_post_url ?? ""),
    }))
    .filter((job) => job.jobId);

  if (!jobs.length) {
    throw new HttpError(502, "Mallary accepted the post but returned no job ids.");
  }

  return { batchId: String(response.batch_id ?? ""), jobs, status: String(response.status ?? "queued") };
}

export interface JobStatus {
  status: string;
  postUrl: string;
  postId: string;
}

/** One job's current status. */
export async function getJob(jobId: string): Promise<JobStatus | null> {
  const response = await fetchJson<{
    data?: { job?: { status?: string; platform_post_url?: string; platform_post_id?: string } };
    job?: { status?: string; platform_post_url?: string; platform_post_id?: string };
  }>(`${baseUrl()}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeaders(),
    timeoutMs: 20_000,
    retries: 1,
  });

  const job = response.data?.job ?? response.job;
  if (!job) return null;
  return {
    status: String(job.status ?? ""),
    postUrl: String(job.platform_post_url ?? ""),
    postId: String(job.platform_post_id ?? ""),
  };
}

/** Mallary's job states → our publish-job status. */
export function jobStatusOf(status: string): "queued" | "publishing" | "published" | "failed" {
  const value = status.trim().toLowerCase();
  if (value === "completed" || value === "published" || value === "success") return "published";
  if (value === "failed" || value === "cancelled" || value === "error") return "failed";
  if (value === "processing" || value === "publishing") return "publishing";
  return "queued";
}

export function isTerminalJob(status: string): boolean {
  const mapped = jobStatusOf(status);
  return mapped === "published" || mapped === "failed";
}

/* --------------------------------------------------------- platforms */

export interface ConnectedPlatform {
  providerAccountId: string;
  platform: string;
  displayName: string;
  handle: string;
  avatarUrl: string;
}

/**
 * The platforms connected to the Mallary account. Reads the documented fields
 * and tolerates the provider returning bare strings or richer objects.
 */
export async function listPlatforms(profileId?: string): Promise<ConnectedPlatform[]> {
  const url = new URL(`${baseUrl()}/api/v1/platforms`);
  if (profileId) url.searchParams.set("profile_id", profileId);

  const response = await fetchJson<{ platforms?: unknown[]; data?: unknown[] }>(url.toString(), {
    headers: authHeaders(),
    timeoutMs: 20_000,
    retries: 1,
  });

  const raw = response.platforms ?? response.data ?? [];
  const accounts: ConnectedPlatform[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      accounts.push({
        providerAccountId: entry,
        platform: entry,
        displayName: platformLabelOf(entry),
        handle: "",
        avatarUrl: "",
      });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const platform = String(record.platform ?? record.name ?? "").toLowerCase();
    if (!platform) continue;
    accounts.push({
      providerAccountId: String(record.id ?? record.account_id ?? platform),
      platform,
      displayName: String(record.display_name ?? record.name ?? platformLabelOf(platform)),
      handle: String(record.handle ?? record.username ?? ""),
      avatarUrl: String(record.avatar_url ?? record.picture ?? ""),
    });
  }
  return accounts;
}
