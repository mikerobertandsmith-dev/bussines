import { getEnv } from "./env.ts";

/**
 * Apify client for reading a watched **website's catalogue** — a supplier's or a
 * competitor's product pages — and turning it into product rows.
 *
 * Separate from `_shared/apify.ts` (that one is pointed at a social profile and
 * returns posts) and from `_shared/contacts.ts` (a website, but returning social
 * profiles). The transport (start/wait/dataset) is imported from `apify.ts` by
 * the caller rather than reimplemented, so the codebase keeps one run/retry/charge
 * path.
 *
 * ## The contract an actor has to meet
 *
 * No new secret is needed to read a watched business's site. A supplier and a
 * competitor are the same thing to this scan — a business with a website — so the
 * read uses the website actor the deployment already has, `APIFY_CONTACTS_ACTOR_ID`
 * (the crawler behind the competitor "find their socials" flow). `APIFY_SITE_ACTOR_ID`
 * is an optional dedicated slot: set it once and both pages use it instead, which is
 * how a catalogue-specific actor would be introduced later without a release.
 *
 * The id is **configuration**, never a constant, and blank means "this deployment
 * has no website actor at all": the feature reports itself unavailable rather than
 * guessing at an actor and paying for a run that returns nothing.
 *
 * Whichever actor is configured must return **either** shape, and this module
 * reads both because the second is a public standard rather than a vendor's field
 * list:
 *
 *   1. **Flat product rows** — one dataset item per product, with the usual
 *      spellings read off by `normaliseProduct` (`name`/`title`/`product`,
 *      `price`/`priceValue`, `availability`/`stock`, `sku`, `category`, `url`).
 *      A row may also nest its products under `products`/`items`/`offers`.
 *   2. **schema.org JSON-LD** — most shopfronts (Shopify, WooCommerce, BigCommerce,
 *      generic templates) embed `<script type="application/ld+json">` blocks with
 *      `@type: "Product"` and an `offers` block. That is a published vocabulary, so
 *      reading it is not a guess about an actor; it is the same data the site tells
 *      Google. Any `html`, `markdown`, `text` or `jsonLd` field a crawler returns is
 *      searched for those blocks.
 *
 * Nothing here is written anywhere on its own: the function that calls this decides
 * what a *change* is and which rows to keep.
 */

/** Which page a read belongs to. The two differ only in the tables they touch. */
export type SiteTarget = "supplier" | "competitor";

/**
 * The variables that switch the site read on, the dedicated slot first.
 *
 * Exported so the Integrations panel and the tests agree with this module about
 * what "configured" means instead of each restating it.
 */
export const SITE_ACTOR_ENV_KEYS = ["APIFY_SITE_ACTOR_ID", "APIFY_CONTACTS_ACTOR_ID"] as const;

/**
 * The actor id a site read runs, or "" when this deployment has no website actor.
 *
 * `APIFY_SITE_ACTOR_ID` wins when it is set — one name for both pages, because a
 * supplier's wholesale list and a rival's shopfront are read the same way. Unset,
 * the read falls back to `APIFY_CONTACTS_ACTOR_ID`, the website crawler already
 * configured for competitor discovery: the two features read the same page for
 * different answers, so one id covers both rather than demanding a second secret
 * to read a site the app can already read.
 *
 * Empty means "this deployment cannot read a website at all", and the caller
 * reports that state instead of running: an unverified actor id is worse than a
 * missing feature, because a run that returns nothing is still charged.
 */
export function siteActorId(): string {
  return getEnv(SITE_ACTOR_ENV_KEYS[0]) || getEnv(SITE_ACTOR_ENV_KEYS[1]) || "";
}

/** A message naming the variables that switch the site read on. */
export function siteActorHint(): string {
  return (
    `Set ${SITE_ACTOR_ENV_KEYS[0]} to a product-catalogue actor, or ` +
    `${SITE_ACTOR_ENV_KEYS[1]} to the website reader this deployment already uses.`
  );
}

