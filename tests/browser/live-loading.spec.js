import { test, expect } from '@playwright/test';
import { appFixture } from './fixture.js';

async function cached(page) {
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise(resolve => { const request = indexedDB.open('another-cup-read-cache', 1); request.onsuccess = () => resolve(request.result); });
    return new Promise(resolve => { const request = db.transaction('accounts').objectStore('accounts').getAll(); request.onsuccess = () => { db.close(); resolve(request.result.length); }; });
  })).toBe(1);
}

test('verified account renders cached content before a delayed data response', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready(); await cached(page);
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  app.intercept = async name => { if (name === 'app_snapshot') await hold; return false; };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#bean-list .bean-card')).toHaveCount(20);
  await expect(page.locator('#published')).toContainText('Checking');
  expect(await page.evaluate(() => performance.getEntriesByName('app:cached-content')[0]?.startTime)).toBeLessThan(1000);
  await expect(page.locator('#startupIntro')).toHaveCount(0);
  release(); await app.ready();
  await expect(page.locator('#published')).not.toContainText('Checking');
});

test('a different account never sees the preceding account cached snapshot', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready(); await cached(page);
  app.profile = { ...app.profile, user_id: 'second-user' };
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  app.intercept = async name => { if (name === 'app_snapshot') await hold; return false; };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => app.calls.app_snapshot).toBe(2);
  await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => performance.getEntriesByName('app:cached-content').length)).toBe(0);
  release(); await app.ready();
});

test('revoked session cannot render a persisted account snapshot', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready(); await cached(page);
  app.signedIn = false;
  await page.reload();
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => performance.getEntriesByName('app:cached-content').length)).toBe(0);
});

test('ten-second checks read catalog metadata and reuse a recently verified session', async ({ page }) => {
  await page.clock.install();
  const queries = [];
  const app = await appFixture(page, { intercept: async (name, route) => { if (name === 'app_snapshot') queries.push(new URL(route.request().url()).searchParams.get('select')); return false; } });
  await app.open(); await app.ready();
  await page.clock.fastForward(10000);
  await expect.poll(() => app.calls.app_snapshot).toBe(2);
  await app.ready();
  expect(queries).toEqual(['payload,published_at', 'published_at']);
  expect(app.calls['get-session']).toBe(1);
});

test('activity publications preserve card identity and focus', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready();
  await page.locator('.heart').first().evaluate(element => { window.__card = element.closest('.bean-card'); element.focus(); });
  app.runs = [{ id: 5, started_at: '2026-10-22T10:00:00Z', status: 'running', events: [] }];
  app.publishedAt = '2026-10-22T10:00:00Z';
  await app.resume(); await expect.poll(() => app.calls.app_snapshot).toBe(3); await app.ready();
  expect(await page.locator('.bean-card').first().evaluate(element => element === window.__card)).toBe(true);
  await expect(page.locator('.heart').first()).toBeFocused();
});

test('a changed listing leaves unrelated cards attached', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready();
  await page.evaluate(() => { window.__unchanged = document.querySelectorAll('#bean-list .bean-card')[1]; });
  app.beans[0] = { ...app.beans[0], title: 'Updated coffee' }; app.publishedAt = '2026-10-22T12:00:00Z';
  await app.resume(); await expect(page.locator('.bean-title').first()).toHaveText('Updated coffee');
  expect(await page.evaluate(() => document.querySelectorAll('#bean-list .bean-card')[1] === window.__unchanged)).toBe(true);
});

test('storage failure does not block startup or background refresh', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('Storage unavailable'); }; });
  const app = await appFixture(page); await app.open(); await app.ready();
  await app.resume(); await app.ready();
  expect(app.errors).toEqual([]);
});

test('sign out clears persistent cache and hides another open tab', async ({ page, context }) => {
  const app = await appFixture(page); await app.open(); await app.ready(); await cached(page);
  const second = await context.newPage(); const other = await appFixture(second); await other.open(); await other.ready();
  app.signedIn = false;
  await second.locator('#settings').click(); await second.locator('#signout').click();
  await expect(page.locator('#app')).toBeHidden();
  await expect(second.locator('#app')).toBeHidden();
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('anotherCupAccount:')))).toBe(false);
});
