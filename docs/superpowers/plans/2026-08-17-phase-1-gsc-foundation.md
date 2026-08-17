# site-insights Phase 1 GSC Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deployable `site-insights` service so ZeroParse and VetaTool can be configured in one Cloudflare Worker, collect real Google Search Console data into D1, expose authenticated status APIs, and run automatically on a daily schedule.

**Architecture:** A single TypeScript Cloudflare Worker handles HTTP and Cron events. Project configuration, GSC snapshots, URL inspection results, sitemap snapshots, and collection-run logs live in D1. Google OAuth credentials stay in Worker secrets; the Worker calls Google REST APIs directly, keeps collection logic isolated per source/project, and exposes separate admin and read-only Bearer-token surfaces.

**Tech Stack:** Cloudflare Workers ES modules, TypeScript, Wrangler, Cloudflare D1, Cloudflare Cron Triggers, Vitest 4.1+ with `@cloudflare/vitest-pool-workers`, Google OAuth 2.0 REST endpoints, Google Search Console Search Analytics/Sitemaps/URL Inspection REST APIs.

## Global Constraints

- One deployment supports multiple sites; projects are configuration, not separate Workers.
- Phase 1 supports one Google account/OAuth connection across all GSC properties.
- Google OAuth scope is exactly `https://www.googleapis.com/auth/webmasters.readonly`.
- Google `client_id`, `client_secret`, and `refresh_token` are Worker secrets and are never persisted in D1.
- Reporting APIs are read-only and use a separate Bearer token from administrative APIs.
- Search Analytics uses finalized data by default and stores historical snapshots.
- Phase 1 retention policy is append/retain: no automated snapshot deletion; retention automation is deferred until backup/export policy is implemented.
- A failed project or GSC source must not block collection for another project/source.
- Phase 1 does not implement GA4, Cloudflare Analytics, crawling, PageSpeed, ranking providers, notifications, dashboard, recommendations, or automatic site modification.
- No source file should combine HTTP routing, Google API calls, D1 persistence, and orchestration responsibilities.
- Every implementation task follows TDD: failing test, minimal implementation, passing test, commit.

---

## File Structure

Create the Phase 1 repository around these units:

```text
site-insights/
├── .gitignore
├── package.json
├── package-lock.json
├── tsconfig.json
├── wrangler.jsonc
├── worker-configuration.d.ts
├── vitest.config.ts
├── migrations/
│   ├── 0001_projects.sql
│   ├── 0002_gsc_metrics.sql
│   └── 0003_collection_runs.sql
├── scripts/
│   └── google-oauth-url.mjs
├── src/
│   ├── index.ts
│   ├── env.ts
│   ├── domain/
│   │   └── types.ts
│   ├── http/
│   │   ├── auth.ts
│   │   ├── response.ts
│   │   └── router.ts
│   ├── observability/
│   │   └── logger.ts
│   ├── projects/
│   │   ├── project-repository.ts
│   │   ├── project-service.ts
│   │   └── project-routes.ts
│   ├── google/
│   │   ├── google-connection.ts
│   │   └── oauth.ts
│   ├── gsc/
│   │   ├── dates.ts
│   │   ├── search-analytics-client.ts
│   │   ├── search-analytics-repository.ts
│   │   ├── search-analytics-collector.ts
│   │   ├── url-inspection-client.ts
│   │   ├── url-inspection-repository.ts
│   │   ├── url-inspection-collector.ts
│   │   ├── sitemap-client.ts
│   │   ├── sitemap-repository.ts
│   │   └── sitemap-collector.ts
│   ├── collection/
│   │   ├── run-repository.ts
│   │   ├── gsc-orchestrator.ts
│   │   └── scheduler.ts
│   └── reporting/
│       ├── status-repository.ts
│       └── status-routes.ts
└── test/
    ├── setup.ts
    ├── tsconfig.json
    ├── helpers/
    │   ├── db.ts
    │   └── fake-fetch.ts
    ├── health.test.ts
    ├── auth.test.ts
    ├── projects.test.ts
    ├── google-oauth.test.ts
    ├── gsc-dates.test.ts
    ├── gsc-search-analytics-client.test.ts
    ├── gsc-search-analytics-collector.test.ts
    ├── gsc-url-inspection.test.ts
    ├── gsc-sitemaps.test.ts
    ├── collection-orchestrator.test.ts
    ├── scheduler.test.ts
    └── status-api.test.ts
```

The top-level modules have these boundaries:

- `src/http/*`: authentication, route matching, JSON responses only.
- `src/projects/*`: project/core-URL validation and D1 access.
- `src/google/*`: one-account credential abstraction and access-token refresh only.
- `src/gsc/*`: Search Console API calls, normalization, and per-source persistence.
- `src/collection/*`: source/project execution state, isolation, and Cron scheduling.
- `src/reporting/*`: read-only aggregation of stored facts; no Google API calls.
- `src/observability/*`: structured log events without secrets.

---

### Task 1: Scaffold the Worker and Cloudflare-native test runtime

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Generate: `worker-configuration.d.ts`
- Create: `vitest.config.ts`
- Create: `test/tsconfig.json`
- Create: `src/index.ts`
- Create: `src/env.ts`
- Create: `src/http/response.ts`
- Create: `test/health.test.ts`

**Interfaces:**
- Produces: Worker default export with `fetch(request, env, ctx)` and `scheduled(controller, env, ctx)` handlers.
- Produces: `jsonResponse(body: unknown, status?: number): Response`.
- Produces: generated `Env` binding type used by every later task.

- [ ] **Step 1: Create ignore rules before any local credentials exist**

Create `.gitignore`:

```gitignore
node_modules/
.wrangler/
.dev.vars
.dev.vars.*
.env
.env.*
```

- [ ] **Step 2: Create package metadata and scripts**

Use Node 22+ for local tooling and keep runtime code Worker-native.

```json
{
  "name": "site-insights",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "types": "wrangler types",
    "typecheck": "npm run types && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.9.0",
    "typescript": "^5.9.0",
    "vitest": "^4.1.0",
    "wrangler": "^4.0.0"
  }
}
```

Run:

```bash
npm install
```

- [ ] **Step 3: Configure Wrangler with D1 binding name and daily Cron**

Create `wrangler.jsonc` initially without a `database_id`; Task 2 creates the database and immediately fills the emitted ID.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "site-insights",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-17",
  "triggers": {
    "crons": ["0 23 * * *"]
  },
  "vars": {
    "GSC_INITIAL_BACKFILL_DAYS": "56",
    "GSC_REFRESH_DAYS": "3",
    "GSC_INSPECTION_CONCURRENCY": "3"
  },
  "d1_databases": []
}
```

Cloudflare Cron expressions are UTC. `23:00 UTC` runs before the user's 09:00 reporting window in both UTC+8 and Japan time.

- [ ] **Step 4: Configure TypeScript and Workers Vitest integration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": ["./worker-configuration.d.ts"],
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts", "worker-configuration.d.ts"]
}
```

Create `vitest.config.ts`:

```ts
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
});
```

Create `test/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "types": ["@cloudflare/vitest-pool-workers/types", "../worker-configuration.d.ts"]
  },
  "include": ["./**/*.ts", "../worker-configuration.d.ts"]
}
```

- [ ] **Step 5: Write the first failing health test**

Create `test/health.test.ts`:

```ts
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("returns a minimal public health response", async () => {
    const response = await exports.default.fetch("https://site-insights.test/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "site-insights",
    });
  });
});
```

- [ ] **Step 6: Run the test and verify it fails**

Run:

```bash
npm test -- test/health.test.ts
```

Expected: FAIL because the Worker entry point does not exist.

- [ ] **Step 7: Implement the minimal Worker entry point**

Create `src/http/response.ts`:

```ts
export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
```

Create `src/env.ts`:

```ts
export type SiteInsightsEnv = Env & {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  ADMIN_API_TOKEN?: string;
  READ_API_TOKEN?: string;
  GSC_INITIAL_BACKFILL_DAYS: string;
  GSC_REFRESH_DAYS: string;
  GSC_INSPECTION_CONCURRENCY: string;
};
```

Create `src/index.ts`:

```ts
import type { SiteInsightsEnv } from "./env";
import { jsonResponse } from "./http/response";

export default {
  async fetch(request: Request, _env: SiteInsightsEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "site-insights",
        timestamp: new Date().toISOString(),
      });
    }
    return jsonResponse({ error: "not_found" }, 404);
  },

  async scheduled(): Promise<void> {
    // Task 13 wires scheduled collection.
  },
};
```

