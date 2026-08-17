import { runScheduledCollection } from "./collection/scheduler";
import type { SiteInsightsEnv } from "./env";
import { routeRequest } from "./http/router";

export default {
  async fetch(request: Request, env: SiteInsightsEnv, ctx: ExecutionContext): Promise<Response> {
    return routeRequest(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: SiteInsightsEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledCollection(env));
  },
};
