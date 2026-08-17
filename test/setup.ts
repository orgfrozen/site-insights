import { env } from "cloudflare:workers";
import { applyD1Migrations, reset } from "cloudflare:test";
import { beforeEach } from "vitest";

beforeEach(async () => {
  await reset();
  const testEnv = env as typeof env & {
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});
