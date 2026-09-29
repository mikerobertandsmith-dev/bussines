import { afterEach, describe, expect, it, vi } from "vitest";
import {
  catalogueKey,
  catalogueUrl,
  jsonLdBlocks,
  nextScanAt,
  normaliseCatalogue,
  normaliseProduct,
  parsePrice,
  siteActorHint,
  siteActorId,
  siteCaps,
  stockStateOf,
} from "../supabase/functions/_shared/site";

/**
 * `_shared/site.ts` reads its configuration through `Deno.env`, which the browser
 * test runner does not have. A minimal double is enough: the module only touches
 * it inside function calls.
 */
const denoEnv = new Map<string, string>();
vi.stubGlobal("Deno", { env: { get: (name: string) => denoEnv.get(name) } });
afterEach(() => denoEnv.clear());

describe("site price parsing", () => {
  it("reads the separators a real supplier page writes", () => {
    expect(parsePrice("18.40")).toBe(18.4);
    expect(parsePrice("$18.40")).toBe(18.4);
    expect(parsePrice("£1,299.00")).toBe(1299);
    // A decimal comma is a decimal separator, not a thousands one: reading 18,40
    // as 1840 would turn a real price move into an absurd one.
    expect(parsePrice("18,40")).toBe(18.4);
    expect(parsePrice("€1.299,00")).toBe(1299);
    expect(parsePrice(12.345)).toBe(12.35);
  });

  it("answers 0 rather than NaN for something with no number in it", () => {
    expect(parsePrice("")).toBe(0);
    expect(parsePrice("ask for price")).toBe(0);
    expect(parsePrice(null)).toBe(0);
  });
});

describe("site stock state", () => {
  it("reads out-of-stock before in-stock, because one contains the other", () => {
    // schema.org's OutOfStock value contains InStock as a substring: a check in
    // the wrong order reports every sold-out product as available.
    expect(stockStateOf("https://schema.org/OutOfStock")).toBe("out_of_stock");
    expect(stockStateOf("OutOfStock")).toBe("out_of_stock");
    expect(stockStateOf("SoldOut")).toBe("out_of_stock");
    expect(stockStateOf("https://schema.org/InStock")).toBe("in_stock");
    expect(stockStateOf("Available")).toBe("in_stock");
    expect(stockStateOf("preorder")).toBe("preorder");
    expect(stockStateOf("Only a few left")).toBe("low_stock");
  });

  it("reads a boolean flag, and falls back when the page says nothing", () => {
    expect(stockStateOf(true)).toBe("in_stock");
    expect(stockStateOf(false)).toBe("out_of_stock");
    expect(stockStateOf("")).toBe("in_stock");
    expect(stockStateOf("", "preorder")).toBe("preorder");
  });
});

describe("site catalogue identity", () => {
  it("keys on the SKU when the page publishes one, the name otherwise", () => {
    expect(catalogueKey("LUM-CB-0033", "Cloud Blush")).toBe("sku:lum-cb-0033");
    expect(catalogueKey("", "Cloud  Blush Trio ")).toBe("name:cloud blush trio");
    expect(catalogueKey("", "Cloud Blush Trio")).toBe(catalogueKey("", " cloud blush trio"));
  });
});

describe("site product normalising", () => {
  it("reads a flat product row", () => {
    const product = normaliseProduct({
      name: "Glass Skin Toner 200ml",
      sku: "GM-GST-200",
      category: "Skincare",
      price: "$19.90",
      availability: "InStock",
      url: "https://glowmartbeauty.com/products/glass-skin-toner",
    });

    expect(product).toMatchObject({
      key: "sku:gm-gst-200",
      product: "Glass Skin Toner 200ml",
      sku: "GM-GST-200",
      category: "Skincare",
      price: 19.9,
      stock: "in_stock",
      url: "https://glowmartbeauty.com/products/glass-skin-toner",
    });
  });

  it("takes the cheapest offer when a product lists several", () => {
    const product = normaliseProduct({
      name: "Ribbed Knit Cardigan",
      offers: [
        { price: "41.00", availability: "InStock" },
        { price: "36.00", availability: "OutOfStock" },
      ],
    });

    expect(product?.price).toBe(36);
    expect(product?.stock).toBe("out_of_stock");
  });

  it("drops a row with no name rather than storing an unnamed product", () => {
    expect(normaliseProduct({ price: "9.99" })).toBeNull();
  });

  it("never uses the actor's own row id as the identity", () => {
    // A row id changes between runs; keying on it would report the whole
    // catalogue as new products on every scan.
    const product = normaliseProduct({ id: "batch-1-item-7", name: "Volt 45W Charger" });
    expect(product?.key).toBe("name:volt 45w charger");
  });
});