- [ ] **Step 8: Generate binding types and verify scaffold**

Run:

```bash
npm run types
npm run typecheck
npm test -- test/health.test.ts
```

Expected: all commands PASS.

- [ ] **Step 9: Commit the scaffold**

```bash
git add .gitignore package.json package-lock.json tsconfig.json wrangler.jsonc worker-configuration.d.ts vitest.config.ts test/tsconfig.json src/index.ts src/env.ts src/http/response.ts test/health.test.ts
git commit -m "chore: scaffold site-insights worker"
```

---

### Task 2: Create the Phase 1 D1 schema and migration test setup

**Files:**
- Create: `migrations/0001_projects.sql`
- Create: `migrations/0002_gsc_metrics.sql`
- Create: `migrations/0003_collection_runs.sql`
- Create: `test/setup.ts`
- Modify: `vitest.config.ts`
- Modify: `wrangler.jsonc`
- Create: `test/projects.test.ts`

**Interfaces:**
- Produces D1 binding: `env.DB: D1Database`.
- Produces tables: `projects`, `project_core_urls`, `gsc_daily_metrics`, `gsc_query_metrics`, `gsc_page_metrics`, `gsc_query_page_metrics`, `gsc_country_metrics`, `gsc_device_metrics`, `url_inspections`, `sitemap_snapshots`, `collection_runs`.

- [ ] **Step 1: Create the real D1 database and bind it**

Run once from the repository root:

```bash
npx wrangler d1 create site-insights
```

Edit `wrangler.jsonc` immediately after the command succeeds. Add one D1 binding with `binding` set to `DB`, `database_name` set to `site-insights`, `migrations_dir` set to `migrations`, and `database_id` set to the exact UUID emitted by the command. Do not commit the configuration until that real UUID is present.

- [ ] **Step 2: Write the projects migration**

Create `migrations/0001_projects.sql`:

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  gsc_property TEXT NOT NULL UNIQUE,
  ga_property TEXT,
  cloudflare_zone_id TEXT,
  robots_url TEXT NOT NULL,
  sitemap_urls_json TEXT NOT NULL DEFAULT '[]',
  primary_language TEXT NOT NULL DEFAULT 'en',
  languages_json TEXT NOT NULL DEFAULT '["en"]',
  canonical_host TEXT NOT NULL,
  include_www INTEGER NOT NULL DEFAULT 0 CHECK (include_www IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE project_core_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'core',
  priority INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  inspection_enabled INTEGER NOT NULL DEFAULT 1 CHECK (inspection_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, url)
);

CREATE INDEX idx_project_core_urls_project_enabled
  ON project_core_urls(project_id, enabled, inspection_enabled);
```

- [ ] **Step 3: Write the GSC metrics migration**

Create `migrations/0002_gsc_metrics.sql`:

```sql
CREATE TABLE gsc_daily_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type)
);

CREATE TABLE gsc_query_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  query TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, query)
);

CREATE TABLE gsc_page_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  page TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, page)
);

CREATE TABLE gsc_query_page_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  query TEXT NOT NULL,
  page TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, query, page)
);

CREATE TABLE gsc_country_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  country TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, country)
);

CREATE TABLE gsc_device_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  device TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, device)
);

CREATE TABLE url_inspections (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  inspected_at TEXT NOT NULL,
  verdict TEXT,
  coverage_state TEXT,
  indexing_state TEXT,
  robots_txt_state TEXT,
  page_fetch_state TEXT,
  google_canonical TEXT,
  user_canonical TEXT,
  last_crawl_time TEXT,
  crawled_as TEXT,
  referring_urls_json TEXT NOT NULL DEFAULT '[]',
  sitemaps_json TEXT NOT NULL DEFAULT '[]',
  mobile_usability_json TEXT NOT NULL DEFAULT '{}',
  rich_results_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL,
  PRIMARY KEY(project_id, url, inspected_at)
);

CREATE INDEX idx_url_inspections_latest
  ON url_inspections(project_id, url, inspected_at DESC);

CREATE TABLE sitemap_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  last_submitted TEXT,
  last_downloaded TEXT,
  is_pending INTEGER,
  is_sitemaps_index INTEGER,
  type TEXT,
  errors INTEGER NOT NULL DEFAULT 0,
  warnings INTEGER NOT NULL DEFAULT 0,
  contents_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL,
  PRIMARY KEY(project_id, path, collected_at)
);

CREATE INDEX idx_sitemap_snapshots_latest
  ON sitemap_snapshots(project_id, path, collected_at DESC);

CREATE INDEX idx_gsc_query_metrics_period
  ON gsc_query_metrics(project_id, data_date, impressions DESC);

CREATE INDEX idx_gsc_page_metrics_period
  ON gsc_page_metrics(project_id, data_date, impressions DESC);

CREATE INDEX idx_gsc_country_metrics_period
  ON gsc_country_metrics(project_id, data_date, impressions DESC);

CREATE INDEX idx_gsc_device_metrics_period
  ON gsc_device_metrics(project_id, data_date, impressions DESC);
```

- [ ] **Step 4: Write the collection-run migration**

Create `migrations/0003_collection_runs.sql`:

```sql
CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_written INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX idx_collection_runs_project_source_time
  ON collection_runs(project_id, source, started_at DESC);
```

- [ ] **Step 5: Configure migrations in the Vitest worker pool**

Update `vitest.config.ts`:

```ts
import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
```

Create `test/setup.ts`:

```ts
import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await reset();
  const testEnv = env as typeof env & {
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});
```

- [ ] **Step 6: Write a migration smoke test**

Append to `test/projects.test.ts`:

```ts
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("creates the Phase 1 tables", async () => {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  ).all<{ name: string }>();

  const names = rows.results.map((row) => row.name);
  expect(names).toContain("projects");
  expect(names).toContain("gsc_daily_metrics");
  expect(names).toContain("gsc_country_metrics");
  expect(names).toContain("gsc_device_metrics");
  expect(names).toContain("url_inspections");
  expect(names).toContain("sitemap_snapshots");
  expect(names).toContain("collection_runs");
});
```

- [ ] **Step 7: Run migration and type verification**

Run:

```bash
npm run types
npm run typecheck
npm test -- test/projects.test.ts
```

Expected: PASS.

- [ ] **Step 8: Apply migrations to the local D1 database**

```bash
npx wrangler d1 migrations apply site-insights --local
```

Expected: migrations `0001`, `0002`, and `0003` applied successfully.

- [ ] **Step 9: Commit schema and test setup**

```bash
git add migrations wrangler.jsonc vitest.config.ts test/setup.ts test/projects.test.ts worker-configuration.d.ts
git commit -m "feat: add phase one d1 schema"
```

---

### Task 3: Implement project and core-URL repositories

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/projects/project-repository.ts`
- Modify: `test/projects.test.ts`

**Interfaces:**
- Produces: `Project`, `ProjectCoreUrl`, `ProjectStatus` domain types.
- Produces: `ProjectRepository.createProject(input)`, `getProject(id)`, `listProjects(status?)`, `updateProject(id, patch)`, `setProjectStatus(id, status)`, `replaceCoreUrls(projectId, urls)`, `listCoreUrls(projectId, inspectionOnly?)`.

- [ ] **Step 1: Define domain types in a failing repository test**

Add tests that expect a created project and ordered core URLs:

```ts
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ProjectRepository } from "../src/projects/project-repository";

describe("ProjectRepository", () => {
  it("creates and loads a project with core URLs", async () => {
    const repo = new ProjectRepository(env.DB);
    await repo.createProject({
      id: "zeroparse",
      name: "ZeroParse",
      domain: "zeroparse.com",
      baseUrl: "https://zeroparse.com",
      timezone: "Asia/Shanghai",
      gscProperty: "sc-domain:zeroparse.com",
      robotsUrl: "https://zeroparse.com/robots.txt",
      sitemapUrls: ["https://zeroparse.com/sitemap.xml"],
      primaryLanguage: "en",
      languages: ["en", "zh"],
      canonicalHost: "zeroparse.com",
      includeWww: false,
      gaProperty: null,
      cloudflareZoneId: null,
    });
    await repo.replaceCoreUrls("zeroparse", [
      { url: "https://zeroparse.com/", pageType: "home", priority: 10, inspectionEnabled: true },
      { url: "https://zeroparse.com/big-json-viewer", pageType: "tool", priority: 20, inspectionEnabled: true },
    ]);

    expect(await repo.getProject("zeroparse")).toMatchObject({
      id: "zeroparse",
      status: "enabled",
      gscProperty: "sc-domain:zeroparse.com",
    });
    expect((await repo.listCoreUrls("zeroparse", true)).map((item) => item.url)).toEqual([
      "https://zeroparse.com/",
      "https://zeroparse.com/big-json-viewer",
    ]);
  });
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

```bash
npm test -- test/projects.test.ts
```

Expected: FAIL because `ProjectRepository` is missing.

- [ ] **Step 3: Define domain types**

Create `src/domain/types.ts`:

```ts
export type ProjectStatus = "enabled" | "disabled";

