import { describe, expect, it } from "vitest";
import { SearchAnalyticsClient } from "../src/gsc/search-analytics-client";
import { fakeFetchSequence } from "./helpers/fake-fetch";

function rows(count: number, prefix = "row") {
  return Array.from({ length: count }, (_, index) => ({
    keys: [`${prefix}-${index}`],
    clicks: index,
    impressions: index + 1,
    ctr: 0.25,
    position: 10.5,
  }));
}

describe("SearchAnalyticsClient", () => {
  it("encodes a Domain Property and sends finalized Search Analytics request fields", async () => {
    const { fetcher, calls } = fakeFetchSequence([
      Response.json({ rows: [{ keys: ["2026-08-15", "large json viewer"], clicks: 2, impressions: 20, ctr: 0.1, position: 8.5 }] }),
    ]);
    const client = new SearchAnalyticsClient("access-token", fetcher);

    const response = await client.query("sc-domain:zeroparse.com", {
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      dimensions: ["date", "query"],
    });

    expect(response.rows).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Azeroparse.com/searchAnalytics/query",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("Authorization")).toBe("Bearer access-token");
    expect(new Headers(calls[0]?.init?.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      dimensions: ["date", "query"],
      type: "web",
      dataState: "final",
      rowLimit: 25000,
      startRow: 0,
    });
  });

  it("paginates in 25,000-row pages until Google returns a short page", async () => {
    const firstPage = rows(25_000, "first");
    const secondPage = rows(2, "second");
    const { fetcher, calls } = fakeFetchSequence([
      Response.json({ rows: firstPage }),
      Response.json({ rows: secondPage }),
    ]);
    const client = new SearchAnalyticsClient("access-token", fetcher);

    const result = await client.queryAll("sc-domain:zeroparse.com", {
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      dimensions: ["query"],
    });

    expect(result).toHaveLength(25_002);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[0]?.init?.body)).startRow).toBe(0);
    expect(JSON.parse(String(calls[1]?.init?.body)).startRow).toBe(25_000);
  });

  it("returns null when no finalized date rows exist and otherwise returns the latest row date", async () => {
    const { fetcher } = fakeFetchSequence([
      Response.json({ rows: [] }),
      Response.json({
        rows: [
          { keys: ["2026-08-13"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
          { keys: ["2026-08-15"], clicks: 1, impressions: 1, ctr: 1, position: 1 },
        ],
      }),
    ]);
    const client = new SearchAnalyticsClient("access-token", fetcher);

    await expect(client.findLatestFinalDate("sc-domain:zeroparse.com", "2026-08-01", "2026-08-15")).resolves.toBeNull();
    await expect(client.findLatestFinalDate("sc-domain:zeroparse.com", "2026-08-01", "2026-08-15")).resolves.toBe("2026-08-15");
  });

  it("invokes the fetcher as a plain function without binding the client as this", async () => {
    let receiver: unknown = Symbol("not-called");
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(Response.json({ rows: [] }));
    } as typeof fetch;
    const client = new SearchAnalyticsClient("access-token", fetcher);

    await client.query("sc-domain:zeroparse.com", {
      startDate: "2026-08-01",
      endDate: "2026-08-15",
      dimensions: ["date"],
    });

    expect(receiver).toBeUndefined();
  });

  it("throws stable sanitized errors for Google HTTP failures and malformed responses", async () => {
    const { fetcher } = fakeFetchSequence([
      new Response(JSON.stringify({ error: { message: "quota exceeded", status: "RESOURCE_EXHAUSTED" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const client = new SearchAnalyticsClient("super-secret-token", fetcher);

    await expect(
      client.query("sc-domain:zeroparse.com", { startDate: "2026-08-01", endDate: "2026-08-15" }),
    ).rejects.toThrow("gsc_search_analytics_http_error:429:RESOURCE_EXHAUSTED");

    await expect(
      client.query("sc-domain:zeroparse.com", { startDate: "2026-08-01", endDate: "2026-08-15" }),
    ).rejects.toThrow("gsc_search_analytics_invalid_response");
  });
});
