const URL_INSPECTION_ENDPOINT =
  "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

type Fetcher = typeof fetch;

export interface UrlInspectionIndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  crawledAs?: string;
  referringUrls?: string[];
  sitemap?: string[];
  [key: string]: unknown;
}

export interface UrlInspectionResult {
  inspectionResultLink?: string;
  indexStatusResult?: UrlInspectionIndexStatusResult;
  ampResult?: Record<string, unknown>;
  mobileUsabilityResult?: Record<string, unknown>;
  richResultsResult?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UrlInspectionApiResponse {
  inspectionResult?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeInspectionResult(value: unknown): UrlInspectionResult {
  if (!isRecord(value)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }

  const indexStatusResult = value.indexStatusResult;
  if (indexStatusResult !== undefined && !isRecord(indexStatusResult)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }
  const mobileUsabilityResult = value.mobileUsabilityResult;
  if (mobileUsabilityResult !== undefined && !isRecord(mobileUsabilityResult)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }
  const richResultsResult = value.richResultsResult;
  if (richResultsResult !== undefined && !isRecord(richResultsResult)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }
  const ampResult = value.ampResult;
  if (ampResult !== undefined && !isRecord(ampResult)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }

  return value as UrlInspectionResult;
}

export class GscUrlInspectionError extends Error {
  readonly code: "gsc_url_inspection_http_error" | "gsc_url_inspection_invalid_response";
  readonly status: number;

  constructor(
    code: "gsc_url_inspection_http_error" | "gsc_url_inspection_invalid_response",
    status: number,
  ) {
    super(`${code}:${status}`);
    this.name = "GscUrlInspectionError";
    this.code = code;
    this.status = status;
  }
}

export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  accessToken: string,
  fetcher: Fetcher = fetch,
): Promise<UrlInspectionResult> {
  const response = await fetcher(URL_INSPECTION_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "en-US" }),
  });

  let payload: UrlInspectionApiResponse;
  try {
    payload = (await response.json()) as UrlInspectionApiResponse;
  } catch {
    throw new GscUrlInspectionError(
      response.ok ? "gsc_url_inspection_invalid_response" : "gsc_url_inspection_http_error",
      response.ok ? 502 : response.status,
    );
  }

  if (!response.ok) {
    throw new GscUrlInspectionError("gsc_url_inspection_http_error", response.status);
  }
  if (!isRecord(payload) || !("inspectionResult" in payload)) {
    throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  }

  return normalizeInspectionResult(payload.inspectionResult);
}
