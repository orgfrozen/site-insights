import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("rejects a protected read route without a token", async () => {
  const response = await exports.default.fetch("https://site-insights.test/v1/projects");
  expect(response.status).toBe(401);
});

it("rejects an admin route when only the read token is supplied", async () => {
  const response = await exports.default.fetch("https://site-insights.test/v1/admin/projects", {
    headers: { authorization: "Bearer test-read-token" },
  });
  expect(response.status).toBe(403);
});

it("allows the admin token to cross the read auth boundary", async () => {
  const response = await exports.default.fetch("https://site-insights.test/v1/projects", {
    headers: { authorization: "Bearer test-admin-token" },
  });
  expect(response.status).toBe(404);
});
