/** Constant-time string comparison, to avoid leaking a signature byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies an `HMAC-SHA256` signature over the raw request body.
 *
 * Providers differ in header name and encoding (`sha256=…`, hex, base64), so the
 * caller passes in whatever it received; we normalise the common `sha256=` prefix.
 * Inbound webhooks must call this before writing anything.
 */
export async function verifyHmacSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!secret || !signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return timingSafeEqual(expected, signature.replace(/^sha256=/i, "").trim().toLowerCase());
}

/**
 * A stable id for an inbound webhook: the provider's own event id when it sends
 * one, otherwise a fingerprint of the raw body.
 *
 * Replay protection needs a key that is identical across two deliveries of the
 * same event, and a provider that does not send an event id still sends the same
 * bytes — so hashing the body covers that case. (A 32-bit FNV-1a is plenty here:
 * it only has to distinguish events, not resist an attacker, and the signature
 * has already been verified by this point.)
 */
export function stableEventId(candidates: unknown[], rawBody: string): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }

  let hash = 2166136261;
  for (let i = 0; i < rawBody.length; i += 1) {
    hash ^= rawBody.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `body-${(hash >>> 0).toString(16)}`;
}
