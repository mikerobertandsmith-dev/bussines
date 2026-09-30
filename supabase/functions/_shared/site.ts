import { getEnv } from "./env.ts";

/**
 * Apify client for reading a watched **competitor's website catalogue** — their
 * product pages — and turning it into product rows.
 *
 * Separate from `_shared/apify.ts` (that one is pointed at a social profile and
 * returns posts) and from `_shared/contacts.ts` (a website, but returning social
 * profiles). The transport (start/wait/dataset) is imported from `apify.ts` by
 * the caller rather than reimplemented, so the codebase keeps one run/retry/charge
 * path.
 *
 * ## The contract an actor has to meet
 *
 * A **product-catalogue actor is required**: `APIFY_SITE_ACTOR_ID`. A competitor is
 * just a business with a website, so one configured id serves the page, but only an
 * actor that actually publishes products can serve it. The id is **configuration**,
 * never a constant, so a different catalogue actor is a secret change rather than a
 * release.
 *
 * It is **not** interchangeable with `APIFY_CONTACTS_ACTOR_ID`, the crawler behind
 * the competitor "find their socials" flow. That actor returns contact details —
 * emails, phones, social handles — with no product rows and no page HTML/JSON-LD,
 * the two shapes the normalising below reads. Measured on the live project,
 * catalogue reads through it start, bill and report "succeeded" with 0 changes every
 * time while writing nothing: a silent empty catalogue, not a working default. See
 * `siteActorId()` for why the fallback is still resolved at all.
 *
 * Blank means "this deployment has no website actor at all": the feature reports
 * itself unavailable rather than guessing at an actor and paying for a run that
 * returns nothing.
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
 * ## Products, services and price plans
 *
 * What a business sells is not always a product. A shopfront publishes `Product`
 * rows; a business that renders a service publishes `Service`; and a business whose
 * site is its pricing page publishes an `OfferCatalog` of `Offer`s — "Starter",
 * "Pro", "£29/mo". All three are read here and tagged with a `kind`, because the
 * monitoring pages exist to show what a watched site is *selling*, and a catalogue
 * that silently drops every service and every plan is not that. The tag is read
 * from the page's own structured data first and from the URL it came from second,
 * so an actor that returns no structured data still gets a sensible label.
 *
 * Nothing here is written anywhere on its own: the function that calls this decides
 * what a *change* is and which rows to keep.
 */

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
 * `APIFY_SITE_ACTOR_ID` wins when it is set, and is the one that matters — the
 * catalogue reader behind the Competition page's site scan. It is a requirement
 * rather than an override; the fallback below cannot read a catalogue at all (see
 * the module note above).
 *
 * The fallback to `APIFY_CONTACTS_ACTOR_ID` is kept so that a deployment with no
 * catalogue actor still resolves to *an* id, which is what lets the Integrations
 * panel and `siteActorHint()` tell "misconfigured" apart from "no website reader at
 * all". It is not kept because that actor can read a catalogue: treat an unset
 * `APIFY_SITE_ACTOR_ID` as a deployment that cannot read catalogues yet.
 *
 * Empty means "this deployment cannot read a website at all", and the caller
 * reports that state instead of running: an unverified actor id is worse than a
 * missing feature, because a run that returns nothing is still charged.
 */
export function siteActorId(): string {
  return getEnv(SITE_ACTOR_ENV_KEYS[0]) || getEnv(SITE_ACTOR_ENV_KEYS[1]) || "";
}

/**
 * A message naming the variable that switches the site read on.
 *
 * It names the catalogue slot first and says plainly what the other one is, rather
 * than offering `APIFY_CONTACTS_ACTOR_ID` as an alternative. Offering it would be
 * advice that cannot work — it returns no products — and whoever reads this message
 * is usually someone looking at an empty catalogue with no error explaining it,
 * which is the state this hint exists to name.
 */
