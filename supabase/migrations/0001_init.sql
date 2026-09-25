-- =============================================================================
-- Market Watch — initial schema
-- =============================================================================
-- Run this in the Supabase SQL Editor, or with the Supabase CLI:
--   supabase link --project-ref $SUPABASE_PROJECT_REF
--   supabase db push
--
-- Identity model
-- --------------
-- Login is handled by Clerk. Supabase is configured with Clerk as a
-- "Third-party auth" provider, so `auth.jwt() ->> 'sub'` is the Clerk user id.
-- Every tenant table carries `business_id`, and row level security only ever
-- lets a user see rows belonging to a business they own.
--
-- Required Clerk session-token tweak (Clerk dashboard → Sessions → Customize
-- session token) so Supabase grant the `authenticated` role:
--   { "role": "authenticated" }
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums (safe to run more than once)
-- -----------------------------------------------------------------------------
do $$
declare
  e record;
begin
  for e in
    select * from (values
      ('cadence',          'daily,weekly,monthly'),
      ('change_type',      'new_product,price_change,stock_change,promotion,removed'),
      ('stock_state',      'in_stock,low_stock,out_of_stock,preorder'),
      ('ad_status',        'active,paused'),
      ('sentiment',        'positive,neutral,negative'),
      ('client_status',    'active,paused,prospect'),
      ('client_tier',      'starter,growth,premium'),
      ('send_frequency',   'every_2_days,daily,weekly,monthly'),
      ('message_type',     'new_stock,two_day_checkin,platform_info,deals,competitor_alert,review_update,weekly_report'),
      ('shoot_status',     'ready,editing,scheduled'),
      ('priority_level',   'high,medium,low'),
      ('focus_level',      'high,medium,low'),
      ('scan_status',      'queued,running,succeeded,failed'),
      ('scan_source_type', 'supplier,competitor,reviews,seo,geo,social')
    ) as t(type_name, vals)
  loop
    begin
      execute format(
        'create type %I as enum (%s)',
        e.type_name,
        (select string_agg(quote_literal(v), ', ')
           from unnest(string_to_array(e.vals, ',')) as v)
      );
    exception
      when duplicate_object then null;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Clerk user id from the verified session token.
