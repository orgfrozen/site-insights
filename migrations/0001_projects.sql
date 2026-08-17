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
