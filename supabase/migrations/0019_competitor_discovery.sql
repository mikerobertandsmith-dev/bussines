-- -----------------------------------------------------------------------------
-- Competitor social discovery — provenance and run state
-- -----------------------------------------------------------------------------
-- Phase 0 of docs/SOURCE_MANAGEMENT_BLUEPRINT.md. Two capabilities need a place to
-- record where a handle came from and what a discovery run is doing:
--
--   1. Onboarding (and the Competition page) can now read a competitor's OWN
--      website with the Apify "Website Contacts Scraper" and propose the social
--      profiles it mentions there. A proposal a human accepts must be
--      distinguishable from a handle a human typed, or a later re-discovery
--      would look identical to — and could quietly outrank — the user's own
--      input. Hence `source` and `discovered_at`.
--
--   2. A discovery run that outlives the gateway's wait must not be thrown away:
--      it keeps working and charging, and re-running discovery would pay twice.
--      `contacts_run_id` / `contacts_status` hold it so the next call collects
--      it, exactly as `social_monitor_targets.last_run_id` and
--      `review_connections.last_run_id` already do for their own slow runs.
--
-- `competitor_social` stays the single source of truth for what is monitored
-- (see 0016_competitor_social_handles.sql) — discovery only ever proposes rows
-- for that table, it never writes them by itself.
--
-- Safe to run more than once.

-- Provenance of a monitored handle.
alter table public.competitor_social
  add column if not exists source        text not null default 'manual',
  add column if not exists discovered_at timestamptz;

alter table public.competitor_social
  drop constraint if exists competitor_social_source_check;
alter table public.competitor_social
  add constraint competitor_social_source_check
  check (source in ('manual', 'discovered', 'imported'));

comment on column public.competitor_social.source is
  'manual = a person entered it; discovered = proposed by web-contacts-scan and accepted.';
comment on column public.competitor_social.discovered_at is
  'When the proposal was accepted. Null for handles that were typed by hand.';

-- In-flight / last discovery run for a competitor.
alter table public.competitors
  add column if not exists contacts_status     text not null default 'idle',
  add column if not exists contacts_scanned_at timestamptz,
  add column if not exists contacts_run_id     text not null default '',
  add column if not exists contacts_error      text;

alter table public.competitors
  drop constraint if exists competitors_contacts_status_check;
alter table public.competitors
  add constraint competitors_contacts_status_check
  check (contacts_status in ('idle', 'running', 'done', 'failed', 'skipped'));

comment on column public.competitors.contacts_status is
  'idle | running | done | failed | skipped — the state of website contact discovery for this competitor.';
comment on column public.competitors.contacts_run_id is
  'Apify run started for this competitor but not yet collected. Empty when nothing is in flight.';

-- Harden the target list: a monitored handle with no handle is a target nothing
-- can scrape, and `handle` was nullable. The live dataset holds no such rows, so
-- this is a no-op there and a repair anywhere else.
delete from public.competitor_social where handle is null or btrim(handle) = '';
alter table public.competitor_social alter column handle set not null;

create index if not exists competitors_contacts_status_idx
  on public.competitors (business_id, contacts_status);
