import { test, expect } from '@playwright/test';
import { appFixture } from './fixture.js';

async function touch(page, locator, hold = 600, move = false) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  if (move) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y - 100 }] });
  await page.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('holding card text or blank space neither drags nor vibrates', async ({ page }) => {
  await page.addInitScript(() => { window.__vibrations = 0; navigator.vibrate = () => { window.__vibrations++; return true; }; });
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await touch(page, page.locator('.bean-title').first());
  await expect(page.locator('#browse')).toBeVisible();
  await expect(page.locator('.add-chip')).toHaveCount(0);
  expect(await page.evaluate(() => window.__vibrations)).toBe(0);
  expect(app.calls.save_wishlist || 0).toBe(0);
});

test('holding a heart adds once; moving to scroll cancels the hold', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await touch(page, page.locator('.heart').first());
  await expect(page.locator('#wishlist')).toBeVisible();
  await expect.poll(() => app.calls.save_wishlist).toBe(1);
  expect(app.ranking.ids).toHaveLength(1);
});

test('scrolling from the heart cancels a pending drag', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await touch(page, page.locator('.heart').first(), 450, true);
  await expect(page.locator('#browse')).toBeVisible();
  expect(app.calls.save_wishlist || 0).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});

test('touch context menus are not consumed; text fields retain native selection', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  const result = await page.locator('.bean-title').first().evaluate(element => {
    const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, selection: getComputedStyle(element).userSelect };
  });
  expect(result).toEqual({ prevented: false, selection: 'none' });
  await page.locator('#open-filters').click();
  expect(await page.locator('#filter-search').evaluate(element => getComputedStyle(element).userSelect)).toBe('text');
  await expect(page.locator('a[href]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View bean ↗' }).first()).toHaveJSProperty('tagName', 'BUTTON');
});

test('system font, narrow layout, and no external font requests', async ({ page }) => {
  const fonts = [];
  page.on('request', request => { if (/fonts\.google|fontshare/.test(request.url())) fonts.push(request.url()); });
  const app = await appFixture(page);
  app.beans[0].title = 'A particularly long Ethiopian coffee name from a small cooperative';
  await page.setViewportSize({ width: 320, height: 740 });
  await app.open(); await app.ready();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).toContain('system-ui');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(fonts).toEqual([]);
});
