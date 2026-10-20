import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm dev:api", url: "http://localhost:4000/api/ready", reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: "pnpm dev:web", url: "http://localhost:3000", reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
});
