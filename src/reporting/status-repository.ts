import { comparisonPeriods, type DatePeriod } from "../gsc/dates";
import { COLLECTION_SOURCES, type CollectionSource } from "../collection/run-repository";
import { ProjectRepository } from "../projects/project-repository";

export interface SearchMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
}

export interface LatestSearchMetrics extends SearchMetrics {
  date: string | null;
}

export interface MetricDelta {
  clicksPercent: number | null;
  impressionsPercent: number | null;
  ctrPointDelta: number;
  positionDelta: number | null;
}

export interface DimensionMetric extends SearchMetrics {
  [key: string]: string | number | null;
}

export interface SourceNeverCollected {
  status: "never_collected";
}

export interface SourceRunStatus {
  status: "running" | "succeeded" | "failed" | "partial";
  startedAt: string;
  completedAt: string | null;
  recordsWritten: number;
  errorCode: string | null;
}

export type SourceStatus = SourceNeverCollected | SourceRunStatus;

export type CollectionHealthStatus = "healthy" | "warning" | "critical" | "unknown";

export interface CollectionHealth {
  status: CollectionHealthStatus;
  reason: string;
  affectedSources: CollectionSource[];
  repeatedFailureSources: CollectionSource[];
}

export function deriveCollectionHealth(
  sources: Record<CollectionSource, SourceStatus>,
  repeatedFailureSources: CollectionSource[],
): CollectionHealth {
  const affectedSources = COLLECTION_SOURCES.filter((source) => sources[source].status !== "succeeded");
  const observedSources = COLLECTION_SOURCES.filter((source) => sources[source].status !== "never_collected");
  const failedSources = COLLECTION_SOURCES.filter((source) => sources[source].status === "failed");
  const latestErrorCodes = failedSources.map((source) => {
    const state = sources[source];
    return state.status === "failed" ? state.errorCode : null;
  });
  const commonErrorCode = latestErrorCodes.length === COLLECTION_SOURCES.length &&
    latestErrorCodes.every((code) => code !== null && code === latestErrorCodes[0])
    ? latestErrorCodes[0]
    : null;
  const systemicGoogleFailure = commonErrorCode !== null &&
    (commonErrorCode === "google_connection_not_configured" || commonErrorCode.startsWith("google_oauth_"));

  if (observedSources.length === 0) {
    return {
      status: "unknown",
      reason: "never_collected",
      affectedSources: [...COLLECTION_SOURCES],
      repeatedFailureSources,
    };
  }
  if (affectedSources.length === 0) {
    return {
      status: "healthy",
      reason: "all_sources_succeeded",
      affectedSources: [],
      repeatedFailureSources: [],
    };
  }
  if (systemicGoogleFailure) {
    return {
      status: "critical",
      reason: commonErrorCode,
      affectedSources,
      repeatedFailureSources,
    };
  }
  if (failedSources.length === COLLECTION_SOURCES.length) {
    return {
      status: "critical",
      reason: "all_collection_sources_failed",
      affectedSources,
      repeatedFailureSources,
    };
  }
  if (repeatedFailureSources.length > 0) {
    return {
      status: "critical",
      reason: "repeated_collection_failures",
      affectedSources,
      repeatedFailureSources,
    };
  }
  return {
    status: "warning",
    reason: "collection_degraded",
    affectedSources,
    repeatedFailureSources,
  };
}

export interface ProjectStatusReport {
  project: {
    id: string;
    name: string;
    domain: string;
    baseUrl: string;
    status: "enabled" | "disabled";
  };
  generatedAt: string;
  dataThrough: string | null;
  search: {
    latestDay: LatestSearchMetrics;
    last7: SearchMetrics;
    previous7: SearchMetrics;
    last28: SearchMetrics;
    previous28: SearchMetrics;
    deltas: {
      last7VsPrevious7: MetricDelta;
      last28VsPrevious28: MetricDelta;
    };
  };
  topQueries: Array<DimensionMetric & { query: string }>;
  topPages: Array<DimensionMetric & { page: string }>;
  topQueryPages: Array<DimensionMetric & { query: string; page: string }>;
  countries: Array<DimensionMetric & { country: string }>;
  devices: Array<DimensionMetric & { device: string }>;
  coreUrls: Array<Record<string, unknown>>;
  sitemaps: Array<Record<string, unknown>>;
  sources: Record<CollectionSource, SourceStatus>;
  collectionHealth: CollectionHealth;
}

