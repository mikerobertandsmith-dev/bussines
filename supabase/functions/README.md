# Provider gateway (Supabase Edge Functions)

Server-side half of the integrations described in
[`docs/API_INTEGRATION_BLUEPRINT.md`](../../docs/API_INTEGRATION_BLUEPRINT.md).

**Why this exists.** The app is a Vite SPA; anything bundled for the browser is public. Provider
API keys (SerpApi, Apify, Mallary.ai) therefore live here, in Edge Function secrets, and
only this layer ever calls a provider. The browser reaches it through
[`src/lib/integrations.ts`](../../src/lib/integrations.ts).

## Layout

```
_shared/
  errors.ts          HttpError + status mapping
  cors.ts            CORS headers, json()/failure() responses
  env.ts             getEnv / hasEnv / requireEnv (Deno.env)
  supabaseAdmin.ts   service-role client (bypasses RLS, server-only)
  providers.ts       provider catalogue + credential check
  http.ts            fetchJson (timeout + backoff) and readJsonBody
  auth.ts            Clerk JWT verification + tenant ownership check
  usage.ts           api_usage_log writer
  budget.ts          per-tenant monthly provider budget (read + trim + abort)
  idempotency.ts     run-once wrapper for provider writes
  webhookVerify.ts   HMAC-SHA256 signature verification
  serpapi.ts         SerpApi client, matchers + response types (Phase 1)
  keywords.ts        shared keyword resolution for the SerpApi functions (Phase 1)
  apify.ts           Apify client, platform catalogue + post normaliser (Phase 2)
  contacts.ts        Apify website-contacts client: actor id, caps, input, normaliser
  site.ts            Apify website-catalogue client: actor id, caps, input, product normaliser
  reviews.ts         review readers (SerpApi + Apify), normaliser, reply gate (Phase 3)
  mallary.ts         Mallary client: media upload, post creation, job status (Phase 4)
  llm.ts             OpenAI-compatible JSON client for the AI drafting tasks (Phase 5)
integrations-status/
  index.ts           reports which providers are configured
serp-scan/
  index.ts           Google organic ranks, map 3-pack and Business Profile health
serp-competitors/
  index.ts           Share of Voice + Competitor Review Gap vs tracked rivals
keyword-ideas/
  index.ts           Google Autocomplete suggestions for a seed term (optional intent probes)
social-scan/
  index.ts           competitors' recent public posts (Apify), spend-capped per run
web-contacts-scan/
  index.ts           reads a competitor's own site (Apify) and *proposes* its social profiles
site-scan/
  index.ts           reads a watched supplier's / competitor's own catalogue and writes what changed
reviews-sync/
  index.ts           pulls each connected review profile into `my_reviews` (SerpApi/Apify)
review-reply/
  index.ts           sends one user-authored reply and records it (idempotent)
provider-webhook/
  index.ts           inbound Mallary publish events (signature-verified, tenant resolved locally)
publish-ad/
  index.ts           publishes a delivered design to the user's own accounts (Mallary)
social-accounts/
  index.ts           mirrors the accounts connected in Mallary into `social_accounts`
ai-draft/
  index.ts           reply drafts, ad angles and keyword themes — always a draft, never a send
```

`web-contacts-scan` is the one function that writes nothing the user did not confirm: it reads a
competitor's website and hands back a proposal, and the accepted handles are written by the app
through `src/lib/repo.ts`. Every accepted handle becomes a billed scrape target, and a site's footer
can just as easily name its web agency, so the writing stays deliberate.

Every provider is wired, and every phase of the blueprint has landed: each provider's allowance is
enforced here, the browser-side usage/health readouts come from `api_usage_log` and `scan_runs`,
inbound webhooks are replay-protected through `webhook_events`, and the Phase 5 AI enrichment runs
through `ai-draft`, which hands back drafts a user confirms rather than performing any write of its
own.

## Authentication

