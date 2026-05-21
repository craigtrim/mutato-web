import { test, expect } from '@playwright/test'

test('extract returns at least one match against the default sample', async ({ page }) => {
  await page.goto('')
  await page.getByRole('button', { name: /Extract entities/i }).click()
  await expect(page.getByText(/\d+ entities found/i)).toBeVisible({ timeout: 20_000 })
  const stats = await page.getByText(/\d+ entities found/i).textContent()
  const match = stats?.match(/(\d+)\s+entities found/i)
  expect(Number(match?.[1] ?? 0)).toBeGreaterThan(0)
})
