import { test, expect } from '@playwright/test'

test('switching the ontology selector repopulates the tree', async ({ page }) => {
  await page.goto('')
  const rows = page.locator('div[draggable="true"]')
  await expect(rows.first()).toBeVisible()
  const firstBefore = (await rows.first().innerText()).trim()

  const select = page.locator('select')
  const options = select.locator('option')
  await expect(options.nth(1)).toBeAttached()
  const secondValue = await options.nth(1).getAttribute('value')
  if (!secondValue) throw new Error('second <option> has no value attribute')
  await select.selectOption(secondValue)

  await expect.poll(async () => (await rows.first().innerText()).trim(), {
    timeout: 15_000,
  }).not.toBe(firstBefore)
})
