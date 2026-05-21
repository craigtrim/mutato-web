import { test, expect } from '@playwright/test'

test('ontology tree populates with at least one entity', async ({ page }) => {
  await page.goto('')
  const rows = page.locator('div[draggable="true"]')
  await expect(rows.first()).toBeVisible()
  expect(await rows.count()).toBeGreaterThan(0)
})
