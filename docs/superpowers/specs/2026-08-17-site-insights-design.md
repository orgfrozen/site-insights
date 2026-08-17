# site-insights Design Specification

Date: 2026-08-17
Status: Approved architecture, pending implementation-plan review

## 1. Purpose

`site-insights` is a multi-site SEO and growth observability platform. It collects first-party and third-party website data, stores historical snapshots, detects changes and opportunities, exposes normalized read APIs, and feeds downstream reporting/automation systems such as ChatGPT Scheduled Tasks and, later, PatchSync/Codex workflows.

The system is intended to support multiple owned sites such as ZeroParse and VetaTool from one deployment.

## 2. Design principles

1. One platform, many sites: projects are configuration, not separate deployments.
2. Facts first: the service stores source data and deterministic derived metrics; LLMs interpret results later.
3. Historical by default: all meaningful metrics are stored as snapshots for comparison.
4. Read/write separation: reporting consumers get read-only access; administrative operations use separate authorization.
5. Isolated collectors: failure of one project or data source must not block others.
6. Incremental delivery: the architecture supports the full platform, but implementation proceeds in phases.
7. No automatic site modification in the first versions.

## 3. High-level architecture

Data sources:

- Google Search Console
- Google Analytics 4
- Cloudflare Analytics
- Site crawler / HTTP health checks
- PageSpeed Insights / CrUX
- Rank tracking provider
- Promotion records / backlink sources

Core platform:

- Cloudflare Worker runtime
- Cloudflare D1 historical data store
- Cloudflare Cron scheduled collection
- Insight engine
- Alert engine
- REST reporting API
- Admin dashboard

Downstream consumers:

- ChatGPT Scheduled Tasks
- Bark / Email / other notifications
- PatchSync / Codex task workflow (future)

## 4. Modules

### M00 Project Registry

Responsibilities:
- Manage project identity, domain, base URL, timezone and status.
- Store integration identifiers such as GSC property, GA property and Cloudflare zone.
- Store sitemap/robots settings, languages and monitored core URLs.

Primary entities:
- `projects`
- `project_core_urls`

Key operations:
- Create/read/update/disable projects.
- Add/remove/enable core URLs.
- Validate project configuration.

### M01 Google Search Console

Responsibilities:
- Use one Google account/OAuth connection for multiple Search Console properties in v1.
- Collect Search Analytics data.
- Inspect configured core URLs.
- Collect sitemap status.

Search Analytics periods:
- latest available day
- last 7 days
- previous 7 days
- last 28 days
- previous 28 days

Dimensions:
- date
- query
- page
- query + page
- country
- device

Metrics:
- clicks
- impressions
- CTR
- average position

URL Inspection fields include:
- coverage/indexing state
- robots state
- page fetch state
- Google/user canonical
- last crawl time
- crawler type
- sitemap/referring URL data when available
- mobile usability/rich-result data when available

Credential model:
- v1 supports one Google account via Worker secrets.
- Internal code uses a `getGoogleConnection(project)` abstraction so multi-account support can be added later without rewriting collectors.

### M02 Google Analytics 4

Responsibilities:
- Collect user/session/engagement data.
- Collect landing-page and acquisition dimensions.
- Correlate GSC landing pages with on-site behavior.

### M03 Cloudflare Analytics

Responsibilities:
- Collect requests, visitors, bandwidth, cache status, status codes and geography.
- Track 4xx/5xx trends, top 404s and crawler/bot traffic when available.

### M04 Site Health / SEO Crawler

Submodules:
- HTTP health
- on-page SEO extraction
- internal-link graph
- robots/sitemap active validation

Checks include:
- status/redirect chain/latency/content type
- title/meta/H1/H2/canonical/robots/hreflang/structured data
- broken links/orphan pages/internal-link counts
- robots and sitemap validity

### M05 PageSpeed / Core Web Vitals

Responsibilities:
- Collect mobile and desktop lab/field metrics.
- Store performance snapshots.
- Detect regressions.

Metrics include LCP, CLS, INP, FCP, TTFB, Speed Index and Total Blocking Time where applicable.

### M06 Keyword / Ranking Tracking

Responsibilities:
- Maintain tracked keywords per project/country/language/device.
- Store rank history and target URLs.
- Detect gains, losses, Top 3/10/20/100 movement and cannibalization.

