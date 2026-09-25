import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { UserButton } from "@clerk/clerk-react";
import {
  Bell,
  Binoculars,
  Building2,
  Database,
  Mail,
  Menu,
  RefreshCw,
  ShieldCheck,
  Truck,
  X,
} from "lucide-react";
import type { RouteId } from "../lib/hooks";
import { buildAlerts } from "../lib/alerts";
import { authEnabled, dbEnabled, demoMode } from "../lib/env";
import { useWorkspace } from "../lib/workspace";
import { daysAgo } from "../lib/format";
import { Badge } from "./ui";

const NAV: {
  id: RouteId;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  { id: "suppliers", label: "Suppliers", hint: "New stock & price changes", icon: <Truck size={18} /> },
  { id: "competition", label: "Competition", hint: "Traffic, SEO, ads & reviews", icon: <Binoculars size={18} /> },
  { id: "clients", label: "Clients", hint: "Email list & message schedule", icon: <Mail size={18} /> },
  { id: "business", label: "My Business", hint: "SEO, GEO, reviews & ad assets", icon: <Building2 size={18} /> },
];

export const PAGE_META: Record<RouteId, { title: string; subtitle: string }> = {
  suppliers: {
    title: "Supplier updates",
    subtitle: "What changed on your supplier websites, and the latest inventory they added",
  },
  competition: {
    title: "Competition watch",
    subtitle: "New inventory, traffic, keyword gaps, ads, reviews and target audiences",
  },
  clients: {
    title: "Client messaging desk",
    subtitle: "Your clients' emails, active customer list and the message schedule you run",
  },
  business: {
    title: "My business",
    subtitle: "Your SEO & GEO scores, traffic, review analysis, ad assets and stock to buy next",
  },
};

export function Layout({
  route,
  navigate,
  children,
}: {
  route: RouteId;
  navigate: (route: RouteId) => void;
  children: ReactNode;
}) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const { data } = useWorkspace();

  const alerts = useMemo(() => (data ? buildAlerts(data) : []), [data]);

  const badges: Record<RouteId, number> = {
    suppliers: data
      ? data.supplierItems.filter((i) => new Date(i.detectedAt) > new Date(daysAgo(2))).length
      : 0,
    competition: data
      ? data.competitors.flatMap((c) => c.ads).filter((a) => a.status === "active").length
      : 0,
    clients: data ? data.clients.filter((c) => c.status === "active").length : 0,
    business: alerts.filter((a) => a.page === "business").length,
  };

  const meta = PAGE_META[route];
  const brand = data?.profile.brandName || "Market Watch";

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-slate-800 bg-slate-900 px-3 py-4 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500 text-white">
                <ShieldCheck size={18} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{brand}</p>
                <p className="text-[11px] text-slate-400">Market Watch desk</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="rounded p-1 text-slate-400 hover:text-white lg:hidden"
              aria-label="Close navigation"
            >
              <X size={16} />
            </button>
          </div>

          <nav className="mt-6 space-y-1">
            {NAV.map((item) => {
              const active = route === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    navigate(item.id);
                    setNavOpen(false);
                  }}
                  className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                    active ? "bg-indigo-600 text-white" : "hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span className={active ? "text-white" : "text-slate-400"}>{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.label}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          active ? "bg-white/20 text-white" : "bg-slate-800 text-slate-300"
                        }`}
                      >
                        {badges[item.id]}
                      </span>
                    </span>
                    <span
                      className={`mt-0.5 block truncate text-[11px] ${
                        active ? "text-indigo-100" : "text-slate-500"
                      }`}
                    >
                      {item.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="mt-6 rounded-xl border border-slate-800 bg-slate-800/40 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
              <RefreshCw size={12} /> Monitoring cadence
            </p>
            <ul className="mt-2 space-y-1.5 text-[11px] text-slate-400">
              <li className="flex items-center justify-between">
                <span>Supplier feeds</span>
                <span className="text-slate-200">
                  {data?.suppliers.some((s) => s.cadence === "daily") ? "Daily" : "Set per source"}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Competitor scans</span>
                <span className="text-slate-200">
                  {data?.competitors.some((c) => c.cadence === "daily") ? "Daily" : "Set per source"}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Client check-ins</span>
                <span className="text-slate-200">
                  {data?.clients.length ? `${data.clients.length} scheduled` : "None yet"}
                </span>
              </li>
              <li className="flex items-center justify-between">
                <span>Review scans</span>
                <span className="text-slate-200">Weekly</span>
              </li>
            </ul>
          </div>

          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-800/40 p-3 text-[11px] text-slate-400">
            <p className="flex items-center gap-1.5 font-medium text-slate-300">
              <Database size={12} /> Data source
            </p>
            <p className="mt-1.5">
              {demoMode
                ? "Demo mode — add Clerk and Supabase keys to store your own data."
                : dbEnabled
                  ? "Live — reading and writing your Supabase workspace."
                  : "Auth connected, database not configured yet."}
            </p>
          </div>
        </aside>

        {navOpen ? (
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
          />
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={16} />
                </button>
                <div>
                  <h1 className="text-lg font-semibold tracking-tight text-slate-900">{meta.title}</h1>
                  <p className="text-xs text-slate-500">{meta.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {demoMode ? (
                  <Badge tone="warn">Demo data</Badge>
                ) : dbEnabled ? (
                  <Badge tone="good">Live workspace</Badge>
                ) : (
                  <Badge tone="info">Sample data</Badge>
                )}
                <button
                  type="button"
                  onClick={() => setAlertsOpen((v) => !v)}
                  className="relative rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                  aria-label="Show alerts"
                >
                  <Bell size={16} />
                  {alerts.length ? (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
                      {alerts.length}
                    </span>
                  ) : null}
                </button>
                {authEnabled ? <UserButton afterSignOutUrl="/" /> : null}
              </div>
            </div>

            {data?.isSample && !demoMode ? (
              <div className="border-t border-amber-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 sm:px-6">
                No monitoring results yet for {brand}. The screens below show sample data so you can
                see the layout — your first scans will replace it automatically.
              </div>
            ) : null}

            {alertsOpen ? (
              <div className="border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Action needed
                  </p>
                  <button
                    type="button"
                    onClick={() => setAlertsOpen(false)}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Close
                  </button>
                </div>
                {alerts.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Nothing needs a decision right now. Alerts appear here as soon as a scan finds a
                    price, stock, ad or review change.
                  </p>
                ) : (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {alerts.slice(0, 6).map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => {
                            navigate(a.page);
                            setAlertsOpen(false);
                          }}
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                a.severity === "urgent" ? "bg-rose-500" : "bg-amber-500"
                              }`}
                            />
                            <span className="text-xs font-semibold text-slate-800">{a.title}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">{a.detail}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </header>

          <main className="flex-1 px-4 py-5 sm:px-6">{children}</main>

          <footer className="border-t border-slate-200 px-4 py-4 text-[11px] text-slate-400 sm:px-6">
            {brand} · supplier, competitor and client monitoring workspace.{" "}
            {demoMode
              ? "Demo mode: connect Clerk and Supabase to run on your own data."
              : "Scans run on the cadence set per source; email sends are logged to your workspace."}
          </footer>
        </div>
      </div>
    </div>
  );
}
