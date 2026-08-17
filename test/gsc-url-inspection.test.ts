import { describe, expect, it } from "vitest";

import type { Project, ProjectCoreUrl } from "../src/domain/types";
import { collectUrlInspections } from "../src/gsc/url-inspection-collector";
import {
  GscUrlInspectionError,
  inspectUrl,
} from "../src/gsc/url-inspection-client";
import { fakeFetchSequence } from "./helpers/fake-fetch";

const project: Project = {
  id: "zeroparse",
  name: "ZeroParse",
  domain: "zeroparse.com",
  baseUrl: "https://zeroparse.com",
  timezone: "Asia/Tokyo",
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

function coreUrl(
  id: number,
  url: string,
  overrides: Partial<ProjectCoreUrl> = {},
): ProjectCoreUrl {
  return {
    id,
    projectId: project.id,
    url,
    pageType: "core",
    priority: id,
    enabled: true,
    inspectionEnabled: true,
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function inspectionResult(url: string) {
  return {
    inspectionResult: {
      inspectionResultLink: `https://search.google.com/search-console/inspect?resource_id=${encodeURIComponent(project.gscProperty)}&id=${encodeURIComponent(url)}`,
      indexStatusResult: {
        verdict: "PASS",
        coverageState: "Submitted and indexed",
        robotsTxtState: "ALLOWED",
        indexingState: "INDEXING_ALLOWED",
        lastCrawlTime: "2026-08-16T12:34:56Z",
        pageFetchState: "SUCCESSFUL",
        googleCanonical: url,
        userCanonical: url,
        crawledAs: "MOBILE",
        referringUrls: ["https://zeroparse.com/catalog"],
        sitemap: ["https://zeroparse.com/sitemap.xml"],
      },
      mobileUsabilityResult: {
        verdict: "PASS",
        issues: [],
      },
      richResultsResult: {
        verdict: "PASS",
        detectedItems: [{ richResultType: "Breadcrumbs", items: [] }],
      },
    },
  };
}

describe("URL Inspection client", () => {
  it("posts the expected Search Console URL Inspection request", async () => {
    const expectedUrl = "https://zeroparse.com/big-json-viewer";
    const { fetcher, calls } = fakeFetchSequence([
      Response.json(inspectionResult(expectedUrl)),
    ]);

    const result = await inspectUrl(
      project.gscProperty,
      expectedUrl,
      "access-token",
      fetcher,
    );

    expect(result.indexStatusResult?.verdict).toBe("PASS");
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe(
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
      "Bearer access-token",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      inspectionUrl: expectedUrl,
      siteUrl: "sc-domain:zeroparse.com",
      languageCode: "en-US",
    });
  });

  it("uses stable sanitized errors for HTTP and invalid responses", async () => {
    const token = "secret-access-token";
    const httpFetch = fakeFetchSequence([
      new Response(`quota failed ${token}`, { status: 429 }),
    ]).fetcher;

    await expect(
      inspectUrl(project.gscProperty, "https://zeroparse.com/", token, httpFetch),
    ).rejects.toMatchObject({
      name: "GscUrlInspectionError",
      code: "gsc_url_inspection_http_error",
      status: 429,
    });

    const invalidFetch = fakeFetchSequence([Response.json({})]).fetcher;
    await expect(
      inspectUrl(project.gscProperty, "https://zeroparse.com/", token, invalidFetch),
    ).rejects.toMatchObject({
      code: "gsc_url_inspection_invalid_response",
      status: 502,
    });

    const scalarFetch = fakeFetchSequence([Response.json("invalid")]).fetcher;
    await expect(
      inspectUrl(project.gscProperty, "https://zeroparse.com/", token, scalarFetch),
    ).rejects.toMatchObject({
      code: "gsc_url_inspection_invalid_response",
      status: 502,
    });

    try {
      await inspectUrl(
        project.gscProperty,
        "https://zeroparse.com/",
        token,
        fakeFetchSequence([new Response("bad", { status: 500 })]).fetcher,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(GscUrlInspectionError);
      expect(String(error)).not.toContain(token);
    }
  });
});

describe("URL Inspection collection", () => {
  it("normalizes and persists immutable snapshots for enabled inspection URLs", async () => {
    const saved: Array<{ projectId: string; url: string; inspectedAt: string; result: unknown }> = [];
    const urls = [
      coreUrl(1, "https://zeroparse.com/big-json-viewer"),
      coreUrl(2, "https://zeroparse.com/json-viewer"),
      coreUrl(3, "https://zeroparse.com/disabled", { enabled: false }),
      coreUrl(4, "https://zeroparse.com/no-inspect", { inspectionEnabled: false }),
    ];
    const { fetcher, calls } = fakeFetchSequence([
      Response.json(inspectionResult(urls[0].url)),
      Response.json(inspectionResult(urls[1].url)),
    ]);

    const result = await collectUrlInspections({
      project,
      coreUrls: urls,
      accessToken: "access-token",
      concurrency: 2,
      fetcher,
      inspectedAt: "2026-08-17T05:00:00.000Z",
      repository: {
        saveSnapshot: async (projectId, url, inspectedAt, inspection) => {
          saved.push({ projectId, url, inspectedAt, result: inspection });
        },
      },
    });

    expect(calls).toHaveLength(2);
    expect(result).toEqual({
      recordsWritten: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { url: urls[0].url, ok: true },
        { url: urls[1].url, ok: true },
      ],
    });
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      projectId: "zeroparse",
      url: "https://zeroparse.com/big-json-viewer",
      inspectedAt: "2026-08-17T05:00:00.000Z",
    });
  });

  it("bounds concurrency and isolates individual URL failures", async () => {
    const urls = Array.from({ length: 5 }, (_, index) =>
      coreUrl(index + 1, `https://zeroparse.com/page-${index + 1}`),
    );
    let active = 0;
    let maxActive = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { inspectionUrl: string };
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (body.inspectionUrl.endsWith("page-3")) {
        return new Response("failed", { status: 429 });
      }
      return Response.json(inspectionResult(body.inspectionUrl));
    };
    let writes = 0;

    const result = await collectUrlInspections({
      project,
      coreUrls: urls,
      accessToken: "access-token",
      concurrency: 2,
      fetcher,
      inspectedAt: "2026-08-17T05:00:00.000Z",
      repository: {
        saveSnapshot: async () => {
          writes += 1;
        },
      },
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(writes).toBe(4);
    expect(result.recordsWritten).toBe(4);
    expect(result.succeeded).toBe(4);
    expect(result.failed).toBe(1);
    expect(result.results[2]).toEqual({
      url: "https://zeroparse.com/page-3",
      ok: false,
      errorCode: "gsc_url_inspection_http_error",
    });
  });
});
