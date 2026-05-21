import { test, expect } from '@playwright/test'

test('clicking a tree chevron collapses then re-expands a subtree', async ({ page }) => {
  await page.goto('')
  const rows = page.locator('div[draggable="true"]')
  await expect(rows.first()).toBeVisible()

  const openChevron = page.locator('div[draggable="true"] >> span', { hasText: /^▾$/ }).first()
  await expect(openChevron).toBeVisible()

  const before = await rows.count()
  await openChevron.click()
  await expect.poll(async () => rows.count(), { timeout: 5_000 }).toBeLessThan(before)

  const collapsedChevron = page.locator('div[draggable="true"] >> span', { hasText: /^▸$/ }).first()
  await collapsedChevron.click()
  await expect.poll(async () => rows.count(), { timeout: 5_000 }).toBe(before)
})