export interface Project {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  timezone: string;
  status: ProjectStatus;
  gscProperty: string;
  gaProperty: string | null;
  cloudflareZoneId: string | null;
  robotsUrl: string;
  sitemapUrls: string[];
  primaryLanguage: string;
  languages: string[];
  canonicalHost: string;
  includeWww: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCoreUrl {
  id: number;
  projectId: string;
  url: string;
  pageType: string;
  priority: number;
  enabled: boolean;
  inspectionEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  domain: string;
  baseUrl: string;
  timezone: string;
  gscProperty: string;
  gaProperty: string | null;
  cloudflareZoneId: string | null;
  robotsUrl: string;
  sitemapUrls: string[];
  primaryLanguage: string;
  languages: string[];
  canonicalHost: string;
  includeWww: boolean;
}

export type UpdateProjectInput = Partial<Omit<CreateProjectInput, "id">>;

export interface ProjectCoreUrlInput {
  url: string;
  pageType: string;
  priority: number;
  enabled?: boolean;
  inspectionEnabled: boolean;
}

export interface ReplaceCoreUrlsInput {
  urls: ProjectCoreUrlInput[];
}
```

- [ ] **Step 4: Implement repository row mapping and CRUD**

Create `src/projects/project-repository.ts` with focused SQL methods:

```ts
export class ProjectRepository {
  constructor(private readonly db: D1Database) {}

  createProject(input: CreateProjectInput): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjects(status?: ProjectStatus): Promise<Project[]>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null>;
  setProjectStatus(id: string, status: ProjectStatus): Promise<Project | null>;
  replaceCoreUrls(projectId: string, urls: ProjectCoreUrlInput[]): Promise<void>;
  listCoreUrls(projectId: string, inspectionOnly?: boolean): Promise<ProjectCoreUrl[]>;
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    baseUrl: row.base_url,
    timezone: row.timezone,
    status: row.status as ProjectStatus,
    gscProperty: row.gsc_property,
    gaProperty: row.ga_property,
    cloudflareZoneId: row.cloudflare_zone_id,
    robotsUrl: row.robots_url,
    sitemapUrls: JSON.parse(row.sitemap_urls_json),
    primaryLanguage: row.primary_language,
    languages: JSON.parse(row.languages_json),
    canonicalHost: row.canonical_host,
    includeWww: row.include_www === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

Use `crypto.randomUUID()` only for run IDs later; project IDs are caller-provided slugs. Normalize D1 integer booleans on read. `replaceCoreUrls()` uses one `DB.batch()` containing the project-scoped delete followed by prepared inserts, and `listCoreUrls()` orders by `priority ASC, url ASC`.

- [ ] **Step 5: Run repository tests**

```bash
npm test -- test/projects.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit repository layer**

```bash
git add src/domain/types.ts src/projects/project-repository.ts test/projects.test.ts
git commit -m "feat: add project repository"
```

---

### Task 4: Add Bearer-token authentication and native routing

**Files:**
- Create: `src/http/auth.ts`
- Create: `src/http/router.ts`
- Modify: `src/index.ts`
- Create: `test/auth.test.ts`

**Interfaces:**
- Produces: `requireReadAuth(request, env): Response | null`.
- Produces: `requireAdminAuth(request, env): Response | null`.
- Produces: `routeRequest(request, env, ctx): Promise<Response>`.
- Read token may access read routes; admin token may access both read and admin routes.

- [ ] **Step 1: Write failing auth tests**

Test these exact cases:

```ts
import { exports } from "cloudflare:workers";

it("rejects a protected read route without a token", async () => {
  const response = await exports.default.fetch("https://site-insights.test/v1/projects");
  expect(response.status).toBe(401);
});

it("rejects an admin route when only the read token is supplied", async () => {
  const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
    headers: { authorization: "Bearer test-read-token" },
  });
  expect(response.status).toBe(403);
});
```

Configure test-only bindings `READ_API_TOKEN=test-read-token` and `ADMIN_API_TOKEN=test-admin-token` in `vitest.config.ts` Miniflare bindings.

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- test/auth.test.ts
```

Expected: FAIL because auth/routing are not implemented.

- [ ] **Step 3: Implement constant-time token comparison and auth helpers**

Create `src/http/auth.ts`:

```ts
import type { SiteInsightsEnv } from "../env";
import { jsonResponse } from "./response";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7);
}

export function requireReadAuth(request: Request, env: SiteInsightsEnv): Response | null {
  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  if (env.READ_API_TOKEN && constantTimeEqual(token, env.READ_API_TOKEN)) return null;
  if (env.ADMIN_API_TOKEN && constantTimeEqual(token, env.ADMIN_API_TOKEN)) return null;
  return jsonResponse({ error: "unauthorized" }, 401);
}

export function requireAdminAuth(request: Request, env: SiteInsightsEnv): Response | null {
  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);
  if (env.ADMIN_API_TOKEN && constantTimeEqual(token, env.ADMIN_API_TOKEN)) return null;
  return jsonResponse({ error: "forbidden" }, 403);
}
```

- [ ] **Step 4: Implement the router shell**

Create `src/http/router.ts` so `/health` remains public, `/v1/admin/*` calls admin auth first, and `/v1/*` calls read auth first:

```ts
export async function routeRequest(
  request: Request,
  env: SiteInsightsEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") return healthResponse();

  if (pathname.startsWith("/v1/admin/")) {
    const rejected = requireAdminAuth(request, env);
    if (rejected) return rejected;
    return jsonResponse({ error: "not_found" }, 404);
  }

  if (pathname.startsWith("/v1/")) {
    const rejected = requireReadAuth(request, env);
    if (rejected) return rejected;
    return jsonResponse({ error: "not_found" }, 404);
  }

  return jsonResponse({ error: "not_found" }, 404);
}
```

Modify `src/index.ts` fetch handler to delegate to `routeRequest(request, env, ctx)`.

- [ ] **Step 5: Run auth and health tests**

```bash
npm test -- test/health.test.ts test/auth.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit auth/routing**

```bash
git add src/http/auth.ts src/http/router.ts src/index.ts vitest.config.ts test/auth.test.ts
git commit -m "feat: add api authentication"
```

---

### Task 5: Implement project validation and admin project APIs

**Files:**
- Create: `src/projects/project-service.ts`
- Create: `src/projects/project-routes.ts`
- Modify: `src/http/router.ts`
- Modify: `test/projects.test.ts`

**Interfaces:**
- Produces admin routes:
  - `POST /v1/admin/projects`
  - `GET /v1/admin/projects`
  - `GET /v1/admin/projects/:id`
  - `PATCH /v1/admin/projects/:id`
  - `PUT /v1/admin/projects/:id/core-urls`
  - `POST /v1/admin/projects/:id/enable`
  - `POST /v1/admin/projects/:id/disable`
- Validation rule: `id` matches `^[a-z0-9][a-z0-9-]{1,62}$`; `baseUrl` is HTTPS; `domain` equals base URL hostname; `gscProperty` starts with `sc-domain:` or `http://`/`https://`; robots/sitemap URLs must be HTTPS on the configured canonical host; language arrays are non-empty BCP-47-like strings.
- Optional future integration identifiers `gaProperty` and `cloudflareZoneId` are stored but unused in Phase 1.

- [ ] **Step 1: Write failing API tests for valid and invalid projects**

Use admin Bearer token and test:

```ts
const validProject = {
  id: "zeroparse",
  name: "ZeroParse",
  domain: "zeroparse.com",
  baseUrl: "https://zeroparse.com",
  timezone: "Asia/Shanghai",
  gscProperty: "sc-domain:zeroparse.com",
  robotsUrl: "https://zeroparse.com/robots.txt",
  sitemapUrls: ["https://zeroparse.com/sitemap.xml"],
  primaryLanguage: "en",
  languages: ["en", "zh"],
};
```

Assertions:
- create returns `201` and project JSON;
- duplicate domain returns `409`;
- HTTP base URL returns `400`;
- domain/base URL mismatch returns `400`;
- replace core URLs rejects URLs outside the project host;
- disable makes the project absent from enabled-project collection queries.

