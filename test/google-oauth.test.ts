import { describe, expect, it, vi } from "vitest";
import type { Project } from "../src/domain/types";
import type { SiteInsightsEnv } from "../src/env";
import {
  getGoogleConnection,
  getGoogleConnectionFromEnv,
  type GoogleConnection,
} from "../src/google/google-connection";
import {
  GoogleOAuthError,
  refreshGoogleAccessToken,
} from "../src/google/oauth";
import { fakeFetchSequence } from "./helpers/fake-fetch";

const connection: GoogleConnection = {
  clientId: "client-id-secret-value",
  clientSecret: "client-secret-value",
  refreshToken: "refresh-token-value",
};

describe("getGoogleConnection", () => {
  it("returns the single configured Worker-secret connection", () => {
    const env = {
      GOOGLE_CLIENT_ID: connection.clientId,
      GOOGLE_CLIENT_SECRET: connection.clientSecret,
      GOOGLE_REFRESH_TOKEN: connection.refreshToken,
    } as SiteInsightsEnv;

    expect(getGoogleConnection({} as Project, env)).toEqual(connection);
    expect(getGoogleConnectionFromEnv(env)).toEqual(connection);
  });

  it("fails with a stable error when any credential is missing", () => {
    const env = {
      GOOGLE_CLIENT_ID: connection.clientId,
      GOOGLE_CLIENT_SECRET: connection.clientSecret,
    } as SiteInsightsEnv;

    expect(() => getGoogleConnection({} as Project, env)).toThrow("google_connection_not_configured");
  });
});

describe("refreshGoogleAccessToken", () => {
  it("posts form-encoded refresh credentials and returns a safety-adjusted expiry", async () => {
    const now = 1_700_000_000_000;
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    const { fetcher, calls } = fakeFetchSequence([
      Response.json({ access_token: "access-token", expires_in: 3600 }),
    ]);

    const result = await refreshGoogleAccessToken(connection, fetcher);

    expect(result).toEqual({
      accessToken: "access-token",
      expiresAt: now + 3_600_000 - 60_000,
    });
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );

    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "refresh_token",
      client_id: connection.clientId,
      client_secret: connection.clientSecret,
      refresh_token: connection.refreshToken,
    });
    dateNow.mockRestore();
  });

  it("throws a stable sanitized error for non-2xx token responses", async () => {
    const { fetcher } = fakeFetchSequence([
      Response.json(
        {
          error: "invalid_grant",
          error_description: `credential ${connection.refreshToken} was rejected`,
        },
        { status: 400 },
      ),
    ]);

    let caught: unknown;
    try {
      await refreshGoogleAccessToken(connection, fetcher);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GoogleOAuthError);
    expect(caught).toMatchObject({ code: "google_oauth_invalid_grant", status: 400 });
    expect((caught as Error).message).toBe("google_oauth_invalid_grant");
    expect((caught as Error).message).not.toContain(connection.clientSecret);
    expect((caught as Error).message).not.toContain(connection.refreshToken);
  });

  it("distinguishes invalid client credentials without exposing provider details", async () => {
    const { fetcher } = fakeFetchSequence([
      Response.json(
        { error: "invalid_client", error_description: `secret ${connection.clientSecret} rejected` },
        { status: 401 },
      ),
    ]);

    await expect(refreshGoogleAccessToken(connection, fetcher)).rejects.toMatchObject({
      code: "google_oauth_invalid_client",
      status: 401,
      message: "google_oauth_invalid_client",
    });
  });

  it("uses a stable HTTP error for unrecognized provider failures", async () => {
    const { fetcher } = fakeFetchSequence([
      Response.json({ error: "temporarily_unavailable" }, { status: 503 }),
    ]);

    await expect(refreshGoogleAccessToken(connection, fetcher)).rejects.toMatchObject({
      code: "google_oauth_http_error",
      status: 503,
    });
  });

  it("distinguishes token endpoint network failures", async () => {
    const fetcher: typeof fetch = async () => {
      throw new TypeError(`network failed with ${connection.refreshToken}`);
    };

    await expect(refreshGoogleAccessToken(connection, fetcher)).rejects.toMatchObject({
      code: "google_oauth_network_error",
      status: 0,
      message: "google_oauth_network_error",
    });
  });

  it("rejects malformed successful token responses with the stable error", async () => {
    const { fetcher } = fakeFetchSequence([
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);

    await expect(refreshGoogleAccessToken(connection, fetcher)).rejects.toMatchObject({
      code: "google_oauth_invalid_response",
      status: 502,
    });
  });

  it("rejects successful responses that do not contain a usable token", async () => {
    const { fetcher } = fakeFetchSequence([
      Response.json({ token_type: "Bearer", expires_in: 3600 }),
    ]);

    await expect(refreshGoogleAccessToken(connection, fetcher)).rejects.toMatchObject({
      code: "google_oauth_invalid_response",
      status: 502,
    });
  });
});
