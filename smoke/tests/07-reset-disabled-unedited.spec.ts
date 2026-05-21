import { test, expect } from '@playwright/test'

test('reset button is disabled on a fresh, unedited load', async ({ page }) => {
  await page.goto('')
  const reset = page.getByRole('button', { name: /^reset$/i })
  await expect(reset).toBeVisible()
  await expect(reset).toBeDisabled()
})
