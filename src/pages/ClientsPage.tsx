import { useMemo, useState } from "react";
import {
  AtSign,
  CalendarClock,
  CheckCircle2,
  Mail,
  MessageSquare,
  Plus,
  Send,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  CheckboxChip,
  EmptyState,
  Field,
  Segmented,
  Stat,
  Td,
  Th,
  btnPrimary,
  inputClass,
} from "../components/ui";
import { useToast } from "../components/Toast";
import { cadenceLabel, daysAhead, money, relativeTime, shortDate, titleCase } from "../lib/format";
import { MESSAGE_TYPES } from "../lib/options";
import { nextSendFrom } from "../lib/schedule";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Client, MailAccount, MessageType, SendFrequency } from "../lib/types";

const FREQUENCIES: { value: SendFrequency; label: string; days: number }[] = [
  { value: "every_2_days", label: "Every 2 days", days: 2 },
  { value: "daily", label: "Daily", days: 1 },
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "monthly", label: "Monthly", days: 30 },
];

const TIER_FEE: Record<Client["tier"], number> = { starter: 180, growth: 320, premium: 480 };

function subjectFor(client: Client, types: MessageType[]): string {
  const primary = types[0] ?? "weekly_report";
  switch (primary) {
    case "new_stock":
      return `New at your suppliers, ${client.company}`;
    case "two_day_checkin":
      return `Mid-week check-in — 3 moves worth knowing`;
    case "platform_info":
      return `New data on your Market Watch desk`;
    case "deals":
      return `Live deals you can promote today`;
    case "competitor_alert":
      return `Competitor alert: price and promo changes`;
    case "review_update":
      return `Review scan: latest customer feedback`;
    default:
      return `Your weekly market watch report`;
  }
}



