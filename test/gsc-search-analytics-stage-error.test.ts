import { describe, expect, it } from "vitest";

import {
  searchAnalyticsDiagnosticFields,
  withSearchAnalyticsStage,
} from "../src/gsc/search-analytics-stage-error";

describe("Search Analytics stage diagnostics", () => {
  it("classifies unexpected errors without exposing the cause message", async () => {
    const secret = "refresh-token-must-not-leak";

    let caught: unknown;
    try {
      await withSearchAnalyticsStage("latest_final_date", async () => {
        throw new TypeError(secret);
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "gsc_search_analytics_latest_final_date_failed",
      message: "gsc_search_analytics_latest_final_date_failed",
    });
    expect(String(caught)).not.toContain(secret);
    expect(searchAnalyticsDiagnosticFields(caught)).toEqual({
      errorStage: "latest_final_date",
      errorType: "TypeError",
    });
  });

  it("preserves existing stable GSC errors", async () => {
    const stable = new Error("gsc_search_analytics_http_error:429:RESOURCE_EXHAUSTED");

    await expect(withSearchAnalyticsStage("fetch_datasets", async () => {
      throw stable;
    })).rejects.toBe(stable);
  });

  it("preserves repository errors that expose a stable object code", async () => {
    const stable = Object.assign(new Error("gsc_search_analytics_query_write_failed"), {
      code: "gsc_search_analytics_query_write_failed",
    });

    await expect(withSearchAnalyticsStage("write_snapshots", async () => {
      throw stable;
    })).rejects.toBe(stable);
  });
});
