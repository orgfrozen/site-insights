import type { Project } from "../domain/types";
import { dispatchDailyAnalysis, type DailyAnalysisDispatchInput, type DailyAnalysisDispatchResult } from "../analysis/daily-analysis";
import { logEvent } from "../observability/logger";
import type { SiteInsightsEnv } from "../env";
import { ProjectRepository } from "../projects/project-repository";
import {
  collectProjectGsc,
  type CollectProjectGscOptions,
  type ProjectCollectionSummary,
} from "./gsc-orchestrator";

export interface SchedulerSummary {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
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

export interface SchedulerDependencies {
  collectProject?: ProjectCollector;
  dispatchAnalysis?: AnalysisDispatcher;
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
  };
  const collectProject = dependencies.collectProject ?? collectProjectGsc;
  const dispatchAnalysis = dependencies.dispatchAnalysis ?? dispatchDailyAnalysis;

  for (const project of projects) {
    let collectionStatus: ProjectCollectionSummary["status"] = "failed";
    try {
      const result = await collectProject(project, env, { triggerType: "cron" });
      collectionStatus = result.status;
      summary[result.status] += 1;
    } catch {
      summary.failed += 1;
    }

    try {
      await dispatchAnalysis(project, env, { collectionStatus });
    } catch {
      logEvent("daily_analysis_dispatch_unexpected_error", {
        projectId: project.id,
        collectionStatus,
      });
    }
  }

  return summary;
}
