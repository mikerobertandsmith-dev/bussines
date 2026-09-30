-- -----------------------------------------------------------------------------
-- Supplier certifications and compliance (`cert-scan`)
-- -----------------------------------------------------------------------------
-- The catalogue read (`site-scan`) answers "what does this site sell?", and for the
-- garment factories and manufacturers this app watches the honest answer is
-- "nothing buyable" — a factory's website is a credibility brochure, not a shopfront.
-- Every such read settled with zero products and the Suppliers page could only say
-- "no catalogue", which is true but not useful.
--
-- What those sites *do* publish, on almost all of them, is their compliance: the
-- certifications a buyer checks before placing an order. `cert-scan` reads the
-- supplier's own pages (directly, with no Apify spend — the configured catalogue
-- actor returns product rows and cannot see a certifications page) and records what
-- it finds here.
--
-- `first_seen_at` / `last_seen_at` are the whole point of the pair: the first says
-- how long they have held a mark we can see, the second says whether the last check
-- still found it. A mark that disappears is deliberately *not* reported as removed,
-- because the read samples a bounded set of pages and absence proves nothing —
-- the same reason the catalogue read never reports a product as removed.
--
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

create table if not exists public.supplier_certifications (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  supplier_id   uuid not null references public.suppliers(id) on delete cascade,
  -- Canonical key, e.g. `oeko-tex`, `wrap`, `iso-9001`. Stable across reads, so a
  -- repeat check refreshes the row instead of adding one.
  cert_key      text not null,
  -- Display name and grouping, written by `_shared/certifications.ts`.
  name          text not null,
  category      text not null default 'quality',
  -- The words that matched, kept so a detected mark is checkable by a person.
  evidence      text,
  source_url    text,
  -- When we first saw it, and when the last check still saw it.
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.supplier_certifications
  drop constraint if exists supplier_certifications_category_check;
alter table public.supplier_certifications
  add constraint supplier_certifications_category_check
  check (category in (
    'quality', 'environmental', 'social', 'product-safety',
    'chemicals', 'security', 'organic', 'forestry'
  ));

comment on table public.supplier_certifications is
  'Certifications and compliance marks found on a supplier''s own website by cert-scan.';
comment on column public.supplier_certifications.cert_key is
  'Canonical certification key; with supplier_id, the identity a repeat check upserts on.';
comment on column public.supplier_certifications.evidence is
  'The text that matched, so a detected mark can be checked by a person.';

-- A certification is recorded once per supplier; a repeat check moves `last_seen_at`.
create unique index if not exists supplier_certifications_key_idx
  on public.supplier_certifications (supplier_id, cert_key);

create index if not exists supplier_certifications_business_idx
  on public.supplier_certifications (business_id, category);

-- -----------------------------------------------------------------------------
-- Check state on the supplier row
-- -----------------------------------------------------------------------------
-- Mirrors `site_scan_at` / `site_error` from migration 0021: when the last
-- certification check ran (set whether or not it found anything), and why it could
-- not when it did not. Kept separate from the catalogue read's columns because the
-- two are independent reads with independent failures — a supplier can have a
-- readable certifications page and no catalogue at all, which is exactly the
-- common case here.
-- -----------------------------------------------------------------------------

alter table public.suppliers
  add column if not exists certs_checked_at timestamptz,
  add column if not exists certs_error      text;

-- -----------------------------------------------------------------------------
-- Row level security — the same four tenant policies as every other table.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['supplier_certifications'] loop
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

grant select, insert, update, delete on public.supplier_certifications
  to authenticated, service_role;