- [ ] **Step 2: Run tests and verify failure**

```bash
npm test -- test/projects.test.ts
```

- [ ] **Step 3: Implement validation service**

Create pure functions in `project-service.ts`:

```ts
export function validateProjectInput(input: unknown): CreateProjectInput;
export function validateProjectPatch(input: unknown): UpdateProjectInput;
export function validateCoreUrls(project: Project, input: unknown): ReplaceCoreUrlsInput;
```

Validate timezones by constructing `new Intl.DateTimeFormat("en-US", { timeZone })` and catching `RangeError`.

- [ ] **Step 4: Implement project route handlers**

Map repository duplicate-constraint failures to `409`; validation errors to `400`; unknown projects to `404`. Never return SQL error text. Route handlers expose this shape:

```ts
export async function handleProjectAdminRoute(
  request: Request,
  env: SiteInsightsEnv,
  params: { projectId?: string; action?: "core-urls" | "enable" | "disable" },
): Promise<Response | null> {
  const repo = new ProjectRepository(env.DB);
  // Parse JSON -> validate -> repository call -> stable JSON response.
  // Return null only when the path/method does not belong to this module.
}
```

Use one `ProjectValidationError` carrying a stable `code` such as `invalid_project_id`, `invalid_base_url`, `domain_mismatch`, or `invalid_core_url`.

- [ ] **Step 5: Register project routes in native router**

Use explicit path regexes, for example:

```ts
const projectMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)$/);
const coreUrlsMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)\/core-urls$/);
```

- [ ] **Step 6: Verify project APIs**

```bash
npm test -- test/projects.test.ts test/auth.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit project API**

```bash
git add src/projects/project-service.ts src/projects/project-routes.ts src/http/router.ts test/projects.test.ts
git commit -m "feat: add project registry api"
```

---

### Task 6: Implement the single-account Google connection abstraction and OAuth refresh

**Files:**
- Create: `src/google/google-connection.ts`
- Create: `src/google/oauth.ts`
- Create: `scripts/google-oauth-local.mjs`
- Create: `test/helpers/fake-fetch.ts`
- Create: `test/google-oauth.test.ts`

**Interfaces:**
- Produces: `GoogleConnection { clientId, clientSecret, refreshToken }`.
- Produces: `getGoogleConnection(project, env): GoogleConnection`.
- Produces: `refreshGoogleAccessToken(connection, fetcher?): Promise<{ accessToken: string; expiresAt: number }>`.
- Future multi-account migration changes only `getGoogleConnection()` and credential storage, not GSC clients.

- [ ] **Step 1: Write failing token-refresh tests**

Test that the function POSTs form-encoded fields to `https://oauth2.googleapis.com/token`, parses `access_token`/`expires_in`, rejects non-2xx responses with a stable `google_oauth_failed` error code, and never includes secrets in the thrown message.

- [ ] **Step 2: Implement a reusable fake fetch helper**

Create `test/helpers/fake-fetch.ts`:

```ts
export interface CapturedRequest {
  input: RequestInfo | URL;
  init?: RequestInit;
}

export function fakeFetchSequence(responses: Response[]) {
  const calls: CapturedRequest[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    const response = responses.shift();
    if (!response) throw new Error("fake_fetch_exhausted");
    return response;
  };
  return { fetcher, calls };
}
```

- [ ] **Step 3: Implement Google connection abstraction**

Create `src/google/google-connection.ts`:

```ts
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
```

- [ ] **Step 4: Implement REST access-token refresh**

Implement `refreshGoogleAccessToken()` with Worker-native `fetch`:

```ts
export async function refreshGoogleAccessToken(
  connection: GoogleConnection,
  fetcher: typeof fetch = fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
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
  if (!response.ok) throw new GoogleOAuthError("google_oauth_failed", response.status);
  const json = await response.json<TokenResponse>();
  if (!json.access_token || !json.expires_in) throw new GoogleOAuthError("google_oauth_failed", 502);
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 - 60_000,
  };
}
```

The thrown error object may retain status/code, but its message must not include request-body contents.

- [ ] **Step 5: Add a one-time local OAuth authorization helper**

Create `scripts/google-oauth-local.mjs`. It must:
1. read `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the current shell environment;
2. listen only on `127.0.0.1:53682`;
3. use redirect URI `http://127.0.0.1:53682/callback`;
4. print an authorization URL with `access_type=offline`, `prompt=consent`, and only the readonly Search Console scope;
5. receive the callback `code`;
6. exchange it at `https://oauth2.googleapis.com/token`;
7. print the returned refresh token once to the local terminal;
8. exit after the callback or on error.

Authorization URL parameters:

```js
const params = new URLSearchParams({
  client_id: process.env.GOOGLE_CLIENT_ID,
  redirect_uri: "http://127.0.0.1:53682/callback",
  response_type: "code",
  access_type: "offline",
  prompt: "consent",
  scope: "https://www.googleapis.com/auth/webmasters.readonly",
});
```

Token exchange body:

```js
const body = new URLSearchParams({
  code,
  client_id: process.env.GOOGLE_CLIENT_ID,
  client_secret: process.env.GOOGLE_CLIENT_SECRET,
  redirect_uri: "http://127.0.0.1:53682/callback",
  grant_type: "authorization_code",
});
```

The Google OAuth client must list `http://127.0.0.1:53682/callback` as an authorized redirect URI. The refresh token is copied directly into `wrangler secret put GOOGLE_REFRESH_TOKEN`; it is never pasted into chat or committed.

- [ ] **Step 6: Verify OAuth unit tests**

```bash
npm test -- test/google-oauth.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit Google connection layer**

```bash
git add src/google scripts/google-oauth-local.mjs test/helpers/fake-fetch.ts test/google-oauth.test.ts
git commit -m "feat: add google oauth connection"
```

---

### Task 7: Implement Search Console date-window logic

**Files:**
- Create: `src/gsc/dates.ts`
- Create: `test/gsc-dates.test.ts`

**Interfaces:**
- Produces: `formatSearchConsoleDate(date: Date): string` using `America/Los_Angeles` calendar date.
- Produces: `subtractDays(dateString, days): string`.
- Produces: `periodEndingOn(endDate, days): { startDate, endDate }`.
- Produces: `comparisonPeriods(latestFinalDate)` for 7d/previous-7d and 28d/previous-28d reporting.

- [ ] **Step 1: Write timezone-boundary failing tests**

Cover an instant where UTC and Pacific dates differ:

```ts
expect(formatSearchConsoleDate(new Date("2026-08-17T03:00:00Z"))).toBe("2026-08-16");
```

Also assert exact periods for latest final date `2026-08-15`:

```ts
expect(comparisonPeriods("2026-08-15").last7).toEqual({
  startDate: "2026-08-09",
  endDate: "2026-08-15",
});
expect(comparisonPeriods("2026-08-15").previous7).toEqual({
  startDate: "2026-08-02",
  endDate: "2026-08-08",
});
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- test/gsc-dates.test.ts
```

- [ ] **Step 3: Implement date helpers without external libraries**

Use `Intl.DateTimeFormat` for the Search Console Pacific calendar and UTC arithmetic for date-only strings:

```ts
const pacificFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatSearchConsoleDate(date: Date): string {
  return pacificFormatter.format(date);
}

export function subtractDays(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function periodEndingOn(endDate: string, days: number) {
  return { startDate: subtractDays(endDate, days - 1), endDate };
}
```

- [ ] **Step 4: Verify date tests**

```bash
npm test -- test/gsc-dates.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit date logic**

```bash
git add src/gsc/dates.ts test/gsc-dates.test.ts
git commit -m "feat: add search console date windows"
```

---

### Task 8: Implement the Search Analytics REST client with finalized-data pagination

**Files:**
- Create: `src/gsc/search-analytics-client.ts`
- Create: `test/gsc-search-analytics-client.test.ts`

**Interfaces:**
- Produces: `SearchAnalyticsClient(accessToken, fetcher?)`.
- Produces: `query(siteUrl, request): Promise<SearchAnalyticsResponse>`.
- Produces: `queryAll(siteUrl, request): Promise<SearchAnalyticsRow[]>` using `rowLimit=25000` and `startRow` pagination.
- Produces: `findLatestFinalDate(siteUrl, lookbackStart, lookbackEnd): Promise<string | null>`.

- [ ] **Step 1: Write failing request-shape tests**

Assert URL encoding for a Domain Property and body:

```json
{
  "startDate": "2026-08-01",
  "endDate": "2026-08-15",
  "dimensions": ["date", "query"],
  "type": "web",
  "dataState": "final",
  "rowLimit": 25000,
  "startRow": 0
}
```

Also simulate a first 25,000-row response and a second short response, verifying `startRow` becomes `25000`.

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- test/gsc-search-analytics-client.test.ts
```

- [ ] **Step 3: Implement normalized Search Analytics types and REST calls**

Define normalized types and request endpoint:

```ts
export type SearchDimension = "date" | "query" | "page" | "country" | "device";

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
  metadata?: { first_incomplete_date?: string };
}

