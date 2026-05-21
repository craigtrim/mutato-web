import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, chip } from './_helpers'

test('add and remove an alt label on a class', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Truck').click()

  const altInput = page.getByPlaceholder('add an alt label (Enter)')
  await altInput.fill('lorry')
  await altInput.press('Enter')
  await expect(chip(page, 'lorry')).toBeVisible()

  await chip(page, 'lorry').getByTitle('Remove').click()
  await expect(chip(page, 'lorry')).toHaveCount(0)
})
