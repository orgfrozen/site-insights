import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Project } from "../src/domain/types";
import { collectSearchAnalytics } from "../src/gsc/search-analytics-collector";
import { SearchAnalyticsRepository } from "../src/gsc/search-analytics-repository";
import { ProjectRepository } from "../src/projects/project-repository";

const project: Project = {
  id: "zeroparse",
  name: "ZeroParse",
  domain: "zeroparse.com",
  baseUrl: "https://zeroparse.com",
  timezone: "Asia/Shanghai",
  status: "enabled",
  gscProperty: "sc-domain:zeroparse.com",
  gaProperty: null,
  cloudflareZoneId: null,
  robotsUrl: "https://zeroparse.com/robots.txt",
  sitemapUrls: ["https://zeroparse.com/sitemap.xml"],
  primaryLanguage: "en",
  languages: ["en", "zh"],
  canonicalHost: "zeroparse.com",
  includeWww: false,
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

type Call = { dimensions: string[]; startDate: string; endDate: string };

async function seedProject() {
  const repo = new ProjectRepository(env.DB);
  await repo.createProject({
    id: project.id,
    name: project.name,
    domain: project.domain,
    baseUrl: project.baseUrl,
    timezone: project.timezone,
    gscProperty: project.gscProperty,
    gaProperty: project.gaProperty,
    cloudflareZoneId: project.cloudflareZoneId,
    robotsUrl: project.robotsUrl,
    sitemapUrls: project.sitemapUrls,
    primaryLanguage: project.primaryLanguage,
    languages: project.languages,
    canonicalHost: project.canonicalHost,
    includeWww: project.includeWww,
  });
}

function collectorFetch(calls: Call[], multiplier = 1): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      startDate: string;
      endDate: string;
      dimensions?: string[];
    };
    const dimensions = body.dimensions ?? [];
    calls.push({ dimensions, startDate: body.startDate, endDate: body.endDate });

    if (dimensions.join(",") === "date" && body.startDate === "2026-08-04" && body.endDate === "2026-08-17") {
      return Response.json({
        rows: [
          { keys: ["2026-08-14"], clicks: 1, impressions: 10, ctr: 0.1, position: 7 },
          { keys: ["2026-08-15"], clicks: 2, impressions: 20, ctr: 0.1, position: 6 },
        ],
      });
    }

    const metric = { clicks: 2 * multiplier, impressions: 20 * multiplier, ctr: 0.1, position: 8.5 };
    const rowsByDimensions: Record<string, unknown[]> = {
      date: [{ keys: ["2026-08-15"], ...metric }],
      "date,query": [{ keys: ["2026-08-15", "large json viewer"], ...metric }],
      "date,page": [{ keys: ["2026-08-15", "https://zeroparse.com/big-json-viewer"], ...metric }],
      "date,query,page": [{ keys: ["2026-08-15", "large json viewer", "https://zeroparse.com/big-json-viewer"], ...metric }],
      "date,country": [{ keys: ["2026-08-15", "usa"], ...metric }],
      "date,device": [{ keys: ["2026-08-15", "DESKTOP"], ...metric }],
    };
    return Response.json({ rows: rowsByDimensions[dimensions.join(",")] ?? [] });
  };
}

describe("collectSearchAnalytics", () => {
  it("backfills 56 finalized days on first run and persists all six normalized datasets", async () => {
    await seedProject();
    const calls: Call[] = [];
    const testEnv = {
      ...(env as typeof env),
      GSC_INITIAL_BACKFILL_DAYS: "56",
      GSC_REFRESH_DAYS: "3",
    };

    const result = await collectSearchAnalytics({
      project,
      accessToken: "access-token",
      env: testEnv,
      fetcher: collectorFetch(calls),
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    expect(result).toEqual({ latestFinalDate: "2026-08-15", recordsWritten: 6 });
    expect(calls.slice(1)).toHaveLength(6);
    for (const call of calls.slice(1)) {
      expect(call.startDate).toBe("2026-06-21");
      expect(call.endDate).toBe("2026-08-15");
    }

    const daily = await env.DB.prepare("SELECT * FROM gsc_daily_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();
    const query = await env.DB.prepare("SELECT * FROM gsc_query_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();
    const page = await env.DB.prepare("SELECT * FROM gsc_page_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();
    const queryPage = await env.DB.prepare("SELECT * FROM gsc_query_page_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();
    const country = await env.DB.prepare("SELECT * FROM gsc_country_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();
    const device = await env.DB.prepare("SELECT * FROM gsc_device_metrics WHERE project_id = ?").bind(project.id).first<Record<string, unknown>>();

    expect(daily?.data_date).toBe("2026-08-15");
    expect(query?.query).toBe("large json viewer");
    expect(page?.page).toBe("https://zeroparse.com/big-json-viewer");
    expect(queryPage).toMatchObject({ query: "large json viewer", page: "https://zeroparse.com/big-json-viewer" });
    expect(country?.country).toBe("usa");
    expect(device?.device).toBe("DESKTOP");
  });

  it("refreshes only the latest configured finalized days and upserts existing primary keys", async () => {
    await seedProject();
    const testEnv = {
      ...(env as typeof env),
      GSC_INITIAL_BACKFILL_DAYS: "56",
      GSC_REFRESH_DAYS: "3",
    };
    const firstCalls: Call[] = [];
    await collectSearchAnalytics({
      project,
      accessToken: "access-token",
      env: testEnv,
      fetcher: collectorFetch(firstCalls, 1),
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    const secondCalls: Call[] = [];
    const result = await collectSearchAnalytics({
      project,
      accessToken: "access-token",
      env: testEnv,
      fetcher: collectorFetch(secondCalls, 2),
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    expect(result.recordsWritten).toBe(6);
    for (const call of secondCalls.slice(1)) {
      expect(call.startDate).toBe("2026-08-13");
      expect(call.endDate).toBe("2026-08-15");
    }

    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM gsc_query_metrics WHERE project_id = ? AND data_date = ? AND query = ?")
      .bind(project.id, "2026-08-15", "large json viewer")
      .first<{ count: number }>();
    const row = await env.DB.prepare("SELECT clicks, impressions FROM gsc_query_metrics WHERE project_id = ? AND data_date = ? AND query = ?")
      .bind(project.id, "2026-08-15", "large json viewer")
      .first<{ clicks: number; impressions: number }>();

    expect(count?.count).toBe(1);
    expect(row).toEqual({ clicks: 4, impressions: 40 });
    await expect(new SearchAnalyticsRepository(env.DB).getLatestDate(project.id)).resolves.toBe("2026-08-15");
  });

  it("returns an empty result when Google has no finalized date in the lookback window", async () => {
    const fetcher: typeof fetch = async () => Response.json({ rows: [] });
    const result = await collectSearchAnalytics({
      project,
      accessToken: "access-token",
      env: env as typeof env,
      fetcher,
      now: new Date("2026-08-17T12:00:00.000Z"),
    });

    expect(result).toEqual({ latestFinalDate: null, recordsWritten: 0 });
  });
});
