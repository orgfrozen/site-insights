import type { GoogleConnection } from "./google-connection";

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
}

export interface GoogleAccessToken {
  accessToken: string;
  expiresAt: number;
}

export class GoogleOAuthError extends Error {
  constructor(
    public readonly code: "google_oauth_failed",
    public readonly status: number,
  ) {
    super(code);
    this.name = "GoogleOAuthError";
  }
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

  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new GoogleOAuthError("google_oauth_failed", response.status);
  }

  let json: TokenResponse;
  try {
    json = await response.json<TokenResponse>();
  } catch {
    throw new GoogleOAuthError("google_oauth_failed", 502);
  }

  if (
    typeof json.access_token !== "string" ||
    json.access_token.length === 0 ||
    typeof json.expires_in !== "number" ||
    !Number.isFinite(json.expires_in) ||
    json.expires_in <= 0
  ) {
    throw new GoogleOAuthError("google_oauth_failed", 502);
  }

  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 - 60_000,
  };
}
