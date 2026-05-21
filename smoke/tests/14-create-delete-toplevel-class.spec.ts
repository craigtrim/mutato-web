import { test, expect } from '@playwright/test'
import { gotoSmokeTest, row, confirmDelete } from './_helpers'

test('create and delete a top-level class', async ({ page }) => {
  await gotoSmokeTest(page)

  page.once('dialog', d => d.accept('Boat'))
  await page.getByRole('button', { name: /^\+ class$/ }).click()
  await expect(row(page, 'Boat')).toBeVisible()

  await row(page, 'Boat').click({ button: 'right' })
  await confirmDelete(page)
  await expect(row(page, 'Boat')).toHaveCount(0)
})
