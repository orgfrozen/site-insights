import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CreateProjectInput } from "../src/domain/types";
import type { SiteInsightsEnv } from "../src/env";
import { collectProjectGsc } from "../src/collection/gsc-orchestrator";
import { ProjectRepository } from "../src/projects/project-repository";

const projectInput: CreateProjectInput = {
  id: "zeroparse",
  name: "ZeroParse",
  domain: "zeroparse.com",
  baseUrl: "https://zeroparse.com",
  timezone: "Asia/Shanghai",
  gscProperty: "sc-domain:zeroparse.com",
  gaProperty: null,
  cloudflareZoneId: null,
  robotsUrl: "https://zeroparse.com/robots.txt",
  sitemapUrls: ["https://zeroparse.com/sitemap.xml"],
  primaryLanguage: "en",
  languages: ["en", "zh"],
  canonicalHost: "zeroparse.com",
  includeWww: false,
};

function testEnv(): SiteInsightsEnv {
  return {
    DB: env.DB,
    GOOGLE_CLIENT_ID: "client-id",
    GOOGLE_CLIENT_SECRET: "client-secret-value",
    GOOGLE_REFRESH_TOKEN: "refresh-token-value",
    GSC_INITIAL_BACKFILL_DAYS: "56",
    GSC_REFRESH_DAYS: "3",
    GSC_INSPECTION_CONCURRENCY: "2",
  } as SiteInsightsEnv;
}

async function seedProject() {
  const repository = new ProjectRepository(env.DB);
  const project = await repository.createProject(projectInput);
  await repository.replaceCoreUrls(project.id, [
    {
      url: "https://zeroparse.com/big-json-viewer",
      pageType: "tool",
      priority: 1,
      inspectionEnabled: true,
    },
  ]);
  return project;
}

describe("GSC project orchestration", () => {
  it("isolates source failures and persists one run per source without secrets", async () => {
    const project = await seedProject();
    const attempted: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      attempted.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "access-token-value", expires_in: 3600 });
      }
      if (url.includes("/searchAnalytics/query")) {
        return Response.json(
          { error: { status: "INTERNAL", message: "refresh-token-value must never persist" } },
          { status: 500 },
        );
      }
      if (url.includes("/sitemaps")) {
        return Response.json({ sitemap: [{ path: "https://zeroparse.com/sitemap.xml" }] });
      }
      if (url.includes("urlInspection/index:inspect")) {
        return Response.json({
          inspectionResult: {
            indexStatusResult: { verdict: "PASS", coverageState: "Submitted and indexed" },
          },
        });
      }
      throw new Error(`unexpected_fetch:${url}`);
    };

    const summary = await collectProjectGsc(project, testEnv(), {
      triggerType: "manual",
      fetcher,
    });

    expect(summary.status).toBe("partial");
    expect(summary.sources.gsc_search_analytics).toMatchObject({
      status: "failed",
      recordsWritten: 0,
      errorCode: "gsc_search_analytics_http_error",
    });
    expect(summary.sources.gsc_sitemaps).toEqual({ status: "succeeded", recordsWritten: 1 });
    expect(summary.sources.gsc_url_inspection).toEqual({ status: "succeeded", recordsWritten: 1 });
    expect(attempted.some((url) => url.includes("/searchAnalytics/query"))).toBe(true);
    expect(attempted.some((url) => url.includes("/sitemaps"))).toBe(true);
    expect(attempted.some((url) => url.includes("urlInspection/index:inspect"))).toBe(true);

    const runs = await env.DB.prepare(
      "SELECT source, trigger_type, status, records_written, error_code, error_message FROM collection_runs WHERE project_id = ? ORDER BY started_at, source",
    ).bind(project.id).all<Record<string, unknown>>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "gsc_search_analytics", status: "failed", records_written: 0 }),
      expect.objectContaining({ source: "gsc_sitemaps", status: "succeeded", records_written: 1 }),
      expect.objectContaining({ source: "gsc_url_inspection", status: "succeeded", records_written: 1 }),
    ]));
    expect(JSON.stringify(runs.results)).not.toContain("refresh-token-value");
    expect(JSON.stringify(runs.results)).not.toContain("client-secret-value");
    expect(JSON.stringify(runs.results)).not.toContain("access-token-value");
  });

  it("records all sources as failed when OAuth refresh fails", async () => {
    const project = await seedProject();
    const fetcher: typeof fetch = async (input) => {
      if (String(input) === "https://oauth2.googleapis.com/token") {
        return Response.json({ error: "invalid_grant", detail: "refresh-token-value" }, { status: 400 });
      }
      throw new Error("source_should_not_run");
    };

    const summary = await collectProjectGsc(project, testEnv(), {
      triggerType: "cron",
      fetcher,
    });

    expect(summary.status).toBe("failed");
    for (const source of ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"] as const) {
      expect(summary.sources[source]).toEqual({
        status: "failed",
        recordsWritten: 0,
        errorCode: "google_oauth_failed",
      });
    }

    const runs = await env.DB.prepare(
      "SELECT source, status, trigger_type, error_code, error_message FROM collection_runs WHERE project_id = ? ORDER BY source",
    ).bind(project.id).all<Record<string, unknown>>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results.every((run) => run.status === "failed")).toBe(true);
    expect(runs.results.every((run) => run.trigger_type === "cron")).toBe(true);
    expect(runs.results.every((run) => run.error_code === "google_oauth_failed")).toBe(true);
    expect(JSON.stringify(runs.results)).not.toContain("refresh-token-value");
  });
});
