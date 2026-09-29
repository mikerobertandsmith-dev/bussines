-- ---------------------------------------------------------------------------
-- Search visibility written back onto the business row (`serp-scan`)
-- ---------------------------------------------------------------------------
-- `businesses` has carried `seo_score` / `previous_seo_score` since 0001, but
-- nothing ever wrote them: the My Business health card read onboarding figures and
-- presented them as the result of a scan. `serp-scan` now derives the score from
-- the rankings it just stored (see `_shared/seo.ts`) and writes it here, which
-- needs somewhere to keep the two numbers the card was already promising: how many
-- tracked terms sit in the top 10, and where we sit on average.
--
-- Every current value has a `previous_*` twin, mirroring `previous_seo_score` /
-- `industry_rank_previous` on this table: the card shows movement, and a single
-- column can only show the latest figure. They are nullable rather than defaulting
-- to 0, because "no previous scan" and "we previously ranked for nothing" are
-- different statements and the app renders them differently (a dash versus 0).
--
-- `avg_position` is also nullable for the same reason, and is `numeric(6,1)`
-- because one decimal is all the precision the position data supports.
--
-- `rankings_checked_at` says when the figures were derived, so a number left over
-- from an older scan is visibly old rather than silently presented as current.
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists top10_count           integer      not null default 0,
  add column if not exists previous_top10_count  integer,
  add column if not exists ranked_count          integer      not null default 0,
  add column if not exists avg_position          numeric(6,1),
  add column if not exists previous_avg_position numeric(6,1),
  add column if not exists rankings_checked_at   timestamptz;

-- No new index: the summary is computed from `serp_rankings` for one business,
-- and the unique key on (business_id, keyword, device, location) already leads
-- with `business_id`.
