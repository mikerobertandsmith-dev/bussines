import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Binoculars,
  Bot,
  CheckCircle2,
  ChevronDown,
  Globe2,
  Mail,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  X,
} from "lucide-react";
import {
  Badge,
  Card,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  changeTone,
} from "../components/ui";
import { BarList, DeltaPill, ProgressRing, Sparkline } from "../components/charts";
import { sampleWorkspace } from "../data/sample";
import { compact, money, titleCase } from "../lib/format";

/* ---------------------------------------------------------------- content */

const WATCHES = [
  { icon: <Truck size={15} />, label: "Supplier catalogues" },
  { icon: <Binoculars size={15} />, label: "Competitor sites" },
  { icon: <Globe2 size={15} />, label: "Search rankings" },
  { icon: <Bot size={15} />, label: "AI answers" },
  { icon: <MessageSquareQuote size={15} />, label: "Customer reviews" },
  { icon: <TrendingUp size={15} />, label: "Your own traffic" },
];

const SCRAMBLE = [
  "A dozen supplier tabs opened by hand every morning",
  "A competitor promotion you only notice after it ends",
  "A stock-out your customer finds before you do",
  "An AI answer quoting a rival instead of your brand",
];

const WITH_DESK = [
  "One feed of every price, stock and promo change",
  "Alerts the morning a rival campaign goes live",
  "Low-stock warnings before the lead time bites",
  "Weekly SEO and GEO scores, with the gaps to close",
];

const FEED_ROWS = [
  { product: "Velvet Matte Lip Kit", note: "Lumière Cosmetics Supply", chip: "−16.4%", tone: "brand" as const },
  { product: "Hydra Glow Serum 50ml", note: "Lumière Cosmetics Supply", chip: "Restocked", tone: "good" as const },
  { product: "Aurora X5 128GB", note: "Vantage Phone Distributors", chip: "−10.5%", tone: "brand" as const },
];

const STEPS = [
  {
    title: "Create your account",
    body: "Sign up with your work email. No card, nothing to install on your supplier sites.",
  },
  {
    title: "Answer the setup wizard",
    body: "Your domain, the suppliers you buy from, the competitors you sell against. Asked once.",
  },
  {
    title: "Work from the desk",
    body: "Scans run on the cadence you set and only the changes needing a decision reach you.",
  },
];

const FAQ = [
  {
    q: "Which supplier sites can it watch?",
    a: "Any site with a catalogue or product listings — wholesale portals, trade sites and brand catalogues. You add each source during setup and choose how often it is checked.",
  },
  {
    q: "How often does it scan?",
    a: "Per source: daily, weekly or monthly. Daily feeds catch price and stock moves fastest, while weekly and monthly sources are scanned in one batch and summarised.",
  },
  {
    q: "Do my customers see competitor intelligence?",
    a: "No. Competitor alerts stay internal to your desk. You pick what goes out to customers from new stock, deals, check-ins, review updates and the weekly report.",
  },
  {
    q: "Does it send the emails for me?",
    a: "Yes. Alerts go out from the mailbox you configure, with your own signature, and every send is logged so you can see what each customer received.",
  },
  {
    q: "I sell on a marketplace, not my own site.",
    a: "Tell the wizard where you sell. Your scores, traffic and competitor comparisons are tracked against whichever surface you actually trade on.",
  },
];

const NAV = [
  { id: "features", label: "Features" },
  { id: "product", label: "Product" },
  { id: "screens", label: "Screens" },
  { id: "how", label: "How it works" },
  { id: "faq", label: "FAQ" },
];

/** Filled-in sample workspace, so the previews show realistic numbers. */
const DEMO = sampleWorkspace();

/* The workspace screens, previewed with the same components the app renders. */
type ScreenId = "suppliers" | "competition" | "business" | "clients";

