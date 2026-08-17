import type { SiteInsightsEnv } from "../env";
import { jsonResponse } from "../http/response";
import { StatusRepository } from "./status-repository";

export async function handleProjectStatusRoute(
  projectId: string,
  env: SiteInsightsEnv,
): Promise<Response> {
  const status = await new StatusRepository(env.DB).getProjectStatus(projectId);
  return status
    ? jsonResponse(status)
    : jsonResponse({ error: "project_not_found" }, 404);
}
