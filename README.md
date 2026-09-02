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

Google OAuth, Search Console collection, scheduler orchestration, reporting aggregation, and daily PatchSync Task dispatch are implemented in source. Production deployment, real GSC smoke tests, and production PatchSync credentials/configuration remain environment tasks.

## Requirements

- Node.js 22+
- npm
- Cloudflare account
- Wrangler login for remote D1 creation/deployment

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

## Create the D1 database

`wrangler.jsonc` intentionally contains this bootstrap placeholder:

```json
"database_id": "00000000-0000-0000-0000-000000000000"
```

Create the real database:

```bash
npx wrangler login
npx wrangler d1 create site-insights
```

Copy the returned UUID into `wrangler.jsonc`, replacing the all-zero placeholder.

Then apply migrations:

```bash
npx wrangler d1 migrations apply site-insights --local
npx wrangler d1 migrations apply site-insights --remote
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

## Configure PatchSync Status daily analysis dispatch

After each scheduled collection finishes for an enabled Project—and after an authenticated manual GSC collection finishes—site-insights always freezes one Daily Analysis Snapshot for that Project's local calendar date and dispatches one source-aware Task to patchsync-status. There is no "is this worth analyzing?" gate. The deterministic `source_ref` is `site-insights:<project_id>:daily:<YYYY-MM-DD>`, so repeated Cron runs reconcile the same Task instead of creating duplicates. Collection failures/partial runs still produce a Task so the code agent can analyze stale/missing data and source health explicitly.

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

Open the printed Google authorization URL, sign in with the account that owns the required Search Console properties, and complete consent. The helper prints the refresh token once to the local terminal. Store the three Google values as Worker secrets; do not put them in `.dev.vars` on shared machines or commit them:

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

Read-only `/v1/*` routing is protected now; reporting endpoints are added later in Phase 1.

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
