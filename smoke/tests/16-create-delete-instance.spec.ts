import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, confirmDelete } from './_helpers'

test('create and delete an instance under an existing class', async ({ page }) => {
  await gotoSmokeTest(page)

  await row(page, 'Car').click({ button: 'right' })
  page.once('dialog', d => d.accept('Coupe'))
  await page.getByRole('menuitem', { name: /add instance/i }).click()
  await expect(row(page, 'Coupe')).toBeVisible()

  await row(page, 'Coupe').click({ button: 'right' })
  await confirmDelete(page)
  await expect(row(page, 'Coupe')).toHaveCount(0)
})
