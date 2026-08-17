import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const adminHeaders = {
  authorization: "Bearer test-admin-token",
  "content-type": "application/json",
};

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

describe("Phase 1 D1 schema", () => {
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
});

describe("project admin API", () => {
  it("creates and returns a valid project", async () => {
    const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify(validProject),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "zeroparse", status: "enabled" });
  });

  it("rejects an HTTP base URL", async () => {
    const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, baseUrl: "http://zeroparse.com" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a domain/base URL mismatch", async () => {
    const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, domain: "example.com" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("ProjectRepository", () => {
  it("creates and loads a project with ordered core URLs", async () => {
    const { ProjectRepository } = await import("../src/projects/project-repository");
    const repo = new ProjectRepository(env.DB);
    await repo.createProject({
      id: "repo-site",
      name: "Repo Site",
      domain: "repo.example",
      baseUrl: "https://repo.example",
      timezone: "Asia/Shanghai",
      gscProperty: "sc-domain:repo.example",
      robotsUrl: "https://repo.example/robots.txt",
      sitemapUrls: ["https://repo.example/sitemap.xml"],
      primaryLanguage: "en",
      languages: ["en", "zh"],
      canonicalHost: "repo.example",
      includeWww: false,
      gaProperty: null,
      cloudflareZoneId: null,
    });
    await repo.replaceCoreUrls("repo-site", [
      { url: "https://repo.example/b", pageType: "tool", priority: 20, inspectionEnabled: true },
      { url: "https://repo.example/", pageType: "home", priority: 10, inspectionEnabled: true },
    ]);

    expect(await repo.getProject("repo-site")).toMatchObject({
      id: "repo-site",
      status: "enabled",
      gscProperty: "sc-domain:repo.example",
    });
    expect((await repo.listCoreUrls("repo-site", true)).map((item) => item.url)).toEqual([
      "https://repo.example/",
      "https://repo.example/b",
    ]);
  });
});

describe("project admin API validation and lifecycle", () => {
  it("returns 409 for a duplicate domain", async () => {
    const first = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, id: "zero-one" }),
    });
    expect(first.status).toBe(201);

    const second = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, id: "zero-two", gscProperty: "sc-domain:another.example" }),
    });
    expect(second.status).toBe(409);
  });

  it("rejects core URLs outside the project canonical host", async () => {
    await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, id: "core-site" }),
    });
    const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects/core-site/core-urls", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        urls: [{ url: "https://example.com/wrong", pageType: "tool", priority: 10, inspectionEnabled: true }],
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_core_url" });
  });

  it("disables a project so enabled-only repository queries exclude it", async () => {
    await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ ...validProject, id: "disabled-site", domain: "disabled.example", baseUrl: "https://disabled.example", gscProperty: "sc-domain:disabled.example", robotsUrl: "https://disabled.example/robots.txt", sitemapUrls: ["https://disabled.example/sitemap.xml"] }),
    });
    const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects/disabled-site/disable", {
      method: "POST",
      headers: adminHeaders,
    });
    expect(response.status).toBe(200);

    const { ProjectRepository } = await import("../src/projects/project-repository");
    const enabled = await new ProjectRepository(env.DB).listProjects("enabled");
    expect(enabled.some((project) => project.id === "disabled-site")).toBe(false);
  });
});
