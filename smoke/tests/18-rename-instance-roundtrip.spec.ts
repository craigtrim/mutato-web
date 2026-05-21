import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, labelInput } from './_helpers'

test('rename an instance and rename it back', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Pickup').click()

  const input = labelInput(page)
  await input.fill('Ute')
  await input.press('Enter')
  await expect(row(page, 'Ute')).toBeVisible()

  await input.fill('Pickup')
  await input.press('Enter')
  await expect(row(page, 'Pickup')).toBeVisible()
})