/** A positive number from the environment, or the fallback. */
function positiveEnv(key: string, fallback: number): number {
  const value = Number(getEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** What one catalogue read is allowed to cost, and how far it may crawl. */
export interface SiteCaps {
  /** Hard page ceiling. Product listings are paginated, so this is the reach. */
  maxPages: number;
  /** Ceiling for this run, in dollars. */
  maxChargeUsd: number;
  /** Apify's own kill switch for the run, in seconds. */
  timeoutSecs: number;
  /** Products kept from one read, so a runaway catalogue cannot fill the table. */
  maxItems: number;
}

/**
 * The caps for one catalogue read.
 *
 * The dollar ceiling deliberately does **not** reuse the shared
 * `APIFY_MAX_CHARGE_USD` default of $0.25: that value was chosen for a
 * per-result social scrape, and a page-crawling actor's own floor can sit above
 * it, where Apify refuses the run outright with
 * `max-total-charge-usd-below-minimum` — a refusal, not a tighter cap. Raise
 * `APIFY_SITE_MAX_CHARGE_USD` above the configured actor's floor.
 */
export function siteCaps(): SiteCaps {
  return {
    maxPages: Math.round(positiveEnv("APIFY_SITE_MAX_PAGES", 25)),
    maxChargeUsd: positiveEnv("APIFY_SITE_MAX_CHARGE_USD", 1),
    timeoutSecs: Math.round(positiveEnv("APIFY_SITE_RUN_TIMEOUT_SECS", 120)),
    maxItems: Math.round(positiveEnv("APIFY_SITE_MAX_ITEMS", 200)),
  };
}

/**
 * The website to read, as a bare `https://host`, or "" when it cannot be read as
 * one. The server twin of `normaliseWebsite` in `src/lib/format.ts` (the gateway
 * cannot import from `src/`), matching `scrapeUrl` in `_shared/contacts.ts`.
 */
export function catalogueUrl(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.hostname ? `${url.protocol}//${url.host}` : "";
  } catch {
    return "";
  }
}

/**
 * The actor input for one website.
 *
 * Kept to keys that a page crawler and a shopfront actor both accept:
 * `startUrls` is the only universal one, and the page ceiling is expressed three
 * ways (`maxCrawlPages`, `maxRequests`, `maxRequestsPerStartUrl`) because actors
 * disagree on the name and an unrecognised key is silently ignored — which is a
 * run that costs money and stops nowhere. `sameDomain` keeps a supplier's links
 * to its own social sites from being crawled as catalogue pages.
 *
 * Product *detail* pages are the point, so the crawl follows links rather than
 * stopping at the home page; that is what `maxDepth` is for.
 */
export function siteInputFor(url: string, caps: SiteCaps): Record<string, unknown> {
  return {
    startUrls: [{ url }],
    maxCrawlPages: caps.maxPages,
    maxRequests: caps.maxPages,
    maxRequestsPerStartUrl: caps.maxPages,
    maxDepth: 2,
    sameDomain: true,
    proxyConfig: { useApifyProxy: true },
    // Off by default, so an actor that only reads HTML is not asked to render a
    // browser per page and bill for it. A site that needs one is a configuration
    // change, not a code change.
    useBrowser: false,
  };
}

/* -------------------------------------------------------------- normalising */

/** One product the site publishes, on our own columns. */
export interface ScrapedProduct {
  /** Stable identity for change detection: the SKU when the page gives one. */
  key: string;
  product: string;
  sku: string;
  category: string;
  price: number;
  stock: string;
  url: string;
}

/** Our stock states, spelled out here so the gateway need not import from `src/`. */
export type StockState = "in_stock" | "low_stock" | "out_of_stock" | "preorder";

const STOCK_STATES: StockState[] = ["in_stock", "low_stock", "out_of_stock", "preorder"];

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

/**
 * A price out of whatever the page wrote: `18.40`, `$18.40`, `18,40`, `1,299.00`.
 *
 * A decimal comma is read as a decimal separator, not a thousands one, because
 * `18,40` on a European supplier's page is eighteen-forty — reading it as 1840
 * would turn a real price move into an absurd one. Thousands separators only
 * apply when the comma group is exactly three digits *and* a decimal point is
 * also present.
 */
export function parsePrice(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Number(value.toFixed(2));
  const raw = firstString(value);
  if (!raw) return 0;
  let cleaned = raw.replace(/[^\d.,]/g, "");
  // Whichever separator comes last is the decimal one, so `1,299.00` drops its
  // comma and `18,40` becomes 18.40 rather than eighteen hundred and forty.
  if (cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    cleaned = cleaned.replace(/,/g, "");
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

/**
 * A stock state from a page's own words, or from schema.org's availability enum.
 *
 * `OutOfStock`/`SoldOut` must be tested before `InStock`, because the schema.org
 * value for the first *contains* the second as a substring — a check in the wrong
 * order reports every sold-out product as available, which is the one mistake here
 * that would silently invert a signal.
 */
export function stockStateOf(value: unknown, fallback: StockState = "in_stock"): StockState {
  // A boolean flag is a whole answer on its own, and it has to be read *before*
  // the string is looked at: `false` carries no text, so the empty-value return
  // below would answer "in_stock" for a product an actor explicitly marked as
  // unavailable — the same signal inversion as the substring trap, one layer up.
  if (value === true) return "in_stock";
  if (value === false) return "out_of_stock";

  const raw = firstString(value).toLowerCase();
  if (!raw) return fallback;
  if (/out[ _-]?of[ _-]?stock|outofstock|sold[ _-]?out|unavailable|discontinued/.test(raw)) {
    return "out_of_stock";
  }
  if (/pre[ _-]?order|preorder|backorder/.test(raw)) return "preorder";
  if (/low[ _-]?stock|limited|few left|almost gone|last few/.test(raw)) return "low_stock";
  if (/in[ _-]?stock|instock|available|buy ?now|add to cart/.test(raw)) return "in_stock";
  return fallback;
}

/** Normalises a product name into the identity used when a site gives no SKU. */
function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * The identity two reads of the same product are matched on.
 *
 * Exported because change detection compares a scraped product against the row we
 * already hold, and both sides must derive the key the same way or every scan
 * would report the whole catalogue as new.
 */
export function catalogueKey(sku: string, product: string): string {
  const clean = (sku ?? "").trim().toLowerCase();
  return clean ? `sku:${clean}` : `name:${nameKey(product ?? "")}`;
}

/**
 * When a source is next due, from its cadence.
 *
 * A deliberate duplicate of `CADENCE_DAYS` in `src/lib/schedule.ts`: the gateway
 * cannot import from `src/`, and the two must not disagree about what "daily"
 * means or a scan's next-due date would flip depending on which side wrote it.
 */
export function nextScanAt(cadence: string, from: Date = new Date()): string {
  const days = cadence === "monthly" ? 30 : cadence === "weekly" ? 7 : 1;
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next.toISOString();
}

/** An array, from an array or a single object. */
function asArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object",
    );
  }
  return value && typeof value === "object" ? [value as Record<string, unknown>] : [];
}

