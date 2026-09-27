import type { Project } from "../domain/types";
import type { SiteInsightsEnv } from "../env";
import { logEvent } from "../observability/logger";
import { StatusRepository, type ProjectStatusReport, type SearchMetrics } from "../reporting/status-repository";
import {
  DailyAnalysisRepository,
  type DailyAnalysisSnapshot,
} from "./daily-analysis-repository";

type Fetcher = typeof fetch;
type CollectionStatus = "succeeded" | "partial" | "failed";

export interface PatchSyncStatusConfiguration {
  baseUrl: string;
  token: string;
  agentId: string;
}

export interface DailyAnalysisDispatchInput {
  collectionStatus: CollectionStatus;
  now?: Date;
  fetcher?: Fetcher;
  statusReport?: ProjectStatusReport;
  configuration?: PatchSyncStatusConfiguration;
}

export interface DailyAnalysisDispatchResult {
  status: "succeeded" | "failed";
  dispatchStatus: "succeeded" | "failed";
  taskId?: string;
  taskStatus: string | null;
  created?: boolean;
  errorCode?: string;
  analysisDate: string;
}

export interface BuildSnapshotOptions {
  analysisDate: string;
  collectionStatus: CollectionStatus;
}

export interface DailyAnalysisTaskInput {
  project_id: string;
  agent_id: string;
  title: string;
  goal: string;
  task_type: "improvement";
  source_type: "api";
  source_ref: string;
  parent_task_id?: string;
  instructions: string[];
  acceptance: { require_analysis: true };
}

interface PatchSyncTaskSummary {
  taskId: string;
  status: string | null;
  archivedAt: string | null;
}

