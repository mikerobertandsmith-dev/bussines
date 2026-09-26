import { useMemo, useState } from "react";
import {
  Binoculars,
  Download,
  ExternalLink,
  Globe2,
  Image as ImageIcon,
  Megaphone,
  MessageSquareQuote,
  Package,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Segmented,
  SiteLogo,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { AreaChart, BarList, DeltaPill, Stars } from "../components/charts";
import { StatusStatGrid, type StatStatus } from "../components/insights";
import { useToast } from "../components/Toast";
import { compact, daysAgo, money, relativeTime, shortDate, titleCase } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Cadence, KeywordGap } from "../lib/types";

type CompetitionTab = "overview" | "inventory" | "keywords" | "ads" | "reviews" | "social";

const CADENCE_OPTIONS = [
  { value: "daily" as Cadence, label: "Daily" },
  { value: "weekly" as Cadence, label: "Weekly" },
  { value: "monthly" as Cadence, label: "Monthly" },
];

type KeywordFilter = "all" | "high" | "none";

const KEYWORD_TABS: { value: KeywordFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "high", label: "Top opportunity" },
  { value: "none", label: "We already rank" },
];

function opportunity(k: KeywordGap) {
  const gap = k.ourRank === null ? 100 : k.ourRank - k.theirRank;
  return Math.round((k.volume / 1000) * Math.max(0, gap) * (1 - k.difficulty / 130));
}

