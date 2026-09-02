import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ProjectStatusReport } from "../src/reporting/status-repository";
import type { SiteInsightsEnv } from "../src/env";
import { ProjectRepository } from "../src/projects/project-repository";
import {
  buildDailyAnalysisMarkdown,
  buildDailyAnalysisTask,
  dailyAnalysisDate,
  dailyAnalysisSourceRef,
  dispatchDailyAnalysis,
} from "../src/analysis/daily-analysis";
import { DailyAnalysisRepository } from "../src/analysis/daily-analysis-repository";

function report(): ProjectStatusReport {
  return {
    project: {
      id: "vetatool",
      name: "VetaTool",
      domain: "vetatool.com",
      baseUrl: "https://vetatool.com",
      status: "enabled",
    },
    generatedAt: "2026-09-01T00:00:00.000Z",
    dataThrough: "2026-08-30",
    search: {
      latestDay: { date: "2026-08-30", clicks: 9, impressions: 900, ctr: 0.01, position: 8.4 },
      last7: { clicks: 56, impressions: 8200, ctr: 56 / 8200, position: 9.4 },
      previous7: { clicks: 41, impressions: 5900, ctr: 41 / 5900, position: 10.1 },
      last28: { clicks: 190, impressions: 28100, ctr: 190 / 28100, position: 10.2 },
      previous28: { clicks: 130, impressions: 20300, ctr: 130 / 20300, position: 11.4 },
      deltas: {
        last7VsPrevious7: {
          clicksPercent: 36.5853658537,
          impressionsPercent: 38.9830508475,
          ctrPointDelta: (56 / 8200) - (41 / 5900),
          positionDelta: -0.7,
        },
        last28VsPrevious28: {
          clicksPercent: 46.1538461538,
          impressionsPercent: 38.4236453202,
          ctrPointDelta: (190 / 28100) - (130 / 20300),
          positionDelta: -1.2,
        },
      },
    },
    topQueries: [
      { query: "json viewer", clicks: 11, impressions: 2100, ctr: 11 / 2100, position: 8.2 },
    ],
    topPages: [
      { page: "https://vetatool.com/json-viewer", clicks: 10, impressions: 1900, ctr: 10 / 1900, position: 8.4 },
    ],
    topQueryPages: [
      { query: "json viewer", page: "https://vetatool.com/json-viewer", clicks: 10, impressions: 1800, ctr: 10 / 1800, position: 8.1 },
    ],
    countries: [
      { country: "usa", clicks: 8, impressions: 1200, ctr: 8 / 1200, position: 8.7 },
    ],
    devices: [
      { device: "DESKTOP", clicks: 9, impressions: 1500, ctr: 9 / 1500, position: 8.5 },
    ],
    coreUrls: [
      {
        url: "https://vetatool.com/json-viewer",
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        googleCanonical: "https://vetatool.com/json-viewer",
        userCanonical: "https://vetatool.com/json-viewer",
      },
    ],
    sitemaps: [
      { path: "https://vetatool.com/sitemap.xml", errors: 0, warnings: 0, isPending: false },
    ],
    sources: {
      gsc_search_analytics: {
        status: "succeeded",
        startedAt: "2026-09-01T00:00:00.000Z",
        completedAt: "2026-09-01T00:01:00.000Z",
        recordsWritten: 100,
        errorCode: null,
      },
      gsc_sitemaps: {
        status: "succeeded",
        startedAt: "2026-09-01T00:01:00.000Z",
        completedAt: "2026-09-01T00:01:10.000Z",
        recordsWritten: 1,
        errorCode: null,
      },
      gsc_url_inspection: { status: "never_collected" },
    },
  };
}

