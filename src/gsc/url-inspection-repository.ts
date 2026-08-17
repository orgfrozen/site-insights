import type { UrlInspectionResult } from "./url-inspection-client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export interface UrlInspectionSnapshotWriter {
  saveSnapshot(
    projectId: string,
    url: string,
    inspectedAt: string,
    result: UrlInspectionResult,
  ): Promise<void>;
}

export class UrlInspectionRepository implements UrlInspectionSnapshotWriter {
  constructor(private readonly db: D1Database) {}

  async saveSnapshot(
    projectId: string,
    url: string,
    inspectedAt: string,
    result: UrlInspectionResult,
  ): Promise<void> {
    const indexStatus = isRecord(result.indexStatusResult) ? result.indexStatusResult : {};
    const mobileUsability = isRecord(result.mobileUsabilityResult)
      ? result.mobileUsabilityResult
      : {};
    const richResults = isRecord(result.richResultsResult) ? result.richResultsResult : {};

    await this.db.prepare(`
      INSERT INTO url_inspections (
        project_id, url, inspected_at, verdict, coverage_state, indexing_state,
        robots_txt_state, page_fetch_state, google_canonical, user_canonical,
        last_crawl_time, crawled_as, referring_urls_json, sitemaps_json,
        mobile_usability_json, rich_results_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      projectId,
      url,
      inspectedAt,
      optionalString(indexStatus.verdict),
      optionalString(indexStatus.coverageState),
      optionalString(indexStatus.indexingState),
      optionalString(indexStatus.robotsTxtState),
      optionalString(indexStatus.pageFetchState),
      optionalString(indexStatus.googleCanonical),
      optionalString(indexStatus.userCanonical),
      optionalString(indexStatus.lastCrawlTime),
      optionalString(indexStatus.crawledAs),
      JSON.stringify(stringArray(indexStatus.referringUrls)),
      JSON.stringify(stringArray(indexStatus.sitemap)),
      JSON.stringify(mobileUsability),
      JSON.stringify(richResults),
      JSON.stringify(result),
    ).run();
  }
}
