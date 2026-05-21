import { test, expect } from '@playwright/test'

test('char counter reflects textarea length', async ({ page }) => {
  await page.goto('')
  const textarea = page.getByPlaceholder(/Paste a sentence/i)
  await textarea.fill('hello')
  await expect(page.getByText(/^\s*5\s*\/\s*\d+\s*$/)).toBeVisible()
})
