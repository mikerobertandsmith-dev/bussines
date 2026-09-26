-- -----------------------------------------------------------------------------
-- Promotions become a brief → delivery flow
-- -----------------------------------------------------------------------------
-- The Promotions page no longer renders an ad in the browser. It collects a
-- brief describing what the business wants (the pieces to include and their
-- values), and this table is where that request lives. Finished designs are
-- produced by us and pushed into `delivered_ads` plus the public `delivered-ads`
-- bucket, where the business can open and export them.
--
-- The superseded `promotion_designs` table from 0005 is left untouched so any
-- existing rows are preserved; the app no longer reads or writes it.
-- -----------------------------------------------------------------------------

create table if not exists public.promotion_briefs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null default 'Untitled ad brief',
  item_id        uuid references public.inventory_items(id) on delete set null,
  template       text not null default 'square',       -- square | story | landscape
  accent_color   text not null default '#4f46e5',
  components     text[] not null default '{}',
  discount_kind  text not null default 'percent',      -- percent | amount
  discount_value numeric(12,2) not null default 0,
  deal_text      text,
  coupon_code    text,
  headline       text,
  notes          text,
  status         text not null default 'submitted',    -- submitted | in_design | delivered
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.delivered_ads (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  brief_id     uuid references public.promotion_briefs(id) on delete set null,
  name         text not null,
  template     text not null default 'square',
  storage_path text,                                   -- path in the delivered-ads bucket
  file_url     text,                                   -- public URL of the exported creative
  size_mb      numeric(10,2) not null default 0,
  downloads    integer not null default 0,
  note         text,
  delivered_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists promotion_briefs_business_idx on public.promotion_briefs (business_id, updated_at desc);
create index if not exists delivered_ads_business_idx     on public.delivered_ads     (business_id, delivered_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['promotion_briefs', 'delivered_ads'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- Row level security, same tenant scoping as every other table.
do $$
declare t text;
begin
  foreach t in array array['promotion_briefs', 'delivered_ads'] loop
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

grant select, insert, update, delete on public.promotion_briefs, public.delivered_ads to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage: finished ad designs we push back to the business
-- -----------------------------------------------------------------------------
-- Public bucket so a delivered design can be opened and exported straight from
-- the Promotions page; writes stay owner-scoped to `<clerk_user_id>/`.
insert into storage.buckets (id, name, public)
values ('delivered-ads', 'delivered-ads', true)
on conflict (id) do nothing;

drop policy if exists delivered_ads_read on storage.objects;
drop policy if exists delivered_ads_write on storage.objects;
drop policy if exists delivered_ads_update on storage.objects;
drop policy if exists delivered_ads_delete on storage.objects;

create policy delivered_ads_read on storage.objects
  for select using (bucket_id = 'delivered-ads');

create policy delivered_ads_write on storage.objects
  for insert with check (
    bucket_id = 'delivered-ads'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy delivered_ads_update on storage.objects
  for update using (
    bucket_id = 'delivered-ads'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy delivered_ads_delete on storage.objects
  for delete using (
    bucket_id = 'delivered-ads'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
