import type { Project } from "../domain/types";
import { dispatchDailyAnalysis, type DailyAnalysisDispatchInput, type DailyAnalysisDispatchResult } from "../analysis/daily-analysis";
import { logEvent } from "../observability/logger";
import { deriveCollectionRecovery, type CollectionRecovery } from "./collection-recovery";
import type { SiteInsightsEnv } from "../env";
import { ProjectRepository } from "../projects/project-repository";
import { StatusRepository, type CollectionHealth } from "../reporting/status-repository";
import {
  collectProjectGsc,
  type CollectProjectGscOptions,
  type ProjectCollectionSummary,
} from "./gsc-orchestrator";

export interface SchedulerHealthSummary {
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
}

export interface SchedulerSummary {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  recovered: number;
  health: SchedulerHealthSummary;
}

type AnalysisDispatcher = (
  project: Project,
  env: SiteInsightsEnv,
  input: DailyAnalysisDispatchInput,
) => Promise<DailyAnalysisDispatchResult>;

type ProjectCollector = (
  project: Project,
  env: SiteInsightsEnv,
  options: CollectProjectGscOptions,
) => Promise<ProjectCollectionSummary>;

type CollectionHealthReader = (
  projectId: string,
  env: SiteInsightsEnv,
) => Promise<CollectionHealth>;

export interface SchedulerDependencies {
  collectProject?: ProjectCollector;
  dispatchAnalysis?: AnalysisDispatcher;
  readCollectionHealth?: CollectionHealthReader;
}

function unknownCollectionHealth(reason: string): CollectionHealth {
  return {
    status: "unknown",
    reason,
    affectedSources: [],
    repeatedFailureSources: [],
    staleSources: [],
  };
}

export async function runScheduledCollection(
  env: SiteInsightsEnv,
  dependencies: SchedulerDependencies = {},
): Promise<SchedulerSummary> {
  const projects = (await new ProjectRepository(env.DB).listProjects("enabled"))
    .sort((a, b) => a.id.localeCompare(b.id));
  const summary: SchedulerSummary = {
    total: projects.length,
    succeeded: 0,
    partial: 0,
    failed: 0,
    recovered: 0,
    health: { healthy: 0, warning: 0, critical: 0, unknown: 0 },
  };
  const collectProject = dependencies.collectProject ?? collectProjectGsc;
  const dispatchAnalysis = dependencies.dispatchAnalysis ?? dispatchDailyAnalysis;
  const readCollectionHealth = dependencies.readCollectionHealth
    ?? ((projectId, runtimeEnv) => new StatusRepository(runtimeEnv.DB).getCollectionHealth(projectId));

  for (const project of projects) {
    let collectionStatus: ProjectCollectionSummary["status"] = "failed";
    let collectionHealth = unknownCollectionHealth("collection_unexpected_error");
    let previousCollectionHealth = unknownCollectionHealth("collection_health_unavailable");
    let collectionRecovery: CollectionRecovery | null = null;

    try {
      previousCollectionHealth = await readCollectionHealth(project.id, env);
    } catch {
      // Recovery detection is best effort and must not block collection.
    }

    try {
      const result = await collectProject(project, env, { triggerType: "cron" });
      collectionStatus = result.status;
      summary[result.status] += 1;
      try {
        collectionHealth = await readCollectionHealth(project.id, env);
        collectionRecovery = deriveCollectionRecovery(previousCollectionHealth, collectionHealth);
      } catch {
        collectionHealth = unknownCollectionHealth("collection_health_unavailable");
      }
    } catch {
      summary.failed += 1;
    }

    if (collectionRecovery) {
      summary.recovered += 1;
      logEvent("scheduled_collection_project_recovered", {
        projectId: project.id,
        fromStatus: collectionRecovery.fromStatus,
        fromReason: collectionRecovery.fromReason,
        toStatus: collectionRecovery.toStatus,
        toReason: collectionRecovery.toReason,
      });
    }

    summary.health[collectionHealth.status] += 1;
    logEvent("scheduled_collection_project_finished", {
      projectId: project.id,
      collectionStatus,
      collectionHealthStatus: collectionHealth.status,
      collectionHealthReason: collectionHealth.reason,
      affectedSources: collectionHealth.affectedSources,
      repeatedFailureSources: collectionHealth.repeatedFailureSources,
      staleSources: collectionHealth.staleSources,
      recovered: collectionRecovery !== null,
      recoveredFromStatus: collectionRecovery?.fromStatus ?? null,
      recoveredFromReason: collectionRecovery?.fromReason ?? null,
    });

    try {
      await dispatchAnalysis(project, env, { collectionStatus, collectionRecovery });
    } catch {
      logEvent("daily_analysis_dispatch_unexpected_error", {
        projectId: project.id,
        collectionStatus,
        collectionHealthStatus: collectionHealth.status,
        collectionHealthReason: collectionHealth.reason,
      });
    }
  }

  return summary;
}
