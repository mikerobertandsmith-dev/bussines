-- -----------------------------------------------------------------------------
-- Reviewflowz: live reputation, replies and feedback notifications
-- -----------------------------------------------------------------------------
-- Backing tables for the `reviews-sync`, `review-reply` and `provider-webhook`
-- Edge Functions, and the reply composer on Social & reviews. Reviews themselves
-- keep living in `my_reviews`; this migration extends that table with the
-- provider identity, reply state and language Reviewflowz supplies, and adds the
-- two tables the functions need: the connected review profiles and the reply
-- history.
--
-- See docs/API_INTEGRATION_BLUEPRINT.md (Phase 3, R1–R4).
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- my_reviews gains the provider-side identity and reply state.
-- -----------------------------------------------------------------------------
-- `external_id` is Reviewflowz's review id, which is what makes a re-sync update
-- the same row instead of inserting a duplicate. `action` (already present) keeps
-- our locally-suggested reply; `reply_text` is the reply the user actually sent.
alter table public.my_reviews
  add column if not exists external_id text,
  add column if not exists platform    text not null default '',
  add column if not exists language    text not null default '',
  add column if not exists replied     boolean not null default false,
  add column if not exists reply_text  text not null default '',
  add column if not exists replied_at  timestamptz;

-- One row per (tenant, provider review). Postgres allows many NULL external_ids,
-- so reviews captured before Phase 3 are unaffected.
create unique index if not exists my_reviews_external_idx
  on public.my_reviews (business_id, external_id);

-- -----------------------------------------------------------------------------
-- Review profiles we monitor. A profile is a public review page (a Google Maps
-- place, a Trustpilot page, an app store listing) tracked by its public handle —
-- no login required, which is what lets us watch any of a rival's pages too.
-- -----------------------------------------------------------------------------
create table if not exists public.review_connections (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses(id) on delete cascade,
  provider            text not null default 'reviewflowz',
  platform            text not null,                       -- google | yelp | g2 | trustpilot | capterra | tripadvisor
  handle              text not null default '',            -- public URL or company slug the provider tracks
  label               text not null default '',            -- what the user sees
  profile_external_id text not null default '',            -- provider-side profile id, '' until known
  status              text not null default 'active',      -- active | needs_reauth | disabled
  last_synced_at      timestamptz,
  last_error          text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, provider, platform, handle)
);

-- -----------------------------------------------------------------------------
-- Reply history. `my_reviews.reply_text` holds the current reply; this table is
-- the audit trail, including replies that were attempted and rejected (some
-- platforms are read-only through the API).
-- -----------------------------------------------------------------------------
create table if not exists public.review_replies (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  review_id         uuid not null references public.my_reviews(id) on delete cascade,
  provider          text not null default 'reviewflowz',
  platform          text not null default '',
  body              text not null,
  provider_reply_id text not null default '',
  status            text not null default 'sent',          -- sent | failed
  error             text not null default '',
  created_at        timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Previous-state column driving the "competitor review gap widened" alert.
-- `serp-competitors` snapshots the prior gap just before it replaces the row,
-- exactly as it already does for Share of Voice.
-- -----------------------------------------------------------------------------
alter table public.competitor_review_gap
  add column if not exists previous_review_gap integer;

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists review_connections_business_idx
  on public.review_connections (business_id, provider, status);
create index if not exists review_replies_business_idx
  on public.review_replies (business_id, created_at desc);
create index if not exists review_replies_review_idx
  on public.review_replies (review_id, created_at desc);
create index if not exists my_reviews_replied_idx
  on public.my_reviews (business_id, replied, posted_at desc);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
drop trigger if exists review_connections_set_updated_at on public.review_connections;
create trigger review_connections_set_updated_at
  before update on public.review_connections
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row level security — same four tenant policies as every other table.
-- (`my_reviews` already carries its policies from 0001.)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['review_connections', 'review_replies'] loop
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
  public.review_connections, public.review_replies
  to authenticated, service_role;
