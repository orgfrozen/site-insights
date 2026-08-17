CREATE TABLE gsc_daily_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type)
);

CREATE TABLE gsc_query_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  query TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, query)
);

CREATE TABLE gsc_page_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  page TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, page)
);

CREATE TABLE gsc_query_page_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  query TEXT NOT NULL,
  page TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, query, page)
);

CREATE TABLE gsc_country_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  country TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, country)
);

CREATE TABLE gsc_device_metrics (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  data_date TEXT NOT NULL,
  search_type TEXT NOT NULL DEFAULT 'web',
  device TEXT NOT NULL,
  clicks REAL NOT NULL,
  impressions REAL NOT NULL,
  ctr REAL NOT NULL,
  position REAL NOT NULL,
  collected_at TEXT NOT NULL,
  PRIMARY KEY(project_id, data_date, search_type, device)
);

CREATE TABLE url_inspections (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  inspected_at TEXT NOT NULL,
  verdict TEXT,
  coverage_state TEXT,
  indexing_state TEXT,
  robots_txt_state TEXT,
  page_fetch_state TEXT,
  google_canonical TEXT,
  user_canonical TEXT,
  last_crawl_time TEXT,
  crawled_as TEXT,
  referring_urls_json TEXT NOT NULL DEFAULT '[]',
  sitemaps_json TEXT NOT NULL DEFAULT '[]',
  mobile_usability_json TEXT NOT NULL DEFAULT '{}',
  rich_results_json TEXT NOT NULL DEFAULT '{}',
  raw_json TEXT NOT NULL,
  PRIMARY KEY(project_id, url, inspected_at)
);

CREATE INDEX idx_url_inspections_latest
  ON url_inspections(project_id, url, inspected_at DESC);

CREATE TABLE sitemap_snapshots (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  last_submitted TEXT,
  last_downloaded TEXT,
  is_pending INTEGER,
  is_sitemaps_index INTEGER,
  type TEXT,
  errors INTEGER NOT NULL DEFAULT 0,
  warnings INTEGER NOT NULL DEFAULT 0,
  contents_json TEXT NOT NULL DEFAULT '[]',
  raw_json TEXT NOT NULL,
  PRIMARY KEY(project_id, path, collected_at)
);

CREATE INDEX idx_sitemap_snapshots_latest
  ON sitemap_snapshots(project_id, path, collected_at DESC);
CREATE INDEX idx_gsc_query_metrics_period
  ON gsc_query_metrics(project_id, data_date, impressions DESC);
CREATE INDEX idx_gsc_page_metrics_period
  ON gsc_page_metrics(project_id, data_date, impressions DESC);
CREATE INDEX idx_gsc_country_metrics_period
  ON gsc_country_metrics(project_id, data_date, impressions DESC);
CREATE INDEX idx_gsc_device_metrics_period
  ON gsc_device_metrics(project_id, data_date, impressions DESC);