function configured(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function envConfiguration(env: SiteInsightsEnv): PatchSyncStatusConfiguration | null {
  const baseUrl = configured(env.PATCHSYNC_STATUS_BASE_URL);
  const token = configured(env.PATCHSYNC_STATUS_TOKEN);
  const agentId = configured(env.PATCHSYNC_STATUS_AGENT_ID);
  return baseUrl && token && agentId ? { baseUrl, token, agentId } : null;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatChange(value: number | null, suffix = "%"): string {
  if (value === null) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}${suffix}`;
}

function metricLine(label: string, metrics: SearchMetrics): string {
  return `- ${label}: clicks ${formatNumber(metrics.clicks)}, impressions ${formatNumber(metrics.impressions)}, CTR ${formatPercent(metrics.ctr)}, position ${metrics.position === null ? "n/a" : metrics.position.toFixed(2)}`;
}

function tableCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function metricRows<T extends Record<string, unknown>>(
  rows: T[],
  keys: Array<keyof T>,
  limit: number,
): string[] {
  return rows.slice(0, limit).map((row) => {
    const dimensions = keys.map((key) => tableCell(row[key]));
    const clicks = Number(row.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const ctr = Number(row.ctr ?? 0);
    const position = row.position === null || row.position === undefined ? "n/a" : Number(row.position).toFixed(2);
    return `| ${dimensions.join(" | ")} | ${formatNumber(clicks)} | ${formatNumber(impressions)} | ${formatPercent(ctr)} | ${position} |`;
  });
}

function capSnapshot(markdown: string, maxLength = 5600): string {
  if (markdown.length <= maxLength) return markdown;
  return `${markdown.slice(0, maxLength - 80).trimEnd()}\n\n[Snapshot truncated to fit PatchSync Task Contract.]`;
}

export function dailyAnalysisDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dailyAnalysisSourceRef(projectId: string, analysisDate: string): string {
  return `site-insights:${projectId}:daily:${analysisDate}`;
}

function dailyAnalysisRefreshSourceRef(projectId: string, analysisDate: string): string {
  return `${dailyAnalysisSourceRef(projectId, analysisDate)}:succeeded-refresh`;
}

export function buildDailyAnalysisMarkdown(
  report: ProjectStatusReport,
  options: BuildSnapshotOptions,
): string {
  const health = report.collectionHealth;
  const alertLines = health.status === "healthy"
    ? []
    : [
        "",
        "## Collection alert",
        `- severity: ${health.status}; reason=${health.reason}`,
        `- affected sources: ${health.affectedSources.join(", ") || "none"}`,
        `- repeated failures: ${health.repeatedFailureSources.join(", ") || "none"}`,
        "- Treat search/indexing metrics as potentially stale until collection health recovers; do not infer a site regression from collector failure alone.",
      ];
  const lines: string[] = [
    `# Site Insights Daily Snapshot — ${report.project.name}`,
    "",
    `Analysis date: ${options.analysisDate}`,
    `Generated at: ${report.generatedAt}`,
    `Data through: ${report.dataThrough ?? "no final GSC data"}`,
    `Collection result: ${options.collectionStatus}`,
    `Collection health: ${health.status}; reason=${health.reason}`,
    ...alertLines,
    "",
    "## Search summary",
    metricLine("Latest final day", report.search.latestDay),
    metricLine("Last 7 days", report.search.last7),
    metricLine("Previous 7 days", report.search.previous7),
    `- 7d delta: clicks ${formatChange(report.search.deltas.last7VsPrevious7.clicksPercent)}, impressions ${formatChange(report.search.deltas.last7VsPrevious7.impressionsPercent)}, CTR ${formatChange(report.search.deltas.last7VsPrevious7.ctrPointDelta * 100, "pp")}, position ${formatChange(report.search.deltas.last7VsPrevious7.positionDelta, "")}`,
    metricLine("Last 28 days", report.search.last28),
    metricLine("Previous 28 days", report.search.previous28),
    `- 28d delta: clicks ${formatChange(report.search.deltas.last28VsPrevious28.clicksPercent)}, impressions ${formatChange(report.search.deltas.last28VsPrevious28.impressionsPercent)}, CTR ${formatChange(report.search.deltas.last28VsPrevious28.ctrPointDelta * 100, "pp")}, position ${formatChange(report.search.deltas.last28VsPrevious28.positionDelta, "")}`,
    "",
    "## Top queries (28d)",
    "| Query | Clicks | Impressions | CTR | Position |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...metricRows(report.topQueries, ["query"], 10),
    "",
    "## Top pages (28d)",
    "| Page | Clicks | Impressions | CTR | Position |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...metricRows(report.topPages, ["page"], 10),
    "",
    "## Top query → page pairs (28d)",
    "| Query | Page | Clicks | Impressions | CTR | Position |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...metricRows(report.topQueryPages, ["query", "page"], 10),
    "",
    "## Geography / device",
    "Top countries:",
    ...report.countries.slice(0, 5).map((row) => `- ${row.country}: impressions ${formatNumber(row.impressions)}, clicks ${formatNumber(row.clicks)}, CTR ${formatPercent(row.ctr)}, position ${row.position === null ? "n/a" : row.position.toFixed(2)}`),
    "Top devices:",
    ...report.devices.slice(0, 5).map((row) => `- ${row.device}: impressions ${formatNumber(row.impressions)}, clicks ${formatNumber(row.clicks)}, CTR ${formatPercent(row.ctr)}, position ${row.position === null ? "n/a" : row.position.toFixed(2)}`),
    "",
    "## Core URL indexing",
    ...report.coreUrls.slice(0, 20).map((row) => `- ${tableCell(row.url)}: verdict=${tableCell(row.verdict) || "unknown"}; coverage=${tableCell(row.coverageState) || "unknown"}; googleCanonical=${tableCell(row.googleCanonical) || "unknown"}; userCanonical=${tableCell(row.userCanonical) || "unknown"}`),
    "",
    "## Sitemaps",
    ...report.sitemaps.slice(0, 10).map((row) => `- ${tableCell(row.path)}: errors=${tableCell(row.errors)}; warnings=${tableCell(row.warnings)}; pending=${tableCell(row.isPending)}; lastDownloaded=${tableCell(row.lastDownloaded) || "unknown"}`),
    "",
    "## Collection health",
    `- overall: ${health.status}; reason=${health.reason}; affected=${health.affectedSources.join(",") || "none"}; repeatedFailures=${health.repeatedFailureSources.join(",") || "none"}`,
    ...Object.entries(report.sources).map(([source, state]) => state.status === "never_collected"
      ? `- ${source}: never_collected`
      : `- ${source}: ${state.status}; records=${state.recordsWritten}; error=${state.errorCode ?? "none"}`),
  ];

  if (report.coreUrls.length === 0) lines.push("- No core URL inspection data is available.");
  if (report.sitemaps.length === 0) lines.push("- No sitemap snapshot is available.");
  if (report.topQueries.length === 0) lines.push("- No query metrics are available yet.");
  return capSnapshot(lines.join("\n"));
}

