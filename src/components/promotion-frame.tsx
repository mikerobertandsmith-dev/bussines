import type { InventoryItem, PromotionComponent, PromotionTemplate } from "../lib/types";
import { money } from "../lib/format";

/** Display size of each ad template. Export scales these up to the real sizes. */
export const TEMPLATE_SIZES: Record<
  PromotionTemplate,
  { width: number; height: number; label: string; hint: string }
> = {
  square: { width: 360, height: 360, label: "Square", hint: "1080 × 1080 · feed post" },
  story: { width: 252, height: 448, label: "Story", hint: "1080 × 1920 · stories & reels" },
  landscape: { width: 400, height: 209, label: "Landscape", hint: "1200 × 628 · link ad" },
};

export interface AdFrameDesign {
  headline: string;
  subheadline: string;
  dealText: string;
  ctaText: string;
  discountPct: number;
  /** Overrides the computed percentage badge, e.g. "$10 OFF" for an amount. */
  discountLabel?: string;
  couponCode: string;
  accentColor: string;
  components: PromotionComponent[];
  template: PromotionTemplate;
}

export function AdFrame({
  design,
  item,
  priceItem,
  brand,
  logoUrl,
  contact,
  rating,
  reviewCount,
}: {
  design: AdFrameDesign;
  /** The product or service the design is built around. */
  item: InventoryItem | null;
  /** The product or service the shown price refers to. */
  priceItem: InventoryItem | null;
  brand: string;
  logoUrl: string;
  contact: string;
  rating: number;
  reviewCount: number;
}) {
  const on = (c: PromotionComponent) => design.components.includes(c);
  const size = TEMPLATE_SIZES[design.template];
  const accent = design.accentColor || "#4f46e5";
  const showOffer = on("product") || on("service");
  const priced = on("price") ? priceItem : null;

  const derivedDiscount =
    priced && priced.compareAtPrice > priced.price && priced.price > 0
      ? Math.round(((priced.compareAtPrice - priced.price) / priced.compareAtPrice) * 100)
      : 0;
  const discount = design.discountPct > 0 ? Math.round(design.discountPct) : derivedDiscount;
  const discountLabel = design.discountLabel?.trim() || (discount > 0 ? `${discount}% OFF` : "");

  const wide = design.template === "landscape";
  const story = design.template === "story";

  return (
    <div
      data-ad-frame
      style={{ width: size.width, height: size.height, background: "#ffffff" }}
      className="relative flex flex-col overflow-hidden"
    >
      {/* Accent header band */}
      <div
        style={{
          background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 100%)`,
          padding: wide ? "10px 14px" : "12px 14px",
        }}
        className="flex items-center justify-between gap-2 text-white"
      >
        <div className="flex min-w-0 items-center gap-2">
          {on("logo") ? (
            logoUrl ? (
              <img
                src={logoUrl}
                alt=""
                style={{ height: 24, width: 24 }}
                className="shrink-0 rounded-md bg-white/90 object-cover"
              />
            ) : (
              <span
                style={{ height: 24, width: 24, fontSize: 11 }}
                className="flex shrink-0 items-center justify-center rounded-md bg-white/25 font-semibold"
              >
                {brand
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("") || "AD"}
              </span>
            )
          ) : null}
          <span className="truncate text-[12px] font-semibold tracking-tight">{brand}</span>
        </div>
        {on("discount") && discountLabel ? (
          <span
            style={{ background: "#ffffff", color: accent }}
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
          >
            {discountLabel}
          </span>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
        {showOffer && item ? (
          <div
            className="relative mb-2 w-full overflow-hidden rounded-lg bg-slate-100"
            style={{ height: wide ? 84 : story ? 176 : 132 }}
          >
            {item.imageUrl ? (
              <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-slate-400">
                Add an image in Inventory &amp; services
              </div>
            )}
          </div>
        ) : null}

        <p
          style={{ fontSize: wide ? 18 : 16, lineHeight: 1.15 }}
          className="font-bold tracking-tight text-slate-900"
        >
          {design.headline || item?.name || "Your offer here"}
        </p>
        {design.subheadline ? (
          <p className="mt-1 text-[11px] leading-snug text-slate-600">{design.subheadline}</p>
        ) : null}

        {(priced && priced.price > 0) || (on("coupon") && design.couponCode) ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {priced && priced.price > 0 ? (
              <>
                <span className="text-[16px] font-bold text-slate-900">{money(priced.price)}</span>
                {priced.compareAtPrice > priced.price ? (
                  <span className="text-[11px] text-slate-400 line-through">
                    {money(priced.compareAtPrice)}
                  </span>
                ) : null}
              </>
            ) : null}
            {on("coupon") && design.couponCode ? (
              <span
                style={{ borderColor: accent, color: accent }}
                className="rounded border border-dashed px-2 py-0.5 text-[11px] font-semibold tracking-wide"
              >
                CODE {design.couponCode}
              </span>
            ) : null}
          </div>
        ) : null}

        {on("deal") && design.dealText ? (
          <div
            style={{ background: `${accent}14`, color: accent }}
            className="mt-2 rounded-md px-2 py-1 text-[11px] font-semibold"
          >
            {design.dealText}
          </div>
        ) : null}

        <div className="mt-auto pt-2">
          {on("rating") && rating > 0 ? (
            <p className="mb-1.5 text-[11px] font-medium text-amber-600">
              ★★★★★ {rating.toFixed(1)}
              <span className="ml-1 font-normal text-slate-500">
                from {reviewCount.toLocaleString()} reviews
              </span>
            </p>
          ) : null}

          {design.ctaText ? (
            <span
              style={{ background: accent }}
              className="inline-block rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white"
            >
              {design.ctaText}
            </span>
          ) : null}

          {on("contact") && contact ? (
            <p className="mt-1.5 truncate text-[10px] text-slate-500">{contact}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
