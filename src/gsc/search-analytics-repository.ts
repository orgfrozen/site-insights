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
const MAX_JSON_PAYLOAD_BYTES = 512 * 1024;
const textEncoder = new TextEncoder();

type SearchAnalyticsWriteStage = "daily" | "query" | "page" | "query_page" | "country" | "device";
type JsonRow = Array<string | number>;

class SearchAnalyticsWriteError extends Error {
  readonly code: string;

  constructor(stage: SearchAnalyticsWriteStage) {
    const code = `gsc_search_analytics_${stage}_write_failed`;
    super(code);
    this.name = "SearchAnalyticsWriteError";
    this.code = code;
  }
}

function jsonPayloadChunks(rows: JsonRow[], maxBytes = MAX_JSON_PAYLOAD_BYTES): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes <= 2) {
    throw new Error("gsc_search_analytics_invalid_payload_limit");
  }
  if (rows.length === 0) return [];

  const chunks: string[] = [];
  let serializedRows: string[] = [];
  let payloadBytes = 2; // []

  const flush = () => {
    if (serializedRows.length === 0) return;
    chunks.push(`[${serializedRows.join(",")}]`);
    serializedRows = [];
    payloadBytes = 2;
  };

  for (const row of rows) {
    const serialized = JSON.stringify(row);
    const rowBytes = textEncoder.encode(serialized).byteLength;
    if (rowBytes + 2 > maxBytes) {
      throw new Error("gsc_search_analytics_row_too_large");
    }

    const separatorBytes = serializedRows.length === 0 ? 0 : 1;
    if (payloadBytes + separatorBytes + rowBytes > maxBytes) {
      flush();
    }

    serializedRows.push(serialized);
    payloadBytes += (serializedRows.length === 1 ? 0 : 1) + rowBytes;
  }

  flush();
  return chunks;
}

function metricValues(row: SearchMetricValues): number[] {
  return [row.clicks, row.impressions, row.ctr, row.position];
}

const DAILY_UPSERT_SQL = `
  INSERT INTO gsc_daily_metrics (
    project_id, data_date, search_type, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

const QUERY_UPSERT_SQL = `
  INSERT INTO gsc_query_metrics (
    project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    json_extract(value, '$[5]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type, query) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

const PAGE_UPSERT_SQL = `
  INSERT INTO gsc_page_metrics (
    project_id, data_date, search_type, page, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    json_extract(value, '$[5]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type, page) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

const QUERY_PAGE_UPSERT_SQL = `
  INSERT INTO gsc_query_page_metrics (
    project_id, data_date, search_type, query, page, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    json_extract(value, '$[5]'),
    json_extract(value, '$[6]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type, query, page) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

const COUNTRY_UPSERT_SQL = `
  INSERT INTO gsc_country_metrics (
    project_id, data_date, search_type, country, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    json_extract(value, '$[5]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type, country) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

const DEVICE_UPSERT_SQL = `
  INSERT INTO gsc_device_metrics (
    project_id, data_date, search_type, device, clicks, impressions, ctr, position, collected_at
  )
  SELECT
    ?,
    json_extract(value, '$[0]'),
    ?,
    json_extract(value, '$[1]'),
    json_extract(value, '$[2]'),
    json_extract(value, '$[3]'),
    json_extract(value, '$[4]'),
    json_extract(value, '$[5]'),
    ?
  FROM json_each(?)
  WHERE 1
  ON CONFLICT(project_id, data_date, search_type, device) DO UPDATE SET
    clicks = excluded.clicks,
    impressions = excluded.impressions,
    ctr = excluded.ctr,
    position = excluded.position,
    collected_at = excluded.collected_at
`;

export class SearchAnalyticsRepository {
  constructor(private readonly db: D1Database) {}

  async getLatestDate(projectId: string): Promise<string | null> {
    const row = await this.db.prepare(
      "SELECT MAX(data_date) AS latest_date FROM gsc_daily_metrics WHERE project_id = ? AND search_type = ?",
    ).bind(projectId, SEARCH_TYPE).first<{ latest_date: string | null }>();
    return row?.latest_date ?? null;
  }

  private async writeRows(
    projectId: string,
    stage: SearchAnalyticsWriteStage,
    sql: string,
    rows: JsonRow[],
    collectedAt: string,
  ): Promise<number> {
    try {
      for (const payload of jsonPayloadChunks(rows)) {
        await this.db.prepare(sql).bind(projectId, SEARCH_TYPE, collectedAt, payload).run();
      }
      return rows.length;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("gsc_search_analytics_")) {
        throw error;
      }
      throw new SearchAnalyticsWriteError(stage);
    }
  }

  async upsertSnapshots(
    projectId: string,
    snapshots: SearchAnalyticsSnapshots,
    collectedAt: string,
  ): Promise<number> {
    let recordsWritten = 0;

    recordsWritten += await this.writeRows(
      projectId,
      "daily",
      DAILY_UPSERT_SQL,
      snapshots.daily.map((row) => [row.dataDate, ...metricValues(row)]),
      collectedAt,
    );
    recordsWritten += await this.writeRows(
      projectId,
      "query",
      QUERY_UPSERT_SQL,
      snapshots.queries.map((row) => [row.dataDate, row.query, ...metricValues(row)]),
      collectedAt,
    );
    recordsWritten += await this.writeRows(
      projectId,
      "page",
      PAGE_UPSERT_SQL,
      snapshots.pages.map((row) => [row.dataDate, row.page, ...metricValues(row)]),
      collectedAt,
    );
    recordsWritten += await this.writeRows(
      projectId,
      "query_page",
      QUERY_PAGE_UPSERT_SQL,
      snapshots.queryPages.map((row) => [row.dataDate, row.query, row.page, ...metricValues(row)]),
      collectedAt,
    );
    recordsWritten += await this.writeRows(
      projectId,
      "country",
      COUNTRY_UPSERT_SQL,
      snapshots.countries.map((row) => [row.dataDate, row.country, ...metricValues(row)]),
      collectedAt,
    );
    recordsWritten += await this.writeRows(
      projectId,
      "device",
      DEVICE_UPSERT_SQL,
      snapshots.devices.map((row) => [row.dataDate, row.device, ...metricValues(row)]),
      collectedAt,
    );

    return recordsWritten;
  }
}
