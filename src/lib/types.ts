export type Cadence = "daily" | "weekly" | "monthly";

export type ChangeType =
  | "new_product"
  | "price_change"
  | "stock_change"
  | "promotion"
  | "removed";

export type StockState = "in_stock" | "low_stock" | "out_of_stock" | "preorder";

/* ---------------- Suppliers ---------------- */

export interface Supplier {
  id: string;
  name: string;
  website: string;
  category: string;
  cadence: Cadence;
  lastScan: string;
  nextScan: string;
  scanHealth: number;
  accountManager: string;
  leadTimeDays: number;
}

export interface SupplierItem {
  id: string;
  supplierId: string;
  product: string;
  sku: string;
  category: string;
  price: number;
  previousPrice: number;
  stock: StockState;
  previousStock: StockState;
  change: ChangeType;
  detectedAt: string;
  leadTimeDays: number;
  moq: number;
  url: string;
  note?: string;
}

/* ---------------- Competitors ---------------- */

export interface TrafficPoint {
  label: string;
  visits: number;
}

export interface SocialChannel {
  platform: string;
  handle: string;
  followers: number;
  engagementRate: number;
  postsPerWeek: number;
  adsRunning: number;
}

export interface KeywordGap {
  keyword: string;
  volume: number;
  ourRank: number | null;
  theirRank: number;
  difficulty: number;
  intent: "informational" | "commercial" | "transactional";
}

export interface AdCreative {
  id: string;
  platform: string;
  headline: string;
  audience: string;
  firstSeen: string;
  status: "active" | "paused";
  focus: string;
  bannerUrl: string;
  landingUrl: string;
}

export interface CompetitorReview {
  id: string;
  author: string;
  rating: number;
  postedAt: string;
  source: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
}

export interface AudienceSlice {
  segment: string;
  ageRange: string;
  share: number;
}

export interface CompetitorItem {
  id: string;
  product: string;
  category: string;
  price: number;
  stock: StockState;
  detectedAt: string;
  url: string;
}

export interface Competitor {
  id: string;
  name: string;
  website: string;
  cadence: Cadence;
  lastScan: string;
  monthlyVisits: number;
  visitsChange: number;
  traffic: TrafficPoint[];
  trafficSources: { label: string; share: number }[];
  seoScore: number;
  geoScore: number;
  social: SocialChannel[];
  adPlatforms: string[];
  rating: number;
  previousRating: number;
  reviewCount: number;
  reviewsThisMonth: number;
  reviewTrend: TrafficPoint[];
  reviews: CompetitorReview[];
  audience: AudienceSlice[];
  ads: AdCreative[];
  newItems: CompetitorItem[];
  keywordGap: KeywordGap[];
}

/* ---------------- Clients ---------------- */

export type MessageType =
  | "new_stock"
  | "two_day_checkin"
  | "platform_info"
  | "deals"
  | "competitor_alert"
  | "review_update"
  | "weekly_report";

export type SendFrequency = "every_2_days" | "daily" | "weekly" | "monthly";

export interface Client {
  id: string;
  name: string;
  email: string;
  company: string;
  industry: string;
  status: "active" | "paused" | "prospect";
  tier: "starter" | "growth" | "premium";
  joinedAt: string;
  lastContacted: string;
  nextSendAt: string;
  frequency: SendFrequency;
  messageTypes: MessageType[];
  openRate: number;
  monthlyFee: number;
  notes?: string;
}

export interface SentMessage {
  id: string;
  clientId: string;
  clientName: string;
  subject: string;
  types: MessageType[];
  sentAt: string;
  status: "delivered" | "opened" | "clicked" | "bounced";
}

export interface MailAccount {
  senderName: string;
  loginEmail: string;
  replyTo: string;
  signature: string;
  timezone: string;
  dailyDigest: boolean;
  secondaryEmail: string;
}

/* ---------------- My business ---------------- */

export interface RankRow {
  keyword: string;
  volume: number;
  position: number;
  change: number;
}

export interface GeoRankRow {
  prompt: string;
  engine: string;
  position: number;
  change: number;
}

export interface ReviewSource {
  source: string;
  score: number;
  previousScore: number;
  reviews: number;
  newThisMonth: number;
  series: TrafficPoint[];
}

export interface AdAsset {
  id: string;
  product: string;
  sku: string;
  formats: string[];
  shootStatus: "ready" | "editing" | "scheduled";
  shootDate: string;
  figmaUrl: string;
  /** Public or signed URL of the exported creative bundle. */
  downloadUrl?: string | null;
  /** Path inside the `ad-assets` Supabase Storage bucket. */
  storagePath?: string | null;
  sizeMb: number;
  downloads: number;
}

