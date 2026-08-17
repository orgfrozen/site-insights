import type {
  CreateProjectInput,
  Project,
  ReplaceCoreUrlsInput,
  UpdateProjectInput,
} from "../domain/types";

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
const LANGUAGE_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export class ProjectValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ProjectValidationError";
  }
}

function asObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ProjectValidationError("invalid_request_body");
  }
  return input as Record<string, unknown>;
}

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProjectValidationError(code);
  }
  return value.trim();
}

function optionalNullableString(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ProjectValidationError(code);
  return value.trim() || null;
}

function httpsUrl(value: unknown, code: string): URL {
  const raw = requiredString(value, code);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProjectValidationError(code);
  }
  if (parsed.protocol !== "https:") throw new ProjectValidationError(code);
  return parsed;
}

function validateTimezone(value: unknown): string {
  const timezone = requiredString(value, "invalid_timezone");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new ProjectValidationError("invalid_timezone");
  }
  return timezone;
}

function validateLanguages(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ProjectValidationError("invalid_languages");
  }
  const languages = value.map((item) => requiredString(item, "invalid_languages"));
  if (!languages.every((language) => LANGUAGE_RE.test(language))) {
    throw new ProjectValidationError("invalid_languages");
  }
  return [...new Set(languages)];
}

function validateGscProperty(value: unknown): string {
  const property = requiredString(value, "invalid_gsc_property");
  if (property.startsWith("sc-domain:") && property.length > "sc-domain:".length) return property;
  try {
    const parsed = new URL(property);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return property;
  } catch {
    // fall through
  }
  throw new ProjectValidationError("invalid_gsc_property");
}

function validateSameHostHttpsUrl(value: unknown, host: string, code: string): string {
  const parsed = httpsUrl(value, code);
  if (parsed.hostname.toLowerCase() !== host.toLowerCase()) {
    throw new ProjectValidationError(code);
  }
  return parsed.toString();
}

export function validateProjectInput(input: unknown): CreateProjectInput {
  const body = asObject(input);
  const id = requiredString(body.id, "invalid_project_id");
  if (!PROJECT_ID_RE.test(id)) throw new ProjectValidationError("invalid_project_id");

  const name = requiredString(body.name, "invalid_project_name");
  const domain = requiredString(body.domain, "invalid_domain").toLowerCase();
  const base = httpsUrl(body.baseUrl, "invalid_base_url");
  if (base.hostname.toLowerCase() !== domain) throw new ProjectValidationError("domain_mismatch");

  const canonicalHost = typeof body.canonicalHost === "string" && body.canonicalHost.trim()
    ? body.canonicalHost.trim().toLowerCase()
    : base.hostname.toLowerCase();
  if (canonicalHost !== base.hostname.toLowerCase()) {
    throw new ProjectValidationError("canonical_host_mismatch");
  }

  const robotsUrl = validateSameHostHttpsUrl(body.robotsUrl, canonicalHost, "invalid_robots_url");
  if (!Array.isArray(body.sitemapUrls)) throw new ProjectValidationError("invalid_sitemap_urls");
  const sitemapUrls = body.sitemapUrls.map((value) =>
    validateSameHostHttpsUrl(value, canonicalHost, "invalid_sitemap_urls"),
  );
  if (sitemapUrls.length === 0) throw new ProjectValidationError("invalid_sitemap_urls");

  const languages = validateLanguages(body.languages);
  const primaryLanguage = requiredString(body.primaryLanguage, "invalid_primary_language");
  if (!LANGUAGE_RE.test(primaryLanguage) || !languages.includes(primaryLanguage)) {
    throw new ProjectValidationError("invalid_primary_language");
  }

  const includeWww = body.includeWww === undefined ? false : body.includeWww;
  if (typeof includeWww !== "boolean") throw new ProjectValidationError("invalid_include_www");

  return {
    id,
    name,
    domain,
    baseUrl: base.origin + (base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "")),
    timezone: validateTimezone(body.timezone),
    gscProperty: validateGscProperty(body.gscProperty),
    gaProperty: optionalNullableString(body.gaProperty, "invalid_ga_property"),
    cloudflareZoneId: optionalNullableString(body.cloudflareZoneId, "invalid_cloudflare_zone_id"),
    robotsUrl,
    sitemapUrls,
    primaryLanguage,
    languages,
    canonicalHost,
    includeWww,
  };
}

export function validateProjectPatch(input: unknown): UpdateProjectInput {
  const body = asObject(input);
  const allowed = new Set([
    "name", "domain", "baseUrl", "timezone", "gscProperty", "gaProperty",
    "cloudflareZoneId", "robotsUrl", "sitemapUrls", "primaryLanguage",
    "languages", "canonicalHost", "includeWww",
  ]);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) throw new ProjectValidationError("invalid_project_patch");
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) throw new ProjectValidationError("empty_project_patch");
  return patch as UpdateProjectInput;
}

export function validateCoreUrls(project: Project, input: unknown): ReplaceCoreUrlsInput {
  const body = asObject(input);
  if (!Array.isArray(body.urls)) throw new ProjectValidationError("invalid_core_urls");

  const seen = new Set<string>();
  const urls = body.urls.map((raw) => {
    const item = asObject(raw);
    const parsed = httpsUrl(item.url, "invalid_core_url");
    if (parsed.hostname.toLowerCase() !== project.canonicalHost.toLowerCase()) {
      throw new ProjectValidationError("invalid_core_url");
    }
    const url = parsed.toString();
    if (seen.has(url)) throw new ProjectValidationError("duplicate_core_url");
    seen.add(url);

    const pageType = item.pageType === undefined ? "core" : requiredString(item.pageType, "invalid_core_url");
    const priority = item.priority === undefined ? 100 : item.priority;
    if (!Number.isInteger(priority) || (priority as number) < 0) {
      throw new ProjectValidationError("invalid_core_url");
    }
    const enabled = item.enabled === undefined ? true : item.enabled;
    const inspectionEnabled = item.inspectionEnabled === undefined ? true : item.inspectionEnabled;
    if (typeof enabled !== "boolean" || typeof inspectionEnabled !== "boolean") {
      throw new ProjectValidationError("invalid_core_url");
    }
    return {
      url,
      pageType,
      priority: priority as number,
      enabled,
      inspectionEnabled,
    };
  });

  return { urls };
}

export function mergeAndValidateProjectPatch(project: Project, input: unknown): CreateProjectInput {
  const patch = validateProjectPatch(input);
  return validateProjectInput({
    id: project.id,
    name: patch.name ?? project.name,
    domain: patch.domain ?? project.domain,
    baseUrl: patch.baseUrl ?? project.baseUrl,
    timezone: patch.timezone ?? project.timezone,
    gscProperty: patch.gscProperty ?? project.gscProperty,
    gaProperty: patch.gaProperty === undefined ? project.gaProperty : patch.gaProperty,
    cloudflareZoneId: patch.cloudflareZoneId === undefined ? project.cloudflareZoneId : patch.cloudflareZoneId,
    robotsUrl: patch.robotsUrl ?? project.robotsUrl,
    sitemapUrls: patch.sitemapUrls ?? project.sitemapUrls,
    primaryLanguage: patch.primaryLanguage ?? project.primaryLanguage,
    languages: patch.languages ?? project.languages,
    canonicalHost: patch.canonicalHost ?? project.canonicalHost,
    includeWww: patch.includeWww ?? project.includeWww,
  });
}
