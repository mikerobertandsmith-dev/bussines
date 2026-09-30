-- ---------------------------------------------------------------------------
-- What a watched site published a catalogue row as
-- ---------------------------------------------------------------------------
-- `site-scan` reads a competitor's or a supplier's own site, and what a business
-- sells is not always a product: a shopfront publishes products, a business that
-- renders a service publishes `Service`, and a business whose site *is* its
-- pricing page publishes an `OfferCatalog` of plans. All three are stored, and
-- this column is what lets the New inventory and Suppliers tables say which is
-- which instead of showing a plan or a service as an unlabelled product.
--
-- `product` is the default so every row read before this column existed keeps a
-- true value rather than a blank label.
-- ---------------------------------------------------------------------------

do $$
begin
  create type item_kind as enum ('product', 'service', 'price_plan');
exception
  when duplicate_object then null;
end $$;

alter table public.supplier_items
  add column if not exists kind item_kind not null default 'product';

alter table public.competitor_items
  add column if not exists kind item_kind not null default 'product';
