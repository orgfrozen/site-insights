import type { SiteInsightsEnv } from "../env";

export type ConfigurationPresence = {
  googleClientId: boolean;
  googleClientSecret: boolean;
  googleRefreshToken: boolean;
  adminApiToken: boolean;
  readApiToken: boolean;
  patchsyncStatusBaseUrl: boolean;
  patchsyncStatusToken: boolean;
  patchsyncStatusAgentId: boolean;
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
    patchsyncStatusBaseUrl: isConfigured(env.PATCHSYNC_STATUS_BASE_URL),
    patchsyncStatusToken: isConfigured(env.PATCHSYNC_STATUS_TOKEN),
    patchsyncStatusAgentId: isConfigured(env.PATCHSYNC_STATUS_AGENT_ID),
  };
}

export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  }));
}
