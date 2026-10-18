import { defineConfig } from "vitest/config";

// Job-level unit tests. Prisma + service-auth are mocked per-file so this
// suite runs hermetically without a live Postgres or Redis. Matches the
// crm-service vitest layout.
//
// Same concurrency guards as the other services (see accounting-service's
// vitest.config.ts for the rationale) — kept consistent so a workspace-wide
// `pnpm -r test` behaves predictably.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
  },
});
