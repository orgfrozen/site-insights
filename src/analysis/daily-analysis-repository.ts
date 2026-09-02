export type DailyAnalysisDispatchStatus = "pending" | "succeeded" | "failed";

export interface DailyAnalysisSnapshot {
  id: string;
  projectId: string;
  analysisDate: string;
  dataThrough: string | null;
  collectionStatus: "succeeded" | "partial" | "failed";
  generatedAt: string;
  snapshotMarkdown: string;
  snapshotJson: Record<string, unknown>;
  dispatchStatus: DailyAnalysisDispatchStatus;
  patchsyncTaskId: string | null;
  dispatchErrorCode: string | null;
  dispatchedAt: string | null;
  updatedAt: string;
}

export interface CreateDailyAnalysisSnapshotInput {
  projectId: string;
  analysisDate: string;
  dataThrough: string | null;
  collectionStatus: "succeeded" | "partial" | "failed";
  generatedAt: string;
  snapshotMarkdown: string;
  snapshotJson: Record<string, unknown>;
}

interface DailyAnalysisRow {
  id: string;
  project_id: string;
  analysis_date: string;
  data_through: string | null;
  collection_status: "succeeded" | "partial" | "failed";
  generated_at: string;
  snapshot_markdown: string;
  snapshot_json: string;
  dispatch_status: DailyAnalysisDispatchStatus;
  patchsync_task_id: string | null;
  dispatch_error_code: string | null;
  dispatched_at: string | null;
  updated_at: string;
}

function mapRow(row: DailyAnalysisRow): DailyAnalysisSnapshot {
  let snapshotJson: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.snapshot_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      snapshotJson = parsed as Record<string, unknown>;
    }
  } catch {
    snapshotJson = {};
  }
  return {
    id: row.id,
    projectId: row.project_id,
    analysisDate: row.analysis_date,
    dataThrough: row.data_through,
    collectionStatus: row.collection_status,
    generatedAt: row.generated_at,
    snapshotMarkdown: row.snapshot_markdown,
    snapshotJson,
    dispatchStatus: row.dispatch_status,
    patchsyncTaskId: row.patchsync_task_id,
    dispatchErrorCode: row.dispatch_error_code,
    dispatchedAt: row.dispatched_at,
    updatedAt: row.updated_at,
  };
}

function snapshotId(projectId: string, analysisDate: string): string {
  return `daily_${projectId}_${analysisDate}`;
}

export class DailyAnalysisRepository {
  constructor(private readonly db: D1Database) {}

  async get(projectId: string, analysisDate: string): Promise<DailyAnalysisSnapshot | null> {
    const row = await this.db.prepare(`
      SELECT * FROM daily_analysis_snapshots
      WHERE project_id = ? AND analysis_date = ?
    `).bind(projectId, analysisDate).first<DailyAnalysisRow>();
    return row ? mapRow(row) : null;
  }

  async getOrCreate(input: CreateDailyAnalysisSnapshotInput): Promise<DailyAnalysisSnapshot> {
    const now = input.generatedAt;
    await this.db.prepare(`
      INSERT OR IGNORE INTO daily_analysis_snapshots (
        id, project_id, analysis_date, data_through, collection_status,
        generated_at, snapshot_markdown, snapshot_json, dispatch_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(
      snapshotId(input.projectId, input.analysisDate),
      input.projectId,
      input.analysisDate,
      input.dataThrough,
      input.collectionStatus,
      input.generatedAt,
      input.snapshotMarkdown,
      JSON.stringify(input.snapshotJson),
      now,
    ).run();
    const snapshot = await this.get(input.projectId, input.analysisDate);
    if (!snapshot) throw new Error("daily_analysis_snapshot_create_failed");
    return snapshot;
  }

  async markDispatchSucceeded(
    projectId: string,
    analysisDate: string,
    taskId: string,
    now = new Date(),
  ): Promise<void> {
    const timestamp = now.toISOString();
    await this.db.prepare(`
      UPDATE daily_analysis_snapshots
      SET dispatch_status = 'succeeded', patchsync_task_id = ?, dispatch_error_code = NULL,
          dispatched_at = ?, updated_at = ?
      WHERE project_id = ? AND analysis_date = ?
    `).bind(taskId, timestamp, timestamp, projectId, analysisDate).run();
  }

  async markDispatchFailed(
    projectId: string,
    analysisDate: string,
    errorCode: string,
    now = new Date(),
  ): Promise<void> {
    const timestamp = now.toISOString();
    await this.db.prepare(`
      UPDATE daily_analysis_snapshots
      SET dispatch_status = 'failed', dispatch_error_code = ?, updated_at = ?
      WHERE project_id = ? AND analysis_date = ?
    `).bind(errorCode.slice(0, 200), timestamp, projectId, analysisDate).run();
  }
}
