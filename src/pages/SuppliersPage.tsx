import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Boxes,
  CalendarClock,
  Download,
  ExternalLink,
  PackageSearch,
  RefreshCw,
  Sparkles,
  Truck,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Segmented,
  Stat,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  changeTone,
  inputClass,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { alertsFor } from "../lib/alerts";
import { cadenceLabel, daysAgo, money, relativeTime, shortDate, titleCase } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Cadence, ChangeType, SupplierItem } from "../lib/types";

const CHANGE_TABS: { value: ChangeType | "all"; label: string }[] = [
  { value: "all", label: "All changes" },
  { value: "new_product", label: "New products" },
  { value: "price_change", label: "Price moves" },
  { value: "stock_change", label: "Stock moves" },
  { value: "promotion", label: "Promotions" },
];

const RANGE_TABS = [
  { value: "2", label: "Last 48h" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
] as const;

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

  const alerts = alertsFor(workspace, "suppliers");

  const filtered = items
    .filter((i) => (change === "all" ? true : i.change === change))
    .filter((i) => (supplierId === "all" ? true : i.supplierId === supplierId))
    .filter((i) => new Date(i.detectedAt) > new Date(daysAgo(Number(range))))
    .filter((i) =>
      query.trim() === ""
        ? true
        : `${i.product} ${i.sku} ${i.category}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());

  const priceDrops = items.filter((i) => i.change === "price_change" && i.price < i.previousPrice);
  const backInStock = items.filter(
    (i) => i.change === "stock_change" && i.stock !== "out_of_stock",
  );
  const newProducts = items.filter((i) => i.change === "new_product");

  function scanNow(id: string) {
    const supplier = suppliers.find((s) => s.id === id);
    void actions.scanSupplier(id);
    toast(`Scan queued for ${supplier?.name ?? "supplier"} — results land with the next job run.`);
  }

  function setCadence(id: string, value: Cadence) {
    const supplier = suppliers.find((s) => s.id === id);
    void actions.setSupplierCadence(id, value);
    toast(`${supplier?.name ?? "Supplier"} will now be checked ${cadenceLabel(value).toLowerCase()}.`);
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

  return (
    <div className="space-y-5">
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
          delta={12.5}
          icon={<Sparkles size={16} />}
          hint="vs previous cycle"
        />
        <Stat
          label="Price drops"
          value={priceDrops.length}
          delta={-4.2}
          icon={<ArrowDownRight size={16} />}
          hint="buy price lower than last scan"
        />
        <Stat
          label="Waiting-list triggers"
          value={backInStock.length}
          icon={<Boxes size={16} />}
          hint="back in stock or preorder open"
        />
      </div>

      {alerts.length ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <div className="flex flex-wrap items-start gap-3 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-amber-900">
                {alerts.length} supplier changes need a decision
              </p>
              <ul className="mt-1 space-y-1">
                {alerts.slice(0, 3).map((a) => (
                  <li key={a.id} className="text-xs text-amber-800">
                    <span className="font-medium">{a.title}</span> — {a.detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead
            icon={<PackageSearch size={16} />}
            title="Latest inventory from your suppliers"
            subtitle="Every product the feed detected on supplier sites, with what changed"
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
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No changes in this window"
              hint="Try a wider date range or clear the filters. Suppliers set to weekly and monthly only report on their next scan."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Supplier</Th>
                    <Th>Change</Th>
                    <Th className="text-right">Buy price</Th>
                    <Th>Stock</Th>
                    <Th>Detected</Th>
                    <Th>Suggested action</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((item) => {
                    const supplier = suppliers.find((s) => s.id === item.supplierId);
                    const delta = priceDelta(item);
                    return (
                      <tr key={item.id} className="align-top hover:bg-slate-50/70">
                        <Td>
                          <span className="block font-medium text-slate-900">{item.product}</span>
                          <span className="text-[11px] text-slate-500">
                            {item.sku} · {item.category} · MOQ {item.moq}
                          </span>
                          {item.note ? (
                            <span className="mt-1 block max-w-72 text-[11px] text-indigo-600">
                              {item.note}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="block text-xs font-medium text-slate-700">
                            {supplier?.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            Lead time {item.leadTimeDays}d
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
                              {delta.down ? (
                                <ArrowDownRight size={12} />
                              ) : (
                                <ArrowUpRight size={12} />
                              )}
                              {Math.abs(delta.pct).toFixed(1)}% ({money(item.previousPrice)})
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
                          <span className="text-[11px] text-slate-400">
                            {shortDate(item.detectedAt)}
                          </span>
                        </Td>
                        <Td className="max-w-64 text-xs text-slate-600">{actionFor(item)}</Td>
                        <Td>
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                          >
                            Open <ExternalLink size={12} />
                          </a>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            icon={<CalendarClock size={16} />}
            title="Monitored supplier sites"
            subtitle="Set how often each supplier site is checked"
          />
          <ul className="divide-y divide-slate-100">
            {suppliers.map((s) => {
              const cadence = s.cadence;
              const lastScan = s.lastScan;
              const openChanges = items.filter(
                (i) => i.supplierId === s.id && new Date(i.detectedAt) > new Date(daysAgo(7)),
              ).length;
              return (
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                      <a
                        href={s.website}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 truncate text-[11px] text-slate-500 hover:text-indigo-600"
                      >
                        {s.website.replace(/^https?:\/\//, "")} <ExternalLink size={10} />
                      </a>
                    </div>
                    <Badge tone={openChanges > 0 ? "brand" : "neutral"}>{openChanges} changes</Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                    <span>Category: {s.category}</span>
                    <span>·</span>
                    <span>Health {s.scanHealth}%</span>
                    <span>·</span>
                    <span>Last scan {relativeTime(lastScan)}</span>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <Segmented
                      size="sm"
                      value={cadence}
                      onChange={(v) => setCadence(s.id, v)}
                      options={[
                        { value: "daily", label: "Daily" },
                        { value: "weekly", label: "Weekly" },
                        { value: "monthly", label: "Monthly" },
                      ]}
                    />
                    <button type="button" className={btnPrimary} onClick={() => scanNow(s.id)}>
                      <RefreshCw size={13} /> Scan now
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Daily feeds catch price and stock moves fastest. Weekly and monthly sources are scanned in
            one batch and summarised in the client email.
          </div>
        </Card>
      </div>
    </div>
  );
}
