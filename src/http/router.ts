import { collectProjectGsc } from "../collection/gsc-orchestrator";
import { dispatchDailyAnalysis } from "../analysis/daily-analysis";
import type { SiteInsightsEnv } from "../env";
import { ProjectRepository } from "../projects/project-repository";
import { handleProjectStatusRoute } from "../reporting/status-routes";
import { handleProjectAdminRoute } from "../projects/project-routes";
import { requireAdminAuth, requireReadAuth } from "./auth";
import { configurationPresence, logEvent } from "../observability/logger";
import { getGoogleConnectionFromEnv } from "../google/google-connection";
import { GoogleOAuthError, refreshGoogleAccessToken } from "../google/oauth";
import { jsonResponse } from "./response";

function healthResponse(): Response {
  return jsonResponse({
    ok: true,
    service: "site-insights",
    timestamp: new Date().toISOString(),
  });
}

type GoogleOAuthDiagnostic =
  | { status: "ok" }
  | { status: "failed"; errorCode: string; httpStatus?: number };

async function databaseDiagnostic(env: SiteInsightsEnv): Promise<"ok" | "error"> {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return "ok";
  } catch {
    logEvent("diagnostics.database_probe_failed", { database: "error" });
    return "error";
  }
}

async function googleOAuthDiagnostic(
  env: SiteInsightsEnv,
  fetcher: typeof fetch,
): Promise<GoogleOAuthDiagnostic> {
  try {
    const connection = getGoogleConnectionFromEnv(env);
    await refreshGoogleAccessToken(connection, fetcher);
    return { status: "ok" };
  } catch (error) {
    if (error instanceof GoogleOAuthError) {
      const diagnostic: GoogleOAuthDiagnostic = {
        status: "failed",
        errorCode: error.code,
        ...(error.status > 0 ? { httpStatus: error.status } : {}),
      };
      logEvent("diagnostics.google_oauth_probe_failed", diagnostic);
      return diagnostic;
    }

    const errorCode = error instanceof Error && error.message === "google_connection_not_configured"
      ? "google_connection_not_configured"
      : "google_oauth_failed";
    const diagnostic: GoogleOAuthDiagnostic = { status: "failed", errorCode };
    logEvent("diagnostics.google_oauth_probe_failed", diagnostic);
    return diagnostic;
  }
}

async function diagnosticsResponse(
  env: SiteInsightsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const configuration = configurationPresence(env);
  const [database, googleOAuth] = await Promise.all([
    databaseDiagnostic(env),
    googleOAuthDiagnostic(env, fetcher),
  ]);
  const ok = database === "ok" && googleOAuth.status === "ok";

  return jsonResponse({
    ok,
    database,
    googleOAuth,
    configuration,
  }, ok ? 200 : 503);
}

export async function routeRequest(
  request: Request,
  env: SiteInsightsEnv,
  _ctx: ExecutionContext,
  fetcher: typeof fetch = fetch,
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
      return diagnosticsResponse(env, fetcher);
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
      const analysisTask = await dispatchDailyAnalysis(project, env, {
        collectionStatus: summary.status,
      });
      return jsonResponse({ ...summary, analysisTask });
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