export interface SocialScore {
  platform: string;
  handle: string;
  score: number;
  followers: number;
  growth: number;
  benchmarkGap: number;
  focus: "high" | "medium" | "low";
  reason: string;
}

export interface InventoryRecommendation {
  id: string;
  product: string;
  category: string;
  supplierId: string;
  suggestedQty: number;
  estimatedPrice: number;
  marginPct: number;
  trafficPotential: number;
  reason: string;
  priority: "high" | "medium" | "low";
  competitorRef: string;
}

export interface WeeklyReport {
  week: string;
  seoScore: number;
  geoScore: number;
  visits: number;
  conversions: number;
  highlight: string;
  actions: string[];
}

/* ---------------- Account, onboarding and workspace ---------------- */

export interface BusinessProfile {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  brandName: string;
  legalName: string;
  industry: string;
  niche: string;
  primaryDomain: string;
  secondaryDomains: string[];
  platformType: string;
  country: string;
  currency: string;
  timezone: string;
  teamSize: string;
  primaryGoal: string;
  goals: string[];
  adPlatforms: string[];
  socialHandles: Record<string, string>;
  notificationEmail: string;
  reportDay: string;
  onboardingComplete: boolean;
  /* Latest business-level scores, refreshed by each scan. */
  seoScore: number;
  previousSeoScore: number;
  geoScore: number;
  previousGeoScore: number;
  monthlyVisits: number;
  visitsChange: number;
  conversionRate: number;
  industryRank: number;
  industryRankPrevious: number;
  domainAuthority: number;
  indexedPages: number;
  backlinks: number;
}

export interface BusinessMetrics {
  seoScore: number;
  previousSeoScore: number;
  geoScore: number;
  previousGeoScore: number;
  domainAuthority: number;
  indexedPages: number;
  backlinks: number;
  industryRank: number;
  industryRankPrevious: number;
  monthlyVisits: number;
  visitsChange: number;
  conversionRate: number;
  traffic: TrafficPoint[];
  trafficSources: { label: string; share: number }[];
  topServers: { name: string; share: number }[];
}

export interface MyReview {
  id: string;
  author: string;
  rating: number;
  source: string;
  postedAt: string;
  text: string;
  sentiment: "positive" | "neutral" | "negative";
  action: string;
  isFlagged?: boolean;
}

export interface ReviewScan {
  scannedAt: string;
  nextScanAt: string;
  newReviews: number;
  flagged: number;
  averageRating: number;
  items: MyReview[];
}

export interface ScanRun {
  id: string;
  sourceType: "supplier" | "competitor" | "reviews" | "seo" | "geo" | "social";
  sourceId: string | null;
  sourceName: string;
  status: "queued" | "running" | "succeeded" | "failed";
  changesFound: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A source the user is watching, collected during onboarding. */
export interface MonitoringSourceInput {
  name: string;
  website: string;
  category: string;
  cadence: Cadence;
}

export interface ClientSeedInput {
  name: string;
  email: string;
  company: string;
  frequency: SendFrequency;
  messageTypes: MessageType[];
}

/** Everything the onboarding wizard collects. */
export interface OnboardingInput {
  brandName: string;
  legalName: string;
  industry: string;
  niche: string;
  primaryDomain: string;
  secondaryDomains: string[];
  platformType: string;
  country: string;
  currency: string;
  timezone: string;
  teamSize: string;
  primaryGoal: string;
  goals: string[];
  adPlatforms: string[];
  socialHandles: Record<string, string>;
  notificationEmail: string;
  reportDay: string;
  supplierCadence: Cadence;
  competitors: MonitoringSourceInput[];
  suppliers: MonitoringSourceInput[];
  clientCadence: SendFrequency;
  clientMessageTypes: MessageType[];
  loginEmail: string;
  signature: string;
  seedClients: ClientSeedInput[];
}

/** The single data shape every page renders from. */
export interface WorkspaceData {
  profile: BusinessProfile;
  metrics: BusinessMetrics;
  suppliers: Supplier[];
  supplierItems: SupplierItem[];
  competitors: Competitor[];
  clients: Client[];
  mailAccount: MailAccount;
  sentMessages: SentMessage[];
  topSeoKeywords: RankRow[];
  topGeoKeywords: GeoRankRow[];
  geoVisibility: TrafficPoint[];
  weeklyReports: WeeklyReport[];
  reviewSources: ReviewSource[];
  latestReviewScan: ReviewScan;
  adAssets: AdAsset[];
  socialScores: SocialScore[];
  inventoryRecommendations: InventoryRecommendation[];
  buyList: string[];
  scanRuns: ScanRun[];
  /** True while the workspace has no monitored data of its own yet. */
  isSample: boolean;
}
