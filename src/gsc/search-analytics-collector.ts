import type { Project } from "../domain/types";
import type { SiteInsightsEnv } from "../env";
import { formatSearchConsoleDate, subtractDays } from "./dates";
import { withSearchAnalyticsStage } from "./search-analytics-stage-error";
import {
  SearchAnalyticsClient,
  type SearchAnalyticsRow,
  type SearchDimension,
} from "./search-analytics-client";
import {
  SearchAnalyticsRepository,
  type CountryMetric,
  type DailyMetric,
  type DeviceMetric,
  type PageMetric,
  type QueryMetric,
  type QueryPageMetric,
  type SearchAnalyticsSnapshots,
} from "./search-analytics-repository";

type Fetcher = typeof fetch;

export interface CollectSearchAnalyticsOptions {
  project: Project;
  accessToken: string;
  env: SiteInsightsEnv;
  fetcher?: Fetcher;
  now?: Date;
}

export interface SearchAnalyticsCollectionResult {
  latestFinalDate: string | null;
  recordsWritten: number;
}

const FINAL_DATE_LOOKBACK_DAYS = 14;

function positiveInteger(value: string, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(errorCode);
  return parsed;
}

function metric(row: SearchAnalyticsRow) {
  return {
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.ctr,
    position: row.position,
  };
}

function requireKeys(row: SearchAnalyticsRow, count: number): string[] {
  if (row.keys.length !== count || row.keys.some((key) => key === "")) {
    throw new Error("gsc_search_analytics_invalid_row");
  }
  return row.keys;
}

function normalizeDaily(rows: SearchAnalyticsRow[]): DailyMetric[] {
  return rows.map((row) => {
    const [dataDate] = requireKeys(row, 1);
    return { dataDate, ...metric(row) };
  });
}

function normalizeQueries(rows: SearchAnalyticsRow[]): QueryMetric[] {
  return rows.map((row) => {
    const [dataDate, query] = requireKeys(row, 2);
    return { dataDate, query, ...metric(row) };
  });
}

function normalizePages(rows: SearchAnalyticsRow[]): PageMetric[] {
  return rows.map((row) => {
    const [dataDate, page] = requireKeys(row, 2);
    return { dataDate, page, ...metric(row) };
  });
}

function normalizeQueryPages(rows: SearchAnalyticsRow[]): QueryPageMetric[] {
  return rows.map((row) => {
    const [dataDate, query, page] = requireKeys(row, 3);
    return { dataDate, query, page, ...metric(row) };
  });
}

function normalizeCountries(rows: SearchAnalyticsRow[]): CountryMetric[] {
  return rows.map((row) => {
    const [dataDate, country] = requireKeys(row, 2);
    return { dataDate, country, ...metric(row) };
  });
}

function normalizeDevices(rows: SearchAnalyticsRow[]): DeviceMetric[] {
  return rows.map((row) => {
    const [dataDate, device] = requireKeys(row, 2);
    return { dataDate, device, ...metric(row) };
  });
}

async function queryDataset(
  client: SearchAnalyticsClient,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: SearchDimension[],
): Promise<SearchAnalyticsRow[]> {
  return client.queryAll(siteUrl, {
    startDate,
    endDate,
    dimensions,
    type: "web",
  });
}

export async function collectSearchAnalytics(
  options: CollectSearchAnalyticsOptions,
): Promise<SearchAnalyticsCollectionResult> {
  const now = options.now ?? new Date();
  const todayPacific = formatSearchConsoleDate(now);
  const latestLookbackStart = subtractDays(todayPacific, FINAL_DATE_LOOKBACK_DAYS - 1);
  const initialBackfillDays = positiveInteger(
    options.env.GSC_INITIAL_BACKFILL_DAYS,
    "invalid_gsc_initial_backfill_days",
  );
  const refreshDays = positiveInteger(options.env.GSC_REFRESH_DAYS, "invalid_gsc_refresh_days");

  const client = new SearchAnalyticsClient(options.accessToken, options.fetcher ?? fetch);
  const repository = new SearchAnalyticsRepository(options.env.DB);
  const latestFinalDate = await withSearchAnalyticsStage("latest_final_date", () =>
    client.findLatestFinalDate(
      options.project.gscProperty,
      latestLookbackStart,
      todayPacific,
    ),
  );
  if (!latestFinalDate) return { latestFinalDate: null, recordsWritten: 0 };

  const storedLatestDate = await withSearchAnalyticsStage("stored_latest_date", () =>
    repository.getLatestDate(options.project.id),
  );
  const daysToCollect = storedLatestDate ? refreshDays : initialBackfillDays;
  const startDate = subtractDays(latestFinalDate, daysToCollect - 1);

  const [dailyRows, queryRows, pageRows, queryPageRows, countryRows, deviceRows] =
    await withSearchAnalyticsStage("fetch_datasets", () => Promise.all([
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date"]),
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date", "query"]),
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date", "page"]),
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date", "query", "page"]),
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date", "country"]),
      queryDataset(client, options.project.gscProperty, startDate, latestFinalDate, ["date", "device"]),
    ]));

  const snapshots = await withSearchAnalyticsStage("normalize", () => ({
    daily: normalizeDaily(dailyRows),
    queries: normalizeQueries(queryRows),
    pages: normalizePages(pageRows),
    queryPages: normalizeQueryPages(queryPageRows),
    countries: normalizeCountries(countryRows),
    devices: normalizeDevices(deviceRows),
  } satisfies SearchAnalyticsSnapshots));
  const recordsWritten = await withSearchAnalyticsStage("write_snapshots", () =>
    repository.upsertSnapshots(
      options.project.id,
      snapshots,
      now.toISOString(),
    ),
  );

  return { latestFinalDate, recordsWritten };
}
