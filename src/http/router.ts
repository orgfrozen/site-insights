import type { SiteInsightsEnv } from "../env";
import { handleProjectAdminRoute } from "../projects/project-routes";
import { requireAdminAuth, requireReadAuth } from "./auth";
import { jsonResponse } from "./response";

function healthResponse(): Response {
  return jsonResponse({
    ok: true,
    service: "site-insights",
    timestamp: new Date().toISOString(),
  });
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

    if (pathname === "/v1/admin/projects") {
      const response = await handleProjectAdminRoute(request, env, {});
      return response ?? jsonResponse({ error: "method_not_allowed" }, 405);
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
    return jsonResponse({ error: "not_found" }, 404);
  }

  return jsonResponse({ error: "not_found" }, 404);
}
