import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5";
import { HttpError } from "./errors.ts";
import { getEnv } from "./env.ts";
import { adminClient } from "./supabaseAdmin.ts";

export interface Caller {
  /** Clerk user id, taken from the verified token's `sub`. */
  userId: string;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwksFor(issuer: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer.replace(/\/+$/, "")}/.well-known/jwks.json`));
  }
  return jwks;
}

/**
 * Verifies the caller's Clerk session token against Clerk's published JWKS.
 *
 * These functions are deployed with `--no-verify-jwt` because the token is
 * issued by Clerk, not Supabase, so the platform-level check cannot validate it.
 * Verification therefore happens here, and `sub` becomes the trusted user id.
 */
export async function requireCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Missing bearer token.");

  const issuer = getEnv("CLERK_JWT_ISSUER");
  if (!issuer) throw new HttpError(500, "CLERK_JWT_ISSUER is not set on the server.");

  try {
    const { payload } = await jwtVerify(token, jwksFor(issuer), { issuer });
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    if (!userId) throw new Error("token has no subject");
    return { userId };
  } catch {
    throw new HttpError(401, "Invalid or expired session token.");
  }
}

/** Confirms the caller owns the business, so a body id cannot reach another tenant. */
export async function assertBusinessOwned(
  callerUserId: string,
  businessId: string,
): Promise<{ id: string; owner_user_id: string }> {
  if (!businessId) throw new HttpError(400, "A business id is required.");

  const { data, error } = await adminClient()
    .from("businesses")
    .select("id, owner_user_id")
    .eq("id", businessId)
    .maybeSingle();

  if (error) throw new HttpError(500, error.message);
  if (!data || (data as { owner_user_id: string }).owner_user_id !== callerUserId) {
    throw new HttpError(403, "You do not have access to this business.");
  }
  return data as { id: string; owner_user_id: string };
}
