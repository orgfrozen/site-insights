import type { Project } from "../domain/types";
import type { SiteInsightsEnv } from "../env";

export interface GoogleConnection {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function getGoogleConnection(_project: Project, env: SiteInsightsEnv): GoogleConnection {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error("google_connection_not_configured");
  }

  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GOOGLE_REFRESH_TOKEN,
  };
}