const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
```

`query()` uses `Authorization: Bearer ${accessToken}` and `Content-Type: application/json`. `queryAll()` starts at row 0, requests 25,000 rows, appends each page, increments `startRow` by the returned row count, and stops when a page has fewer than 25,000 rows or zero rows.

Stable client error codes:
- `gsc_search_analytics_http_error`
- `gsc_search_analytics_invalid_response`

Thrown messages include HTTP status and Google error reason when safe, never the access token.

- [ ] **Step 4: Implement latest-final-date lookup**

Call Search Analytics with `dimensions: ["date"]`, `dataState: "final"`, sort comes from API by date, and return the last date key or `null` if no rows exist.

- [ ] **Step 5: Verify client tests**

```bash
npm test -- test/gsc-search-analytics-client.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit Search Analytics client**

```bash
git add src/gsc/search-analytics-client.ts test/gsc-search-analytics-client.test.ts
git commit -m "feat: add gsc search analytics client"
```

---

### Task 9: Persist Search Analytics snapshots and implement bootstrap/refresh collection

**Files:**
- Create: `src/gsc/search-analytics-repository.ts`
- Create: `src/gsc/search-analytics-collector.ts`
- Create: `test/gsc-search-analytics-collector.test.ts`

**Interfaces:**
- Produces: `SearchAnalyticsRepository.getLatestDate(projectId)`.
- Produces batch upserts for daily/query/page/query-page/country/device rows.
- Produces: `collectSearchAnalytics({ project, accessToken, env, fetcher? }): Promise<{ latestFinalDate, recordsWritten }>`.
- First run backfills 56 finalized days; later runs refresh the latest 3 finalized days, both controlled by Worker vars.

- [ ] **Step 1: Write failing collector tests for first-run backfill**

Arrange an empty D1 project and fake latest finalized date `2026-08-15`. Assert collector asks for `2026-06-21` through `2026-08-15` when `GSC_INITIAL_BACKFILL_DAYS=56`.

Return sample rows for:
- date
- date + query
- date + page
- date + query + page
- date + country
- date + device

Assert rows are persisted with normalized keys.

- [ ] **Step 2: Add a failing repeat-run/idempotency test**

Run the collector twice with changed metrics for one same primary key and assert D1 contains one row with the newer values.

- [ ] **Step 3: Implement repository upserts**

Use `INSERT ... ON CONFLICT(...) DO UPDATE SET ...` for all six Search Analytics tables. The query-table pattern is:

```sql
INSERT INTO gsc_query_metrics (
  project_id, data_date, search_type, query, clicks, impressions, ctr, position, collected_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(project_id, data_date, search_type, query) DO UPDATE SET
  clicks = excluded.clicks,
  impressions = excluded.impressions,
  ctr = excluded.ctr,
  position = excluded.position,
  collected_at = excluded.collected_at;
```

Implement `batchInChunks(db, statements, 100)` and apply the same explicit conflict key to daily/page/query-page/country/device tables. Preserve API-provided daily `ctr` and `position`; reporting aggregation later recomputes period CTR and impression-weighted position.

- [ ] **Step 4: Implement collection range selection**

Algorithm:

```text
latestFinalDate = client.findLatestFinalDate(last 14 Pacific dates)
if no latestFinalDate: return zero records and null date
if repository has no stored date:
    start = latestFinalDate - (initialBackfillDays - 1)
else:
    start = latestFinalDate - (refreshDays - 1)
end = latestFinalDate
```

Query each dataset with `dataState=final` and type `web`: `[date]`, `[date,query]`, `[date,page]`, `[date,query,page]`, `[date,country]`, and `[date,device]`.

- [ ] **Step 5: Verify collector persistence and idempotency**

```bash
npm test -- test/gsc-search-analytics-collector.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit Search Analytics collector**

```bash
git add src/gsc/search-analytics-repository.ts src/gsc/search-analytics-collector.ts test/gsc-search-analytics-collector.test.ts
git commit -m "feat: collect gsc search analytics snapshots"
```

---

### Task 10: Implement core-URL Inspection collection

**Files:**
- Create: `src/gsc/url-inspection-client.ts`
- Create: `src/gsc/url-inspection-repository.ts`
- Create: `src/gsc/url-inspection-collector.ts`
- Create: `test/gsc-url-inspection.test.ts`

**Interfaces:**
- Produces: `inspectUrl(siteUrl, inspectionUrl, accessToken, fetcher?)`.
- Produces: `collectUrlInspections({ project, coreUrls, accessToken, concurrency, fetcher? })`.
- Persists one immutable snapshot per inspected URL/run timestamp.

- [ ] **Step 1: Write failing URL Inspection client test**

Assert POST:

```text
https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
```

with body:

```json
{
  "inspectionUrl": "https://zeroparse.com/big-json-viewer",
  "siteUrl": "sc-domain:zeroparse.com",
  "languageCode": "en-US"
}
```

- [ ] **Step 2: Write failing normalization/persistence test**

Use a representative response containing `inspectionResult.indexStatusResult` and assert D1 stores:
- verdict
- coverage state
- indexing state
- robots state
- page fetch state
- Google canonical
- user canonical
- last crawl time
- crawled-as
- referring URLs JSON
- sitemaps JSON
- mobile usability JSON
- rich results JSON
- full raw JSON

- [ ] **Step 3: Implement URL Inspection client and stable errors**

Implement the client around:

```ts
export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<UrlInspectionResult> {
  const response = await fetcher("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode: "en-US" }),
  });
  if (!response.ok) throw new GscUrlInspectionError("gsc_url_inspection_http_error", response.status);
  const json = await response.json<UrlInspectionApiResponse>();
  if (!json.inspectionResult) throw new GscUrlInspectionError("gsc_url_inspection_invalid_response", 502);
  return json.inspectionResult;
}
```

Stable codes:
- `gsc_url_inspection_http_error`
- `gsc_url_inspection_invalid_response`

- [ ] **Step 4: Implement bounded concurrency helper inside collector**

Process only `enabled && inspectionEnabled` core URLs and cap concurrency with a small worker-pool helper:

```ts
async function mapConcurrent<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}
```

Wrap each individual inspection call so a URL failure becomes `{ url, ok: false, errorCode }` rather than rejecting the whole pool. The orchestrator marks the source `partial` when at least one URL fails and at least one succeeds.

- [ ] **Step 5: Verify tests**

```bash
npm test -- test/gsc-url-inspection.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit URL Inspection collector**

```bash
git add src/gsc/url-inspection-client.ts src/gsc/url-inspection-repository.ts src/gsc/url-inspection-collector.ts test/gsc-url-inspection.test.ts
git commit -m "feat: collect gsc url inspections"
```

---

### Task 11: Implement Search Console sitemap snapshot collection

**Files:**
- Create: `src/gsc/sitemap-client.ts`
- Create: `src/gsc/sitemap-repository.ts`
- Create: `src/gsc/sitemap-collector.ts`
- Create: `test/gsc-sitemaps.test.ts`

**Interfaces:**
- Produces: `listSitemaps(siteUrl, accessToken, fetcher?)`.
- Produces: `collectSitemaps({ project, accessToken, fetcher? })`.
- Persists immutable sitemap snapshots keyed by project/path/collection time.

- [ ] **Step 1: Write failing sitemap API test**

Assert GET endpoint:

```ts
`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent("sc-domain:zeroparse.com")}/sitemaps`
```

and Bearer auth.

- [ ] **Step 2: Write failing persistence test**

Return two sitemap entries and assert stored fields include path, lastSubmitted, lastDownloaded, pending/index flags, type, errors, warnings, contents, and raw JSON.

- [ ] **Step 3: Implement client and repository**

Implement the list call and repository contract:

