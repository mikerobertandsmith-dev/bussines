-- -----------------------------------------------------------------------------
-- Ad briefs: services, price targets and contact details
-- -----------------------------------------------------------------------------
-- The Promotions brief now treats products and services as separate pieces, so
-- a brief records which service it is built around alongside the product, which
-- product or service a shown price refers to, and the contact details to print
-- when the contact component is on. All additive and idempotent.
-- -----------------------------------------------------------------------------

alter table public.promotion_briefs
  add column if not exists service_id    uuid references public.inventory_items(id) on delete set null,
  add column if not exists price_item_id uuid references public.inventory_items(id) on delete set null,
  add column if not exists contact_info  text not null default '';

comment on column public.promotion_briefs.item_id is
  'The inventory product the design is built around, when the product component is on.';
comment on column public.promotion_briefs.service_id is
  'The service the design is built around, when the service component is on.';
comment on column public.promotion_briefs.price_item_id is
  'The product or service the shown price refers to, when the price component is on.';
comment on column public.promotion_briefs.contact_info is
  'The contact details to print, when the contact component is on.';
