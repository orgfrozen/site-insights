import type { Project, ProjectCoreUrl } from "../domain/types";
import type { SiteInsightsEnv } from "../env";
import {
  GscUrlInspectionError,
  inspectUrl,
} from "./url-inspection-client";
import {
  UrlInspectionRepository,
  type UrlInspectionSnapshotWriter,
} from "./url-inspection-repository";

type Fetcher = typeof fetch;

export interface CollectUrlInspectionsOptions {
  project: Project;
  coreUrls: ProjectCoreUrl[];
  accessToken: string;
  concurrency: number;
  fetcher?: Fetcher;
  env?: SiteInsightsEnv;
  repository?: UrlInspectionSnapshotWriter;
  inspectedAt?: string;
}

export type UrlInspectionCollectionItem =
  | { url: string; ok: true }
  | { url: string; ok: false; errorCode: string };

export interface UrlInspectionCollectionResult {
  recordsWritten: number;
  succeeded: number;
  failed: number;
  results: UrlInspectionCollectionItem[];
}

async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("invalid_gsc_inspection_concurrency");
  }

  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

function errorCode(error: unknown): string {
  return error instanceof GscUrlInspectionError
    ? error.code
    : "gsc_url_inspection_unexpected_error";
}

function resolveRepository(options: CollectUrlInspectionsOptions): UrlInspectionSnapshotWriter {
  if (options.repository) return options.repository;
  if (options.env) return new UrlInspectionRepository(options.env.DB);
  throw new Error("gsc_url_inspection_repository_required");
}

export async function collectUrlInspections(
  options: CollectUrlInspectionsOptions,
): Promise<UrlInspectionCollectionResult> {
  const repository = resolveRepository(options);
  const fetcher = options.fetcher ?? fetch;
  const inspectedAt = options.inspectedAt ?? new Date().toISOString();
  const urls = options.coreUrls.filter((item) => item.enabled && item.inspectionEnabled);
  let recordsWritten = 0;

  const results = await mapConcurrent(urls, options.concurrency, async (item) => {
    try {
      const result = await inspectUrl(
        options.project.gscProperty,
        item.url,
        options.accessToken,
        fetcher,
      );
      await repository.saveSnapshot(options.project.id, item.url, inspectedAt, result);
      recordsWritten += 1;
      return { url: item.url, ok: true } as const;
    } catch (error) {
      return { url: item.url, ok: false, errorCode: errorCode(error) } as const;
    }
  });

  const succeeded = results.filter((item) => item.ok).length;
  return {
    recordsWritten,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}