describe("site catalogue assembly", () => {
  it("reads products nested under a listing item, and folds duplicates", () => {
    const items = [
      {
        url: "https://shop.example/collections/all",
        products: [
          { name: "PulseBuds Lite", sku: "TW-PBL-01", price: 34, availability: "InStock" },
          { name: "Volt 45W Charger", sku: "TW-V45-01", price: 12, availability: "InStock" },
        ],
      },
      // The same charger on its own detail page, at the price the site now shows:
      // the later entry wins, so the catalogue holds one row rather than two.
      { name: "Volt 45W Charger", sku: "TW-V45-01", price: 9.5, availability: "InStock" },
    ];

    const catalogue = normaliseCatalogue(items, 200);

    expect(catalogue.map((c) => `${c.sku}:${c.price}`)).toEqual(["TW-PBL-01:34", "TW-V45-01:9.5"]);
  });

  it("reads schema.org JSON-LD out of a crawled page and out of a JSON field", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[{"@type":"ItemList","itemListElement":[
        {"@type":"Product","name":"Mini Crossbody Bag","sku":"SL-MCB-01",
         "offers":{"@type":"Offer","price":"28.90","availability":"https://schema.org/InStock"}}]}]}
      </script></head></html>`;

    const fromHtml = normaliseCatalogue([{ url: "https://stitchline.example", html }], 200);
    expect(fromHtml).toHaveLength(1);
    expect(fromHtml[0]).toMatchObject({ sku: "SL-MCB-01", price: 28.9, stock: "in_stock" });

    const fromJson = normaliseCatalogue(
      [
        {
          structuredData: JSON.stringify({
            "@type": "Product",
            name: "Mini Crossbody Bag",
            sku: "SL-MCB-01",
            offers: { price: "28.90", availability: "InStock" },
          }),
        },
      ],
      200,
    );
    expect(fromJson).toHaveLength(1);
    expect(fromJson[0].key).toBe("sku:sl-mcb-01");
  });

  it("skips one malformed JSON-LD block instead of losing the page", () => {
    const html =
      `<script type="application/ld+json">{ "broken" </script>` +
      `<script type="application/ld+json">{"@type":"Product","name":"Volt 45W Charger","offers":{"price":"9.50"}}</script>`;

    expect(jsonLdBlocks(html)).toHaveLength(2);
    const catalogue = normaliseCatalogue([{ html }], 200);
    expect(catalogue.map((c) => c.product)).toEqual(["Volt 45W Charger"]);
  });

  it("honours the item ceiling", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ name: `Product ${i}`, price: 1 }));
    expect(normaliseCatalogue(items, 3)).toHaveLength(3);
  });
});

describe("site actor configuration", () => {
  it("reads the website actor already configured, and prefers its own slot when set", () => {
    // No website reader on the deployment at all: reported as unconfigured rather
    // than guessed at, and the hint names what would switch it on.
    expect(siteActorId()).toBe("");
    expect(siteActorHint()).toContain("APIFY_SITE_ACTOR_ID");
    expect(siteActorHint()).toContain("APIFY_CONTACTS_ACTOR_ID");

    // The crawler the deployment already has is enough to read a supplier's or a
    // competitor's site — no secret of its own is required.
    denoEnv.set("APIFY_CONTACTS_ACTOR_ID", "9Sk4JJhEma9vBKqrg");
    expect(siteActorId()).toBe("9Sk4JJhEma9vBKqrg");

    // A catalogue-specific actor takes over when one is configured, for both
    // pages: the choice is per deployment, not per target.
    denoEnv.set("APIFY_SITE_ACTOR_ID", "owner~catalogue-actor");
    expect(siteActorId()).toBe("owner~catalogue-actor");
  });

  it("caps a read, with defaults that a deployment can override", () => {
    expect(siteCaps()).toEqual({
      maxPages: 25,
      maxChargeUsd: 1,
      timeoutSecs: 120,
      maxItems: 200,
    });

    denoEnv.set("APIFY_SITE_MAX_PAGES", "50");
    denoEnv.set("APIFY_SITE_MAX_CHARGE_USD", "2.5");
    denoEnv.set("APIFY_SITE_MAX_ITEMS", "0");
    const caps = siteCaps();
    expect(caps.maxPages).toBe(50);
    expect(caps.maxChargeUsd).toBe(2.5);
    // A non-positive ceiling is not a ceiling, so the default stands rather than
    // reading as "keep nothing".
    expect(caps.maxItems).toBe(200);
  });

  it("reduces a stored website to the origin a crawler can start from", () => {
    expect(catalogueUrl("supply.lumierecosmetics.com")).toBe("https://supply.lumierecosmetics.com");
    expect(catalogueUrl("https://vantagephones.com/wholesale?page=2")).toBe(
      "https://vantagephones.com",
    );
    expect(catalogueUrl("  ")).toBe("");
    // A scheme we cannot crawl is refused rather than coerced into a web address.
    expect(catalogueUrl("ftp://files.example.com/catalogue")).toBe("");
    expect(catalogueUrl("https://")).toBe("");
  });
});

describe("site scan scheduling", () => {
  it("moves the next due date by the source's cadence", () => {
    const from = new Date("2026-01-31T00:00:00.000Z");
    expect(nextScanAt("daily", from).slice(0, 10)).toBe("2026-02-01");
    expect(nextScanAt("weekly", from).slice(0, 10)).toBe("2026-02-07");
    expect(nextScanAt("monthly", from).slice(0, 10)).toBe("2026-03-02");
  });
});
