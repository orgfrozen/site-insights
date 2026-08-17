export type SearchDimension = "date" | "query" | "page" | "country" | "device";

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  metadata?: { first_incomplete_date?: string };
}

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: SearchDimension[];
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
  rowLimit?: number;
  startRow?: number;
}

const SEARCH_ANALYTICS_ROW_LIMIT = 25_000;
type Fetcher = typeof fetch;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSearchAnalyticsRow(value: unknown): value is SearchAnalyticsRow {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.keys) &&
    value.keys.every((key) => typeof key === "string") &&
    typeof value.clicks === "number" &&
    typeof value.impressions === "number" &&
    typeof value.ctr === "number" &&
    typeof value.position === "number"
  );
}

function normalizeResponse(value: unknown): SearchAnalyticsResponse {
  if (!isRecord(value)) throw new Error("gsc_search_analytics_invalid_response");
  if (value.rows !== undefined && (!Array.isArray(value.rows) || !value.rows.every(isSearchAnalyticsRow))) {
    throw new Error("gsc_search_analytics_invalid_response");
  }
  if (value.responseAggregationType !== undefined && typeof value.responseAggregationType !== "string") {
    throw new Error("gsc_search_analytics_invalid_response");
  }

  let metadata: SearchAnalyticsResponse["metadata"];
  if (value.metadata !== undefined) {
    if (!isRecord(value.metadata)) throw new Error("gsc_search_analytics_invalid_response");
    const firstIncompleteDate = value.metadata.first_incomplete_date;
    if (firstIncompleteDate !== undefined && typeof firstIncompleteDate !== "string") {
      throw new Error("gsc_search_analytics_invalid_response");
    }
    metadata = firstIncompleteDate === undefined ? {} : { first_incomplete_date: firstIncompleteDate };
  }

  return {
    rows: value.rows as SearchAnalyticsRow[] | undefined,
    responseAggregationType: value.responseAggregationType as string | undefined,
    metadata,
  };
}

function safeGoogleReason(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) return null;
  const status = value.error.status;
  if (typeof status === "string" && /^[A-Z0-9_]+$/.test(status)) return status;

  const errors = value.error.errors;
  if (Array.isArray(errors) && isRecord(errors[0])) {
    const reason = errors[0].reason;
    if (typeof reason === "string" && /^[A-Za-z0-9_.-]+$/.test(reason)) return reason;
  }
  return null;
}

export class SearchAnalyticsClient {
  private readonly accessToken: string;
  private readonly fetcher: Fetcher;

  constructor(accessToken: string, fetcher: Fetcher = fetch) {
    this.accessToken = accessToken;
    this.fetcher = fetcher;
  }

  async query(siteUrl: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse> {
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: request.startDate,
        endDate: request.endDate,
        ...(request.dimensions ? { dimensions: request.dimensions } : {}),
        type: request.type ?? "web",
        dataState: "final",
        rowLimit: request.rowLimit ?? SEARCH_ANALYTICS_ROW_LIMIT,
        startRow: request.startRow ?? 0,
      }),
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(response.ok ? "gsc_search_analytics_invalid_response" : `gsc_search_analytics_http_error:${response.status}`);
    }

    if (!response.ok) {
      const reason = safeGoogleReason(payload);
      throw new Error(`gsc_search_analytics_http_error:${response.status}${reason ? `:${reason}` : ""}`);
    }

    return normalizeResponse(payload);
  }

  async queryAll(siteUrl: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsRow[]> {
    const allRows: SearchAnalyticsRow[] = [];
    let startRow = 0;

    while (true) {
      const response = await this.query(siteUrl, {
        ...request,
        rowLimit: SEARCH_ANALYTICS_ROW_LIMIT,
        startRow,
      });
      const rows = response.rows ?? [];
      allRows.push(...rows);

      if (rows.length < SEARCH_ANALYTICS_ROW_LIMIT) return allRows;
      startRow += rows.length;
    }
  }

  async findLatestFinalDate(siteUrl: string, lookbackStart: string, lookbackEnd: string): Promise<string | null> {
    const response = await this.query(siteUrl, {
      startDate: lookbackStart,
      endDate: lookbackEnd,
      dimensions: ["date"],
    });
    const rows = response.rows ?? [];
    if (rows.length === 0) return null;

    const lastDate = rows.at(-1)?.keys[0];
    return typeof lastDate === "string" ? lastDate : null;
  }
}
