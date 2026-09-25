import type { MessageType } from "./types";

export const INDUSTRIES = [
  "Beauty & cosmetics",
  "Fashion",
  "Phones & electronics",
  "Home appliances",
  "Auto parts",
  "Other retail",
];

export const GOALS = [
  "Win more organic traffic",
  "Never miss a supplier price drop",
  "React faster to competitor promotions",
  "Keep clients updated automatically",
  "Grow social following",
  "Get better product reviews",
  "Know which stock to buy next",
];

export const AD_PLATFORMS = [
  "Meta Ads",
  "Instagram",
  "TikTok Ads",
  "Google Ads",
  "YouTube Ads",
  "Pinterest Ads",
  "X Ads",
  "Snapchat Ads",
];

export const SOCIAL_PLATFORMS = [
  "Instagram",
  "TikTok",
  "Facebook",
  "X (Twitter)",
  "YouTube",
  "Pinterest",
  "LinkedIn",
];

export const REPORT_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const CURRENCIES = ["USD", "EUR", "GBP", "KES", "NGN", "ZAR", "INR", "AED"];

export const TEAM_SIZES = ["Just me", "2-10", "11-50", "51-200", "200+"];

export const PLATFORM_TYPES = [
  { value: "website", label: "Own website / online store" },
  { value: "marketplace", label: "Marketplace only" },
  { value: "both", label: "Both website and marketplace" },
];

export const MESSAGE_TYPES: { value: MessageType; label: string; hint: string }[] = [
  { value: "new_stock", label: "New stock", hint: "Anything new or restocked at your suppliers" },
  { value: "two_day_checkin", label: "2-day check-in", hint: "Short status note every second day" },
  { value: "platform_info", label: "Platform info", hint: "New features and data added to their dashboard" },
  { value: "deals", label: "Deals", hint: "Live supplier and platform deals worth buying" },
  { value: "competitor_alert", label: "Competitor alert", hint: "Their price, stock and ad moves" },
  { value: "review_update", label: "Review update", hint: "New reviews and what to answer" },
  { value: "weekly_report", label: "Weekly report", hint: "SEO, GEO, traffic and actions summary" },
];

/**
 * What a customer can be sent. Competitor alerts stay internal to the desk —
 * they are intelligence for the owner, not something a client subscribes to.
 */
export const CUSTOMER_MESSAGE_TYPES = MESSAGE_TYPES.filter(
  (type) => type.value !== "competitor_alert",
);

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}