Rank provider must be behind an abstraction (`RankProvider`) so the vendor can be selected later.

### M07 Promotion / Backlinks

Promotion records:
- Store known outreach URLs, platform, campaign, date, title, status and notes.

Backlinks:
- Aggregate available first-party/referral signals.
- Keep an external backlink-provider abstraction for later.

### M08 Data Pipeline / Scheduler

Responsibilities:
- Schedule collectors.
- Record each collection run.
- Retry transient failures with backoff.
- Isolate project/source failures.
- Mark stale and partial data explicitly.

Entity:
- `collection_runs`

### M09 Historical Data Warehouse

Cloudflare D1 is the v1 store.

Planned logical tables:
- projects
- project_core_urls
- gsc_daily_metrics
- gsc_query_metrics
- gsc_page_metrics
- gsc_query_page_metrics
- url_inspections
- sitemap_snapshots
- ga_daily_metrics
- ga_page_metrics
- ga_source_metrics
- cf_daily_metrics
- cf_status_metrics
- page_health_snapshots
- page_seo_snapshots
- pagespeed_snapshots
- tracked_keywords
- keyword_rankings
- promotion_records
- collection_runs
- insights
- alerts

Requirements:
- migrations
- indexes and uniqueness constraints
- upsert semantics for snapshots
- retention policy
- export support

### M10 Insight Engine

Responsibilities:
- Calculate period-over-period trends.
- Detect keyword/page/indexing opportunities and problems.
- Produce deterministic insight records for consumers.

Core detections:
- 7d vs prior 7d
- 28d vs prior 28d
- new/lost/rising queries
- near-page-1 keywords
- high-impression low-CTR opportunities
- ranking drops
- indexing regressions
- stale crawls
- canonical/robots/sitemap problems
- weak internal linking
- performance regressions

### M11 Alerts

Responsibilities:
- Convert important insight conditions into deduplicated alert events.
- Support severity, cooldown, resolution and notification state.

Severity examples:
- Critical: homepage 5xx, robots blocks site, sitemap failure, core URL deindexed.
- Warning: sharp traffic/impression/rank/CWV degradation.
- Opportunity: important query approaches page 1, high-impression low-CTR page.

### M12 Notification Channels

A `Notifier` abstraction supports:
- Bark
- Email
- future Telegram/Feishu/Slack/Webhook

### M13 Reporting API

Primary consumer endpoint:
- `GET /v1/projects/:id/status`

Additional endpoints:
- `/summary`
- `/gsc`
- `/queries`
- `/pages`
- `/indexing`
- `/traffic`
- `/health`
- `/pagespeed`
- `/promotions`
- `/opportunities`
- `/alerts`
- `/history`

Response contracts must include:
- source freshness
- source availability
- partial/error state
- comparison periods
- normalized metrics
- deterministic insights

### M14 ChatGPT Integration

Responsibilities:
- Provide read-only API tokens suitable for Scheduled Tasks.
- Return compact, model-friendly JSON.
- Explicitly mark missing/stale sources so the model does not guess.
- Maintain daily and weekly report prompt templates.

### M15 Agent / PatchSync Integration

Future closed-loop workflow:
- site-insights discovers an opportunity/problem.
- recommendation is created.
- human approves.
- adapter creates a task in the task control plane.
- Agent/PatchSync changes and deploys code.
- site-insights evaluates before/after metrics.

No automatic site modifications in initial versions.

### M16 Admin Dashboard

Responsibilities:
- Multi-site overview.
- Project detail views for search, traffic, indexing, health, performance, keywords, promotion, alerts and actions.
- Project/date filters.
- KPI cards, charts and tables.

### M17 Authentication / Security

Requirements:
- Secrets never stored in source control.
- Worker secrets for v1 provider credentials.
- Separate admin and read-only API authorization.
- Future scoped tokens.
- API rate limiting.
- Audit logging for administrative mutations.

### M18 Observability

Requirements:
- structured logs
- request/run IDs
- collection duration and retry count
- provider/API/DB failure logs
- `/health`
- readiness signal

### M19 Backup / Export

Requirements:
- D1 backup/recovery strategy
- JSON/CSV exports
- project/date-range export
- schema versioning
- migration recovery process

