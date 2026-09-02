CREATE TABLE daily_analysis_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  analysis_date TEXT NOT NULL,
  data_through TEXT,
  collection_status TEXT NOT NULL CHECK (collection_status IN ('succeeded', 'partial', 'failed')),
  generated_at TEXT NOT NULL,
  snapshot_markdown TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  dispatch_status TEXT NOT NULL DEFAULT 'pending' CHECK (dispatch_status IN ('pending', 'succeeded', 'failed')),
  patchsync_task_id TEXT,
  dispatch_error_code TEXT,
  dispatched_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, analysis_date)
);

CREATE INDEX idx_daily_analysis_dispatch
  ON daily_analysis_snapshots(dispatch_status, analysis_date, project_id);
