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
    GSC_INITIAL_BACKFILL_DAYS: "56",
    GSC_REFRESH_DAYS: "3",
    GSC_INSPECTION_CONCURRENCY: "3",
  } as SiteInsightsEnv;
}

function executionContext(): ExecutionContext {
  return {} as ExecutionContext;
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
  it("reports D1 health and secret presence as booleans without exposing values", async () => {
    const env = diagnosticEnv();
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext());

    expect(response.status).toBe(200);
    const serialized = await response.clone().text();
    expect(await response.json()).toEqual({
      ok: true,
      database: "ok",
      configuration: {
        googleClientId: true,
        googleClientSecret: true,
        googleRefreshToken: true,
        adminApiToken: true,
        readApiToken: true,
      },
    });

    for (const value of [
      "google-client-id-value",
      "google-client-secret-value",
      "google-refresh-token-value",
      "admin-token-value",
      "read-token-value",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("returns 503 for a failed D1 probe without exposing database errors or secret values", async () => {
    const env = diagnosticEnv({ dbError: true });
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext());

    expect(response.status).toBe(503);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toEqual({
      ok: false,
      database: "error",
      configuration: {
        googleClientId: true,
        googleClientSecret: true,
        googleRefreshToken: true,
        adminApiToken: true,
        readApiToken: true,
      },
    });
    expect(bodyText).not.toContain("database-secret-detail");
    expect(bodyText).not.toContain("google-client-secret-value");
  });

  it("reports missing optional configuration as false", async () => {
    const env = diagnosticEnv({
      googleClientId: "",
      googleClientSecret: "",
      googleRefreshToken: "",
      readApiToken: "",
    });
    const response = await routeRequest(new Request("https://site-insights.test/v1/admin/diagnostics", {
      headers: { authorization: "Bearer admin-token-value" },
    }), env, executionContext());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      configuration: {
        googleClientId: false,
        googleClientSecret: false,
        googleRefreshToken: false,
        adminApiToken: true,
        readApiToken: false,
      },
    });
  });
});
