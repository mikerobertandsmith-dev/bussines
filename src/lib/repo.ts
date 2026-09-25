import { requireSupabase } from "./supabase";
import { nextScanFrom, nextSendFrom } from "./schedule";
import type {
  AdAsset,
  BusinessMetrics,
  BusinessProfile,
  Client,
  Competitor,
  CompetitorItem,
  CompetitorReview,
  GeoRankRow,
  InventoryRecommendation,
  MailAccount,
  MessageType,
  MyReview,
  OnboardingInput,
  RankRow,
  ReviewScan,
  ReviewSource,
  ScanRun,
  SendFrequency,
  SentMessage,
  SocialChannel,
  SocialScore,
  Supplier,
  SupplierItem,
  TrafficPoint,
  WeeklyReport,
  WorkspaceData,
} from "./types";
import type { Cadence, KeywordGap, AdCreative, AudienceSlice } from "./types";

/* ------------------------------------------------------------------ helpers */

type Row = Record<string, any>;

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);
}

function rows<T>(response: { data: unknown; error: { message: string } | null }): T[] {
  if (response.error) throw new Error(response.error.message);
  return (response.data ?? []) as T[];
}

function orderBySort(list: Row[]): Row[] {
  return [...list].sort((a, b) => num(a.sort_order) - num(b.sort_order));
}

const EMPTY_METRICS: BusinessMetrics = {
  seoScore: 0,
  previousSeoScore: 0,
  geoScore: 0,
  previousGeoScore: 0,
  domainAuthority: 0,
  indexedPages: 0,
  backlinks: 0,
  industryRank: 0,
  industryRankPrevious: 0,
  monthlyVisits: 0,
  visitsChange: 0,
  conversionRate: 0,
  traffic: [],
  trafficSources: [],
  topServers: [],
};

/* --------------------------------------------------------------- onboarding */

export async function fetchBusiness(ownerUserId: string): Promise<BusinessProfile | null> {
  const db = requireSupabase();
  const response = await db
    .from("businesses")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();
  if (response.error) throw new Error(response.error.message);
  return response.data ? mapProfile(response.data as Row) : null;
}

/**
 * Creates the tenant row plus every source the user listed during onboarding,
 * so the pages have their real suppliers, competitors and clients from day one.
 */
