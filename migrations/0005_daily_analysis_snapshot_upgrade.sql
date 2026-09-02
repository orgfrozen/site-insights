ALTER TABLE daily_analysis_snapshots
ADD COLUMN task_refresh_pending INTEGER NOT NULL DEFAULT 0;
