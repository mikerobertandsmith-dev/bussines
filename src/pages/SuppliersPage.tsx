import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  PackageSearch,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Truck,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  ConfirmButton,
  Detail,
  EmptyState,
  Field,
  Notice,
  Segmented,
  SiteLogo,
  Stat,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  changeTone,
  inputClass,
} from "../components/primitives";
import { AreaChart } from "../components/charts";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { alertsFor } from "../lib/alerts";
import {
  daysAgo,
  money,
  normaliseWebsite,
  relativeTime,
  shortDate,
  titleCase,
} from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type {
  Cadence,
  ChangeType,
  Supplier,
  SupplierInput,
  SupplierItem,
  TrafficPoint,
} from "../lib/types";

const CHANGE_TABS: { value: ChangeType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new_product", label: "New products" },
  { value: "price_change", label: "Price moves" },
  { value: "stock_change", label: "Stock moves" },
  { value: "promotion", label: "Promotions" },
];

const RANGE_TABS = [
  { value: "2", label: "48h" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;

const CADENCE_OPTIONS: { value: Cadence; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

/** The next step we would recommend for a detected change. */
function actionFor(item: SupplierItem): string {
  const drop = ((item.previousPrice - item.price) / item.previousPrice) * 100;
  switch (item.change) {
    case "price_change":
      return drop > 4
        ? `Cut retail to match — margin at ${money(item.price)} still clears target`
        : drop < 0
          ? "Buy price rose — review retail price or switch supplier"
          : "Small price move — monitor for a week";
    case "stock_change":
      if (item.previousStock === "out_of_stock" && item.stock === "in_stock")
        return "Back in stock — email waiting clients and refresh the listing";
      if (item.stock === "out_of_stock") return "Out of stock — pause ads for this SKU";
      if (item.stock === "low_stock") return "Low stock — order now before lead time bites";
      return "Preorder open — open a preorder page";
    case "new_product":
      return "New SKU — brief a product shoot and an original ad";
    case "promotion":
      return "Supplier promo — build a matching campaign before it ends";
    default:
      return "Delisted — remove from catalogue";
  }
}

/**
 * What removing a supplier takes with it, counted from what is on screen.
 *
 * Our own catalogue is deliberately not in the list: `inventory_recommendations`
 * references suppliers with `on delete set null`, so items and ad briefs built
 * from them survive the delete. The note says so rather than leaving the user to
 * guess whether they are about to lose their own work.
 */
function supplierRemovalNote(supplier: Supplier | null, detected: number): string {
  if (!supplier) return "";
  if (detected === 0) {
    return "Nothing else is stored against them yet, so only the supplier goes. This cannot be undone.";
  }
  return `This also deletes the ${detected} detected product${
    detected === 1 ? "" : "s"
  } we hold from them. Your own catalogue and ad briefs stay — they just lose the supplier link.`;
}

function priceDelta(item: SupplierItem) {
  if (item.previousPrice === item.price) return null;
  const diff = item.price - item.previousPrice;
  const pct = (diff / item.previousPrice) * 100;
  return { diff, pct, down: diff < 0 };
}

export function SuppliersPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const suppliers = workspace.suppliers;
  const items = workspace.supplierItems;

  const [change, setChange] = useState<ChangeType | "all">("all");
  const [range, setRange] = useState<"2" | "7" | "30">("2");
  const [supplierId, setSupplierId] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [openItem, setOpenItem] = useState<SupplierItem | null>(null);

  /** The add/edit form: closed, "new", or the supplier being edited. */
  const [formTarget, setFormTarget] = useState<Supplier | "new" | null>(null);
  const [form, setForm] = useState<SupplierInput>({
    name: "",
    website: "",
    category: "",
    cadence: "daily",
    leadTimeDays: undefined,
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<Supplier | null>(null);
  const [removing, setRemoving] = useState(false);

  const editing = formTarget && formTarget !== "new" ? formTarget : null;
  /** How many catalogue items the supplier awaiting confirmation is responsible for. */
  const confirmDetected = confirmTarget
    ? items.filter((i) => i.supplierId === confirmTarget.id).length
    : 0;

  const alerts = alertsFor(workspace, "suppliers");

  const filtered = useMemo(
    () =>
      items
        .filter((i) => (change === "all" ? true : i.change === change))
        .filter((i) => (supplierId === "all" ? true : i.supplierId === supplierId))
        .filter((i) => new Date(i.detectedAt) > new Date(daysAgo(Number(range))))
        .filter((i) =>
          query.trim() === ""
            ? true
            : `${i.product} ${i.sku} ${i.category}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()),
    [items, change, supplierId, range, query],
  );

  const priceDrops = items.filter((i) => i.change === "price_change" && i.price < i.previousPrice);
  const newProducts = items.filter((i) => i.change === "new_product");

  /** How many price drops landed on each of the last seven days. */
  const priceDropTrend = useMemo<TrafficPoint[]>(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() - (6 - index));
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const count = items.filter((i) => {
        if (i.change !== "price_change" || i.price >= i.previousPrice) return false;
        const at = new Date(i.detectedAt).getTime();
        return at >= day.getTime() && at < next.getTime();
      }).length;
      return { label: day.toLocaleDateString(undefined, { weekday: "short" }), visits: count };
    });
  }, [items]);

  /** The cadence shown when every supplier shares one, otherwise the busiest. */
  const sharedCadence: Cadence =
    suppliers.length > 0 && suppliers.every((s) => s.cadence === suppliers[0].cadence)
      ? suppliers[0].cadence
      : "daily";

  function openAddSupplier() {
    setForm({
      name: "",
      website: "",
      category: "",
      cadence: sharedCadence,
      leadTimeDays: undefined,
      notes: "",
    });
    setFormError(null);
    setFormTarget("new");
  }

  function openEditSupplier(supplier: Supplier) {
    setForm({
      name: supplier.name,
      website: supplier.website,
      category: supplier.category,
      cadence: supplier.cadence,
      // 0 means "never entered", so the field starts blank rather than at zero.
      leadTimeDays: supplier.leadTimeDays || undefined,
      notes: supplier.notes ?? "",
    });
    setFormError(null);
    setFormTarget(supplier);
  }

  /**
   * Saves the add/edit form.
   *
   * A failure keeps the dialog open with what was typed and the reason inline: a
   * closed dialog plus an error toast loses the input and reads like a success.
   */
  async function submitSupplier() {
    const name = form.name.trim();
    const website = normaliseWebsite(form.website);
    if (!name || !website) {
      setFormError("Add a name and a website address — that is what gets scanned.");
      return;
    }
    const leadTimeDays = Number.isFinite(form.leadTimeDays) ? form.leadTimeDays : undefined;

    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await actions.updateSupplier(editing.id, {
          name,
          website,
          category: form.category,
          cadence: form.cadence,
          leadTimeDays,
          notes: form.notes,
        });
        toast(`${name} updated — the next scan uses the new details.`);
      } else {
        const created = await actions.addSupplier({
          name,
          website,
          category: form.category,
          cadence: form.cadence,
          leadTimeDays,
          notes: form.notes,
        });
        toast(`${created.name} is now being watched.`);
      }
      setFormTarget(null);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : "That supplier could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function removeSupplier() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setRemoving(true);
    try {
      await actions.removeSupplier(target.id);
      // The supplier filter would otherwise be holding a row that no longer exists.
      if (supplierId === target.id) setSupplierId("all");
      setConfirmTarget(null);
      toast(`Stopped watching ${target.name} and cleared the items we held from them.`);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That supplier could not be removed.");
    } finally {
      setRemoving(false);
    }
  }

  function exportCsv() {
    const header = [
      "supplier",
      "product",
      "sku",
      "category",
      "change",
      "price",
      "previous_price",
      "stock",
      "previous_stock",
      "detected_at",
      "moq",
      "lead_time_days",
      "url",
    ];
    const rows = filtered.map((item) => {
      const supplier = suppliers.find((s) => s.id === item.supplierId);
      return [
        supplier?.name ?? "",
        item.product,
        item.sku,
        item.category,
        item.change,
        item.price,
        item.previousPrice,
        item.stock,
        item.previousStock,
        item.detectedAt,
        item.moq,
        item.leadTimeDays,
        item.url,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-changes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${filtered.length} supplier changes to CSV.`);
  }

  const detailDelta = openItem ? priceDelta(openItem) : null;

  return (
    <div className="space-y-5">
      {/* Summary first: the count of sites, what's new, then the price-drop trend. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Suppliers monitored"
          value={suppliers.length}
          icon={<Truck size={16} />}
          hint={`${suppliers.filter((s) => s.cadence === "daily").length} checked daily`}
        />
        <Stat
          label="New items this cycle"
          value={newProducts.length}
          icon={<Sparkles size={16} />}
          hint="listed since the last scan"
        />
        <Card className="p-4 sm:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Price drops
            </p>
            <span className="text-slate-400">
              <ArrowDownRight size={16} />
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <p className="text-2xl font-semibold tracking-tight text-slate-900">
              {priceDrops.length}
            </p>
            <span className="text-xs text-slate-500">buy price lower than last scan · last 7 days</span>
          </div>
          <div className="mt-2">
            <AreaChart
              data={priceDropTrend}
              color="#059669"
              valueFormat={(n) => `${n} drop${n === 1 ? "" : "s"}`}
              height={92}
            />
          </div>
        </Card>
      </div>

      {alerts.length ? (
        <Notice
          tone="warn"
          icon={<AlertTriangle size={15} />}
          title={`${alerts.length} supplier changes need a decision`}
        >
          <ul className="space-y-1">
            {alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="text-xs">
                <span className="font-medium">{a.title}</span> — {a.detail}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {/* Watching: the same compact pill row the competition page uses. Clicking a
          supplier opens their site. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Truck size={16} className="text-indigo-600" /> Watching
          </span>

          {/* Each pill stays a link to their site; managing one is the small pencil
              beside it, so the row does not turn into two buttons per supplier. */}
          {suppliers.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-0.5 rounded-full py-0.5 pr-0.5 pl-1 ring-1 ring-slate-300 transition hover:bg-slate-50"
            >
              <a
                href={s.website}
                target="_blank"
                rel="noreferrer"
                title={`Open ${s.name} in a new tab`}
                className="flex items-center gap-2 py-0.5 text-xs font-medium text-slate-600 transition hover:text-indigo-600"
              >
                <SiteLogo website={s.website} name={s.name} size={22} />
                <span className="max-w-40 truncate">{s.name}</span>
              </a>
              <button
                type="button"
                onClick={() => openEditSupplier(s)}
                title={`Edit ${s.name}`}
                aria-label={`Edit ${s.name}`}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-white hover:text-indigo-600"
              >
                <Pencil size={12} />
              </button>
            </span>
          ))}

          <button type="button" className={btnGhost} onClick={openAddSupplier}>
            <Plus size={13} /> Add supplier
          </button>

          {suppliers.length === 0 ? (
            <span className="text-xs text-slate-500">
              No supplier sites yet — nothing is being checked.
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
          <CardHead
            icon={<PackageSearch size={16} />}
            title="Latest inventory from your suppliers"
            subtitle="Every product the feed detected, newest first"
            action={
              <button type="button" className={btnGhost} onClick={exportCsv}>
                <Download size={14} /> Export CSV
              </button>
            }
          />

          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <Segmented options={CHANGE_TABS} value={change} onChange={setChange} />
            <Segmented
              options={RANGE_TABS.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onChange={setRange}
            />
            <select
              className={`${inputClass} max-w-52`}
              aria-label="Filter by supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="all">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className={`${inputClass} max-w-56`}
              placeholder="Search product or SKU"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {suppliers.length === 0 ? (
            <EmptyState
              title="No suppliers yet"
              hint="Add the supplier sites you buy from — their catalogues, prices and stock will be checked on the cadence you choose."
              action={
                <button type="button" className={btnPrimary} onClick={openAddSupplier}>
                  <Plus size={13} /> Add supplier
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No changes in this window"
              hint="Try a wider date range or clear the filters. Suppliers set to weekly and monthly only report on their next scan."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Supplier</Th>
                    <Th>Change</Th>
                    <Th className="text-right">Buy price</Th>
                    <Th>Stock</Th>
                    <Th>Detected</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => {
                    const supplier = suppliers.find((s) => s.id === item.supplierId);
                    const delta = priceDelta(item);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => setOpenItem(item)}
                        className="cursor-pointer align-top hover:bg-slate-50/70"
                      >
                        <Td>
                          <span className="block font-medium text-slate-900">{item.product}</span>
                          <span className="text-[11px] text-slate-500">
                            {item.sku} · {item.category}
                          </span>
                        </Td>
                        <Td>
                          <span className="flex items-center gap-2">
                            <SiteLogo
                              website={supplier?.website ?? ""}
                              name={supplier?.name ?? "Supplier"}
                              size={24}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium text-slate-700">
                                {supplier?.name ?? "Unknown supplier"}
                              </span>
                              <span className="text-[11px] text-slate-500">
                                Lead time {item.leadTimeDays}d
                              </span>
                            </span>
                          </span>
                        </Td>
                        <Td>
                          <Badge tone={changeTone[item.change]}>{titleCase(item.change)}</Badge>
                        </Td>
                        <Td className="text-right">
                          <span className="block font-semibold text-slate-900">
                            {money(item.price)}
                          </span>
                          {delta ? (
                            <span
                              className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${
                                delta.down ? "text-emerald-600" : "text-rose-600"
                              }`}
                            >
                              {delta.down ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                              {Math.abs(delta.pct).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-400">unchanged</span>
                          )}
                        </Td>
                        <Td>
                          <span className="block text-xs text-slate-700">
                            {item.stock === item.previousStock
                              ? titleCase(item.stock)
                              : `${titleCase(item.previousStock)} → ${titleCase(item.stock)}`}
                          </span>
                        </Td>
                        <Td>
                          <span className="block text-xs text-slate-700">
                            {relativeTime(item.detectedAt)}
                          </span>
                        </Td>
                        <Td>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenItem(item);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            Details <ChevronRight size={12} />
                          </button>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

      <Modal
        open={openItem !== null}
        onClose={() => setOpenItem(null)}
        title={openItem?.product ?? "Supplier change"}
        subtitle={openItem ? `${openItem.sku} · ${openItem.category}` : undefined}
        icon={<PackageSearch size={16} />}
        footer={
          openItem ? (
            <>
              <a
                href={openItem.url}
                target="_blank"
                rel="noreferrer"
                className={btnGhost}
              >
                Open on supplier site <ExternalLink size={13} />
              </a>
              <button type="button" className={btnPrimary} onClick={() => setOpenItem(null)}>
                Close
              </button>
            </>
          ) : null
        }
      >
        {openItem ? (
          <div className="space-y-4 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={changeTone[openItem.change]}>{titleCase(openItem.change)}</Badge>
              <Badge tone={openItem.stock === "out_of_stock" ? "bad" : "neutral"}>
                {titleCase(openItem.stock)}
              </Badge>
              <span className="text-[11px] text-slate-500">
                detected {relativeTime(openItem.detectedAt)} · {shortDate(openItem.detectedAt)}
              </span>
            </div>

            <dl className="grid gap-2 sm:grid-cols-2">
              <Detail label="Supplier">
                {suppliers.find((s) => s.id === openItem.supplierId)?.name ?? "—"}
              </Detail>
              <Detail label="Buy price">{money(openItem.price)}</Detail>
              <Detail label="Previous price">
                {money(openItem.previousPrice)}
                {detailDelta ? (
                  <span className={detailDelta.down ? "text-emerald-700" : "text-rose-700"}>
                    {" "}
                    ({detailDelta.down ? "" : "+"}
                    {detailDelta.pct.toFixed(1)}%)
                  </span>
                ) : null}
              </Detail>
              <Detail label="Stock movement">
                {openItem.previousStock === openItem.stock
                  ? titleCase(openItem.stock)
                  : `${titleCase(openItem.previousStock)} → ${titleCase(openItem.stock)}`}
              </Detail>
              <Detail label="Lead time">{openItem.leadTimeDays} days</Detail>
              <Detail label="Minimum order">{openItem.moq} units</Detail>
            </dl>

            {openItem.note ? (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                {openItem.note}
              </p>
            ) : null}

            <div className="rounded-lg border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] tracking-wide text-slate-500 uppercase">Suggested action</p>
              <p className="mt-1 text-xs text-slate-700">{actionFor(openItem)}</p>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------ add / edit a supplier */}
      <Modal
        open={formTarget !== null}
        onClose={() => setFormTarget(null)}
        title={editing ? `Edit ${editing.name}` : "Add a supplier"}
        subtitle={
          editing
            ? "Changes apply from the next scan — what we already detected stays attached."
            : "We check their catalogue, prices and stock on the cadence you pick."
        }
        icon={<Truck size={16} />}
        footer={
          <>
            {editing ? (
              <button
                type="button"
                className="mr-auto inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50"
                onClick={() => {
                  // Removing is handed to the confirm dialog: it names what goes
                  // with them and needs the second click.
                  setConfirmTarget(editing);
                  setFormTarget(null);
                }}
              >
                <Trash2 size={13} /> Remove supplier
              </button>
            ) : null}
            <button type="button" className={btnGhost} onClick={() => setFormTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              disabled={saving}
              onClick={() => void submitSupplier()}
            >
              {editing ? <Check size={13} /> : <Plus size={13} />}
              {editing ? "Save changes" : "Add supplier"}
            </button>
          </>
        }
      >
        <div className="space-y-4 px-4 py-4">
          <Field label="Name">
            <input
              className={inputClass}
              placeholder="e.g. Lumière Cosmetics Supply"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="Website" hint="Their catalogue. A pasted URL is reduced to its domain.">
            <input
              className={inputClass}
              placeholder="supplier.com"
              value={form.website}
              onChange={(event) => setForm({ ...form, website: event.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <input
                className={inputClass}
                placeholder="e.g. Beauty & cosmetics"
                value={form.category ?? ""}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </Field>
            <Field label="Check cadence">
              <select
                className={inputClass}
                value={form.cadence}
                onChange={(event) =>
                  setForm({ ...form, cadence: event.target.value as Cadence })
                }
              >
                {CADENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lead time (days)" hint="How long their stock takes to arrive.">
              <input
                type="number"
                min={0}
                className={inputClass}
                placeholder="e.g. 14"
                value={form.leadTimeDays ?? ""}
                onChange={(event) =>
                  setForm({
                    ...form,
                    leadTimeDays: event.target.value === "" ? undefined : Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Notes" hint="For you and your team — never sent anywhere.">
              <input
                className={inputClass}
                placeholder="Anything worth remembering"
                value={form.notes ?? ""}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </div>
          {formError ? <p className="text-[11px] text-amber-600">{formError}</p> : null}
        </div>
      </Modal>

      {/* ------------------------------------------------ stop watching a supplier */}
      <Modal
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        title={`Stop watching ${confirmTarget?.name ?? "this supplier"}?`}
        subtitle="Their row goes, and the catalogue items detected from it go too"
        icon={<Trash2 size={16} />}
        footer={
          <>
            <button
              type="button"
              className={btnGhost}
              disabled={removing}
              onClick={() => setConfirmTarget(null)}
            >
              Keep watching
            </button>
            <ConfirmButton
              label="Remove supplier"
              confirmLabel="Delete permanently"
              icon={<Trash2 size={13} />}
              busy={removing}
              onConfirm={() => void removeSupplier()}
            />
          </>
        }
      >
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-slate-700">
            {confirmTarget?.name ?? "This supplier"} stops being checked and disappears from the
            watching row above.
          </p>
          <p className="rounded-lg border border-rose-200 bg-rose-50/70 px-3 py-2 text-[12px] text-rose-900">
            {supplierRemovalNote(confirmTarget, confirmDetected)}
          </p>
        </div>
      </Modal>
    </div>
  );
}