export async function createWorkspaceFromOnboarding(
  ownerUserId: string,
  ownerEmail: string,
  input: OnboardingInput,
): Promise<BusinessProfile> {
  const db = requireSupabase();

  const { data: business, error } = await db
    .from("businesses")
    .insert({
      owner_user_id: ownerUserId,
      owner_email: ownerEmail,
      brand_name: input.brandName,
      legal_name: input.legalName,
      industry: input.industry,
      niche: input.niche,
      primary_domain: input.primaryDomain,
      secondary_domains: input.secondaryDomains,
      platform_type: input.platformType,
      country: input.country,
      currency: input.currency,
      timezone: input.timezone,
      team_size: input.teamSize,
      primary_goal: input.primaryGoal,
      goals: input.goals,
      ad_platforms: input.adPlatforms,
      social_handles: input.socialHandles,
      notification_email: input.notificationEmail || ownerEmail,
      report_day: input.reportDay,
      onboarding_complete: true,
      onboarding_completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !business) throw new Error(error?.message ?? "Could not create the business profile.");

  const businessId = business.id as string;
  const now = new Date().toISOString();

  const supplierPayload = input.suppliers
    .filter((s) => s.name.trim())
    .map((s) => ({
      business_id: businessId,
      name: s.name.trim(),
      website: s.website.trim(),
      category: s.category || input.niche,
      cadence: s.cadence || input.supplierCadence,
      next_scan_at: nextScanFrom(s.cadence || input.supplierCadence),
    }));

  if (supplierPayload.length) {
    const { error: supplierError } = await db.from("suppliers").insert(supplierPayload);
    if (supplierError) throw new Error(supplierError.message);
  }

  const competitorPayload = input.competitors
    .filter((c) => c.name.trim())
    .map((c) => ({
      business_id: businessId,
      name: c.name.trim(),
      website: c.website.trim(),
      cadence: c.cadence || input.supplierCadence,
      notes: c.category ? `Category: ${c.category}` : null,
    }));

  if (competitorPayload.length) {
    const { error: competitorError } = await db.from("competitors").insert(competitorPayload);
    if (competitorError) throw new Error(competitorError.message);
  }

  const clientPayload = input.seedClients
    .filter((c) => c.email.trim())
    .map((c) => ({
      business_id: businessId,
      name: c.name.trim() || c.email.split("@")[0],
      email: c.email.trim(),
      company: c.company.trim(),
      industry: input.industry,
      status: "active" as const,
      frequency: c.frequency || input.clientCadence,
      message_types: c.messageTypes.length ? c.messageTypes : input.clientMessageTypes,
      next_send_at: nextSendFrom(c.frequency || input.clientCadence, c.messageTypes),
    }));

  if (clientPayload.length) {
    const { error: clientError } = await db.from("clients").insert(clientPayload);
    if (clientError) throw new Error(clientError.message);
  }

  const { error: mailError } = await db.from("mail_accounts").insert({
    business_id: businessId,
    sender_name: input.brandName,
    login_email: input.loginEmail || ownerEmail,
    reply_to: input.loginEmail || ownerEmail,
    secondary_email: ownerEmail,
    signature: input.signature,
    timezone: input.timezone,
    daily_digest: true,
  });
  if (mailError) throw new Error(mailError.message);

  await db.from("scan_runs").insert({
    business_id: businessId,
    source_type: "supplier",
    source_name: "Onboarding baseline scan",
    status: "queued",
    started_at: now,
  });

  return mapProfile(business as Row);
}

/* ----------------------------------------------------------------- loading */

export async function loadWorkspace(profile: BusinessProfile): Promise<WorkspaceData> {
  const db = requireSupabase();
  const id = profile.id;

  const [
    suppliersRes,
    supplierItemsRes,
    competitorsRes,
    metricsRes,
    socialRes,
    keywordsRes,
    adsRes,
    reviewsRes,
    audienceRes,
    itemsRes,
    clientsRes,
    mailRes,
    sentRes,
    myKeywordsRes,
    myMetricsRes,
    reviewSourcesRes,
    reviewSeriesRes,
    myReviewsRes,
    adAssetsRes,
    socialScoresRes,
    recommendationsRes,
    buyListRes,
    reportsRes,
    scanRunsRes,
  ] = await Promise.all([
    db.from("suppliers").select("*").eq("business_id", id).order("name"),
    db.from("supplier_items").select("*").eq("business_id", id).order("detected_at", { ascending: false }).limit(300),
    db.from("competitors").select("*").eq("business_id", id).order("monthly_visits", { ascending: false }),
    db.from("competitor_metrics").select("*").eq("business_id", id),
    db.from("competitor_social").select("*").eq("business_id", id),
    db.from("competitor_keywords").select("*").eq("business_id", id),
    db.from("competitor_ads").select("*").eq("business_id", id).order("first_seen_at", { ascending: false }),
    db.from("competitor_reviews").select("*").eq("business_id", id).order("posted_at", { ascending: false }),
    db.from("competitor_audience").select("*").eq("business_id", id).order("share", { ascending: false }),
    db.from("competitor_items").select("*").eq("business_id", id).order("detected_at", { ascending: false }),
    db.from("clients").select("*").eq("business_id", id).order("name"),
    db.from("mail_accounts").select("*").eq("business_id", id).maybeSingle(),
    db.from("sent_messages").select("*").eq("business_id", id).order("sent_at", { ascending: false }).limit(100),
    db.from("my_keywords").select("*").eq("business_id", id),
    db.from("my_metrics").select("*").eq("business_id", id),
    db.from("my_review_sources").select("*").eq("business_id", id),
    db.from("my_review_series").select("*").eq("business_id", id),
    db.from("my_reviews").select("*").eq("business_id", id).order("posted_at", { ascending: false }).limit(100),
    db.from("ad_assets").select("*").eq("business_id", id).order("shoot_date", { ascending: false }),
    db.from("social_scores").select("*").eq("business_id", id).order("score", { ascending: false }),
    db.from("inventory_recommendations").select("*").eq("business_id", id).order("traffic_potential", { ascending: false }),
    db.from("buy_list_items").select("*").eq("business_id", id),
    db.from("weekly_reports").select("*").eq("business_id", id).order("week_start", { ascending: false }).limit(12),
    db.from("scan_runs").select("*").eq("business_id", id).order("started_at", { ascending: false }).limit(50),
  ]);

  const supplierRows = rows<Row>(suppliersRes);
  const supplierItemRows = rows<Row>(supplierItemsRes);
  const competitorRows = rows<Row>(competitorsRes);
  const metricRows = rows<Row>(metricsRes);
  const socialRows = rows<Row>(socialRes);
  const keywordRows = rows<Row>(keywordsRes);
  const adRows = rows<Row>(adsRes);
  const reviewRows = rows<Row>(reviewsRes);
  const audienceRows = rows<Row>(audienceRes);
  const itemRows = rows<Row>(itemsRes);
  const clientRows = rows<Row>(clientsRes);
  const myKeywordRows = rows<Row>(myKeywordsRes);
  const myMetricRows = rows<Row>(myMetricsRes);
  const reviewSourceRows = rows<Row>(reviewSourcesRes);
  const reviewSeriesRows = rows<Row>(reviewSeriesRes);
  const myReviewRows = rows<Row>(myReviewsRes);
  const scanRows = rows<Row>(scanRunsRes);

  const competitors: Competitor[] = competitorRows.map((c) => {
    const related = (list: Row[]) => list.filter((r) => r.competitor_id === c.id);
    return {
      id: c.id,
      name: str(c.name),
      website: str(c.website),
      cadence: (c.cadence ?? "daily") as Cadence,
      lastScan: str(c.last_scan_at, new Date().toISOString()),
      monthlyVisits: num(c.monthly_visits),
      visitsChange: num(c.visits_change),
      seoScore: num(c.seo_score),
      geoScore: num(c.geo_score),
      rating: num(c.rating),
      previousRating: num(c.previous_rating, num(c.rating)),
      reviewCount: num(c.review_count),
      reviewsThisMonth: num(c.reviews_this_month),
      adPlatforms: (c.ad_platforms ?? []) as string[],
      traffic: orderBySort(related(metricRows).filter((m) => m.kind === "traffic")).map((m) => ({
        label: str(m.label),
        visits: num(m.value),
      })),
      reviewTrend: orderBySort(related(metricRows).filter((m) => m.kind === "review_trend")).map((m) => ({
        label: str(m.label),
        visits: num(m.value),
      })),
      trafficSources: orderBySort(related(metricRows).filter((m) => m.kind === "traffic_source")).map((m) => ({
        label: str(m.label),
        share: num(m.value),
      })),
      social: related(socialRows).map<SocialChannel>((s) => ({
        platform: str(s.platform),
        handle: str(s.handle),
        followers: num(s.followers),
        engagementRate: num(s.engagement_rate),
        postsPerWeek: num(s.posts_per_week),
        adsRunning: num(s.ads_running),
      })),
      keywordGap: related(keywordRows).map<KeywordGap>((k) => ({
        keyword: str(k.keyword),
        volume: num(k.volume),
        ourRank: k.our_rank === null || k.our_rank === undefined ? null : num(k.our_rank),
        theirRank: num(k.their_rank),
        difficulty: num(k.difficulty),
        intent: (str(k.intent, "commercial") as KeywordGap["intent"]),
      })),
      ads: related(adRows).map<AdCreative>((a) => ({
        id: a.id,
        platform: str(a.platform),
        headline: str(a.headline),
        audience: str(a.audience),
        firstSeen: str(a.first_seen_at, new Date().toISOString()),
        status: (a.status ?? "active") as AdCreative["status"],
        focus: str(a.focus),
        bannerUrl: str(a.banner_url),
        landingUrl: str(a.landing_url),
      })),
      reviews: related(reviewRows).map<CompetitorReview>((r) => ({
        id: r.id,
        author: str(r.author),
        rating: num(r.rating),
        postedAt: str(r.posted_at, new Date().toISOString()),
        source: str(r.source),
        text: str(r.body),
        sentiment: (r.sentiment ?? "neutral") as CompetitorReview["sentiment"],
      })),
      audience: related(audienceRows).map<AudienceSlice>((a) => ({
        segment: str(a.segment),
        ageRange: str(a.age_range),
        share: num(a.share),
      })),
      newItems: related(itemRows).map<CompetitorItem>((i) => ({
        id: i.id,
        product: str(i.product),
        category: str(i.category),
        price: num(i.price),
        stock: (i.stock ?? "in_stock") as CompetitorItem["stock"],
        detectedAt: str(i.detected_at, new Date().toISOString()),
        url: str(i.url),
      })),
    };
  });

  const metrics: BusinessMetrics = {
    ...EMPTY_METRICS,
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
    traffic: orderBySort(myMetricRows.filter((m) => m.kind === "traffic")).map((m) => ({
      label: str(m.label),
      visits: num(m.value),
    })),
    trafficSources: orderBySort(myMetricRows.filter((m) => m.kind === "channel")).map((m) => ({
      label: str(m.label),
      share: num(m.value),
    })),
    topServers: orderBySort(myMetricRows.filter((m) => m.kind === "search_surface")).map((m) => ({
      name: str(m.label),
      share: num(m.value),
    })),
  };

  const reviewSeries: Record<string, TrafficPoint[]> = {};
  for (const row of orderBySort(reviewSeriesRows)) {
    const key = str(row.source);
    reviewSeries[key] = reviewSeries[key] ?? [];
    reviewSeries[key].push({ label: str(row.label), visits: num(row.score) });
  }

  const reviewSources: ReviewSource[] = reviewSourceRows.map((s) => ({
    source: str(s.source),
    score: num(s.score),
    previousScore: num(s.previous_score, num(s.score)),
    reviews: num(s.reviews),
    newThisMonth: num(s.new_this_month),
    series: reviewSeries[str(s.source)] ?? [],
  }));

  const reviewScanRuns = scanRows.filter((r) => r.source_type === "reviews");
  const reviewsPostedRecently = myReviewRows.filter(
    (r) => new Date(str(r.posted_at)).getTime() > Date.now() - 7 * 864e5,
  );

  const latestReviewScan: ReviewScan = {
    scannedAt: str(reviewScanRuns[0]?.finished_at ?? reviewScanRuns[0]?.started_at, new Date().toISOString()),
    nextScanAt: nextScanFrom("weekly"),
    newReviews: reviewsPostedRecently.length,
    flagged: myReviewRows.filter((r) => r.is_flagged).length,
    averageRating: myReviewRows.length
      ? Number((myReviewRows.reduce((sum, r) => sum + num(r.rating), 0) / myReviewRows.length).toFixed(2))
      : 0,
    items: myReviewRows.map<MyReview>((r) => ({
      id: r.id,
      author: str(r.author),
      rating: num(r.rating),
      source: str(r.source),
      postedAt: str(r.posted_at, new Date().toISOString()),
      text: str(r.body),
      sentiment: (r.sentiment ?? "neutral") as MyReview["sentiment"],
      action: str(r.action),
      isFlagged: Boolean(r.is_flagged),
    })),
  };

  const mailAccount: MailAccount = mailRes.data
    ? {
        senderName: str((mailRes.data as Row).sender_name, profile.brandName),
        loginEmail: str((mailRes.data as Row).login_email, profile.ownerEmail),
        replyTo: str((mailRes.data as Row).reply_to, profile.ownerEmail),
        secondaryEmail: str((mailRes.data as Row).secondary_email, profile.ownerEmail),
        signature: str((mailRes.data as Row).signature),
        timezone: str((mailRes.data as Row).timezone, profile.timezone),
        dailyDigest: (mailRes.data as Row).daily_digest !== false,
        sendFrequency: ((mailRes.data as Row).send_frequency ?? "weekly") as SendFrequency,
        messageTypes: ((mailRes.data as Row).message_types ?? [
          "new_stock",
          "deals",
        ]) as MessageType[],
      }
    : {
        senderName: profile.brandName,
        loginEmail: profile.ownerEmail,
        replyTo: profile.ownerEmail,
        secondaryEmail: profile.ownerEmail,
        signature: "",
        timezone: profile.timezone,
        dailyDigest: true,
        sendFrequency: "weekly",
        messageTypes: ["new_stock", "deals"],
      };

  const workspace: WorkspaceData = {
    /* downloadUrl is filled with a signed Storage URL below */
    profile,
    metrics,
    suppliers: supplierRows.map<Supplier>((s) => ({
      id: s.id,
      name: str(s.name),
      website: str(s.website),
      category: str(s.category),
      cadence: (s.cadence ?? "daily") as Cadence,
      lastScan: str(s.last_scan_at, str(s.created_at, new Date().toISOString())),
      nextScan: str(s.next_scan_at, nextScanFrom((s.cadence ?? "daily") as Cadence)),
      scanHealth: num(s.scan_health, 100),
      accountManager: str(s.account_manager),
      leadTimeDays: num(s.lead_time_days),
    })),
    supplierItems: supplierItemRows.map<SupplierItem>((i) => ({
      id: i.id,
      supplierId: i.supplier_id,
      product: str(i.product),
      sku: str(i.sku),
      category: str(i.category),
      price: num(i.price),
      previousPrice: num(i.previous_price, num(i.price)),
      stock: (i.stock ?? "in_stock") as SupplierItem["stock"],
      previousStock: (i.previous_stock ?? "in_stock") as SupplierItem["stock"],
      change: (i.change ?? "price_change") as SupplierItem["change"],
      detectedAt: str(i.detected_at, new Date().toISOString()),
      leadTimeDays: num(i.lead_time_days),
      moq: num(i.moq),
      url: str(i.url),
      note: str(i.note) || undefined,
    })),
    competitors,
    clients: clientRows.map<Client>((c) => ({
      id: c.id,
      name: str(c.name),
      email: str(c.email),
      company: str(c.company),
      industry: str(c.industry),
      status: (c.status ?? "active") as Client["status"],
      tier: (c.tier ?? "starter") as Client["tier"],
      joinedAt: str(c.joined_at, new Date().toISOString()),
      lastContacted: str(c.last_contacted_at, str(c.created_at, new Date().toISOString())),
      nextSendAt: str(c.next_send_at, nextSendFrom((c.frequency ?? "weekly") as SendFrequency)),
      frequency: (c.frequency ?? "weekly") as SendFrequency,
      messageTypes: (c.message_types ?? []) as MessageType[],
      openRate: num(c.open_rate),
      monthlyFee: num(c.monthly_fee),
      notes: str(c.notes) || undefined,
    })),
    mailAccount,
    sentMessages: rows<Row>(sentRes).map<SentMessage>((m) => ({
      id: m.id,
      clientId: str(m.client_id),
      clientName: str(m.client_name),
      subject: str(m.subject),
      types: (m.types ?? []) as MessageType[],
      sentAt: str(m.sent_at, new Date().toISOString()),
      status: (m.status ?? "delivered") as SentMessage["status"],
    })),
    topSeoKeywords: myKeywordRows
      .filter((k) => (k.kind ?? "seo") === "seo")
      .map<RankRow>((k) => ({
        keyword: str(k.keyword),
        volume: num(k.volume),
        position: num(k.position),
        change: num(k.change),
      }))
      .sort((a, b) => a.position - b.position),
    topGeoKeywords: myKeywordRows
      .filter((k) => k.kind === "geo")
      .map<GeoRankRow>((k) => ({
        prompt: str(k.keyword),
        engine: str(k.engine),
        position: num(k.position),
        change: num(k.change),
      }))
      .sort((a, b) => a.position - b.position),
    geoVisibility: orderBySort(myMetricRows.filter((m) => m.kind === "geo_visibility")).map((m) => ({
      label: str(m.label),
      visits: num(m.value),
    })),
    weeklyReports: rows<Row>(reportsRes).map<WeeklyReport>((r) => ({
      week: str(r.week_label),
      seoScore: num(r.seo_score),
      geoScore: num(r.geo_score),
      visits: num(r.visits),
      conversions: num(r.conversions),
      highlight: str(r.highlight),
      actions: (r.actions ?? []) as string[],
    })),
    reviewSources,
    latestReviewScan,
    adAssets: rows<Row>(adAssetsRes).map<AdAsset>((a) => ({
      id: a.id,
      product: str(a.product),
      sku: str(a.sku),
      formats: (a.formats ?? []) as string[],
      shootStatus: (a.shoot_status ?? "scheduled") as AdAsset["shootStatus"],
      shootDate: str(a.shoot_date, new Date().toISOString()),
      figmaUrl: str(a.figma_url),
      downloadUrl: null,
      storagePath: str(a.storage_path) || null,
      sizeMb: num(a.size_mb),
      downloads: num(a.downloads),
    })),
    socialScores: rows<Row>(socialScoresRes).map<SocialScore>((s) => ({
      platform: str(s.platform),
      handle: str(s.handle),
      score: num(s.score),
      followers: num(s.followers),
      growth: num(s.growth),
      benchmarkGap: num(s.benchmark_gap),
      focus: (s.focus ?? "medium") as SocialScore["focus"],
      reason: str(s.reason),
    })),
    inventoryRecommendations: rows<Row>(recommendationsRes).map<InventoryRecommendation>((r) => ({
      id: r.id,
      product: str(r.product),
      category: str(r.category),
      supplierId: str(r.supplier_id),
      suggestedQty: num(r.suggested_qty),
      estimatedPrice: num(r.estimated_price),
      marginPct: num(r.margin_pct),
      trafficPotential: num(r.traffic_potential),
      reason: str(r.reason),
      priority: (r.priority ?? "medium") as InventoryRecommendation["priority"],
      competitorRef: str(r.competitor_ref),
    })),
    buyList: rows<Row>(buyListRes).map((b) => str(b.recommendation_id)),
    scanRuns: scanRows.map<ScanRun>((r) => ({
      id: r.id,
      sourceType: (r.source_type ?? "supplier") as ScanRun["sourceType"],
      sourceId: r.source_id ?? null,
      sourceName: str(r.source_name),
      status: (r.status ?? "queued") as ScanRun["status"],
      changesFound: num(r.changes_found),
      error: str(r.error) || null,
      startedAt: str(r.started_at, new Date().toISOString()),
      finishedAt: str(r.finished_at) || null,
    })),
    isSample: supplierRows.length === 0 && competitorRows.length === 0 && clientRows.length === 0,
  };

  // Private bucket: hand back a short-lived signed URL per exported ad pack.
  if (db) {
    workspace.adAssets = await Promise.all(
      workspace.adAssets.map(async (asset) => {
        if (!asset.storagePath) return asset;
        try {
          const { data } = await db.storage.from("ad-assets").createSignedUrl(asset.storagePath, 3600);
          return { ...asset, downloadUrl: data?.signedUrl ?? null };
        } catch {
          return asset;
        }
      }),
    );
  }

  return workspace;
}

/* --------------------------------------------------------------- mutations */

export async function setSupplierCadence(supplierId: string, cadence: Cadence) {
  const db = requireSupabase();
  const { error } = await db
    .from("suppliers")
    .update({ cadence, next_scan_at: nextScanFrom(cadence) })
    .eq("id", supplierId);
  if (error) throw new Error(error.message);
}

export async function setCompetitorCadence(competitorId: string, cadence: Cadence) {
  const db = requireSupabase();
  const { error } = await db
    .from("competitors")
    .update({ cadence })
    .eq("id", competitorId);
  if (error) throw new Error(error.message);
}

/** Queues a scan. The scheduled job picks this up and writes the results. */
export async function queueScan(params: {
  businessId: string;
  sourceType: ScanRun["sourceType"];
  sourceId?: string | null;
  sourceName: string;
}): Promise<ScanRun> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("scan_runs")
    .insert({
      business_id: params.businessId,
      source_type: params.sourceType,
      source_id: params.sourceId ?? null,
      source_name: params.sourceName,
      status: "queued",
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not queue the scan.");

  if (params.sourceType === "supplier" && params.sourceId) {
    await db
      .from("suppliers")
      .update({ last_scan_at: new Date().toISOString() })
      .eq("id", params.sourceId);
  }
  if (params.sourceType === "competitor" && params.sourceId) {
    await db
      .from("competitors")
      .update({ last_scan_at: new Date().toISOString() })
      .eq("id", params.sourceId);
  }

  return {
    id: data.id,
    sourceType: data.source_type,
    sourceId: data.source_id,
    sourceName: data.source_name,
    status: data.status,
    changesFound: num(data.changes_found),
    error: null,
    startedAt: data.started_at,
    finishedAt: data.finished_at,
  };
}

export async function createClientRow(
  businessId: string,
  input: {
    name: string;
    email: string;
    company: string;
    industry: string;
    tier: Client["tier"];
    frequency: SendFrequency;
    messageTypes: MessageType[];
    monthlyFee: number;
  },
): Promise<Client> {
  const db = requireSupabase();
  const { data, error } = await db
    .from("clients")
    .insert({
      business_id: businessId,
      name: input.name,
      email: input.email,
      company: input.company,
      industry: input.industry,
      status: "active",
      tier: input.tier,
      frequency: input.frequency,
      message_types: input.messageTypes,
      monthly_fee: input.monthlyFee,
      last_contacted_at: new Date().toISOString(),
      next_send_at: nextSendFrom(input.frequency, input.messageTypes),
    })
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not add the customer.");

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    company: str(data.company),
    industry: str(data.industry),
    status: "active",
    tier: input.tier,
    joinedAt: data.joined_at,
    lastContacted: data.last_contacted_at,
    nextSendAt: data.next_send_at,
    frequency: input.frequency,
    messageTypes: input.messageTypes,
    openRate: 0,
    monthlyFee: input.monthlyFee,
  };
}

export async function updateClientRow(clientId: string, patch: Partial<Client>) {
  const db = requireSupabase();
  const payload: Row = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.email !== undefined) payload.email = patch.email;
  if (patch.company !== undefined) payload.company = patch.company;
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.tier !== undefined) payload.tier = patch.tier;
  if (patch.notes !== undefined) payload.notes = patch.notes;
  if (patch.frequency !== undefined) {
    payload.frequency = patch.frequency;
    payload.next_send_at = nextSendFrom(patch.frequency, patch.messageTypes ?? []);
  }
  if (patch.messageTypes !== undefined) payload.message_types = patch.messageTypes;
  if (patch.lastContacted !== undefined) payload.last_contacted_at = patch.lastContacted;
  if (patch.nextSendAt !== undefined) payload.next_send_at = patch.nextSendAt;
  if (!Object.keys(payload).length) return;

  const { error } = await db.from("clients").update(payload).eq("id", clientId);
  if (error) throw new Error(error.message);
}

