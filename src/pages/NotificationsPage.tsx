import { useMemo, useState } from "react";
import { Bell, BellRing, ChevronRight, Eye } from "lucide-react";
import { Badge, Card, CardHead, EmptyState, Segmented, Stat } from "../components/ui";
import { buildAlerts } from "../lib/alerts";
import type { RouteId } from "../lib/hooks";
import { useWorkspaceData } from "../lib/workspace";

type NotifFilter = "all" | "urgent" | "watch";

const FILTERS: { value: NotifFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "watch", label: "Watch" },
];

const PAGE_LABEL: Record<RouteId, string> = {
  suppliers: "Suppliers",
  competition: "Competition",
  clients: "Clients",
  business: "My business",
  notifications: "Notifications",
};

const SEVERITY_TONE = { urgent: "bad", watch: "warn", info: "info" } as const;

const DOT_CLASS: Record<string, string> = {
  urgent: "bg-rose-500",
  watch: "bg-amber-500",
  info: "bg-sky-500",
};

/** Everything the scans flagged, in one place, filterable by urgency. */
export function NotificationsPage() {
  const workspace = useWorkspaceData();
  const alerts = useMemo(() => buildAlerts(workspace), [workspace]);
  const [filter, setFilter] = useState<NotifFilter>("all");

  const urgent = alerts.filter((a) => a.severity === "urgent").length;
  const watch = alerts.filter((a) => a.severity === "watch").length;
  const visible = alerts.filter((a) => (filter === "all" ? true : a.severity === filter));

  function open(page: RouteId) {
    window.location.hash = `/${page}`;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Needs action"
          value={urgent}
          icon={<BellRing size={16} />}
          hint="urgent alerts waiting"
        />
        <Stat label="On watch" value={watch} icon={<Eye size={16} />} hint="worth a look this week" />
        <Stat
          label="All notifications"
          value={alerts.length}
          icon={<Bell size={16} />}
          hint="across every source"
        />
      </div>

      <Card>
        <CardHead
          icon={<Bell size={16} />}
          title="Notifications"
          subtitle="Everything your scans raised, newest first"
          action={
            <Segmented size="sm" value={filter} onChange={setFilter} options={FILTERS} />
          }
        />

        {visible.length === 0 ? (
          <EmptyState
            title={alerts.length ? "Nothing in this view" : "No notifications yet"}
            hint={
              alerts.length
                ? "Switch the filter to see the rest of your alerts."
                : "Alerts appear here as soon as a scan finds a price, stock, ad or review change."
            }
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => open(a.page)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50/70"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[a.severity]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-900">{a.title}</span>
                      <Badge tone={SEVERITY_TONE[a.severity]}>{a.severity}</Badge>
                      <Badge>{PAGE_LABEL[a.page]}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-600">{a.detail}</span>
                  </span>
                  <ChevronRight size={14} className="mt-1 shrink-0 text-slate-400" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
          Open a notification to jump to the page that raised it. Alerts clear themselves once the
          underlying price, stock or campaign changes again.
        </div>
      </Card>
    </div>
  );
}
