/**
 * Ambient declarations for the Deno runtime and the modules the Edge Functions
 * import by URL.
 *
 * The project typechecks the functions with `tsc` (see `tsconfig.functions.json`)
 * rather than `deno check`, because Deno is not part of the toolchain. `tsc`
 * therefore needs to be told about the two Deno-only things the functions use:
 * the `Deno` global and the `https://esm.sh/...` module specifiers.
 *
 * Types only — this file is never shipped or executed.
 */

declare namespace Deno {
  /** Server-side secret store, populated by `supabase secrets set`. */
  const env: {
    get(name: string): string | undefined;
  };

  /** Registers the request handler for an Edge Function. */
  function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

/** Resolves the ESM CDN specifier onto the package the app already installs. */
declare module "https://esm.sh/@supabase/supabase-js@2" {
  export { createClient, type SupabaseClient } from "@supabase/supabase-js";
}

/**
 * Minimal surface of `jose` (a remote dependency with no local type package),
 * covering exactly what `_shared/auth.ts` uses.
 */
declare module "https://esm.sh/jose@5" {
  export function createRemoteJWKSet(url: URL): unknown;
  export function jwtVerify(
    token: string,
    key: unknown,
    options?: { issuer?: string },
  ): Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }>;
}