export function ClientsPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const clients = workspace.clients;
  const sent = workspace.sentMessages;
  const [account, setAccount] = useState<MailAccount>(workspace.mailAccount);

  const [selectedId, setSelectedId] = useState<string>(workspace.clients[0]?.id ?? "");
  const [queued, setQueued] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"active" | "paused" | "prospect" | "all">("active");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    company: "",
    industry: "Beauty & cosmetics",
    tier: "starter" as Client["tier"],
    frequency: "weekly" as SendFrequency,
    messageTypes: ["new_stock", "deals"] as MessageType[],
  });

  const selected = clients.find((c) => c.id === selectedId) ?? clients[0];

  const visible = clients
    .filter((c) => (statusFilter === "all" ? true : c.status === statusFilter))
    .filter((c) =>
      search.trim() === ""
        ? true
        : `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(search.trim().toLowerCase()),
    );

  const dueQueue = useMemo(
    () =>
      [...clients]
        .filter((c) => c.status !== "paused")
        .sort((a, b) => new Date(a.nextSendAt).getTime() - new Date(b.nextSendAt).getTime()),
    [clients],
  );

  const stats = useMemo(() => {
    const active = clients.filter((c) => c.status === "active");
    const avgOpen = active.length
      ? Math.round(active.reduce((sum, c) => sum + c.openRate, 0) / active.length)
      : 0;
    const mrr = active.reduce((sum, c) => sum + c.monthlyFee, 0);
    return { active: active.length, total: clients.length, avgOpen, mrr };
  }, [clients]);

  function updateClient(id: string, patch: Partial<Client>) {
    void actions.updateClient(id, patch);
  }

  function addClient() {
    if (!form.name.trim() || !form.email.trim()) {
      toast("A name and an email address are required.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
      toast("That email address does not look valid.");
      return;
    }
    if (clients.some((c) => c.email.toLowerCase() === form.email.trim().toLowerCase())) {
      toast("That email is already on your customer list.");
      return;
    }
    void actions.addClient({
      name: form.name.trim(),
      email: form.email.trim(),
      company: form.company.trim() || form.name.trim(),
      industry: form.industry,
      tier: form.tier,
      frequency: form.frequency,
      messageTypes: form.messageTypes,
    });
    setForm({
      name: "",
      email: "",
      company: "",
      industry: "Beauty & cosmetics",
      tier: "starter",
      frequency: "weekly",
      messageTypes: ["new_stock", "deals"],
    });
    toast(`${form.name.trim()} added to the active customer list.`);
  }

  function sendTo(ids: string[]) {
    if (!ids.length) {
      toast("Select at least one customer to mail.");
      return;
    }
    void actions.sendMessages(ids);
    setQueued([]);
    toast(`${ids.length} personalised email${ids.length > 1 ? "s" : ""} queued for sending.`);
  }

  function toggleQueued(id: string) {
    setQueued((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleFormMessageType(type: MessageType) {
    setForm((prev) => ({
      ...prev,
      messageTypes: prev.messageTypes.includes(type)
        ? prev.messageTypes.filter((t) => t !== type)
        : [...prev.messageTypes, type],
    }));
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active customers"
          value={stats.active}
          delta={8.3}
          icon={<Users size={16} />}
          hint={`${stats.total} on the list`}
        />
        <Stat
          label="Emails due next 48h"
          value={dueQueue.filter((c) => new Date(c.nextSendAt) < new Date(daysAhead(2))).length}
          icon={<CalendarClock size={16} />}
          hint="auto-sent on the schedule"
        />
        <Stat
          label="Average open rate"
          value={`${stats.avgOpen}%`}
          delta={2.6}
          icon={<Mail size={16} />}
          hint="across active customers"
        />
        <Stat
          label="Recurring revenue"
          value={money(stats.mrr)}
          icon={<CheckCircle2 size={16} />}
          hint="per month from active plans"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead
            icon={<UserPlus size={16} />}
            title="Add a current active customer"
            subtitle="New customers start receiving alerts from their first scheduled send"
          />
          <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Customer name">
              <input
                className={inputClass}
                placeholder="e.g. Amina Yusuf"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Customer email">
              <input
                className={inputClass}
                placeholder="name@theirstore.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Company / store">
              <input
                className={inputClass}
                placeholder="e.g. Glow House Store"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </Field>
            <Field label="Industry">
              <select
                className={inputClass}
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
              >
                {[
                  "Beauty & cosmetics",
                  "Fashion",
                  "Phones & electronics",
                  "Home appliances",
                  "Auto parts",
                ].map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </Field>
            <Field label="Plan">
              <select
                className={inputClass}
                value={form.tier}
                onChange={(e) =>
                  setForm({ ...form, tier: e.target.value as Client["tier"] })
                }
              >
                <option value="starter">Starter — {money(TIER_FEE.starter)}/mo</option>
                <option value="growth">Growth — {money(TIER_FEE.growth)}/mo</option>
                <option value="premium">Premium — {money(TIER_FEE.premium)}/mo</option>
              </select>
            </Field>
            <Field label="Messaging frequency">
              <select
                className={inputClass}
                value={form.frequency}
                onChange={(e) =>
                  setForm({ ...form, frequency: e.target.value as SendFrequency })
                }
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mb-1.5 text-xs font-medium text-slate-600">
                What should this customer receive?
              </p>
              <div className="flex flex-wrap gap-2">
                {MESSAGE_TYPES.map((t) => (
                  <CheckboxChip
                    key={t.value}
                    checked={form.messageTypes.includes(t.value)}
                    onChange={() => toggleFormMessageType(t.value)}
                  >
                    {t.label}
                  </CheckboxChip>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="text-[11px] text-slate-500">
              Login email used to sign in: <span className="font-medium">{account.loginEmail}</span>
            </p>
            <button type="button" className={btnPrimary} onClick={addClient}>
              <Plus size={14} /> Add customer
            </button>
          </div>
        </Card>

        <Card>
          <CardHead
            icon={<Settings2 size={16} />}
            title="My email account"
            subtitle="The mailbox used to log in, send alerts and receive replies"
            action={
              <Badge tone={account.dailyDigest ? "good" : "neutral"}>
                {account.dailyDigest ? "Daily digest on" : "Digest off"}
              </Badge>
            }
          />
          <div className="space-y-3 px-4 py-4">
            <Field label="Sender name">
              <input
                className={inputClass}
                value={account.senderName}
                onChange={(e) => setAccount({ ...account, senderName: e.target.value })}
              />
            </Field>
            <Field label="Login email (alerts are sent from here)" hint="Also the address customers reply to by default">
              <input
                className={inputClass}
                value={account.loginEmail}
                onChange={(e) => setAccount({ ...account, loginEmail: e.target.value })}
              />
            </Field>
            <Field label="Reply-to address">
              <input
                className={inputClass}
                value={account.replyTo}
                onChange={(e) => setAccount({ ...account, replyTo: e.target.value })}
              />
            </Field>
            <Field label="Second email (owner copies)">
              <input
                className={inputClass}
                value={account.secondaryEmail}
                onChange={(e) => setAccount({ ...account, secondaryEmail: e.target.value })}
              />
            </Field>
            <Field label="Timezone">
              <input
                className={inputClass}
                value={account.timezone}
                onChange={(e) => setAccount({ ...account, timezone: e.target.value })}
              />
            </Field>
            <Field label="Email signature">
              <textarea
                className={`${inputClass} h-20 resize-none`}
                value={account.signature}
                onChange={(e) => setAccount({ ...account, signature: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={account.dailyDigest}
                onChange={(e) => setAccount({ ...account, dailyDigest: e.target.checked })}
              />
              Send me a daily digest of everything that was sent
            </label>
            <button
              type="button"
              className={`${btnPrimary} w-full justify-center`}
              onClick={() => {
                void actions.saveMailAccount(account);
                toast("Email account settings saved.");
              }}
            >
              Save email settings
            </button>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHead
            icon={<Users size={16} />}
            title="Customer list"
            subtitle="Everyone who can be mailed, with their schedule"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputClass} max-w-44`}
                  placeholder="Search customers"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Segmented
                  size="sm"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[
                    { value: "active", label: "Active" },
                    { value: "paused", label: "Paused" },
                    { value: "prospect", label: "Prospects" },
                    { value: "all", label: "All" },
                  ]}
                />
              </div>
            }
          />
          {visible.length === 0 ? (
            <EmptyState title="No customers in this view" hint="Add one above or switch the filter." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Customer</Th>
                    <Th>Email</Th>
                    <Th>Status</Th>
                    <Th>Frequency</Th>
                    <Th>Messages</Th>
                    <Th>Next send</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((c) => (
                    <tr
                      key={c.id}
                      className={`cursor-pointer align-top hover:bg-slate-50/70 ${
                        c.id === selectedId ? "bg-indigo-50/40" : ""
                      }`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <Td>
                        <span className="block font-medium text-slate-900">{c.name}</span>
                        <span className="text-[11px] text-slate-500">
                          {c.company} · {c.industry}
                        </span>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1 text-xs text-slate-700">
                          <AtSign size={11} /> {c.email}
                        </span>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            c.status === "active" ? "good" : c.status === "paused" ? "warn" : "info"
                          }
                        >
                          {c.status}
                        </Badge>
                        <span className="mt-1 block text-[11px] text-slate-500">{c.tier} plan</span>
                      </Td>
                      <Td>
                        <select
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs"
                          value={c.frequency}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const frequency = e.target.value as SendFrequency;
                            updateClient(c.id, {
                              frequency,
                              messageTypes: c.messageTypes,
                              nextSendAt: nextSendFrom(frequency, c.messageTypes),
                            });
                          }}
                        >
                          {FREQUENCIES.map((f) => (
                            <option key={f.value} value={f.value}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {c.messageTypes.slice(0, 3).map((t) => (
                            <Badge key={t}>{titleCase(t)}</Badge>
                          ))}
                          {c.messageTypes.length > 3 ? (
                            <Badge tone="brand">+{c.messageTypes.length - 3}</Badge>
                          ) : null}
                        </span>
                      </Td>
                      <Td>
                        <span className="block text-xs text-slate-700">{shortDate(c.nextSendAt)}</span>
                        <span className="text-[11px] text-slate-500">
                          sent {relativeTime(c.lastContacted)}
                        </span>
                      </Td>
                      <Td>
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${c.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void actions.removeClient(c.id);
                            toast(`${c.name} removed from the list.`);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
            <p className="text-[11px] text-slate-500">
              Click a row to edit that customer's message schedule on the right.
            </p>
            <span className="text-[11px] text-slate-400">
              {clients.filter((c) => c.status === "active").length} active of {clients.length} total
            </span>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHead
              icon={<MessageSquare size={16} />}
              title="Message schedule"
              subtitle={selected ? `${selected.name} · ${selected.company}` : "Select a customer"}
            />
            {selected ? (
              <div className="space-y-4 px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-600">Status</span>
                  <Segmented
                    size="sm"
                    value={selected.status}
                    onChange={(v) => updateClient(selected.id, { status: v })}
                    options={[
                      { value: "active", label: "Active" },
                      { value: "paused", label: "Paused" },
                      { value: "prospect", label: "Prospect" },
                    ]}
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">Frequency of messaging</p>
                  <Segmented
                    size="sm"
                    value={selected.frequency}                      onChange={(v) =>
                        updateClient(selected.id, {
                          frequency: v,
                          messageTypes: selected.messageTypes,
                          nextSendAt: nextSendFrom(v, selected.messageTypes),
                        })
                      }
                    options={FREQUENCIES.map((f) => ({ value: f.value, label: f.label }))}
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-600">
                    Type of message they receive
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MESSAGE_TYPES.map((t) => (
                      <CheckboxChip
                        key={t.value}
                        checked={selected.messageTypes.includes(t.value)}
                        onChange={() =>
                          updateClient(selected.id, {
                            messageTypes: selected.messageTypes.includes(t.value)
                              ? selected.messageTypes.filter((x) => x !== t.value)
                              : [...selected.messageTypes, t.value],
                          })
                        }
                      >
                        {t.label}
                      </CheckboxChip>
                    ))}
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {MESSAGE_TYPES.filter((t) => selected.messageTypes.includes(t.value)).map((t) => (
                      <li key={t.value} className="text-[11px] text-slate-500">
                        <span className="font-medium text-slate-700">{t.label}:</span> {t.hint}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  Next send {shortDate(selected.nextSendAt)} · {titleCase(selected.frequency)} cadence
                  · opens {selected.openRate}%
                </div>

                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => sendTo([selected.id])}
                >
                  <Send size={14} /> Send update now
                </button>
              </div>
            ) : (
              <EmptyState title="No customer selected" />
            )}
          </Card>

          <Card>
            <CardHead
              icon={<Send size={16} />}
              title="Customers to mail"
              subtitle="Queue is ordered by the next scheduled send"
              action={
                <button
                  type="button"
                  className={btnPrimary}
                  onClick={() => sendTo(queued.length ? queued : dueQueue.slice(0, 3).map((c) => c.id))}
                >
                  <Send size={13} /> {queued.length ? `Send ${queued.length}` : "Send next 3"}
                </button>
              }
            />
            <ul className="divide-y divide-slate-100">
              {dueQueue.slice(0, 6).map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-slate-300"
                    checked={queued.includes(c.id)}
                    onChange={() => toggleQueued(c.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {c.name} <span className="text-[11px] font-normal text-slate-500">{c.email}</span>
                    </p>
                    <p className="truncate text-[11px] text-slate-600">
                      {subjectFor(c, c.messageTypes)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {cadenceLabel(c.frequency)} · due {shortDate(c.nextSendAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card>
        <CardHead
          icon={<Mail size={16} />}
          title="Recent email activity"
          subtitle={`Sent from ${account.loginEmail} · ${sent.length} messages logged`}
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Customer</Th>
                <Th>Subject</Th>
                <Th>Message types</Th>
                <Th>Sent</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sent.slice(0, 10).map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <Td className="font-medium text-slate-900">{m.clientName}</Td>
                  <Td className="text-xs text-slate-600">{m.subject}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {m.types.map((t) => (
                        <Badge key={t}>{titleCase(t)}</Badge>
                      ))}
                    </span>
                  </Td>
                  <Td className="text-xs text-slate-500">{relativeTime(m.sentAt)}</Td>
                  <Td>
                    <Badge
                      tone={
                        m.status === "clicked"
                          ? "good"
                          : m.status === "opened"
                            ? "info"
                            : m.status === "bounced"
                              ? "bad"
                              : "neutral"
                      }
                    >
                      {m.status}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
