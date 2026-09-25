-- -----------------------------------------------------------------------------
-- Workspace send cadence
-- -----------------------------------------------------------------------------
-- Customers are mailed as one uniform batch, so the cadence is a workspace
-- setting rather than a per-client one. Existing rows default to weekly, which
-- matches the previous client default.
alter table public.mail_accounts
  add column if not exists send_frequency send_frequency not null default 'weekly';
