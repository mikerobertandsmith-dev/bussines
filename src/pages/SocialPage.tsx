import { useState } from "react";
import {
  Binoculars,
  Link2,
  MessageSquareQuote,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Store,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  Field,
  Stat,
  Tabs,
  Td,
  Th,
  btnGhost,
  btnPrimary,
  inputClass,
} from "../components/primitives";
import { Modal } from "../components/Modal";
import { AreaChart, DeltaPill, Stars } from "../components/charts";
import { useActionToast, useToast } from "../components/Toast";
import { platformLabel, summariseSocial } from "../lib/social";
import { compact, relativeTime, shortDate } from "../lib/format";
import { useWorkspace, useWorkspaceData } from "../lib/workspace";
import type { Competitor, MyReview } from "../lib/types";

type SocialTab = "reviews" | "competitors" | "social";

/**
 * Platforms the connect form offers, in the order it lists them. Google and
 * TripAdvisor are read through SerpApi; the rest need an Apify actor id for that
 * platform, and a sync says so rather than failing silently.
 */
const REVIEW_PLATFORMS = ["google", "yelp", "g2", "trustpilot", "capterra", "tripadvisor"] as const;

/** Percent change that survives a missing previous value. */
function deltaPct(current: number, previous: number): number {
  if (!previous) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function sentimentCounts(competitor: Competitor) {
  return {
    positive: competitor.reviews.filter((r) => r.sentiment === "positive").length,
    neutral: competitor.reviews.filter((r) => r.sentiment === "neutral").length,
    negative: competitor.reviews.filter((r) => r.sentiment === "negative").length,
  };
}

export function SocialPage() {
  const actionToast = useActionToast();
  const workspace = useWorkspaceData();
  const { actions } = useWorkspace();

  const { reviewSources, reviewConnections, latestReviewScan, socialScores, competitors, profile } =
    workspace;
  const socialPosts = workspace.socialPosts;
  const [tab, setTab] = useState<SocialTab>("reviews");
  const [replyTarget, setReplyTarget] = useState<MyReview | null>(null);
  const [replyText, setReplyText] = useState("");
  /** Set once a draft has been written, so the composer can say what it was. */
  const [draftTone, setDraftTone] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectPlatform, setConnectPlatform] = useState<string>("google");
  const [connectHandle, setConnectHandle] = useState("");
  const toast = useToast();

  // Measured from the posts we actually scraped, so the declared numbers on the
  // channel rows can be checked against behaviour.
  const socialInsights = new Map(
    competitors.map((c) => [c.id, summariseSocial(socialPosts, c.id)]),
  );

  const lastScan = latestReviewScan.scannedAt;
  const decliningSource = reviewSources.find((s) => s.score < s.previousScore);
  const totalReviews = reviewSources.reduce((sum, s) => sum + s.reviews, 0);

  function runReviewScan() {
    void actionToast(
      async () => {
        const result = await actions.runReviewScan();
        if (result) {
          toast(
            `Synced ${result.profiles} profile${result.profiles === 1 ? "" : "s"} — ${result.reviews} review${result.reviews === 1 ? "" : "s"}${result.flagged ? `, ${result.flagged} need a reply` : ""}.${result.running ? ` ${result.running} still running — the next sync collects it.` : ""}`,
          );
        }
      },
      {
        success: "Review scan queued — new reviews and replies appear as soon as it finishes.",
        failure: "The review scan could not be queued.",
      },
    );
  }

  /** Opens the reply composer, seeded with the suggested action text. */
  function openReply(review: MyReview) {
    setReplyTarget(review);
    setReplyText(review.action || "");
    setDraftTone("");
  }

  /**
   * Asks the model for a reply and puts it in the box. The reply still has to be
   * sent by hand — drafting never sends anything, which is the whole guardrail.
   */
  async function draftReply() {
    if (!replyTarget) return;
    setDrafting(true);
    try {
      const draft = await actions.draftReviewReply(replyTarget.id);
      if (!draft) {
        toast("AI drafting is not configured — add GROQ_API_KEY to the function secrets.");
        return;
      }
      setReplyText(draft.reply);
      setDraftTone(draft.tone);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "A draft could not be written.");
    } finally {
      setDrafting(false);
    }
  }

  async function sendReply() {
    if (!replyTarget) return;
    const target = replyTarget;
    const body = replyText.trim();
    if (!body) {
      toast("Write a reply before sending it.");
      return;
    }
    try {
      await actions.replyToReview(target.id, body);
      toast(`Reply sent to ${target.author}.`);
      setReplyTarget(null);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "The reply could not be sent.");
    }
  }

  async function removeProfile(connectionId: string) {
    try {
      await actions.removeReviewConnection(connectionId);
      toast("Review profile disconnected.");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That profile could not be removed.");
    }
  }

  async function connectProfile() {
    const handle = connectHandle.trim();
    if (!handle) {
      toast("Add the profile's public URL or handle.");
      return;
    }
    try {
      await actions.connectReviewProfile({
        platform: connectPlatform,
        handle,
        label: platformLabel(connectPlatform),
      });
      toast(`${platformLabel(connectPlatform)} profile connected.`);
      setConnectOpen(false);
      setConnectHandle("");
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "That profile could not be connected.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Average rating"
          value={latestReviewScan.averageRating || "—"}
          icon={<MessageSquareQuote size={16} />}
          hint={`${latestReviewScan.newReviews} new this scan`}
        />
        <Stat
          label="Reviews tracked"
          value={compact(totalReviews)}
          icon={<ThumbsUp size={16} />}
          hint={`${reviewSources.length} sources`}
        />
        <Stat
          label="Need a reply"
          value={latestReviewScan.flagged}
          icon={<ThumbsDown size={16} />}
          hint="flagged by the last scan"
        />
        <Stat
          label="Social channels"
          value={socialScores.length}
          icon={<Share2 size={16} />}
          hint={profile.socialHandles ? "handles connected" : "add handles in settings"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <button type="button" className={btnPrimary} onClick={runReviewScan}>
          <RefreshCw size={14} /> Scan reviews now
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          Last scan {relativeTime(lastScan)} · next {shortDate(latestReviewScan.nextScanAt)}
        </span>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "reviews", label: "My reviews", icon: <MessageSquareQuote size={13} />, count: reviewSources.length },
          { value: "competitors", label: "Competitor reviews", icon: <Binoculars size={13} />, count: competitors.length },
          { value: "social", label: "Social media", icon: <Share2 size={13} />, count: socialScores.length },
        ]}
      />

      {/* ------------------------------------------------ my reviews */}
      {tab === "reviews" ? (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHead
              icon={<MessageSquareQuote size={16} />}
              title="Review page analysis — last 2 months"
              subtitle="Every review source you are tracked on, its score trend and how it is moving"
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
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-slate-400">
                      <span>
                        {r.source} · {relativeTime(r.postedAt)}
                      </span>
                      {r.language && r.language !== "en" ? (
                        <Badge tone="neutral">{r.language.toUpperCase()}</Badge>
                      ) : null}
                      {r.replied ? (
                        <Badge tone="good">Replied</Badge>
                      ) : r.sentiment === "negative" ? (
                        <Badge tone="bad">Needs reply</Badge>
                      ) : null}
                    </p>
                    {r.replied ? (
                      <p className="mt-1.5 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-800">
                        {r.replyText || "Reply sent."}
                      </p>
                    ) : (
                      <p className="mt-1.5 rounded bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                        {r.action}
                      </p>
                    )}
                    {r.replied ? null : (
                      <div className="mt-2 flex justify-end">
                        <button type="button" className={btnGhost} onClick={() => openReply(r)}>
                          <Send size={12} /> Reply
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t border-slate-100 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Review profiles
                </p>
                <button type="button" className={btnGhost} onClick={() => setConnectOpen(true)}>
                  <Plus size={13} /> Connect
                </button>
              </div>
              {reviewConnections.length === 0 ? (
                <p className="text-[11px] text-slate-500">
                  No review pages connected yet. Add one to sync its reviews and reply from here.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {reviewConnections.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-slate-800">
                          {c.label || c.handle}
                        </p>
                        <p className="truncate text-[10px] text-slate-400">
                          {c.handle}
                          {c.lastSyncedAt
                            ? ` · synced ${relativeTime(c.lastSyncedAt)}`
                            : " · not synced yet"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {c.status === "needs_reauth" ? <Badge tone="warn">Reconnect</Badge> : null}
                        <button
                          type="button"
                          onClick={() => void removeProfile(c.id)}
                          className="text-[10px] text-slate-400 transition hover:text-rose-600"
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------------ competitor reviews */}
      {tab === "competitors" ? (
        <div className="space-y-5">
          <Card>
            <CardHead
              icon={<Binoculars size={16} />}
              title="Competitor review brief"
              subtitle="A quick read of every competitor's rating, sentiment mix and what their customers keep raising"
            />
            {competitors.length === 0 ? (
              <EmptyState
                title="No competitors tracked"
                hint="Add competitor websites during setup to compare their reviews."
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {competitors.map((c) => {
                  const counts = sentimentCounts(c);
                  const total = c.reviews.length || 1;
                  return (
                    <div key={c.id} className="grid gap-4 px-4 py-4 lg:grid-cols-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                          <Badge tone={c.rating >= 4.3 ? "good" : c.rating >= 3.8 ? "warn" : "bad"}>
                            {c.rating.toFixed(1)}
                          </Badge>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <Stars rating={c.rating} size={14} />
                          <DeltaPill value={deltaPct(c.rating, c.previousRating)} suffix=" pts" />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {c.reviewCount.toLocaleString()} reviews · {c.reviewsThisMonth} new this
                          month
                        </p>
                        {c.website ? (
                          <a
                            href={c.website}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block text-[11px] text-indigo-600 hover:underline"
                          >
                            {c.website}
                          </a>
                        ) : null}
                      </div>

                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                          Sentiment on their reviews
                        </p>
                        <div className="space-y-1.5">
                          {(
                            [
                              ["positive", "bg-emerald-500", counts.positive],
                              ["neutral", "bg-amber-500", counts.neutral],
                              ["negative", "bg-rose-500", counts.negative],
                            ] as const
                          ).map(([label, color, value]) => (
                            <div key={label}>
                              <div className="flex items-center justify-between text-[11px] text-slate-600">
                                <span className="capitalize">{label}</span>
                                <span className="font-medium text-slate-900">{value}</span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${color}`}
                                  style={{ width: `${(value / total) * 100}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                          Latest reviews
                        </p>
                        {c.reviews.length === 0 ? (
                          <p className="text-[11px] text-slate-500">No reviews captured yet.</p>
                        ) : (
                          <ul className="space-y-2">
                            {c.reviews.slice(0, 2).map((r) => (
                              <li key={r.id} className="rounded-lg bg-slate-50 px-2.5 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-medium text-slate-700">
                                    {r.author || "Customer"}
                                  </span>
                                  <Stars rating={r.rating} size={11} />
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-600">
                                  {r.text}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">
              Use these gaps as ad angles — a complaint your competitors get is a promise your next
              promotion can make.
            </div>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------------------------ social */}
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
                  .join(" and ") || "the channels flagged high"}
              </span>{" "}
              — those are the channels where competitors pull the most extra traffic and where your
              scores are furthest behind.
            </div>
          </Card>

          <Card>
            <CardHead
              icon={<Store size={16} />}
              title="Competitor social channels"
              subtitle="Where they post, their following, and what their scraped posts measure"
            />
            {competitors.length === 0 ? (
              <EmptyState
                title="No competitors tracked"
                hint="Add competitor websites during setup to benchmark their social."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {competitors.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{c.name}</span>
                      <Badge tone={c.monthlyVisits > 0 ? "neutral" : "neutral"}>
                        {c.social.length} channel{c.social.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    {(() => {
                      const insight = socialInsights.get(c.id);
                      if (!insight || insight.posts === 0) return null;
                      return (
                        <p className="mt-1 text-[11px] text-slate-500">
                          Measured from {insight.posts} scraped post{insight.posts === 1 ? "" : "s"}: ~
                          {insight.postsPerWeek}/week · {insight.averageEngagement}% average engagement
                          {insight.postsLast24Hours > 0
                            ? ` · ${insight.postsLast24Hours} in the last 24h`
                            : ""}
                          {insight.topHashtags.length
                            ? ` · leans on #${insight.topHashtags.slice(0, 2).map((t) => t.tag).join(" #")}`
                            : ""}
                        </p>
                      );
                    })()}
                    {c.social.length === 0 ? (
                      <p className="mt-1 text-[11px] text-slate-500">No social data captured yet.</p>
                    ) : (
                      <ul className="mt-1.5 space-y-1.5">
                        {c.social.map((ch) => (
                          <li
                            key={`${c.id}-${ch.platform}`}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600"
                          >
                            <span className="font-medium text-slate-800">{ch.platform}</span>
                            <span>{compact(ch.followers)} followers</span>
                            <span>{ch.engagementRate}% eng.</span>
                            <span>{ch.postsPerWeek} posts/wk</span>
                            {ch.adsRunning > 0 ? (
                              <Badge tone="warn">{ch.adsRunning} ads</Badge>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
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

      {/* ------------------------------------------------ reply composer */}
      <Modal
        open={Boolean(replyTarget)}
        onClose={() => setReplyTarget(null)}
        title="Reply to this review"
        subtitle={
          replyTarget
            ? `${replyTarget.author} · ${replyTarget.rating}★ on ${replyTarget.source}`
            : undefined
        }
        icon={<Send size={16} />}
        footer={
          <>
            <button
              type="button"
              className={btnGhost}
              disabled={drafting}
              onClick={() => void draftReply()}
            >
              <Sparkles size={13} /> {drafting ? "Drafting…" : "Draft with AI"}
            </button>
            <button type="button" className={btnGhost} onClick={() => setReplyTarget(null)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void sendReply()}>
              <Send size={13} /> Send reply
            </button>
          </>
        }
      >
        {replyTarget ? (
          <div className="space-y-4 px-4 py-4">
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              “{replyTarget.text}”
            </p>
            <Field
              label="Your reply"
              hint="Edit the suggestion before it goes out — nothing is posted automatically."
            >
              <textarea
                className={`${inputClass} min-h-28`}
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
              />
            </Field>
            {draftTone ? (
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <Sparkles size={12} /> Drafted with a {draftTone} tone. Sending is still yours to do.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* ------------------------------------------------ connect a profile */}
      <Modal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        title="Connect a review profile"
        subtitle="Any public review page — no login on that platform is required"
        icon={<Link2 size={16} />}
        footer={
          <>
            <button type="button" className={btnGhost} onClick={() => setConnectOpen(false)}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} onClick={() => void connectProfile()}>
              Connect profile
            </button>
          </>
        }
      >
        <div className="space-y-4 px-4 py-4">
          <Field label="Platform">
            <select
              className={inputClass}
              value={connectPlatform}
              onChange={(event) => setConnectPlatform(event.target.value)}
            >
              {REVIEW_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platformLabel(platform)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Public URL or handle"
            hint="e.g. yourretailbrand.com, or the full Trustpilot profile URL"
          >
            <input
              className={inputClass}
              placeholder="e.g. yourretailbrand.com"
              value={connectHandle}
              onChange={(event) => setConnectHandle(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
