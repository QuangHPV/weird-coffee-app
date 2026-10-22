import { test, expect } from '@playwright/test';
import { appFixture, pushFixture } from './fixture.js';

async function metrics(page) {
  return page.evaluate(() => {
    const nav = document.getElementById('navigation'), box = nav.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height, padding: parseFloat(getComputedStyle(nav).paddingBottom),
      buttonsBottom: Math.max(...[...nav.children].map(button => button.getBoundingClientRect().bottom)),
      viewport: innerHeight, clearance: parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom) };
  });
}

test('dynamic gesture inset moves a constant-height bar without creating a gap', async ({ page, context }) => {
  const app = await appFixture(page); await app.open(); await app.ready();
  const cdp = await context.newCDPSession(page);
  for (const bottom of [0, 12, 24, 12, 0]) {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom, bottomMax: 24 } });
    await expect.poll(async () => (await metrics(page)).top).toBe(844 - 67 - bottom);
    const m = await metrics(page);
    expect(m.height).toBe(91); expect(m.padding).toBe(29);
    expect(m.bottom).toBe(844 + 24 - bottom);
    expect(m.buttonsBottom).toBeLessThanOrEqual(844 - bottom);
    expect(m.clearance).toBe(16 + 67 + bottom);
  }
  await cdp.detach();
});

for (const width of [320, 390, 844]) test(`navigation reaches the viewport edge at ${width}px with no unused document reserve`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
  const app = await appFixture(page); await app.open(); await app.ready();
  const m = await metrics(page);
  expect(m.bottom).toBe(m.viewport); expect(m.height).toBe(67); expect(m.clearance).toBe(83);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const last = await page.locator('#bean-list .bean-card').last().boundingBox();
  expect(last.y + last.height).toBeLessThanOrEqual((await metrics(page)).top - 15);
});

test('keyboard-sized viewport changes restore the bottom edge without stale height', async ({ page }) => {
  const app = await appFixture(page); await app.open(); await app.ready();
  await page.locator('[data-view=backlog]').click();
  await page.locator('#request-text').fill('An unsent request');
  for (const height of [400, 844, 400, 844]) {
    await page.setViewportSize({ width: 390, height });
    await expect.poll(async () => (await metrics(page)).bottom).toBe(height);
  }
  await expect(page.locator('#request-text')).toHaveValue('An unsent request');
  await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /interactive-widget=resizes-content/);
});

test('signed-out screens reserve no hidden navigation height and never run a second splash', async ({ page }) => {
  const app = await appFixture(page, { signedIn: false }); await app.open();
  await expect(page.locator('#auth')).toBeVisible();
  expect(await page.locator('main').evaluate(element => parseFloat(getComputedStyle(element).paddingBottom))).toBe(16);
  await expect(page.locator('#startupIntro')).toHaveCount(0);
});

test('fullscreen installations retain the one-time notification prompt', async ({ page }) => {
  await pushFixture(page, { displayMode: 'fullscreen' });
  const app = await appFixture(page); await app.open(); await app.ready();
  await expect(page.locator('#push-prompt')).toBeVisible();
  expect(await page.evaluate(() => window.__push.requests)).toBe(0);
});

test('install metadata requests fullscreen with unchanged identity and safe adaptive icons', async ({ page }) => {
  await page.goto('/');
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('fullscreen');
  expect(new URL(manifest.id, page.url()).href).toBe(new URL(manifest.start_url, page.url()).href);
  expect(manifest.icons.filter(icon => icon.purpose === 'maskable').map(icon => icon.sizes)).toEqual(['192x192', '512x512']);
  const pixels = await page.evaluate(async () => {
    async function read(path) {
      const image = new Image(); image.src = path; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, 512, 512).data;
    }
    const regular = await read('/icon-any-v2-512.png'), adaptive = await read('/icon-maskable-v2-512.png');
    let clippedArtwork = 0;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      if (Math.hypot(x + .5 - 256, y + .5 - 256) <= 204.8) continue;
      const i = (y * 512 + x) * 4;
      if (Math.abs(adaptive[i] - 247) > 2 || Math.abs(adaptive[i + 1] - 243) > 2 || Math.abs(adaptive[i + 2] - 237) > 2) clippedArtwork++;
    }
    return { ordinaryAlpha: regular[3], maskCorner: [...adaptive.slice(0, 4)], clippedArtwork };
  });
  expect(pixels).toEqual({ ordinaryAlpha: 0, maskCorner: [247, 243, 237, 255], clippedArtwork: 0 });
});


test('legacy Android installations can remove native bars with one explicit fullscreen tap', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Android Chrome' });
    const native = matchMedia.bind(window);
    window.matchMedia = query => query === '(display-mode: standalone)' ? { matches: true } : native(query);
    Object.defineProperty(document, 'fullscreenEnabled', { value: true });
    window.__fullScreenCalls = [];
    Element.prototype.requestFullscreen = async function(options) {
      window.__fullScreenCalls.push(options);
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this });
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  const app = await appFixture(page); await app.open(); await app.ready();
  await expect(page.locator('#enter-fullscreen')).toBeVisible();
  expect(await page.evaluate(() => window.__fullScreenCalls)).toEqual([]);
  await page.locator('#enter-fullscreen').click();
  expect(await page.evaluate(() => window.__fullScreenCalls)).toEqual([{ navigationUI: 'hide' }]);
  await expect(page.locator('#enter-fullscreen')).toBeHidden();
});