```ts
export async function listSitemaps(siteUrl: string, accessToken: string, fetcher: typeof fetch = fetch) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;
  const response = await fetcher(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new GscSitemapError("gsc_sitemaps_http_error", response.status);
  const json = await response.json<SitemapListResponse>();
  return json.sitemap ?? [];
}

export class SitemapRepository {
  constructor(private readonly db: D1Database) {}
  insertSnapshots(projectId: string, collectedAt: string, sitemaps: GscSitemap[]): Promise<number>;
}
```

Stable codes:
- `gsc_sitemaps_http_error`
- `gsc_sitemaps_invalid_response`

Normalize absent arrays to `[]` and absent counts to `0`.

- [ ] **Step 4: Verify sitemap tests**

```bash
npm test -- test/gsc-sitemaps.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit sitemap collector**

```bash
git add src/gsc/sitemap-client.ts src/gsc/sitemap-repository.ts src/gsc/sitemap-collector.ts test/gsc-sitemaps.test.ts
git commit -m "feat: collect gsc sitemap snapshots"
```

---

### Task 12: Add collection-run logging and source-isolated GSC orchestration

**Files:**
- Create: `src/collection/run-repository.ts`
- Create: `src/collection/gsc-orchestrator.ts`
- Create: `src/observability/logger.ts`
- Create: `test/collection-orchestrator.test.ts`

**Interfaces:**
- Produces: `CollectionSource = "gsc_search_analytics" | "gsc_url_inspection" | "gsc_sitemaps"`.
- Produces: `RunRepository.start(projectId, source, triggerType)` and `finish(runId, outcome)`.
- Produces: `collectProjectGsc(project, env, options): Promise<ProjectCollectionSummary>`.
- A source failure does not prevent later sources from executing.

- [ ] **Step 1: Write failing orchestration isolation test**

Arrange Search Analytics to throw, but Sitemaps and URL Inspection to succeed. Assert:
- all three sources were attempted;
- Search Analytics run status is `failed`;
- other source runs are `succeeded`;
- overall summary is `partial`;
- secret/token text is absent from persisted error messages.

- [ ] **Step 2: Implement collection-run repository**

Use `crypto.randomUUID()` for run IDs and expose:

```ts
export class RunRepository {
  constructor(private readonly db: D1Database) {}

  async start(projectId: string, source: CollectionSource, triggerType: "cron" | "manual"): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO collection_runs (id, project_id, source, trigger_type, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
    ).bind(id, projectId, source, triggerType, new Date().toISOString()).run();
    return id;
  }

  finish(runId: string, outcome: RunOutcome): Promise<void>;
}
```

`finish()` sets `completed_at`, `records_written`, final status, stable error code, and a sanitized error message capped at 1000 characters.

- [ ] **Step 3: Implement structured logger**

Create `logger.ts`:

```ts
export function logEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    ...fields,
  }));
}
```

Never log request Authorization headers, Google credentials, access tokens, or refresh tokens.

- [ ] **Step 4: Implement GSC orchestrator**

Implement one orchestration entry point:

```ts
export interface ProjectCollectionSummary {
  projectId: string;
  status: "succeeded" | "partial" | "failed";
  sources: Record<CollectionSource, { status: "succeeded" | "partial" | "failed"; recordsWritten: number; errorCode?: string }>;
}

export async function collectProjectGsc(
  project: Project,
  env: SiteInsightsEnv,
  options: { triggerType: "cron" | "manual"; fetcher?: typeof fetch },
): Promise<ProjectCollectionSummary> {
  // Resolve one connection and one access token, then run each source through
  // a helper that creates/finishes its own collection_runs record.
}
```

Execution order is Search Analytics, Sitemaps, then URL Inspection. Each source is wrapped independently so later sources still run after an earlier failure. If OAuth refresh itself fails, create three failed source-run records with code `google_oauth_failed` so freshness/reporting can explain why no source refreshed.

- [ ] **Step 5: Verify orchestration tests**

```bash
npm test -- test/collection-orchestrator.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit orchestration and logs**

```bash
git add src/collection/run-repository.ts src/collection/gsc-orchestrator.ts src/observability/logger.ts test/collection-orchestrator.test.ts
git commit -m "feat: orchestrate isolated gsc collection"
```

---

### Task 13: Wire Cron scheduling and admin manual collection

**Files:**
- Create: `src/collection/scheduler.ts`
- Modify: `src/index.ts`
- Modify: `src/http/router.ts`
- Create: `test/scheduler.test.ts`

**Interfaces:**
- Produces: `runScheduledCollection(env): Promise<SchedulerSummary>`.
- Produces admin route: `POST /v1/admin/projects/:id/collect/gsc`.
- Scheduled collection processes enabled projects sequentially and isolates project failures.

- [ ] **Step 1: Write failing scheduler isolation test**

Seed two enabled projects. Make ZeroParse collection fail and VetaTool succeed. Assert VetaTool is still attempted and scheduler summary reports one failure/one success.

- [ ] **Step 2: Implement scheduler**

Implement:

```ts
export interface SchedulerSummary {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
}

export async function runScheduledCollection(env: SiteInsightsEnv): Promise<SchedulerSummary> {
  const projects = (await new ProjectRepository(env.DB).listProjects("enabled"))
    .sort((a, b) => a.id.localeCompare(b.id));
  const summary: SchedulerSummary = { total: projects.length, succeeded: 0, partial: 0, failed: 0 };
  for (const project of projects) {
    try {
      const result = await collectProjectGsc(project, env, { triggerType: "cron" });
      summary[result.status] += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
```

- [ ] **Step 3: Wire Worker `scheduled()` handler**

```ts
async scheduled(_controller, env, ctx) {
  ctx.waitUntil(runScheduledCollection(env));
}
```

- [ ] **Step 4: Add manual admin collection route**

Register this exact path and method:

```ts
const collectMatch = pathname.match(/^\/v1\/admin\/projects\/([a-z0-9-]+)\/collect\/gsc$/);
if (request.method === "POST" && collectMatch) {
  const project = await repo.getProject(collectMatch[1]);
  if (!project) return jsonResponse({ error: "project_not_found" }, 404);
  const summary = await collectProjectGsc(project, env, { triggerType: "manual" });
  return jsonResponse(summary);
}
```

The route is behind the router's admin auth and executes synchronously so the caller receives source-level results.

- [ ] **Step 5: Verify scheduler and manual route tests**

```bash
npm test -- test/scheduler.test.ts test/collection-orchestrator.test.ts
npm run typecheck
```

- [ ] **Step 6: Verify local Cron invocation**

Run:

```bash
npm run dev
```

In a second shell:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled?format=json"
```

Expected: handler executes without routing through the public HTTP API. It may report missing Google secrets locally until secrets are configured, but it must not crash the Worker process.

- [ ] **Step 7: Commit scheduler/manual collection**

```bash
git add src/collection/scheduler.ts src/index.ts src/http/router.ts test/scheduler.test.ts
git commit -m "feat: schedule gsc collection"
```

---

### Task 14: Implement read-only stored status aggregation

**Files:**
- Create: `src/reporting/status-repository.ts`
- Create: `src/reporting/status-routes.ts`
- Modify: `src/http/router.ts`
- Create: `test/status-api.test.ts`

**Interfaces:**
- Produces read route: `GET /v1/projects/:id/status`.
- Produces: `getProjectStatus(projectId, now?)` from D1 only; it never calls Google.
- Response includes project, freshness, latest finalized day, 7d/previous-7d, 28d/previous-28d, top queries, top pages, country/device breakdowns, core URL latest inspections, sitemap latest states, and collection-source availability.

- [ ] **Step 1: Write a failing status API test with deterministic snapshots**

Seed daily data for 56 days ending `2026-08-15`, query/page rows, two core URL inspections, sitemap snapshots, and successful collection runs. Assert response shape:

```json
{
  "project": {
    "id": "zeroparse",
    "domain": "zeroparse.com"
  },
  "dataThrough": "2026-08-15",
  "search": {
    "latestDay": {
      "date": "2026-08-15",
      "clicks": 0,
      "impressions": 0,
      "ctr": 0,
      "position": null
    },
    "last7": {
      "clicks": 0,
      "impressions": 0,
      "ctr": 0,
      "position": null
    },
    "previous7": {},
    "last28": {},
    "previous28": {},
    "deltas": {}
  },
  "topQueries": [],
  "topPages": [],
  "countries": [],
  "devices": [],
  "coreUrls": [],
  "sitemaps": [],
  "sources": {}
}
```

Use real non-zero fixtures for assertions even though the shape example shows zero-safe defaults.

- [ ] **Step 2: Define aggregation formulas in tests**

For any period:
- `clicks = SUM(clicks)`
- `impressions = SUM(impressions)`
- `ctr = clicks / impressions`, or `0` when impressions is zero
- `position = SUM(position * impressions) / SUM(impressions)`, or `null` when impressions is zero

Deltas:
- clicks/impressions: percentage change, `null` when previous is zero
- CTR: percentage-point difference (`currentCtr - previousCtr`)
- position: signed difference (`currentPosition - previousPosition`), where negative means ranking improved

- [ ] **Step 3: Implement latest-data and period aggregation queries**

Find `dataThrough` using:

```sql
SELECT MAX(data_date) AS data_through
FROM gsc_daily_metrics
WHERE project_id = ? AND search_type = 'web';
```

Read the exact `dataThrough` row as `search.latestDay`, then compute comparison periods relative to stored latest final data, not wall-clock date. Period aggregation uses:

```sql
SELECT
  COALESCE(SUM(clicks), 0) AS clicks,
  COALESCE(SUM(impressions), 0) AS impressions,
  CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE 0 END AS ctr,
  CASE WHEN SUM(impressions) > 0
    THEN SUM(position * impressions) / SUM(impressions)
    ELSE NULL END AS position
