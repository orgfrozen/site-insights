import type { SiteInsightsEnv } from "./env";
import { routeRequest } from "./http/router";

export default {
  async fetch(request: Request, env: SiteInsightsEnv, ctx: ExecutionContext): Promise<Response> {
    return routeRequest(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, _env: SiteInsightsEnv, _ctx: ExecutionContext): Promise<void> {
    // Phase 1 scheduler wiring is implemented in a later task.
  },
};
