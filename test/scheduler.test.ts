import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CreateProjectInput } from "../src/domain/types";
import type { SiteInsightsEnv } from "../src/env";
import { runScheduledCollection } from "../src/collection/scheduler";
import type { DailyAnalysisDispatchInput } from "../src/analysis/daily-analysis";
import type { CollectionHealth } from "../src/reporting/status-repository";
import { ProjectRepository } from "../src/projects/project-repository";

function collectionHealth(
  status: CollectionHealth["status"],
  reason: string,
): CollectionHealth {
  return { status, reason, affectedSources: [], repeatedFailureSources: [] };
}

function projectInput(id: string): CreateProjectInput {
  const domain = `${id}.example`;
  return {
    id,
    name: id,
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

describe("scheduled GSC collection", () => {
  it("continues after one project throws and summarizes project outcomes", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("zeroparse"));
    await repository.createProject(projectInput("vetatool"));
    await repository.createProject(projectInput("disabled-site"));
    await repository.setProjectStatus("disabled-site", "disabled");

    const attempted: string[] = [];
    const dispatched: Array<[string, string]> = [];
    const summary = await runScheduledCollection(env as SiteInsightsEnv, {
      collectProject: async (project) => {
        attempted.push(project.id);
        if (project.id === "zeroparse") throw new Error("collector_crashed");
        return {
          projectId: project.id,
          status: "succeeded",
          sources: {} as never,
        };
      },
      dispatchAnalysis: async (project, _env, input) => {
        dispatched.push([project.id, input.collectionStatus]);
        return {
          status: "succeeded",
          dispatchStatus: "succeeded",
          taskId: `task_${project.id}`,
          taskStatus: "ready",
          created: true,
          analysisDate: "2026-09-01",
        };
      },
      readCollectionHealth: async (projectId) => {
        expect(projectId).toBe("vetatool");
        return collectionHealth("healthy", "all_sources_succeeded");
      },
    });

    expect(attempted).toEqual(["vetatool", "zeroparse"]);
    expect(dispatched).toEqual([["vetatool", "succeeded"], ["zeroparse", "failed"]]);
    expect(summary).toEqual({
      total: 2,
      succeeded: 1,
      partial: 0,
      failed: 1,
      recovered: 0,
      health: { healthy: 1, warning: 0, critical: 0, unknown: 1 },
    });
  });

  it("counts partial project collections separately", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("partial-site"));

    const summary = await runScheduledCollection(env as SiteInsightsEnv, {
      collectProject: async (project) => ({
        projectId: project.id,
        status: "partial",
        sources: {} as never,
      }),
      readCollectionHealth: async () => collectionHealth("warning", "collection_degraded"),
    });

    expect(summary).toEqual({
      total: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      recovered: 0,
      health: { healthy: 0, warning: 1, critical: 0, unknown: 0 },
    });
  });

  it("records a real warning/critical to healthy recovery without treating unknown as recovery", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("recovery-site"));

    const healthStates = [
      collectionHealth("critical", "google_oauth_invalid_grant"),
      collectionHealth("healthy", "all_sources_succeeded"),
    ];
    const dispatched: Array<DailyAnalysisDispatchInput> = [];
    let healthRead = 0;
    const summary = await runScheduledCollection(env as SiteInsightsEnv, {
      collectProject: async (project) => ({
        projectId: project.id,
        status: "succeeded",
        sources: {} as never,
      }),
      readCollectionHealth: async () => healthStates[Math.min(healthRead++, healthStates.length - 1)],
      dispatchAnalysis: async (_project, _env, input) => {
        dispatched.push(input);
        return {
          status: "succeeded",
          dispatchStatus: "succeeded",
          taskId: "task_recovery",
          taskStatus: "ready",
          created: true,
          analysisDate: "2026-09-01",
        };
      },
    });

    expect(summary.recovered).toBe(1);
    expect(dispatched[0].collectionRecovery).toEqual({
      recovered: true,
      fromStatus: "critical",
      fromReason: "google_oauth_invalid_grant",
      toStatus: "healthy",
      toReason: "all_sources_succeeded",
    });
  });

});

describe("manual GSC collection route", () => {
  it("requires admin auth", async () => {
    const response = await exports.default.fetch(
      "https://site-insights.test/v1/admin/projects/missing/collect/gsc",
      { method: "POST" },
    );
    expect(response.status).toBe(401);
  });

  it("returns project_not_found for an unknown project", async () => {
    const response = await exports.default.fetch(
      "https://site-insights.test/v1/admin/projects/missing/collect/gsc",
      {
        method: "POST",
        headers: { authorization: "Bearer test-admin-token" },
      },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "project_not_found" });
  });

  it("runs synchronously and persists manual source runs", async () => {
    const repository = new ProjectRepository(env.DB);
    await repository.createProject(projectInput("manual-site"));

    const response = await exports.default.fetch(
      "https://site-insights.test/v1/admin/projects/manual-site/collect/gsc",
      {
        method: "POST",
        headers: { authorization: "Bearer test-admin-token" },
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;
    expect(body).toMatchObject({
      projectId: "manual-site",
      status: "failed",
      collectionHealth: {
        status: "critical",
        reason: "google_connection_not_configured",
        affectedSources: ["gsc_search_analytics", "gsc_sitemaps", "gsc_url_inspection"],
        repeatedFailureSources: [],
      },
      collectionRecovery: null,
      analysisTask: {
        status: "failed",
        dispatchStatus: "failed",
        taskStatus: null,
        errorCode: "patchsync_configuration_missing",
      },
    });

    const snapshot = await env.DB.prepare(
      "SELECT project_id, collection_status, snapshot_json, dispatch_status, dispatch_error_code FROM daily_analysis_snapshots WHERE project_id = ?",
    ).bind("manual-site").first<Record<string, unknown>>();
    expect(snapshot).toMatchObject({
      project_id: "manual-site",
      collection_status: "failed",
      dispatch_status: "failed",
      dispatch_error_code: "patchsync_configuration_missing",
    });
    expect(JSON.parse(String(snapshot?.snapshot_json))).toMatchObject({
      collectionHealth: {
        status: "critical",
        reason: "google_connection_not_configured",
      },
    });

    const runs = await env.DB.prepare(
      "SELECT source, trigger_type, status FROM collection_runs WHERE project_id = ? ORDER BY source",
    ).bind("manual-site").all<Record<string, unknown>>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results.every((run) => run.trigger_type === "manual")).toBe(true);
    expect(runs.results.every((run) => run.status === "failed")).toBe(true);
  });
});
