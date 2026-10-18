import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /ai-mode\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [["list"]],
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:4556",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
