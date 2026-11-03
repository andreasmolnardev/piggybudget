import { expect, test } from '@playwright/test';

test('guest can open finance pages and save a transaction', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Welcome to Piggybudget' })).toBeVisible();

  await page.getByRole('button', { name: /continue|save|start/i }).first().click();
  await page.getByRole('link', { name: 'Transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
  await page.getByRole('link', { name: 'Budgets' }).click();
  await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
});
