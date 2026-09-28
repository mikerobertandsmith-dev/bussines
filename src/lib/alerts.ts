import type { RouteId } from "./hooks";
import type { WorkspaceData } from "./types";
import { money, relativeTime } from "./format";
import { platformLabel, summariseSocial } from "./social";
import { providerUsage } from "./integrations";

export interface Alert {
  id: string;
  page: RouteId;
  title: string;
  detail: string;
  at: string;
  severity: "urgent" | "watch" | "info";
}

/** Our top-10 share below this counts as "losing" the search results page. */
const SOV_THRESHOLD = 50;

/** A competitor posting this many times in a day is a push worth noticing. */
const POST_BURST_COUNT = 3;

/** How long a negative review may sit unanswered before we flag it. */
const REPLY_WINDOW_HOURS = 48;

/** True when a review has been waiting longer than the reply window. */
function replyOverdue(postedAt: string, now = Date.now()): boolean {
  const at = new Date(postedAt).getTime();
  return Number.isFinite(at) && now - at > REPLY_WINDOW_HOURS * 3_600_000;
}

export function buildAlerts(data: WorkspaceData): Alert[] {
  const list: Alert[] = [];

  for (const item of data.supplierItems) {
    const supplier = data.suppliers.find((s) => s.id === item.supplierId);
    if (!supplier) continue;

    if (item.change === "price_change" && Math.abs(item.previousPrice - item.price) > 2) {
      const drop = ((item.previousPrice - item.price) / item.previousPrice) * 100;
      list.push({
        id: `alert-${item.id}`,
        page: "suppliers",
        title: `${supplier.name}: ${drop >= 0 ? "price drop" : "price rise"}`,
        detail: `${item.product} moved ${money(item.previousPrice)} → ${money(item.price)} (${drop.toFixed(1)}%).`,
        at: item.detectedAt,
        severity: Math.abs(drop) >= 10 ? "urgent" : "watch",
      });
    }

    if (item.change === "stock_change" && item.stock === "out_of_stock") {
      list.push({
        id: `alert-${item.id}`,
        page: "suppliers",
        title: `${supplier.name}: stock out`,
        detail: `${item.product} is no longer available at the supplier.`,
        at: item.detectedAt,
        severity: "watch",
      });
    }
  }

  for (const comp of data.competitors) {
    for (const ad of comp.ads) {
      if (ad.status === "active" && new Date(ad.firstSeen).getTime() > Date.now() - 5 * 864e5) {
        list.push({
          id: `alert-${ad.id}`,
          page: "competition",
          title: `${comp.name}: new ${ad.platform} campaign`,
          detail: `"${ad.headline}" — audience: ${ad.audience}.`,
          at: ad.firstSeen,
          severity: "urgent",
        });
      }
    }
    if (comp.previousRating > 0 && comp.rating < comp.previousRating) {
      list.push({
        id: `alert-rating-${comp.id}`,
        page: "competition",
        title: `${comp.name}: review rating slipped`,
        detail: `Rating fell from ${comp.previousRating.toFixed(1)} to ${comp.rating.toFixed(1)} over the last 2 months.`,
        at: comp.reviews[0]?.postedAt ?? comp.lastScan,
        severity: "watch",
      });
    }
  }

  // Local visibility regressions — current state compared with the prior scan.
  for (const row of data.localPackRankings) {
    if (row.previousInPack === true && !row.inPack) {
      list.push({
        id: `alert-pack-${row.keyword}-${row.location}`,
        page: "business",
        title: `${row.keyword}: dropped out of the map 3-pack`,
        detail: `${row.location || "your area"} — you were #${row.previousPackPosition ?? "?"} and are no longer in the pack.`,
        at: row.checkedAt,
        severity: "urgent",
      });
    }
  }

  for (const row of data.serpRankings) {
    if (row.previousIsRichResult === true && !row.isRichResult) {
      list.push({
        id: `alert-snippet-${row.keyword}-${row.device}`,
        page: "business",
        title: `${row.keyword}: rich snippet lost`,
        detail: `Your ${row.device} result no longer shows the ${row.previousSnippetType || "rich"} snippet Google was displaying.`,
        at: row.checkedAt,
        severity: "watch",
      });
    }
  }

  for (const row of data.shareOfVoice) {
    if (row.previousOurShare === null) continue;
    const crossedDown = row.previousOurShare >= SOV_THRESHOLD && row.ourShare < SOV_THRESHOLD;
    const crossedUp = row.previousOurShare < SOV_THRESHOLD && row.ourShare >= SOV_THRESHOLD;
    if (!crossedDown && !crossedUp) continue;
    list.push({
      id: `alert-sov-${row.competitorId}`,
      page: "competition",
      title: `Share of Voice ${crossedDown ? "slipped below" : "recovered above"} ${SOV_THRESHOLD}%`,
      detail: `vs ${row.competitorName}: your top-10 share moved ${row.previousOurShare}% → ${row.ourShare}% across ${row.termCount} tracked terms.`,
      at: row.checkedAt,
      severity: crossedDown ? "urgent" : "info",
    });
  }

  // Competitor social pushes, computed from the posts we actually scraped.
  for (const competitor of data.competitors) {
    const insight = summariseSocial(data.socialPosts, competitor.id);
    if (!insight.posts) continue;

    if (insight.postsLast24Hours >= POST_BURST_COUNT) {
      list.push({
        id: `alert-social-burst-${competitor.id}`,
        page: "competition",
        title: `${competitor.name}: ${insight.postsLast24Hours} posts in 24 hours`,
        detail: `They are pushing hard right now — about ${insight.postsPerWeek}/week, averaging ${insight.averageEngagement}% engagement.`,
        at: insight.latestPostAt ?? new Date().toISOString(),
        severity: "watch",
      });
    }

    const best = insight.bestPost;
    const record = insight.previousBest;
    if (best && record && best.engagementRate > record.engagementRate) {
      list.push({
        id: `alert-social-record-${competitor.id}`,
        page: "competition",
        title: `${competitor.name} beat their 30-day engagement record`,
        detail: `A ${platformLabel(best.platform)} post took ${best.engagementRate}% against their previous best of ${record.engagementRate}% — worth studying the angle, not the artwork.`,
        at: best.postedAt ?? new Date().toISOString(),
        severity: "info",
      });
    }
  }

  // Reputation: a flagged review, a source losing ground, a review left
  // unanswered past the window, and a widening local review gap vs a rival.
  if (data.latestReviewScan.flagged > 0) {
    list.push({
      id: "alert-my-reviews",
      page: "social",
      title: `${data.latestReviewScan.flagged} reviews need a reply`,
      detail: `Latest scan found ${data.latestReviewScan.newReviews} new reviews and flagged ${data.latestReviewScan.flagged} for follow-up.`,
      at: data.latestReviewScan.scannedAt,
      severity: "urgent",
    });
  }

  for (const source of data.reviewSources) {
    if (source.previousScore > 0 && source.score < source.previousScore) {
      list.push({
        id: `alert-review-source-${source.source}`,
        page: "social",
        title: `${source.source}: review score slipped`,
        detail: `Average moved ${source.previousScore.toFixed(1)} → ${source.score.toFixed(1)} across ${source.reviews.toLocaleString()} reviews.`,
        at: data.latestReviewScan.scannedAt,
        severity: "watch",
      });
    }
  }

  const awaitingReply = data.latestReviewScan.items.filter(
    (review) =>
      !review.replied && review.sentiment === "negative" && replyOverdue(review.postedAt),
  );
  if (awaitingReply.length) {
    const oldest = awaitingReply.reduce((a, b) =>
      new Date(a.postedAt) <= new Date(b.postedAt) ? a : b,
    );
    list.push({
      id: "alert-review-awaiting-reply",
      page: "social",
      title: `${awaitingReply.length} review${awaitingReply.length === 1 ? "" : "s"} awaiting a reply over ${REPLY_WINDOW_HOURS}h`,
      detail: `Oldest: ${oldest.author} — ${oldest.rating}★ on ${oldest.source}. Reply from the Social & reviews page.`,
      at: oldest.postedAt,
      severity: "urgent",
    });
  }

  for (const gap of data.competitorReviewGaps) {
    if (gap.previousReviewGap === null) continue;
    if (gap.reviewGap > gap.previousReviewGap) {
      list.push({
        id: `alert-review-gap-${gap.competitorId}`,
        page: "competition",
        title: `${gap.competitorName}: review gap widened`,
        detail: `Their local review lead grew from ${gap.previousReviewGap.toLocaleString()} to ${gap.reviewGap.toLocaleString()}. Their customers' complaints are a promise your next ad can make.`,
        at: gap.checkedAt,
        severity: "watch",
      });
    }
  }

  // Cost control: warn at 80% and again once a provider's monthly allowance is
  // used up, because the next scan will be refused rather than run.
  for (const provider of data.providerStatus) {
    const { pct, capped } = providerUsage(provider);
    if (!capped || pct < 80) continue;

    const spend = provider.cap > 0
      ? `${provider.units} of ${provider.cap} monthly units used`
      : `$${provider.costUsd.toFixed(2)} of $${provider.capUsd.toFixed(2)} monthly spend used`;

    list.push({
      id: `alert-budget-${provider.provider}`,
      page: "notifications",
      title:
        pct >= 100
          ? `${provider.label} budget used up`
          : `${provider.label} budget at ${Math.round(pct)}%`,
      detail:
        pct >= 100
          ? `${spend}. ${provider.label} calls are refused until the cap is raised or the month rolls over.`
          : `${spend}. Raise the cap before the next scan is refused.`,
      at: new Date().toISOString(),
      severity: pct >= 100 ? "urgent" : "watch",
    });
  }

  // Publishing: a failed (or partially delivered) post needs attention; a fresh
  // publish is worth knowing went out.
  for (const job of data.publishJobs) {
    const names = job.platforms.map(platformLabel).join(", ");
    if (job.status === "failed" || job.status === "partial") {
      list.push({
        id: `alert-publish-${job.id}`,
        page: "promotion",
        title: job.status === "failed" ? "Ad post failed" : "Ad post reached only some platforms",
        detail: job.error || `Platforms: ${names || "unknown"}.`,
        at: job.updatedAt,
        severity: job.status === "failed" ? "urgent" : "watch",
      });
    } else if (
      job.status === "published" &&
      new Date(job.updatedAt).getTime() > Date.now() - 86_400_000
    ) {
      list.push({
        id: `alert-publish-${job.id}`,
        page: "promotion",
        title: `Ad published${names ? ` to ${names}` : ""}`,
        detail: job.permalink ? `View the post at ${job.permalink}` : "The post is live on your accounts.",
        at: job.updatedAt,
        severity: "info",
      });
    }
  }

  return list
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((a) => ({ ...a, detail: `${relativeTime(a.at)} · ${a.detail}` }));
}

export function alertsFor(data: WorkspaceData, page: RouteId): Alert[] {
  return buildAlerts(data).filter((a) => a.page === page);
}
