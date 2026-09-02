import { describe, expect, it } from "vitest";

import {
  SearchAnalyticsRepository,
  type SearchAnalyticsSnapshots,
  type SearchMetricValues,
} from "../src/gsc/search-analytics-repository";

interface FakeStatement {
  sql: string;
  bind: (...values: unknown[]) => FakeStatement;
  run: () => Promise<unknown>;
}

class QueryBudgetDatabase {
  queries = 0;

  constructor(
    private readonly maxQueries: number,
    private readonly failWhenSqlIncludes?: string,
  ) {}

  private consume(count: number): void {
    this.queries += count;
    if (this.queries > this.maxQueries) {
      throw new Error(`d1_query_budget_exceeded:${this.queries}`);
    }
  }

  prepare(sql: string): FakeStatement {
    const statement: FakeStatement = {
      sql,
      bind: () => statement,
      run: async () => {
        this.consume(1);
        if (this.failWhenSqlIncludes && sql.includes(this.failWhenSqlIncludes)) {
          throw new Error("d1_write_failed");
        }
        return { success: true };
      },
    };
    return statement;
  }

  async batch(statements: FakeStatement[]): Promise<unknown[]> {
    this.consume(statements.length);
    const failed = statements.find((statement) =>
      this.failWhenSqlIncludes ? statement.sql.includes(this.failWhenSqlIncludes) : false,
    );
    if (failed) throw new Error("d1_write_failed");
    return statements.map(() => ({ success: true }));
  }
}

function metrics(index: number): SearchMetricValues {
  return {
    clicks: index % 7,
    impressions: index + 10,
    ctr: (index % 7) / (index + 10),
    position: 1 + (index % 90),
  };
}

function snapshotsAtProductionScale(): SearchAnalyticsSnapshots {
  const date = (index: number) => `2026-08-${String((index % 28) + 1).padStart(2, "0")}`;
  return {
    daily: Array.from({ length: 53 }, (_, index) => ({
      dataDate: date(index),
      ...metrics(index),
    })),
    queries: Array.from({ length: 1_599 }, (_, index) => ({
      dataDate: date(index),
      query: `query ${index}`,
      ...metrics(index),
    })),
    pages: Array.from({ length: 1_439 }, (_, index) => ({
      dataDate: date(index),
      page: `https://vetatool.com/tool-${index}`,
      ...metrics(index),
    })),
    queryPages: Array.from({ length: 1_647 }, (_, index) => ({
      dataDate: date(index),
      query: `query ${index}`,
      page: `https://vetatool.com/tool-${index}`,
      ...metrics(index),
    })),
    countries: Array.from({ length: 660 }, (_, index) => ({
      dataDate: date(index),
      country: `country-${index}`,
      ...metrics(index),
    })),
    devices: Array.from({ length: 43 }, (_, index) => ({
      dataDate: date(index),
      device: index % 2 === 0 ? "DESKTOP" : "MOBILE",
      ...metrics(index),
    })),
  };
}

function oneRowPerDataset(): SearchAnalyticsSnapshots {
  const values = metrics(1);
  return {
    daily: [{ dataDate: "2026-08-30", ...values }],
    queries: [{ dataDate: "2026-08-30", query: "json formatter", ...values }],
    pages: [{ dataDate: "2026-08-30", page: "https://vetatool.com/json", ...values }],
    queryPages: [{
      dataDate: "2026-08-30",
      query: "json formatter",
      page: "https://vetatool.com/json",
      ...values,
    }],
    countries: [{ dataDate: "2026-08-30", country: "usa", ...values }],
    devices: [{ dataDate: "2026-08-30", device: "DESKTOP", ...values }],
  };
}

describe("SearchAnalyticsRepository", () => {
  it("persists a production-scale backfill within a 50-query D1 invocation budget", async () => {
    const db = new QueryBudgetDatabase(50);
    const repository = new SearchAnalyticsRepository(db as unknown as D1Database);

    await expect(
      repository.upsertSnapshots(
        "vetatool",
        snapshotsAtProductionScale(),
        "2026-09-02T06:00:00.000Z",
      ),
    ).resolves.toBe(5_441);
    expect(db.queries).toBeLessThanOrEqual(50);
  });

  it("reports the dataset stage when a D1 bulk write fails", async () => {
    const db = new QueryBudgetDatabase(50, "gsc_query_metrics");
    const repository = new SearchAnalyticsRepository(db as unknown as D1Database);

    await expect(
      repository.upsertSnapshots(
        "vetatool",
        oneRowPerDataset(),
        "2026-09-02T06:00:00.000Z",
      ),
    ).rejects.toMatchObject({
      code: "gsc_search_analytics_query_write_failed",
      message: "gsc_search_analytics_query_write_failed",
    });
  });
});