FROM gsc_daily_metrics
WHERE project_id = ? AND search_type = 'web' AND data_date BETWEEN ? AND ?;
```

Use the same sum/recomputed-CTR/impression-weighted-position pattern for top queries/pages/countries/devices over the last 28 days, grouping on the matching dimension, ordering `impressions DESC, clicks DESC`, and limiting to 25 rows.

- [ ] **Step 4: Implement latest inspection/sitemap selection**

Use a max-timestamp join so each URL/path appears once:

```sql
SELECT i.*
FROM url_inspections i
JOIN (
  SELECT url, MAX(inspected_at) AS max_time
  FROM url_inspections
  WHERE project_id = ?
  GROUP BY url
) latest ON latest.url = i.url AND latest.max_time = i.inspected_at
WHERE i.project_id = ?
ORDER BY i.url;
```

Use the same pattern on `sitemap_snapshots(path, collected_at)`.

- [ ] **Step 5: Implement source freshness**

For each collection source, query the newest run:

```sql
SELECT source, status, started_at, completed_at, records_written, error_code
FROM collection_runs
WHERE project_id = ?
ORDER BY started_at DESC;
```

Reduce in application code by taking the first row for each expected source. If no row exists for a source, return `{ "status": "never_collected" }`.

- [ ] **Step 6: Register read-only status route**

Register:

```ts
const statusMatch = pathname.match(/^\/v1\/projects\/([a-z0-9-]+)\/status$/);
if (request.method === "GET" && statusMatch) {
  const status = await new StatusRepository(env.DB).getProjectStatus(statusMatch[1]);
  return status ? jsonResponse(status) : jsonResponse({ error: "project_not_found" }, 404);
}
```

The outer router has already enforced read/admin authentication.

- [ ] **Step 7: Verify status API and authorization**

```bash
npm test -- test/status-api.test.ts test/auth.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit reporting API**

```bash
git add src/reporting/status-repository.ts src/reporting/status-routes.ts src/http/router.ts test/status-api.test.ts
git commit -m "feat: add gsc status reporting api"
```

---

### Task 15: Harden health/diagnostics without leaking secrets

**Files:**
- Modify: `src/index.ts`
- Modify: `src/http/router.ts`
- Modify: `src/observability/logger.ts`
- Modify: `test/health.test.ts`

**Interfaces:**
- Public `GET /health` returns only process/service health.
- Admin `GET /v1/admin/diagnostics` verifies D1 connectivity and reports presence/absence of required secret names as booleans, never values.

- [ ] **Step 1: Write failing diagnostics test**

Expected admin response:

```json
{
  "ok": true,
  "database": "ok",
  "configuration": {
    "googleClientId": true,
    "googleClientSecret": true,
    "googleRefreshToken": true,
    "adminApiToken": true,
    "readApiToken": true
  }
}
```

Assert the response body does not contain any configured token literal.

- [ ] **Step 2: Implement D1 diagnostic query**

Implement the admin diagnostic probe:

```ts
try {
  await env.DB.prepare("SELECT 1 AS ok").first();
  return jsonResponse({
    ok: true,
    database: "ok",
    configuration: configurationPresence(env),
  });
} catch {
  return jsonResponse({
    ok: false,
    database: "error",
    configuration: configurationPresence(env),
  }, 503);
}
```

`configurationPresence()` returns booleans only.

- [ ] **Step 3: Keep public health minimal**

Public `/health` response remains:

```json
{
  "ok": true,
  "service": "site-insights",
  "timestamp": "ISO-8601"
}
```

No D1 counts, project names, secret configuration, or Google status appears on the public endpoint.

- [ ] **Step 4: Verify diagnostics and health tests**

```bash
npm test -- test/health.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit observability hardening**

```bash
git add src/index.ts src/http/router.ts src/observability/logger.ts test/health.test.ts
git commit -m "feat: add secure diagnostics"
```

---

### Task 16: Add ZeroParse and VetaTool through the Project Registry API

**Files:**
- No source changes required unless a validation defect is discovered.
- Update: `MASTER_MAP.md` only after successful configuration.

**Interfaces:**
- Uses: admin project APIs from Task 5.
- Produces two enabled D1 project records and initial core URL sets.

- [ ] **Step 1: Start local Worker with local secrets**

Create `.dev.vars` locally and keep it gitignored. It contains real local test values for:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
ADMIN_API_TOKEN
READ_API_TOKEN
```

Verify `.dev.vars` is absent from `git status --ignored=no` staged candidates before every commit.

- [ ] **Step 2: Create ZeroParse project via API**

```bash
curl -X POST http://localhost:8787/v1/admin/projects \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id":"zeroparse",
    "name":"ZeroParse",
    "domain":"zeroparse.com",
    "baseUrl":"https://zeroparse.com",
    "timezone":"Asia/Shanghai",
    "gscProperty":"sc-domain:zeroparse.com",
    "robotsUrl":"https://zeroparse.com/robots.txt",
    "sitemapUrls":["https://zeroparse.com/sitemap.xml"],
    "primaryLanguage":"en",
    "languages":["en","zh"]
  }'
```

- [ ] **Step 3: Configure ZeroParse core URLs**

```bash
curl -X PUT http://localhost:8787/v1/admin/projects/zeroparse/core-urls \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls":[
    {"url":"https://zeroparse.com/","pageType":"home","priority":10,"inspectionEnabled":true},
    {"url":"https://zeroparse.com/app","pageType":"app","priority":20,"inspectionEnabled":true},
    {"url":"https://zeroparse.com/json-viewer","pageType":"tool","priority":30,"inspectionEnabled":true},
    {"url":"https://zeroparse.com/json-formatter","pageType":"tool","priority":40,"inspectionEnabled":true},
    {"url":"https://zeroparse.com/jsonl-viewer","pageType":"tool","priority":50,"inspectionEnabled":true},
    {"url":"https://zeroparse.com/big-json-viewer","pageType":"tool","priority":60,"inspectionEnabled":true}
  ]}'
```

- [ ] **Step 4: Create VetaTool project**

```bash
curl -X POST http://localhost:8787/v1/admin/projects \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id":"vetatool",
    "name":"VetaTool",
    "domain":"vetatool.com",
    "baseUrl":"https://vetatool.com",
    "timezone":"Asia/Shanghai",
    "gscProperty":"sc-domain:vetatool.com",
    "robotsUrl":"https://vetatool.com/robots.txt",
    "sitemapUrls":["https://vetatool.com/sitemap.xml"],
    "primaryLanguage":"en",
    "languages":["en"]
  }'
```

- [ ] **Step 5: Configure VetaTool minimum safe core URL set**

Start with the homepage only so Phase 1 does not guess future route names:

```bash
curl -X PUT http://localhost:8787/v1/admin/projects/vetatool/core-urls \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"urls":[
    {"url":"https://vetatool.com/","pageType":"home","priority":10,"inspectionEnabled":true}
  ]}'
```

Add verified VetaTool tool/content URLs later through the same API without code changes.

