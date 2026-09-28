-- -----------------------------------------------------------------------------
-- Webhook replay protection
-- -----------------------------------------------------------------------------
-- Inbound provider webhooks are retried on any non-2xx response, and a provider
-- may also deliver the same event twice. Keeping a row per (provider, event id)
-- lets `provider-webhook` acknowledge a duplicate without applying it again —
-- which matters most for `reply.created` and `post.published`, where a replay
-- would otherwise re-run a write.
--
-- Service-role only: no tenant policies are created, so authenticated users can
-- neither read nor write it (the same shape as `integration_idempotency`).
--
-- See docs/API_INTEGRATION_BLUEPRINT.md (Phase 5, resilience).
-- Safe to run more than once.
-- -----------------------------------------------------------------------------
create table if not exists public.webhook_events (
  id          uuid primary key default gen_random_uuid(),
  -- Nullable: the event is claimed before we know which tenant it belongs to.
  business_id uuid references public.businesses(id) on delete cascade,
  provider    text not null,                       -- reviewflowz | mallary
  event_id    text not null,                       -- provider event id, or a body fingerprint
  event       text not null default '',            -- e.g. review.created / post.published
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create index if not exists webhook_events_received_idx
  on public.webhook_events (received_at desc);

alter table public.webhook_events enable row level security;

grant select, insert, update, delete on public.webhook_events to service_role;
