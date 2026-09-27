import type { GoogleConnection } from "./google-connection";

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

interface TokenErrorResponse {
  error?: unknown;
}

export type GoogleOAuthErrorCode =
  | "google_oauth_invalid_grant"
  | "google_oauth_invalid_client"
  | "google_oauth_http_error"
  | "google_oauth_network_error"
  | "google_oauth_invalid_response";

export interface GoogleAccessToken {
  accessToken: string;
  expiresAt: number;
}

export class GoogleOAuthError extends Error {
  constructor(
    public readonly code: GoogleOAuthErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "GoogleOAuthError";
  }
}

async function oauthErrorCode(response: Response): Promise<GoogleOAuthErrorCode> {
  let json: TokenErrorResponse;
  try {
    json = await response.json() as TokenErrorResponse;
  } catch {
    return "google_oauth_http_error";
  }

  if (json.error === "invalid_grant") return "google_oauth_invalid_grant";
  if (json.error === "invalid_client") return "google_oauth_invalid_client";
  return "google_oauth_http_error";
}

export async function refreshGoogleAccessToken(
  connection: GoogleConnection,
  fetcher: typeof fetch = fetch,
): Promise<GoogleAccessToken> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: connection.clientId,
    client_secret: connection.clientSecret,
    refresh_token: connection.refreshToken,
  });

  let response: Response;
  try {
    response = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new GoogleOAuthError("google_oauth_network_error", 0);
  }

  if (!response.ok) {
    throw new GoogleOAuthError(await oauthErrorCode(response), response.status);
  }

  let json: TokenResponse;
  try {
    json = await response.json() as TokenResponse;
  } catch {
    throw new GoogleOAuthError("google_oauth_invalid_response", 502);
  }

  if (
    typeof json.access_token !== "string" ||
    json.access_token.length === 0 ||
    typeof json.expires_in !== "number" ||
    !Number.isFinite(json.expires_in) ||
    json.expires_in <= 0
  ) {
    throw new GoogleOAuthError("google_oauth_invalid_response", 502);
  }

  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 - 60_000,
  };
}
