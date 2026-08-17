import type {
  CreateProjectInput,
  Project,
  ProjectCoreUrl,
  ProjectCoreUrlInput,
  ProjectStatus,
  UpdateProjectInput,
} from "../domain/types";

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  base_url: string;
  timezone: string;
  status: ProjectStatus;
  gsc_property: string;
  ga_property: string | null;
  cloudflare_zone_id: string | null;
  robots_url: string;
  sitemap_urls_json: string;
  primary_language: string;
  languages_json: string;
  canonical_host: string;
  include_www: number;
  created_at: string;
  updated_at: string;
}

interface ProjectCoreUrlRow {
  id: number;
  project_id: string;
  url: string;
  page_type: string;
  priority: number;
  enabled: number;
  inspection_enabled: number;
  created_at: string;
  updated_at: string;
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function mapProjectRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    baseUrl: row.base_url,
    timezone: row.timezone,
    status: row.status,
    gscProperty: row.gsc_property,
    gaProperty: row.ga_property,
    cloudflareZoneId: row.cloudflare_zone_id,
    robotsUrl: row.robots_url,
    sitemapUrls: parseStringArray(row.sitemap_urls_json),
    primaryLanguage: row.primary_language,
    languages: parseStringArray(row.languages_json),
    canonicalHost: row.canonical_host,
    includeWww: row.include_www === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCoreUrlRow(row: ProjectCoreUrlRow): ProjectCoreUrl {
  return {
    id: row.id,
    projectId: row.project_id,
    url: row.url,
    pageType: row.page_type,
    priority: row.priority,
    enabled: row.enabled === 1,
    inspectionEnabled: row.inspection_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ProjectRepository {
  constructor(private readonly db: D1Database) {}

  async createProject(input: CreateProjectInput): Promise<Project> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO projects (
        id, name, domain, base_url, timezone, status, gsc_property,
        ga_property, cloudflare_zone_id, robots_url, sitemap_urls_json,
        primary_language, languages_json, canonical_host, include_www,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'enabled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.id,
      input.name,
      input.domain,
      input.baseUrl,
      input.timezone,
      input.gscProperty,
      input.gaProperty,
      input.cloudflareZoneId,
      input.robotsUrl,
      JSON.stringify(input.sitemapUrls),
      input.primaryLanguage,
      JSON.stringify(input.languages),
      input.canonicalHost,
      input.includeWww ? 1 : 0,
      now,
      now,
    ).run();
    const project = await this.getProject(input.id);
    if (!project) throw new Error("project_create_failed");
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    const row = await this.db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>();
    return row ? mapProjectRow(row) : null;
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    const statement = status
      ? this.db.prepare("SELECT * FROM projects WHERE status = ? ORDER BY id ASC").bind(status)
      : this.db.prepare("SELECT * FROM projects ORDER BY id ASC");
    const rows = await statement.all<ProjectRow>();
    return rows.results.map(mapProjectRow);
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<Project | null> {
    const entries: Array<[string, unknown]> = [];
    const fieldMap: Record<keyof UpdateProjectInput, string> = {
      name: "name",
      domain: "domain",
      baseUrl: "base_url",
      timezone: "timezone",
      gscProperty: "gsc_property",
      gaProperty: "ga_property",
      cloudflareZoneId: "cloudflare_zone_id",
      robotsUrl: "robots_url",
      sitemapUrls: "sitemap_urls_json",
      primaryLanguage: "primary_language",
      languages: "languages_json",
      canonicalHost: "canonical_host",
      includeWww: "include_www",
    };

    for (const [key, value] of Object.entries(patch) as Array<[keyof UpdateProjectInput, UpdateProjectInput[keyof UpdateProjectInput]]>) {
      if (value === undefined) continue;
      let stored: unknown = value;
      if (key === "sitemapUrls" || key === "languages") stored = JSON.stringify(value);
      if (key === "includeWww") stored = value ? 1 : 0;
      entries.push([fieldMap[key], stored]);
    }
    if (entries.length === 0) return this.getProject(id);

    const now = new Date().toISOString();
    const assignments = entries.map(([column]) => `${column} = ?`).join(", ");
    await this.db.prepare(`UPDATE projects SET ${assignments}, updated_at = ? WHERE id = ?`)
      .bind(...entries.map(([, value]) => value), now, id)
      .run();
    return this.getProject(id);
  }

  async setProjectStatus(id: string, status: ProjectStatus): Promise<Project | null> {
    await this.db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, new Date().toISOString(), id)
      .run();
    return this.getProject(id);
  }

  async replaceCoreUrls(projectId: string, urls: ProjectCoreUrlInput[]): Promise<void> {
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      this.db.prepare("DELETE FROM project_core_urls WHERE project_id = ?").bind(projectId),
    ];
    for (const item of urls) {
      statements.push(
        this.db.prepare(`
          INSERT INTO project_core_urls (
            project_id, url, page_type, priority, enabled,
            inspection_enabled, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          projectId,
          item.url,
          item.pageType,
          item.priority,
          item.enabled === false ? 0 : 1,
          item.inspectionEnabled ? 1 : 0,
          now,
          now,
        ),
      );
    }
    await this.db.batch(statements);
  }

  async listCoreUrls(projectId: string, inspectionOnly = false): Promise<ProjectCoreUrl[]> {
    const sql = inspectionOnly
      ? "SELECT * FROM project_core_urls WHERE project_id = ? AND enabled = 1 AND inspection_enabled = 1 ORDER BY priority ASC, url ASC"
      : "SELECT * FROM project_core_urls WHERE project_id = ? ORDER BY priority ASC, url ASC";
    const rows = await this.db.prepare(sql).bind(projectId).all<ProjectCoreUrlRow>();
    return rows.results.map(mapCoreUrlRow);
  }
}
