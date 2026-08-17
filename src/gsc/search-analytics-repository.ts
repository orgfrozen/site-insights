export interface SearchMetricValues {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface DailyMetric extends SearchMetricValues {
  dataDate: string;
}

export interface QueryMetric extends SearchMetricValues {
  dataDate: string;
  query: string;
}

export interface PageMetric extends SearchMetricValues {
  dataDate: string;
  page: string;
}

export interface QueryPageMetric extends SearchMetricValues {
  dataDate: string;
  query: string;
  page: string;
}

export interface CountryMetric extends SearchMetricValues {
  dataDate: string;
  country: string;
}

export interface DeviceMetric extends SearchMetricValues {
  dataDate: string;
  device: string;
}

export interface SearchAnalyticsSnapshots {
  daily: DailyMetric[];
  queries: QueryMetric[];
  pages: PageMetric[];
  queryPages: QueryPageMetric[];
  countries: CountryMetric[];
  devices: DeviceMetric[];
}

const SEARCH_TYPE = "web";
const BATCH_SIZE = 100;

export async function batchInChunks(
  db: D1Database,
  statements: D1PreparedStatement[],
  size = BATCH_SIZE,
): Promise<void> {
  if (!Number.isInteger(size) || size <= 0) throw new Error("invalid_batch_size");
  for (let offset = 0; offset < statements.length; offset += size) {
    await db.batch(statements.slice(offset, offset + size));
  }
}

function metricValues(row: SearchMetricValues): unknown[] {
  return [row.clicks, row.impressions, row.ctr, row.position];
}

export class SearchAnalyticsRepository {
  constructor(private readonly db: D1Database) {}

  async getLatestDate(projectId: string): Promise<string | null> {
    const row = await this.db.prepare(
      "SELECT MAX(data_date) AS latest_date FROM gsc_daily_metrics WHERE project_id = ? AND search_type = ?",
    ).bind(projectId, SEARCH_TYPE).first<{ latest_date: string | null }>();
    return row?.latest_date ?? null;
  }

  async upsertSnapshots(
    projectId: string,
    snapshots: SearchAnalyticsSnapshots,
    collectedAt: string,
  ): Promise<number> {
    let recordsWritten = 0;

    const write = async (statements: D1PreparedStatement[]) => {
      recordsWritten += statements.length;
      await batchInChunks(this.db, statements);
    };

    await write(snapshots.daily.map((row) => this.db.prepare(`
      INSERT INTO gsc_daily_metrics (
        project_id, data_date, search_type, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, ...metricValues(row), collectedAt)));

    await write(snapshots.queries.map((row) => this.db.prepare(`
      INSERT INTO gsc_query_metrics (
        project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type, query) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, row.query, ...metricValues(row), collectedAt)));

    await write(snapshots.pages.map((row) => this.db.prepare(`
      INSERT INTO gsc_page_metrics (
        project_id, data_date, search_type, page, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type, page) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, row.page, ...metricValues(row), collectedAt)));

    await write(snapshots.queryPages.map((row) => this.db.prepare(`
      INSERT INTO gsc_query_page_metrics (
        project_id, data_date, search_type, query, page, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type, query, page) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, row.query, row.page, ...metricValues(row), collectedAt)));

    await write(snapshots.countries.map((row) => this.db.prepare(`
      INSERT INTO gsc_country_metrics (
        project_id, data_date, search_type, country, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type, country) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, row.country, ...metricValues(row), collectedAt)));

    await write(snapshots.devices.map((row) => this.db.prepare(`
      INSERT INTO gsc_device_metrics (
        project_id, data_date, search_type, device, clicks, impressions, ctr, position, collected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, data_date, search_type, device) DO UPDATE SET
        clicks = excluded.clicks,
        impressions = excluded.impressions,
        ctr = excluded.ctr,
        position = excluded.position,
        collected_at = excluded.collected_at
    `).bind(projectId, row.dataDate, SEARCH_TYPE, row.device, ...metricValues(row), collectedAt)));

    return recordsWritten;
  }
}
