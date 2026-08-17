export const COLLECTION_SOURCES = [
  "gsc_search_analytics",
  "gsc_sitemaps",
  "gsc_url_inspection",
] as const;

export type CollectionSource = (typeof COLLECTION_SOURCES)[number];
export type CollectionTriggerType = "cron" | "manual";
export type CollectionRunStatus = "succeeded" | "failed" | "partial";

export interface RunOutcome {
  status: CollectionRunStatus;
  recordsWritten: number;
  errorCode?: string;
  errorMessage?: string;
}

function sanitizeErrorMessage(outcome: RunOutcome): string | null {
  if (!outcome.errorCode) return null;
  const candidate = outcome.errorMessage ?? outcome.errorCode;
  if (candidate === outcome.errorCode) return candidate.slice(0, 1000);
  if (
    candidate.startsWith(`${outcome.errorCode}:`) &&
    /^[A-Za-z0-9_.:-]+$/.test(candidate)
  ) {
    return candidate.slice(0, 1000);
  }
  return outcome.errorCode.slice(0, 1000);
}

export class RunRepository {
  constructor(private readonly db: D1Database) {}

  async start(
    projectId: string,
    source: CollectionSource,
    triggerType: CollectionTriggerType,
  ): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.prepare(
      "INSERT INTO collection_runs (id, project_id, source, trigger_type, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)",
    ).bind(id, projectId, source, triggerType, new Date().toISOString()).run();
    return id;
  }

  async finish(runId: string, outcome: RunOutcome): Promise<void> {
    await this.db.prepare(`
      UPDATE collection_runs
      SET status = ?, completed_at = ?, records_written = ?, error_code = ?, error_message = ?
      WHERE id = ?
    `).bind(
      outcome.status,
      new Date().toISOString(),
      outcome.recordsWritten,
      outcome.errorCode ?? null,
      sanitizeErrorMessage(outcome),
      runId,
    ).run();
  }
}
