import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { UserButton, useClerk } from "@clerk/clerk-react";
import {
  Bell,
  Binoculars,
  Building2,
  ChevronDown,
  Database,
  Mail,
  LogOut,
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
import { LogoUpload } from "./LogoUpload";
import { Modal } from "./Modal";
import { Badge, Logo, btnPrimary } from "./ui";

type NavItem = { id: RouteId; label: string; hint: string; icon: ReactNode };

/** Grouped so the sidebar reads as two jobs, not four equal buttons. */
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      {
        id: "suppliers",
        label: "Suppliers",
        hint: "New stock & price changes",
        icon: <Truck size={17} />,
      },
      {
        id: "competition",
        label: "Competition",
        hint: "Traffic, SEO, ads & reviews",
        icon: <Binoculars size={17} />,
      },
    ],
  },
  {
    label: "Grow",
    items: [
      {
        id: "clients",
        label: "Clients",
        hint: "Email list & message schedule",
        icon: <Mail size={17} />,
      },
      {
        id: "business",
        label: "My Business",
        hint: "SEO, GEO, reviews & ad assets",
        icon: <Building2 size={17} />,
      },
    ],
  },
];

/**
 * Explicit sign-out control. Only mounted when Clerk is configured, so the
 * hook is never called without a ClerkProvider above it.
 */
function LogoutButton() {
  const { signOut } = useClerk();
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white"
    >
      <LogOut size={12} /> Log out
    </button>
  );
}

export const PAGE_META: Record<RouteId, { title: string; subtitle: string }> = {
  suppliers: {
    title: "Supplier updates",
    subtitle: "What changed on your supplier sites, and the inventory they added",
  },
  competition: {
    title: "Competition watch",
    subtitle: "Traffic, keyword gaps, ads, reviews and the audiences they target",
  },
  clients: {
    title: "Client messaging desk",
    subtitle: "Your customer list, the messages they receive and what has been sent",
  },
  business: {
    title: "My business",
    subtitle: "Your SEO & GEO scores, traffic, reviews, ad assets and stock to buy next",
  },
  notifications: {
    title: "Notifications",
    subtitle: "Every price, stock, ad and review alert your scans raised, newest first",
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
  const [navOpen, setNavOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, actions } = useWorkspace();

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
    notifications: alerts.length,
  };

  const meta = PAGE_META[route];
  const brand = data?.profile.brandName || "Market Watch";
  const logoUrl = data?.profile.logoUrl ?? "";

  function openItem(id: RouteId) {
    navigate(id);
    setNavOpen(false);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="flex min-h-screen">
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-300 transition-transform lg:static lg:translate-x-0 ${
            navOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          {/* Brand block — plain, as it was before the profile moved to the top bar. */}
          <div className="flex items-center justify-between px-2 pt-4">
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

          <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="px-3 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const active = route === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        title={item.hint}
                        aria-current={active ? "page" : undefined}
                        onClick={() => openItem(item.id)}
                        className={`group relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
                          active
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "text-slate-300 hover:bg-slate-800 hover:text-white"
                        }`}
                      >
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                            active
                              ? "bg-white/20 text-white"
                              : "bg-slate-800 text-slate-400 group-hover:text-white"
                          }`}
                        >
                          {item.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {item.label}
                        </span>
                        {badges[item.id] > 0 ? (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              active ? "bg-white/25 text-white" : "bg-slate-800 text-slate-300"
                            }`}
                          >
                            {badges[item.id]}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Secondary workspace facts stay folded away until asked for. */}
          <div className="mt-auto border-t border-slate-800 px-3 py-3">
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-[11px] font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              <span className="flex items-center gap-1.5">
                <RefreshCw size={12} /> Monitoring cadence &amp; data
              </span>
              <ChevronDown
                size={12}
                className={`transition ${infoOpen ? "rotate-180" : ""}`}
              />
            </button>

            {infoOpen ? (
              <div className="mt-1 space-y-2 rounded-xl border border-slate-800 bg-slate-800/40 p-3 text-[11px] text-slate-400">
                <ul className="space-y-1.5">
                  {[
                    {
                      label: "Supplier feeds",
                      value: data?.suppliers.some((s) => s.cadence === "daily")
                        ? "Daily"
                        : "Set per source",
                    },
                    {
                      label: "Competitor scans",
                      value: data?.competitors.some((c) => c.cadence === "daily")
                        ? "Daily"
                        : "Set per source",
                    },
                    {
                      label: "Client check-ins",
                      value: data?.clients.length ? `${data.clients.length} scheduled` : "None yet",
                    },
                    { label: "Review scans", value: "Weekly" },
                  ].map((row) => (
                    <li key={row.label} className="flex items-center justify-between gap-2">
                      <span>{row.label}</span>
                      <span className="text-slate-200">{row.value}</span>
                    </li>
                  ))}
                </ul>
                <p className="flex items-start gap-1.5 border-t border-slate-700/60 pt-2">
                  <Database size={12} className="mt-0.5 shrink-0" />
                  <span>
                    {demoMode
                      ? "Demo mode — add Clerk and Supabase keys to store your own data."
                      : dbEnabled
                        ? "Live — reading and writing your Supabase workspace."
                        : "Auth connected, database not configured yet."}
                  </span>
                </p>
              </div>
            ) : null}

            {authEnabled ? <LogoutButton /> : null}
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
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={16} />
                </button>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900">
                    {meta.title}
                  </h1>
                  <p className="hidden text-xs text-slate-500 sm:block">{meta.subtitle}</p>
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
                  onClick={() => setSettingsOpen(true)}
                  title="Business profile"
                  aria-label="Business profile"
                  className="flex items-center gap-2 rounded-lg border border-slate-200 py-1 pr-2.5 pl-1 text-slate-600 transition hover:bg-slate-50"
                >
                  <Logo
                    src={logoUrl}
                    name={brand}
                    size={26}
                    className="bg-indigo-500 text-[10px] text-white"
                  />
                  <span className="hidden max-w-40 truncate text-xs font-medium text-slate-700 sm:block">
                    {brand}
                  </span>
                  <ChevronDown size={13} className="text-slate-400" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate("notifications")}
                  className="relative rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                  aria-label="Notifications"
                  title="Notifications"
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

      <Modal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Business profile"
        subtitle="Your logo and workspace identity"
        icon={<Building2 size={16} />}
        footer={
          <button type="button" className={btnPrimary} onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        }
      >
        <div className="space-y-5 px-4 py-4">
          <div>
            <p className="mb-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Business logo
            </p>
            <LogoUpload
              logoUrl={logoUrl}
              brandName={brand}
              onPick={(file) => actions.uploadLogo(file)}
              onRemove={() => actions.removeLogo()}
            />
          </div>

          <dl className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Brand name", value: data?.profile.brandName || "—" },
              { label: "Industry", value: data?.profile.industry || "—" },
              { label: "Website", value: data?.profile.primaryDomain || "—" },
              { label: "Alerts to", value: data?.profile.notificationEmail || "—" },
              { label: "Currency", value: data?.profile.currency || "—" },
              { label: "Timezone", value: data?.profile.timezone || "—" },
            ].map((row) => (
              <div key={row.label} className="rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-[10px] tracking-wide text-slate-500 uppercase">{row.label}</dt>
                <dd className="truncate text-xs font-medium text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>

          <p className="text-[11px] text-slate-500">
            Other business details come from your setup answers. Re-run setup from the workspace to
            change suppliers, competitors and clients.
          </p>
        </div>
      </Modal>
    </div>
  );
}
