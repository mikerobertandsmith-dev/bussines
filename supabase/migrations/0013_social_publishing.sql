-- -----------------------------------------------------------------------------
-- Mallary.ai: publishing finished ad designs to the user's social accounts
-- -----------------------------------------------------------------------------
-- Backing tables for the `publish-ad` and `social-accounts` Edge Functions and
-- the "Post ad" flow on the Promotions page. The user's own connected accounts
-- live in `social_accounts`; every push of a delivered design is one
-- `social_publish_jobs` row whose status advances queued → publishing →
-- published | partial | failed.
--
-- Only the user's own delivered creative is ever published here — the data model
-- enforces it by pointing at `delivered_ads`, which belongs to the tenant.
--
-- See docs/API_INTEGRATION_BLUEPRINT.md (Phase 4, M1–M5).
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- The tenant's connected social accounts, as reported by Mallary. Accounts are
-- connected inside Mallary (its own OAuth flow); this table mirrors what the
-- provider says is connected so the Post-ad modal can offer them.
-- -----------------------------------------------------------------------------
create table if not exists public.social_accounts (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  provider            text not null default 'mallary',   -- mallary
  provider_account_id text not null default '',          -- provider-side account/platform id
  platform            text not null,                     -- facebook | instagram | x | tiktok | linkedin | youtube | pinterest | reddit | threads | bluesky
  display_name        text not null default '',
  handle              text not null default '',
  avatar_url          text not null default '',
  status              text not null default 'active',    -- active | needs_reauth | disabled
  connected_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, provider, platform, provider_account_id)
);

-- -----------------------------------------------------------------------------
-- One row per push of a finished design. `idempotency_key` is derived from what
-- the post is (design + accounts + schedule), so a retried submit updates the
-- same row instead of publishing twice.
-- -----------------------------------------------------------------------------
create table if not exists public.social_publish_jobs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  brief_id        uuid references public.promotion_briefs(id) on delete set null,
  delivered_ad_id uuid references public.delivered_ads(id) on delete set null,
  account_ids     uuid[] not null default '{}',
  platforms       text[] not null default '{}',
  caption         text not null default '',
  scheduled_for   timestamptz,
  timezone        text not null default '',
  status          text not null default 'queued',        -- queued | publishing | published | partial | failed
  provider_job_id text not null default '',              -- Mallary job id (first platform)
  batch_id        text not null default '',              -- Mallary batch id for the multi-platform post
  permalink       text not null default '',              -- platform post URL once published
  error           text not null default '',
  idempotency_key text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists social_accounts_business_idx
  on public.social_accounts (business_id, provider, status);
create index if not exists social_publish_jobs_business_idx
  on public.social_publish_jobs (business_id, created_at desc);
create index if not exists social_publish_jobs_batch_idx
  on public.social_publish_jobs (business_id, batch_id);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
drop trigger if exists social_accounts_set_updated_at on public.social_accounts;
create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

drop trigger if exists social_publish_jobs_set_updated_at on public.social_publish_jobs;
create trigger social_publish_jobs_set_updated_at
  before update on public.social_publish_jobs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['social_accounts', 'social_publish_jobs'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select using (business_id in (select public.current_business_ids()))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert with check (business_id in (select public.current_business_ids()))',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using (business_id in (select public.current_business_ids())) with check (business_id in (select public.current_business_ids()))',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using (business_id in (select public.current_business_ids()))',
      t || '_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on
  public.social_accounts, public.social_publish_jobs
  to authenticated, service_role;
