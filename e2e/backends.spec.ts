import { test, expect } from './fixtures';

test('switches away from a pending payment and recovers only on its original backend', async ({
  page,
  checkout,
}) => {
  const selected = checkout.backend === 'node' ? 'Node.js' : 'Elixir';
  const other = checkout.backend === 'node' ? 'Elixir' : 'Node.js';
  await page.goto('/');
  await page.getByRole('radio', { name: selected, exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Reviewer Example');
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.com');
  await page.getByLabel('Card details', { exact: true }).fill('4111111111110003');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect.poll(() => checkout.provider.calls.length).toBe(1);

  await page.getByRole('radio', { name: other, exact: true }).click();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Name', { exact: true })).toBeEditable();
  await expect(page.getByRole('button', { name: 'Increase number of bags' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('radio', { name: other, exact: true })).toBeChecked();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');

  await page.getByRole('radio', { name: selected, exact: true }).click();
  await expect(page.getByText('Checking payment status…', { exact: true })).toBeVisible();
  checkout.provider.release();
  await expect(page.getByRole('heading', { name: 'Booking Placed!' })).toBeVisible();
  expect(checkout.provider.calls).toHaveLength(1);
});