- [ ] **Step 6: Verify both projects are enabled**

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://localhost:8787/v1/admin/projects
```

Expected: both `zeroparse` and `vetatool` are present with `status=enabled`.

- [ ] **Step 7: Update Master Map configuration checklist**

Mark only the two project-configuration items complete after the records exist in the target environment.

- [ ] **Step 8: Commit only documentation changes**

```bash
git add MASTER_MAP.md
git commit -m "docs: record initial site configurations"
```

---

### Task 17: Configure production secrets, apply D1 migrations, and deploy

**Files:**
- Modify: `wrangler.jsonc` only if deployment environment configuration requires it.
- Update: `MASTER_MAP.md` after verified deployment.

**Interfaces:**
- Produces one deployed Worker, one production D1 binding, daily Cron, and five configured secrets.

- [ ] **Step 1: Run the complete local verification suite before touching production**

```bash
npm ci
npm run types
npm run typecheck
npm test
```

Expected: all PASS.

- [ ] **Step 2: Store production secrets through Wrangler**

Run each command interactively and paste the real value only into Wrangler's secure prompt:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put READ_API_TOKEN
```

Generate admin/read tokens locally with at least 32 random bytes, for example:

```bash
openssl rand -hex 32
```

Use distinct values for admin and read-only tokens.

- [ ] **Step 3: Apply production migrations**

```bash
npx wrangler d1 migrations apply site-insights --remote
```

Expected: all unapplied Phase 1 migrations succeed.

- [ ] **Step 4: Deploy Worker**

```bash
npm run deploy
```

Record the deployed Worker URL returned by Wrangler in operational notes, not in source code.

- [ ] **Step 5: Verify public health and authenticated diagnostics**

```bash
curl "$SITE_INSIGHTS_URL/health"
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" "$SITE_INSIGHTS_URL/v1/admin/diagnostics"
```

Expected: both return `ok=true`, diagnostics reports D1 and secret presence without exposing values.

- [ ] **Step 6: Configure ZeroParse/VetaTool in production through admin API**

Repeat Task 16 against `$SITE_INSIGHTS_URL` using the production admin token.

- [ ] **Step 7: Commit deployment bookkeeping only if source/config changed**

If no tracked file changed, do not create an empty commit.

---

### Task 18: Run real GSC smoke tests for both projects

**Files:**
- Update: `MASTER_MAP.md`
- Create: `docs/operations/gsc-smoke-test.md`

**Interfaces:**
- Uses manual collection endpoint and read-only status endpoint.
- Produces evidence that each site is authorized, data is persisted, and read-only reporting works.

- [ ] **Step 1: Trigger ZeroParse collection**

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  "$SITE_INSIGHTS_URL/v1/admin/projects/zeroparse/collect/gsc"
```

Expected: each source reports `succeeded` or, if Google returns no data for a valid source, a non-fabricated zero-record success. Any failure must include a stable error code.

- [ ] **Step 2: Read ZeroParse status using read-only token**

```bash
curl \
  -H "Authorization: Bearer $READ_API_TOKEN" \
  "$SITE_INSIGHTS_URL/v1/projects/zeroparse/status"
```

Verify:
- `dataThrough` is a real finalized Search Console date;
- source freshness timestamps match the smoke test;
- top queries/pages reflect returned GSC facts;
- core URL inspection and sitemap sections contain only actual Google responses.

- [ ] **Step 3: Trigger and verify VetaTool collection**

Run the same two requests for project ID `vetatool` and apply the same assertions.

- [ ] **Step 4: Verify D1 historical rows directly**

```bash
npx wrangler d1 execute site-insights --remote --command \
  "SELECT project_id, MAX(data_date) AS latest_date, COUNT(*) AS rows FROM gsc_daily_metrics GROUP BY project_id ORDER BY project_id;"
```

Expected: both project IDs have rows if Search Console has finalized data available.

- [ ] **Step 5: Document the exact smoke-test results**

Create `docs/operations/gsc-smoke-test.md` containing:
- execution date/time;
- project ID;
- latest final data date;
- source statuses;
- record counts;
- any Google-side permission/data availability limitation;
- no tokens or secrets.

- [ ] **Step 6: Update Master Map milestone state**

Mark real GSC smoke tests complete only after both projects have passed. If one is blocked by property permissions, mark that line blocked and record the specific stable error code.

- [ ] **Step 7: Commit smoke-test documentation**

```bash
git add docs/operations/gsc-smoke-test.md MASTER_MAP.md
git commit -m "docs: record phase one gsc smoke tests"
```

---

### Task 19: Prepare ChatGPT-safe read endpoint usage and report handoff

**Files:**
- Create: `docs/operations/chatgpt-reporting.md`
- Update: `MASTER_MAP.md`

**Interfaces:**
- Uses: `GET /v1/projects/:id/status` with read-only Bearer token.
- Produces a stable field contract for ChatGPT or another reporting consumer.
- Does not change the ChatGPT Scheduled Task until a secure way for that task to supply the read token is verified in the target ChatGPT environment.

- [ ] **Step 1: Document the status API contract**

Describe each field and explicitly state:
- `dataThrough` is the latest finalized GSC date stored in D1;
- `position` is lower-is-better;
- negative `positionDelta` means improvement;
- missing source data is represented by source status, not guessed values;
- all recommendations remain outside Phase 1.

- [ ] **Step 2: Document consumer security rules**

`docs/operations/chatgpt-reporting.md` must state:
- never put the admin token into ChatGPT;
- use only the read-only token for reporting consumers;
- rotate the read token if exposed;
- do not encode bearer tokens into public query-string URLs;
- if the Scheduled Task cannot securely attach Authorization headers, use a future purpose-built connector/proxy rather than weakening API authentication.

- [ ] **Step 3: Add a canonical curl example**

```bash
curl \
  -H "Authorization: Bearer $READ_API_TOKEN" \
  "$SITE_INSIGHTS_URL/v1/projects/zeroparse/status"
```

- [ ] **Step 4: Run final Phase 1 regression suite**

```bash
npm ci
npm run types
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Update Master Map Phase 1 checklist**

Mark code/data/deployment items complete from evidence. Leave “Update ChatGPT ZeroParse scheduled report to consume site-insights” incomplete if secure header-based access is not yet available in the task runtime.

- [ ] **Step 6: Commit reporting handoff docs**

```bash
git add docs/operations/chatgpt-reporting.md MASTER_MAP.md
git commit -m "docs: define reporting api handoff"
```

---

## Phase 1 Acceptance Criteria

Phase 1 is complete only when all of the following are true:

1. `npm run types`, `npm run typecheck`, and `npm test` pass from a clean install.
2. One deployed Cloudflare Worker serves both HTTP and Cron handlers.
3. One production D1 database contains the Phase 1 schema and migrations.
4. ZeroParse and VetaTool are enabled projects in the same deployment.
5. Google credentials exist only as Worker secrets.
6. Admin and read-only API tokens are distinct.
7. Manual GSC collection succeeds for both projects or records a precise Google-side permission/data-availability failure without fabricating data.
8. Daily Search Analytics snapshots are persisted and idempotently refreshed.
9. Core URL Inspection and Sitemap snapshots are stored from real Google responses.
10. A source failure is isolated from other sources and projects and is visible in `collection_runs`.
11. `GET /v1/projects/zeroparse/status` and `/vetatool/status` return stored facts without calling Google during the request.
12. Cron scheduling runs collection before the daily reporting window.
13. Public health output contains no sensitive configuration.
14. No Google access token, refresh token, client secret, admin token, or read token exists in git history, D1, logs, or response bodies.
15. `MASTER_MAP.md` reflects actual evidence, not intended completion.

## Phase 1 Explicit Deferrals

These are intentionally not part of this plan and each gets a separate implementation plan after Phase 1 is reviewed:

- Phase 2: site crawler, robots/sitemap active checks, PageSpeed/CWV, basic deterministic insights, alerts, Bark/email.
- Phase 3: GA4, Cloudflare Analytics, promotion records/backlink inputs.
- Phase 4: tracked keywords/rank provider and advanced growth-opportunity engine.
- Phase 5: admin dashboard, backup/export and operator UX.
- Phase 6: human-approved PatchSync/Codex task handoff and before/after effectiveness measurement.

## Self-Review Results

- **Spec coverage:** M00, M01, M08, M09, M13, M17, M18, M20 and the Phase 1 part of M14 are mapped to concrete tasks above. M02–M07, M10–M12, M15–M16, and M19 are explicitly deferred to later plans as approved in the master design.
- **Placeholder scan:** no unresolved design placeholders remain. Environment-specific Cloudflare IDs and real secrets are obtained at execution time through commands and are never invented or committed.
- **Type/interface consistency:** `Project`, `ProjectRepository`, `getGoogleConnection`, the three GSC collectors, `collectProjectGsc`, `runScheduledCollection`, and the stored status API each have one defined responsibility and are consumed only by later tasks through the signatures documented above.
