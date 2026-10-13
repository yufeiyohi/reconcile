import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:4173/reconcile/",
    headless: true,
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
      args: ["--no-sandbox"],
    },
    trace: "off",
  },
  webServer: {
    env: { VITE_BASE_PATH: "/reconcile/" },
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173/reconcile/",
    reuseExistingServer: !process.env.CI,
  },
  reporter: "list",
});
