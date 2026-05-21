import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, chip } from './_helpers'

test('add and remove an alt label on an instance', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Pickup').click()

  const altInput = page.getByPlaceholder('add an alt label (Enter)')
  await altInput.fill('ute')
  await altInput.press('Enter')
  await expect(chip(page, 'ute')).toBeVisible()

  await chip(page, 'ute').getByTitle('Remove').click()
  await expect(chip(page, 'ute')).toHaveCount(0)
})
