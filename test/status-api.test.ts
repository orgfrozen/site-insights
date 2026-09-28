import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CreateProjectInput } from "../src/domain/types";
import { ProjectRepository } from "../src/projects/project-repository";
import {
  COLLECTION_STALE_AFTER_MS,
  deriveCollectionHealth,
  type SourceStatus,
} from "../src/reporting/status-repository";

function projectInput(id: string): CreateProjectInput {
  const domain = `${id}.com`;
  return {
    id,
    name: id === "zeroparse" ? "ZeroParse" : id,
    domain,
    baseUrl: `https://${domain}`,
    timezone: "Asia/Shanghai",
    gscProperty: `sc-domain:${domain}`,
    gaProperty: null,
    cloudflareZoneId: null,
    robotsUrl: `https://${domain}/robots.txt`,
    sitemapUrls: [`https://${domain}/sitemap.xml`],
    primaryLanguage: "en",
    languages: ["en"],
    canonicalHost: domain,
    includeWww: false,
  };
}

function dateFromOffset(endDate: string, offset: number): string {
  const date = new Date(`${endDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

async function seedDailyHistory(projectId: string): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (let offset = 55; offset >= 0; offset -= 1) {
    const date = dateFromOffset("2026-08-15", offset);
    const isLatest = offset === 0;
    statements.push(
      env.DB.prepare(`
        INSERT INTO gsc_daily_metrics (
          project_id, data_date, search_type, clicks, impressions, ctr, position, collected_at
        ) VALUES (?, ?, 'web', ?, ?, ?, ?, ?)
      `).bind(
        projectId,
        date,
        isLatest ? 2 : 1,
        isLatest ? 20 : 10,
        0.1,
        isLatest ? 8 : 10,
        "2026-08-16T00:00:00.000Z",
      ),
    );
  }
  await env.DB.batch(statements);
}

async function seedDimensionRows(projectId: string): Promise<void> {
  const collectedAt = "2026-08-16T00:00:00.000Z";
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO gsc_query_metrics
        (project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'large json viewer', 5, 100, 0.05, 8, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_query_metrics
        (project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-14', 'web', 'large json viewer', 2, 50, 0.04, 12, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_query_metrics
        (project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'json viewer', 3, 80, 0.0375, 15, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_page_metrics
        (project_id, data_date, search_type, page, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'https://zeroparse.com/big-json-viewer', 6, 120, 0.05, 9, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_query_page_metrics
        (project_id, data_date, search_type, query, page, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'large json viewer', 'https://zeroparse.com/big-json-viewer', 5, 100, 0.05, 8, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_country_metrics
        (project_id, data_date, search_type, country, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'usa', 4, 90, 0.0444444444, 11, ?)
    `).bind(projectId, collectedAt),
    env.DB.prepare(`
      INSERT INTO gsc_device_metrics
        (project_id, data_date, search_type, device, clicks, impressions, ctr, position, collected_at)
      VALUES (?, '2026-08-15', 'web', 'DESKTOP', 5, 110, 0.0454545455, 10, ?)
    `).bind(projectId, collectedAt),
  ]);
}

