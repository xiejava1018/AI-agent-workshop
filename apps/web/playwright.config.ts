import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:30141",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    port: 30141,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PI_WEB_JWT_SECRET: "m1-test-secret",
    },
  },
});