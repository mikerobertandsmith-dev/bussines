-- ---------------------------------------------------------------------------
-- Website catalogue scans (`site-scan`)
-- ---------------------------------------------------------------------------
-- `supplier_items` already carries the previous-state columns that turn a read
-- into a change ("new product", "price moved", "stock moved"). Competitor
-- listings had only a current row, so a restored competitor inventory list could
-- say what they sell but never what *moved* — which is the whole signal. The same
-- four columns are added here so both shelves are read the same way.
--
-- `previous_price` is not null defaulted rather than nullable: the app's item
-- shapes treat it as a number, and a first-seen product's previous price is its
-- own price, not "unknown".
-- ---------------------------------------------------------------------------

alter table public.competitor_items
  add column if not exists sku            text,
  add column if not exists previous_price numeric(12,2)   not null default 0,
  add column if not exists previous_stock stock_state     not null default 'in_stock',
  add column if not exists change         change_type     not null default 'new_product';

-- ---------------------------------------------------------------------------
-- In-flight website reads
-- ---------------------------------------------------------------------------
-- A catalogue crawl is minutes of provider work, which outlives one browser
-- request. The run id is held on the source row so the next scan *collects* the
-- run it already paid for instead of starting — and paying for — a second one.
-- `_shared/apify.ts` already treats a run that outlives our wait as normal.
--
-- `last_scan_at` is what the pages show as "last scanned", and `site-scan` moves
-- it only on a read that produced something, so a failed scan cannot make the page
-- claim a fresh one. `site_scan_at` is when the read was collected either way —
-- the attempt, kept so a failure is visible without the page lying about it.
-- ---------------------------------------------------------------------------

alter table public.suppliers
  add column if not exists site_run_id  text,
  add column if not exists site_error   text,
  add column if not exists site_scan_at timestamptz;

alter table public.competitors
  add column if not exists site_run_id  text,
  add column if not exists site_error   text,
  add column if not exists site_scan_at timestamptz;

-- No new index: change detection reads the newest row per product for one source,
-- and `competitor_items_idx` / `supplier_items_supplier_idx` (both on the source
-- column plus `detected_at desc`) already serve that ordering.
