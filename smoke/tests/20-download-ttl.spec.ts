import { test, expect } from '@playwright/test'
import { gotoSmokeTest } from './_helpers'

test('clicking ↓ TTL triggers a file download', async ({ page }) => {
  await gotoSmokeTest(page)

  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 })
  await page.getByRole('button', { name: /↓ TTL/ }).click()
  const dl = await downloadPromise
  expect(dl.suggestedFilename()).toMatch(/\.ttl$/i)
})
