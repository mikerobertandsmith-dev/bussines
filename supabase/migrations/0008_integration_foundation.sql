-- -----------------------------------------------------------------------------
-- Integration foundation
-- -----------------------------------------------------------------------------
-- Shared plumbing for the provider integrations (SerpApi, Apify, Reviewflowz,
-- Mallary.ai) described in docs/API_INTEGRATION_BLUEPRINT.md.
--
-- Nothing here talks to a provider: these tables only record which external
-- connections a tenant has saved, what each provider call cost, and the
-- idempotency keys that stop retried writes from happening twice. Provider
-- secrets never live in Postgres — they belong to the Edge Functions.
--
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- New scan source so Mallary publishing jobs can be logged alongside scans.
alter type scan_source_type add value if not exists 'publishing';

-- -----------------------------------------------------------------------------
-- External connections (a Mallary social account, a Reviewflowz review profile,
-- a SerpApi Maps place, an Apify actor target).
-- -----------------------------------------------------------------------------
create table if not exists public.integration_connections (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  provider     text not null,                        -- serpapi | apify | reviewflowz | mallary
  kind         text not null,                        -- social_account | review_profile | maps_place | actor
  external_id  text not null default '',             -- provider-side id (account id, profile id, place data_id)
  label        text not null default '',
  handle       text not null default '',
  status       text not null default 'active',       -- active | needs_reauth | disabled
  -- Non-secret metadata only. Access/refresh tokens must stay in Edge Function
  -- secrets or a server-only store, never in a browser-readable column.
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, provider, kind, external_id)
);

-- -----------------------------------------------------------------------------
-- Provider usage / cost log. Written by the Edge Functions with the service
-- role; tenants can read their own rows so a usage panel can show spend.
-- -----------------------------------------------------------------------------
create table if not exists public.api_usage_log (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete cascade,
  provider    text not null,                         -- serpapi | apify | reviewflowz | mallary
  endpoint    text not null default '',
  units       integer not null default 1,            -- searches | results | posts
  cost_usd    numeric(10,4) not null default 0,
  status      text not null default 'ok',            -- ok | error
  detail      text,
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Idempotency store for provider writes. A retried request with the same key
-- returns the stored response instead of creating a duplicate post/reply.
-- Service-role only: no tenant policies are created, so authenticated users
-- cannot read or write it.
-- -----------------------------------------------------------------------------
create table if not exists public.integration_idempotency (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider    text not null,
  key         text not null,
  response    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (business_id, provider, key)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists integration_connections_business_idx
  on public.integration_connections (business_id, provider);
create index if not exists integration_connections_lookup_idx
  on public.integration_connections (business_id, provider, kind, status);
create index if not exists api_usage_log_business_idx
  on public.api_usage_log (business_id, created_at desc);
create index if not exists api_usage_log_provider_idx
  on public.api_usage_log (provider, created_at desc);
create index if not exists integration_idempotency_lookup_idx
  on public.integration_idempotency (business_id, provider, key);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
drop trigger if exists integration_connections_set_updated_at on public.integration_connections;
create trigger integration_connections_set_updated_at
  before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
-- integration_connections: the standard four tenant policies.
alter table public.integration_connections enable row level security;

drop policy if exists integration_connections_select on public.integration_connections;
drop policy if exists integration_connections_insert on public.integration_connections;
drop policy if exists integration_connections_update on public.integration_connections;
drop policy if exists integration_connections_delete on public.integration_connections;

create policy integration_connections_select on public.integration_connections
  for select using (business_id in (select public.current_business_ids()));
create policy integration_connections_insert on public.integration_connections
  for insert with check (business_id in (select public.current_business_ids()));
create policy integration_connections_update on public.integration_connections
  for update using (business_id in (select public.current_business_ids()))
             with check (business_id in (select public.current_business_ids()));
create policy integration_connections_delete on public.integration_connections
  for delete using (business_id in (select public.current_business_ids()));

-- api_usage_log: tenants read their own spend; only the service role writes.
alter table public.api_usage_log enable row level security;

drop policy if exists api_usage_log_select on public.api_usage_log;
create policy api_usage_log_select on public.api_usage_log
  for select using (business_id in (select public.current_business_ids()));

-- integration_idempotency: RLS on with no policies — authenticated users get
-- nothing; the service role (which bypasses RLS) is the only writer.
alter table public.integration_idempotency enable row level security;

-- -----------------------------------------------------------------------------
-- Grants. `service_role` bypasses RLS by design, which is what the gateway uses.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.integration_connections to authenticated, service_role;
grant select on public.api_usage_log to authenticated;
grant select, insert, update, delete on public.api_usage_log to service_role;
grant select, insert, update, delete on public.integration_idempotency to service_role;
