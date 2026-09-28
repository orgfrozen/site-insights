# site-insights

Multi-site SEO / growth data foundation for Cloudflare Workers.

This repository is the initialized Phase 1 foundation. It currently includes:

- Cloudflare Worker entry point and public `GET /health`
- Cloudflare D1 schema for projects, core URLs, GSC metrics, URL inspections, sitemap snapshots, collection runs, and frozen daily analysis snapshots
- Multi-site Project Registry repository and admin API
- Separate admin/read-only Bearer-token boundaries
- Validation for project domains, HTTPS URLs, sitemap/robots hosts, languages, and core URLs
- Phase 1 architecture, implementation plan, and Master Map
- Daily Site Insights snapshot generation and PatchSync Status Task dispatch after each scheduled Project collection

Google OAuth, Search Console collection, scheduler orchestration, reporting aggregation, daily PatchSync Task dispatch, and GitHub → Cloudflare deployment automation are implemented in source. The first production GitHub run, real GSC smoke tests, and production runtime credentials/configuration remain environment tasks.

## Requirements

- Node.js 22+
- npm
- Cloudflare account
- GitHub repository with Actions enabled
- Cloudflare API token with Workers Scripts Edit and D1 Edit permissions

## Install

```bash
node --version   # must be v22+
npm install
```

The test/tooling stack is pinned to one verified compatibility line instead of using broad ranges:

- `vitest 4.1.10`
- `@cloudflare/vitest-pool-workers 0.20.1`
- `wrangler 4.118.0`
- `typescript 5.9.3`
- `@types/node 22.20.1`

The original bootstrap used `@cloudflare/vitest-pool-workers ^0.9.0`. Because this package is pre-1.0, npm interprets that range as `>=0.9.0 <0.10.0`, which selects the old Vitest 2/3-compatible line and conflicts with Vitest 4. The pinned versions above avoid that mismatch and prevent unexpected install drift before a lockfile exists.

The first install also creates `package-lock.json`. The generated source package may not include it if dependencies could not be downloaded in the build environment.

## Deploy to Cloudflare from GitHub

Production deploys are automated by `.github/workflows/deploy-cloudflare.yml`. Pushes to `main` and manual `workflow_dispatch` runs execute this order:

```text
npm ci
npm test
ensure/reuse D1 database
apply remote D1 migrations
deploy Worker
```

Configure these GitHub Actions repository secrets before the first run:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
```

The Cloudflare API token needs account-scoped **Workers Scripts Edit** and **D1 Edit** permissions. Keep the token in GitHub Secrets; never commit it.

### Automatic D1 bootstrap

`wrangler.jsonc` intentionally keeps the bootstrap placeholder:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

Do **not** replace that UUID in Git. During each deploy, `scripts/ensure-cloudflare-d1.mjs` calls the Cloudflare D1 API using the GitHub secrets above:

1. Query the account for a database named `site-insights`.
2. Reuse it when exactly one matching database exists.
3. Create `site-insights` only when no match exists.
4. Render `wrangler.deploy.jsonc` in the repository root with the real UUID. The generated file is gitignored and exists only for that deployment.
5. Run remote migrations with the generated config.
6. Deploy the Worker with the same generated config.

This keeps D1 creation idempotent and avoids maintaining a production UUID in source control. A concurrent first-deploy create race is reconciled by re-querying the named database before failing.

For a local CI-style bootstrap, use Cloudflare API credentials in the environment:

```bash
export CLOUDFLARE_ACCOUNT_ID='...'
export CLOUDFLARE_API_TOKEN='...'
node scripts/ensure-cloudflare-d1.mjs
npx wrangler d1 migrations apply site-insights --remote --config wrangler.deploy.jsonc
npx wrangler deploy --config wrangler.deploy.jsonc
```

For local-only D1 development, Wrangler still supports the local database without a production UUID:

```bash
npx wrangler d1 migrations apply site-insights --local
```

## Configure API tokens

Generate two independent random tokens. The admin token can mutate project configuration. The read token is reserved for reporting consumers such as ChatGPT scheduled reports.

```bash
openssl rand -hex 32
openssl rand -hex 32

npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put READ_API_TOKEN
```

Do not commit real token values.

These are Cloudflare Worker runtime secrets, separate from the two GitHub deployment secrets. `wrangler deploy` preserves existing Worker secrets; configure them once with Wrangler or the Cloudflare dashboard.

## Configure PatchSync Status daily analysis dispatch

After each scheduled collection finishes for an enabled Project—and after an authenticated manual GSC collection finishes—site-insights always freezes one Daily Analysis Snapshot for that Project's local calendar date and dispatches one source-aware Task to patchsync-status. There is no "is this worth analyzing?" gate. The deterministic `source_ref` is `site-insights:<project_id>:daily:<YYYY-MM-DD>`, so repeated Cron runs reconcile the same Task instead of creating duplicates. Collection failures/partial runs still produce a Task so the code agent can analyze stale/missing data and source health explicitly. If that same-day snapshot later upgrades to `succeeded` while the original Task is still open, site-insights attaches upgrade Evidence to that Task. If the original Task already completed, site-insights keeps the Evidence on the completed Task and creates one deterministic `:succeeded-refresh` child Task so the final facts are actually re-analyzed without reopening terminal history.

Manual collection responses expose Daily Analysis dispatch and lifecycle state separately. `analysisTask.status` remains a backward-compatible alias for dispatch success/failure; prefer `analysisTask.dispatchStatus` for that meaning. `analysisTask.taskStatus` is the current PatchSync Task lifecycle status when it can be observed (`ready`, `claimed`, `completed`, etc.), or `null` when lifecycle lookup is unavailable. `created` only reports whether this dispatch created a new Task rather than reconciling an existing one.

Configure the control-plane endpoint, its bearer token, and the Agent that should receive the ready Task:

```bash
npx wrangler secret put PATCHSYNC_STATUS_BASE_URL
npx wrangler secret put PATCHSYNC_STATUS_TOKEN
npx wrangler secret put PATCHSYNC_STATUS_AGENT_ID
```

`PATCHSYNC_STATUS_TOKEN` must be the patchsync-status `CONTROL_PLANE_TOKEN`. `PATCHSYNC_STATUS_AGENT_ID` should be a registered Agent ID such as the Browser Runner Agent. Real values must not be committed. When any of these three settings is missing, GSC collection still completes, the frozen snapshot is retained in D1, and dispatch is recorded as `patchsync_configuration_missing` instead of failing the collector.

The generated Task embeds a compact Markdown snapshot containing 7/28-day comparisons, top queries/pages/query→page pairs, country/device breakdowns, core URL indexing, sitemaps, and collection health. The Task instructs the code agent to inspect the latest exported source and choose at most one highest-value action. If the data/source does not justify a code change, it explicitly allows a no-Patch analysis conclusion instead of forcing a modification.

For local development, create `.dev.vars` (already ignored by git):

```dotenv
ADMIN_API_TOKEN=replace-with-local-admin-token
READ_API_TOKEN=replace-with-local-read-token
PATCHSYNC_STATUS_BASE_URL=https://your-patchsync-status.example
PATCHSYNC_STATUS_TOKEN=replace-with-local-control-plane-token
PATCHSYNC_STATUS_AGENT_ID=your-agent-id
```

## Configure Google Search Console OAuth

Phase 1 uses one Google account for all configured Search Console properties and requests only the read-only Search Console scope. Create a Google OAuth **Web application** client, enable the Search Console API, and register this exact redirect URI:

```text
http://127.0.0.1:53682/callback
```

Run the one-time local authorization helper from a trusted terminal:

```bash
export GOOGLE_CLIENT_ID='your-google-oauth-client-id'
export GOOGLE_CLIENT_SECRET='your-google-oauth-client-secret'
node scripts/google-oauth-local.mjs
```

Open the printed Google authorization URL, sign in with the account that owns the required Search Console properties, and complete consent. The helper prints the refresh token once to the local terminal.

If the browser can reach Google but the helper reports `google_oauth_network_error`, Node may not be using the machine's HTTP proxy. Configure proxy environment variables for the terminal, keep the loopback callback out of the proxy, and opt Node into environment-proxy handling:

```bash
export HTTP_PROXY='http://127.0.0.1:<proxy-port>'
export HTTPS_PROXY='http://127.0.0.1:<proxy-port>'
export NO_PROXY='127.0.0.1,localhost'
node --use-env-proxy scripts/google-oauth-local.mjs
```

Store the three Google values as Worker secrets; do not put them in `.dev.vars` on shared machines or commit them:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
```

The Worker refreshes short-lived Google access tokens at runtime. Google credentials are never stored in D1.

## Run checks

Once npm dependencies are installed:

```bash
npm run types
npm run typecheck
npm run test:deploy-bootstrap
npm test
```

