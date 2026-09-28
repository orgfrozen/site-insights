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
    collectionHealth: {
      status: "warning",
      reason: "collection_degraded",
      affectedSources: ["gsc_url_inspection"],
      repeatedFailureSources: [],
      staleSources: [],
    },
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

  it("surfaces critical collection health before SEO metrics", () => {
    const criticalReport = report();
    criticalReport.collectionHealth = {
      status: "critical",
      reason: "google_oauth_invalid_grant",
      affectedSources: [
        "gsc_search_analytics",
        "gsc_sitemaps",
        "gsc_url_inspection",
      ],
      repeatedFailureSources: [
        "gsc_search_analytics",
        "gsc_sitemaps",
        "gsc_url_inspection",
      ],
      staleSources: [],
    };
    const markdown = buildDailyAnalysisMarkdown(criticalReport, {
      analysisDate: "2026-09-01",
      collectionStatus: "failed",
    });

    expect(markdown).toContain("Collection health: critical; reason=google_oauth_invalid_grant");
    expect(markdown).toContain("## Collection alert");
    expect(markdown.indexOf("## Collection alert")).toBeLessThan(markdown.indexOf("## Search summary"));
    expect(markdown).toContain("do not infer a site regression from collector failure alone");
  });


  it("surfaces collection recovery before SEO metrics", () => {
    const recoveredReport = report();
    recoveredReport.collectionHealth = {
      status: "healthy",
      reason: "all_sources_succeeded",
      affectedSources: [],
      repeatedFailureSources: [],
      staleSources: [],
    };
    const markdown = buildDailyAnalysisMarkdown(recoveredReport, {
      analysisDate: "2026-09-01",
      collectionStatus: "succeeded",
      collectionRecovery: {
        recovered: true,
        fromStatus: "critical",
        fromReason: "google_oauth_invalid_grant",
        toStatus: "healthy",
        toReason: "all_sources_succeeded",
      },
    });

    expect(markdown).toContain("## Collection recovery");
    expect(markdown).toContain("recovered from critical; reason=google_oauth_invalid_grant");
    expect(markdown.indexOf("## Collection recovery")).toBeLessThan(markdown.indexOf("## Search summary"));
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
    expect(task.instructions).toContain(
      "If the snapshot reports warning/critical collection health, treat SEO/search metrics as potentially stale and do not propose target-site code changes solely to compensate for a collector/OAuth failure.",
    );
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

  it("upgrades a same-day partial snapshot once when collection later succeeds", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput("vetatool-upgrade"));
    const repository = new DailyAnalysisRepository(env.DB);
    await repository.getOrCreate({
      projectId: "vetatool-upgrade",
      analysisDate: "2026-09-01",
      dataThrough: null,
      collectionStatus: "partial",
      snapshotMarkdown: "partial snapshot",
      snapshotJson: { version: 1, state: "partial" },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    await repository.markDispatchSucceeded(
      "vetatool-upgrade",
      "2026-09-01",
      "task_existing",
      new Date("2026-09-01T01:05:00.000Z"),
    );

    const upgraded = await repository.getOrCreate({
      projectId: "vetatool-upgrade",
      analysisDate: "2026-09-01",
      dataThrough: "2026-08-30",
      collectionStatus: "succeeded",
      snapshotMarkdown: "succeeded snapshot",
      snapshotJson: { version: 1, state: "succeeded" },
      generatedAt: "2026-09-01T02:00:00.000Z",
    });

    expect(upgraded.collectionStatus).toBe("succeeded");
    expect(upgraded.dataThrough).toBe("2026-08-30");
    expect(upgraded.snapshotMarkdown).toBe("succeeded snapshot");
    expect(upgraded.patchsyncTaskId).toBe("task_existing");
    expect(upgraded.dispatchStatus).toBe("pending");
    expect(upgraded.taskRefreshPending).toBe(true);

    const repeated = await repository.getOrCreate({
      projectId: "vetatool-upgrade",
      analysisDate: "2026-09-01",
      dataThrough: "2026-08-31",
      collectionStatus: "succeeded",
      snapshotMarkdown: "later succeeded snapshot",
      snapshotJson: { version: 1, state: "later" },
      generatedAt: "2026-09-01T03:00:00.000Z",
    });
    expect(repeated.snapshotMarkdown).toBe("succeeded snapshot");
    expect(repeated.dataThrough).toBe("2026-08-30");
  });
});

