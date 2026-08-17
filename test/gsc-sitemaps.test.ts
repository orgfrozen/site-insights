import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { Project } from "../src/domain/types";
import { collectSitemaps } from "../src/gsc/sitemap-collector";
import {
  GscSitemapError,
  listSitemaps,
} from "../src/gsc/sitemap-client";
import { ProjectRepository } from "../src/projects/project-repository";
import { fakeFetchSequence } from "./helpers/fake-fetch";

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

function sitemapPayload() {
  return {
    sitemap: [
      {
        path: "https://zeroparse.com/sitemap.xml",
        lastSubmitted: "2026-08-15T01:00:00Z",
        lastDownloaded: "2026-08-16T02:30:00Z",
        isPending: false,
        isSitemapsIndex: true,
        type: "sitemap",
        errors: "1",
        warnings: 2,
        contents: [{ type: "web", submitted: "42", indexed: "39" }],
      },
      {
        path: "https://zeroparse.com/blog-sitemap.xml",
      },
    ],
  };
}

describe("Search Console sitemap client", () => {
  it("lists sitemaps for an encoded Domain Property with Bearer auth", async () => {
    const { fetcher, calls } = fakeFetchSequence([Response.json(sitemapPayload())]);

    const result = await listSitemaps(project.gscProperty, "access-token", fetcher);

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Azeroparse.com/sitemaps",
    );
    expect(calls[0]?.init?.method).toBe("GET");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      path: "https://zeroparse.com/sitemap.xml",
      errors: 1,
      warnings: 2,
      isPending: false,
      isSitemapsIndex: true,
    });
    expect(result[1]).toMatchObject({
      path: "https://zeroparse.com/blog-sitemap.xml",
      errors: 0,
      warnings: 0,
      contents: [],
    });
  });

  it("uses stable sanitized errors for HTTP and malformed responses", async () => {
    const token = "secret-access-token";
    const httpFetch = fakeFetchSequence([
      new Response(`quota failed ${token}`, { status: 429 }),
    ]).fetcher;

    await expect(listSitemaps(project.gscProperty, token, httpFetch)).rejects.toMatchObject({
      name: "GscSitemapError",
      code: "gsc_sitemaps_http_error",
      status: 429,
    });

    const invalidFetch = fakeFetchSequence([Response.json({ sitemap: {} })]).fetcher;
    await expect(listSitemaps(project.gscProperty, token, invalidFetch)).rejects.toMatchObject({
      code: "gsc_sitemaps_invalid_response",
      status: 502,
    });

    try {
      await listSitemaps(
        project.gscProperty,
        token,
        fakeFetchSequence([new Response("bad", { status: 500 })]).fetcher,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(GscSitemapError);
      expect(String(error)).not.toContain(token);
    }
  });
});

describe("Search Console sitemap collection", () => {
  it("persists immutable normalized snapshots for every sitemap entry", async () => {
    await seedProject();
    const { fetcher } = fakeFetchSequence([Response.json(sitemapPayload())]);

    const result = await collectSitemaps({
      project,
      accessToken: "access-token",
      env: env as typeof env,
      fetcher,
      collectedAt: "2026-08-17T06:00:00.000Z",
    });

    expect(result).toEqual({ recordsWritten: 2 });
    const rows = await env.DB.prepare(
      "SELECT * FROM sitemap_snapshots WHERE project_id = ? ORDER BY path",
    ).bind(project.id).all<Record<string, unknown>>();

    expect(rows.results).toHaveLength(2);
    const main = rows.results.find((row) => row.path === "https://zeroparse.com/sitemap.xml");
    const blog = rows.results.find((row) => row.path === "https://zeroparse.com/blog-sitemap.xml");
    expect(main).toMatchObject({
      project_id: "zeroparse",
      collected_at: "2026-08-17T06:00:00.000Z",
      last_submitted: "2026-08-15T01:00:00Z",
      last_downloaded: "2026-08-16T02:30:00Z",
      is_pending: 0,
      is_sitemaps_index: 1,
      type: "sitemap",
      errors: 1,
      warnings: 2,
    });
    expect(JSON.parse(String(main?.contents_json))).toEqual([
      { type: "web", submitted: "42", indexed: "39" },
    ]);
    expect(JSON.parse(String(main?.raw_json))).toMatchObject({
      path: "https://zeroparse.com/sitemap.xml",
      errors: "1",
    });
    expect(blog).toMatchObject({ errors: 0, warnings: 0 });
    expect(JSON.parse(String(blog?.contents_json))).toEqual([]);
  });
});
