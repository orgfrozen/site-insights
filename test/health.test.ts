import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { SiteInsightsEnv } from "../src/env";
import { routeRequest } from "../src/http/router";

type DiagnosticDb = Pick<D1Database, "prepare">;

function diagnosticEnv(options: {
  dbError?: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  adminApiToken?: string;
  readApiToken?: string;
  patchsyncStatusBaseUrl?: string;
  patchsyncStatusToken?: string;
  patchsyncStatusAgentId?: string;
} = {}): SiteInsightsEnv {
  const db = {
    prepare(sql: string) {
      expect(sql).toBe("SELECT 1 AS ok");
      return {
        async first() {
          if (options.dbError) throw new Error("database-secret-detail");
          return { ok: 1 };
        },
      };
    },
  } as unknown as DiagnosticDb;

  return {
    DB: db as D1Database,
    GOOGLE_CLIENT_ID: options.googleClientId ?? "google-client-id-value",
    GOOGLE_CLIENT_SECRET: options.googleClientSecret ?? "google-client-secret-value",
    GOOGLE_REFRESH_TOKEN: options.googleRefreshToken ?? "google-refresh-token-value",
    ADMIN_API_TOKEN: options.adminApiToken ?? "admin-token-value",
    READ_API_TOKEN: options.readApiToken ?? "read-token-value",
    PATCHSYNC_STATUS_BASE_URL: options.patchsyncStatusBaseUrl ?? "https://patchsync-status.test",
    PATCHSYNC_STATUS_TOKEN: options.patchsyncStatusToken ?? "patchsync-token-value",
    PATCHSYNC_STATUS_AGENT_ID: options.patchsyncStatusAgentId ?? "ewan-macbook",
    GSC_INITIAL_BACKFILL_DAYS: "56",
    GSC_REFRESH_DAYS: "3",
    GSC_INSPECTION_CONCURRENCY: "3",
  } as SiteInsightsEnv;
}

function executionContext(): ExecutionContext {
  return {} as ExecutionContext;
}

function successfulOAuthFetch(): typeof fetch {
  return async (input) => {
    expect(String(input)).toBe("https://oauth2.googleapis.com/token");
    return Response.json({ access_token: "diagnostic-access-token-value", expires_in: 3600 });
  };
}

describe("GET /health", () => {
  it("returns a minimal public health response", async () => {
    const response = await exports.default.fetch("https://site-insights.test/health");
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      ok: true,
      service: "site-insights",
    });
    expect(Object.keys(body).sort()).toEqual(["ok", "service", "timestamp"]);
  });
});

describe("GET /v1/admin/diagnostics", () => {
  it("actively verifies D1 and Google OAuth without exposing credentials or access tokens", async () => {
    const env = diagnosticEnv();
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext(), successfulOAuthFetch());

    expect(response.status).toBe(200);
    const serialized = await response.clone().text();
    expect(await response.json()).toEqual({
      ok: true,
      database: "ok",
      googleOAuth: { status: "ok" },
      configuration: {
        googleClientId: true,
        googleClientSecret: true,
        googleRefreshToken: true,
        adminApiToken: true,
        readApiToken: true,
        patchsyncStatusBaseUrl: true,
        patchsyncStatusToken: true,
        patchsyncStatusAgentId: true,
      },
    });

    for (const value of [
      "google-client-id-value",
      "google-client-secret-value",
      "google-refresh-token-value",
      "diagnostic-access-token-value",
      "admin-token-value",
      "read-token-value",
      "patchsync-token-value",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("returns 503 for a failed D1 probe while still reporting a successful OAuth probe", async () => {
    const env = diagnosticEnv({ dbError: true });
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext(), successfulOAuthFetch());

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({
      ok: false,
      database: "error",
      googleOAuth: { status: "ok" },
      configuration: {
        googleClientId: true,
        googleClientSecret: true,
        googleRefreshToken: true,
        adminApiToken: true,
        readApiToken: true,
        patchsyncStatusBaseUrl: true,
        patchsyncStatusToken: true,
        patchsyncStatusAgentId: true,
      },
    });
    expect(bodyText).not.toContain("database-secret-detail");
    expect(bodyText).not.toContain("google-client-secret-value");
  });

  it("returns a sanitized OAuth failure when Google rejects the refresh token", async () => {
    const env = diagnosticEnv();
    const fetcher: typeof fetch = async () => Response.json({
      error: "invalid_grant",
      error_description: "google-refresh-token-value must never be returned",
    }, { status: 400 });

    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext(), fetcher);

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toMatchObject({
      ok: false,
      database: "ok",
      googleOAuth: {
        status: "failed",
        errorCode: "google_oauth_invalid_grant",
        httpStatus: 400,
      },
    });
    expect(bodyText).not.toContain("google-refresh-token-value");
    expect(bodyText).not.toContain("error_description");
  });

  it("reports missing Google configuration without attempting the OAuth request", async () => {
    const env = diagnosticEnv({
      googleClientId: "",
      googleClientSecret: "",
      googleRefreshToken: "",
      readApiToken: "",
      patchsyncStatusBaseUrl: "",
      patchsyncStatusToken: "",
      patchsyncStatusAgentId: "",
    });
    const fetcher: typeof fetch = async () => {
      throw new Error("oauth_fetch_should_not_run");
    };
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext(), fetcher);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      database: "ok",
      googleOAuth: {
        status: "failed",
        errorCode: "google_connection_not_configured",
      },
      configuration: {
        googleClientId: false,
        googleClientSecret: false,
        googleRefreshToken: false,
        adminApiToken: true,
        readApiToken: false,
        patchsyncStatusBaseUrl: false,
        patchsyncStatusToken: false,
        patchsyncStatusAgentId: false,
      },
    });
  });
});
