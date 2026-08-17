import type { Project } from "../domain/types";
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

type ProjectCollector = (
  project: Project,
  env: SiteInsightsEnv,
  options: CollectProjectGscOptions,
) => Promise<ProjectCollectionSummary>;

export interface SchedulerDependencies {
  collectProject?: ProjectCollector;
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

  for (const project of projects) {
    try {
      const result = await collectProject(project, env, { triggerType: "cron" });
      summary[result.status] += 1;
    } catch {
      summary.failed += 1;
    }
  }

  return summary;
}
