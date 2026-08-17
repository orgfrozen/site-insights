import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            READ_API_TOKEN: "test-read-token",
            ADMIN_API_TOKEN: "test-admin-token",
          },
        },
      };
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    // Keep D1-mutating test files sequential for deterministic local runs.
    maxWorkers: 1,
  },
});
