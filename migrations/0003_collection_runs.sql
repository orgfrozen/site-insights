CREATE TABLE collection_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'partial')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_written INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT
);

CREATE INDEX idx_collection_runs_project_source_time
  ON collection_runs(project_id, source, started_at DESC);
