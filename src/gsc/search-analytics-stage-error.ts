export type SearchAnalyticsStage =
  | "latest_final_date"
  | "stored_latest_date"
  | "fetch_datasets"
  | "normalize"
  | "write_snapshots";

interface ErrorWithCode {
  code?: unknown;
}

const SAFE_ERROR_TYPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_STABLE_CODE = /^(?:gsc_|invalid_gsc_|google_)[a-z0-9_]+$/;

function objectCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as ErrorWithCode).code;
  return typeof code === "string" && SAFE_STABLE_CODE.test(code) ? code : null;
}

function stableMessageCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const code = error.message.split(":", 1)[0];
  return SAFE_STABLE_CODE.test(code) ? code : null;
}

function safeErrorType(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  return SAFE_ERROR_TYPE.test(error.name) ? error.name : "Error";
}

export class SearchAnalyticsStageError extends Error {
  readonly code: string;
  readonly stage: SearchAnalyticsStage;
  readonly causeType: string;

  constructor(stage: SearchAnalyticsStage, cause: unknown) {
    const code = `gsc_search_analytics_${stage}_failed`;
    super(code);
    this.name = "SearchAnalyticsStageError";
    this.code = code;
    this.stage = stage;
    this.causeType = safeErrorType(cause);
  }
}

export async function withSearchAnalyticsStage<T>(
  stage: SearchAnalyticsStage,
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (objectCode(error) || stableMessageCode(error)) throw error;
    throw new SearchAnalyticsStageError(stage, error);
  }
}

export function searchAnalyticsDiagnosticFields(
  error: unknown,
): { errorStage: SearchAnalyticsStage; errorType: string } | null {
  if (!(error instanceof SearchAnalyticsStageError)) return null;
  return {
    errorStage: error.stage,
    errorType: error.causeType,
  };
}
