import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, labelInput } from './_helpers'

test('rename a class and rename it back', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Truck').click()

  const input = labelInput(page)
  await input.fill('Lorry')
  await input.press('Enter')
  await expect(row(page, 'Lorry')).toBeVisible()

  await input.fill('Truck')
  await input.press('Enter')
  await expect(row(page, 'Truck')).toBeVisible()
})
