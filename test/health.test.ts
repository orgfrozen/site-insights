import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /health", () => {
  it("returns a minimal public health response", async () => {
    const response = await exports.default.fetch("https://site-insights.test/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      service: "site-insights",
    });
  });
});
