import { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function gotoSmokeTest(page: Page): Promise<void> {
  await page.goto('')
  await page.locator('select').selectOption('smoketest')
  await expect(page.locator('div[draggable="true"]', { hasText: 'Vehicle' })).toBeVisible()
  // Default tree opens only depth-0; expand Car and Truck so instances are
  // visible. Tests that need instances rely on this.
  for (const parent of ['Car', 'Truck']) {
    const chevron = page.locator('div[draggable="true"]', { hasText: parent })
      .locator('span').filter({ hasText: '▸' }).first()
    if (await chevron.count()) await chevron.click()
  }
  await expect(page.locator('div[draggable="true"]', { hasText: 'Pickup' })).toBeVisible()
}

export function row(page: Page, label: string) {
  return page.locator('div[draggable="true"]', { hasText: label }).first()
}

export function chip(page: Page, value: string) {
  return page.locator('span').filter({ hasText: value }).filter({ has: page.getByTitle('Remove') })
}

export function labelInput(page: Page) {
  return page.locator('input[type="text"]:not([placeholder])').first()
}

export async function confirmDelete(page: Page): Promise<void> {
  await page.locator('[role="menuitem"]').filter({ hasText: /^delete$/i }).click()
  await page.locator('button').filter({ hasText: /^delete$/i }).click()
}
