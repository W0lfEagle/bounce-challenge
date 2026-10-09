import type { Page } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures';

async function enterDetails(page: Page, cardNumber = '4111111111111111') {
  await page.goto('/');
  await page.getByLabel('Name', { exact: true }).fill('Reviewer Example');
  await page.getByLabel('Email', { exact: true }).fill('reviewer@example.com');
  await page.getByLabel('Card details', { exact: true }).fill(cardNumber);
}

test('books through the HTTP API and persists accepted pricing and transaction metadata', async ({
  page,
  checkout,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterDetails(page);
  await page.getByRole('button', { name: 'Increase number of bags' }).click();
  await expect(page.getByLabel('Total', { exact: true })).toHaveText('$11.80');
  await page.screenshot({ path: join(tmpdir(), 'bounce-review-form.png'), fullPage: true });
  await page.getByLabel('Card details', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Booking Placed!' })).toBeVisible();

  expect(checkout.provider.calls).toEqual([{ amount: 1180, currency: 'USD', lastFour: '1111' }]);
  expect(checkout.db.prepare('SELECT status, total_cents FROM bookings').get()).toEqual({
    status: 'confirmed',
    total_cents: 1180,
  });
  const attempt = checkout.db
    .prepare('SELECT transaction_id, transaction_json FROM payment_attempts')
    .get() as { transaction_id: string; transaction_json: string };
  expect(attempt.transaction_id).toBe('txn_demo_1');
  expect(JSON.parse(attempt.transaction_json)).toMatchObject({
    amount: 1180,
    last_four_digits: '1111',
    processing_fee: 25,
  });
  expect(
    await page.evaluate(() => sessionStorage.getItem('bounce:checkout:codys-cookie-store')),
  ).toBeNull();
  await page.reload();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Number of bags: 1', { exact: true })).toBeVisible();
  expect(checkout.provider.calls).toHaveLength(1);
});

test('keeps the booking after a decline and retries with a fresh payment attempt', async ({
  page,
  checkout,
}) => {
  await enterDetails(page, '4111111111110002');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect(page.getByText('Your booking has failed. Please try again.')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Reviewer Example');
  await page.getByLabel('Card details', { exact: true }).fill('4111111111111111');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Booking Placed!' })).toBeVisible();

  expect(checkout.provider.calls).toHaveLength(2);
  expect(checkout.db.prepare('SELECT COUNT(*) AS count FROM bookings').get()).toEqual({ count: 1 });
  expect(checkout.db.prepare('SELECT status FROM payment_attempts ORDER BY rowid').all()).toEqual([
    { status: 'declined' },
    { status: 'succeeded' },
  ]);
});

test('recovers a payment after reload while it is processing without another provider call', async ({
  page,
  checkout,
}) => {
  await enterDetails(page, '4111111111110003');
  await page.getByRole('button', { name: 'Book', exact: true }).click();
  await expect.poll(() => checkout.provider.calls.length).toBe(1);
  await page.reload();
  await expect(page.getByText('Checking payment status…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start over', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Name', { exact: true })).not.toBeEditable();
  for (const label of ['Name', 'Email', 'Card details']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveAttribute('tabindex', '-1');
  }
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement instanceof HTMLInputElement)).toBe(false);
  await expect(page.getByRole('button', { name: 'Book', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Book', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Increase number of bags', includeHidden: true }),
  ).toBeDisabled();
  await page.screenshot({ path: join(tmpdir(), 'bounce-review-processing.png'), fullPage: true });

  checkout.provider.release();
  await expect(page.getByRole('heading', { name: 'Booking Placed!' })).toBeVisible();
  expect(checkout.provider.calls).toHaveLength(1);
  expect(checkout.db.prepare('SELECT status FROM bookings').get()).toEqual({ status: 'confirmed' });
  expect(checkout.db.prepare('SELECT COUNT(*) AS count FROM payment_attempts').get()).toEqual({
    count: 1,
  });
});
