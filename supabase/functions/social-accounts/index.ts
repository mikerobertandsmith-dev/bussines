import { failure, json, preflight } from "../_shared/cors.ts";
import { HttpError } from "../_shared/errors.ts";
import { assertBusinessOwned, requireCaller } from "../_shared/auth.ts";
import { hasEnv } from "../_shared/env.ts";
import { readJsonBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";
import { recordUsage } from "../_shared/usage.ts";
import { listPlatforms } from "../_shared/mallary.ts";

/**
 * Social accounts (Mallary).
 *
 * Accounts are connected inside Mallary's own OAuth flow; this function mirrors
 * what the provider reports as connected into `social_accounts`, so the Post-ad
 * modal can offer them. Re-running it refreshes the list (and picks up a
 * disconnect, by marking the missing account disabled).
 *
 * Deploy with `--no-verify-jwt` — the bearer token is a Clerk token, verified here.
 */
interface Body {
  businessId?: string;
  /** Mallary connection profile id, for accounts beyond the default profile. */
  profileId?: string;
}

Deno.serve(async (req) => {
  const preflightResponse = preflight(req);
  if (preflightResponse) return preflightResponse;

  try {
    if (!hasEnv("MALLARY_API_KEY")) {
      throw new HttpError(
        409,
        "Mallary is not configured on the server. Add MALLARY_API_KEY, then connect your accounts in Mallary.",
      );
    }

    const caller = await requireCaller(req);
    const body = await readJsonBody<Body>(req);
    const businessId = String(body.businessId ?? "");
    await assertBusinessOwned(caller.userId, businessId);

    const db = adminClient();
    const connected = await listPlatforms(body.profileId ? String(body.profileId) : undefined);

    if (connected.length) {
      const { error } = await db.from("social_accounts").upsert(
        connected.map((account) => ({
          business_id: businessId,
          provider: "mallary",
          provider_account_id: account.providerAccountId,
          platform: account.platform,
          display_name: account.displayName,
          handle: account.handle,
          avatar_url: account.avatarUrl,
          status: "active",
        })),
        { onConflict: "business_id,provider,platform,provider_account_id" },
      );
      if (error) throw new HttpError(500, error.message);
    }

    // Anything we hold that the provider no longer reports is marked disabled
    // rather than deleted, so a republish attempt can explain why it is gone.
    const keep = new Set(connected.map((a) => `${a.platform}:${a.providerAccountId}`));
    const { data: existing } = await db
      .from("social_accounts")
      .select("id, platform, provider_account_id")
      .eq("business_id", businessId)
      .eq("provider", "mallary");

    for (const row of existing ?? []) {
      const key = `${String(row.platform)}:${String(row.provider_account_id)}`;
      if (keep.has(key)) continue;
      await db.from("social_accounts").update({ status: "disabled" }).eq("id", row.id);
    }

    await recordUsage(db, {
      businessId,
      provider: "mallary",
      endpoint: "api/v1/platforms",
      units: 1,
      detail: `${connected.length} connected platform${connected.length === 1 ? "" : "s"}`,
    });

    return json({ accounts: connected.length, platforms: connected.map((a) => a.platform) });
  } catch (error) {
    return failure(error);
  }
});
