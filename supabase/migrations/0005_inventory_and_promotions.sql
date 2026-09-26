-- -----------------------------------------------------------------------------
-- Inventory / services and promotion ad designs
-- -----------------------------------------------------------------------------
-- Inventory is what the business sells — products (with stock) and services.
-- Each row can carry its own image, uploaded to the `inventory-images` bucket.
-- Promotion designs are the ads built from those items on the Promotions page;
-- they only store the configuration, the ad itself is rendered in the browser
-- and exported as a PNG.
-- -----------------------------------------------------------------------------

create table if not exists public.inventory_items (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  kind             text not null default 'product',   -- product | service
  name             text not null,
  sku              text,
  category         text,
  description      text,
  price            numeric(12,2) not null default 0,
  compare_at_price numeric(12,2) not null default 0,
  stock            integer not null default 0,
  status           text not null default 'active',    -- active | draft | archived
  image_url        text,
  image_path       text,                              -- path in the inventory-images bucket
  tags             text[] not null default '{}',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.promotion_designs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null default 'Untitled design',
  item_id       uuid references public.inventory_items(id) on delete set null,
  template      text not null default 'square',       -- square | story | landscape
  headline      text,
  subheadline   text,
  deal_text     text,
  cta_text      text,
  discount_pct  numeric(5,2) not null default 0,
  coupon_code   text,
  accent_color  text not null default '#4f46e5',
  components    text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists inventory_items_business_idx   on public.inventory_items   (business_id, kind);
create index if not exists promotion_designs_business_idx on public.promotion_designs (business_id, updated_at desc);

-- updated_at triggers
do $$
declare t text;
begin
  foreach t in array array['inventory_items', 'promotion_designs'] loop
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
  foreach t in array array['inventory_items', 'promotion_designs'] loop
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

grant select, insert, update, delete on public.inventory_items, public.promotion_designs to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage: product & service images used inside the ad designs
-- -----------------------------------------------------------------------------
-- Public bucket so an exported ad can render the image; writes stay
-- owner-scoped to `<clerk_user_id>/`.
insert into storage.buckets (id, name, public)
values ('inventory-images', 'inventory-images', true)
on conflict (id) do nothing;

drop policy if exists inventory_images_read on storage.objects;
drop policy if exists inventory_images_write on storage.objects;
drop policy if exists inventory_images_update on storage.objects;
drop policy if exists inventory_images_delete on storage.objects;

create policy inventory_images_read on storage.objects
  for select using (bucket_id = 'inventory-images');

create policy inventory_images_write on storage.objects
  for insert with check (
    bucket_id = 'inventory-images'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy inventory_images_update on storage.objects
  for update using (
    bucket_id = 'inventory-images'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy inventory_images_delete on storage.objects
  for delete using (
    bucket_id = 'inventory-images'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
