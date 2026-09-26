import { useState } from "react";
import {
  BarChart3,
  Bot,
  Download,
  FileText,
  Globe2,
  Package,
  Search,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  ScoreRing,
  Segmented,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
} from "../components/primitives";
import { AreaChart, BarList, DeltaPill } from "../components/charts";
import { MetricTile, ScoreRadialCard, TrafficTrendCard } from "../components/insights";
import { useToast } from "../components/Toast";
import { compact, money } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";

type BusinessTab = "overview" | "search" | "stock";

/** Percent change that survives a missing previous value. */
function deltaPct(current: number, previous: number): number {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function BusinessPage() {
  const toast = useToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();

  const {
    metrics: myBusiness,
    profile,
    suppliers,
    inventoryRecommendations,
    topSeoKeywords,
    topGeoKeywords,
    geoVisibility,
    weeklyReports,
    buyList,
  } = workspace;

  const [tab, setTab] = useState<BusinessTab>("overview");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const seoDelta = deltaPct(myBusiness.seoScore, myBusiness.previousSeoScore);
  const geoDelta = deltaPct(myBusiness.geoScore, myBusiness.previousGeoScore);
  const industryDelta = myBusiness.industryRankPrevious - myBusiness.industryRank;

  const recommendations = inventoryRecommendations.filter((r) =>
    inventoryFilter === "all" ? true : r.priority === inventoryFilter,
  );

  function downloadReport() {
    const report = weeklyReports[0];
    if (!report) {
      toast("No weekly report has been generated yet — the first one lands after your first scan.");
      return;
    }
    downloadText(
      `weekly-seo-geo-report-${new Date().toISOString().slice(0, 10)}.txt`,
      [
        `${profile.brandName} — SEO & GEO weekly report`,
        report.week,
        "",
        `SEO score: ${report.seoScore} (prev ${myBusiness.previousSeoScore || "n/a"})`,
        `GEO score: ${report.geoScore} (prev ${myBusiness.previousGeoScore || "n/a"})`,
        `Visits: ${report.visits.toLocaleString()}`,
        `Conversions: ${report.conversions.toLocaleString()}`,
        `Industry rank: #${myBusiness.industryRank || "unranked"} (moved ${industryDelta})`,
        "",
        `Highlight: ${report.highlight}`,
        "",
        "Actions for next week:",
        ...report.actions.map((a, i) => `${i + 1}. ${a}`),
        "",
        "Top SEO keywords:",
        ...topSeoKeywords
          .slice(0, 5)
          .map((k) => `  #${k.position} ${k.keyword} (${k.volume.toLocaleString()} searches)`),
        "",
        "Top GEO prompts:",
        ...topGeoKeywords
          .slice(0, 5)
          .map((k) => `  #${k.position} "${k.prompt}" via ${k.engine}`),
      ].join("\n"),
    );
    toast("Weekly SEO & GEO report downloaded.");
  }

  function exportBuyList() {
    const rows = recommendations.map((r) =>
      [
        r.product,
        r.category,
        suppliers.find((s) => s.id === r.supplierId)?.name ?? "",
        r.suggestedQty,
        r.estimatedPrice,
        r.marginPct,
        r.trafficPotential,
        r.priority,
        r.competitorRef,
      ].join(","),
    );
    downloadText(
      `inventory-to-buy-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "product,category,supplier,qty,est_price,margin_pct,traffic_potential,priority,competitor",
        ...rows,
      ].join("\n"),
    );
    toast("Buy list exported.");
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ScoreRadialCard
          label="SEO score"
          value={myBusiness.seoScore}
          icon={<Search size={16} />}
          color="var(--chart-1)"
          hint={
            <span className="flex items-center gap-2">
              {seoDelta >= 0 ? `+${seoDelta}%` : `${seoDelta}%`}
              <span className="text-xs font-normal text-muted-foreground">
                {myBusiness.previousSeoScore
                  ? `was ${myBusiness.previousSeoScore} last week`
                  : "first baseline pending"}
              </span>
            </span>
          }
        />
        <ScoreRadialCard
          label="GEO / AI visibility"
          value={myBusiness.geoScore}
          icon={<Bot size={16} />}
          color="var(--chart-3)"
          hint={
            <span className="flex items-center gap-2">
              {geoDelta >= 0 ? `+${geoDelta}%` : `${geoDelta}%`}
              <span className="text-xs font-normal text-muted-foreground">
                cited in AI answers
              </span>
            </span>
          }
        />
        <TrafficTrendCard
          className="sm:col-span-2 xl:col-span-2"
          label="Website traffic"
          points={myBusiness.traffic}
          total={myBusiness.monthlyVisits}
          changePct={myBusiness.visitsChange}
          icon={<BarChart3 size={16} />}
          caption="Visits in the last 30 days"
        />
        <MetricTile
          className="sm:col-span-2 xl:col-span-4"
          label="Industry rank"
          value={myBusiness.industryRank ? `#${myBusiness.industryRank}` : "—"}
          icon={<TrendingUp size={16} />}
          hint={`${industryDelta >= 0 ? "up" : "down"} ${Math.abs(industryDelta)} places in ${profile.industry || "your industry"}`}
        />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "overview", label: "Overview", icon: <TrendingUp size={13} /> },
          {
            value: "search",
            label: "SEO & GEO",
            icon: <Search size={13} />,
            count: topSeoKeywords.length + topGeoKeywords.length,
          },
          {
            value: "stock",
            label: "Buy list",
            icon: <ShoppingCart size={13} />,
            count: buyList.length,
          },
        ]}
      />

      {tab === "overview" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card>
            <CardHead
              icon={<Sparkles size={16} />}
              title="Search & AI visibility health"
              subtitle={`${profile.primaryDomain || "your domain"} · domain authority ${myBusiness.domainAuthority} · ${myBusiness.indexedPages.toLocaleString()} pages`}
            />
            <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl bg-slate-50 p-3">
                <ScoreRing score={myBusiness.seoScore} label="SEO score" tone="good" />
                <p className="mt-2 text-[11px] text-slate-600">
                  {myBusiness.backlinks} backlinks · ranking for{" "}
                  {topSeoKeywords.filter((k) => k.position <= 10).length} of {topSeoKeywords.length}{" "}
                  tracked terms in the top 10.
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <ScoreRing score={myBusiness.geoScore} label="GEO score" tone="warn" />
                <p className="mt-2 text-[11px] text-slate-600">
                  {myBusiness.topServers[2]
                    ? `Cited by ${myBusiness.topServers[2].name} in ${myBusiness.topServers[2].share}% of tracked prompts.`
                    : "No AI-answer data yet — GEO checks run after your domain scan."}
                </p>
              </div>
            </div>
            <div className="border-t border-slate-100 px-4 py-3">
              <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                AI answer visibility trend
              </p>
              <AreaChart
                data={geoVisibility}
                color="#0d9488"
                valueFormat={(n) => `${n}/100`}
                height={110}
              />
            </div>
          </Card>

          <Card className="xl:col-span-2">
            <CardHead
              icon={<Globe2 size={16} />}
              title="Traffic on your platform"
              subtitle="Monthly visits, channels and which search surfaces send them"
            />
            <div className="grid gap-5 px-4 py-4 md:grid-cols-2">
              <div>
                <AreaChart data={myBusiness.traffic} color="#4f46e5" />
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                  <span>Conversion rate {myBusiness.conversionRate}%</span>
                  <span>·</span>
                  <span>
                    {Math.round(
                      myBusiness.monthlyVisits * (myBusiness.conversionRate / 100),
                    ).toLocaleString()}{" "}
                    orders last month
                  </span>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Channels
                  </p>
                  <BarList
                    data={myBusiness.trafficSources.map((s) => ({ label: s.label, value: s.share }))}
                    valueFormat={(n) => `${n}%`}
                  />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                    Search surfaces
                  </p>
                  <BarList
                    data={myBusiness.topServers.map((s) => ({ label: s.name, value: s.share }))}
                    valueFormat={(n) => `${n}%`}
                    color="#0d9488"
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === "search" ? (
        <div className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHead
                icon={<Search size={16} />}
                title="Top ranking SEO keywords this week"
                subtitle="Position, search volume and movement since last week"
                action={<Badge tone="brand">{topSeoKeywords.length} tracked</Badge>}
              />
              {topSeoKeywords.length === 0 ? (
                <EmptyState
                  title="No keyword data yet"
                  hint="Your tracked terms appear after the first domain scan."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Keyword</Th>
                        <Th className="text-right">Volume</Th>
                        <Th className="text-center">Position</Th>
                        <Th className="text-right">Change</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topSeoKeywords.map((k) => (
                        <tr key={k.keyword} className="hover:bg-slate-50/70">
                          <Td className="font-medium text-slate-900">{k.keyword}</Td>
                          <Td className="text-right">{k.volume.toLocaleString()}</Td>
                          <Td className="text-center">
                            <Badge
                              tone={k.position <= 3 ? "good" : k.position <= 10 ? "info" : "warn"}
                            >
                              #{k.position}
                            </Badge>
                          </Td>
                          <Td className="text-right">
                            <DeltaPill value={k.change} suffix=" pos" />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHead
                icon={<Bot size={16} />}
                title="Top ranking GEO prompts this week"
                subtitle="Where AI assistants mention you for your industry"
                action={<Badge tone="brand">{topGeoKeywords.length} prompts</Badge>}
              />
              {topGeoKeywords.length === 0 ? (
                <EmptyState
                  title="No GEO prompts yet"
                  hint="AI answer checks run after your domain scan."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Prompt</Th>
                        <Th>Engine</Th>
                        <Th className="text-center">Position</Th>
                        <Th className="text-right">Change</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topGeoKeywords.map((k) => (
                        <tr key={k.prompt} className="hover:bg-slate-50/70">
                          <Td className="font-medium text-slate-900">"{k.prompt}"</Td>
                          <Td className="text-xs text-slate-600">{k.engine}</Td>
                          <Td className="text-center">
                            <Badge
                              tone={k.position <= 3 ? "good" : k.position <= 8 ? "info" : "warn"}
                            >
                              #{k.position}
                            </Badge>
                          </Td>
                          <Td className="text-right">
                            <DeltaPill value={k.change} suffix=" pos" />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card>
            <CardHead
              icon={<FileText size={16} />}
              title="SEO & GEO weekly report"
              subtitle="What changed, what it cost you and what to do next week"
              action={
                <button type="button" className={btnGhost} onClick={downloadReport}>
                  <Download size={14} /> Download report
                </button>
              }
            />
            {weeklyReports.length === 0 ? (
              <EmptyState
                title="No weekly report yet"
                hint="Your first SEO & GEO report is generated after the domain scan completes."
              />
            ) : (
              <div className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                {weeklyReports.map((r, i) => (
                  <div
                    key={r.week}
                    className={`rounded-xl border p-3 ${
                      i === 0 ? "border-indigo-200 bg-indigo-50/40" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-900">{r.week}</p>
                      {i === 0 ? <Badge tone="brand">Current</Badge> : null}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                      <span>SEO {r.seoScore}</span>
                      <span>GEO {r.geoScore}</span>
                      <span>{compact(r.visits)} visits</span>
                      <span>{r.conversions.toLocaleString()} orders</span>
                    </div>
                    <p className="mt-2 text-[11px] text-slate-700">{r.highlight}</p>
                    <ul className="mt-2 space-y-1">
                      {r.actions.map((a) => (
                        <li key={a} className="flex gap-1.5 text-[11px] text-slate-600">
                          <Target size={11} className="mt-0.5 shrink-0 text-indigo-500" /> {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "stock" ? (
        <Card>
          <CardHead
            icon={<ShoppingCart size={16} />}
            title="Inventory you should get next"
            subtitle="Built from competitor traffic, keyword gaps and supplier price moves"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  size="sm"
                  value={inventoryFilter}
                  onChange={setInventoryFilter}
                  options={[
                    { value: "all", label: "All" },
                    { value: "high", label: "High" },
                    { value: "medium", label: "Medium" },
                    { value: "low", label: "Low" },
                  ]}
                />
                <button type="button" className={btnGhost} onClick={exportBuyList}>
                  <Download size={14} /> Export buy list
                </button>
              </div>
            }
          />
          {recommendations.length === 0 ? (
            <EmptyState title="Nothing at this priority" hint="Switch the priority filter." />
          ) : (
            <div className="grid gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
              {recommendations.map((r) => {
                const supplier = suppliers.find((s) => s.id === r.supplierId);
                const added = buyList.includes(r.id);
                return (
                  <div key={r.id} className="flex flex-col rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{r.product}</p>
                        <p className="text-[11px] text-slate-500">
                          {r.category} · {supplier?.name}
                        </p>
                      </div>
                      <Badge
                        tone={
                          r.priority === "high"
                            ? "bad"
                            : r.priority === "medium"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {r.priority}
                      </Badge>
                    </div>

                    <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Suggested buy</dt>
                        <dd className="font-semibold text-slate-900">{r.suggestedQty} units</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Retail</dt>
                        <dd className="font-semibold text-slate-900">{money(r.estimatedPrice)}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Margin</dt>
                        <dd className="font-semibold text-emerald-700">{r.marginPct}%</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                        <dt className="text-slate-500">Traffic potential</dt>
                        <dd className="font-semibold text-slate-900">
                          {compact(r.trafficPotential)}/mo
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-2 text-[11px] text-slate-600">{r.reason}</p>
                    <p className="mt-1 text-[11px] text-slate-400">Signal from {r.competitorRef}</p>

                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        className={added ? btnGhost : btnPrimary}
                        onClick={() => {
                          void actions.toggleBuyList(r.id, !added);
                          toast(
                            added
                              ? `${r.product} removed from the buy list.`
                              : `${r.product} added to the buy list (${r.suggestedQty} units).`,
                          );
                        }}
                      >
                        {added ? "On buy list" : "Add to buy list"}
                      </button>
                      {supplier?.website ? (
                        <a
                          href={supplier.website}
                          target="_blank"
                          rel="noreferrer"
                          className={btnGhost}
                        >
                          <Package size={13} /> Supplier site
                        </a>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            {buyList.length} of {inventoryRecommendations.length} recommendations marked for purchase.
          </div>
        </Card>
      ) : null}
    </div>
  );
}
