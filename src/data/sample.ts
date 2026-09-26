import { adAssets, geoVisibility, inventoryRecommendations, latestReviewScan, myBusiness, reviewSources, socialScores, topGeoKeywords, topSeoKeywords, weeklyReports } from "./business";
import { clients, mailAccount, sentMessages } from "./clients";
import { competitors } from "./competitors";
import { suppliers, supplierItems } from "./suppliers";
import { deliveredAds, inventoryItems, promotionBriefs } from "./commerce";
import { daysAhead } from "../lib/format";
import type { BusinessMetrics, BusinessProfile, TrafficPoint, WorkspaceData } from "../lib/types";

/** Business-level numbers live on the profile row; series come from metrics rows. */
export function metricsFromProfile(
  profile: BusinessProfile,
  series: {
    traffic: TrafficPoint[];
    trafficSources: { label: string; share: number }[];
    topServers: { name: string; share: number }[];
    geoVisibility?: TrafficPoint[];
  },
): BusinessMetrics {
  return {
    seoScore: profile.seoScore,
    previousSeoScore: profile.previousSeoScore,
    geoScore: profile.geoScore,
    previousGeoScore: profile.previousGeoScore,
    domainAuthority: profile.domainAuthority,
    indexedPages: profile.indexedPages,
    backlinks: profile.backlinks,
    industryRank: profile.industryRank,
    industryRankPrevious: profile.industryRankPrevious,
    monthlyVisits: profile.monthlyVisits,
    visitsChange: profile.visitsChange,
    conversionRate: profile.conversionRate,
    traffic: series.traffic,
    trafficSources: series.trafficSources,
    topServers: series.topServers,
  };
}

export const sampleProfile: BusinessProfile = {
  id: "sample-business",
  ownerUserId: "sample-user",
  ownerEmail: mailAccount.loginEmail,
  brandName: "Your Retail Brand",
  logoUrl: "",
  legalName: "",
  industry: "Beauty & electronics retail",
  niche: "Beauty & cosmetics",
  primaryDomain: "yourretailbrand.com",
  secondaryDomains: ["shop.yourretailbrand.com"],
  platformType: "website",
  country: "Kenya",
  currency: "USD",
  timezone: "Africa/Nairobi (GMT+3)",
  teamSize: "2-10",
  primaryGoal: "Beat competitors on price and stock alerts",
  goals: ["win more traffic", "never miss a supplier price drop", "keep clients updated"],
  adPlatforms: ["Meta Ads", "Google Ads", "TikTok Ads"],
  socialHandles: { Instagram: "@yourretailbrand", TikTok: "@yourretailbrand" },
  notificationEmail: mailAccount.loginEmail,
  reportDay: "Friday",
  onboardingComplete: true,
  seoScore: myBusiness.seoScore,
  previousSeoScore: myBusiness.previousSeoScore,
  geoScore: myBusiness.geoScore,
  previousGeoScore: myBusiness.previousGeoScore,
  monthlyVisits: myBusiness.monthlyVisits,
  visitsChange: myBusiness.visitsChange,
  conversionRate: myBusiness.conversionRate,
  industryRank: myBusiness.industryRank,
  industryRankPrevious: myBusiness.industryRankPrevious,
  domainAuthority: myBusiness.domainAuthority,
  indexedPages: myBusiness.indexedPages,
  backlinks: myBusiness.trustpilotBacklinks,
};

/** The complete workspace used in demo mode and before the first scan lands. */
export function sampleWorkspace(profile: BusinessProfile = sampleProfile): WorkspaceData {
  return {
    profile,
    metrics: metricsFromProfile(profile, {
      traffic: myBusiness.traffic,
      trafficSources: myBusiness.trafficSources,
      topServers: myBusiness.topServers,
      geoVisibility: geoVisibility,
    }),
    suppliers,
    supplierItems,
    competitors,
    clients,
    mailAccount,
    sentMessages,
    topSeoKeywords,
    topGeoKeywords,
    geoVisibility,
    weeklyReports,
    reviewSources,
    latestReviewScan: {
      scannedAt: latestReviewScan.scannedAt,
      nextScanAt: daysAhead(1),
      newReviews: latestReviewScan.newReviews,
      flagged: latestReviewScan.flagged,
      averageRating: latestReviewScan.averageRating,
      items: latestReviewScan.items.map((r) => ({
        ...r,
        isFlagged: r.sentiment === "negative",
      })),
    },
    adAssets,
    socialScores,
    inventoryRecommendations,
    inventory: inventoryItems,
    promotionBriefs,
    deliveredAds,
    buyList: [],
    scanRuns: [],
    isSample: true,
  };
}