The browser sends its **Clerk** session token, so the platform's built-in JWT check must be disabled
(`--no-verify-jwt`) — Clerk tokens are not Supabase tokens. Each function instead calls
`requireCaller()` (verifies the token against Clerk's JWKS using `CLERK_JWT_ISSUER`) and, before
touching tenant data, `assertBusinessOwned()`. Writes use the service-role client only *after* that
check, and tenant isolation for direct browser reads/writes still comes from row level security.

## Secrets

Set these once per environment (they are never `VITE_`-prefixed and never committed):

```bash
supabase secrets set \
  SERPAPI_KEY=... \
  SERPAPI_MONTHLY_CAP=250 \
  APIFY_TOKEN=... \
  APIFY_INSTAGRAM_ACTOR_ID=apify/instagram-scraper \
  APIFY_MAX_ITEMS=50 \
  APIFY_MAX_CHARGE_USD=0.25 \
  APIFY_MONTHLY_CHARGE_USD=5 \
  APIFY_RUN_TIMEOUT_SECS=300 \
  APIFY_CONTACTS_ACTOR_ID=vdrmota/contact-info-scraper \
  APIFY_CONTACTS_MAX_PAGES=5 \
  APIFY_CONTACTS_MAX_CHARGE_USD=0.5 \
  APIFY_CONTACTS_MAX_DEPTH=1 \
  APIFY_CONTACTS_RUN_TIMEOUT_SECS=120 \
  APIFY_CONTACTS_ENRICH_PROFILES=false \
  APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR=10 \
  APIFY_CONTACTS_REUSE_WINDOW_MINUTES=2 \
  APIFY_SITE_ACTOR_ID=... \
  APIFY_SITE_MAX_PAGES=25 \
  APIFY_SITE_MAX_CHARGE_USD=1 \
  APIFY_SITE_RUN_TIMEOUT_SECS=120 \
  APIFY_SITE_MAX_ITEMS=200 \
  APIFY_TRUSTPILOT_REVIEWS_ACTOR_ID=... \
  APIFY_YELP_REVIEWS_ACTOR_ID=... \
  APIFY_G2_REVIEWS_ACTOR_ID=... \
  APIFY_CAPTERRA_REVIEWS_ACTOR_ID=... \
  MALLARY_API_KEY=... \
  MALLARY_MONTHLY_CAP=50 \
  MALLARY_BASE_URL=... \
  MALLARY_WEBHOOK_SECRET=... \
  GROQ_API_KEY=... \
  LLM_MODEL=openai/gpt-oss-120b \
  LLM_BASE_URL=https://api.groq.com/openai/v1 \
  INTEGRATIONS_WEBHOOK_SECRET=...
```

Instead of listing pairs, you can push the values straight from the repo-root `.env.local` (where
they are kept, gitignored):

```bash
npx supabase secrets set --project-ref <project-ref> \
  $(grep -E "^(SERPAPI|APIFY|MALLARY|GROQ|LLM|GOOGLE|INTEGRATIONS)_[A-Z0-9_]+=." .env.local | xargs)
```

Only the integration variables are sent — never the `VITE_`, `SUPABASE_` or Clerk values.

`…_MONTHLY_CAP` / `APIFY_MONTHLY_CHARGE_USD` set the per-workspace monthly allowance the gateway
enforces. Defaults are each provider's entry-level plan (250 searches, $5, 50 posts); set one to `0`
for no cap. They are optional in `supabase secrets set` — the defaults apply when unset.

Two rules keep those caps honest. First, `APIFY_MONTHLY_CHARGE_USD` must not exceed the Apify plan's
own monthly usage ceiling (Free is $5.00): the gateway can only trim a run against a figure it is able
to spend, and past the account ceiling Apify stops the account outright. It is also a *per-workspace*
cap read from `api_usage_log`, so tenants sharing one Apify account each get that allowance — keep their
total inside the plan. Second, check an actor's **pricing model** before wiring it up. A per-result
actor (`PRICE_PER_DATASET_ITEM`, `PAY_PER_EVENT`) is bounded by `APIFY_MAX_CHARGE_USD`; a
`FLAT_PRICE_PER_MONTH` actor is a monthly rental whose price the per-run cap cannot shrink, so with the
$0.25 default Apify refuses the run and the platform is reported as skipped. Only raise
`APIFY_MAX_CHARGE_USD` above such an actor's monthly price once that rental is actually affordable —
that is deliberate, not a bug in the cap.

`APIFY_CONTACTS_ACTOR_ID` switches website social discovery on, and is the only contacts variable
that has to be set: blank means "not configured on this deployment" — reported as a named feature that
is off under apify, not as the provider being broken — and the surfaces say so instead of guessing at
an id. The rest have working defaults.

`APIFY_CONTACTS_PREVIEW_MAX_PER_HOUR` (default 10) bounds the one path with no workspace to bill:
onboarding runs before the business row exists, so preview reads are counted per **signed-in user**
from `contacts_discovery_runs` and refused with a `429` past the cap.
`APIFY_CONTACTS_REUSE_WINDOW_MINUTES` (default 2) replays a finished read instead of repeating it, so
pressing "Find socials from their site" twice is not two purchases; `0` disables the replay and makes
every click a fresh, paid read. `APIFY_CONTACTS_MAX_CHARGE_USD` cannot go
below `$0.50` — the actor refuses a run below its own minimum with
`max-total-charge-usd-below-minimum`, so that is a run that never starts rather than a tighter cap,
and it is deliberately a *separate* setting to `APIFY_MAX_CHARGE_USD`'s `$0.25`. It is a
`PAY_PER_EVENT` actor, so `APIFY_MAX_ITEMS` does not bound it: the page ceiling
(`APIFY_CONTACTS_MAX_PAGES`) and the dollars are the real guards.

`site-scan` reads a watched supplier's or competitor's **own catalogue**, and is what the pull-to-refresh
gesture on Suppliers and Competition runs. It needs no secret of its own: a supplier's site and a
competitor's site are the same thing to this read — a business with a website — so it runs the website
actor the deployment already has, `APIFY_CONTACTS_ACTOR_ID` (the crawler behind competitor discovery),
and each page therefore reports itself configured for free. `APIFY_SITE_ACTOR_ID` is an optional
override: set it once to hand the read a dedicated product-catalogue actor instead of that crawler.
Only a deployment with no website actor at all reports the feature as off.
`APIFY_SITE_MAX_CHARGE_USD` deliberately does *not* reuse `APIFY_MAX_CHARGE_USD`'s `$0.25`: that value
was chosen for a per-result social scrape, and a page-crawling actor's own floor can sit above it,
where Apify refuses the run outright (`max-total-charge-usd-below-minimum`) — a refusal, not a tighter
cap. Raise it above the configured actor's floor. `APIFY_SITE_MAX_PAGES` is the reach (product listings
are paginated, so a crawl has to follow links); `APIFY_SITE_MAX_ITEMS` bounds the rows kept from one
read; `APIFY_SITE_RUN_TIMEOUT_SECS` is Apify's own kill switch.

