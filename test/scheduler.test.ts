import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { CreateProjectInput } from "../src/domain/types";
import type { SiteInsightsEnv } from "../src/env";
import { runScheduledCollection } from "../src/collection/scheduler";
import { ProjectRepository } from "../src/projects/project-repository";

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
    });

    expect(attempted).toEqual(["vetatool", "zeroparse"]);
    expect(dispatched).toEqual([["vetatool", "succeeded"], ["zeroparse", "failed"]]);
    expect(summary).toEqual({ total: 2, succeeded: 1, partial: 0, failed: 1 });
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
    });

    expect(summary).toEqual({ total: 1, succeeded: 0, partial: 1, failed: 0 });
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
    expect(await response.json()).toMatchObject({
      projectId: "manual-site",
      status: "failed",
      analysisTask: {
        status: "failed",
        dispatchStatus: "failed",
        taskStatus: null,
        errorCode: "patchsync_configuration_missing",
      },
    });

    const snapshot = await env.DB.prepare(
      "SELECT project_id, collection_status, dispatch_status, dispatch_error_code FROM daily_analysis_snapshots WHERE project_id = ?",
    ).bind("manual-site").first<Record<string, unknown>>();
    expect(snapshot).toMatchObject({
      project_id: "manual-site",
      collection_status: "failed",
      dispatch_status: "failed",
      dispatch_error_code: "patchsync_configuration_missing",
    });

    const runs = await env.DB.prepare(
      "SELECT source, trigger_type, status FROM collection_runs WHERE project_id = ? ORDER BY source",
    ).bind("manual-site").all<Record<string, unknown>>();
    expect(runs.results).toHaveLength(3);
    expect(runs.results.every((run) => run.trigger_type === "manual")).toBe(true);
    expect(runs.results.every((run) => run.status === "failed")).toBe(true);
  });
});
