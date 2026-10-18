import { defineConfig } from "vitest/config";

// See services/accounting-service/vitest.config.ts for the rationale behind
// the pool/timeout/connection_limit knobs.
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
