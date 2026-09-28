-- -----------------------------------------------------------------------------
-- Review connections gain their in-flight scrape
-- -----------------------------------------------------------------------------
-- A review scrape that outlived `reviews-sync`'s wait used to be thrown away: the
-- function returned a 504, the run kept working (and charging) with nobody holding
-- its id, and the next sync started — and paid for — a second run. Worse, the 504
-- fell into the connection's error path and set `status = 'needs_reauth'`, while
-- the sync only selects `status = 'active'` profiles: a slow actor disappeared
-- from monitoring entirely until someone reconnected it by hand.
--
-- These two columns hold the run so it can be finished later, mirroring
-- `social_monitor_targets.last_run_id` / `last_run_status`, which already solves
-- the same problem for competitor social scans. An empty `last_run_id` means
-- nothing is in flight; a non-terminal `last_run_status` means the next sync
-- should collect that run rather than start a new one. Its cost is recorded when
-- the run is collected, so a re-sync never double-counts.
--
-- Safe to run more than once.

alter table public.review_connections
  add column if not exists last_run_id     text not null default '',
  add column if not exists last_run_status text not null default '';

comment on column public.review_connections.last_run_id is
  'Apify run started for this profile but not yet collected. Empty when nothing is in flight.';
comment on column public.review_connections.last_run_status is
  'Status of that run. A non-terminal value means the next sync collects it instead of starting a new (billed) run.';