export async function deleteClientRow(clientId: string) {
  const db = requireSupabase();
  const { error } = await db.from("clients").delete().eq("id", clientId);
  if (error) throw new Error(error.message);
}

export async function logSentMessages(
  businessId: string,
  messages: { clientId: string; clientName: string; subject: string; types: MessageType[] }[],
) {
  const db = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await db.from("sent_messages").insert(
    messages.map((m) => ({
      business_id: businessId,
      client_id: m.clientId,
      client_name: m.clientName,
      subject: m.subject,
      types: m.types,
      status: "delivered",
      sent_at: now,
    })),
  );
  if (error) throw new Error(error.message);
}

export async function saveMailAccountRow(businessId: string, account: MailAccount) {
  const db = requireSupabase();
  const { error } = await db.from("mail_accounts").upsert(
    {
      business_id: businessId,
      sender_name: account.senderName,
      login_email: account.loginEmail,
      reply_to: account.replyTo,
      secondary_email: account.secondaryEmail,
      signature: account.signature,
      timezone: account.timezone,
      daily_digest: account.dailyDigest,
      send_frequency: account.sendFrequency,
      message_types: account.messageTypes,
    },
    { onConflict: "business_id" },
  );
  if (error) throw new Error(error.message);
}

export async function addBuyListItem(businessId: string, recommendationId: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("buy_list_items")
    .upsert(
      { business_id: businessId, recommendation_id: recommendationId },
      { onConflict: "business_id,recommendation_id" },
    );
  if (error) throw new Error(error.message);
}

