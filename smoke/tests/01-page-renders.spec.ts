import { test, expect } from '@playwright/test'

test('page renders: h1 visible', async ({ page }) => {
  await page.goto('')
  await expect(page.getByRole('heading', { level: 1, name: /Mutato/i })).toBeVisible()
})