/**
 * The offer block of a schema.org product, which is where the price and stock sit.
 *
 * A single offer is an object; several are an array (one per size or seller), and
 * the lowest price is the one a "buy price" comparison should use, so the array is
 * read as the cheapest rather than the first.
 */
function offerOf(product: Record<string, unknown>): Record<string, unknown> {
  const offers = asArray(product.offers);
  if (!offers.length) return {};
  let cheapest = offers[0];
  for (const offer of offers) {
    if (parsePrice(offer.price ?? offer.lowPrice) < parsePrice(cheapest.price ?? cheapest.lowPrice)) {
      cheapest = offer;
    }
  }
  return cheapest;
}

/** Product rows from an explicit `products`/`items`/`offers` block on an item. */
function nestedProducts(item: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["products", "items", "offers", "variants"]) {
    const rows = asArray(item[key]);
    if (rows.length) return rows;
  }
  return [];
}

/**
 * One flat product row → our columns, or null when it has no usable identity.
 *
 * A row with no name is dropped rather than stored as an empty product: the table
 * is a list of things to buy, and a nameless row is noise that would also corrupt
 * change detection by keying on "".
 */
export function normaliseProduct(raw: Record<string, unknown>): ScrapedProduct | null {
  const offer = offerOf(raw);
  const product = firstString(
    raw.name,
    raw.title,
    raw.productName,
    raw.product,
    raw.productTitle,
  );
  if (!product) return null;

  const price = parsePrice(
    raw.price ?? raw.priceValue ?? raw.lowPrice ?? offer.price ?? offer.lowPrice,
  );
  const stock = stockStateOf(
    raw.availability ??
      raw.stock ??
      raw.stockStatus ??
      raw.availabilityText ??
      offer.availability ??
      raw.inStock,
  );
  // Deliberately not an actor's own row `id`: that changes between runs, and a
  // shifting key would report the whole catalogue as new products every scan.
  const sku = firstString(raw.sku, raw.gtin, raw.mpn, raw.variantSku, raw.skuId);
  const url = firstString(raw.url, raw.link, raw.productUrl, raw.detailUrl, raw["@id"]);

  return {
    key: catalogueKey(sku, product),
    product: product.slice(0, 300),
    sku: sku.slice(0, 120),
    category: firstString(raw.category, raw.productType, raw.categoryName).slice(0, 120),
    price,
    stock,
    url,
  };
}