create or replace function public.clerk_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Business profile (one row per signed-up user, filled by onboarding)
-- -----------------------------------------------------------------------------
create table if not exists public.businesses (
  id                      uuid primary key default gen_random_uuid(),
  owner_user_id           text not null unique,          -- Clerk user id
  owner_email             text,
  brand_name              text not null,
  legal_name              text,
  industry                text not null,
  niche                   text,
  primary_domain          text,
  secondary_domains       text[] not null default '{}',
  platform_type           text,                          -- website | marketplace | both
  country                 text,
  currency                text not null default 'USD',
  timezone                text,
  team_size               text,
  monthly_visits          integer,
  visits_change           numeric(6,2),
  conversion_rate         numeric(5,2),
  seo_score               integer,
  previous_seo_score      integer,
  geo_score               integer,
  previous_geo_score      integer,
  industry_rank           integer,
  industry_rank_previous  integer,
  domain_authority        integer,
  indexed_pages           integer,
  backlinks               integer,
  primary_goal            text,
  goals                   text[] not null default '{}',
  ad_platforms            text[] not null default '{}',
  social_handles          jsonb not null default '{}'::jsonb,   -- { "instagram": "@brand" }
  competitor_domains      text[] not null default '{}',
  notification_email      text,
  report_day              text,                          -- e.g. 'Friday'
  onboarding_complete     boolean not null default false,
  onboarding_completed_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Suppliers
-- -----------------------------------------------------------------------------
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  name            text not null,
  website         text not null,
  category        text,
  cadence         cadence not null default 'daily',
  scan_health     integer not null default 100,
  account_manager text,
  lead_time_days  integer,
  notes           text,
  last_scan_at    timestamptz,
  next_scan_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.supplier_items (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  product         text not null,
  sku             text,
  category        text,
  price           numeric(12,2) not null,
  previous_price  numeric(12,2) not null,
  stock           stock_state not null default 'in_stock',
  previous_stock  stock_state not null default 'in_stock',
  change          change_type not null,
  lead_time_days  integer,
  moq             integer,
  url             text,
  note            text,
  detected_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Competitors
-- -----------------------------------------------------------------------------
create table if not exists public.competitors (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  name               text not null,
  website            text not null,
  cadence            cadence not null default 'daily',
  notes              text,
  last_scan_at       timestamptz,
  monthly_visits     integer not null default 0,
  visits_change      numeric(6,2) not null default 0,
  seo_score          integer,
  geo_score          integer,
  rating             numeric(3,2),
  previous_rating    numeric(3,2),
  review_count       integer not null default 0,
  reviews_this_month integer not null default 0,
  ad_platforms       text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Traffic series, rating trend and traffic-source mix.
create table if not exists public.competitor_metrics (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  kind          text not null,               -- traffic | review_trend | traffic_source
  label         text not null,
  value         numeric(14,2) not null,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists public.competitor_social (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  competitor_id   uuid not null references public.competitors(id) on delete cascade,
  platform        text not null,
  handle          text,
  followers       integer not null default 0,
  engagement_rate numeric(5,2),
  posts_per_week  integer,
  ads_running     integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.competitor_keywords (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  keyword       text not null,
  volume        integer not null default 0,
  our_rank      integer,
  their_rank    integer,
  difficulty    integer,
  intent        text,
  created_at    timestamptz not null default now()
);

create table if not exists public.competitor_ads (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  platform      text not null,
  headline      text not null,
  audience      text,
  focus         text,
  status        ad_status not null default 'active',
  banner_url    text,                        -- reference only, never reused as artwork
  landing_url   text,
  first_seen_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table if not exists public.competitor_reviews (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  author        text,
  rating        integer,
  source        text,
  body          text,
  sentiment     sentiment,
  posted_at     timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table if not exists public.competitor_audience (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  segment       text not null,
  age_range     text,
  share         integer,
  created_at    timestamptz not null default now()
);

create table if not exists public.competitor_items (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  product       text not null,
  category      text,
  price         numeric(12,2),
  stock         stock_state not null default 'in_stock',
  url           text,
  detected_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Clients, mail account and message history
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  name              text not null,
  email             text not null,
  company           text,
  industry          text,
  status            client_status not null default 'active',
  tier              client_tier not null default 'starter',
  frequency         send_frequency not null default 'weekly',
  message_types     message_type[] not null default '{new_stock,deals}',
  joined_at         timestamptz not null default now(),
  last_contacted_at timestamptz,
  next_send_at      timestamptz,
  open_rate         numeric(5,2) not null default 0,
  monthly_fee       numeric(10,2) not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, email)
);

create table if not exists public.mail_accounts (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null unique references public.businesses(id) on delete cascade,
  sender_name     text,
  login_email     text,
  reply_to        text,
  secondary_email text,
  signature       text,
  timezone        text,
  daily_digest    boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.sent_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  client_id   uuid references public.clients(id) on delete set null,
  client_name text,
  subject     text,
  types       message_type[] not null default '{}',
  status      text not null default 'delivered',   -- delivered | opened | clicked | bounced
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- My business: SEO / GEO, traffic, reviews, ad assets, social, recommendations
-- -----------------------------------------------------------------------------
create table if not exists public.my_keywords (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  keyword     text not null,                 -- SEO term, or the GEO prompt
  kind        text not null default 'seo',   -- seo | geo
  engine      text,                          -- ChatGPT | Perplexity | Google AI Overview
  volume      integer,
  position    integer,
  change      integer,
  week_of     date,
  created_at  timestamptz not null default now()
);

-- Traffic series, GEO visibility trend, channel mix and search-surface mix.
create table if not exists public.my_metrics (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null,                 -- traffic | geo_visibility | channel | search_surface
  label       text not null,
  value       numeric(14,2) not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.my_review_sources (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  source          text not null,
  score           numeric(3,2),
  previous_score  numeric(3,2),
  reviews         integer not null default 0,
  new_this_month  integer not null default 0,
  created_at      timestamptz not null default now()
);

create table if not exists public.my_review_series (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source      text not null,
  label       text not null,
  score       numeric(3,2) not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.my_reviews (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  author      text,
  rating      integer,
  source      text,
  body        text,
  sentiment   sentiment,
  action      text,                          -- suggested reply / next step
  is_flagged  boolean not null default false,
  posted_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.ad_assets (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product      text not null,
  sku          text,
  formats      text[] not null default '{}',
  shoot_status shoot_status not null default 'scheduled',
  shoot_date   date,
  figma_url    text,
  storage_path text,                          -- path in the Supabase Storage bucket
  size_mb      numeric(10,2),
  downloads    integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.social_scores (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  platform      text not null,
  handle        text,
  score         integer,
  followers     integer,
  growth        numeric(6,2),
  benchmark_gap numeric(6,2),
  focus         focus_level,
  reason        text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.inventory_recommendations (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  supplier_id       uuid references public.suppliers(id) on delete set null,
  product           text not null,
  category          text,
  suggested_qty     integer,
  estimated_price   numeric(12,2),
  margin_pct        numeric(5,2),
  traffic_potential integer,
  reason            text,
  priority          priority_level not null default 'medium',
  competitor_ref    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.buy_list_items (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  recommendation_id uuid not null references public.inventory_recommendations(id) on delete cascade,
  note              text,
  created_at        timestamptz not null default now(),
  unique (business_id, recommendation_id)
);

create table if not exists public.weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  week_label  text not null,
  week_start  date,
  seo_score   integer,
  geo_score   integer,
  visits      integer,
  conversions integer,
  highlight   text,
  actions     text[] not null default '{}',
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Scan / ingestion log — written by the scheduled jobs and by "Scan now"
-- -----------------------------------------------------------------------------
create table if not exists public.scan_runs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  source_type   scan_source_type not null,
  source_id     uuid,
  source_name   text,
  status        scan_status not null default 'queued',
  changes_found integer not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists suppliers_business_idx                on public.suppliers                (business_id);
create index if not exists supplier_items_business_idx           on public.supplier_items           (business_id, detected_at desc);
create index if not exists supplier_items_supplier_idx           on public.supplier_items           (supplier_id);
create index if not exists competitors_business_idx              on public.competitors              (business_id);
create index if not exists competitor_metrics_idx                on public.competitor_metrics       (competitor_id, kind, sort_order);
create index if not exists competitor_social_idx                 on public.competitor_social        (competitor_id);
create index if not exists competitor_keywords_idx               on public.competitor_keywords      (competitor_id);
create index if not exists competitor_ads_idx                    on public.competitor_ads           (competitor_id, first_seen_at desc);
create index if not exists competitor_reviews_idx                on public.competitor_reviews       (competitor_id, posted_at desc);
create index if not exists competitor_audience_idx               on public.competitor_audience      (competitor_id);
create index if not exists competitor_items_idx                  on public.competitor_items         (competitor_id, detected_at desc);
create index if not exists clients_business_idx                  on public.clients                  (business_id, status);
create index if not exists sent_messages_idx                     on public.sent_messages            (business_id, sent_at desc);
create index if not exists my_keywords_idx                       on public.my_keywords              (business_id, kind);
create index if not exists my_metrics_idx                        on public.my_metrics               (business_id, kind, sort_order);
create index if not exists my_review_series_idx                  on public.my_review_series         (business_id, source, sort_order);
create index if not exists my_reviews_idx                        on public.my_reviews               (business_id, posted_at desc);
create index if not exists ad_assets_business_idx                on public.ad_assets                (business_id);
create index if not exists social_scores_business_idx            on public.social_scores            (business_id);
create index if not exists inventory_recommendations_idx         on public.inventory_recommendations(business_id, priority);
create index if not exists weekly_reports_idx                    on public.weekly_reports           (business_id, week_start desc);
create index if not exists scan_runs_idx                         on public.scan_runs                (business_id, started_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'businesses', 'suppliers', 'competitors', 'clients', 'mail_accounts',
    'ad_assets', 'social_scores', 'inventory_recommendations'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Tenant helper. Defined after the tables because a SQL function body is
-- resolved when it is created. SECURITY DEFINER so policies on child tables do
-- not re-enter the policies on `businesses`.
-- -----------------------------------------------------------------------------
create or replace function public.current_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select b.id from public.businesses b where b.owner_user_id = public.clerk_user_id()
$$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.businesses enable row level security;

drop policy if exists businesses_select on public.businesses;
drop policy if exists businesses_insert on public.businesses;
drop policy if exists businesses_update on public.businesses;
drop policy if exists businesses_delete on public.businesses;

create policy businesses_select on public.businesses
  for select using (owner_user_id = public.clerk_user_id());
create policy businesses_insert on public.businesses
  for insert with check (owner_user_id = public.clerk_user_id());
create policy businesses_update on public.businesses
  for update using (owner_user_id = public.clerk_user_id())
             with check (owner_user_id = public.clerk_user_id());
create policy businesses_delete on public.businesses
  for delete using (owner_user_id = public.clerk_user_id());

-- Every tenant table gets the same four policies, scoped to owned businesses.
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'supplier_items', 'competitors', 'competitor_metrics',
    'competitor_social', 'competitor_keywords', 'competitor_ads',
    'competitor_reviews', 'competitor_audience', 'competitor_items',
    'clients', 'mail_accounts', 'sent_messages', 'my_keywords', 'my_metrics',
    'my_review_sources', 'my_review_series', 'my_reviews', 'ad_assets',
    'social_scores', 'inventory_recommendations', 'buy_list_items',
    'weekly_reports', 'scan_runs'
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

-- -----------------------------------------------------------------------------
-- Grants. The scheduled ingestion job uses the service_role key, which bypasses
-- RLS by design, so it can write supplier/competitor scans for every tenant.
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant execute on function public.clerk_user_id(), public.current_business_ids() to anon, authenticated, service_role;

-- The policies call auth.jwt(), which lives in Supabase's auth schema. Supabase
-- grants this by default; the guarded block keeps the migration portable.
do $$
begin
  grant usage on schema auth to anon, authenticated, service_role;
exception
  when insufficient_privilege then null;
end $$;

-- -----------------------------------------------------------------------------
-- Storage: product photo shoots and exported ad designs
-- -----------------------------------------------------------------------------
-- Objects must be uploaded to `<clerk_user_id>/<file>`, and only the owner of
-- that folder can read or write them.
insert into storage.buckets (id, name, public)
values ('ad-assets', 'ad-assets', false)
on conflict (id) do nothing;

drop policy if exists ad_assets_read on storage.objects;
drop policy if exists ad_assets_write on storage.objects;
drop policy if exists ad_assets_update on storage.objects;
drop policy if exists ad_assets_delete on storage.objects;

create policy ad_assets_read on storage.objects
  for select using (
    bucket_id = 'ad-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy ad_assets_write on storage.objects
  for insert with check (
    bucket_id = 'ad-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy ad_assets_update on storage.objects
  for update using (
    bucket_id = 'ad-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy ad_assets_delete on storage.objects
  for delete using (
    bucket_id = 'ad-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
