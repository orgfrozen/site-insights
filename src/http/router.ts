import { collectProjectGsc } from "../collection/gsc-orchestrator";
import type { SiteInsightsEnv } from "../env";
import { ProjectRepository } from "../projects/project-repository";
import { handleProjectStatusRoute } from "../reporting/status-routes";
import { handleProjectAdminRoute } from "../projects/project-routes";
import { requireAdminAuth, requireReadAuth } from "./auth";
import { configurationPresence, logEvent } from "../observability/logger";
import { jsonResponse } from "./response";

function healthResponse(): Response {
  return jsonResponse({
    ok: true,
    service: "site-insights",
    timestamp: new Date().toISOString(),
  });
}

async function diagnosticsResponse(env: SiteInsightsEnv): Promise<Response> {
  const configuration = configurationPresence(env);

  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return jsonResponse({
      ok: true,
      database: "ok",
      configuration,
    });
  } catch {
    logEvent("diagnostics.database_probe_failed", { database: "error" });
    return jsonResponse({
      ok: false,
      database: "error",
      configuration,
    }, 503);
  }
}

export async function routeRequest(
  request: Request,
  env: SiteInsightsEnv,
  _ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/health") {
    return healthResponse();
  }

  if (pathname.startsWith("/v1/admin/")) {
    const rejected = requireAdminAuth(request, env);
    if (rejected) return rejected;

    if (pathname === "/v1/admin/diagnostics") {
      if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);
      return diagnosticsResponse(env);
    }

    if (pathname === "/v1/admin/projects") {
      const response = await handleProjectAdminRoute(request, env, {});
      return response ?? jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const collectMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)\/collect\/gsc$/);
    if (request.method === "POST" && collectMatch) {
      const project = await new ProjectRepository(env.DB).getProject(collectMatch[1]);
      if (!project) return jsonResponse({ error: "project_not_found" }, 404);
      const summary = await collectProjectGsc(project, env, { triggerType: "manual" });
      return jsonResponse(summary);
    }

    const coreUrlsMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)\/core-urls$/);
    if (coreUrlsMatch) {
      const response = await handleProjectAdminRoute(request, env, {
        projectId: coreUrlsMatch[1],
        action: "core-urls",
      });
      return response ?? jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const statusMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)\/(enable|disable)$/);
    if (statusMatch) {
      const response = await handleProjectAdminRoute(request, env, {
        projectId: statusMatch[1],
        action: statusMatch[2] as "enable" | "disable",
      });
      return response ?? jsonResponse({ error: "method_not_allowed" }, 405);
    }

    const projectMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)$/);
    if (projectMatch) {
      const response = await handleProjectAdminRoute(request, env, { projectId: projectMatch[1] });
      return response ?? jsonResponse({ error: "method_not_allowed" }, 405);
    }

    return jsonResponse({ error: "not_found" }, 404);
  }

  if (pathname.startsWith("/v1/")) {
    const rejected = requireReadAuth(request, env);
    if (rejected) return rejected;

    const projectStatusMatch = pathname.match(/^\/v1\/projects\/([a-z0-9-]+)\/status$/);
    if (request.method === "GET" && projectStatusMatch) {
      return handleProjectStatusRoute(projectStatusMatch[1], env);
    }

    return jsonResponse({ error: "not_found" }, 404);
  }

  return jsonResponse({ error: "not_found" }, 404);
}
