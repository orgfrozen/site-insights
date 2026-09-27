import type { Project } from "../domain/types";
import type { SiteInsightsEnv } from "../env";
import { getGoogleConnection } from "../google/google-connection";
import { GoogleOAuthError, refreshGoogleAccessToken } from "../google/oauth";
import { collectSearchAnalytics } from "../gsc/search-analytics-collector";
import { searchAnalyticsDiagnosticFields } from "../gsc/search-analytics-stage-error";
import { collectSitemaps } from "../gsc/sitemap-collector";
import { collectUrlInspections } from "../gsc/url-inspection-collector";
import { logEvent } from "../observability/logger";
import { ProjectRepository } from "../projects/project-repository";
import {
  COLLECTION_SOURCES,
  RunRepository,
  type CollectionRunStatus,
  type CollectionSource,
  type CollectionTriggerType,
} from "./run-repository";

type Fetcher = typeof fetch;

export interface SourceCollectionSummary {
  status: CollectionRunStatus;
  recordsWritten: number;
  errorCode?: string;
}

export interface ProjectCollectionSummary {
  projectId: string;
  status: CollectionRunStatus;
  sources: Record<CollectionSource, SourceCollectionSummary>;
}

export interface CollectProjectGscOptions {
  triggerType: CollectionTriggerType;
  fetcher?: Fetcher;
}

interface SourceExecutionResult {
  status: CollectionRunStatus;
  recordsWritten: number;
  errorCode?: string;
  errorMessage?: string;
}

function inspectionConcurrency(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("invalid_gsc_inspection_concurrency");
  }
  return parsed;
}

function stableError(source: CollectionSource, error: unknown): { code: string; message: string } {
  const objectCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (objectCode && /^[a-z0-9_]+$/.test(objectCode)) {
    const message = error instanceof Error ? error.message : objectCode;
    return { code: objectCode, message };
  }

  if (error instanceof Error) {
    const code = error.message.split(":", 1)[0];
    if (/^(?:gsc_|invalid_gsc_|google_)[a-z0-9_]+$/.test(code)) {
      return { code, message: error.message };
    }
  }

  const code = `${source}_unexpected_error`;
  return { code, message: code };
}

function overallStatus(sources: Record<CollectionSource, SourceCollectionSummary>): CollectionRunStatus {
  const statuses = COLLECTION_SOURCES.map((source) => sources[source].status);
  if (statuses.every((status) => status === "succeeded")) return "succeeded";
  if (statuses.every((status) => status === "failed")) return "failed";
  return "partial";
}

async function recordAuthenticationFailure(
  repository: RunRepository,
  projectId: string,
  triggerType: CollectionTriggerType,
  error: unknown,
): Promise<ProjectCollectionSummary> {
  let failure: { code: string; message: string; httpStatus?: number };
  if (error instanceof GoogleOAuthError) {
    failure = {
      code: error.code,
      message: error.status > 0 ? `${error.code}:${error.status}` : error.code,
      ...(error.status > 0 ? { httpStatus: error.status } : {}),
    };
  } else if (error instanceof Error && error.message === "google_connection_not_configured") {
    failure = {
      code: "google_connection_not_configured",
      message: "google_connection_not_configured",
    };
  } else {
    failure = { code: "google_oauth_failed", message: "google_oauth_failed" };
  }
  const sources = {} as Record<CollectionSource, SourceCollectionSummary>;

  for (const source of COLLECTION_SOURCES) {
    const runId = await repository.start(projectId, source, triggerType);
    await repository.finish(runId, {
      status: "failed",
      recordsWritten: 0,
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    sources[source] = { status: "failed", recordsWritten: 0, errorCode: failure.code };
    logEvent("collection_source_finished", {
      projectId,
      source,
      triggerType,
      status: "failed",
      recordsWritten: 0,
      errorCode: failure.code,
      ...(failure.httpStatus ? { oauthHttpStatus: failure.httpStatus } : {}),
    });
  }

  return { projectId, status: "failed", sources };
}

export async function collectProjectGsc(
  project: Project,
  env: SiteInsightsEnv,
  options: CollectProjectGscOptions,
): Promise<ProjectCollectionSummary> {
  const fetcher = options.fetcher ?? fetch;
  const runRepository = new RunRepository(env.DB);
  const projectRepository = new ProjectRepository(env.DB);

  let accessToken: string;
  try {
    const connection = getGoogleConnection(project, env);
    accessToken = (await refreshGoogleAccessToken(connection, fetcher)).accessToken;
  } catch (error) {
    return recordAuthenticationFailure(
      runRepository,
      project.id,
      options.triggerType,
      error,
    );
  }

  const sources = {} as Record<CollectionSource, SourceCollectionSummary>;

  const executeSource = async (
    source: CollectionSource,
    execute: () => Promise<SourceExecutionResult>,
  ): Promise<void> => {
    const runId = await runRepository.start(project.id, source, options.triggerType);
    try {
      const result = await execute();
      await runRepository.finish(runId, result);
      sources[source] = {
        status: result.status,
        recordsWritten: result.recordsWritten,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      };
      logEvent("collection_source_finished", {
        projectId: project.id,
        source,
        triggerType: options.triggerType,
        status: result.status,
        recordsWritten: result.recordsWritten,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      });
    } catch (error) {
      const failure = stableError(source, error);
      const diagnosticFields = source === "gsc_search_analytics"
        ? searchAnalyticsDiagnosticFields(error)
        : null;
      await runRepository.finish(runId, {
        status: "failed",
        recordsWritten: 0,
        errorCode: failure.code,
        errorMessage: failure.message,
      });
      sources[source] = {
        status: "failed",
        recordsWritten: 0,
        errorCode: failure.code,
      };
      logEvent("collection_source_finished", {
        projectId: project.id,
        source,
        triggerType: options.triggerType,
        status: "failed",
        recordsWritten: 0,
        errorCode: failure.code,
        ...(diagnosticFields ?? {}),
      });
    }
  };

  await executeSource("gsc_search_analytics", async () => {
    const result = await collectSearchAnalytics({ project, accessToken, env, fetcher });
    return { status: "succeeded", recordsWritten: result.recordsWritten };
  });

  await executeSource("gsc_sitemaps", async () => {
    const result = await collectSitemaps({ project, accessToken, env, fetcher });
    return { status: "succeeded", recordsWritten: result.recordsWritten };
  });

  await executeSource("gsc_url_inspection", async () => {
    const coreUrls = await projectRepository.listCoreUrls(project.id, true);
    const result = await collectUrlInspections({
      project,
      coreUrls,
      accessToken,
      concurrency: inspectionConcurrency(env.GSC_INSPECTION_CONCURRENCY),
      env,
      fetcher,
    });
    if (result.failed === 0) {
      return { status: "succeeded", recordsWritten: result.recordsWritten };
    }
    if (result.succeeded === 0) {
      return {
        status: "failed",
        recordsWritten: result.recordsWritten,
        errorCode: "gsc_url_inspection_all_failed",
        errorMessage: "gsc_url_inspection_all_failed",
      };
    }
    return {
      status: "partial",
      recordsWritten: result.recordsWritten,
      errorCode: "gsc_url_inspection_partial_failure",
      errorMessage: "gsc_url_inspection_partial_failure",
    };
  });

  return {
    projectId: project.id,
    status: overallStatus(sources),
    sources,
  };
}