export function buildDailyAnalysisTask(input: {
  projectId: string;
  projectName: string;
  analysisDate: string;
  agentId: string;
  snapshotMarkdown: string;
}): DailyAnalysisTaskInput {
  const goal = [
    `分析 site-insights 在 ${input.analysisDate} 为 ${input.projectName} 生成的最新 Daily Snapshot，并结合本次 ${input.projectName} 最新源码，判断下一步最值得做的一个优化。`,
    "必须理解当前源码已有功能、SEO/页面架构和现有约束，避免重复实现已经存在的能力。不要只根据单一指标机械修改；综合数据事实、源码现状和投入产出比做决策。",
    "如果存在明确且适合代码实现的高价值优化，直接实现、测试并按当前 LLM_RULES 生成 Patch。一次只做一个最高价值改动。",
    "如果数据或源码表明当前不应修改代码，或者最合理动作需要更多数据/外部条件，不要为了产生 Patch 强行修改；说明数据事实、判断依据和后续观察项，然后正常完成 Task。",
    "完成时说明：观察到的数据事实、为什么选择该动作、实现内容（如有）、预期影响指标、建议观察的时间窗口。",
    "",
    input.snapshotMarkdown,
  ].join("\n\n");
  if (goal.length > 8000) throw new Error("daily_analysis_task_goal_too_large");

  return {
    project_id: input.projectId,
    agent_id: input.agentId,
    title: `${input.projectName} Site Insights daily analysis · ${input.analysisDate}`,
    goal,
    task_type: "improvement",
    source_type: "api",
    source_ref: dailyAnalysisSourceRef(input.projectId, input.analysisDate),
    instructions: [
      "Treat the Site Insights snapshot as collected facts; do not invent missing measurements.",
      "Before acting, inspect current Task Context/Evidence. If site_insights.daily_snapshot_upgrade evidence exists, its snapshot_markdown supersedes the embedded snapshot below.",
      "Read the exported latest project source before selecting an implementation action.",
      "Choose at most one highest-value action for this Task.",
      "If the snapshot reports warning/critical collection health, treat SEO/search metrics as potentially stale and do not propose target-site code changes solely to compensate for a collector/OAuth failure.",
    ],
    acceptance: { require_analysis: true },
  };
}

function buildDailyAnalysisRefreshTask(input: {
  projectId: string;
  projectName: string;
  analysisDate: string;
  agentId: string;
  snapshotMarkdown: string;
  parentTaskId: string;
}): DailyAnalysisTaskInput {
  const task = buildDailyAnalysisTask(input);
  return {
    ...task,
    title: `${input.projectName} Site Insights refreshed daily analysis · ${input.analysisDate}`,
    source_ref: dailyAnalysisRefreshSourceRef(input.projectId, input.analysisDate),
    parent_task_id: input.parentTaskId,
    instructions: [
      "The parent Daily Analysis Task completed before Site Insights collected a succeeded snapshot. Re-evaluate the decision using this final snapshot.",
      ...task.instructions,
    ],
  };
}

function stableHttpError(response: Response): string {
  if (response.status === 401 || response.status === 403) return "patchsync_auth_failed";
  if (response.status === 404) return "patchsync_project_or_endpoint_not_found";
  if (response.status === 409) return "patchsync_task_conflict";
  if (response.status >= 500) return "patchsync_server_error";
  return "patchsync_request_failed";
}

async function findExistingTask(
  configuration: PatchSyncStatusConfiguration,
  projectId: string,
  sourceRef: string,
  fetcher: Fetcher,
): Promise<PatchSyncTaskSummary | null> {
  const url = new URL(`${withoutTrailingSlash(configuration.baseUrl)}/v1/tasks`);
  url.searchParams.set("project_id", projectId);
  url.searchParams.set("source_type", "api");
  url.searchParams.set("source_ref", sourceRef);
  url.searchParams.set("limit", "1");
  const response = await fetcher(url.toString(), {
    headers: { authorization: `Bearer ${configuration.token}` },
  });
  if (!response.ok) throw new Error(stableHttpError(response));
  const body = await response.json() as {
    tasks?: Array<{ task_id?: unknown; status?: unknown; archived_at?: unknown }>;
  };
  const task = body.tasks?.[0];
  const taskId = task?.task_id;
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  return {
    taskId,
    status: typeof task?.status === "string" ? task.status : null,
    archivedAt: typeof task?.archived_at === "string" ? task.archived_at : null,
  };
}

