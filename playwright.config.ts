import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const baseURL = process.env.SOFTMATRIX_E2E_BASE_URL ?? "http://127.0.0.1:8787";
const vmE2E = process.env.SOFTMATRIX_E2E_VM === "1";
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: "./e2e",
  // The VM journey needs its fixture control plane and is run separately by
  // `pnpm test:e2e:vm`; keep the ordinary local release gate deterministic.
  testIgnore: vmE2E ? [] : ["**/vm-self-hosting.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH || existsSync(systemChrome)
      ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? systemChrome }
      : undefined,
  },
  webServer: process.env.SOFTMATRIX_E2E_BASE_URL
    ? undefined
    : {
      command: vmE2E ? "node scripts/run-vm-e2e.mjs" : "node scripts/run-e2e-server.mjs",
      url: baseURL,
      reuseExistingServer: false,
      // VM E2E builds the immutable release from a clean checkout, including the two
      // single-file gatekeeper apps. Allow that first build to finish on slower CI runners.
      timeout: vmE2E ? 300_000 : 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
});
