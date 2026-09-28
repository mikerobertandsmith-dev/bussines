-- -----------------------------------------------------------------------------
-- SerpApi: search visibility, local / map-pack and keyword ideas
-- -----------------------------------------------------------------------------
-- Backing tables for the `serp-scan` and `keyword-ideas` Edge Functions and the
-- Local visibility panel on My Business. Only real scan output is stored here —
-- nothing is invented, an empty table simply means "not scanned yet".
--
-- See docs/API_INTEGRATION_BLUEPRINT.md (Phase 1).
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- Our position for a tracked keyword on Google organic, per device. One row per
-- keyword × device × location, replaced on each scan.
create table if not exists public.serp_rankings (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  keyword         text not null,
  device          text not null default 'desktop',   -- desktop | mobile
  location        text not null default '',
  position        integer,                           -- null = not found in the top results
  url             text not null default '',
  title           text not null default '',
  snippet_type    text not null default '',          -- rich-snippet kind, '' when none
  is_rich_result  boolean not null default false,
  checked_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (business_id, keyword, device, location)
);

-- Where we sit in the local map 3-pack for a keyword, plus who else is in it.
create table if not exists public.local_pack_rankings (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  keyword       text not null,
  location      text not null default '',
  in_pack       boolean not null default false,
  pack_position integer,                             -- 1..3, null when not in the pack
  place_id      text not null default '',
  -- Top of the pack as returned: [{ position, name, place_id, rating, reviews }]
  pack          jsonb not null default '[]'::jsonb,
  checked_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (business_id, keyword, location)
);

-- Google Business Profile health for our own Maps listing.
create table if not exists public.local_profile_health (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  place_id      text not null,
  label         text not null default '',
  score         integer not null default 0,
  -- [{ label, ok, detail }] so the UI can show what is missing.
  checks        jsonb not null default '[]'::jsonb,
  reviews_count integer not null default 0,
  average_rating numeric(3,2) not null default 0,
  address       text not null default '',
  category      text not null default '',
  website       text not null default '',
  checked_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (business_id, place_id)
);

-- Google Autocomplete suggestions the user can promote into tracked keywords.
create table if not exists public.keyword_ideas (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  seed              text not null,
  suggestion        text not null,
  relevance         integer not null default 0,
  source            text not null default 'autocomplete',
  saved_as_keyword  boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (business_id, seed, suggestion)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists serp_rankings_business_idx
  on public.serp_rankings (business_id, checked_at desc);
create index if not exists local_pack_rankings_business_idx
  on public.local_pack_rankings (business_id, checked_at desc);
create index if not exists local_profile_health_business_idx
  on public.local_profile_health (business_id);
create index if not exists keyword_ideas_business_idx
  on public.keyword_ideas (business_id, seed, relevance desc);

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'serp_rankings', 'local_pack_rankings', 'local_profile_health', 'keyword_ideas'
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
  public.serp_rankings, public.local_pack_rankings, public.local_profile_health, public.keyword_ideas
  to authenticated, service_role;