function snapshotUpgradeEvidenceKey(snapshot: DailyAnalysisSnapshot): string {
  return `site-insights:${snapshot.projectId}:daily:${snapshot.analysisDate}:succeeded`;
}

async function hasSnapshotUpgradeEvidence(
  configuration: PatchSyncStatusConfiguration,
  taskId: string,
  snapshot: DailyAnalysisSnapshot,
  fetcher: Fetcher,
): Promise<boolean> {
  const response = await fetcher(
    `${withoutTrailingSlash(configuration.baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}/evidence`,
    { headers: { authorization: `Bearer ${configuration.token}` } },
  );
  if (!response.ok) throw new Error(stableHttpError(response));
  const body = await response.json() as {
    evidence?: Array<{
      evidence_type?: unknown;
      source?: unknown;
      payload?: { snapshot_key?: unknown } | unknown;
    }>;
  };
  if (!Array.isArray(body.evidence)) throw new Error("patchsync_invalid_evidence_response");
  const key = snapshotUpgradeEvidenceKey(snapshot);
  return body.evidence.some((entry) => {
    if (entry?.evidence_type !== "site_insights.daily_snapshot_upgrade") return false;
    if (entry?.source !== "site_insights") return false;
    const payload = entry.payload;
    return Boolean(
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "snapshot_key" in payload &&
      (payload as { snapshot_key?: unknown }).snapshot_key === key
    );
  });
}

async function attachSnapshotUpgradeEvidence(
  configuration: PatchSyncStatusConfiguration,
  taskId: string,
  snapshot: DailyAnalysisSnapshot,
  fetcher: Fetcher,
): Promise<boolean> {
  if (await hasSnapshotUpgradeEvidence(configuration, taskId, snapshot, fetcher)) return false;
  const response = await fetcher(
    `${withoutTrailingSlash(configuration.baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}/evidence`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        evidence_type: "site_insights.daily_snapshot_upgrade",
        source: "site_insights",
        payload: {
          snapshot_key: snapshotUpgradeEvidenceKey(snapshot),
          analysis_date: snapshot.analysisDate,
          data_through: snapshot.dataThrough,
          collection_status: snapshot.collectionStatus,
          collection_health: snapshot.snapshotJson.collectionHealth ?? null,
          generated_at: snapshot.generatedAt,
          supersedes_embedded_snapshot: true,
          instruction: "Use snapshot_markdown as the current Site Insights facts for this Task.",
          snapshot_markdown: snapshot.snapshotMarkdown,
        },
      }),
    },
  );
  if (!response.ok) throw new Error(stableHttpError(response));
  const body = await response.json() as { evidence?: { evidence_id?: unknown } };
  const evidenceId = body.evidence?.evidence_id;
  if (typeof evidenceId !== "string" || evidenceId.length === 0) {
    throw new Error("patchsync_invalid_evidence_response");
  }
  return true;
}

async function getTaskStatus(
  configuration: PatchSyncStatusConfiguration,
  taskId: string,
  fetcher: Fetcher,
): Promise<string | null> {
  const response = await fetcher(
    `${withoutTrailingSlash(configuration.baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}`,
    { headers: { authorization: `Bearer ${configuration.token}` } },
  );
  if (!response.ok) throw new Error(stableHttpError(response));
  const body = await response.json() as { task?: { task_id?: unknown; status?: unknown } };
  if (body.task?.task_id !== taskId) throw new Error("patchsync_invalid_task_response");
  return typeof body.task.status === "string" ? body.task.status : null;
}

async function createTask(
  configuration: PatchSyncStatusConfiguration,
  task: DailyAnalysisTaskInput,
  fetcher: Fetcher,
): Promise<{ taskId: string; created: boolean; taskStatus: string | null }> {
  const response = await fetcher(`${withoutTrailingSlash(configuration.baseUrl)}/v1/tasks`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(task),
  });
  if (!response.ok) throw new Error(stableHttpError(response));
  const body = await response.json() as {
    created?: unknown;
    task?: { task_id?: unknown; status?: unknown };
  };
  const taskId = body.task?.task_id;
  if (typeof taskId !== "string" || taskId.length === 0) throw new Error("patchsync_invalid_task_response");
  return {
    taskId,
    created: typeof body.created === "boolean" ? body.created : response.status === 201,
    taskStatus: typeof body.task?.status === "string" ? body.task.status : null,
  };
}

