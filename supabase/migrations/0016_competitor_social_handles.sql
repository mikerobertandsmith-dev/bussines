-- -----------------------------------------------------------------------------
-- Competitor social handles become editable — the scan's target list
-- -----------------------------------------------------------------------------
-- `social-scan` scrapes exactly the handles declared in `competitor_social`, so a
-- competitor with no row there is simply not monitored. Nothing in the app ever
-- wrote that table: onboarding captured a competitor's name and website only, and
-- the only reference in `src/` was a read. A real workspace therefore had zero
-- targets and the scan reported nothing to do.
--
-- The app now writes these rows (Competition → Social presence), and it saves one
-- handle per competitor per platform — re-saving Instagram replaces the handle
-- instead of stacking a second target — which is what the upsert relies on.
--
-- `platform` is stored as the key the gateway knows (`instagram`, `tiktok`,
-- `facebook`, `x`), matching `SOCIAL_PLATFORMS` in `_shared/apify.ts`; display
-- names come from `platformLabel()` in the app.
--
-- Safe to run more than once.

-- Collapse any duplicate target first, so the unique index below cannot fail on a
-- dataset that predates it. The row with the greatest (created_at, id) wins, which
-- is total and deterministic — comparing created_at alone would leave two rows
-- that share a timestamp and break the index.
delete from public.competitor_social older
using public.competitor_social newer
where older.business_id = newer.business_id
  and older.competitor_id = newer.competitor_id
  and older.platform = newer.platform
  and (older.created_at, older.id) < (newer.created_at, newer.id);

create unique index if not exists competitor_social_target_idx
  on public.competitor_social (business_id, competitor_id, platform);

comment on index public.competitor_social_target_idx is
  'One monitored handle per competitor per platform; social-scan scrapes exactly these rows.';
