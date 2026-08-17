import type { SiteInsightsEnv } from "../env";
import { jsonResponse } from "../http/response";
import { ProjectRepository } from "./project-repository";
import {
  mergeAndValidateProjectPatch,
  ProjectValidationError,
  validateCoreUrls,
  validateProjectInput,
} from "./project-service";

export type ProjectAdminAction = "core-urls" | "enable" | "disable";

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ProjectValidationError("invalid_json");
  }
}

function isConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /unique|constraint/i.test(error.message);
}

function stableError(error: unknown): Response {
  if (error instanceof ProjectValidationError) {
    return jsonResponse({ error: error.code }, 400);
  }
  if (isConstraintError(error)) {
    return jsonResponse({ error: "project_conflict" }, 409);
  }
  console.error(JSON.stringify({ event: "project_route_error", error: "internal_error" }));
  return jsonResponse({ error: "internal_error" }, 500);
}

export async function handleProjectAdminRoute(
  request: Request,
  env: SiteInsightsEnv,
  params: { projectId?: string; action?: ProjectAdminAction },
): Promise<Response | null> {
  const repo = new ProjectRepository(env.DB);

  try {
    if (!params.projectId && !params.action && request.method === "POST") {
      const input = validateProjectInput(await parseJson(request));
      const project = await repo.createProject(input);
      return jsonResponse(project, 201);
    }

    if (!params.projectId && !params.action && request.method === "GET") {
      return jsonResponse({ projects: await repo.listProjects() });
    }

    if (!params.projectId) return null;
    const project = await repo.getProject(params.projectId);
    if (!project) return jsonResponse({ error: "project_not_found" }, 404);

    if (!params.action && request.method === "GET") {
      return jsonResponse({
        project,
        coreUrls: await repo.listCoreUrls(project.id),
      });
    }

    if (!params.action && request.method === "PATCH") {
      const validated = mergeAndValidateProjectPatch(project, await parseJson(request));
      const { id: _id, ...patch } = validated;
      const updated = await repo.updateProject(project.id, patch);
      return jsonResponse(updated);
    }

    if (params.action === "core-urls" && request.method === "PUT") {
      const input = validateCoreUrls(project, await parseJson(request));
      await repo.replaceCoreUrls(project.id, input.urls);
      return jsonResponse({
        projectId: project.id,
        coreUrls: await repo.listCoreUrls(project.id),
      });
    }

    if (params.action === "enable" && request.method === "POST") {
      return jsonResponse(await repo.setProjectStatus(project.id, "enabled"));
    }

    if (params.action === "disable" && request.method === "POST") {
      return jsonResponse(await repo.setProjectStatus(project.id, "disabled"));
    }

    return null;
  } catch (error) {
    return stableError(error);
  }
}