### M20 Master Map / Progress Tracking

`MASTER_MAP.md` is the source of truth for delivery progress.

Each module tracks:
- status
- todo
- done
- blocked
- dependencies
- tests/verification

## 5. Phased delivery

### Phase 1 — Data foundation

Modules:
- M00 Project Registry
- M01 GSC
- M08 Scheduler
- M09 D1
- M13 Basic Reporting API
- M17 Security
- M18 Observability
- M20 Master Map

Acceptance criteria:
- One deployed Worker supports both ZeroParse and VetaTool as separate project records.
- One Google account/OAuth connection can collect both properties.
- GSC search metrics are stored historically.
- Configured core URLs can be inspected.
- Sitemap status is stored.
- Scheduled collection is isolated by project/source.
- `/v1/projects/:id/status` returns real, freshness-tagged data.
- Read-only API authentication works.
- Failed source/project collections are observable and do not corrupt successful results.

### Phase 2 — Site health

Modules:
- M04 crawler
- M05 PageSpeed
- M10 basic insights
- M11 alerts
- M12 Bark

Acceptance criteria:
- Critical technical SEO failures can be detected and pushed automatically.

### Phase 3 — Traffic panorama

Modules:
- M02 GA4
- M03 Cloudflare Analytics
- M07 Promotion

Acceptance criteria:
- Search exposure, visits, on-site behavior and known promotion activities can be analyzed together.

### Phase 4 — SEO Growth Engine

Modules:
- M06 rank tracking
- M10 advanced insight scoring

Acceptance criteria:
- Platform identifies and prioritizes actionable keyword/page opportunities.

### Phase 5 — Productization

Modules:
- M16 Dashboard
- M19 Backup/Export

Acceptance criteria:
- Platform is practical for regular multi-site human use without direct API/database inspection.

### Phase 6 — Agent loop

Module:
- M15 PatchSync/Codex integration

Acceptance criteria:
- Approved insights can create implementation tasks and later measure their effects.

## 6. Data flow for Phase 1

1. Cloudflare Cron triggers collection.
2. Project registry returns enabled projects.
3. GSC collector obtains an access token from the configured Google connection.
4. Search Analytics, URL Inspection and Sitemap collectors run independently.
5. Results are normalized and upserted into D1.
6. `collection_runs` records complete/partial/failed status per project/source.
7. Reporting API reads stored data and calculates comparison summaries.
8. ChatGPT Scheduled Task reads the reporting API, then combines it with public web/search checks.

## 7. Failure handling

- Never delete/overwrite a valid historical snapshot with an error response.
- Each collector returns success, partial or failed status.
- Transient provider failures retry with bounded exponential backoff.
- Persistent failures are recorded and surfaced through freshness/source-state fields.
- One project failure cannot abort collection for other projects.
- Reporting API can return last known good data, but must mark it stale and include its timestamp.

## 8. Security model

V1 secrets:
- Google client ID
- Google client secret
- Google refresh token
- admin API secret/token
- read-only reporting API token

Provider secrets are stored using Cloudflare Worker Secrets.

Read-only consumers cannot mutate project configuration or trigger privileged provider operations.

## 9. Testing strategy

Phase 1 requires:
- unit tests for metric normalization and period comparisons
- unit tests for token refresh/provider error handling
- repository tests for D1 migrations/upserts
- API authentication tests
- API response contract tests
- collector partial-failure tests
- project-isolation tests
- scheduled-run idempotency tests

External Google API calls should be wrapped behind interfaces and mocked in unit/integration tests. A small manual smoke test against the real ZeroParse property is part of deployment verification.

## 10. Explicit non-goals for Phase 1

- multiple Google-account management UI
- GA4
- Cloudflare Analytics ingestion
- full crawler
- rank provider
- backlink provider
- admin dashboard
- Bark/email notification
- automatic PatchSync task creation
- automatic modifications to monitored sites

## 11. Evolution to multiple Google accounts

V1 deliberately supports one Google account. The following boundary is reserved:

`getGoogleConnection(project)`

When multiple Google accounts are actually required:
- add `google_connections`
- add `projects.google_connection_id`
- store encrypted refresh tokens
- add OAuth connect/reauthorize workflow

GSC collectors and reporting APIs should remain unchanged.
