// Manual diagnostic, isolated Neon branch only. Never prints credentials or tokens.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
const account = JSON.parse(readFileSync('/tmp/coffee-loading-account.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
page.on('pageerror', error => console.log('PAGE ERROR', error.message));
page.on('request', request => {
  if (!request.url().includes('apirest')) return;
  const token = request.headers().authorization?.replace('Bearer ', '');
  if (token?.split('.').length === 3) {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    console.log('IDENTITY', { sub: claims.sub, role: claims.role, expiresIn: claims.exp - Date.now() / 1000 });
  }
});
let token;
page.on('request', request => { if (request.url().includes('apirest')) token = request.headers().authorization; });
page.on('requestfailed', request => console.log('FAILED', new URL(request.url()).pathname, request.failure()?.errorText));
page.on('response', async response => {
  if (!response.url().includes('neon.tech')) return;
  const path = new URL(response.url()).pathname;
  console.log('HTTP', response.status(), path);
  if (response.status() >= 400) console.log('ERROR BODY', (await response.text()).slice(0, 500));
});
try {
  if (process.env.CREATE_TEST_ACCOUNT) {
    account.email = `loading-browser-${Date.now()}@example.invalid`;
    const response = await context.request.post('https://ep-winter-mud-aztqfcjq.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth/sign-up/email', {
      headers: { Origin: 'http://127.0.0.1:5174' }, data: { ...account, name: 'Loading browser test' }
    });
    console.log('SIGNUP', response.status(), response.ok() ? 'created' : await response.text());
    writeFileSync('/tmp/coffee-loading-account.json', JSON.stringify(account), { mode: 0o600 });
  }
  await page.goto('http://127.0.0.1:5174/');
  await page.locator('#introSkip').click().catch(() => {});
  await page.waitForTimeout(1500);
  if (await page.locator('#auth-form').isVisible()) {
  await page.locator('#email').fill(account.email);
  await page.locator('#password').fill(account.password);
  await page.locator('#auth-submit').click();
  }
  await page.waitForTimeout(8000);
  console.log('FIRST', await page.locator('#notice').textContent(), 'cards', await page.locator('.bean-card').count(), (await page.locator('body').innerText()).slice(0, 1500));
  if (await page.locator('#roaster-setup').isVisible()) {
    await page.locator('#setup-roasters input').first().check();
    await page.locator('#save-roasters').click();
    await page.locator('#roaster-setup').waitFor({ state: 'hidden' });
  }
  for (let i = 0; i < 12; i++) {
    await page.reload();
    await page.waitForTimeout(5000);
    console.log('RELOAD', i, await page.locator('#notice').textContent(), 'cards', await page.locator('.bean-card').count());
    const response = await context.request.post('https://ep-winter-mud-aztqfcjq.apirest.c-3.ap-southeast-1.aws.neon.tech/neondb/rest/v1/rpc/loading_identity_probe', { headers: { Authorization: token }, data: {} });
    console.log('PROBE', response.status(), await response.text());
  }
  await context.storageState({ path: '/tmp/coffee-loading-session.json' });
} finally { await browser.close(); }