async function seedIndexingAndRuns(projectId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO url_inspections (
        project_id, url, inspected_at, verdict, coverage_state, indexing_state,
        robots_txt_state, page_fetch_state, google_canonical, user_canonical,
        last_crawl_time, crawled_as, referring_urls_json, sitemaps_json,
        mobile_usability_json, rich_results_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      projectId,
      "https://zeroparse.com/big-json-viewer",
      "2026-08-15T01:00:00.000Z",
      "NEUTRAL",
      "Discovered - currently not indexed",
      "INDEXING_ALLOWED",
      "ALLOWED",
      "SUCCESSFUL",
      null,
      "https://zeroparse.com/big-json-viewer",
      "2026-08-13T00:00:00.000Z",
      "DESKTOP",
      "[]",
      "[]",
      "{}",
      "{}",
      "{}",
    ),
    env.DB.prepare(`
      INSERT INTO url_inspections (
        project_id, url, inspected_at, verdict, coverage_state, indexing_state,
        robots_txt_state, page_fetch_state, google_canonical, user_canonical,
        last_crawl_time, crawled_as, referring_urls_json, sitemaps_json,
        mobile_usability_json, rich_results_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      projectId,
      "https://zeroparse.com/big-json-viewer",
      "2026-08-16T01:00:00.000Z",
      "PASS",
      "Submitted and indexed",
      "INDEXING_ALLOWED",
      "ALLOWED",
      "SUCCESSFUL",
      "https://zeroparse.com/big-json-viewer",
      "https://zeroparse.com/big-json-viewer",
      "2026-08-15T03:00:00.000Z",
      "MOBILE",
      JSON.stringify(["https://zeroparse.com/catalog"]),
      JSON.stringify(["https://zeroparse.com/sitemap.xml"]),
      "{}",
      JSON.stringify({ verdict: "PASS" }),
      "{}",
    ),
    env.DB.prepare(`
      INSERT INTO url_inspections (
        project_id, url, inspected_at, verdict, coverage_state, indexing_state,
        robots_txt_state, page_fetch_state, google_canonical, user_canonical,
        last_crawl_time, crawled_as, referring_urls_json, sitemaps_json,
        mobile_usability_json, rich_results_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      projectId,
      "https://zeroparse.com/jsonl-viewer",
      "2026-08-16T01:05:00.000Z",
      "NEUTRAL",
      "Crawled - currently not indexed",
      "INDEXING_ALLOWED",
      "ALLOWED",
      "SUCCESSFUL",
      null,
      "https://zeroparse.com/jsonl-viewer",
      "2026-08-10T03:00:00.000Z",
      "MOBILE",
      "[]",
      JSON.stringify(["https://zeroparse.com/sitemap.xml"]),
      "{}",
      "{}",
      "{}",
    ),
    env.DB.prepare(`
      INSERT INTO sitemap_snapshots (
        project_id, path, collected_at, last_submitted, last_downloaded,
        is_pending, is_sitemaps_index, type, errors, warnings, contents_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'sitemap', 1, 2, ?, ?)
    `).bind(
      projectId,
      "https://zeroparse.com/sitemap.xml",
      "2026-08-15T02:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "2026-08-15T01:30:00.000Z",
      "[]",
      "{}",
    ),
    env.DB.prepare(`
      INSERT INTO sitemap_snapshots (
        project_id, path, collected_at, last_submitted, last_downloaded,
        is_pending, is_sitemaps_index, type, errors, warnings, contents_json, raw_json
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'sitemap', 0, 0, ?, ?)
    `).bind(
      projectId,
      "https://zeroparse.com/sitemap.xml",
      "2026-08-16T02:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
      "2026-08-16T01:30:00.000Z",
      JSON.stringify([{ type: "web", submitted: 12 }]),
      "{}",
    ),
    env.DB.prepare(`
      INSERT INTO collection_runs
        (id, project_id, source, trigger_type, status, started_at, completed_at, records_written)
      VALUES ('search-old', ?, 'gsc_search_analytics', 'cron', 'failed', '2026-08-15T00:00:00.000Z', '2026-08-15T00:01:00.000Z', 0)
    `).bind(projectId),
    env.DB.prepare(`
      INSERT INTO collection_runs
        (id, project_id, source, trigger_type, status, started_at, completed_at, records_written)
      VALUES ('search-new', ?, 'gsc_search_analytics', 'cron', 'succeeded', '2026-08-16T00:00:00.000Z', '2026-08-16T00:01:00.000Z', 120)
    `).bind(projectId),
    env.DB.prepare(`
      INSERT INTO collection_runs
        (id, project_id, source, trigger_type, status, started_at, completed_at, records_written, error_code)
      VALUES ('sitemap-new', ?, 'gsc_sitemaps', 'cron', 'partial', '2026-08-16T00:02:00.000Z', '2026-08-16T00:03:00.000Z', 1, 'gsc_sitemap_partial')
    `).bind(projectId),
  ]);
}

