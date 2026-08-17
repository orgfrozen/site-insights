import type { GscSitemap } from "./sitemap-client";

export interface SitemapSnapshotWriter {
  insertSnapshots(
    projectId: string,
    collectedAt: string,
    sitemaps: GscSitemap[],
  ): Promise<number>;
}

function optionalBooleanInt(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

export class SitemapRepository implements SitemapSnapshotWriter {
  constructor(private readonly db: D1Database) {}

  async insertSnapshots(
    projectId: string,
    collectedAt: string,
    sitemaps: GscSitemap[],
  ): Promise<number> {
    if (sitemaps.length === 0) return 0;

    const statements = sitemaps.map((sitemap) =>
      this.db.prepare(`
        INSERT INTO sitemap_snapshots (
          project_id, path, collected_at, last_submitted, last_downloaded,
          is_pending, is_sitemaps_index, type, errors, warnings,
          contents_json, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        projectId,
        sitemap.path,
        collectedAt,
        sitemap.lastSubmitted,
        sitemap.lastDownloaded,
        optionalBooleanInt(sitemap.isPending),
        optionalBooleanInt(sitemap.isSitemapsIndex),
        sitemap.type,
        sitemap.errors,
        sitemap.warnings,
        JSON.stringify(sitemap.contents),
        JSON.stringify(sitemap.raw),
      ),
    );

    await this.db.batch(statements);
    return statements.length;
  }
}
