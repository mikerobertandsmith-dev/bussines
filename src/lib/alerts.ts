import type { RouteId } from "./hooks";
import type { WorkspaceData } from "./types";
import { money, relativeTime } from "./format";

export interface Alert {
  id: string;
  page: RouteId;
  title: string;
  detail: string;
  at: string;
  severity: "urgent" | "watch" | "info";
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

  if (data.latestReviewScan.flagged > 0) {
    list.push({
      id: "alert-my-reviews",
      page: "business",
      title: `${data.latestReviewScan.flagged} reviews need a reply`,
      detail: `Latest scan found ${data.latestReviewScan.newReviews} new reviews and flagged ${data.latestReviewScan.flagged} for follow-up.`,
      at: data.latestReviewScan.scannedAt,
      severity: "urgent",
    });
  }

  return list
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .map((a) => ({ ...a, detail: `${relativeTime(a.at)} · ${a.detail}` }));
}

export function alertsFor(data: WorkspaceData, page: RouteId): Alert[] {
  return buildAlerts(data).filter((a) => a.page === page);
}