function succeededSource(completedAt: string): SourceStatus {
  return {
    status: "succeeded",
    startedAt: completedAt,
    completedAt,
    recordsWritten: 1,
    errorCode: null,
  };
}

describe("collection health freshness", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  const freshAt = new Date(now.getTime() - COLLECTION_STALE_AFTER_MS + 60_000).toISOString();
  const staleAt = new Date(now.getTime() - COLLECTION_STALE_AFTER_MS - 60_000).toISOString();

  it("marks one stale successful source warning while keeping fresh sources healthy", () => {
    const health = deriveCollectionHealth({
      gsc_search_analytics: succeededSource(staleAt),
      gsc_sitemaps: succeededSource(freshAt),
      gsc_url_inspection: succeededSource(freshAt),
    }, [], now);

    expect(health).toEqual({
      status: "warning",
      reason: "collection_stale",
      affectedSources: ["gsc_search_analytics"],
      repeatedFailureSources: [],
      staleSources: ["gsc_search_analytics"],
    });
  });

  it("marks the project critical when every successful source is stale", () => {
    const health = deriveCollectionHealth({
      gsc_search_analytics: succeededSource(staleAt),
      gsc_sitemaps: succeededSource(staleAt),
      gsc_url_inspection: succeededSource(staleAt),
    }, [], now);

    expect(health).toEqual({
      status: "critical",
      reason: "collection_stale",
      affectedSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
      repeatedFailureSources: [],
      staleSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
    });
  });
});

