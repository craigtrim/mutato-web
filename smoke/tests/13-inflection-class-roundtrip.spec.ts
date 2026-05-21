import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, chip } from './_helpers'

test('add and remove an inflection on a class', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Truck').click()

  const inflInput = page.getByPlaceholder('add an inflection (Enter)')
  await inflInput.fill('lorries')
  await inflInput.press('Enter')
  await expect(chip(page, 'lorries')).toBeVisible()

  await chip(page, 'lorries').getByTitle('Remove').click()
  await expect(chip(page, 'lorries')).toHaveCount(0)
})
