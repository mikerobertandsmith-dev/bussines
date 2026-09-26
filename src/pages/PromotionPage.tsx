import { useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import {
  Check,
  Clock,
  Download,
  FileCheck2,
  Gift,
  Globe,
  History,
  ImageDown,
  LayoutTemplate,
  ListChecks,
  Megaphone,
  Package,
  Percent,
  Plus,
  Send,
  Sparkles,
  Star,
  Store,
  Tag,
  Ticket,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Field,
  Segmented,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { AdFrame, TEMPLATE_SIZES, type AdFrameDesign } from "../components/promotion-frame";
import { useToast } from "../components/Toast";
import { money, relativeTime } from "../lib/format";
import { useWorkspace, useWorkspaceData, type PromotionBriefInput } from "../lib/workspace";
import type {
  DeliveredAd,
  PromotionBrief,
  PromotionBriefStatus,
  PromotionComponent,
  PromotionTemplate,
} from "../lib/types";

const COMPONENT_OPTIONS: {
  value: PromotionComponent;
  label: string;
  hint: string;
  Icon: LucideIcon;
}[] = [
  { value: "logo", label: "My logo", hint: "Brand mark and name in the header", Icon: Store },
  { value: "product", label: "Inventory product", hint: "The item image and name", Icon: Package },
  { value: "service", label: "Service", hint: "One of your bookable services", Icon: Wrench },
  { value: "price", label: "Price", hint: "Selling price and the original price", Icon: Tag },
  { value: "discount", label: "Discount", hint: "A percentage or money amount off", Icon: Percent },
  { value: "deal", label: "Deal", hint: "Your deal line, e.g. buy 2 get 1 free", Icon: Gift },
  { value: "coupon", label: "Coupon", hint: "A redeemable code", Icon: Ticket },
  { value: "contact", label: "Contact", hint: "Website or email at the bottom", Icon: Globe },
  { value: "rating", label: "Review rating", hint: "Your tracked average rating", Icon: Star },
];

/* Brand colours for the social marks used in the placement chips. */
const INSTAGRAM_COLOR = "linear-gradient(45deg, #f09433 0%, #dc2743 50%, #bc1888 100%)";
const FACEBOOK_COLOR = "#1877f2";
const LINKEDIN_COLOR = "#0a66c2";
const TIKTOK_COLOR = "#010101";
const X_COLOR = "#0f172a";

/** Social placements each ad ratio can be pasted into, per frame resolution. */
const TEMPLATE_PLATFORMS: Record<
  PromotionTemplate,
  { name: string; icon: string; color: string; ratio: string }[]
> = {
  square: [
    { name: "Instagram feed", icon: "/icons/instagram.svg", color: INSTAGRAM_COLOR, ratio: "1:1" },
    { name: "Facebook feed", icon: "/icons/facebook.svg", color: FACEBOOK_COLOR, ratio: "1:1" },
    { name: "LinkedIn feed", icon: "/icons/linkedin.svg", color: LINKEDIN_COLOR, ratio: "1:1" },
  ],
  story: [
    {
      name: "Instagram Stories",
      icon: "/icons/instagram.svg",
      color: INSTAGRAM_COLOR,
      ratio: "9:16",
    },
    { name: "TikTok", icon: "/icons/tiktok.svg", color: TIKTOK_COLOR, ratio: "9:16" },
    { name: "X video", icon: "/icons/x.svg", color: X_COLOR, ratio: "9:16" },
  ],
  landscape: [
    {
      name: "Facebook link",
      icon: "/icons/facebook.svg",
      color: FACEBOOK_COLOR,
      ratio: "1.91:1",
    },
    { name: "X post", icon: "/icons/x.svg", color: X_COLOR, ratio: "16:9" },
    { name: "LinkedIn feed", icon: "/icons/linkedin.svg", color: LINKEDIN_COLOR, ratio: "1.91:1" },
  ],
};

/** The social placements for a format, shown with their brand-coloured marks. */
function PlatformChips({
  template,
  className = "",
  labels = true,
}: {
  template: PromotionTemplate;
  className?: string;
  /** When false, only the brand marks are shown. */
  labels?: boolean;
}) {
  const mark = (icon: string, color: string) => (
    <span
      style={{ background: color }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
    >
      <img
        src={icon}
        alt=""
        className="h-3 w-3"
        style={{ filter: "brightness(0) invert(1)" }}
      />
    </span>
  );

  return (
    <div className={`flex flex-wrap items-center justify-center gap-2 ${className}`}>
      {labels
        ? TEMPLATE_PLATFORMS[template].map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pr-2.5 pl-1 text-[11px] text-slate-600"
            >
              {mark(p.icon, p.color)}
              {p.name}
              <span className="font-medium text-slate-400">{p.ratio}</span>
            </span>
          ))
        : TEMPLATE_PLATFORMS[template].map((p) => (
            <span key={p.name} title={p.name}>
              {mark(p.icon, p.color)}
            </span>
          ))}
    </div>
  );
}

const STATUS_META: Record<
  PromotionBriefStatus,
  { label: string; tone: "info" | "warn" | "good"; hint: string }
> = {
  submitted: { label: "Submitted", tone: "info", hint: "Waiting for the design team to pick it up" },
  in_design: { label: "In design", tone: "warn", hint: "We are designing this one now" },
  delivered: { label: "Delivered", tone: "good", hint: "Your finished design is ready to export" },
};

const BLANK: PromotionBriefInput & { id?: string } = {
  name: "Untitled ad brief",
  itemId: null,
  serviceId: null,
  priceItemId: null,
  contactInfo: "",
  template: "square",
  accentColor: "#4f46e5",
  components: ["logo", "product", "price", "contact"],
  discountKind: "percent",
  discountValue: 10,
  dealText: "",
  couponCode: "",
  headline: "",
  notes: "",
  status: "submitted",
};

function fromBrief(b: PromotionBrief): PromotionBriefInput & { id: string } {
  return {
    id: b.id,
    name: b.name,
    itemId: b.itemId,
    serviceId: b.serviceId,
    priceItemId: b.priceItemId,
    contactInfo: b.contactInfo,
    template: b.template,
    accentColor: b.accentColor,
    components: b.components,
    discountKind: b.discountKind,
    discountValue: b.discountValue,
    dealText: b.dealText,
    couponCode: b.couponCode,
    headline: b.headline,
    notes: b.notes,
    status: b.status,
  };
}

type HistoryEntry =
  | { kind: "brief"; at: string; brief: PromotionBrief }
  | { kind: "ad"; at: string; ad: DeliveredAd };

/** Shown when a component needs catalogue items but there are none to pick from. */
function NoCatalogueItems({ kind }: { kind: "product" | "service" | "any" }) {
  const noun = kind === "product" ? "products" : kind === "service" ? "services" : "items";
  const action =
    kind === "product" ? "Add product" : kind === "service" ? "Add service" : "Add item";
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
      <p className="text-[11px] text-slate-500">No {noun} in your catalogue yet.</p>
      <button
        type="button"
        className={`${btnGhost} px-2.5 py-1.5 text-xs`}
        onClick={() => {
          window.location.hash = "/inventory";
        }}
      >
        <Plus size={13} /> {action}
      </button>
    </div>
  );
}

