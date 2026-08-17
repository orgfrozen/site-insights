import type { SiteInsightsEnv } from "../env";

export type ConfigurationPresence = {
  googleClientId: boolean;
  googleClientSecret: boolean;
  googleRefreshToken: boolean;
  adminApiToken: boolean;
  readApiToken: boolean;
};

function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function configurationPresence(env: SiteInsightsEnv): ConfigurationPresence {
  return {
    googleClientId: isConfigured(env.GOOGLE_CLIENT_ID),
    googleClientSecret: isConfigured(env.GOOGLE_CLIENT_SECRET),
    googleRefreshToken: isConfigured(env.GOOGLE_REFRESH_TOKEN),
    adminApiToken: isConfigured(env.ADMIN_API_TOKEN),
    readApiToken: isConfigured(env.READ_API_TOKEN),
  };
}

export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  }));
}
