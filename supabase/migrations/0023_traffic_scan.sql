-- ---------------------------------------------------------------------------
-- Website traffic scans (`traffic-scan`)
-- ---------------------------------------------------------------------------
-- The traffic panels on My Business and Competition read
-- `businesses.monthly_visits` / `visits_change`, the `traffic` and
-- `traffic_source` rows in `competitor_metrics`, and the `traffic` / `channel`
-- rows in `my_metrics`. Nothing ever wrote any of them, so the panels could only
-- ever show a chart with no series and a "Monthly visits" tile reading 0 while
-- the site plainly had visitors.
--
-- `traffic-scan` now fills them from SimilarWeb (via Apify). It records its work
-- in `scan_runs` like every other scan, which needs a source type of its own —
-- reporting a traffic read under `seo` would put a traffic cost on the SEO health
-- line and make the history read as though SEO had run.
--
-- (`ALTER TYPE ... ADD VALUE` is used in its own migration on purpose: the new
-- label is not referenced in the same transaction that creates it.)
-- ---------------------------------------------------------------------------

alter type public.scan_source_type add value if not exists 'traffic';