interface DataThroughRow {
  data_through: string | null;
}

interface MetricRow {
  clicks: number | null;
  impressions: number | null;
  ctr?: number | null;
  position: number | null;
}

interface DailyRow extends MetricRow {
  data_date: string;
}

interface DimensionRow extends MetricRow {
  dimension: string;
}

interface InspectionRow {
  url: string;
  inspected_at: string;
  verdict: string | null;
  coverage_state: string | null;
  indexing_state: string | null;
  robots_txt_state: string | null;
  page_fetch_state: string | null;
  google_canonical: string | null;
  user_canonical: string | null;
  last_crawl_time: string | null;
  crawled_as: string | null;
  referring_urls_json: string;
  sitemaps_json: string;
  mobile_usability_json: string;
  rich_results_json: string;
}

interface SitemapRow {
  path: string;
  collected_at: string;
  last_submitted: string | null;
  last_downloaded: string | null;
  is_pending: number | null;
  is_sitemaps_index: number | null;
  type: string | null;
  errors: number;
  warnings: number;
  contents_json: string;
}

interface CollectionRunRow {
  source: string;
  status: "running" | "succeeded" | "failed" | "partial";
  started_at: string;
  completed_at: string | null;
  records_written: number;
  error_code: string | null;
}

const ZERO_METRICS: SearchMetrics = {
  clicks: 0,
  impressions: 0,
  ctr: 0,
  position: null,
};

function numberOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeMetrics(row: MetricRow | null): SearchMetrics {
  if (!row) return { ...ZERO_METRICS };
  const clicks = numberOrZero(row.clicks);
  const impressions = numberOrZero(row.impressions);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? numberOrNull(row.position) : null,
  };
}

function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function metricDelta(current: SearchMetrics, previous: SearchMetrics): MetricDelta {
  return {
    clicksPercent: percentageChange(current.clicks, previous.clicks),
    impressionsPercent: percentageChange(current.impressions, previous.impressions),
    ctrPointDelta: current.ctr - previous.ctr,
    positionDelta:
      current.position === null || previous.position === null
        ? null
        : current.position - previous.position,
  };
}

function parseJson(value: string, fallback: unknown): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

export class StatusRepository {
  constructor(private readonly db: D1Database) {}

  private async aggregatePeriod(projectId: string, period: DatePeriod): Promise<SearchMetrics> {
    const row = await this.db.prepare(`
      SELECT
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions,
        CASE WHEN SUM(impressions) > 0
          THEN SUM(position * impressions) / SUM(impressions)
          ELSE NULL END AS position
      FROM gsc_daily_metrics
      WHERE project_id = ?
        AND search_type = 'web'
        AND data_date BETWEEN ? AND ?
    `).bind(projectId, period.startDate, period.endDate).first<MetricRow>();
    return normalizeMetrics(row);
  }

  private async aggregateDimension(
    projectId: string,
    period: DatePeriod,
    dimension: "query" | "page" | "country" | "device",
  ): Promise<Array<DimensionMetric & Record<typeof dimension, string>>> {
    const config = {
      query: { table: "gsc_query_metrics", column: "query" },
      page: { table: "gsc_page_metrics", column: "page" },
      country: { table: "gsc_country_metrics", column: "country" },
      device: { table: "gsc_device_metrics", column: "device" },
    }[dimension];

    const rows = await this.db.prepare(`
      SELECT
        ${config.column} AS dimension,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions,
        CASE WHEN SUM(impressions) > 0
          THEN SUM(position * impressions) / SUM(impressions)
          ELSE NULL END AS position
      FROM ${config.table}
      WHERE project_id = ?
        AND search_type = 'web'
        AND data_date BETWEEN ? AND ?
      GROUP BY ${config.column}
      ORDER BY impressions DESC, clicks DESC, ${config.column} ASC
      LIMIT 25
    `).bind(projectId, period.startDate, period.endDate).all<DimensionRow>();

    return rows.results.map((row) => ({
      [dimension]: row.dimension,
      ...normalizeMetrics(row),
    })) as Array<DimensionMetric & Record<typeof dimension, string>>;
  }


