import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { appFixture } from '../browser/fixture.js';

const build = '/tmp/coffee-pwa-test-build';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(build + '/release.json'));
const template = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const mime = name => ({ html: 'text/html', js: 'application/javascript', css: 'text/css', json: 'application/json', webmanifest: 'application/manifest+json', woff2: 'font/woff2', svg: 'image/svg+xml', png: 'image/png' })[name.split('.').at(-1)] || 'application/octet-stream';
function release(id) {
  const files = new Map();
  const names = new Map(manifest.assets.map(asset => [asset.url, asset.url.startsWith('assets/') ? asset.url.replace(/\.(js|css)$/, `-${id}.$1`) : asset.url]));
  for (const asset of manifest.assets) {
    let bytes = readFileSync(build + '/' + asset.url);
    if (asset.url === 'index.html') {
      let html = bytes.toString().replace(/name="app-release" content="[^"]+"/, `name="app-release" content="${id}"`);
      for (const [old, next] of names) html = html.replaceAll(old, next);
      bytes = Buffer.from(html);
    }
    files.set(names.get(asset.url), bytes);
  }
  const data = { id, assets: [...files].map(([url, bytes]) => ({ url, sha256: digest(bytes) })) };
  files.set('release.json', Buffer.from(JSON.stringify(data)));
  files.set('sw.js', Buffer.from(template.replace('/*BUILD_RELEASE*/ null', JSON.stringify(data))));
  return files;
}
let server, url, state;
test.beforeEach(async () => {
  state = { id: 'A', releases: new Map(['A', 'B', 'C', 'D'].map(id => [id, release(id)])), badAsset: false, slow: false, hits: [], failRegistration: 0 };
  server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/coffee\//, '') || 'index.html';
    state.hits.push(path);
    const send = () => {
      if (path === 'sw.js' && state.failRegistration-- > 0) { res.writeHead(503); res.end('Temporary worker outage'); return; }
      const bytes = state.releases.get(state.id).get(path);
      if (!bytes) { res.writeHead(404); res.end('Removed old deployment'); return; }
      res.writeHead(200, { 'Content-Type': mime(path), 'Cache-Control': 'no-store' });
      res.end(state.badAsset && path.endsWith('.css') ? 'corrupt deployment' : bytes);
    };
    if (state.slow && !['sw.js', 'release.json'].includes(path)) setTimeout(send, 8000); else send();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/coffee/`;
});
test.afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
async function open(page) {
  const app = await appFixture(page);
  await app.open(url); await app.ready();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  return app;
}
const current = page => page.locator('meta[name="app-release"]').getAttribute('content');
async function detect(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

test('warm reload is immediate and styled despite slow network, asset 404s and offline', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => caches.open('unrelated-app-cache'));
  state.id = 'B'; state.slow = true;
  // Prevent an automatic release transition until the warm-start assertions finish.
  await page.locator('[data-view=backlog]').click();
  await page.locator('#request-text').fill('Keep this draft while testing');
  let started = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const elapsed = Date.now() - started;
  expect(elapsed).toBeLessThan(1000);
  expect(await current(page)).toBe('A');
  await expect(page.locator('#startupIntro')).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).toContain('Manrope');
  const css = await page.locator('link[rel=stylesheet]').evaluateAll(links => links.map(link => link.href));
  for (const path of css) expect(await page.evaluate(async path => (await fetch(path)).ok, path)).toBe(true);
  await context.setOffline(true);
  started = Date.now(); await page.reload({ waitUntil: 'domcontentloaded' });
  expect(Date.now() - started).toBeLessThan(1000);
  await expect(page.locator('#bean-list .bean-card')).toHaveCount(20);
  await expect(page.locator('#data-message')).toContainText('Offline');
  for (const path of ['/fonts/manrope-latin.woff2', '/fonts/bricolage-latin.woff2']) {
    expect(await page.evaluate(async path => (await fetch(new URL('.' + path, location.href))).ok, path)).toBe(true);
  }
  expect(await page.evaluate(() => caches.has('unrelated-app-cache'))).toBe(true);
  console.log(`Warm cached shell: ${elapsed} ms; offline content restored`);
});

test('a verified release applies once while idle, preserving view and scroll', async ({ page }) => {
  await open(page);
  await page.evaluate(() => scrollTo(0, 600));
  state.id = 'B';
  await detect(page);
  await expect.poll(() => current(page), { timeout: 20000 }).toBe('B');
  await expect(page.locator('#startupIntro')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await detect(page);
  await page.waitForTimeout(500);
  expect(await current(page)).toBe('B');
});

test('background ten-second check discovers a deployment without a focus event', async ({ page }) => {
  await open(page);
  state.id = 'C';
  await expect.poll(() => current(page), { timeout: 18000 }).toBe('C');
});

test('a partial or corrupt deployment leaves the complete release running', async ({ page }) => {
  await open(page);
  state.id = 'B'; state.badAsset = true;
  await detect(page);
  await expect.poll(() => state.hits.filter(path => path === 'sw.js').length).toBeGreaterThan(1);
  await page.waitForTimeout(1500);
  expect(await current(page)).toBe('A');
  const ready = await page.evaluate(async () => Boolean(await (await caches.open('another-cup-shell-v4-B')).match(new URL('__complete__', location.href))));
  expect(ready).toBe(false);
  state.badAsset = false;
  await detect(page);
  await expect.poll(() => current(page), { timeout: 20000 }).toBe('B');
});

test('drafts defer automatic activation and survive explicit reload', async ({ page }) => {
  const app = await open(page);
  await page.locator('[data-view=backlog]').click();
  await page.locator('#request-text').fill('My unsent feature request');
  state.id = 'D'; await detect(page);
  await expect(page.locator('.live-toast')).toContainText('New version ready', { timeout: 20000 });
  expect(await current(page)).toBe('A');
  await page.getByRole('button', { name: 'Reload now' }).click();
  await expect.poll(() => current(page)).toBe('D');
  await app.ready();
  await expect(page.locator('#backlog')).toBeVisible();
  await expect(page.locator('#request-text')).toHaveValue('My unsent feature request');
  expect(app.calls.save_wishlist || 0).toBe(0);
});

test('multiple tabs update together and an old release stays available while a draft is open', async ({ page, context }) => {
  await open(page);
  const second = await context.newPage(); await open(second);
  await second.locator('[data-view=backlog]').click();
  await second.locator('#request-text').fill('Draft in another tab');
  state.id = 'B'; await detect(page); await detect(second);
  await expect.poll(() => current(page), { timeout: 20000 }).toBe('B');
  expect(await current(second)).toBe('A');
  const css = await second.locator('link[rel=stylesheet]').first().getAttribute('href');
  expect(await second.evaluate(async path => (await fetch(path)).ok, css)).toBe(true);
  await second.getByRole('button', { name: 'Reload now' }).click();
  await expect.poll(() => current(second)).toBe('B');
  await expect(second.locator('#request-text')).toHaveValue('Draft in another tab');
});


test('a newer deployment replaces an already staged release while a draft is open', async ({ page }) => {
  await open(page);
  await page.locator('[data-view=backlog]').click();
  await page.locator('#request-text').fill('Keep this through several deployments');
  state.id = 'B'; await detect(page);
  await expect(page.locator('.live-toast')).toBeVisible({ timeout: 20000 });
  state.id = 'D'; await detect(page);
  await expect.poll(() => page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.getRegistration()).waiting;
    if (!worker) return null;
    return new Promise(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => resolve(event.data.id); worker.postMessage({ type: 'RELEASE_STATUS' }, [channel.port2]); });
  }), { timeout: 20000 }).toBe('D');
  await page.getByRole('button', { name: 'Reload now' }).click();
  await expect.poll(() => current(page)).toBe('D');
  await expect(page.locator('#request-text')).toHaveValue('Keep this through several deployments');
});

test('a real service-worker push refreshes an open client without navigation', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  const app = await open(page);
  const cdp = await context.newCDPSession(page);
  let registrationId;
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => {
    registrationId = event.registrations.find(registration => registration.scopeURL === url)?.registrationId || registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrationId).toBeTruthy();
  app.ranking = { ids: ['bean-1'], revision: 2 };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(url).origin, registrationId, data: JSON.stringify({ title: 'Test update', body: 'New coffee' }) });
  await expect(page.locator('#bean-list .heart.saved')).toHaveCount(1);
  expect(await current(page)).toBe('A');
  await cdp.detach();
});


test('first-install corruption recovers after the network serves complete files', async ({ page }) => {
  state.badAsset = true;
  const app = await appFixture(page); await app.open(url); await app.ready();
  await expect.poll(() => state.hits.filter(path => path.endsWith('.css')).length).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
  state.badAsset = false; await detect(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
});

test('a transient initial registration failure retries without a page reload', async ({ page }) => {
  state.failRegistration = 1;
  const app = await appFixture(page); await app.open(url); await app.ready();
  await detect(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15000 }).toBe(true);
});

test('expired offline identity cannot restore a private snapshot', async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('anotherCupAccount:'));
    const identity = JSON.parse(localStorage.getItem(key)); identity.expiresAt = Date.now() - 1000;
    localStorage.setItem(key, JSON.stringify(identity));
  });
  await context.setOffline(true); await page.reload();
  await expect(page.locator('#data-message')).toContainText('Reconnect to load');
  await expect(page.locator('#app')).toBeHidden();
});


test('a new page adopts its staged worker when an old network-first worker still controls it', async ({ page }) => {
  state.releases.get('A').set('sw.js', readFileSync(new URL('./legacy-sw.js', import.meta.url)));
  const app = await open(page);
  state.id = 'B';
  await page.reload(); await app.ready();
  expect(await current(page)).toBe('B');
  await expect.poll(() => page.evaluate(async () => {
    const worker = navigator.serviceWorker.controller;
    if (!worker) return null;
    return new Promise(resolve => { const channel = new MessageChannel(); const timer = setTimeout(() => resolve(null), 1000); channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data.id); }; worker.postMessage({ type: 'RELEASE_STATUS' }, [channel.port2]); });
  }), { timeout: 15000 }).toBe('B');
});
