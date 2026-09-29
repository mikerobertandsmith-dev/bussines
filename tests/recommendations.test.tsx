import { describe, expect, it } from "vitest";

import {
  deriveRecommendations,
  matchingKeyword,
  nameWords,
  productKey,
  type RecommendationSource,
} from "../supabase/functions/_shared/recommendations.ts";

/** The product names below are real ones a live Cotopaxi read stored. */
const listed = (over: Partial<RecommendationSource> = {}): RecommendationSource => ({
  competitor: "Cotopaxi",
  product: "Alto Beanie",
  price: 17.5,
  detectedAt: "2026-09-29T08:15:00.000Z",
  url: "https://www.cotopaxi.com/products/alto-beanie",
  ...over,
});

const NOW = Date.parse("2026-09-29T09:00:00.000Z");

describe("nameWords / productKey", () => {
  it("decodes the entities a storefront template emits", () => {
    // This exact spelling arrived from a live read; left encoded, it neither
    // displays as a name nor matches the plain spelling of the same product.
    expect(nameWords("Do Good T-Shirt - Men&#39;s")).toEqual([
      "do",
      "good",
      "t",
      "shirt",
      "men",
      "s",
    ]);
    expect(productKey("Do Good T-Shirt - Men&#39;s")).toBe("do good t shirt men s");
  });

  it("reduces an accented name and its entity spelling to one key", () => {
    // "Del Día" is on a real Cotopaxi listing. If the two spellings keyed
    // differently, the same product would read as two — and as a new product
    // every scan.
    expect(productKey("Batac 16L Daypack - Del Día")).toBe(
      productKey("batac 16L daypack del D&iacute;a"),
    );
    expect(productKey("Batac 16L Daypack - Del Día")).toBe("batac 16l daypack del d a");
  });
});

describe("matchingKeyword", () => {
  const keywords = [
    { keyword: "fleece jacket", volume: 2400 },
    { keyword: "jacket", volume: 90000 },
    { keyword: "hiking backpack", volume: 5400 },
  ];

  it("needs every meaningful word of the term, not just one", () => {
    // "jacket" alone is one shared word, and claiming its 90k volume would make
    // every jacket on a rival's shelf look like a 90,000-search opportunity.
    expect(matchingKeyword(nameWords("Fleece Jacket - Men's"), keywords)?.keyword).toBe("fleece jacket");
    expect(matchingKeyword(nameWords("Rain Shell Jacket"), keywords)).toBeNull();
  });

  it("ignores a term too generic to be evidence", () => {
    expect(matchingKeyword(nameWords("Jacket"), keywords)).toBeNull();
  });
});

describe("deriveRecommendations", () => {
  it("names the rival the suggestion came from, and the signals behind it", () => {
    const [suggestion] = deriveRecommendations({
      items: [listed()],
      keywords: [],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });

    expect(suggestion.product).toBe("Alto Beanie");
    expect(suggestion.competitorRef).toBe("Cotopaxi");
    expect(suggestion.estimatedPrice).toBe(17.5);
    // A single rival listing one item is weak evidence, so it is never "high".
    expect(suggestion.priority).toBe("medium");
    expect(suggestion.reason).toContain("Cotopaxi listed it");
    expect(suggestion.reason).toContain("first seen 29 Sep");
  });

  it("rates a product two rivals both listed as high, which is the market signal", () => {
    const [suggestion] = deriveRecommendations({
      items: [
        listed({ product: "Batac 16L Daypack", competitor: "Cotopaxi" }),
        listed({ product: "Batac 16L Daypack", competitor: "Marmot" }),
      ],
      keywords: [],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });

    expect(suggestion.priority).toBe("high");
    expect(suggestion.reason).toContain("2 rivals stock it");
  });

  it("carries the tracked term's volume across, and says which term it answered", () => {
    const [suggestion] = deriveRecommendations({
      items: [listed({ product: "Fleece Jacket - Men's" })],
      keywords: [{ keyword: "fleece jacket", volume: 2400 }],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });

    expect(suggestion.priority).toBe("high");
    expect(suggestion.trafficPotential).toBe(2400);
    expect(suggestion.reason).toContain('"fleece jacket"');
  });

  it("leaves a price it does not have as null rather than as zero", () => {
    const [suggestion] = deriveRecommendations({
      items: [listed({ price: 0 })],
      keywords: [],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });
    expect(suggestion.estimatedPrice).toBeNull();
  });

  it("drops a gift card, which a storefront catalogues like a product", () => {
    const suggestions = deriveRecommendations({
      items: [
        listed({ product: "Digital Gift Card" }),
        listed({ product: "e-Gift Certificate", competitor: "Marmot" }),
        listed({ product: "Alto Beanie" }),
      ],
      keywords: [],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });
    expect(suggestions.map((s) => s.product)).toEqual(["Alto Beanie"]);
  });

  it("suggests nothing already on file, so a decision is never rewritten", () => {
    const suggestions = deriveRecommendations({
      items: [listed()],
      keywords: [],
      existing: new Set([productKey("Alto Beanie")]),
      limit: 10,
      now: NOW,
    });
    expect(suggestions).toEqual([]);
  });

  it("de-duplicates the same product listed once per rival when only one is needed", () => {
    const suggestions = deriveRecommendations({
      items: [listed(), listed({ competitor: "Marmot" }), listed({ competitor: "prAna" })],
      keywords: [],
      existing: new Set(),
      limit: 10,
      now: NOW,
    });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].reason).toContain("3 rivals stock it");
  });

  it("orders the strongest evidence first and honours the limit", () => {
    const suggestions = deriveRecommendations({
      items: [
        listed({ product: "Alto Beanie", detectedAt: "2026-01-01T00:00:00.000Z" }),
        listed({ product: "Fleece Jacket - Men's" }),
        listed({ product: "Batac 16L Daypack", competitor: "Marmot" }),
        listed({ product: "Batac 16L Daypack", competitor: "Cotopaxi" }),
      ],
      keywords: [{ keyword: "fleece jacket", volume: 2400 }],
      existing: new Set(),
      limit: 2,
      now: NOW,
    });

    // The keyword match and the two-rival product outrank the lone stale listing.
    expect(suggestions.map((s) => s.product)).toEqual(["Fleece Jacket - Men's", "Batac 16L Daypack"]);
  });
});
