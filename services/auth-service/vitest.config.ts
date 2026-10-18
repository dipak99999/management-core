import { defineConfig } from "vitest/config";

// Service-level unit tests. Prisma is mocked at the module boundary so these
// stay hermetic (no DB). For real live-service HTTP tests, use the
// INTEGRATION=1 suite in packages/db/src/integration.test.ts.
//
// Timeouts bumped from vitest defaults because tenant-guard middleware init
// at @lumaara/db import time takes 5-10s on cold cache (193 models) — the
// first test file in a worker pays that cost before any assertion runs.
// maxThreads=2 keeps parallel workers from fighting over the CPU during
// that init; otherwise multiple files time out simultaneously under load.
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
