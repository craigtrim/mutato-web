import { test, expect } from '@playwright/test'

test('default sample text is seeded into textarea', async ({ page }) => {
  await page.goto('')
  const textarea = page.getByPlaceholder(/Paste a sentence/i)
  await expect(textarea).toBeVisible()
  const value = await textarea.inputValue()
  expect(value.length).toBeGreaterThan(0)
})
