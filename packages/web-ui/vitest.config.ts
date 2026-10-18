import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    pool: "threads",
    minWorkers: 1,
    maxWorkers: 2,
  },
});