export function siteActorHint(): string {
  return (
    `Set ${SITE_ACTOR_ENV_KEYS[0]} to a product-catalogue actor that returns ` +
    `product rows or schema.org JSON-LD. ${SITE_ACTOR_ENV_KEYS[1]} is the crawler ` +
    `behind competitor discovery and reads contact details only, so it cannot fill ` +
    `a catalogue.`
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
/**
 * Defaults, sized against what a read actually costs rather than what it could
 * usefully see.
 *
 * The actor bills **per product returned**, so `maxItems` is the price of a read,
 * not just its breadth. At 200 items a single Cotopaxi read cost **$1.00** — its
 * own `maxTotalChargeUsd` ceiling, hit exactly — and four of them in one day spent
 * the whole $5 monthly allowance, after which Apify refused *every* run on the
 * account and six separate panels (competitor inventory, social, traffic,
 * advertising) looked independently broken. Sixty items is about
 * $0.30, and only a source that publishes a readable catalogue pays anything at
 * all: of twelve watched sources, one does.
 *
 * The trade is honest: a catalogue longer than the cap is read from the top, so a
 * change below the cut is missed until something above it moves. That is the right
 * way round for a change feed — the newest listings are what "what changed on their
 * site" is for — but it is a ceiling someone can raise deliberately.
 */
export function siteCaps(): SiteCaps {
  return {
    maxPages: Math.round(positiveEnv("APIFY_SITE_MAX_PAGES", 25)),
    maxChargeUsd: positiveEnv("APIFY_SITE_MAX_CHARGE_USD", 0.3),
    timeoutSecs: Math.round(positiveEnv("APIFY_SITE_RUN_TIMEOUT_SECS", 120)),
    maxItems: Math.round(positiveEnv("APIFY_SITE_MAX_ITEMS", 60)),
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
 * Two actor contracts sit behind the one configured id — a product-catalogue
 * actor in the `APIFY_SITE_ACTOR_ID` slot, or the generic website crawler the
 * deployment already runs — so the input carries both sets of keys and each actor
 * ignores the ones it does not know. An unrecognised key is silently dropped,
 * which is a run that costs money and stops nowhere.
 *
 * `discoverProducts` is what makes this a *catalogue* read instead of a one-page
 * read: it tells a product actor to treat the start URL as a storefront and find
 * its product pages from robots.txt and the sitemaps it declares. `maxProducts`
 * is how many it may fetch. Omitting `discoverProducts` is not a harmless
 * narrowing — the actor then reads the home page as though it *were* a product
 * page and returns its `<title>` as the product name. `normaliseProduct` accepts
 * that, because all it requires is a name, so the junk would be stored and then
 * re-reported as a new product on every scan.
 *
 * The page ceiling is expressed three ways (`maxCrawlPages`, `maxRequests`,
 * `maxRequestsPerStartUrl`) and the depth two (`maxCrawlDepth`, `maxDepth`)
 * because actors disagree on the name. `sameDomain` keeps a site's links to its
 * own social sites from being crawled as catalogue pages.
 *
 * Product *detail* pages are the point in both contracts, so the crawl follows
 * links rather than stopping at the home page.
 *
 * A service or pricing page is reached by this same crawl, not a second one: the
 * depth limit lets the walk follow a home page's `/services` and `/pricing` links,
 * `sameDomain` keeps it on the site, and whatever those pages publish — `Service`
 * rows or an `OfferCatalog` of plans — is read by the normalising below.
 */
export function siteInputFor(url: string, caps: SiteCaps): Record<string, unknown> {
  return {
    startUrls: [{ url }],
    // The catalogue actor: crawl the storefront, not the page we were handed.
    discoverProducts: true,
    maxProducts: caps.maxItems,
    // The actor's own quality gate, as a percentage of seven scored fields (name,
    // brand, identifier, price, currency, availability, image). Rows below it are
    // dropped by the actor and never charged for.
    //
    // It is not optional. A storefront's sitemap also lists blog posts and category
    // pages, and the actor will happily return their OpenGraph title as the product
    // *name* — measured from arcteryx.com and thenorthface.com at 29% complete, e.g.
    // "Men's Outdoor Gifts Under $100 | Arc'teryx" and "10 of the best European
    // skiing destination". `normaliseProduct` requires only a name and a price it
    // reads as 0 when it cannot parse one, so without this gate those would be
    // stored as products, double-counted in every localisation of the page, and
    // re-reported as new products on every scan. 50 is the actor's own suggested
    // default; genuine product rows from cotopaxi.com and sephora.com scored 100%.
    minCompleteness: 50,
    // The generic crawler: the same reach, under the names it uses.
    maxCrawlPages: caps.maxPages,
    maxCrawlDepth: 2,
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

/** What a watched site published one catalogue row as. */
export type ItemKind = "product" | "service" | "price_plan";

const ITEM_KINDS: ItemKind[] = ["product", "service", "price_plan"];

/** One thing the site publishes, on our own columns. */
export interface ScrapedProduct {
  /** Stable identity for change detection: the SKU when the page gives one. */
  key: string;
  /**
   * What the site published this as. Shown as a label on both catalogues; it never
   * takes part in identity, so a page that relabels a plan does not read as a new
   * product.
   */
  kind: ItemKind;
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
 * `18,40` on a European page is eighteen-forty — reading it as 1840
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
 * What a settled catalogue read writes back to its competitor row.
 *
 * This update is the only thing that clears `site_run_id`, records the run in
 * `scan_runs` and logs the cost, and it runs *after* the items are written, so it
 * must name only columns `competitors` actually has — PostgREST rejects the whole
 * update otherwise.
 */
export function sourceSettlement(input: {
  /** True when the read produced something usable; a failed read moves no dates. */
  ok: boolean;
  /** When the read settled. */
  collectedAt: string;
  /** The failure to record, already worded and truncated by the caller. */
  error?: string;
}): Record<string, unknown> {
  return {
    site_run_id: null,
    site_scan_at: input.collectedAt,
    site_error: input.ok ? null : (input.error ?? null),
    // `last_scan_at` moves only on a read that produced something, so a failed
    // scan cannot make the page claim a fresh scan; `site_scan_at` records the
    // attempt either way.
    ...(input.ok ? { last_scan_at: input.collectedAt } : {}),
  };
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
/**
 * HTML entities back to characters.
 *
 * Storefronts publish names with the entities their templates emit, and the actor
 * hands them on untouched: a live Cotopaxi read stored "Do Good T-Shirt - Men&#39;s".
 * The page then shows the entity, and — worse — a name carrying it does not match
 * the same product's plain spelling, so a real change can read as a new product.
 * Only the handful of entities a product name actually uses are handled; an unknown
 * one is left alone rather than guessed at.
 */
export function decodeEntities(value: string): string {
  return String(value ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|#39|#8217|#8216|#8220|#8221|aacute|eacute|iacute|oacute|uacute|ntilde|uuml|ouml|auml|ccedil);/g,
      (match, name: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
          "#39": "'",
          "#8217": "’",
          "#8216": "‘",
          "#8220": "“",
          "#8221": "”",
          // The few accented letters a product name actually reaches for — "Del
          // Día" is on a real Cotopaxi listing, and its accented and entity
          // spellings have to reduce to the same key or the same product reads as
          // two.
          aacute: "á",
          eacute: "é",
          iacute: "í",
          oacute: "ó",
          uacute: "ú",
          ntilde: "ñ",
          uuml: "ü",
          ouml: "ö",
          auml: "ä",
          ccedil: "ç",
        };
        return named[name] ?? match;
      },
    );
}

/**
 * What one scraped row is: a product, a service, or a price plan.
 *
 * The page's own structured data is read first, because it is explicit when it is
 * published, and the URL second, because a crawler that returns no structured data
 * still returns *where the page lives* — and a site's `/pricing` and `/services`
 * pages are exactly the ones that carry plans and services. Anything unlabelled is
 * a product, which is what a plain catalogue row is.
 */
function kindOf(raw: Record<string, unknown>): ItemKind {
  const type = firstString(raw["@type"]).toLowerCase().replace(/\s+/g, "");
  if (type === "service") return "service";
  // A bare Offer reached outside a product is a plan: inside a product it is that
  // product's price, and the walk in `productsFromJson` never surfaces those.
  if (type === "offer" || type === "aggregateoffer") return "price_plan";

  // A recurring price is a plan whether or not the page says the word: a billing
  // period, a tier name, or a `priceSpecification` that repeats.
  if (raw.recurring === true) return "price_plan";
  if (
    firstString(
      raw.billingPeriod,
      raw.billingCycle,
      raw.billingDuration,
      raw.planName,
      raw.tier,
      raw.plan,
      raw.recurring,
      raw.pricePlan,
    )
  ) {
    return "price_plan";
  }
  const spec = raw.priceSpecification;
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const record = spec as Record<string, unknown>;
    if (
      firstString(
        record.billingDuration,
        record.billingIncrement,
        record.billingPeriod,
        record.recurring,
      )
    ) {
      return "price_plan";
    }
  }

  const path = firstString(raw.url, raw.link, raw.productUrl, raw.detailUrl, raw["@id"]);
  if (path) {
    if (/\/(pricing|plans?|price-plans|packages|subscriptions?|tiers?)(\/|$|\?)/i.test(path)) {
      return "price_plan";
    }
    if (/\/(services?|solutions|what-we-do|what-we-offer|capabilities)(\/|$|\?)/i.test(path)) {
      return "service";
    }
  }
  return "product";
}

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
    kind: kindOf(raw),
    product: decodeEntities(product).slice(0, 300),
    sku: sku.slice(0, 120),
    category: firstString(raw.category, raw.productType, raw.categoryName).slice(0, 120),
    price,
    stock,
    url,
  };
}

/**
 * The schema.org types that describe something a business sells or renders.
 *
 * `Product` is the shopfront's shelf; `Service` is what a business that renders a
 * service publishes instead; and a bare `Offer`/`AggregateOffer` reached outside a
 * product is how a pricing page publishes its plans. An `Offer` nested *inside* a
 * product is that product's price rather than a separate row — the walk below
 * returns as soon as it takes a `Product`, so it never descends into one and never
 * double-counts the same price as both a product and a plan.
 */
const SELLABLE_TYPES = new Set(["product", "service", "offer", "aggregateoffer"]);

/**
 * schema.org products, services and price plans out of a JSON string — a page's
 * embedded JSON-LD, or an actor field that carries the structured data through.
 *
 * Deliberately tolerant: a block may be a single object, an array, or wrapped in
 * `@graph`, and the sellable node may be nested inside an `ItemList` or an
 * `OfferCatalog` (how category and pricing pages publish it). Anything unparseable
 * is skipped rather than thrown, because one malformed block on a page must not
 * lose the rest of the catalogue.
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
    const type = firstString(record["@type"]).toLowerCase().replace(/\s+/g, "");
    if (SELLABLE_TYPES.has(type)) {
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
      if (typeof value !== "string") continue;
      // A page that publishes only a Service or an OfferCatalog of plans contains
      // neither the word "Product" — matching on it alone skipped those pages
      // before they were ever parsed.
      if (!/(Product|Service|Offer)/.test(value)) continue;
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

/** An item kind that is safe to write to the `item_kind` enum. */
export function safeItemKind(value: string): ItemKind {
  return (ITEM_KINDS as string[]).includes(value) ? (value as ItemKind) : "product";
}
