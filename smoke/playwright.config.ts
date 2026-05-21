import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.SMOKE_URL ?? 'https://craigtrim.com/product/mutato/'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 1,
  reporter: [['./reporter.ts']],
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
