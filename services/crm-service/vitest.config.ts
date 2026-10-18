import { defineConfig } from "vitest/config";

// Two test flavors coexist here:
//   * *.test.ts       — route-level UNIT tests, Prisma mocked, no DB needed.
//   * *.integration.test.ts — REAL-DB tests. Point at lumaara_test locally;
//                             CI overrides via process.env.DATABASE_URL to
//                             use its ephemeral `lumaara` service DB.
// Setting DATABASE_URL unconditionally is safe for the mocked tests — they
// intercept prisma at import so no connection is opened.
//
// Timeouts bumped + workers capped at 2: tenant-guard init at @lumaara/db
// import takes 5-10s cold; parallel workers racing that init exceed the
// vitest default 10s hookTimeout. connection_limit on the URL caps Prisma's
// pool per worker so the whole workspace can't exhaust Postgres.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/lumaara_test?schema=public&connection_limit=5&pool_timeout=20",
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-must-be-32-chars-min",
      PORTAL_JWT_SECRET: "test-portal-jwt-secret-32-chars-min-",
      MASTER_SECRET_KEY: "test-master-secret-key-32-chars-min-",
    },
  },
});
