-- -----------------------------------------------------------------------------
-- Workspace message types
-- -----------------------------------------------------------------------------
-- Every customer receives the same set of message types, so the list belongs to
-- the workspace configuration rather than to each client row. Existing rows
-- default to the previous client default (new stock + deals).
alter table public.mail_accounts
  add column if not exists message_types message_type[] not null default '{new_stock,deals}';