function stableDispatchError(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]+$/.test(error.message)) return error.message;
  return "patchsync_dispatch_failed";
}

export async function dispatchDailyAnalysis(
  project: Project,
  env: SiteInsightsEnv,
  input: DailyAnalysisDispatchInput,
): Promise<DailyAnalysisDispatchResult> {
  const now = input.now ?? new Date();
  const analysisDate = dailyAnalysisDate(now, project.timezone);
  const repository = new DailyAnalysisRepository(env.DB);
  const statusReport = input.statusReport ?? await new StatusRepository(env.DB).getProjectStatus(project.id, now);
  if (!statusReport) {
    return {
      status: "failed",
      dispatchStatus: "failed",
      taskStatus: null,
      errorCode: "daily_analysis_project_not_found",
      analysisDate,
    };
  }

  const markdown = buildDailyAnalysisMarkdown(statusReport, {
    analysisDate,
    collectionStatus: input.collectionStatus,
  });
  const snapshot = await repository.getOrCreate({
    projectId: project.id,
    analysisDate,
    dataThrough: statusReport.dataThrough,
    collectionStatus: input.collectionStatus,
    generatedAt: statusReport.generatedAt,
    snapshotMarkdown: markdown,
    snapshotJson: {
      version: 1,
      projectId: project.id,
      analysisDate,
      dataThrough: statusReport.dataThrough,
      collectionStatus: input.collectionStatus,
      collectionHealth: statusReport.collectionHealth,
      report: statusReport,
    },
  });

  const configuration = input.configuration ?? envConfiguration(env);
  const fetcher = input.fetcher ?? fetch;

  if (snapshot.dispatchStatus === "succeeded" && snapshot.patchsyncTaskId) {
    let taskStatus: string | null = null;
    if (configuration) {
      try {
        taskStatus = await getTaskStatus(configuration, snapshot.patchsyncTaskId, fetcher);
      } catch {
        // Dispatch already succeeded; a best-effort lifecycle lookup must not
        // turn a previously successful dispatch into a collection failure.
      }
    }
    return {
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: snapshot.patchsyncTaskId,
      taskStatus,
      created: false,
      analysisDate,
    };
  }

  if (!configuration) {
    await repository.markDispatchFailed(project.id, analysisDate, "patchsync_configuration_missing", now);
    logEvent("daily_analysis_dispatch_failed", {
      projectId: project.id,
      analysisDate,
      errorCode: "patchsync_configuration_missing",
    });
    return {
      status: "failed",
      dispatchStatus: "failed",
      taskStatus: null,
      errorCode: "patchsync_configuration_missing",
      analysisDate,
    };
  }

  const sourceRef = dailyAnalysisSourceRef(project.id, analysisDate);
  try {
    const existingTask = await findExistingTask(configuration, project.id, sourceRef, fetcher);
    if (existingTask) {
      const shouldRefreshExistingTask = snapshot.taskRefreshPending;
      if (shouldRefreshExistingTask && existingTask.status === "completed" && !existingTask.archivedAt) {
        const evidenceCreated = await attachSnapshotUpgradeEvidence(
          configuration,
          existingTask.taskId,
          snapshot,
          fetcher,
        );
        const refreshTask = buildDailyAnalysisRefreshTask({
          projectId: project.id,
          projectName: project.name,
          analysisDate,
          agentId: configuration.agentId,
          snapshotMarkdown: snapshot.snapshotMarkdown,
          parentTaskId: existingTask.taskId,
        });
        let refreshResult: { taskId: string; created: boolean; taskStatus: string | null };
        const existingRefreshTask = await findExistingTask(
          configuration,
          project.id,
          refreshTask.source_ref,
          fetcher,
        );
        if (existingRefreshTask) {
          refreshResult = {
            taskId: existingRefreshTask.taskId,
            created: false,
            taskStatus: existingRefreshTask.status,
          };
        } else {
          try {
            refreshResult = await createTask(configuration, refreshTask, fetcher);
          } catch (createError) {
            try {
              const reconciledRefreshTask = await findExistingTask(
                configuration,
                project.id,
                refreshTask.source_ref,
                fetcher,
              );
              if (!reconciledRefreshTask) throw createError;
              refreshResult = {
                taskId: reconciledRefreshTask.taskId,
                created: false,
                taskStatus: reconciledRefreshTask.status,
              };
            } catch {
              throw createError;
            }
          }
        }
        await repository.markDispatchSucceeded(project.id, analysisDate, refreshResult.taskId, now);
        logEvent("daily_analysis_task_snapshot_followup", {
          projectId: project.id,
          analysisDate,
          parentTaskId: existingTask.taskId,
          taskId: refreshResult.taskId,
          created: refreshResult.created,
          evidenceCreated,
        });
        return {
          status: "succeeded",
          dispatchStatus: "succeeded",
          taskId: refreshResult.taskId,
          taskStatus: refreshResult.taskStatus,
          created: refreshResult.created,
          analysisDate,
        };
      }

      const evidenceCreated = shouldRefreshExistingTask
        ? await attachSnapshotUpgradeEvidence(configuration, existingTask.taskId, snapshot, fetcher)
        : false;
      await repository.markDispatchSucceeded(project.id, analysisDate, existingTask.taskId, now);
      logEvent(
        shouldRefreshExistingTask
          ? "daily_analysis_task_snapshot_refreshed"
          : "daily_analysis_task_reconciled",
        {
          projectId: project.id,
          analysisDate,
          taskId: existingTask.taskId,
          ...(shouldRefreshExistingTask ? { evidenceCreated } : {}),
        },
      );
      return {
        status: "succeeded",
        dispatchStatus: "succeeded",
        taskId: existingTask.taskId,
        taskStatus: existingTask.status,
        created: false,
        analysisDate,
      };
    }

    const task = buildDailyAnalysisTask({
      projectId: project.id,
      projectName: project.name,
      analysisDate,
      agentId: configuration.agentId,
      snapshotMarkdown: snapshot.snapshotMarkdown,
    });
    let taskResult: { taskId: string; created: boolean; taskStatus: string | null };
    try {
      taskResult = await createTask(configuration, task, fetcher);
    } catch (createError) {
      // A POST may have reached patchsync-status even when its response was lost.
      // Reconcile by the deterministic source_ref before declaring failure so a
      // network edge cannot create an invisible duplicate on a later retry.
      try {
        const reconciledTask = await findExistingTask(configuration, project.id, sourceRef, fetcher);
        if (reconciledTask) {
          const shouldRefreshExistingTask = snapshot.taskRefreshPending;
          const evidenceCreated = shouldRefreshExistingTask
            ? await attachSnapshotUpgradeEvidence(configuration, reconciledTask.taskId, snapshot, fetcher)
            : false;
          await repository.markDispatchSucceeded(project.id, analysisDate, reconciledTask.taskId, now);
          logEvent(
            shouldRefreshExistingTask
              ? "daily_analysis_task_snapshot_refreshed"
              : "daily_analysis_task_reconciled",
            {
              projectId: project.id,
              analysisDate,
              taskId: reconciledTask.taskId,
              afterCreateFailure: true,
              ...(shouldRefreshExistingTask ? { evidenceCreated } : {}),
            },
          );
          return {
            status: "succeeded",
            dispatchStatus: "succeeded",
            taskId: reconciledTask.taskId,
            taskStatus: reconciledTask.status,
            created: false,
            analysisDate,
          };
        }
      } catch {
        // Preserve the original create error; reconciliation is best-effort.
      }
      throw createError;
    }
    await repository.markDispatchSucceeded(project.id, analysisDate, taskResult.taskId, now);
    logEvent(taskResult.created ? "daily_analysis_task_created" : "daily_analysis_task_reconciled", {
      projectId: project.id,
      analysisDate,
      taskId: taskResult.taskId,
      dataThrough: snapshot.dataThrough,
      collectionStatus: snapshot.collectionStatus,
    });
    return {
      status: "succeeded",
      dispatchStatus: "succeeded",
      taskId: taskResult.taskId,
      taskStatus: taskResult.taskStatus,
      created: taskResult.created,
      analysisDate,
    };
  } catch (error) {
    const errorCode = stableDispatchError(error);
    await repository.markDispatchFailed(project.id, analysisDate, errorCode, now);
    logEvent("daily_analysis_dispatch_failed", {
      projectId: project.id,
      analysisDate,
      errorCode,
    });
    return {
      status: "failed",
      dispatchStatus: "failed",
      taskStatus: null,
      errorCode,
      analysisDate,
    };
  }
}
