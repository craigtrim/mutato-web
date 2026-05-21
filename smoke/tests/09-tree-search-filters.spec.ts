import { test, expect } from '@playwright/test'

test('typing in the tree search reduces visible row count', async ({ page }) => {
  await page.goto('')
  const rows = page.locator('div[draggable="true"]')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count()

  await page.getByPlaceholder(/Search labels/i).fill('hobbit')

  await expect.poll(async () => rows.count(), { timeout: 5_000 }).toBeLessThan(before)
})
