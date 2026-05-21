import { test, expect } from '@playwright/test'

test('extracted entities are highlighted with <mark> spans', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: /Extract entities/i }).click()
  await expect(page.getByText(/\d+ entities found/i)).toBeVisible({ timeout: 20_000 })
  const marks = page.locator('mark')
  expect(await marks.count()).toBeGreaterThan(0)
})
