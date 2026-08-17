import type { Project } from "../domain/types";
import type { SiteInsightsEnv } from "../env";
import { listSitemaps } from "./sitemap-client";
import {
  SitemapRepository,
  type SitemapSnapshotWriter,
} from "./sitemap-repository";

type Fetcher = typeof fetch;

export interface CollectSitemapsOptions {
  project: Project;
  accessToken: string;
  fetcher?: Fetcher;
  env?: SiteInsightsEnv;
  repository?: SitemapSnapshotWriter;
  collectedAt?: string;
}

export interface SitemapCollectionResult {
  recordsWritten: number;
}

function resolveRepository(options: CollectSitemapsOptions): SitemapSnapshotWriter {
  if (options.repository) return options.repository;
  if (options.env) return new SitemapRepository(options.env.DB);
  throw new Error("gsc_sitemap_repository_required");
}

export async function collectSitemaps(
  options: CollectSitemapsOptions,
): Promise<SitemapCollectionResult> {
  const repository = resolveRepository(options);
  const sitemaps = await listSitemaps(
    options.project.gscProperty,
    options.accessToken,
    options.fetcher ?? fetch,
  );
  const collectedAt = options.collectedAt ?? new Date().toISOString();
  const recordsWritten = await repository.insertSnapshots(
    options.project.id,
    collectedAt,
    sitemaps,
  );
  return { recordsWritten };
}
