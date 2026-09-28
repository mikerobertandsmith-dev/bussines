-- -----------------------------------------------------------------------------
-- AI drafting: a theme for each keyword idea
-- -----------------------------------------------------------------------------
-- (The cost-precision change at the bottom of this file is part of the same
--  phase — see its own note.)

-- Phase 5's AI enrichment groups the autocomplete suggestions a seed produced
-- into intent clusters ("emergency plumbing", "cost of a new boiler"), so the
-- page can answer "what should I write about?" rather than just listing 20
-- near-identical strings.
--
-- The label lives on the idea row rather than in a table of its own: a cluster is
-- only ever a grouping *of these suggestions*, and a separate table would need
-- keeping in step with rows deleted when a user promotes one into a keyword.
-- An empty value means "not grouped yet", which is also what every existing row
-- gets — the page then shows the plain list, exactly as it does today.
--
-- Safe to run more than once.

alter table public.keyword_ideas
  add column if not exists cluster text not null default '';

comment on column public.keyword_ideas.cluster is
  'AI-assigned intent theme for this suggestion. Empty until the workspace asks for clusters.';

-- Lets the page read one seed's grouped suggestions without a full scan.
create index if not exists keyword_ideas_cluster_idx
  on public.keyword_ideas (business_id, seed, cluster);

-- -----------------------------------------------------------------------------
-- Cost precision
-- -----------------------------------------------------------------------------
-- api_usage_log.cost_usd was numeric(10,4), sized for Apify runs ($0.10+) and
-- SerpApi searches. A drafting call is far cheaper than that: a short reply at
-- gpt-oss-120b rates costs about $0.00005, so at four decimals every AI row would
-- record as $0.0000 and the usage panel would keep reporting $0.00 no matter how
-- much drafting a workspace did. Widening to six decimals is a no-op for every
-- existing row and makes the recorded figure mean something.

alter table public.api_usage_log
  alter column cost_usd type numeric(12,6);

