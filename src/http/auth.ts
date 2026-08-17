import type { SiteInsightsEnv } from "../env";
import { jsonResponse } from "./response";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function requireReadAuth(request: Request, env: SiteInsightsEnv): Response | null {
  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  if (env.READ_API_TOKEN && constantTimeEqual(token, env.READ_API_TOKEN)) return null;
  if (env.ADMIN_API_TOKEN && constantTimeEqual(token, env.ADMIN_API_TOKEN)) return null;
  return jsonResponse({ error: "unauthorized" }, 401);
}

export function requireAdminAuth(request: Request, env: SiteInsightsEnv): Response | null {
  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  if (env.ADMIN_API_TOKEN && constantTimeEqual(token, env.ADMIN_API_TOKEN)) return null;
  return jsonResponse({ error: "forbidden" }, 403);
}
