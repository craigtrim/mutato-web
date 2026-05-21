import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, confirmDelete } from './_helpers'

test('create and delete a subclass under an existing class', async ({ page }) => {
  await gotoSmokeTest(page)

  await row(page, 'Truck').click({ button: 'right' })
  page.once('dialog', d => d.accept('Lorry'))
  await page.getByRole('menuitem', { name: /add subclass/i }).click()
  await expect(row(page, 'Lorry')).toBeVisible()

  await row(page, 'Lorry').click({ button: 'right' })
  await confirmDelete(page)
  await expect(row(page, 'Lorry')).toHaveCount(0)
})