Run locally:

```bash
npm run dev
```

## Current API

Public:

```text
GET /health
```

Admin, using `Authorization: Bearer <ADMIN_API_TOKEN>`:

`GET /v1/admin/diagnostics` actively probes both D1 and the Google OAuth refresh flow. The response only exposes sanitized health state/error codes and configuration-presence booleans; it never returns credentials or access tokens.

```text
GET   /v1/admin/diagnostics
POST  /v1/admin/projects
GET   /v1/admin/projects
GET   /v1/admin/projects/:id
PATCH /v1/admin/projects/:id
PUT   /v1/admin/projects/:id/core-urls
POST  /v1/admin/projects/:id/enable
POST  /v1/admin/projects/:id/disable
```

Read-only `/v1/*` routing is protected with `Authorization: Bearer <READ_API_TOKEN>`. Project status includes machine-readable collection health so operators and Daily Analysis can distinguish stale-data risk from a real site regression:

```text
GET /v1/projects/:id/status
```

`collectionHealth.status` is `healthy`, `warning`, `critical`, or `unknown`. Shared Google OAuth failures and all-source failures are critical immediately; a source whose two latest runs both failed is also critical until a successful run clears the repeated-failure condition. A source left in `running` for more than one hour is treated as `critical` with reason `collection_stuck` and listed in `collectionHealth.stuckSources`, which catches interrupted Worker executions that never reached run finalization. Because production collection is scheduled daily, a latest successful source run older than 36 hours is also treated as stale: one or two stale sources produce `warning`, while all three stale sources produce `critical`, with the machine-readable sources listed in `collectionHealth.staleSources`. This prevents a stopped Cron from leaving collection health permanently green. Daily Snapshots surface non-healthy collection state before SEO metrics.

## Example: create ZeroParse

```bash
curl -X POST 'http://localhost:8787/v1/admin/projects' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "zeroparse",
    "name": "ZeroParse",
    "domain": "zeroparse.com",
    "baseUrl": "https://zeroparse.com",
    "timezone": "Asia/Shanghai",
    "gscProperty": "sc-domain:zeroparse.com",
    "robotsUrl": "https://zeroparse.com/robots.txt",
    "sitemapUrls": ["https://zeroparse.com/sitemap.xml"],
    "primaryLanguage": "en",
    "languages": ["en", "zh"]
  }'
```

Add its core URLs:

```bash
curl -X PUT 'http://localhost:8787/v1/admin/projects/zeroparse/core-urls' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": [
      {"url":"https://zeroparse.com/","pageType":"home","priority":10,"inspectionEnabled":true},
      {"url":"https://zeroparse.com/json-viewer","pageType":"tool","priority":20,"inspectionEnabled":true},
      {"url":"https://zeroparse.com/json-formatter","pageType":"tool","priority":30,"inspectionEnabled":true},
      {"url":"https://zeroparse.com/jsonl-viewer","pageType":"tool","priority":40,"inspectionEnabled":true},
      {"url":"https://zeroparse.com/big-json-viewer","pageType":"tool","priority":50,"inspectionEnabled":true}
    ]
  }'
```

## Security model

- Google credentials will live only in Cloudflare Worker Secrets.
- Admin and read-only consumers use different API tokens.
- D1 stores site configuration and collected facts, never Google client secrets or refresh tokens.
- `.dev.vars`, `.env*`, `node_modules`, and Wrangler local state are ignored.

## Project tracking

See:

- `MASTER_MAP.md`
- `docs/superpowers/specs/2026-08-17-site-insights-design.md`
- `docs/superpowers/plans/2026-08-17-phase-1-gsc-foundation.md`

### Structured collection health

Manual GSC collection responses now include the same `collectionHealth` object exposed by the read-only status API. Scheduled collection also records per-project structured health in the `scheduled_collection_project_finished` log event and returns aggregate `healthy` / `warning` / `critical` / `unknown` counts from the scheduler. Daily snapshot JSON and succeeded-snapshot upgrade evidence carry the structured health object as well, so automation does not need to parse the Markdown alert text to distinguish collector failures from target-site changes.

Collection recovery is also explicit: a real `warning`/`critical` → `healthy` transition produces a structured `collectionRecovery` object in manual collection responses, scheduler logs/summary, daily snapshot JSON, and succeeded-snapshot upgrade evidence. The first `unknown` → `healthy` collection is not treated as a recovery.
