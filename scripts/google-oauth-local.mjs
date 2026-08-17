import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const HOST = "127.0.0.1";
const PORT = 53682;
const REDIRECT_URI = `http://${HOST}:${PORT}/callback`;
const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

if (!clientId || !clientSecret) {
  console.error("Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in the current shell.");
  process.exit(1);
}

const state = randomBytes(32).toString("hex");
const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
authorizationUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: "true",
  scope: SCOPE,
  state,
}).toString();

let finished = false;
let server;

async function exchangeCode(code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`google_oauth_exchange_failed:${response.status}`);
  }

  const token = await response.json();
  if (typeof token.refresh_token !== "string" || token.refresh_token.length === 0) {
    throw new Error("google_oauth_refresh_token_missing");
  }

  return token.refresh_token;
}

function finish(exitCode) {
  if (finished) return;
  finished = true;
  server.close(() => {
    process.exitCode = exitCode;
  });
}

server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", REDIRECT_URI);
    if (url.pathname !== "/callback") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found\n");
      return;
    }

    if (url.searchParams.get("state") !== state) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("OAuth state mismatch. Return to the terminal.\n");
      console.error("Google OAuth failed: oauth_state_mismatch");
      finish(1);
      return;
    }

    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Google authorization was not completed. Return to the terminal.\n");
      console.error(`Google OAuth failed: ${oauthError}`);
      finish(1);
      return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end("Missing authorization code. Return to the terminal.\n");
      console.error("Google OAuth failed: authorization_code_missing");
      finish(1);
      return;
    }

    const refreshToken = await exchangeCode(code);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Authorization complete. The refresh token was printed to your terminal.\n");

    console.log("\nGOOGLE_REFRESH_TOKEN (copy this once into `wrangler secret put GOOGLE_REFRESH_TOKEN`):");
    console.log(refreshToken);
    finish(0);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Google OAuth token exchange failed. Return to the terminal.\n");
    const message = error instanceof Error ? error.message : "google_oauth_unknown_error";
    console.error(`Google OAuth failed: ${message}`);
    finish(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log("Open this URL in a browser using the Google account that owns your Search Console properties:\n");
  console.log(authorizationUrl.toString());
  console.log("\nThe OAuth client must authorize this exact redirect URI:");
  console.log(REDIRECT_URI);
});

server.on("error", (error) => {
  console.error(`Unable to start local OAuth listener: ${error.message}`);
  process.exitCode = 1;
});
