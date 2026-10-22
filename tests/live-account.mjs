// Opt-in integration check for the isolated branch. Credentials/session files stay in /tmp.
// Run against a production-mode build configured with the test branch URLs, never production.
import { chromium, expect } from '@playwright/test';
import { readFileSync, existsSync, chmodSync } from 'node:fs';
const account = JSON.parse(readFileSync('/tmp/coffee-loading-account.json', 'utf8'));
const sessionPath = '/tmp/coffee-loading-session.json';
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  ...(existsSync(sessionPath) ? { storageState: sessionPath } : {}) });
const page = await context.newPage();
const failures = [], errors = [], diagnostics = [];
let authRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'warning') diagnostics.push(message.text()); });
await page.route('**/*.neon.tech/**', async route => {
  if (!new URL(route.request().url()).hostname.startsWith('ep-winter-mud-aztqfcjq.')) throw new Error('Integration test refused to contact a non-test Neon endpoint');
  await route.continue();
});
page.on('response', response => {
  if (!response.url().includes('neon.tech')) return;
  if (response.url().includes('get-session')) authRequests++;
  if (response.status() >= 400) failures.push({ status: response.status(), path: new URL(response.url()).pathname });
});
async function ready() {
  await expect(page.locator('#bean-list .bean-card').first()).toBeVisible({ timeout: 60000 });
  await expect(page.locator('#data-status')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
}
try {
  await page.goto('http://127.0.0.1:5176/');
  if (await page.locator('#introSkip').isVisible()) await page.locator('#introSkip').click();
  if (process.env.EXPECT_SIGNED_OUT) {
    await expect(page.locator('#auth')).toBeVisible({ timeout: 60000 });
    await expect(page.locator('#app')).toBeHidden();
    console.log('REAL EXPIRED SESSION: returned to sign in');
  } else {
    await expect(page.locator('#auth:visible, #app:visible')).toHaveCount(1, { timeout: 60000 });
    if (await page.locator('#auth').isVisible()) {
      await page.locator('#email').fill(account.email);
      await page.locator('#password').fill(account.password);
      await page.locator('#auth-submit').click();
    }
    await expect(page.locator('#app')).toBeVisible({ timeout: 60000 });
    if (await page.locator('#roaster-setup').isVisible()) {
      await page.locator('#setup-roasters input').first().check();
      await page.locator('#save-roasters').click();
      await expect(page.locator('#roaster-setup')).toBeHidden();
    }
    if (await page.locator('#tour-skip').isVisible()) await page.locator('#tour-skip').click();
    await ready();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.scriptURL.endsWith('/sw.js');
    })).toBe(true);
    console.log('REAL PWA: signed in, catalog loaded, service worker active');
    const cachedContentMs = [];
    for (let i = 0; i < 10; i++) {
      await page.reload();
      if (await page.locator('#introSkip').isVisible()) await page.locator('#introSkip').click();
      await ready();
      const timing = await page.evaluate(() => performance.getEntriesByName('app:cached-content')[0]?.startTime);
      expect(timing).toBeGreaterThan(0); cachedContentMs.push(Math.round(timing));
    }
    console.log('REAL RELOADS: 10 passed; cached content ms:', JSON.stringify(cachedContentMs));
    for (let i = 0; i < 5; i++) {
      const response = page.waitForResponse(response => response.url().includes('/app_snapshot'));
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await response; await ready();
    }
    console.log('REAL RESUMES: 5 passed');
    await context.setOffline(true);
    await expect(page.locator('#data-status')).toContainText('Offline');
    const assets = await page.locator('script[type=module][src], link[rel=stylesheet]').evaluateAll(elements => elements.map(element => element.src || element.href));
    for (const asset of assets) expect(await page.evaluate(async url => (await fetch(url)).ok, asset)).toBe(true);
    await page.reload();
    if (await page.locator('#introSkip').isVisible()) await page.locator('#introSkip').click();
    await expect(page.locator('#data-status')).toContainText('Offline');
    await expect(page.locator('#bean-list .bean-card').first()).toBeVisible();
    console.log('REAL OFFLINE RELOAD: styled shell and cached account content available');
    await context.setOffline(false);
    await ready();
    console.log('REAL RECONNECT: recovered automatically');
    await page.screenshot({ path: '/tmp/coffee-mobile-reliability.png' });
    await context.storageState({ path: sessionPath });
    chmodSync(sessionPath, 0o600);
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ authRequests, failures, diagnostics, pageErrors: errors }));
} finally { await browser.close(); }