describe("read-only project status API", () => {
  it("aggregates stored finalized GSC data without calling Google", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("zeroparse"));
    await seedDailyHistory("zeroparse");
    await seedDimensionRows("zeroparse");
    await seedIndexingAndRuns("zeroparse");

    const response = await exports.default.fetch(
      "https://site-insights.test/v1/projects/zeroparse/status",
      { headers: { authorization: "Bearer test-read-token" } },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    expect(body.project).toEqual({
      id: "zeroparse",
      name: "ZeroParse",
      domain: "zeroparse.com",
      baseUrl: "https://zeroparse.com",
      status: "enabled",
    });
    expect(body.dataThrough).toBe("2026-08-15");
    expect(body.search.latestDay).toEqual({
      date: "2026-08-15",
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 8,
    });
    expect(body.search.last7).toEqual({ clicks: 8, impressions: 80, ctr: 0.1, position: 9.5 });
    expect(body.search.previous7).toEqual({ clicks: 7, impressions: 70, ctr: 0.1, position: 10 });
    expect(body.search.last28.clicks).toBe(29);
    expect(body.search.previous28.clicks).toBe(28);
    expect(body.search.deltas.last7VsPrevious7).toMatchObject({
      ctrPointDelta: 0,
      positionDelta: -0.5,
    });
    expect(body.search.deltas.last7VsPrevious7.clicksPercent).toBeCloseTo(14.2857142857, 8);
    expect(body.search.deltas.last7VsPrevious7.impressionsPercent).toBeCloseTo(14.2857142857, 8);
    expect(body.search.deltas.last28VsPrevious28.clicksPercent).toBeCloseTo(3.5714285714, 8);

    expect(body.topQueries[0]).toMatchObject({
      query: "large json viewer",
      clicks: 7,
      impressions: 150,
    });
    expect(body.topQueries[0].ctr).toBeCloseTo(7 / 150, 10);
    expect(body.topQueries[0].position).toBeCloseTo(1400 / 150, 10);
    expect(body.topPages[0]).toMatchObject({
      page: "https://zeroparse.com/big-json-viewer",
      clicks: 6,
      impressions: 120,
    });
    expect(body.topQueryPages[0]).toMatchObject({
      query: "large json viewer",
      page: "https://zeroparse.com/big-json-viewer",
      clicks: 5,
      impressions: 100,
    });
    expect(body.countries[0]).toMatchObject({ country: "usa", impressions: 90 });
    expect(body.devices[0]).toMatchObject({ device: "DESKTOP", impressions: 110 });

    expect(body.coreUrls).toHaveLength(2);
    expect(body.coreUrls[0]).toMatchObject({
      url: "https://zeroparse.com/big-json-viewer",
      inspectedAt: "2026-08-16T01:00:00.000Z",
      verdict: "PASS",
      coverageState: "Submitted and indexed",
      referringUrls: ["https://zeroparse.com/catalog"],
    });
    expect(body.sitemaps).toEqual([
      expect.objectContaining({
        path: "https://zeroparse.com/sitemap.xml",
        collectedAt: "2026-08-16T02:00:00.000Z",
        errors: 0,
        warnings: 0,
      }),
    ]);
    expect(body.collectionHealth).toEqual({
      status: "warning",
      reason: "collection_degraded",
      affectedSources: ["gsc_sitemaps", "gsc_url_inspection"],
      repeatedFailureSources: [],
      staleSources: ["gsc_search_analytics"],
    });
    expect(body.sources).toEqual({
      gsc_search_analytics: {
        status: "succeeded",
        startedAt: "2026-08-16T00:00:00.000Z",
        completedAt: "2026-08-16T00:01:00.000Z",
        recordsWritten: 120,
        errorCode: null,
      },
      gsc_sitemaps: {
        status: "partial",
        startedAt: "2026-08-16T00:02:00.000Z",
        completedAt: "2026-08-16T00:03:00.000Z",
        recordsWritten: 1,
        errorCode: "gsc_sitemap_partial",
      },
      gsc_url_inspection: { status: "never_collected" },
    });
  });

  it("returns zero-safe search metrics when the project has no GSC history", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("empty-site"));

    const response = await exports.default.fetch(
      "https://site-insights.test/v1/projects/empty-site/status",
      { headers: { authorization: "Bearer test-read-token" } },
    );
    const body = await response.json() as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.dataThrough).toBeNull();
    expect(body.search.latestDay).toEqual({
      date: null,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: null,
    });
    expect(body.topQueries).toEqual([]);
    expect(body.collectionHealth).toEqual({
      status: "unknown",
      reason: "never_collected",
      affectedSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
      repeatedFailureSources: [],
      staleSources: [],
    });
    expect(body.sources.gsc_search_analytics).toEqual({ status: "never_collected" });
  });

  it("marks shared OAuth failures critical and identifies repeated failed sources", async () => {
    const projectId = "oauth-health";
    await new ProjectRepository(env.DB).createProject(projectInput(projectId));
    const statements: D1PreparedStatement[] = [];
    for (const [attempt, startedAt] of [["old", "2026-09-26T00:00:00.000Z"], ["new", "2026-09-27T00:00:00.000Z"]] as const) {
      for (const source of ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"] as const) {
        statements.push(env.DB.prepare(`
          INSERT INTO collection_runs
            (id, project_id, source, trigger_type, status, started_at, completed_at, records_written, error_code)
          VALUES (?, ?, ?, 'cron', 'failed', ?, ?, 0, 'google_oauth_invalid_grant')
        `).bind(
          `${source}-${attempt}`,
          projectId,
          source,
          startedAt,
          startedAt,
        ));
      }
    }
    await env.DB.batch(statements);

    const response = await exports.default.fetch(
      `https://site-insights.test/v1/projects/${projectId}/status`,
      { headers: { authorization: "Bearer test-read-token" } },
    );
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body.collectionHealth).toEqual({
      status: "critical",
      reason: "google_oauth_invalid_grant",
      affectedSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
      repeatedFailureSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
      staleSources: [],
    });
  });

  it("marks a source critical after two consecutive failed runs", async () => {
    const projectId = "repeated-health";
    await new ProjectRepository(env.DB).createProject(projectInput(projectId));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO collection_runs
          (id, project_id, source, trigger_type, status, started_at, completed_at, records_written)
        VALUES ('search-ok', ?, 'gsc_search_analytics', 'cron', 'succeeded', '2026-09-27T00:00:00.000Z', '2026-09-27T00:01:00.000Z', 10)
      `).bind(projectId),
      env.DB.prepare(`
        INSERT INTO collection_runs
          (id, project_id, source, trigger_type, status, started_at, completed_at, records_written)
        VALUES ('inspection-ok', ?, 'gsc_url_inspection', 'cron', 'succeeded', '2026-09-27T00:00:00.000Z', '2026-09-27T00:01:00.000Z', 1)
      `).bind(projectId),
      env.DB.prepare(`
        INSERT INTO collection_runs
          (id, project_id, source, trigger_type, status, started_at, completed_at, records_written, error_code)
        VALUES ('sitemap-failed-old', ?, 'gsc_sitemaps', 'cron', 'failed', '2026-09-26T00:00:00.000Z', '2026-09-26T00:01:00.000Z', 0, 'gsc_sitemaps_http_error')
      `).bind(projectId),
      env.DB.prepare(`
        INSERT INTO collection_runs
          (id, project_id, source, trigger_type, status, started_at, completed_at, records_written, error_code)
        VALUES ('sitemap-failed-new', ?, 'gsc_sitemaps', 'cron', 'failed', '2026-09-27T00:00:00.000Z', '2026-09-27T00:01:00.000Z', 0, 'gsc_sitemaps_http_error')
      `).bind(projectId),
    ]);

    const response = await exports.default.fetch(
      `https://site-insights.test/v1/projects/${projectId}/status`,
      { headers: { authorization: "Bearer test-read-token" } },
    );
    const body = await response.json() as Record<string, any>;
    expect(body.collectionHealth).toEqual({
      status: "critical",
      reason: "repeated_collection_failures",
      affectedSources: ["gsc_sitemaps"],
      repeatedFailureSources: ["gsc_sitemaps"],
      staleSources: [],
    });
  });

  it("returns healthy after each source recovers from an older failure", async () => {
    const projectId = "recovered-health";
    await new ProjectRepository(env.DB).createProject(projectInput(projectId));
    const statements: D1PreparedStatement[] = [];
    for (const source of ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"] as const) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO collection_runs
            (id, project_id, source, trigger_type, status, started_at, completed_at, records_written, error_code)
          VALUES (?, ?, ?, 'cron', 'failed', '2026-09-26T00:00:00.000Z', '2026-09-26T00:01:00.000Z', 0, 'google_oauth_invalid_grant')
        `).bind(`${source}-failed`, projectId, source),
        env.DB.prepare(`
          INSERT INTO collection_runs
            (id, project_id, source, trigger_type, status, started_at, completed_at, records_written)
          VALUES (?, ?, ?, 'manual', 'succeeded', '2026-09-27T00:00:00.000Z', '2026-09-27T00:01:00.000Z', 1)
        `).bind(`${source}-succeeded`, projectId, source),
      );
    }
    await env.DB.batch(statements);

    const response = await exports.default.fetch(
      `https://site-insights.test/v1/projects/${projectId}/status`,
      { headers: { authorization: "Bearer test-read-token" } },
    );
    const body = await response.json() as Record<string, any>;
    expect(body.collectionHealth).toEqual({
      status: "healthy",
      reason: "all_sources_succeeded",
      affectedSources: [],
      repeatedFailureSources: [],
      staleSources: [],
    });
  });

  it("returns 404 for an unknown project and still requires read auth", async () => {
    const unauthorized = await exports.default.fetch(
      "https://site-insights.test/v1/projects/missing/status",
    );
    expect(unauthorized.status).toBe(401);

    const missing = await exports.default.fetch(
      "https://site-insights.test/v1/projects/missing/status",
      { headers: { authorization: "Bearer test-read-token" } },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "project_not_found" });
  });
});