const SCREENS: {
  id: ScreenId;
  label: string;
  icon: ReactNode;
  url: string;
  /**
   * Optional real screenshot. Drop a PNG at `public/screenshots/<id>.png` and
   * set this to "/screenshots/<id>.png" to use it instead of the live preview.
   */
  src?: string;
  render: () => ReactNode;
}[] = [
  {
    id: "suppliers",
    label: "Suppliers",
    icon: <Truck size={13} />,
    url: "market-watch.app/#/suppliers",
    render: () => <SuppliersScreen />,
  },
  {
    id: "competition",
    label: "Competition",
    icon: <Binoculars size={13} />,
    url: "market-watch.app/#/competition",
    render: () => <CompetitionScreen />,
  },
  {
    id: "business",
    label: "My Business",
    icon: <BarChart3 size={13} />,
    url: "market-watch.app/#/business",
    render: () => <BusinessScreen />,
  },
  {
    id: "clients",
    label: "Clients",
    icon: <Users size={13} />,
    url: "market-watch.app/#/clients",
    render: () => <ClientsScreen />,
  },
];

/* ------------------------------------------------------------------ page */

export function LandingPage() {
  const [screen, setScreen] = useState<ScreenId>("suppliers");
  const active = SCREENS.find((s) => s.id === screen) ?? SCREENS[0];

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* ------------------------------------------------------------- nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
              <ShieldCheck size={18} />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">Market Watch</span>
              <span className="block text-[11px] text-slate-500">Supplier &amp; competitor desk</span>
            </span>
          </a>

          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex" aria-label="Sections">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => jump(item.id)}
                className="transition hover:text-indigo-600"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="/sign-in"
              className="hidden text-sm font-medium text-slate-600 transition hover:text-indigo-600 sm:block"
            >
              Sign in
            </a>
            <a href="/sign-up" className={btnPrimary}>
              Start free <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden">
        <div className="mw-grid pointer-events-none absolute inset-0 -z-10 opacity-70" />
        <div className="pointer-events-none absolute -top-32 -right-24 -z-10 h-80 w-80 rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-80 w-80 rounded-full bg-teal-100/50 blur-3xl" />

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
          <div className="mw-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/80 px-3 py-1 text-[11px] font-medium text-indigo-700 shadow-sm">
              <Sparkles size={12} /> Supplier, competitor and client monitoring
            </span>

            <h1 className="mt-5 text-[2rem] font-semibold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
              Know what your suppliers and competitors did —{" "}
              <span className="bg-gradient-to-r from-indigo-600 to-teal-500 bg-clip-text text-transparent">
                before your customers do
              </span>
              .
            </h1>

            <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-600">
              Market Watch scans the supplier sites you buy from, the rivals you sell against and
              your own search visibility, then tells you what changed and what to do about it.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="/sign-up" className={`${btnPrimary} px-5 py-2.5 text-[15px]`}>
                Start free <ArrowRight size={15} />
              </a>
              <a href="/sign-in" className={`${btnGhost} px-5 py-2.5 text-[15px]`}>
                I already have an account
              </a>
            </div>

            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              {["No card to start", "One setup wizard", "Works with your existing suppliers"].map(
                (item) => (
                  <li key={item} className="flex items-center gap-2 text-xs text-slate-600">
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>

          <HeroPreview />
        </div>
      </section>

      {/* ------------------------------------------------------- what it watches */}
      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
              Watching for you
            </p>
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-3">
              {WATCHES.map((w) => (
                <li key={w.label} className="flex items-center gap-2 text-xs font-medium text-slate-600">
                  <span className="text-indigo-600">{w.icon}</span>
                  {w.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- problem / outcome */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
            The morning scramble
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Monitoring is a full-time job nobody has time for.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            Checking suppliers, competitors and your own visibility by hand costs hours a week — and
            still misses the changes that matter most.
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Doing it by hand
            </p>
            <ul className="mt-4 space-y-3">
              {SCRAMBLE.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-slate-600">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                    <X size={12} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-6">
            <p className="text-xs font-semibold tracking-wide text-indigo-700 uppercase">
              On the Market Watch desk
            </p>
            <ul className="mt-4 space-y-3">
              {WITH_DESK.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                    <CheckCircle2 size={12} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ product */}
      <section id="product" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
              Inside the desk
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Three signals that pay for themselves.
            </h2>
          </div>

          <div className="mt-12 space-y-14">
            <DeepDive
              eyebrow="Supplier feeds"
              icon={<Truck size={15} />}
              title="Every supplier change, ranked by what it costs you."
              body="Buy prices, new SKUs, restocks and promotions are captured from the sites you already buy from — then turned into a suggested action with the margin already worked out."
              points={[
                "Buy-price moves with the percentage in either direction",
                "Stock changes that unlock a waiting list",
                "Lead time and minimum order on every row",
              ]}
              mock={
                <Card className="overflow-hidden">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Truck size={15} className="text-indigo-600" /> Supplier feed
                    </span>
                    <Badge tone="brand">3 new</Badge>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {FEED_ROWS.map((row) => (
                      <li
                        key={row.product}
                        className="flex items-center justify-between gap-3 px-4 py-3"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {row.product}
                          </span>
                          <span className="block truncate text-[11px] text-slate-500">
                            {row.note}
                          </span>
                        </span>
                        <Badge tone={row.tone}>{row.chip}</Badge>
                      </li>
                    ))}
                  </ul>
                </Card>
              }
            />

            <DeepDive
              reverse
              eyebrow="Competitor watch"
              icon={<Binoculars size={15} />}
              title="See the move, and the playbook behind it."
              body="Traffic, keyword gaps, live ad campaigns, social channels and customer reviews are tracked per competitor — so you can copy what works and skip what does not."
              points={[
                "Where their visitors actually come from",
                "Keywords they rank for and you do not",
                "Ads, audiences and review sentiment shifts",
              ]}
              mock={
                <Card className="p-5">
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Where their traffic comes from
                  </p>
                  <div className="mt-3">
                    <BarList
                      data={[
                        { label: "Organic search", value: 46 },
                        { label: "Paid social", value: 24 },
                        { label: "Direct", value: 16 },
                        { label: "Email", value: 9 },
                      ]}
                      color="#0ea5e9"
                      valueFormat={(n) => `${n}%`}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-600">Their monthly visits</span>
                    <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      412,500 <DeltaPill value={12.4} />
                    </span>
                  </div>
                </Card>
              }
            />

            <DeepDive
              eyebrow="Your own scores"
              icon={<BarChart3 size={15} />}
              title="Your side of the board, scored every week."
              body="SEO and AI-answer visibility are scored against the same terms your buyers use, with the ranking gaps, traffic trend and industry rank you would otherwise pay an agency for."
              points={[
                "Weekly SEO and GEO score with the week-on-week move",
                "The tracked terms you are close to winning",
                "In-industry rank and the stock worth buying next",
              ]}
              mock={
                <Card className="p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col items-center">
                      <ProgressRing value={74} size={68} stroke={8} color="#4f46e5" />
                      <p className="mt-2 text-[11px] font-medium text-slate-500">SEO score</p>
                    </div>
                    <div className="flex flex-col items-center">
                      <ProgressRing value={61} size={68} stroke={8} color="#0d9488" />
                      <p className="mt-2 text-[11px] font-medium text-slate-500">AI visibility</p>
                    </div>
                  </div>
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span>Monthly visits</span>
                      <span className="text-sm font-semibold text-slate-900">184,300</span>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Sparkline
                        values={[128_000, 139_500, 149_200, 161_000, 168_900, 184_300]}
                        color="#4f46e5"
                      />
                    </div>
                  </div>
                </Card>
              }
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- screens */}
      <section id="screens" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
              The screens
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Every screen, before you sign up.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              The real workspace layouts, shown with sample data. Pick a screen and look around.
            </p>
          </div>

          <div className="mt-8">
            <Tabs
              value={screen}
              onChange={setScreen}
              options={SCREENS.map((s) => ({ value: s.id, label: s.label, icon: s.icon }))}
            />
          </div>

          <div className="mt-5">
            <WindowFrame url={active.url} badge={<Badge tone="neutral">sample data</Badge>}>
              {active.src ? (
                <img
                  src={active.src}
                  alt={`${active.label} screen in the Market Watch workspace`}
                  className="w-full"
                />
              ) : (
                active.render()
              )}
            </WindowFrame>
          </div>

          <p className="mt-3 text-[11px] text-slate-500">
            Screens shown with sample data. Your own workspace fills in as soon as your first scan
            completes.
          </p>
        </div>
      </section>

      {/* --------------------------------------------------------- other wins */}
      <section id="features" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
              Also on the desk
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              The rest of the working day, handled.
            </h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: <Bell size={17} />,
                title: "One notifications desk",
                body: "Every price, stock, ad and review alert in a single ranked list — not six inboxes to reconcile.",
              },
              {
                icon: <Mail size={17} />,
                title: "Client messaging",
                body: "Send the moves worth knowing to your own customers, from your mailbox, on one shared cadence.",
              },
              {
                icon: <ShoppingCart size={17} />,
                title: "A buy list, not a hunch",
                body: "Ranked stock suggestions built from supplier price drops and competitor traffic potential.",
              },
              {
                icon: <MessageSquareQuote size={17} />,
                title: "Review scans",
                body: "New customer reviews across the platforms that matter, with the ones needing a reply flagged.",
              },
              {
                icon: <Users size={17} />,
                title: "A customer list that keeps itself current",
                body: "Status, plan and the last time each customer heard from you, in one table.",
              },
              {
                icon: <ShieldCheck size={17} />,
                title: "Your data stays yours",
                body: "Everything is stored in your own workspace, behind your own sign-in. Nothing is shared between desks.",
              },
            ].map((feature) => (
              <Card key={feature.title} className="p-5 transition hover:border-indigo-200 hover:shadow-sm">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  {feature.icon}
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">{feature.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{feature.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ how it works */}
      <section id="how" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
              How it works
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Three steps, then it runs itself.
            </h2>
          </div>

          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative rounded-2xl border border-slate-200 bg-white p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-sm font-semibold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -------------------------------------------------------------- faq */}
      <section id="faq" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="text-center">
            <p className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
              Questions
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Before you sign up.
            </h2>
          </div>

          <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-slate-900 marker:hidden">
                  {item.q}
                  <ChevronDown
                    size={16}
                    className="shrink-0 text-slate-400 transition group-open:rotate-180"
                  />
                </summary>
                <p className="mt-2 max-w-2xl text-xs leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- cta */}
      <section id="start" className="relative overflow-hidden bg-slate-900">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:py-20">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Start your desk and see this week&apos;s moves.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            Tell us about your business once. Your dashboard fills with supplier changes, competitor
            signals, your own scores and the messages your customers should receive.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a href="/sign-up" className={`${btnPrimary} px-5 py-2.5 text-[15px]`}>
              Start free <ArrowRight size={15} />
            </a>
            <a
              href="/sign-in"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-5 py-2.5 text-[15px] font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Sign in
            </a>
          </div>
          <p className="mt-5 text-[11px] text-slate-500">
            No credit card · Cancel whenever you like · Your workspace, your data
          </p>
        </div>
      </section>

      {/* ----------------------------------------------------------- footer */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
                  <ShieldCheck size={18} />
                </span>
                <span className="text-sm font-semibold text-slate-900">Market Watch</span>
              </div>
              <p className="mt-3 max-w-sm text-xs leading-relaxed text-slate-500">
                A supplier, competitor and client monitoring workspace for retail teams — one desk
                instead of a dozen open tabs.
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-900 uppercase">Product</p>
              <ul className="mt-3 space-y-2 text-xs text-slate-500">
                {NAV.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => jump(item.id)}
                      className="transition hover:text-indigo-600"
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-wide text-slate-900 uppercase">Account</p>
              <ul className="mt-3 space-y-2 text-xs text-slate-500">
                <li>
                  <a href="/sign-up" className="transition hover:text-indigo-600">
                    Create account
                  </a>
                </li>
                <li>
                  <a href="/sign-in" className="transition hover:text-indigo-600">
                    Sign in
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
            <p className="text-[11px] text-slate-400">
              © {new Date().getFullYear()} Market Watch. Supplier &amp; competitor monitoring.
            </p>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Search size={11} /> SEO · GEO · supplier · competitor · client signals
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------ sub-views */

/** A miniature of the real dashboard, built from the app's own primitives. */
function HeroPreview() {
  return (
    <div className="mw-rise-slow relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-indigo-200/50 via-white to-teal-100/60 blur-2xl" />

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
        {/* window chrome */}
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
          </span>
          <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-white px-2.5 py-1 text-[10px] text-slate-400 ring-1 ring-slate-200">
            market-watch.app/#/suppliers
          </span>
          <Badge tone="good">live</Badge>
        </div>

        <div className="flex">
          {/* rail */}
          <div className="hidden w-14 shrink-0 flex-col items-center gap-2.5 bg-slate-900 py-4 sm:flex">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-white">
              <ShieldCheck size={15} />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Truck size={15} />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Binoculars size={15} />
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Mail size={15} />
            </span>
            <span className="mt-auto flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400">
              <Bell size={15} />
            </span>
          </div>

          {/* body */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-slate-900">Supplier updates</p>
                <p className="truncate text-[10px] text-slate-500">What changed since yesterday</p>
              </div>
              <Badge tone="brand">4 changes</Badge>
            </div>

            <ul className="divide-y divide-slate-100">
              {FEED_ROWS.map((row) => (
                <li key={row.product} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-900">
                      {row.product}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">{row.note}</span>
                  </span>
                  <Badge tone={row.tone}>{row.chip}</Badge>
                </li>
              ))}
            </ul>

            <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 bg-slate-50/70">
              {[
                { label: "Rival traffic", value: "412k" },
                { label: "Your SEO", value: "74" },
                { label: "Rank", value: "#6" },
              ].map((cell) => (
                <div key={cell.label} className="px-3 py-2.5">
                  <p className="truncate text-[9px] tracking-wide text-slate-500 uppercase">
                    {cell.label}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-slate-900">{cell.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[10px] text-slate-500">
              <span>Next scan in 3 hours</span>
              <span className="flex items-center gap-1 font-medium text-indigo-600">
                <Sparkles size={11} /> 4 need a decision
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Alternating text + product mock row. */
function DeepDive({
  eyebrow,
  icon,
  title,
  body,
  points,
  mock,
  reverse = false,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
  mock: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
      <div className={reverse ? "lg:order-2" : undefined}>
        <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">
          {icon}
          {eyebrow}
        </span>
        <h3 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {title}
        </h3>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{body}</p>
        <ul className="mt-5 space-y-2">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-sm text-slate-600">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-600" />
              {point}
            </li>
          ))}
        </ul>
      </div>

      <div className={reverse ? "lg:order-1" : undefined}>{mock}</div>
    </div>
  );
}

/** App window chrome used by the screen gallery. */
function WindowFrame({
  url,
  badge,
  children,
}: {
  url: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="ml-2 min-w-0 flex-1 truncate rounded-md bg-white px-2.5 py-1 text-[10px] text-slate-400 ring-1 ring-slate-200">
          {url}
        </span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value, delta }: { label: string; value: ReactNode; delta?: number }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-xl font-semibold text-slate-900">
        {value}
        {delta !== undefined ? <DeltaPill value={delta} /> : null}
      </p>
    </div>
  );
}

function RingTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
      <ProgressRing value={value} size={46} stroke={6} color={color} />
      <div className="min-w-0">
        <p className="text-[10px] tracking-wide text-slate-500 uppercase">{label}</p>
        <p className="text-lg font-semibold text-slate-900">{value}/100</p>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- screen mocks */

function SuppliersScreen() {
  const items = DEMO.supplierItems;
  const suppliers = DEMO.suppliers;
  const stats = [
    { label: "Suppliers monitored", value: suppliers.length },
    { label: "New items", value: items.filter((i) => i.change === "new_product").length },
    {
      label: "Price drops",
      value: items.filter((i) => i.change === "price_change" && i.price < i.previousPrice).length,
    },
    {
      label: "Back in stock",
      value: items.filter((i) => i.change === "stock_change" && i.stock !== "out_of_stock")
        .length,
    },
  ];

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <MiniStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-slate-50">
            <tr>
              <Th>Product</Th>
              <Th>Supplier</Th>
              <Th>Change</Th>
              <Th className="text-right">Buy price</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.slice(0, 4).map((item) => (
              <tr key={item.id}>
                <Td>
                  <span className="block text-xs font-medium text-slate-900">{item.product}</span>
                  <span className="text-[10px] text-slate-500">{item.sku}</span>
                </Td>
                <Td className="text-xs text-slate-700">
                  {suppliers.find((s) => s.id === item.supplierId)?.name ?? "—"}
                </Td>
                <Td>
                  <Badge tone={changeTone[item.change]}>{titleCase(item.change)}</Badge>
                </Td>
                <Td className="text-right text-xs font-semibold text-slate-900">
                  {money(item.price)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CompetitionScreen() {
  const competitor = DEMO.competitors[0];

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-slate-900">Watching</span>
        {DEMO.competitors.map((c) => (
          <span
            key={c.id}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ${
              c.id === competitor.id
                ? "bg-indigo-600 text-white ring-indigo-600"
                : "bg-white text-slate-600 ring-slate-300"
            }`}
          >
            {c.name}
          </span>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          label="Their traffic"
          value={compact(competitor.monthlyVisits)}
          delta={competitor.visitsChange}
        />
        <MiniStat label="SEO score" value={competitor.seoScore} />
        <MiniStat label="GEO score" value={competitor.geoScore} />
        <MiniStat label="Rating" value={competitor.rating.toFixed(1)} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] tracking-wide text-slate-500 uppercase">Traffic sources</p>
          <div className="mt-2">
            <BarList
              data={competitor.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
              color="#0ea5e9"
              valueFormat={(n) => `${n}%`}
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-[10px] tracking-wide text-slate-500 uppercase">Live campaigns</p>
          <ul className="mt-2 space-y-2">
            {competitor.ads.slice(0, 2).map((ad) => (
              <li key={ad.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                <p className="text-[11px] font-medium text-slate-800">{ad.headline}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {ad.platform} · {ad.status}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function BusinessScreen() {
  const metrics = DEMO.metrics;

  return (
    <div className="p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RingTile label="SEO score" value={metrics.seoScore} color="#4f46e5" />
        <RingTile label="GEO / AI visibility" value={metrics.geoScore} color="#0d9488" />
        <MiniStat
          label="Website traffic"
          value={compact(metrics.monthlyVisits)}
          delta={metrics.visitsChange}
        />
        <MiniStat label="Industry rank" value={`#${metrics.industryRank}`} />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead className="bg-slate-50">
            <tr>
              <Th>Tracked keyword</Th>
              <Th className="text-right">Volume</Th>
              <Th className="text-right">Position</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {DEMO.topSeoKeywords.slice(0, 4).map((row) => (
              <tr key={row.keyword}>
                <Td className="text-xs text-slate-700">{row.keyword}</Td>
                <Td className="text-right text-xs text-slate-600">
                  {row.volume.toLocaleString()}
                </Td>
                <Td className="text-right">
                  <Badge tone={row.position <= 3 ? "good" : row.position <= 10 ? "info" : "neutral"}>
                    #{row.position}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-slate-500">
        {DEMO.profile.primaryDomain} · {metrics.indexedPages.toLocaleString()} pages
        indexed · domain authority {metrics.domainAuthority}
      </p>
    </div>
  );
}

function ClientsScreen() {
  const clients = DEMO.clients;

  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat
          label="Active customers"
          value={clients.filter((c) => c.status === "active").length}
        />
        <MiniStat label="On the list" value={clients.length} />
        <MiniStat label="Send cadence" value="Weekly" />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-slate-50">
            <tr>
              <Th>Customer</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th className="text-right">Open rate</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {clients.slice(0, 4).map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="block text-xs font-medium text-slate-900">{c.name}</span>
                  <span className="text-[10px] text-slate-500">{c.company}</span>
                </Td>
                <Td className="text-xs text-slate-600">{c.email}</Td>
                <Td>
                  <Badge
                    tone={
                      c.status === "active" ? "good" : c.status === "paused" ? "warn" : "info"
                    }
                  >
                    {c.status}
                  </Badge>
                </Td>
                <Td className="text-right text-xs font-semibold text-slate-900">{c.openRate}%</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