`GROQ_API_KEY` switches on AI drafting. It is the only drafting variable that has to be set: the
endpoint defaults to Groq's OpenAI-compatible API and the model to `openai/gpt-oss-120b` (Groq's
production-tier 120B model — note that the widely-quoted `llama-3.3-70b-versatile` is now
Enterprise-only). Point `LLM_BASE_URL` and `LLM_MODEL` at any other OpenAI-compatible provider and
nothing else changes. `LLM_INPUT_USD_PER_MTOK` / `LLM_OUTPUT_USD_PER_MTOK` override the rates the cost
is computed from, and `LLM_MONTHLY_CHARGE_USD` sets a monthly ceiling — unset, which is the default,
means drafting is logged but never refused.

Reviews need no key of their own: Google and TripAdvisor are read through `SERPAPI_KEY`, the remaining
platforms through an Apify actor named by `APIFY_<PLATFORM>_REVIEWS_ACTOR_ID`. Each read is billed to
whichever of those two served it, so review spend is bounded by the caps above rather than a separate
one. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are only needed once reply-sending is wired up.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.
`CLERK_JWT_ISSUER` must also be set here (and in Supabase → Authentication → Third-party auth → Clerk).

## Run and deploy

```bash
# Local (Docker required) — serve one or all functions.
# The provider keys live in the repo-root .env.local (gitignored): the browser
# reads its VITE_ values from there, and the functions read the rest.
supabase functions serve --no-verify-jwt --env-file ./.env.local

# Deploy
supabase functions deploy integrations-status --no-verify-jwt
supabase functions deploy serp-scan --no-verify-jwt
supabase functions deploy serp-competitors --no-verify-jwt
supabase functions deploy keyword-ideas --no-verify-jwt
supabase functions deploy social-scan --no-verify-jwt
supabase functions deploy web-contacts-scan --no-verify-jwt
supabase functions deploy site-scan --no-verify-jwt
supabase functions deploy reviews-sync --no-verify-jwt
supabase functions deploy review-reply --no-verify-jwt
# Inbound provider webhook — also fine without the platform JWT check.
supabase functions deploy provider-webhook --no-verify-jwt
supabase functions deploy publish-ad --no-verify-jwt
supabase functions deploy social-accounts --no-verify-jwt
supabase functions deploy ai-draft --no-verify-jwt
```

Verify locally after signing in from the app:

```bash
curl -s -X POST http://localhost:54321/functions/v1/integrations-status \
  -H "Authorization: Bearer $CLERK_SESSION_TOKEN" | jq
```

Expected: `{ "providers": [ { "provider": "serpapi", "configured": false }, … ] }` until the relevant
secret is set.

## Rules

- Every provider call is planned against `_shared/budget.ts` first: a run trims
  itself to the workspace's remaining monthly units and is refused with a 429
  once nothing fits, so a scan cannot overshoot the allowance. Apify is planned
  the same way, in dollars, and its per-run `maxItems` / `maxTotalChargeUsd` are
  also sent to Apify itself.
- Actor runs are asynchronous: `social-scan` and `reviews-sync` start a run, wait a
  bounded while, and store the run id (`social_monitor_targets.last_run_id`,
  `review_connections.last_run_id`) when the wait runs out. The next sync collects
  that run before starting a new one, so a slow actor is never paid for twice and
  a paid run is never thrown away. Costs are logged exactly once per run, at
  collection. A provider-side run failure is transient and keeps the connection
  `active`; only a profile the provider rejects sets `needs_reauth`.
