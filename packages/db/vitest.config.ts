import { defineConfig } from "vitest/config";

// Coverage thresholds are enforced in CI (`test:coverage`). They intentionally
// only fence the pure-function helpers (tax/gl/loan-math/salary-formula/csv/
// dashboard-resolver/stripe/razorpay) — Prisma-integration code lives in
// service packages and doesn't run here. Raise these once the Postgres-backed
// integration suite (M11) lands.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Match the service-level knobs. 1073 tests here — most are pure-function
    // helpers with no DB, but a handful hit Prisma (integrations-live,
    // tenant-guard). The timeouts + worker cap prevent flakes when the suite
    // runs concurrently with the per-service suites via `pnpm -r test`.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "**/*.test.ts",
        "prisma/**",
        "scripts/**",
        "src/index.ts",
      ],
      thresholds: {
        lines: 40,
        functions: 40,
        branches: 60,
        statements: 40,
      },
    },
  },
});
