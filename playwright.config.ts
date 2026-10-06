import { defineConfig, devices } from "@playwright/test";
import { z } from "zod";

const environment = z
  .object({ E2E_BASE_URL: z.url().optional(), E2E_PREVIEW: z.enum(["1"]).optional() })
  .parse(process.env);
const baseURL = environment.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  workers: 2,
  reporter: [["list"]],
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: environment.E2E_PREVIEW === "1" ? "npm run preview -w @pdf-insight/web" : "npm run dev:web",
    url: baseURL,
    env: { VITE_BASE: new URL(baseURL).pathname },
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } } },
    { name: "mobile-360", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
  ],
});