describe("daily analysis dispatch", () => {
  it("reports dispatch status separately from the current PatchSync task lifecycle status", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput("vetatool-status-semantics"));
    const statusReport = report();
    statusReport.project.id = "vetatool-status-semantics";
    statusReport.project.name = "vetatool-status-semantics";
    statusReport.project.domain = "vetatool-status-semantics.com";
    statusReport.project.baseUrl = "https://vetatool-status-semantics.com";

    const fetcher: typeof fetch = async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") throw new Error("unexpected_post");
      return Response.json({
        tasks: [{ task_id: "task_existing_status", status: "claimed" }],
        next_before: null,
      });
    };

    const result = await dispatchDailyAnalysis(
      projectInput("vetatool-status-semantics") as never,
      env as SiteInsightsEnv & Record<string, string>,
      {
        collectionStatus: "succeeded",
        now: new Date("2026-09-01T03:00:00Z"),
        fetcher,
        statusReport,
        configuration: {
          baseUrl: "https://patchsync-status.test",
          token: "test-token",
          agentId: "ewan-macbook",
        },
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: "task_existing_status",
      taskStatus: "claimed",
      created: false,
    });
  });

  it("refreshes taskStatus for an already-dispatched daily snapshot without changing dispatch success", async () => {
    const projectId = "vetatool-cached-status";
    await new ProjectRepository(env.DB).createProject(projectInput(projectId));
    const repository = new DailyAnalysisRepository(env.DB);
    await repository.getOrCreate({
      projectId,
      analysisDate: "2026-09-01",
      dataThrough: "2026-08-30",
      collectionStatus: "succeeded",
      snapshotMarkdown: "snapshot",
      snapshotJson: { version: 1 },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    await repository.markDispatchSucceeded(
      projectId,
      "2026-09-01",
      "task_cached_status",
      new Date("2026-09-01T01:05:00.000Z"),
    );

    const statusReport = report();
    statusReport.project.id = projectId;
    statusReport.project.name = projectId;
    statusReport.project.domain = `${projectId}.com`;
    statusReport.project.baseUrl = `https://${projectId}.com`;
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return Response.json({
        task: { task_id: "task_cached_status", status: "completed" },
        events: [],
      });
    };

    const result = await dispatchDailyAnalysis(
      projectInput(projectId) as never,
      env as SiteInsightsEnv & Record<string, string>,
      {
        collectionStatus: "succeeded",
        now: new Date("2026-09-01T03:00:00Z"),
        fetcher,
        statusReport,
        configuration: {
          baseUrl: "https://patchsync-status.test",
          token: "test-token",
          agentId: "ewan-macbook",
        },
      },
    );

    expect(result).toMatchObject({
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: "task_cached_status",
      taskStatus: "completed",
      created: false,
    });
    expect(calls).toEqual(["GET https://patchsync-status.test/v1/tasks/task_cached_status"]);
  });

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

  it("attaches one succeeded snapshot upgrade to the existing same-day task", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput("vetatool-refresh"));
    const repository = new DailyAnalysisRepository(env.DB);
    await repository.getOrCreate({
      projectId: "vetatool-refresh",
      analysisDate: "2026-09-01",
      dataThrough: null,
      collectionStatus: "partial",
      snapshotMarkdown: "partial snapshot",
      snapshotJson: { version: 1 },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    await repository.markDispatchSucceeded(
      "vetatool-refresh",
      "2026-09-01",
      "task_existing",
      new Date("2026-09-01T01:05:00.000Z"),
    );

    const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ method, url, body });
      if (method === "GET" && url.endsWith("/v1/tasks/task_existing/evidence")) {
        return Response.json({ evidence: [] });
      }
      if (method === "GET" && url.endsWith("/v1/tasks/task_existing")) {
        return Response.json({ task: { task_id: "task_existing", status: "claimed" }, events: [] });
      }
      if (method === "GET") {
        return Response.json({ tasks: [{ task_id: "task_existing" }], next_before: null });
      }
      if (method === "POST" && url.endsWith("/v1/tasks/task_existing/evidence")) {
        return Response.json({ evidence: { evidence_id: "evidence_upgrade" } }, { status: 201 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    };

    const succeededReport = report();
    succeededReport.project.id = "vetatool-refresh";
    succeededReport.project.name = "vetatool-refresh";
    succeededReport.project.domain = "vetatool-refresh.com";
    succeededReport.project.baseUrl = "https://vetatool-refresh.com";

    const result = await dispatchDailyAnalysis(
      projectInput("vetatool-refresh") as never,
      env as SiteInsightsEnv & Record<string, string>,
      {
        collectionStatus: "succeeded",
        now: new Date("2026-09-01T02:00:00Z"),
        fetcher,
        statusReport: succeededReport,
        configuration: {
          baseUrl: "https://patchsync-status.test",
          token: "test-token",
          agentId: "ewan-macbook",
        },
      },
    );

    expect(result).toMatchObject({ status: "succeeded", taskId: "task_existing", created: false });
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "POST"]);
    expect(calls[1].url).toBe("https://patchsync-status.test/v1/tasks/task_existing/evidence");
    expect(calls[2].url).toBe("https://patchsync-status.test/v1/tasks/task_existing/evidence");
    expect(calls[2].body).toMatchObject({
      evidence_type: "site_insights.daily_snapshot_upgrade",
      source: "site_insights",
      payload: {
        analysis_date: "2026-09-01",
        data_through: "2026-08-30",
        collection_status: "succeeded",
        collection_health: succeededReport.collectionHealth,
        collection_recovery: null,
        supersedes_embedded_snapshot: true,
      },
    });

    const callsAfterUpgrade = calls.length;
    const repeated = await dispatchDailyAnalysis(
      projectInput("vetatool-refresh") as never,
      env as SiteInsightsEnv & Record<string, string>,
      {
        collectionStatus: "succeeded",
        now: new Date("2026-09-01T03:00:00Z"),
        fetcher,
        statusReport: succeededReport,
        configuration: {
          baseUrl: "https://patchsync-status.test",
          token: "test-token",
          agentId: "ewan-macbook",
        },
      },
    );
    expect(repeated).toMatchObject({
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: "task_existing",
      taskStatus: "claimed",
      created: false,
    });
    expect(calls).toHaveLength(callsAfterUpgrade + 1);
    expect(calls.at(-1)?.url).toBe("https://patchsync-status.test/v1/tasks/task_existing");
  });

  it("reconciles same-day upgrade evidence after a lost evidence response", async () => {
    await new ProjectRepository(env.DB).createProject(projectInput("vetatool-refresh-loss"));
    const repository = new DailyAnalysisRepository(env.DB);
    await repository.getOrCreate({
      projectId: "vetatool-refresh-loss",
      analysisDate: "2026-09-01",
      dataThrough: null,
      collectionStatus: "partial",
      snapshotMarkdown: "partial snapshot",
      snapshotJson: { version: 1 },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    await repository.markDispatchSucceeded(
      "vetatool-refresh-loss",
      "2026-09-01",
      "task_existing_loss",
      new Date("2026-09-01T01:05:00.000Z"),
    );

    const succeededReport = report();
    succeededReport.project.id = "vetatool-refresh-loss";
    succeededReport.project.name = "vetatool-refresh-loss";
    succeededReport.project.domain = "vetatool-refresh-loss.com";
    succeededReport.project.baseUrl = "https://vetatool-refresh-loss.com";

    let evidenceRecorded = false;
    let evidencePostCount = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith("/v1/tasks/task_existing_loss/evidence")) {
        return Response.json({
          evidence: evidenceRecorded
            ? [{
                evidence_type: "site_insights.daily_snapshot_upgrade",
                source: "site_insights",
                payload: {
                  snapshot_key: "site-insights:vetatool-refresh-loss:daily:2026-09-01:succeeded",
                },
              }]
            : [],
        });
      }
      if (method === "GET") {
        return Response.json({ tasks: [{ task_id: "task_existing_loss" }], next_before: null });
      }
      if (method === "POST" && url.endsWith("/v1/tasks/task_existing_loss/evidence")) {
        evidencePostCount += 1;
        evidenceRecorded = true;
        throw new TypeError("network response lost");
      }
      throw new Error(`unexpected request ${method} ${url}`);
    };

    const commonInput = {
      collectionStatus: "succeeded" as const,
      fetcher,
      statusReport: succeededReport,
      configuration: {
        baseUrl: "https://patchsync-status.test",
        token: "test-token",
        agentId: "ewan-macbook",
      },
    };
    const first = await dispatchDailyAnalysis(
      projectInput("vetatool-refresh-loss") as never,
      env as SiteInsightsEnv & Record<string, string>,
      { ...commonInput, now: new Date("2026-09-01T02:00:00Z") },
    );
    expect(first).toMatchObject({ status: "failed", errorCode: "patchsync_dispatch_failed" });

    const second = await dispatchDailyAnalysis(
      projectInput("vetatool-refresh-loss") as never,
      env as SiteInsightsEnv & Record<string, string>,
      { ...commonInput, now: new Date("2026-09-01T02:05:00Z") },
    );
    expect(second).toMatchObject({ status: "succeeded", taskId: "task_existing_loss", created: false });
    expect(evidencePostCount).toBe(1);
    const stored = await repository.get("vetatool-refresh-loss", "2026-09-01");
    expect(stored?.taskRefreshPending).toBe(false);
  });

  it("creates one follow-up analysis when a succeeded upgrade arrives after the original task completed", async () => {
    const projectId = "vetatool-completed-refresh";
    await new ProjectRepository(env.DB).createProject(projectInput(projectId));
    const repository = new DailyAnalysisRepository(env.DB);
    await repository.getOrCreate({
      projectId,
      analysisDate: "2026-09-01",
      dataThrough: null,
      collectionStatus: "partial",
      snapshotMarkdown: "partial snapshot",
      snapshotJson: { version: 1, state: "partial" },
      generatedAt: "2026-09-01T01:00:00.000Z",
    });
    await repository.markDispatchSucceeded(
      projectId,
      "2026-09-01",
      "task_completed",
      new Date("2026-09-01T01:05:00.000Z"),
    );

    const succeededReport = report();
    succeededReport.project.id = projectId;
    succeededReport.project.name = projectId;
    succeededReport.project.domain = `${projectId}.com`;
    succeededReport.project.baseUrl = `https://${projectId}.com`;

    const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      calls.push({ method, url, body });

      if (method === "GET" && url.endsWith("/v1/tasks/task_completed/evidence")) {
        return Response.json({ evidence: [] });
      }
      if (method === "POST" && url.endsWith("/v1/tasks/task_completed/evidence")) {
        return Response.json({ evidence: { evidence_id: "evidence_upgrade" } }, { status: 201 });
      }
      if (method === "GET" && url.endsWith("/v1/tasks/task_refresh")) {
        return Response.json({ task: { task_id: "task_refresh", status: "ready" }, events: [] });
      }
      if (method === "GET" && url.includes("source_ref=site-insights%3Avetatool-completed-refresh%3Adaily%3A2026-09-01%3Asucceeded-refresh")) {
        return Response.json({ tasks: [], next_before: null });
      }
      if (method === "GET" && url.includes("source_ref=site-insights%3Avetatool-completed-refresh%3Adaily%3A2026-09-01")) {
        return Response.json({ tasks: [{ task_id: "task_completed", status: "completed" }], next_before: null });
      }
      if (method === "POST" && url.endsWith("/v1/tasks")) {
        return Response.json({ task: { task_id: "task_refresh" }, assignment: { assignment_id: "assignment_refresh" } }, { status: 201 });
      }
      throw new Error(`unexpected request ${method} ${url}`);
    };

    const commonInput = {
      collectionStatus: "succeeded" as const,
      fetcher,
      statusReport: succeededReport,
      configuration: {
        baseUrl: "https://patchsync-status.test",
        token: "test-token",
        agentId: "ewan-macbook",
      },
    };
    const first = await dispatchDailyAnalysis(
      projectInput(projectId) as never,
      env as SiteInsightsEnv & Record<string, string>,
      { ...commonInput, now: new Date("2026-09-01T02:00:00Z") },
    );

    expect(first).toMatchObject({ status: "succeeded", taskId: "task_refresh", created: true });
    const taskPost = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/tasks"));
    expect(taskPost?.body).toMatchObject({
      parent_task_id: "task_completed",
      source_type: "api",
      source_ref: "site-insights:vetatool-completed-refresh:daily:2026-09-01:succeeded-refresh",
      acceptance: { require_analysis: true },
    });
    expect(String(taskPost?.body?.goal)).toContain("Collection result: succeeded");

    const callCountAfterFirst = calls.length;
    const repeated = await dispatchDailyAnalysis(
      projectInput(projectId) as never,
      env as SiteInsightsEnv & Record<string, string>,
      { ...commonInput, now: new Date("2026-09-01T03:00:00Z") },
    );
    expect(repeated).toMatchObject({
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: "task_refresh",
      taskStatus: "ready",
      created: false,
    });
    expect(calls).toHaveLength(callCountAfterFirst + 1);
    expect(calls.at(-1)?.url).toBe("https://patchsync-status.test/v1/tasks/task_refresh");
  });

});