- `web-contacts-scan` runs in three modes — `preview` (onboarding, before a business row exists),
  `stored` (a competitor's saved website) and `collect` (pick up a run whose wait ran out). Preview
  is authenticated but **not** tenant-scoped, because there is no workspace to scope it to yet: it is
  bounded to one target, one run and a hard page/dollar ceiling, and the per-user ledger that closes
  the residual gap is Phase 4 of `docs/SOURCE_MANAGEMENT_BLUEPRINT.md`. A contacts run that outlives
  the wait is collected from `competitors.contacts_run_id`, and its cost is logged once, at
  collection.
- `serp-scan` also writes the workspace's **search visibility** back onto the business row: `seo_score`,
  `top10_count`, `ranked_count` and `avg_position`, each with the `previous_*` twin the My Business
  health card measures movement against, plus `rankings_checked_at`. The derivation is
  `_shared/seo.ts` — bands of organic positions (top 3 / top 10 / top 20 / top 50), a capped credit
  for a rich snippet, and one standing per tracked term from its desktop rows, which is the set the
  SEO tab renders. It reads every standing the workspace holds rather than only the rows this run
  wrote, so a run trimmed by the monthly budget does not report a smaller workspace as a worse one.
  Those columns are the reason a score on the page is a scan result rather than whatever onboarding
  typed; the migration that adds them is `0022`.
- `site-scan` is the supplier/competitor catalogue read behind the Suppliers and Competition pages.
  A row in `supplier_items` / `competitor_items` is a **change**, never a snapshot: `change` is the
  enum those pages filter on ("New products", "Price moves", "Stock moves"), so a product read again
  unchanged is not written at all. Writing it as `new_product` — the only value left over — would
  relabel the whole catalogue as new on every scan, which is the signal the page exists to show. The
  comparison is against the newest existing row per product, keyed by `sku` when the page publishes
  one and the normalised name otherwise, derived on both sides by `_shared/site.ts`. A product that
  disappears is deliberately *not* reported as `removed`: this is a bounded crawl, not an exhaustive
  one, so absence proves nothing.
- A crawl outlives one request, so `site-scan` holds the Apify run id on the source row
  (`suppliers.site_run_id` / `competitors.site_run_id`, migration `0021`) and the next scan
  **collects** that run instead of starting — and paying for — a second one. `last_scan_at` moves only
  on a read that produced something, so a failed scan cannot make the page claim a fresh scan;
  `site_scan_at` records the attempt either way. A run that hit its own timeout still had its dataset
  fetched: a partial catalogue is a usable change feed, and the outcome is decided by whether products
  came back rather than by the status alone.
- `web-contacts-scan` keeps a ledger (`contacts_discovery_runs`, migration `0020`) because its
  guarantees are database facts rather than read-then-write hopes: a partial unique index permits one
  live **stored** run per competitor, so two concurrent clicks cannot both start one; the row is
  written *before* the actor is called, because a claim has to precede the spend to mean anything; and
  a claim older than 30 minutes is expired, so an invocation that dies mid-run cannot lock the
  competitor out of discovery permanently. Collection resolves the run from that table by `run_id`
  **and** `user_id` — a run id alone is not enough to read another account's proposals, and an unknown
  or foreign run gets the same `404` so a guessed id cannot be confirmed. The table is service-role
  only (RLS on, no policies — verified against the live project: an anon `select` returns `[]` and an
  anon `insert` is refused with `42501`). Only the normalised proposals are stored, which is the same
  personal-data boundary as the normaliser itself.
- Never log a secret or an `Authorization` header.
- Every provider call goes through `_shared/http.ts` and is followed by `recordUsage()`.
- Every provider **write** (post, reply) goes through `withIdempotency()`.
- `ai-draft` writes nothing on its own: it returns a reply draft, angle options and
  keyword themes, and every one of those needs a separate user action to become a
  send, a brief or a saved keyword. Its prompts are built only from rows we already
  hold for that tenant — never from text a request supplied — and the model's reply
  is validated (and its keywords filtered against our own suggestions) before the
  client sees it.
- Every inbound webhook verifies its signature with `_shared/webhookVerify.ts` before writing, then
  records the event in `webhook_events` (unique on provider + event id) so a redelivery is ignored and
  a genuine second event still lands. The tenant is always resolved from our own connection row, never
  from the payload.
- Budget reads fail closed: if `api_usage_log` cannot be read, the call is refused with a retryable
  503 rather than spending against an unverified allowance.
- Provider response data belongs in a tenant-scoped table (RLS) — never echoed straight to the browser.
