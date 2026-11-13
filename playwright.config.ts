import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 45_000,
  fullyParallel: true,
  reporter: "list",
  outputDir: "test-results",
  use: { baseURL: "http://localhost:4173", trace: "off" },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "unit", testMatch: /.*\.unit\.spec\.ts/ },
    {
      name: "desktop",
      testMatch: /.*\.e2e\.spec\.ts/,
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
    {
      name: "phone",
      testMatch: /.*\.e2e\.spec\.ts/,
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
