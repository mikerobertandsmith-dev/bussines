-- -----------------------------------------------------------------------------
-- Website social discovery — per-user run ledger
-- -----------------------------------------------------------------------------
-- Phase 4 of docs/SOURCE_MANAGEMENT_BLUEPRINT.md. Phase 3 left two things open
-- that `competitors.contacts_*` cannot answer on its own:
--
--   1. **Preview runs are not tenant-scoped.** Onboarding calls
--      `web-contacts-scan` before a business row exists, so there is no
--      workspace to count those reads against and no row to write their state
--      onto. `api_usage_log.business_id` is null for them and the spend is
--      therefore unattributable. This table keys every run to the **Clerk user**
--      who asked for it, which is the one identity that exists in every mode.
--
--   2. **A double-click could bill twice.** `competitors.contacts_status` is
--      written *after* a run starts, so two concurrent requests both read
--      `idle` and both start a run. The partial unique index below makes "one
--      live stored run per competitor" a database fact rather than a
--      read-then-write, and the losing request collects the winner's run
--      instead of paying for a second one.
--
-- It also fixes a gap that is easy to miss: a run id was enough to collect
-- *someone else's* run, because collection trusted the id in the request body.
-- Rows here are looked up by `run_id` **and** `user_id`, so a run can only ever
-- be collected by the account that started it.
--
-- The proposals are stored with the run so a repeat read inside the reuse
-- window can replay them without paying for the same pages again. Only the
-- normalised rows are kept — the same four fields `normaliseContacts` returns,
-- which already excludes the actor's `leadsEnrichment` personal data (§6.3).
--
-- Service-role only (RLS on, no policies): this is operator-visible spend data,
-- not tenant-readable state — `api_usage_log` is what the app shows.
--
-- Safe to run more than once.

create table if not exists public.contacts_discovery_runs (
  id             uuid primary key default gen_random_uuid(),
  -- The Clerk user id from the verified session token (`auth.jwt() ->> 'sub'`).
  -- The only identity present in preview mode, where no tenant row exists yet.
  user_id        text not null,
  -- Null for a preview run: the workspace is created after onboarding finishes.
  business_id    uuid references public.businesses(id) on delete cascade,
  -- Null for a preview run, and set to null rather than deleted when a
  -- competitor is removed: the spend record outlives the row it was spent on.
  competitor_id  uuid references public.competitors(id) on delete set null,
  mode           text not null,                          -- preview | stored
  -- The Apify run this row is about. Unique, so a run is recorded exactly once
  -- and collecting it updates that record rather than adding another.
  run_id         text not null default '',
  actor_id       text not null default '',
  scanned_url    text not null default '',
  status         text not null default 'running',         -- running | done | failed
  suggestions    jsonb not null default '[]'::jsonb,      -- normalised proposals only
  unmonitored    text[] not null default '{}',
  suggestion_count integer not null default 0,
  cost_usd       numeric(12,6) not null default 0,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.contacts_discovery_runs
  drop constraint if exists contacts_discovery_runs_mode_check;
alter table public.contacts_discovery_runs
  add constraint contacts_discovery_runs_mode_check
  check (mode in ('preview', 'stored'));

alter table public.contacts_discovery_runs
  drop constraint if exists contacts_discovery_runs_status_check;
alter table public.contacts_discovery_runs
  add constraint contacts_discovery_runs_status_check
  check (status in ('running', 'done', 'failed'));

comment on table public.contacts_discovery_runs is
  'One row per web-contacts-scan Apify run, keyed to the Clerk user who started it.';
comment on column public.contacts_discovery_runs.user_id is
  'Clerk user id — the rate-limit key for preview runs, which have no business_id yet.';
comment on column public.contacts_discovery_runs.suggestions is
  'The normalised proposals, so a repeat read inside the reuse window can replay them without re-billing.';

-- A run is recorded exactly once. The gateway inserts on start and updates on
-- collection, so `run_id` collapsing would mean two rows for one billable run.
create unique index if not exists contacts_discovery_runs_run_id_idx
  on public.contacts_discovery_runs (run_id)
  where run_id <> '';

-- At most one *live* stored run per competitor, enforced by the database rather
-- than by reading `contacts_status` first. Two concurrent clicks on "Find
-- socials from their site" race on this index; the loser gets a unique-violation
-- and collects the winner's run instead of starting a second one.
create unique index if not exists contacts_discovery_runs_one_live_idx
  on public.contacts_discovery_runs (competitor_id)
  where mode = 'stored' and status = 'running' and competitor_id is not null;

-- The rate-limit read: how many preview runs has this user started this hour.
create index if not exists contacts_discovery_runs_user_idx
  on public.contacts_discovery_runs (user_id, mode, created_at desc);

-- The reuse-window read: the last finished read for this competitor.
create index if not exists contacts_discovery_runs_competitor_idx
  on public.contacts_discovery_runs (competitor_id, mode, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
drop trigger if exists contacts_discovery_runs_set_updated_at on public.contacts_discovery_runs;
create trigger contacts_discovery_runs_set_updated_at
  before update on public.contacts_discovery_runs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security — on with no policies, the treatment
-- `integration_idempotency` already gets: the service role (which bypasses RLS)
-- is the only reader or writer, and an authenticated user gets nothing.
-- -----------------------------------------------------------------------------
alter table public.contacts_discovery_runs enable row level security;
grant select, insert, update, delete on public.contacts_discovery_runs to service_role;