/**
 * schema.org products out of a JSON string — a page's embedded JSON-LD, or an
 * actor field that carries the structured data through.
 *
 * Deliberately tolerant: a block may be a single object, an array, or wrapped in
 * `@graph`, and the `Product` may be nested inside an `ItemList` (how category
 * pages publish it). Anything unparseable is skipped rather than thrown, because
 * one malformed block on a page must not lose the rest of the catalogue.
 */
function productsFromJson(value: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return found;
  }

  const visit = (node: unknown, depth: number) => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = firstString(record["@type"]).toLowerCase();
    if (type === "product") {
      found.push(record);
      return;
    }
    visit(record["@graph"], depth + 1);
    visit(record.itemListElement, depth + 1);
    visit(record.item, depth + 1);
  };

  visit(parsed, 0);
  return found;
}

/** Every `<script type="application/ld+json">…</script>` body in an HTML string. */
export function jsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const pattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1]?.trim()) blocks.push(match[1].trim());
  }
  return blocks;
}

/**
 * A whole dataset → the products it describes.
 *
 * Every item is read for flat product rows, for a nested product block, and for
 * JSON-LD carried in a text-like field, because which of the three arrives depends
 * entirely on the configured actor. Duplicate keys are folded, later entries
 * winning, so a product repeated across a listing page and its detail page is one
 * row rather than two.
 */
export function normaliseCatalogue(
  items: Record<string, unknown>[],
  limit: number,
): ScrapedProduct[] {
  const byKey = new Map<string, ScrapedProduct>();

  const accept = (raw: Record<string, unknown>) => {
    const product = normaliseProduct(raw);
    if (product && product.price >= 0) byKey.set(product.key, product);
  };

  for (const item of items) {
    const nested = nestedProducts(item);
    const candidates = nested.length ? nested : [item];
    for (const candidate of candidates) accept(candidate);

    for (const field of ["jsonLd", "jsonld", "structuredData", "html", "markdown", "text", "content"]) {
      const value = item[field];
      if (typeof value !== "string" || !value.includes("Product")) continue;
      const blocks = field === "jsonLd" || field === "jsonld" || field === "structuredData"
        ? [value]
        : jsonLdBlocks(value);
      for (const block of blocks) {
        for (const product of productsFromJson(block)) accept(product);
      }
    }

    // The item itself may be a JSON-LD product handed over as an object.
    if (firstString(item["@type"]).toLowerCase() === "product") accept(item);
  }

  return [...byKey.values()].slice(0, Math.max(1, limit));
}

/** A stock state that is safe to write to the `stock_state` enum. */
export function safeStockState(value: string): StockState {
  return (STOCK_STATES as string[]).includes(value) ? (value as StockState) : "in_stock";
}
