-- -----------------------------------------------------------------------------
-- Apify: competitor social monitoring (recent posts)
-- -----------------------------------------------------------------------------
-- Backing tables for the `social-scan` Edge Function. Competitor content is
-- stored as *signal* — text, media URLs and engagement numbers used for
-- comparison and inspiration — never as artwork to republish. See
-- docs/API_INTEGRATION_BLUEPRINT.md (Phase 2) and the guardrail in README §9.
--
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- Recent public posts pulled from a competitor's profile. One row per post; the
-- unique key is what makes a re-scrape idempotent instead of duplicating.
create table if not exists public.social_posts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  competitor_id   uuid references public.competitors(id) on delete cascade,
  platform        text not null,                       -- instagram | tiktok | facebook | x
  external_id     text not null,                       -- provider post id (or short code)
  url             text not null default '',
  caption         text not null default '',
  media_url       text not null default '',
  media_type      text not null default '',            -- Image | Video | Sidecar
  hashtags        text[] not null default '{}',
  mentions        text[] not null default '{}',
  likes           integer not null default 0,
  comments        integer not null default 0,
  shares          integer not null default 0,
  views           integer not null default 0,
  -- (likes + comments) ÷ the profile's follower count, as a percentage.
  engagement_rate numeric(6,3) not null default 0,
  posted_at       timestamptz,
  scraped_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (business_id, platform, external_id)
);

-- Scrape state for one competitor handle. The handle itself is declared on
-- `competitor_social` (captured at onboarding, editable in the app); this table
-- records which actor covers the platform and how the last scrape went, so a
-- cadence can skip work that is not due and a failed run is visible.
create table if not exists public.social_monitor_targets (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  competitor_id   uuid references public.competitors(id) on delete cascade,
  platform        text not null,
  handle          text not null default '',
  actor_id        text not null default '',
  cadence         text not null default 'weekly',      -- daily | weekly | monthly
  last_scraped_at timestamptz,
  -- The Apify run we started (or last collected), so a slow run is not a black
  -- box: the next scan reports it and can pick up where it left off.
  last_run_id     text not null default '',
  last_run_status text not null default '',
  last_error      text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, competitor_id, platform)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists social_posts_business_idx
  on public.social_posts (business_id, posted_at desc);
create index if not exists social_posts_competitor_idx
  on public.social_posts (competitor_id, platform, posted_at desc);
create index if not exists social_monitor_targets_business_idx
  on public.social_monitor_targets (business_id, platform);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
drop trigger if exists social_monitor_targets_set_updated_at on public.social_monitor_targets;
create trigger social_monitor_targets_set_updated_at
  before update on public.social_monitor_targets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['social_posts', 'social_monitor_targets'] loop
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
  public.social_posts, public.social_monitor_targets
  to authenticated, service_role;
