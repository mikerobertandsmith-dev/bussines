import { useState } from "react";
import {
  BarChart3,
  Bot,
  Download,
  FileText,
  Globe2,
  Image as ImageIcon,
  MessageSquareQuote,
  Package,
  RefreshCw,
  Search,
  Share2,
  ShoppingCart,
  Sparkles,
  Store,
  Target,
  TrendingUp,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Notice,
  ScoreRing,
  Segmented,
  Stat,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
} from "../components/ui";
import { AreaChart, BarList, DeltaPill, ProgressRing, Sparkline, Stars } from "../components/charts";
import { useToast } from "../components/Toast";
import { compact, money, relativeTime, shortDate } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";

type BusinessTab = "overview" | "search" | "reviews" | "assets" | "social" | "stock";

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
    competitors,
    adAssets,
    socialScores,
    inventoryRecommendations,
    topSeoKeywords,
    topGeoKeywords,
    geoVisibility,
    weeklyReports,
    reviewSources,
    latestReviewScan,
    buyList,
  } = workspace;

  const [tab, setTab] = useState<BusinessTab>("overview");
  const [inventoryFilter, setInventoryFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const lastScan = latestReviewScan.scannedAt;
  const decliningSource = reviewSources.find((s) => s.score < s.previousScore);
  const baselinePending = myBusiness.seoScore === 0 && topSeoKeywords.length === 0;
  const seoDelta = deltaPct(myBusiness.seoScore, myBusiness.previousSeoScore);
  const geoDelta = deltaPct(myBusiness.geoScore, myBusiness.previousGeoScore);
  const industryDelta = myBusiness.industryRankPrevious - myBusiness.industryRank;

  const recommendations = inventoryRecommendations.filter((r) =>
    inventoryFilter === "all" ? true : r.priority === inventoryFilter,
  );

  function runReviewScan() {
    void actions.runReviewScan();
    toast("Review scan queued — new reviews and replies appear as soon as it finishes.");
  }

  function downloadAdPack(product: string, sku: string, url: string, size: number) {
    downloadText(
      `${sku}-ad-pack-manifest.txt`,
      [
        `Market Watch ad pack for ${product} (${sku})`,
        `Figma working file: see Ad assets table`,
        `Bundle: ${url}`,
        `Approx size: ${size} MB`,
        `Formats included: see table listing`,
        "",
        "Drop the exported creatives into the client's approval folder before publishing.",
      ].join("\n"),
    );
    toast(`Downloading the ${product} photo shoot + ad pack.`);
  }

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
      {baselinePending ? (
        <Notice
          tone="info"
          icon={<Sparkles size={15} />}
          title="Your first baseline scan is pending"
        >
          <p className="text-xs">
            SEO, GEO, traffic, review and social numbers appear here after the first scan of{" "}
            {profile.primaryDomain || "your domain"} completes. Suppliers, competitors and clients are
            already set up from onboarding.
          </p>
        </Notice>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="SEO score"
          value={`${myBusiness.seoScore}/100`}
          delta={seoDelta}
          icon={<Search size={16} />}
          visual={<ProgressRing value={myBusiness.seoScore} color="#4f46e5" />}
          hint={
            myBusiness.previousSeoScore
              ? `was ${myBusiness.previousSeoScore} last week`
              : "first baseline pending"
          }
        />
        <Stat
          label="GEO / AI visibility"
          value={`${myBusiness.geoScore}/100`}
          delta={geoDelta}
          icon={<Bot size={16} />}
          visual={<ProgressRing value={myBusiness.geoScore} color="#0d9488" />}
          hint="cited in AI answers"
        />
        <Stat
          label="Website traffic"
          value={compact(myBusiness.monthlyVisits)}
          delta={myBusiness.visitsChange}
          icon={<BarChart3 size={16} />}
          visual={
            myBusiness.traffic.length > 1 ? (
              <Sparkline values={myBusiness.traffic.map((t) => t.visits)} color="#4f46e5" />
            ) : null
          }
          hint="visits in the last 30 days"
        />
        <Stat
          label="Industry rank"
          value={myBusiness.industryRank ? `#${myBusiness.industryRank}` : "—"}
          icon={<TrendingUp size={16} />}
          visual={
            myBusiness.industryRank && myBusiness.industryRankPrevious ? (
              // Lower rank is better, so invert it — the line reads upward when the position improves.
              <Sparkline
                values={[myBusiness.industryRankPrevious, myBusiness.industryRank].map((r) => -r)}
                color={industryDelta >= 0 ? "#059669" : "#e11d48"}
              />
            ) : null
          }
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
          { value: "reviews", label: "Reviews", icon: <MessageSquareQuote size={13} /> },
          { value: "assets", label: "Ad assets", icon: <ImageIcon size={13} />, count: adAssets.length },
          { value: "social", label: "Social", icon: <Share2 size={13} /> },
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

      {tab === "reviews" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead
              icon={<MessageSquareQuote size={16} />}
              title="Review page analysis — last 2 months"
              subtitle="Every review source, its score trend and how it is moving"
            />
            {reviewSources.length === 0 ? (
              <EmptyState
                title="No review data yet"
                hint="Review sources are added automatically once the first review scan runs."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {reviewSources.map((s) => (
                  <div key={s.source} className="grid gap-3 px-4 py-4 md:grid-cols-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{s.source}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Stars rating={s.score} size={14} />
                        <span className="text-sm font-semibold text-slate-900">
                          {s.score.toFixed(1)}
                        </span>
                        <DeltaPill value={deltaPct(s.score, s.previousScore)} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {s.reviews.toLocaleString()} reviews · {s.newThisMonth} new this month
                      </p>
                    </div>
                    <div className="md:col-span-2">
                      <AreaChart
                        data={s.series}
                        color={s.score < s.previousScore ? "#e11d48" : "#059669"}
                        valueFormat={(n) => n.toFixed(2)}
                        height={110}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              {decliningSource
                ? `${decliningSource.source} is trending down (${decliningSource.score} from ${decliningSource.previousScore}). Most complaints mention delivery timing, not product quality.`
                : "Every review source is stable or improving over the last two months."}
            </div>
          </Card>

          <Card>
            <CardHead
              icon={<RefreshCw size={16} />}
              title="Latest review scan"
              subtitle={`Scanned ${relativeTime(lastScan)} · next ${shortDate(latestReviewScan.nextScanAt)}`}
              action={
                <button type="button" className={btnPrimary} onClick={runReviewScan}>
                  <RefreshCw size={13} /> Scan now
                </button>
              }
            />
            <div className="grid grid-cols-3 gap-2 border-b border-slate-100 px-4 py-3 text-center">
              <div>
                <p className="text-lg font-semibold text-slate-900">{latestReviewScan.newReviews}</p>
                <p className="text-[10px] text-slate-500 uppercase">New reviews</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-rose-600">{latestReviewScan.flagged}</p>
                <p className="text-[10px] text-slate-500 uppercase">Need reply</p>
              </div>
              <div>
                <p className="text-lg font-semibold text-slate-900">
                  {latestReviewScan.averageRating}
                </p>
                <p className="text-[10px] text-slate-500 uppercase">Avg rating</p>
              </div>
            </div>
            {latestReviewScan.items.length === 0 ? (
              <EmptyState
                title="No reviews captured yet"
                hint="Run the scan once your review pages are connected."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {latestReviewScan.items.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">{r.author}</span>
                      <Stars rating={r.rating} />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-600">{r.text}</p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {r.source} · {relativeTime(r.postedAt)}
                    </p>
                    <p className="mt-1.5 rounded bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                      {r.action}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}

      {tab === "assets" ? (
        <Card>
          <CardHead
            icon={<ImageIcon size={16} />}
            title="Product photo shoots & ad designs"
            subtitle="Professional shoot files plus the Figma ad designs built for each inventory product"
          />
          {adAssets.length === 0 ? (
            <EmptyState
              title="No ad assets yet"
              hint="Original creatives and photo shoots appear here once your first product brief is produced."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Product</Th>
                    <Th>Formats</Th>
                    <Th>Shoot</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Downloads</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adAssets.map((a) => (
                    <tr key={a.id} className="align-top hover:bg-slate-50/70">
                      <Td>
                        <span className="block font-medium text-slate-900">{a.product}</span>
                        <span className="text-[11px] text-slate-500">
                          {a.sku} · {a.sizeMb ? `${a.sizeMb} MB` : "not exported yet"}
                        </span>
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          {a.formats.map((f) => (
                            <Badge key={f}>{f}</Badge>
                          ))}
                        </span>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {shortDate(a.shootDate)}
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {relativeTime(a.shootDate)}
                        </span>
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            a.shootStatus === "ready"
                              ? "good"
                              : a.shootStatus === "editing"
                                ? "warn"
                                : "info"
                          }
                        >
                          {a.shootStatus}
                        </Badge>
                      </Td>
                      <Td className="text-right text-xs text-slate-600">{a.downloads}</Td>
                      <Td>
                        <span className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnPrimary}
                            onClick={() =>
                              downloadAdPack(
                                a.product,
                                a.sku,
                                a.downloadUrl ?? a.storagePath ?? a.figmaUrl,
                                a.sizeMb,
                              )
                            }
                          >
                            <Download size={13} /> Download pack
                          </button>
                          <a href={a.figmaUrl} target="_blank" rel="noreferrer" className={btnGhost}>
                            <Sparkles size={13} /> Open in Figma
                          </a>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
            Designs are always original — a competitor's promotion is used as a signal, never as
            artwork to copy.
          </div>
        </Card>
      ) : null}

      {tab === "social" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead
              icon={<Share2 size={16} />}
              title="Social media score & where to focus"
              subtitle="Your score per platform next to the best competitor on that platform"
            />
            {socialScores.length === 0 ? (
              <EmptyState
                title="No social scores yet"
                hint="Add your social handles in business settings and the next scan will score them."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Platform</Th>
                      <Th className="text-center">Your score</Th>
                      <Th className="text-right">Followers</Th>
                      <Th className="text-right">Growth</Th>
                      <Th className="text-right">Gap to best</Th>
                      <Th>Focus</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {socialScores.map((s) => (
                      <tr key={s.platform} className="hover:bg-slate-50/70">
                        <Td>
                          <span className="block font-medium text-slate-900">{s.platform}</span>
                          <span className="text-[11px] text-slate-500">{s.handle}</span>
                        </Td>
                        <Td className="text-center">
                          <span className="text-sm font-semibold text-slate-900">{s.score}</span>
                          <div className="mx-auto mt-1 h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${
                                s.score >= 65
                                  ? "bg-emerald-500"
                                  : s.score >= 45
                                    ? "bg-amber-500"
                                    : "bg-rose-500"
                              }`}
                              style={{ width: `${s.score}%` }}
                            />
                          </div>
                        </Td>
                        <Td className="text-right text-xs text-slate-600">
                          {compact(s.followers)}
                        </Td>
                        <Td className="text-right text-xs text-emerald-600">
                          +{s.growth.toFixed(1)}%
                        </Td>
                        <Td className="text-right text-xs text-rose-600">{s.benchmarkGap}</Td>
                        <Td>
                          <Badge
                            tone={
                              s.focus === "high" ? "bad" : s.focus === "medium" ? "warn" : "neutral"
                            }
                          >
                            {s.focus} priority
                          </Badge>
                          <span className="mt-1 block max-w-64 text-[11px] text-slate-500">
                            {s.reason}
                          </span>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-600">
              Focus first on{" "}
              <span className="font-medium">
                {socialScores
                  .filter((s) => s.focus === "high")
                  .map((s) => s.platform)
                  .join(" and ")}
              </span>{" "}
              — those are the channels where competitors pull the most extra traffic and where your
              scores are furthest behind.
            </div>
          </Card>

          <Card>
            <CardHead
              icon={<Store size={16} />}
              title="Competitor benchmarks"
              subtitle="Who leads the channels you are chasing"
            />
            {competitors.length === 0 ? (
              <EmptyState
                title="No competitors tracked"
                hint="Add competitor websites during setup to benchmark against them."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {competitors.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{c.name}</span>
                      <Badge tone={c.monthlyVisits > myBusiness.monthlyVisits ? "bad" : "good"}>
                        {c.monthlyVisits > myBusiness.monthlyVisits ? "ahead" : "behind you"}
                      </Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>{compact(c.monthlyVisits)} visits</span>
                      <span>SEO {c.seoScore}</span>
                      <span>GEO {c.geoScore}</span>
                      {c.social[0] ? (
                        <span>
                          {c.social[0].followers.toLocaleString()} on {c.social[0].platform}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              Your best lever is SEO: you are already close on traffic but two competitors still beat
              your SEO and GEO scores.
            </div>
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
