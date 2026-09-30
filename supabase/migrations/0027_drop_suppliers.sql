-- -----------------------------------------------------------------------------
-- Remove the supplier feature entirely
-- -----------------------------------------------------------------------------
-- The app no longer watches suppliers: the Suppliers page, the supplier
-- onboarding step, the supplier add/edit forms and the supplier half of
-- `site-scan` are gone. This migration takes the database half with them, so the
-- live project stops carrying tables, columns and a scan-source value that no
-- code reads.
--
-- Order matters:
--
--   1. Move the rows that would otherwise reference a dropped table, so nothing
--      is orphaned and the enum cast below sees only live values.
--   2. Drop the child tables before `suppliers`, which they reference.
--   3. Drop the leftover columns on tables that outlive the feature.
--   4. Rebuild `scan_source_type` without `supplier`, because an enum value can
--      only be removed by recreating the type.
--
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

-- 1. Re-point rows that referenced the feature before the feature disappears.
update public.scan_runs
  set source_type = 'competitor'
  where source_type = 'supplier';

alter table public.inventory_recommendations
  drop column if exists supplier_id;

-- 2. The supplier tables. `cascade` covers the RLS policies, indexes, grants and
--    the foreign key from `inventory_recommendations` that went with the column
--    above — all of which belong to these tables alone.
drop table if exists public.supplier_certifications cascade;
drop table if exists public.supplier_items cascade;
drop table if exists public.suppliers cascade;

-- 3. `scan_source_type` originally listed `supplier`. An enum value cannot be
--    dropped in place, so the type is recreated without it and the one column
--    that uses it is cast across. The guard keeps the migration idempotent.
do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'scan_source_type' and e.enumlabel = 'supplier'
  ) then
    alter type scan_source_type rename to scan_source_type_old;

    create type scan_source_type as enum (
      'competitor', 'reviews', 'seo', 'geo', 'social', 'publishing', 'traffic', 'ads'
    );

    alter table public.scan_runs
      alter column source_type type scan_source_type
      using source_type::text::scan_source_type;

    drop type scan_source_type_old;
  end if;
end $$;