  private async aggregateQueryPages(
    projectId: string,
    period: DatePeriod,
  ): Promise<Array<DimensionMetric & { query: string; page: string }>> {
    const rows = await this.db.prepare(`
      SELECT
        query,
        page,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions,
        CASE WHEN SUM(impressions) > 0
          THEN SUM(position * impressions) / SUM(impressions)
          ELSE NULL END AS position
      FROM gsc_query_page_metrics
      WHERE project_id = ?
        AND search_type = 'web'
        AND data_date BETWEEN ? AND ?
      GROUP BY query, page
      ORDER BY impressions DESC, clicks DESC, query ASC, page ASC
      LIMIT 25
    `).bind(projectId, period.startDate, period.endDate).all<MetricRow & { query: string; page: string }>();

    return rows.results.map((row) => ({
      query: row.query,
      page: row.page,
      ...normalizeMetrics(row),
    }));
  }

  private async latestInspections(projectId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db.prepare(`
      SELECT i.*
      FROM url_inspections i
      JOIN (
        SELECT url, MAX(inspected_at) AS max_time
        FROM url_inspections
        WHERE project_id = ?
        GROUP BY url
      ) latest ON latest.url = i.url AND latest.max_time = i.inspected_at
      WHERE i.project_id = ?
      ORDER BY i.url ASC
    `).bind(projectId, projectId).all<InspectionRow>();

    return rows.results.map((row) => ({
      url: row.url,
      inspectedAt: row.inspected_at,
      verdict: row.verdict,
      coverageState: row.coverage_state,
      indexingState: row.indexing_state,
      robotsTxtState: row.robots_txt_state,
      pageFetchState: row.page_fetch_state,
      googleCanonical: row.google_canonical,
      userCanonical: row.user_canonical,
      lastCrawlTime: row.last_crawl_time,
      crawledAs: row.crawled_as,
      referringUrls: parseStringArray(row.referring_urls_json),
      sitemaps: parseStringArray(row.sitemaps_json),
      mobileUsability: parseJson(row.mobile_usability_json, {}),
      richResults: parseJson(row.rich_results_json, {}),
    }));
  }

  private async latestSitemaps(projectId: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.db.prepare(`
      SELECT s.*
      FROM sitemap_snapshots s
      JOIN (
        SELECT path, MAX(collected_at) AS max_time
        FROM sitemap_snapshots
        WHERE project_id = ?
        GROUP BY path
      ) latest ON latest.path = s.path AND latest.max_time = s.collected_at
      WHERE s.project_id = ?
      ORDER BY s.path ASC
    `).bind(projectId, projectId).all<SitemapRow>();

    return rows.results.map((row) => ({
      path: row.path,
      collectedAt: row.collected_at,
      lastSubmitted: row.last_submitted,
      lastDownloaded: row.last_downloaded,
      isPending: row.is_pending === null ? null : row.is_pending === 1,
      isSitemapsIndex: row.is_sitemaps_index === null ? null : row.is_sitemaps_index === 1,
      type: row.type,
      errors: numberOrZero(row.errors),
      warnings: numberOrZero(row.warnings),
      contents: parseJson(row.contents_json, []),
    }));
  }