export async function removeBuyListItem(businessId: string, recommendationId: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("buy_list_items")
    .delete()
    .eq("business_id", businessId)
    .eq("recommendation_id", recommendationId);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------------------ brand logo */

/** Public URL of the uploaded logo, cache-busted so a replacement shows at once. */
export async function uploadBrandLogo(ownerUserId: string, file: File): Promise<string> {
  const db = requireSupabase();
  const extension = (file.name.split(".").pop() ?? "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") || "png";
  const path = `${ownerUserId}/logo.${extension}`;

  const { error } = await db.storage.from("brand-assets").upload(path, file, {
    upsert: true,
    contentType: file.type || "image/png",
  });
  if (error) throw new Error(error.message);

  const { data } = db.storage.from("brand-assets").getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function updateBrandLogo(ownerUserId: string, logoUrl: string) {
  const db = requireSupabase();
  const { error } = await db
    .from("businesses")
    .update({ logo_url: logoUrl })
    .eq("owner_user_id", ownerUserId);
  if (error) throw new Error(error.message);
}

/** Clears the stored logo and deletes the uploaded files behind it. */
export async function deleteBrandLogo(ownerUserId: string) {
  const db = requireSupabase();
  const { data } = await db.storage.from("brand-assets").list(ownerUserId);
  const paths = (data ?? []).map((file) => `${ownerUserId}/${file.name}`);
  if (paths.length) await db.storage.from("brand-assets").remove(paths);
  await updateBrandLogo(ownerUserId, "");
}

export async function markReviewScanComplete(businessId: string) {
  const db = requireSupabase();
  const now = new Date().toISOString();
  const { error } = await db.from("scan_runs").insert({
    business_id: businessId,
    source_type: "reviews",
    source_name: "Manual review scan",
    status: "succeeded",
    started_at: now,
    finished_at: now,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------- mapping */

function mapProfile(row: Row): BusinessProfile {
  return {
    seoScore: num(row.seo_score),
    previousSeoScore: num(row.previous_seo_score, num(row.seo_score)),
    geoScore: num(row.geo_score),
    previousGeoScore: num(row.previous_geo_score, num(row.geo_score)),
    monthlyVisits: num(row.monthly_visits),
    visitsChange: num(row.visits_change),
    conversionRate: num(row.conversion_rate),
    industryRank: num(row.industry_rank),
    industryRankPrevious: num(row.industry_rank_previous, num(row.industry_rank)),
    domainAuthority: num(row.domain_authority),
    indexedPages: num(row.indexed_pages),
    backlinks: num(row.backlinks),
    id: str(row.id),
    ownerUserId: str(row.owner_user_id),
    ownerEmail: str(row.owner_email),
    brandName: str(row.brand_name),
    logoUrl: str(row.logo_url),
    legalName: str(row.legal_name),
    industry: str(row.industry),
    niche: str(row.niche),
    primaryDomain: str(row.primary_domain),
    secondaryDomains: (row.secondary_domains ?? []) as string[],
    platformType: str(row.platform_type),
    country: str(row.country),
    currency: str(row.currency, "USD"),
    timezone: str(row.timezone),
    teamSize: str(row.team_size),
    primaryGoal: str(row.primary_goal),
    goals: (row.goals ?? []) as string[],
    adPlatforms: (row.ad_platforms ?? []) as string[],
    socialHandles: (row.social_handles ?? {}) as Record<string, string>,
    notificationEmail: str(row.notification_email),
    reportDay: str(row.report_day),
    onboardingComplete: row.onboarding_complete === true,
  };
}
