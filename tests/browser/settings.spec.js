import { test, expect } from '@playwright/test';
import { appFixture, pushFixture } from './fixture.js';

test('settings menu: theme, roasters, notifications, sign out', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await page.locator('#settings').click();
  const items = await page.locator('#settings-menu > *').evaluateAll(nodes => nodes.map(node => node.textContent.trim().replace(/[^\w ]/g, '')));
  expect(items).toEqual(['Theme', 'Roasters', 'Notifications', 'Sign out']);
  await page.locator('[data-theme=dark]').click();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe('');
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await page.locator('[data-theme=light]').click();
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(dark).not.toBe(light);
  await page.locator('#open-roasters').click();
  await expect(page.locator('#settings-roasters')).toBeVisible();
  await expect(page.locator('#settings-roasters-list input').first()).toBeVisible();
  await page.screenshot({ path: '/tmp/settings-roasters.png' });
  await page.locator('#settings-roasters [data-back]').click();
  await expect(page.locator('#browse')).toBeVisible();
  await page.locator('#settings').click();
  await page.locator('#open-notifications').click();
  await expect(page.locator('#notify-toggle')).toBeVisible();
});

test('notification toggle removes and restores the subscription', async ({ page }) => {
  await pushFixture(page, { permission: 'granted' });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await expect.poll(() => app.calls.save_push_subscription).toBe(1);
  await page.locator('#settings').click();
  await page.locator('#open-notifications').click();
  await expect(page.locator('#notify-toggle')).toBeChecked();
  await page.locator('#notify-toggle').uncheck();
  await expect.poll(() => app.calls.remove_push_subscription).toBe(1);
  await expect(page.locator('#notify-toggle')).not.toBeChecked();
  await page.locator('#notify-toggle').check();
  await expect(page.locator('#notify-toggle')).toBeChecked();
  expect(app.calls.save_push_subscription).toBe(2);
});