export function PromotionPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const { profile, inventory, promotionBriefs, deliveredAds } = workspace;

  const [form, setForm] = useState<PromotionBriefInput & { id?: string }>(() =>
    promotionBriefs[0] ? fromBrief(promotionBriefs[0]) : BLANK,
  );
  const [downloading, setDownloading] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const productItem = useMemo(
    () => inventory.find((i) => i.id === form.itemId && i.kind === "product") ?? null,
    [inventory, form.itemId],
  );
  const serviceItem = useMemo(
    () => inventory.find((i) => i.id === form.serviceId && i.kind === "service") ?? null,
    [inventory, form.serviceId],
  );
  const priceItem = useMemo(
    () => inventory.find((i) => i.id === form.priceItemId) ?? null,
    [inventory, form.priceItemId],
  );
  const heroItem = productItem ?? serviceItem;
  const products = useMemo(() => inventory.filter((i) => i.kind === "product"), [inventory]);
  const services = useMemo(() => inventory.filter((i) => i.kind === "service"), [inventory]);

  const reviewCount = workspace.reviewSources.reduce((sum, s) => sum + s.reviews, 0);
  const rating = workspace.latestReviewScan.averageRating;
  const contact = form.contactInfo || profile.primaryDomain || profile.notificationEmail || "";

  const briefName = heroItem?.name ?? "Ad brief";

  const activeBrief = useMemo(
    () => (form.id ? (promotionBriefs.find((b) => b.id === form.id) ?? null) : null),
    [promotionBriefs, form.id],
  );

  /** Finished designs we have pushed back for the brief currently loaded. */
  const deliveredForBrief = useMemo(
    () =>
      deliveredAds
        .filter((a) => a.briefId !== null && a.briefId === form.id)
        .sort((a, b) => new Date(b.deliveredAt).getTime() - new Date(a.deliveredAt).getTime()),
    [deliveredAds, form.id],
  );
  const latestDelivered = deliveredForBrief[0] ?? null;
  const designReady = Boolean(latestDelivered) || activeBrief?.status === "delivered";

  const history = useMemo<HistoryEntry[]>(() => {
    const entries: HistoryEntry[] = [
      ...promotionBriefs.map((brief) => ({ kind: "brief" as const, at: brief.updatedAt, brief })),
      ...deliveredAds.map((ad) => ({ kind: "ad" as const, at: ad.deliveredAt, ad })),
    ];
    return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [promotionBriefs, deliveredAds]);

  const on = (component: PromotionComponent) => form.components.includes(component);

  const design: AdFrameDesign = {
    headline: heroItem?.name ?? "",
    subheadline: "",
    dealText: form.dealText,
    ctaText: "Shop now",
    discountPct: form.discountKind === "percent" ? form.discountValue : 0,
    discountLabel:
      on("discount") && form.discountValue > 0
        ? form.discountKind === "percent"
          ? `${Math.round(form.discountValue)}% OFF`
          : `${money(form.discountValue)} OFF`
        : "",
    couponCode: form.couponCode,
    accentColor: form.accentColor,
    components: form.components,
    template: form.template,
  };

  function set<K extends keyof PromotionBriefInput>(key: K, value: PromotionBriefInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleComponent(component: PromotionComponent) {
    setForm((prev) => ({
      ...prev,
      components: prev.components.includes(component)
        ? prev.components.filter((c) => c !== component)
        : [...prev.components, component],
    }));
  }

  function submit() {
    if (form.components.length === 0) {
      toast("Turn on at least one component for us to include.");
      return;
    }
    if (missingValues.length > 0) {
      toast(`Still needed: ${missingValues.join(", ")}.`);
      return;
    }
    const editing = Boolean(form.id);
    void actions.savePromotionBrief({ ...form, name: briefName, status: "submitted" });
    toast(editing ? "Brief updated and sent back to the design team." : "Brief sent to the design team.");
    if (!editing) setForm({ ...BLANK });
  }

  async function downloadPreview() {
    const node = frameRef.current;
    if (!node) return;
    setDownloading(true);
    try {
      const size = TEMPLATE_SIZES[form.template];
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1080 / size.width });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${briefName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      link.click();
      toast("Ad design downloaded as a PNG.");
    } catch {
      toast("Could not export the image — try again once the images have loaded.");
    } finally {
      setDownloading(false);
    }
  }

  const hasValueComponent =
    on("product") ||
    on("service") ||
    on("price") ||
    on("discount") ||
    on("deal") ||
    on("coupon") ||
    on("contact");

  /** Everything the picked components still need before the brief can be sent. */
  const missingValues: string[] = [];
  if (on("product") && !form.itemId) missingValues.push("pick an inventory product");
  if (on("service") && !form.serviceId) missingValues.push("pick a service");
  if (on("price") && !form.priceItemId)
    missingValues.push("pick which product or service the price is for");
  if (on("discount") && form.discountValue <= 0) missingValues.push("enter a discount value");
  if (on("deal") && !form.dealText.trim()) missingValues.push("enter a deal line");
  if (on("coupon") && !form.couponCode.trim()) missingValues.push("enter a coupon code");
  if (on("contact") && !form.contactInfo.trim()) missingValues.push("enter your contact info");
  // A logo on its own is not a brief — there has to be something else to design with.
  if (form.components.length > 0 && form.components.every((c) => c === "logo"))
    missingValues.push("pick at least one other component besides your logo");

  const canSend = form.components.length > 0 && missingValues.length === 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-5">
        {/* ----------------------------------------------------- the brief */}
        <div className="space-y-5 xl:col-span-3">
          <Card>
            <CardHead
              icon={<Megaphone size={16} />}
              title="Ad components"
              subtitle="Tell us what your ad should include and how it should look"
              action={
                <Badge tone="brand">
                  {form.components.length} component{form.components.length === 1 ? "" : "s"}
                </Badge>
              }
            />
            <div className="space-y-5 px-5 py-5">
              {/* format */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <LayoutTemplate size={17} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Format</p>
                    <p className="text-[11px] text-slate-500">
                      {TEMPLATE_SIZES[form.template].hint}
                    </p>
                  </div>
                </div>

                <PlatformChips template={form.template} className="flex-1" />

                <Segmented
                  value={form.template}
                  onChange={(template) => set("template", template)}
                  options={[
                    { value: "square", label: "Square" },
                    { value: "story", label: "Story" },
                    { value: "landscape", label: "Landscape" },
                  ]}
                />
              </div>

              {/* what to include */}
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    What to include
                  </p>
                  <span className="text-[11px] text-slate-400">
                    {form.components.length} of {COMPONENT_OPTIONS.length} on
                  </span>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {COMPONENT_OPTIONS.map((opt) => {
                    const checked = form.components.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={checked}
                        onClick={() => toggleComponent(opt.value)}
                        className={`group flex items-start gap-3 rounded-2xl border p-3 text-left transition ${
                          checked
                            ? "border-indigo-300 bg-indigo-50/70 shadow-sm"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition ${
                            checked
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
                          }`}
                        >
                          <opt.Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-slate-900">{opt.label}</span>
                            {checked ? <Check size={13} className="text-indigo-600" /> : null}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">{opt.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* values */}
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center gap-2">
                  <ListChecks size={14} className="text-slate-400" />
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Fill in the details
                  </p>
                </div>
                {hasValueComponent ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {on("product") ? (
                      products.length === 0 ? (
                        <NoCatalogueItems key="product" kind="product" />
                      ) : (
                        <Field label="Inventory product" hint="From your catalogue">
                          <select
                            className={inputClass}
                            value={form.itemId ?? ""}
                            onChange={(e) => set("itemId", e.target.value || null)}
                          >
                            <option value="">None — text only</option>
                            {products.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )
                    ) : null}

                    {on("service") ? (
                      services.length === 0 ? (
                        <NoCatalogueItems key="service" kind="service" />
                      ) : (
                        <Field label="Service" hint="From your catalogue">
                          <select
                            className={inputClass}
                            value={form.serviceId ?? ""}
                            onChange={(e) => set("serviceId", e.target.value || null)}
                          >
                            <option value="">None — text only</option>
                            {services.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )
                    ) : null}

                    {on("price") ? (
                      inventory.length === 0 ? (
                        <NoCatalogueItems key="price" kind="any" />
                      ) : (
                        <Field label="Price applies to" hint="The item this price is for">
                          <select
                            className={inputClass}
                            value={form.priceItemId ?? ""}
                            onChange={(e) => set("priceItemId", e.target.value || null)}
                          >
                            <option value="">None — no price shown</option>
                            {inventory.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.kind === "service" ? "Service · " : "Product · "}
                                {i.name}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )
                    ) : null}

                    {on("discount") ? (
                      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                        <Field label="Discount type">
                          <Segmented
                            value={form.discountKind}
                            onChange={(kind) => set("discountKind", kind)}
                            options={[
                              { value: "percent", label: "Percentage" },
                              { value: "amount", label: "Amount off" },
                            ]}
                          />
                        </Field>
                        <Field
                          label={form.discountKind === "percent" ? "Discount (%)" : "Discount amount"}
                          hint={
                            form.discountKind === "percent"
                              ? "The percentage off to show on the design"
                              : "The money amount off to show on the design"
                          }
                        >
                          <input
                            type="number"
                            min={0}
                            className={inputClass}
                            value={form.discountValue}
                            onChange={(e) => set("discountValue", Number(e.target.value))}
                          />
                        </Field>
                      </div>
                    ) : null}

                    {on("deal") ? (
                      <div className="sm:col-span-2">
                        <Field label="Deal line" hint="e.g. Buy 2 get 1 free">
                          <input
                            className={inputClass}
                            placeholder="e.g. Buy 2 get 1 free"
                            value={form.dealText}
                            onChange={(e) => set("dealText", e.target.value)}
                          />
                        </Field>
                      </div>
                    ) : null}

                    {on("coupon") ? (
                      <Field label="Coupon code">
                        <input
                          className={inputClass}
                          placeholder="e.g. GLOW28"
                          value={form.couponCode}
                          onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                        />
                      </Field>
                    ) : null}

                    {on("contact") ? (
                      <div className="sm:col-span-2">
                        <Field
                          label="Contact info"
                          hint="Website, email or phone to show on the design"
                        >
                          <input
                            className={inputClass}
                            placeholder={profile.primaryDomain || "e.g. yourstore.com"}
                            value={form.contactInfo}
                            onChange={(e) => set("contactInfo", e.target.value)}
                          />
                        </Field>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">
                    Turn on a component above to fill in its details.
                  </p>
                )}

              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3.5">
              <p className="text-[11px] text-slate-500">
                {missingValues.length > 0
                  ? `Before you send this brief: ${missingValues.join(", ")}.`
                  : activeBrief
                    ? `Editing “${activeBrief.name}” · ${STATUS_META[activeBrief.status].label.toLowerCase()}`
                    : "A new brief — we will design it and push it back to you."}
              </p>
              <button
                type="button"
                className={btnPrimary}
                onClick={submit}
                disabled={!canSend}
                title={
                  canSend ? undefined : "Fill in the values for the components you picked first"
                }
              >
                <Send size={14} /> {form.id ? "Update brief" : "Send brief"}
              </button>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------- ad frame + ads history */}
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHead
              icon={<ImageDown size={16} />}
              title="Ad frame"
              subtitle={TEMPLATE_SIZES[form.template].hint}
              action={
                designReady ? (
                  latestDelivered?.fileUrl ? (
                    <a href={latestDelivered.fileUrl} target="_blank" rel="noreferrer" download className={btnPrimary}>
                      <Download size={13} /> Export
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={btnPrimary}
                      onClick={() => void downloadPreview()}
                      disabled={downloading}
                    >
                      <Download size={13} /> {downloading ? "Exporting…" : "Download PNG"}
                    </button>
                  )
                ) : (
                  <Badge tone="warn">In design</Badge>
                )
              }
            />

            <div className="flex justify-center bg-slate-100 px-4 py-6">
              {designReady ? (
                latestDelivered?.fileUrl ? (
                  <img
                    src={latestDelivered.fileUrl}
                    alt={latestDelivered.name}
                    className="max-h-96 w-full rounded-xl object-contain ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
                    <div ref={frameRef}>
                      <AdFrame
                        design={design}
                        item={heroItem}
                        priceItem={priceItem}
                        brand={profile.brandName || "Your brand"}
                        logoUrl={profile.logoUrl}
                        contact={contact}
                        rating={rating}
                        reviewCount={reviewCount}
                      />
                    </div>
                  </div>
                )
              ) : (
                <div
                  style={{
                    width: TEMPLATE_SIZES[form.template].width,
                    minHeight: TEMPLATE_SIZES[form.template].height,
                  }}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                    <Clock size={20} />
                  </span>
                  <p className="text-sm font-semibold text-slate-800">Your design is in progress</p>
                  <p className="max-w-xs text-xs text-slate-500">
                    Your finished ad will appear here as soon as it's ready — export it right from
                    this frame.
                  </p>
                  <PlatformChips template={form.template} className="mt-3" labels={false} />
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              {designReady
                ? latestDelivered
                  ? `Delivered ${relativeTime(latestDelivered.deliveredAt)}${
                      latestDelivered.note ? ` · ${latestDelivered.note}` : ""
                    }`
                  : "Delivered — export it any time."
                : "We design from your brief and place the finished file here."}
            </div>
          </Card>

          {/* ------------------------------------------------------- history */}
          <Card>
        <CardHead
          icon={<History size={16} />}
          title="Ads history"
          subtitle="Every brief you have sent and every design we have delivered, newest first"
          action={<Badge tone="brand">{history.length} entries</Badge>}
        />
        {history.length === 0 ? (
          <EmptyState
            title="No ads yet"
            hint="Send your first brief above — it will show up here alongside the designs we deliver."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {history.map((entry) =>
              entry.kind === "brief" ? (
                <li
                  key={`brief-${entry.brief.id}`}
                  className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                    entry.brief.id === form.id ? "bg-indigo-50/40" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Megaphone size={15} />
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setForm(fromBrief(entry.brief))}
                  >
                    <p className="truncate text-sm font-medium text-slate-900">
                      {entry.brief.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {TEMPLATE_SIZES[entry.brief.template].label} ·{" "}
                      {entry.brief.components.length} components · sent{" "}
                      {relativeTime(entry.brief.submittedAt)}
                    </p>
                  </button>
                  <Badge tone={STATUS_META[entry.brief.status].tone}>
                    {STATUS_META[entry.brief.status].label}
                  </Badge>
                  {entry.brief.id === form.id ? <Badge tone="brand">Viewing</Badge> : null}
                  <button
                    type="button"
                    aria-label={`Remove ${entry.brief.name}`}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => {
                      void actions.removePromotionBrief(entry.brief.id);
                      if (entry.brief.id === form.id) setForm({ ...BLANK });
                      toast(`${entry.brief.name} removed.`);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ) : (
                <li
                  key={`ad-${entry.ad.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <FileCheck2 size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{entry.ad.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {TEMPLATE_SIZES[entry.ad.template].label} · delivered{" "}
                      {relativeTime(entry.ad.deliveredAt)}
                      {entry.ad.sizeMb ? ` · ${entry.ad.sizeMb} MB` : ""}
                    </p>
                  </div>
                  <Badge tone="good">
                    <Sparkles size={11} /> Delivered
                  </Badge>
                  {entry.ad.fileUrl ? (
                    <a
                      href={entry.ad.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      download
                      className={btnGhost}
                    >
                      <Download size={13} /> Export
                    </a>
                  ) : entry.ad.briefId ? (
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() => {
                        const brief = promotionBriefs.find((b) => b.id === entry.ad.briefId);
                        if (brief) setForm(fromBrief(brief));
                      }}
                    >
                      View brief
                    </button>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        )}
          </Card>
        </div>
      </div>
    </div>
  );
}
