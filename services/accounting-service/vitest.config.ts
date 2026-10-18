import { defineConfig } from "vitest/config";

// Test config for accounting-service.
//
// Integration tests point at a dedicated `lumaara_test` database on
// localhost so they can exercise real Prisma queries — including the
// tenant-isolation guarantee that mocked tests can only assert
// syntactically. `env` here is applied BEFORE any test module loads,
// which matters: prisma's client instantiates from process.env at
// import time. dotenv (via env-autoload) doesn't override existing
// values, so this DATABASE_URL wins over root `.env`.
//
// Concurrency note: tenant-guard middleware init at @lumaara/db import
// time takes 5-10s on a cold cache (193 models). Default vitest spawns
// workers = CPUs - 1 and each worker pays that cost in parallel — fine
// on fast CI, flaky on a loaded dev machine. maxThreads=2 keeps the
// contention bounded; hookTimeout bumped so beforeAll surviving the
// init doesn't false-fail. connection_limit on the DATABASE_URL caps
// Prisma's pool per worker so 8 services × N workers can't exhaust
// Postgres's connection table.
//
// To bootstrap the test DB on a fresh machine:
//   psql -U postgres -c "CREATE DATABASE lumaara_test"
//   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lumaara_test?schema=public" \
//     pnpm --filter @lumaara/db db:deploy
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
    env: {
      // Local dev defaults to a dedicated `lumaara_test` DB. CI sets
      // DATABASE_URL to its ephemeral `lumaara` service DB — respect it if
      // provided so we don't need two migration sets to keep in sync.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://postgres:postgres@localhost:5432/lumaara_test?schema=public&connection_limit=5&pool_timeout=20",
      NODE_ENV: "test",
      // Secrets are always hardcoded to known 32-char values — even in CI —
      // to avoid the secret validator tripping on shorter CI defaults.
      JWT_SECRET: "test-jwt-secret-must-be-32-chars-min",
      PORTAL_JWT_SECRET: "test-portal-jwt-secret-32-chars-min-",
      MASTER_SECRET_KEY: "test-master-secret-key-32-chars-min-",
    },
  },
});
