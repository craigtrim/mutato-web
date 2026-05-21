import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, chip } from './_helpers'

test('reset reverts an edit to the pristine ontology', async ({ page }) => {
  await gotoSmokeTest(page)
  await row(page, 'Truck').click()

  const altInput = page.getByPlaceholder('add an alt label (Enter)')
  await altInput.fill('lorry')
  await altInput.press('Enter')
  await expect(chip(page, 'lorry')).toBeVisible()

  await page.getByRole('button', { name: /^reset$/i }).click()
  await expect(chip(page, 'lorry')).toHaveCount(0)
})
