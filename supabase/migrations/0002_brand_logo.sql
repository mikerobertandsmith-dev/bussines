-- -----------------------------------------------------------------------------
-- Brand logo
-- -----------------------------------------------------------------------------
-- The uploaded logo is shown in the sidebar on every page, so it lives in a
-- public bucket and the row only stores the resulting URL. Writes stay
-- owner-scoped: objects must live under `<clerk_user_id>/`.
alter table public.businesses
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('brand-assets', 'brand-assets', true)
on conflict (id) do nothing;

drop policy if exists brand_assets_read on storage.objects;
drop policy if exists brand_assets_write on storage.objects;
drop policy if exists brand_assets_update on storage.objects;
drop policy if exists brand_assets_delete on storage.objects;

-- Public bucket: anyone with the URL can render the logo.
create policy brand_assets_read on storage.objects
  for select using (bucket_id = 'brand-assets');

create policy brand_assets_write on storage.objects
  for insert with check (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy brand_assets_update on storage.objects
  for update using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
create policy brand_assets_delete on storage.objects
  for delete using (
    bucket_id = 'brand-assets'
    and (storage.foldername(name))[1] = public.clerk_user_id()
  );
