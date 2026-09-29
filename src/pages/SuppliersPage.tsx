import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  PackageSearch,
  Pencil,
  Plus,
  RefreshCw,
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
  inputClass,
} from "../components/primitives";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { alertsFor } from "../lib/alerts";
import { daysAgo, normaliseWebsite, relativeTime, shortDate } from "../lib/format";
import {
  readSetSummary,
  readStateCopy,
  readStateOf,
  readStateTone,
  type SourceReadState,
} from "../lib/reads";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Cadence, ChangeType, Supplier, SupplierInput, SupplierItem } from "../lib/types";

/**
 * The kinds of supplier change this page reports.
 *
 * Only listings are shown here. Price moves, stock moves and supplier promotions
 * were removed: nothing we read publishes a comparable buy price or a stock level
 * from those sources, so the tabs, the columns behind them and the price-drop
 * trend above them described movements we could never actually observe.
 */
const CHANGE_TABS: { value: ChangeType | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new_product", label: "New products" },
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
  /** The supplier whose catalogue is being read on demand right now. */
  const [readingId, setReadingId] = useState<string | null>(null);

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

  const newProducts = items.filter((i) => i.change === "new_product");

  /**
   * What each watched site's last read did, and the page's own headline for it.
   *
   * The change table below can only ever show *products*, and every supplier here
   * publishes none — so without this the whole page reads as broken rather than as
   * "read, and their site has no catalogue". Drafted from fields we already hold;
   * see `lib/reads.ts`.
   */
  const reads = suppliers.map((supplier) => {
    const itemCount = items.filter((i) => i.supplierId === supplier.id).length;
    const signals = {
      siteScanPending: supplier.siteScanPending,
      siteError: supplier.siteError,
      siteScanAt: supplier.siteScanAt,
      itemCount,
    };
    const state = readStateOf(signals);
    return { supplier, state, itemCount, copy: readStateCopy(state, signals) };
  });
  const readStates: SourceReadState[] = reads.map((entry) => entry.state);
  const readingNow = reads.filter((entry) => entry.state === "pending").length;
  /** How many watched sites actually publish a catalogue we can read. */
  const readableCount = reads.filter((entry) => entry.state === "listed").length;

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

  /**
   * Reads one supplier's site now, instead of waiting for the next pull.
   *
   * Worth having as its own control because the answer for most of the sources
   * this app watches is "no catalogue published", and that is only convincing when
   * the user can make us read again and watch it come back the same way. The reply
   * is reported as it is: a run still going says so rather than claiming a result.
   */
  async function readNow(supplier: Supplier) {
    setReadingId(supplier.id);
    try {
      const result = await actions.scanSupplierSite(supplier.id);
      if (!result) {
        toast("Reading a catalogue needs a live workspace.");
        return;
      }
      if (result.status === "unavailable") {
        toast(result.reason ?? "Catalogue reading is not configured on the server.");
        return;
      }
      if (result.status === "running") {
        toast(`${supplier.name}: still reading — the result is collected on the next refresh.`);
        return;
      }
      if (result.status === "failed") {
        toast(result.reason ?? `${supplier.name} could not be read.`);
        return;
      }
      toast(
        result.items
          ? `${supplier.name}: read ${result.items} products, ${result.changes} new.`
          : `${supplier.name} was read cleanly — their site publishes no product catalogue.`,
      );
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That catalogue could not be read.");
    } finally {
      setReadingId(null);
    }
  }

  function exportCsv() {
    const header = [
      "supplier",
      "product",
      "sku",
      "category",
      "change",
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

  return (
    <div className="space-y-5">
      {/* Summary first: how many sites are watched, and what they listed since the last read. */}
      <div className="grid gap-3 sm:grid-cols-2">
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
          // Names the usual reason a watched set has produced nothing, rather than
          // leaving a 0 that reads as a failed scan.
          hint={
            readableCount
              ? "listed since the last scan"
              : suppliers.length
                ? "no watched site publishes a product catalogue"
                : "add a supplier site to start"
          }
        />
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

      {/*
        What each read did.

        This exists because the change table below can only ever show *products*,
        and every supplier watched here publishes none — so without it the page has
        one number for a read (how many changes came back) and that number is always
        zero, which is indistinguishable from a scan that never happens. "Read, and
        their site has no catalogue" is a finding and belongs on the page.
      */}
      <Card>
        <CardHead
          icon={<RefreshCw size={16} />}
          title="Catalogue reads"
          subtitle={
            suppliers.length
              ? readSetSummary(readStates)
              : "Nothing is being watched yet, so no site is being read."
          }
          action={
            readingNow ? <Badge tone="brand">{readingNow} reading now</Badge> : undefined
          }
        />
        {suppliers.length === 0 ? (
          <EmptyState
            title="No supplier sites yet"
            hint="Add the sites you buy from and each one is checked for a product catalogue on the cadence you choose."
            action={
              <button type="button" className={btnPrimary} onClick={openAddSupplier}>
                <Plus size={13} /> Add supplier
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {reads.map(({ supplier, state, itemCount, copy }) => (
              <li
                key={supplier.id}
                className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap"
              >
                <SiteLogo website={supplier.website} name={supplier.name} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-900">
                      {supplier.name}
                    </span>
                    <Badge tone={readStateTone(state)}>{copy.label}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-600">{copy.detail}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    read {supplier.siteScanAt ? relativeTime(supplier.siteScanAt) : "never"} ·
                    next {relativeTime(supplier.nextScan)} · {supplier.cadence} · {itemCount}{" "}
                    item{itemCount === 1 ? "" : "s"} held
                  </span>
                </span>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => void readNow(supplier)}
                  disabled={readingId === supplier.id || state === "pending"}
                >
                  <RefreshCw
                    size={13}
                    className={readingId === supplier.id ? "animate-spin" : ""}
                  />
                  {readingId === supplier.id ? "Reading…" : "Read now"}
                </button>
              </li>
            ))}
          </ul>
        )}
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
              hint="Add the supplier sites you buy from — their catalogues are checked for new listings on the cadence you choose."
              action={
                <button type="button" className={btnPrimary} onClick={openAddSupplier}>
                  <Plus size={13} /> Add supplier
                </button>
              }
            />
          ) : filtered.length === 0 && items.length === 0 ? (
            // Nothing has ever been read from any of them, so "no changes in this
            // window" would be answering a question nobody asked — the filters are
            // not what is empty, the sources are.
            <EmptyState
              title="No supplier products on file"
              hint={`${readSetSummary(readStates)} Products appear here only when a read finds one, and a site with no catalogue never will. Use “Read now” above to check any supplier yourself.`}
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
                    <Th>Detected</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => {
                    const supplier = suppliers.find((s) => s.id === item.supplierId);
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
            <span className="text-[11px] text-slate-500">
              detected {relativeTime(openItem.detectedAt)} · {shortDate(openItem.detectedAt)}
            </span>

            <dl className="grid gap-2 sm:grid-cols-2">
              <Detail label="Supplier">
                {suppliers.find((s) => s.id === openItem.supplierId)?.name ?? "—"}
              </Detail>
              <Detail label="Lead time">{openItem.leadTimeDays} days</Detail>
              <Detail label="Minimum order">{openItem.moq} units</Detail>
            </dl>

            {openItem.note ? (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                {openItem.note}
              </p>
            ) : null}
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
            : "We check their catalogue for new listings on the cadence you pick."
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
