-- -----------------------------------------------------------------------------
-- SerpApi: competitor benchmarking — Share of Voice & Competitor Review Gap
-- -----------------------------------------------------------------------------
-- Backing tables for the `serp-competitors` Edge Function. One row per
-- (business, competitor) is replaced on each run; nothing is invented, so an
-- empty table simply means "not benchmarked yet".
--
-- See docs/API_INTEGRATION_BLUEPRINT.md (Phase 1, S8 & S9).
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- Share of Voice: how often we, and each competitor, appear in the top 10
-- organic results for the tracked keyword set.
create table if not exists public.competitor_share_of_voice (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  competitor_id    uuid references public.competitors(id) on delete cascade,
  competitor_name  text not null default '',
  keyword_set      text not null default 'tracked',
  term_count       integer not null default 0,
  our_top10        integer not null default 0,
  their_top10      integer not null default 0,
  our_share        numeric(5,2) not null default 0,   -- percent of tracked terms (0–100)
  their_share      numeric(5,2) not null default 0,
  checked_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (business_id, competitor_id)
);

-- Competitor Review Gap: local rating count / average rating difference from
-- Google Maps search results.
create table if not exists public.competitor_review_gap (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  competitor_id    uuid references public.competitors(id) on delete cascade,
  competitor_name  text not null default '',
  place_id         text not null default '',
  our_reviews      integer not null default 0,
  their_reviews    integer not null default 0,
  review_gap       integer not null default 0,        -- their reviews − ours
  our_rating       numeric(3,2) not null default 0,
  their_rating     numeric(3,2) not null default 0,
  rating_gap       numeric(3,2) not null default 0,   -- ours − theirs
  checked_at       timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (business_id, competitor_id)
);

-- -----------------------------------------------------------------------------
-- Previous-state columns driving the local-visibility alerts
-- -----------------------------------------------------------------------------
-- Each scan replaces the current row, so the prior state is captured here just
-- before the upsert. `src/lib/alerts.ts` compares current vs previous to raise
-- "dropped out of the 3-pack" / "lost a rich snippet" / "share of voice moved"
-- notifications. Null simply means "no previous scan to compare against".
-- -----------------------------------------------------------------------------
alter table public.serp_rankings
  add column if not exists previous_position        integer,
  add column if not exists previous_is_rich_result  boolean,
  add column if not exists previous_snippet_type    text;

alter table public.local_pack_rankings
  add column if not exists previous_in_pack       boolean,
  add column if not exists previous_pack_position integer;

alter table public.competitor_share_of_voice
  add column if not exists previous_our_share numeric(5,2);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists competitor_sov_business_idx
  on public.competitor_share_of_voice (business_id, checked_at desc);
create index if not exists competitor_review_gap_business_idx
  on public.competitor_review_gap (business_id, checked_at desc);

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'competitor_share_of_voice', 'competitor_review_gap'
  ] loop
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
  public.competitor_share_of_voice, public.competitor_review_gap
  to authenticated, service_role;
