-- ---------------------------------------------------------------------------
-- Competitor advertising scans (`ads-scan`)
-- ---------------------------------------------------------------------------
-- The *Active ad campaigns* tile on Competition counts `competitor_ads` rows with
-- an `active` status, and that table had no writer at all — so the tile read 0 for
-- every rival however much they advertised. `ads-scan` reads Meta's Ad Library
-- and records its work in `scan_runs` like every other scan.
--
-- A source type of its own, not `social`: the ad library is a different provider
-- endpoint with its own spend, and filing it under social would put ad reading on
-- the social health line and make the history claim posts were scraped when none
-- were.
-- ---------------------------------------------------------------------------

alter type public.scan_source_type add value if not exists 'ads';
