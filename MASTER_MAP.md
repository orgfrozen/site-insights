# site-insights Master Map

Last updated: 2026-08-17

Legend: ⬜ Not started · 🟡 In progress · ✅ Done · ⛔ Blocked

| Module | Status | Phase | Notes |
|---|---|---:|---|
| M00 Project Registry | 🟡 | 1 | Initial repository/API implemented; full Vitest verification pending npm install |
| M01 Google Search Console | 🟡 | 1 | OAuth, PT date windows, Search Analytics and core URL Inspection collectors implemented; Sitemap pending |
| M02 Google Analytics 4 | ⬜ | 3 | Deferred |
| M03 Cloudflare Analytics | ⬜ | 3 | Deferred |
| M04 Site Health / SEO Crawler | ⬜ | 2 | Deferred |
| M05 PageSpeed / CWV | ⬜ | 2 | Deferred |
| M06 Keyword / Ranking Tracking | ⬜ | 4 | Provider abstraction required |
| M07 Promotion / Backlinks | ⬜ | 3 | Promotion records first |
| M08 Data Pipeline / Scheduler | ⬜ | 1 | Cron + isolated runs |
| M09 Historical Data Warehouse | 🟡 | 1 | Phase 1 schema and Search Analytics historical upserts implemented; remaining collectors pending |
| M10 Insight Engine | ⬜ | 2/4 | Basic then advanced |
| M11 Alerts | ⬜ | 2 | Deferred |
| M12 Notification Channels | ⬜ | 2 | Bark first |
| M13 Reporting API | ⬜ | 1 | Read-only status API |
| M14 ChatGPT Integration | ⬜ | 1+ | First consumer after API is stable |
| M15 Agent / PatchSync Integration | ⬜ | 6 | Human approval required |
| M16 Admin Dashboard | ⬜ | 5 | Deferred |
| M17 Authentication / Security | 🟡 | 1 | Bearer boundaries implemented; production secrets/scoping still pending |
| M18 Observability | 🟡 | 1 | Public health endpoint implemented; run logging still pending |
| M19 Backup / Export | ⬜ | 5 | Deferred |
| M20 Master Map / Progress Tracking | ✅ | 1 | This file |

## Phase 1 milestone

Goal: ZeroParse and VetaTool both produce real GSC-backed historical status through one deployed site-insights service.

Implementation plan: `docs/superpowers/plans/2026-08-17-phase-1-gsc-foundation.md`

Plan status: ✅ Detailed, self-reviewed, and ready for execution.

### Phase 1 execution tasks

- [ ] P1-T01 Worker/Test scaffold — source implemented; full Vitest verification pending npm registry access
- [ ] P1-T02 D1 schema + migration test setup — SQL smoke verified; remote D1 UUID intentionally not created here
- [ ] P1-T03 Project/Core URL repository — source implemented; full Vitest verification pending npm registry access
- [ ] P1-T04 Admin/read-only auth + router — source implemented; full Vitest verification pending npm registry access
- [ ] P1-T05 Project Registry API — source implemented; full Vitest verification pending npm registry access
- [ ] P1-T06 Google OAuth connection + local authorization helper — source/tests implemented; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T07 Search Console date windows — source/tests implemented; runtime smoke verified; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T08 Search Analytics REST client — source/tests implemented; runtime smoke verified; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T09 Search Analytics historical collection + upserts — source/tests implemented; runtime + SQL upsert smoke verified; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T10 Core URL Inspection collection — source/tests implemented; bounded-concurrency + persistence smoke verified; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T11 GSC Sitemap collection — source/tests implemented; scoped typecheck + client/collector/repository/SQLite smoke verified; full Vitest verification pending PatchSync/local npm install
- [ ] P1-T12 Collection-run logging + source isolation
- [ ] P1-T13 Cron + manual GSC collection
- [ ] P1-T14 Read-only status aggregation API
- [ ] P1-T15 Health + secure diagnostics
- [ ] P1-T16 Configure ZeroParse + VetaTool
- [ ] P1-T17 Production secrets/migrations/deploy
- [ ] P1-T18 Real GSC smoke tests
- [ ] P1-T19 ChatGPT reporting handoff/security contract

### Phase 1 top-level TODO

- [ ] M00 Project Registry implemented and tested
- [ ] M01 Google OAuth/token refresh implemented
- [ ] M01 Search Analytics collector implemented
- [ ] M01 URL Inspection collector implemented — source complete; full verification pending PatchSync/local npm install
- [ ] M01 Sitemap collector implemented
- [ ] M08 collection-run scheduler and isolation implemented
- [ ] M09 D1 migrations and historical upserts implemented
- [ ] M13 `/v1/projects/:id/status` implemented
- [ ] M17 admin/read-only authorization implemented
- [ ] M18 `/health` and structured run logging implemented
- [ ] Configure ZeroParse project
- [ ] Configure VetaTool project
- [ ] Real GSC smoke test for ZeroParse
- [ ] Real GSC smoke test for VetaTool
- [ ] Update ChatGPT ZeroParse scheduled report to consume site-insights