function projectInput(id = "vetatool") {
  const domain = `${id}.com`;
  return {
    id,
    name: id === "vetatool" ? "VetaTool" : id,
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

describe("daily analysis snapshot", () => {
  it("uses the project timezone for the daily idempotency key", () => {
    const now = new Date("2026-09-01T16:30:00.000Z");
    expect(dailyAnalysisDate(now, "Asia/Shanghai")).toBe("2026-09-02");
    expect(dailyAnalysisSourceRef("vetatool", "2026-09-02")).toBe("site-insights:vetatool:daily:2026-09-02");
  });

  it("renders compact source-aware SEO facts for the code agent", () => {
    const markdown = buildDailyAnalysisMarkdown(report(), {
      analysisDate: "2026-09-01",
      collectionStatus: "succeeded",
    });
    expect(markdown).toContain("# Site Insights Daily Snapshot — VetaTool");
    expect(markdown).toContain("Data through: 2026-08-30");
    expect(markdown).toContain("json viewer");
    expect(markdown).toContain("https://vetatool.com/json-viewer");
    expect(markdown).toContain("gsc_url_inspection: never_collected");
    expect(markdown.length).toBeLessThan(6500);
  });

  it("builds one source-aware improvement task that allows a no-code conclusion", () => {
    const task = buildDailyAnalysisTask({
      projectId: "vetatool",
      projectName: "VetaTool",
      analysisDate: "2026-09-01",
      agentId: "ewan-macbook",
      snapshotMarkdown: "# snapshot\nmetrics",
    });
    expect(task).toMatchObject({
      project_id: "vetatool",
      agent_id: "ewan-macbook",
      task_type: "improvement",
      source_type: "api",
      source_ref: "site-insights:vetatool:daily:2026-09-01",
      acceptance: { require_analysis: true },
    });
    expect(task.goal).toContain("结合本次 VetaTool 最新源码");
    expect(task.goal).toContain("不要为了产生 Patch 强行修改");
  });

  it("persists only the first snapshot for one project/day", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput());
    const repository = new DailyAnalysisRepository(env.DB);
    const first = await repository.getOrCreate({
      projectId: "vetatool",
      analysisDate: "2026-09-01",
      dataThrough: "2026-08-30",
      collectionStatus: "succeeded",
      snapshotMarkdown: "first snapshot",
      snapshotJson: { version: 1 },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    const second = await repository.getOrCreate({
      projectId: "vetatool",
      analysisDate: "2026-09-01",
      dataThrough: "2026-08-31",
      collectionStatus: "partial",
      snapshotMarkdown: "second snapshot",
      snapshotJson: { version: 2 },
      generatedAt: "2026-09-01T02:00:00.000Z",
    });
    expect(second.id).toBe(first.id);
    expect(second.snapshotMarkdown).toBe("first snapshot");
    expect(second.dataThrough).toBe("2026-08-30");
  });
});

describe("daily analysis dispatch", () => {
  it("recovers an already-created PatchSync task by source_ref without posting a duplicate", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput());
    const calls: Array<{ method: string; url: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "GET") {
        return Response.json({ tasks: [{ task_id: "task_existing" }], next_before: null });
      }
      throw new Error("unexpected_post");
    };

    const result = await dispatchDailyAnalysis(
      projectInput() as never,
      env as SiteInsightsEnv & Record<string, string>,
      { collectionStatus: "succeeded", now: new Date("2026-09-01T03:00:00Z"), fetcher, statusReport: report(), configuration: {
        baseUrl: "https://patchsync-status.test",
        token: "test-token",
        agentId: "ewan-macbook",
      } },
    );

    expect(result.status).toBe("succeeded");
    expect(result.taskId).toBe("task_existing");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("source_ref=site-insights%3Avetatool%3Adaily%3A2026-09-01");
  });

  it("creates the daily task once when PatchSync has no matching source_ref", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput());
    const calls: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ method, body });
      if (method === "GET") return Response.json({ tasks: [], next_before: null });
      return Response.json({ task: { task_id: "task_created" }, assignment: { assignment_id: "assignment_1" } }, { status: 201 });
    };

    const result = await dispatchDailyAnalysis(
      projectInput() as never,
      env as SiteInsightsEnv & Record<string, string>,
      { collectionStatus: "partial", now: new Date("2026-09-01T03:00:00Z"), fetcher, statusReport: report(), configuration: {
        baseUrl: "https://patchsync-status.test/",
        token: "test-token",
        agentId: "ewan-macbook",
      } },
    );

    expect(result).toMatchObject({ status: "succeeded", taskId: "task_created", created: true });
    expect(calls.map((call) => call.method)).toEqual(["GET", "POST"]);
    expect(calls[1].body).toMatchObject({
      project_id: "vetatool",
      agent_id: "ewan-macbook",
      source_type: "api",
      source_ref: "site-insights:vetatool:daily:2026-09-01",
    });
  });
  it("reconciles by source_ref when task creation response is lost", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput());
    let getCount = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        getCount += 1;
        return Response.json({
          tasks: getCount === 1 ? [] : [{ task_id: "task_after_timeout" }],
          next_before: null,
        });
      }
      throw new TypeError("network response lost");
    };

    const result = await dispatchDailyAnalysis(
      projectInput() as never,
      env as SiteInsightsEnv & Record<string, string>,
      { collectionStatus: "succeeded", now: new Date("2026-09-01T03:00:00Z"), fetcher, statusReport: report(), configuration: {
        baseUrl: "https://patchsync-status.test",
        token: "test-token",
        agentId: "ewan-macbook",
      } },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      taskId: "task_after_timeout",
      created: false,
    });
    expect(getCount).toBe(2);
  });

});
