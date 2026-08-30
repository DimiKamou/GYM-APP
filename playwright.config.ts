import { existsSync } from 'node:fs'

import { defineConfig, devices } from '@playwright/test'

const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    // This image ships Chromium at a fixed path, and its build number will not match whatever
    // @playwright/test we are pinned to. Point at it rather than downloading a second copy;
    // PLAYWRIGHT_CHROMIUM_PATH lets CI or a laptop override without editing the config.
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_PATH ??
        (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined),
    },
  },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    {
      // The gate phone is 412x839. The pad is laid out from the bottom up, so the only thing
      // that regresses on a SHORT screen is where its topmost row lands — and a 360x640 Android
      // is the shortest phone anyone is going to walk onto the gym floor with. Only the geometry
      // suite runs here; the rest of the app renders the same DOM at either height.
      name: 'small-android',
      testMatch: /tap-budget\.spec\.ts/,
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 640 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
})
