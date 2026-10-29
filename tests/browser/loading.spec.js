import { test, expect } from '@playwright/test';
import { appFixture } from './fixture.js';

test('cold start retries the observed authorization failure without reloading', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (operation, route, json) => {
    if (operation === 'bootstrap_account' && app.calls[operation] === 1) { await json(route, { code: '42501', message: 'Not authorized' }, 403); return true; }
  } });
  await app.open(); await app.ready();
  expect(app.calls.bootstrap_account).toBe(2);
  expect(app.calls['get-session']).toBeGreaterThanOrEqual(2);
  expect(app.calls.token).toBe(1);
});

test('a startup outage recovers automatically on the next background check', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'app_snapshot') { await json(route, { message: 'Unavailable' }, 503); return true; }
  } });
  await page.clock.install();
  await app.open();
  await page.clock.fastForward(5000);
  await expect(page.locator('#data-retry')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  app.intercept = null;
  await page.clock.fastForward(60000);
  await app.ready();
});

test('returning to a failed startup retries without a page reload', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'app_snapshot') { await json(route, { message: 'Unavailable' }, 503); return true; }
  } });
  await app.open();
  await expect(page.locator('#data-retry')).toBeVisible();
  app.intercept = null;
  await app.resume(); await app.ready();
});

test('authorization recovery replaces the JWT for all subsequent data requests', async ({ page }) => {
  const tokens = [];
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'bootstrap_account') {
      tokens.push(route.request().headers().authorization);
      if (app.calls[name] === 1) { await json(route, { code: '42501', message: 'Not authorized' }, 403); return true; }
    }
  } });
  await app.open(); await app.ready();
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).not.toBe(tokens[1]);
});

for (const operation of ['get-session', 'app_snapshot', 'wishlist_state', 'personal_archives', 'app_users']) {
  test(`temporary ${operation} failure recovers automatically`, async ({ page }) => {
    const app = await appFixture(page, { intercept: async (name, route, json) => {
      if (name === operation && app.calls[name] <= 2) { await json(route, { message: 'Temporary outage' }, 503); return true; }
    } });
    await app.open(); await app.ready();
    expect(app.calls[operation]).toBe(3);
  });
}

test('network loss recovers automatically', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (name, route) => {
    if (name === 'app_snapshot' && app.calls[name] === 1) { await route.abort('internetdisconnected'); return true; }
  } });
  await app.open(); await app.ready();
  expect(app.calls.app_snapshot).toBe(2);
});

test('persistent failure has Retry and keeps existing data visible', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  app.intercept = async (name, route, json) => {
    if (name === 'app_snapshot') { await json(route, { message: 'Unavailable' }, 503); return true; }
  };
  await app.resume();
  await expect(page.locator('#data-message')).toContainText('Showing your last loaded data');
  await expect(page.locator('#bean-list .bean-card')).toHaveCount(20);
  await expect(page.locator('#data-retry')).toBeVisible();
  app.intercept = null;
  await page.locator('#data-retry').click();
  await app.ready();
});

test('failed initial load can retry without losing the session', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'app_snapshot') { await json(route, { message: 'Unavailable' }, 503); return true; }
  } });
  await app.open();
  await expect(page.locator('#data-retry')).toBeVisible();
  await expect(page.locator('#auth')).toBeHidden();
  app.intercept = null;
  await page.locator('#data-retry').click(); await app.ready();
});

test('empty RLS responses cannot become successful empty catalogues', async ({ page }) => {
  const app = await appFixture(page, { intercept: async (name, route, json) => {
    if (name === 'wishlist_state' && app.calls[name] < 3) { await json(route, []); return true; }
  } });
  await app.open(); await app.ready();
  expect(app.calls.wishlist_state).toBe(3);
});

test('expired session clears private data and returns to sign in', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  app.signedIn = false;
  await app.resume();
  await expect(page.locator('#auth')).toBeVisible();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#auth-error')).toContainText('session has ended');
});

test('sign out cancels an outstanding load', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  app.intercept = async (name, route, json) => {
    if (name === 'app_snapshot') { await hold; await json(route, []); return true; }
  };
  await app.resume();
  await expect.poll(() => app.calls.app_snapshot).toBe(2);
  await page.locator('#settings').click(); await page.locator('#signout').click();
  await expect(page.locator('#auth')).toBeVisible();
  release();
  await expect(page.locator('#app')).toBeHidden();
});

test('simultaneous resume and online events share a load', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await page.evaluate(() => { for (let i = 0; i < 8; i++) { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); } });
  await expect.poll(() => app.calls.app_snapshot).toBe(2);
  await app.ready();
  expect(app.calls['get-session']).toBe(2);
});

test('offline state clears after reconnection and never says Online', async ({ page, context }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  await context.setOffline(true);
  await expect(page.locator('#data-message')).toContainText('Offline');
  await context.setOffline(false);
  await app.ready();
  await expect(page.getByText('Online', { exact: true })).toHaveCount(0);
});

for (const operation of ['get-session', 'app_snapshot']) {
  test(`a stalled ${operation} request times out and the next attempt succeeds`, async ({ page }) => {
    const app = await appFixture(page, { intercept: async (name, route, json) => {
      if (name === operation && app.calls[name] === 1) {
        await new Promise(resolve => setTimeout(resolve, 14000));
        await json(route, null).catch(() => {});
        return true;
      }
    } });
    await app.open(); await app.ready();
    expect(app.calls[operation]).toBeGreaterThanOrEqual(2);
  });
}

test('a late refresh cannot overwrite a newer Wish-list edit', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  app.intercept = async (name, route, json) => {
    if (name === 'app_snapshot') { await hold; await json(route, []); return true; }
  };
  await app.resume();
  await expect.poll(() => app.calls.app_snapshot).toBe(2);
  await page.locator('.heart').first().tap();
  await expect.poll(() => app.calls.save_wishlist).toBe(1);
  release();
  await expect(page.locator('#bean-list .heart.saved')).toHaveCount(1);
  expect(app.ranking.ids).toEqual(['bean-0']);
});

test('switching accounts hides old content while the new account loads', async ({ page }) => {
  const app = await appFixture(page);
  await app.open(); await app.ready();
  app.profile = { ...app.profile, user_id: 'second-user', display_name: 'Second user' };
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  app.intercept = async (name, route, json) => {
    if (name === 'app_snapshot') { await hold; await json(route, [{ payload: { beans: app.beans, runs: [] }, published_at: '2026-10-22' }]); return true; }
  };
  await app.resume();
  await expect(page.locator('#app')).toBeHidden();
  await expect(page.locator('#data-status')).toContainText('Loading');
  release();
  await app.ready();
});