export function CompetitionPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();
  const competitors = workspace.competitors;
  const myBusiness = workspace.metrics;
  const [activeId, setActiveId] = useState<string>(competitors[0]?.id ?? "");
  const [tab, setTab] = useState<CompetitionTab>("overview");
  const [keywordFilter, setKeywordFilter] = useState<KeywordFilter>("all");
  const [query, setQuery] = useState("");

  const competitor = competitors.find((c) => c.id === activeId) ?? competitors[0];
  const cadence = competitor?.cadence ?? "daily";

  const keywords = useMemo(() => {
    if (!competitor) return [];
    const rows = [...competitor.keywordGap].sort((a, b) => opportunity(b) - opportunity(a));
    return rows.filter((k) => {
      if (keywordFilter === "high") return opportunity(k) > 20;
      if (keywordFilter === "none") return k.ourRank !== null;
      return true;
    });
  }, [competitor, keywordFilter]);

  if (!competitor) {
    return (
      <Card>
        <CardHead
          icon={<Binoculars size={16} />}
          title="No competitors yet"
          subtitle="Add the businesses you track and we will compare their traffic, keywords, ads, socials and reviews against yours"
        />
        <EmptyState
          title="Nothing is being monitored"
          hint="Add competitor websites from your business settings, then come back once the first scan completes."
        />
      </Card>
    );
  }

  const inventory = competitor.newItems.filter((i) =>
    query.trim() === ""
      ? true
      : `${i.product} ${i.category}`.toLowerCase().includes(query.toLowerCase()),
  );

  const activeAds = competitor.ads.filter((a) => a.status === "active").length;
  const negativeReviews = competitor.reviews.filter((r) => r.sentiment === "negative").length;
  const mySocial = myBusiness.trafficSources.find((s) => /social|instagram|paid/i.test(s.label));
  const theirSocial = competitor.trafficSources.find((s) =>
    /social|instagram|paid/i.test(s.label),
  );
  const ratingChange = Number(
    (((competitor.rating - competitor.previousRating) / competitor.previousRating) * 100).toFixed(1),
  );
  const trafficShare = myBusiness.monthlyVisits / Math.max(1, competitor.monthlyVisits);
  const trafficStatus: StatStatus =
    trafficShare >= 0.9 ? "within" : trafficShare >= 0.5 ? "observe" : "critical";

  function createOriginalAd(headline: string) {
    toast(
      `Ad brief drafted from "${headline}" — open Promotions to review it and send it to the design team.`,
    );
  }

  return (
    <div className="space-y-5">
      {/* Pick who you are comparing against, then set the scan cadence. */}
      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Binoculars size={16} className="text-indigo-600" /> Watching
          </span>

          {competitors.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              className={`flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-xs font-medium ring-1 transition ${
                c.id === competitor.id
                  ? "bg-indigo-600 text-white ring-indigo-600"
                  : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"
              }`}
            >
              <SiteLogo website={c.website} name={c.name} size={22} />
              {c.name}
            </button>
          ))}

          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">Scan cadence</span>
            <Segmented
              size="sm"
              options={CADENCE_OPTIONS}
              value={cadence}
              onChange={(v) => {
                void actions.setCompetitorCadence(competitor.id, v);
                toast(`${competitor.name} will now be scanned ${v}.`);
              }}
            />
            <button
              type="button"
              className={btnGhost}
              onClick={() => {
                void actions.scanCompetitor(competitor.id);
                toast(`Scan queued for ${competitor.name} — results land with the next job run.`);
              }}
            >
              <RefreshCw size={13} /> Scan now
            </button>
          </span>
        </div>
      </Card>

      <StatusStatGrid
        items={[
          {
            name: "Their monthly traffic",
            stat: compact(competitor.monthlyVisits),
            meta: `yours: ${compact(myBusiness.monthlyVisits)}`,
            progressLabel: "Your share of their traffic",
            progress: myBusiness.monthlyVisits / Math.max(1, competitor.monthlyVisits),
            status: trafficStatus,
            hint: "Open traffic breakdown",
          },
          {
            name: "SEO score",
            stat: competitor.seoScore,
            meta: `yours: ${myBusiness.seoScore} · GEO ${competitor.geoScore} vs ${myBusiness.geoScore}`,
            progressLabel: "Their tracked-term coverage",
            progress: competitor.seoScore / 100,
            status: myBusiness.seoScore >= competitor.seoScore ? "within" : "observe",
            hint: "Compare SEO",
          },
          {
            name: "Active ad campaigns",
            stat: activeAds,
            meta: competitor.adPlatforms.join(", ") || "no platforms reported",
            progressLabel: "Campaign feed coverage",
            progress: activeAds / 8,
            status: activeAds > 0 ? "observe" : "within",
            hint: "See campaigns",
          },
          {
            name: "Rating (2 months)",
            stat: competitor.rating.toFixed(1),
            meta: `${competitor.reviewsThisMonth} new · ${negativeReviews} negative`,
            progressLabel: "Rating out of 5",
            progress: competitor.rating / 5,
            status: competitor.rating >= 4.3 ? "within" : "critical",
            hint: "Read reviews",
          },
        ]}
      />

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview", icon: <Globe2 size={13} /> },
          {
            value: "inventory",
            label: "New inventory",
            icon: <Package size={13} />,
            count: competitor.newItems.length,
          },
          {
            value: "keywords",
            label: "Keywords",
            icon: <Search size={13} />,
            count: competitor.keywordGap.length,
          },
          {
            value: "ads",
            label: "Ads",
            icon: <Megaphone size={13} />,
            count: activeAds,
          },
          { value: "reviews", label: "Reviews", icon: <MessageSquareQuote size={13} /> },
          { value: "social", label: "Social", icon: <Share2 size={13} /> },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead
              icon={<Globe2 size={16} />}
              title={`${competitor.name} traffic and where it comes from`}
              subtitle={`Last scan ${relativeTime(competitor.lastScan)} · ${competitor.website.replace(/^https?:\/\//, "")}`}
              action={
                <a href={competitor.website} target="_blank" rel="noreferrer" className={btnGhost}>
                  Visit site <ExternalLink size={13} />
                </a>
              }
            />
            <div className="grid gap-5 px-4 py-4 md:grid-cols-2">
              <AreaChart data={competitor.traffic} color="#4f46e5" />
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Traffic sources
                </p>
                <BarList
                  data={competitor.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
                  valueFormat={(n) => `${n}%`}
                  color="#0ea5e9"
                />
                <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  You lead on paid social ({mySocial?.share ?? 0}% vs {theirSocial?.share ?? 0}%).
                  {competitor.trafficSources[0]
                    ? ` Their strength is ${competitor.trafficSources[0].label.toLowerCase()} at ${competitor.trafficSources[0].share}% — that is where new stock content pays back fastest.`
                    : " Run a scan to see where their traffic comes from."}
                </div>
              </div>
            </div>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHead
                icon={<Users size={16} />}
                title="Target audience on their ads"
                subtitle="Segments their campaigns are aimed at"
              />
              <div className="px-4 py-4">
                <BarList
                  data={competitor.audience.map((a) => ({ label: a.segment, value: a.share }))}
                  valueFormat={(n) => `${n}%`}
                  color="#7c3aed"
                />
                <ul className="mt-4 space-y-2">
                  {competitor.audience.map((a) => (
                    <li key={a.segment} className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Age band</span>
                      <span className="font-medium text-slate-700">{a.ageRange}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>

            <Card>
              <CardHead
                icon={<Target size={16} />}
                title="Suggested move this week"
                subtitle="Built from the traffic, keyword and review signals"
              />
              <ul className="space-y-2 px-4 py-4 text-xs text-slate-700">
                <li className="rounded-lg bg-slate-50 px-3 py-2">
                  Publish a comparison page for{" "}
                  <span className="font-medium">{keywords[0]?.keyword ?? "their best term"}</span> —
                  they hold position {keywords[0]?.theirRank ?? 2}.
                </li>
                <li className="rounded-lg bg-slate-50 px-3 py-2">
                  Answer the delivery complaint in their reviews with faster-dispatch messaging on
                  your own ads.
                </li>
                <li className="rounded-lg bg-slate-50 px-3 py-2">
                  Post {Math.max(3, (competitor.social[0]?.postsPerWeek ?? 6) - 3)} extra posts a week
                  on {competitor.social[0]?.platform ?? "Instagram"} to close the cadence gap.
                </li>
              </ul>
              <div className="border-t border-slate-100 px-4 py-3">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() =>
                    toast(`Weekly ${competitor.name} brief queued for the next client email.`)
                  }
                >
                  <Download size={13} /> Queue brief for clients
                </button>
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {tab === "inventory" ? (
        <Card>
          <CardHead
            icon={<Package size={16} />}
            title="New inventory they listed"
            subtitle="New products and restocks detected on their website"
            action={
              <input
                className={`${inputClass} max-w-44`}
                placeholder="Search inventory"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            }
          />
          {inventory.length === 0 ? (
            <EmptyState
              title="Nothing matched that search"
              hint="Clear the search box to see every product the last scan found."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Their price</Th>
                    <Th>Stock</Th>
                    <Th>Detected</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inventory.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/70">
                      <Td className="font-medium text-slate-900">{item.product}</Td>
                      <Td className="text-xs text-slate-500">{item.category}</Td>
                      <Td className="text-right font-medium">{money(item.price)}</Td>
                      <Td>
                        <Badge
                          tone={
                            item.stock === "in_stock"
                              ? "good"
                              : item.stock === "low_stock"
                                ? "warn"
                                : "bad"
                          }
                        >
                          {titleCase(item.stock)}
                        </Badge>
                      </Td>
                      <Td className="text-xs text-slate-500">{relativeTime(item.detectedAt)}</Td>
                      <Td>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          View <ExternalLink size={12} />
                        </a>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "keywords" ? (
        <Card>
          <CardHead
            icon={<Search size={16} />}
            title="Keyword & SEO gap vs your platform"
            subtitle="Terms they rank for that you do not — ranked by traffic you could win"
            action={
              <Segmented
                size="sm"
                options={KEYWORD_TABS}
                value={keywordFilter}
                onChange={setKeywordFilter}
              />
            }
          />
          {keywords.length === 0 ? (
            <EmptyState
              title="No keywords in this filter"
              hint="Switch to “All” to see every tracked term."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Keyword</Th>
                    <Th className="text-right">Volume</Th>
                    <Th className="text-center">Them</Th>
                    <Th className="text-center">You</Th>
                    <Th className="text-center">Difficulty</Th>
                    <Th className="text-right">Opportunity</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {keywords.map((k) => {
                    const score = opportunity(k);
                    return (
                      <tr key={k.keyword} className="hover:bg-slate-50/70">
                        <Td>
                          <span className="block font-medium text-slate-900">{k.keyword}</span>
                          <span className="text-[11px] text-slate-500">{titleCase(k.intent)}</span>
                        </Td>
                        <Td className="text-right">{k.volume.toLocaleString()}</Td>
                        <Td className="text-center font-medium text-slate-900">#{k.theirRank}</Td>
                        <Td className="text-center">
                          {k.ourRank === null ? (
                            <span className="text-xs font-medium text-rose-600">not ranking</span>
                          ) : (
                            <span className="text-slate-700">#{k.ourRank}</span>
                          )}
                        </Td>
                        <Td className="text-center text-xs text-slate-500">{k.difficulty}</Td>
                        <Td className="text-right">
                          <Badge tone={score > 40 ? "bad" : score > 20 ? "warn" : "neutral"}>
                            {score > 40 ? "Act now" : score > 20 ? "Worth a page" : "Watch"}
                          </Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Opportunity score = monthly volume × ranking gap ÷ keyword difficulty. Highest scores are
            the pages to publish this week.
          </div>
        </Card>
      ) : null}

      {tab === "ads" ? (
        <Card>
          <CardHead
            icon={<Megaphone size={16} />}
            title="Their ads and where they post them"
            subtitle="Banner links are captured for reference only — never copy a competitor's creative"
          />
          <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
            {competitor.adPlatforms.map((p) => (
              <Badge key={p} tone="brand">
                {p}
              </Badge>
            ))}
          </div>
          {competitor.ads.length === 0 ? (
            <EmptyState
              title="No ads captured yet"
              hint="Their ad library is checked on the cadence set above."
            />
          ) : (
            <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
              {competitor.ads.map((ad) => (
                <div key={ad.id} className="flex flex-col rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={ad.status === "active" ? "good" : "neutral"}>{ad.status}</Badge>
                    <span className="text-[11px] text-slate-500">{ad.platform}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-900">{ad.headline}</p>
                  <p className="mt-1 text-[11px] text-slate-500">Audience: {ad.audience}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Focus: {ad.focus} · first seen {shortDate(ad.firstSeen)}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <a href={ad.bannerUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                      <ImageIcon size={13} /> Banner link
                    </a>
                    <a href={ad.landingUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                      Landing page <ExternalLink size={12} />
                    </a>
                    <button
                      type="button"
                      className={btnPrimary}
                      onClick={() => createOriginalAd(ad.headline)}
                    >
                      <Sparkles size={13} /> Build our own
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Use competitor ads as market signals only — build original offers, wording and designs.
            Last full competitor sweep {relativeTime(daysAgo(0, 3))}.
          </div>
        </Card>
      ) : null}

      {tab === "reviews" ? (
        <Card>
          <CardHead
            icon={<MessageSquareQuote size={16} />}
            title="Reviews their customers are leaving"
            subtitle={`${competitor.reviewsThisMonth} reviews this month · ${competitor.reviewCount.toLocaleString()} total`}
            action={<DeltaPill value={ratingChange} />}
          />
          {competitor.reviews.length === 0 ? (
            <EmptyState
              title="No reviews captured yet"
              hint="Run a scan to pull their latest customer feedback."
            />
          ) : (
            <div className="grid gap-4 px-4 py-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  Rating trend over 2 months
                </p>
                <AreaChart
                  data={competitor.reviewTrend}
                  color="#e11d48"
                  valueFormat={(n) => n.toFixed(2)}
                  height={120}
                />
                <div className="mt-3 flex items-center gap-3">
                  <Stars rating={competitor.rating} size={16} />
                  <span className="text-sm font-semibold text-slate-900">
                    {competitor.rating.toFixed(1)}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    was {competitor.previousRating.toFixed(1)}
                  </span>
                </div>
              </div>
              <ul className="space-y-2">
                {competitor.reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">{r.author}</span>
                      <span className="flex items-center gap-2">
                        <Stars rating={r.rating} />
                        <Badge
                          tone={
                            r.sentiment === "negative"
                              ? "bad"
                              : r.sentiment === "positive"
                                ? "good"
                                : "warn"
                          }
                        >
                          {r.sentiment}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{r.text}</p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {r.source} · {relativeTime(r.postedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "social" ? (
        <Card>
          <CardHead
            icon={<Share2 size={16} />}
            title="Social presence"
            subtitle="Where they publish and how much they engage"
          />
          {competitor.social.length === 0 ? (
            <EmptyState
              title="No social channels captured yet"
              hint="Their handles are scored on the next scan."
            />
          ) : (
            <ul className="grid gap-3 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
              {competitor.social.map((s) => (
                <li key={s.platform} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900">{s.platform}</span>
                    <span className="text-xs text-slate-500">{s.handle}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">Followers</dt>
                      <dd className="font-semibold text-slate-900">{compact(s.followers)}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">Engagement</dt>
                      <dd className="font-semibold text-slate-900">{s.engagementRate}%</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">Posts / week</dt>
                      <dd className="font-semibold text-slate-900">{s.postsPerWeek}</dd>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                      <dt className="text-slate-500">Ads live</dt>
                      <dd
                        className={`font-semibold ${s.adsRunning ? "text-indigo-700" : "text-slate-900"}`}
                      >
                        {s.adsRunning}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
    </div>
  );
}
