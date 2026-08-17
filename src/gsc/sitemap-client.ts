type Fetcher = typeof fetch;

export interface GscSitemapContent {
  type?: string;
  submitted?: string | number;
  indexed?: string | number;
  [key: string]: unknown;
}

export interface GscSitemap {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean | null;
  isSitemapsIndex: boolean | null;
  type: string | null;
  errors: number;
  warnings: number;
  contents: GscSitemapContent[];
  raw: Record<string, unknown>;
}

interface SitemapListResponse {
  sitemap?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizedCount(value: unknown): number {
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new GscSitemapError("gsc_sitemaps_invalid_response", 502);
  }
  return number;
}

function normalizeContents(value: unknown): GscSitemapContent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => !isRecord(entry))) {
    throw new GscSitemapError("gsc_sitemaps_invalid_response", 502);
  }
  return value as GscSitemapContent[];
}

function normalizeSitemap(value: unknown): GscSitemap {
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) {
    throw new GscSitemapError("gsc_sitemaps_invalid_response", 502);
  }

  return {
    path: value.path,
    lastSubmitted: optionalString(value.lastSubmitted),
    lastDownloaded: optionalString(value.lastDownloaded),
    isPending: optionalBoolean(value.isPending),
    isSitemapsIndex: optionalBoolean(value.isSitemapsIndex),
    type: optionalString(value.type),
    errors: normalizedCount(value.errors),
    warnings: normalizedCount(value.warnings),
    contents: normalizeContents(value.contents),
    raw: value,
  };
}

export class GscSitemapError extends Error {
  readonly code: "gsc_sitemaps_http_error" | "gsc_sitemaps_invalid_response";
  readonly status: number;

  constructor(
    code: "gsc_sitemaps_http_error" | "gsc_sitemaps_invalid_response",
    status: number,
  ) {
    super(`${code}:${status}`);
    this.name = "GscSitemapError";
    this.code = code;
    this.status = status;
  }
}

export async function listSitemaps(
  siteUrl: string,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<GscSitemap[]> {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
  const response = await fetcher(url, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });

  let payload: SitemapListResponse;
  try {
    payload = (await response.json()) as SitemapListResponse;
  } catch {
    throw new GscSitemapError(
      response.ok ? "gsc_sitemaps_invalid_response" : "gsc_sitemaps_http_error",
      response.ok ? 502 : response.status,
    );
  }

  if (!response.ok) {
    throw new GscSitemapError("gsc_sitemaps_http_error", response.status);
  }
  if (!isRecord(payload)) {
    throw new GscSitemapError("gsc_sitemaps_invalid_response", 502);
  }
  if (payload.sitemap === undefined) return [];
  if (!Array.isArray(payload.sitemap)) {
    throw new GscSitemapError("gsc_sitemaps_invalid_response", 502);
  }

  return payload.sitemap.map(normalizeSitemap);
}
