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
