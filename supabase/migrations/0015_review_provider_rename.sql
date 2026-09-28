-- -----------------------------------------------------------------------------
-- Review provider rename: reviewflowz → reviews
-- -----------------------------------------------------------------------------
-- Review monitoring no longer runs through the Reviewflowz vendor. It is now
-- assembled from providers the workspace already pays for — SerpApi for Google
-- and TripAdvisor reviews, an Apify actor for the rest — so the provider slot is
-- a capability, not a vendor, and is named accordingly.
--
-- Nothing about the shape of the data changes: `review_connections`,
-- `my_reviews` and `review_replies` keep their columns. Only the provider label
-- stamped on rows moves, so the usage panel and the workspace health view stop
-- reporting a vendor that is no longer wired in.
--
-- Safe to run more than once.
-- -----------------------------------------------------------------------------

alter table public.review_connections alter column provider set default 'reviews';
alter table public.review_replies     alter column provider set default 'reviews';

update public.review_connections      set provider = 'reviews' where provider = 'reviewflowz';
update public.review_replies          set provider = 'reviews' where provider = 'reviewflowz';
update public.integration_connections set provider = 'reviews' where provider = 'reviewflowz';
update public.api_usage_log           set provider = 'reviews' where provider = 'reviewflowz';
update public.integration_idempotency set provider = 'reviews' where provider = 'reviewflowz';

-- -----------------------------------------------------------------------------
-- Comments, so the schema's own documentation matches the code.
-- -----------------------------------------------------------------------------
comment on column public.integration_connections.provider is
  'serpapi | apify | reviews | mallary  (reviews is a capability built from the serpapi/apify readers)';
comment on column public.api_usage_log.provider is
  'serpapi | apify | reviews | mallary  (a review read is logged against the reader that paid for it)';
comment on column public.review_connections.provider is
  'reviews — the reader behind a profile is chosen per platform, not per connection';
