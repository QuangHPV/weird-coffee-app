import { test, expect } from '@playwright/test';
import { appFixture, pushFixture } from './fixture.js';

test('installed app asks once, only requests permission after a tap, and saves subscription', async ({ page }) => {
  await pushFixture(page);
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeVisible();
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
  await page.locator('#push-enable').click();
  await expect(page.locator('#push-prompt')).toBeHidden();
  expect(await page.evaluate(() => window.__push.requests)).toBe(1);
  expect(app.calls.save_push_subscription).toBe(1);
  await page.reload(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeHidden();
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
  await expect(page.locator('#notify')).toHaveCount(0);
});

test('dismissal persists; enabling in system settings registers without asking again', async ({ page }) => {
  await pushFixture(page);
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await page.locator('#push-dismiss').click();
  await page.reload(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeHidden();
  await page.evaluate(() => window.__push.setPermission('granted'));
  await expect.poll(() => app.calls.save_push_subscription).toBe(1);
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
});

test('denied permission is not requested again; later granted permission resubscribes', async ({ page }) => {
  await pushFixture(page, { permission: 'denied' });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeHidden();
  await page.evaluate(() => window.__push.setPermission('granted'));
  await expect.poll(() => app.calls.save_push_subscription).toBe(1);
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
});

test('existing granted users sync automatically, and failed sync retries after resume', async ({ page }) => {
  await pushFixture(page, { permission: 'granted' });
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'save_push_subscription' && app.calls[name] === 1) { await json(route, { message: 'Unavailable' }, 503); return true; }
  } });
  await app.open(); await app.ready();
  await expect.poll(() => app.calls.save_push_subscription).toBe(1);
  await app.resume();
  await expect.poll(() => app.calls.save_push_subscription).toBe(2);
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
});

test('ordinary browser visits wait until installation', async ({ page }) => {
  await pushFixture(page, { installed: false });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.locator('#push-prompt')).toBeVisible();
});

test('unsupported push does not block catalogue loading', async ({ page }) => {
  await pushFixture(page, { supported: false });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeHidden();
});

test('sign out removes this account subscription and unsubscribes the device', async ({ page }) => {
  await pushFixture(page, { permission: 'granted' });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect.poll(() => app.calls.save_push_subscription).toBe(1);
  await page.locator('#signout').click();
  await expect(page.locator('#auth')).toBeVisible();
  expect(app.calls.remove_push_subscription).toBe(1);
  expect(await page.evaluate(() => window.__push.unsubscribes)).toBe(1);
});

test('a failed enable can retry registration without a second permission request', async ({ page }) => {
  await pushFixture(page);
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'save_push_subscription' && app.calls[name] === 1) { await json(route, { message: 'Unavailable' }, 503); return true; }
  } });
  await app.open(); await app.ready();
  await page.locator('#push-enable').click();
  await expect(page.locator('#push-message')).toContainText('Try again');
  await page.locator('#push-enable').click();
  await expect(page.locator('#push-prompt')).toBeHidden();
  expect(app.calls.save_push_subscription).toBe(2);
  expect(await page.evaluate(() => window.__push.requests)).toBe(1);
});