  private async sourceState(projectId: string): Promise<{
    sources: Record<CollectionSource, SourceStatus>;
    collectionHealth: CollectionHealth;
  }> {
    const rows = await this.db.prepare(`
      SELECT source, status, started_at, completed_at, records_written, error_code
      FROM collection_runs
      WHERE project_id = ?
      ORDER BY started_at DESC, id DESC
      LIMIT 30
    `).bind(projectId).all<CollectionRunRow>();

    const sources = {} as Record<CollectionSource, SourceStatus>;
    const repeatedFailureSources: CollectionSource[] = [];
    for (const source of COLLECTION_SOURCES) {
      const sourceRows = rows.results.filter((candidate) => candidate.source === source);
      const row = sourceRows[0];
      sources[source] = row
        ? {
            status: row.status,
            startedAt: row.started_at,
            completedAt: row.completed_at,
            recordsWritten: numberOrZero(row.records_written),
            errorCode: row.error_code,
          }
        : { status: "never_collected" };
      if (sourceRows.length >= 2 && sourceRows[0].status === "failed" && sourceRows[1].status === "failed") {
        repeatedFailureSources.push(source);
      }
    }

    return {
      sources,
      collectionHealth: deriveCollectionHealth(sources, repeatedFailureSources),
    };
  }

  async getCollectionHealth(projectId: string): Promise<CollectionHealth> {
    return (await this.sourceState(projectId)).collectionHealth;
  }

  async getProjectStatus(projectId: string, now = new Date()): Promise<ProjectStatusReport | null> {
    const project = await new ProjectRepository(this.db).getProject(projectId);
    if (!project) return null;

    const dataRow = await this.db.prepare(`
      SELECT MAX(data_date) AS data_through
      FROM gsc_daily_metrics
      WHERE project_id = ? AND search_type = 'web'
    `).bind(projectId).first<DataThroughRow>();
    const dataThrough = dataRow?.data_through ?? null;

    let latestDay: LatestSearchMetrics = { date: null, ...ZERO_METRICS };
    let last7 = { ...ZERO_METRICS };
    let previous7 = { ...ZERO_METRICS };
    let last28 = { ...ZERO_METRICS };
    let previous28 = { ...ZERO_METRICS };
    let topQueries: Array<DimensionMetric & { query: string }> = [];
    let topPages: Array<DimensionMetric & { page: string }> = [];
    let topQueryPages: Array<DimensionMetric & { query: string; page: string }> = [];
    let countries: Array<DimensionMetric & { country: string }> = [];
    let devices: Array<DimensionMetric & { device: string }> = [];

    if (dataThrough) {
      const periods = comparisonPeriods(dataThrough);
      const dailyRow = await this.db.prepare(`
        SELECT data_date, clicks, impressions, ctr, position
        FROM gsc_daily_metrics
        WHERE project_id = ? AND search_type = 'web' AND data_date = ?
      `).bind(projectId, dataThrough).first<DailyRow>();
      latestDay = {
        date: dataThrough,
        ...normalizeMetrics(dailyRow),
      };

      [
        last7,
        previous7,
        last28,
        previous28,
        topQueries,
        topPages,
        topQueryPages,
        countries,
        devices,
      ] = await Promise.all([
        this.aggregatePeriod(projectId, periods.last7),
        this.aggregatePeriod(projectId, periods.previous7),
        this.aggregatePeriod(projectId, periods.last28),
        this.aggregatePeriod(projectId, periods.previous28),
        this.aggregateDimension(projectId, periods.last28, "query"),
        this.aggregateDimension(projectId, periods.last28, "page"),
        this.aggregateQueryPages(projectId, periods.last28),
        this.aggregateDimension(projectId, periods.last28, "country"),
        this.aggregateDimension(projectId, periods.last28, "device"),
      ]);
    }

    const [coreUrls, sitemaps, sourceState] = await Promise.all([
      this.latestInspections(projectId),
      this.latestSitemaps(projectId),
      this.sourceState(projectId),
    ]);

    return {
      project: {
        id: project.id,
        name: project.name,
        domain: project.domain,
        baseUrl: project.baseUrl,
        status: project.status,
      },
      generatedAt: now.toISOString(),
      dataThrough,
      search: {
        latestDay,
        last7,
        previous7,
        last28,
        previous28,
        deltas: {
          last7VsPrevious7: metricDelta(last7, previous7),
          last28VsPrevious28: metricDelta(last28, previous28),
        },
      },
      topQueries,
      topPages,
      topQueryPages,
      countries,
      devices,
      coreUrls,
      sitemaps,
      sources: sourceState.sources,
      collectionHealth: sourceState.collectionHealth,
    };
  }
}
