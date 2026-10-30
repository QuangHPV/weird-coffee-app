import { expect } from '@playwright/test';

export async function appFixture(page, options = {}) {
  const user = { id: 'test-member', name: 'Test member', email: 'test@example.invalid' };
  const profile = { user_id: user.id, role: 'member', display_name: user.name, setup_complete: true, tour_complete: true, roasters: ['Test Roaster'], filter_revision: 1, filter_state: {} };
  const beans = Array.from({ length: 20 }, (_, i) => ({ id: `bean-${i}`, roaster: 'Test Roaster', title: `Coffee ${i + 1}`, available: true, price: 20, grams: 250, per100g: 8, url: 'https://shop.example.invalid/coffee', label: { origins: ['Ethiopia'], process: ['Washed'], roast: 'light' } }));
  const state = { signedIn: true, calls: {}, errors: [], publishedAt: '2026-10-22T00:00:00Z', ranking: { ids: [], revision: 1 }, archives: [], runs: [], activity: null, profile, beans, intercept: null, backlog: { document: { tasks: [] }, revision: 1 }, ...options };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': route.request().headers().origin || 'http://127.0.0.1:5175', 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'set-auth-jwt' } });
  const jwt = () => `${btoa('{}')}.${btoa(JSON.stringify({ sub: state.profile.user_id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 900, version: state.calls.token || 0 }))}.test`;
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'warning' && message.text().includes('account load')) state.errors.push(message.text()); });
  await page.route('https://auth.example.invalid/**', async route => {
    const operation = new URL(route.request().url()).pathname.split('/').at(-1);
    state.calls[operation] = (state.calls[operation] || 0) + 1;
    if (state.intercept && await state.intercept(operation, route, json)) return;
    if (operation === 'get-session') {
      const data = state.signedIn ? { user: { ...user, id: state.profile.user_id }, session: { token: jwt(), expiresAt: new Date(Date.now() + 3600000).toISOString() } } : null;
      return json(route, data);
    }
    if (operation === 'token') return json(route, { token: jwt() });
    if (operation === 'email') { state.signedIn = true; return json(route, { user, token: 'session-cookie' }); }
    if (operation === 'sign-out') { state.signedIn = false; return json(route, { success: true }); }
    return json(route, {});
  });
  await page.route('https://data.example.invalid/**', async route => {
    const operation = new URL(route.request().url()).pathname.split('/').at(-1);
    state.calls[operation] = (state.calls[operation] || 0) + 1;
    if (state.intercept && await state.intercept(operation, route, json)) return;
    const body = route.request().postDataJSON();
    switch (operation) {
      case 'bootstrap_account': return json(route, state.profile);
      case 'app_snapshot': return json(route, [{ ...(new URL(route.request().url()).searchParams.get('select')?.includes('payload') ? { payload: { beans: state.beans, runs: state.runs, activity: state.activity, suggestions: [] } } : {}), published_at: state.publishedAt }]);
      case 'wishlist_state': return json(route, [state.ranking]);
      case 'personal_archives': return json(route, state.archives.map(bean_id => ({ bean_id })));
      case 'set_personal_archive': state.archives = body.do_archive ? [...new Set([...state.archives, body.listing])] : state.archives.filter(id => id !== body.listing); return json(route, null);
      case 'app_users': return json(route, [state.profile]);
      case 'replacement_decisions': return json(route, []);
      case 'feature_requests': return json(route, []);
      case 'save_wishlist': state.ranking = { ids: body.next_ids, revision: state.ranking.revision + 1 }; return json(route, state.ranking);
      case 'save_filter_preferences': state.profile = { ...state.profile, filter_state: body.next_filters, roasters: body.next_roasters, filter_revision: state.profile.filter_revision + 1 }; return json(route, state.profile);
      case 'backlog_state': return json(route, [state.backlog]);
      case 'save_backlog': state.backlog = { document: body.next_document, revision: state.backlog.revision + 1 }; return json(route, state.backlog);
      default: return json(route, null);
    }
  });
  state.open = async (url = '/') => {
    await page.goto(url);
    if (await page.locator('#introSkip').isVisible()) await page.locator('#introSkip').click();
    await expect(page.locator('#startupIntro')).toHaveCount(0);
  };
  state.ready = async () => {
    await expect(page.locator('#bean-list .bean-card')).toHaveCount(20);
    await expect(page.locator('#data-status')).toBeHidden();
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false');
  };
  state.resume = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  return state;
}

export async function pushFixture(page, { permission = 'default', installed = true, supported = true, displayMode = 'standalone' } = {}) {
  await page.addInitScript(({ permission, installed, supported, displayMode }) => {
    const nativeMatch = window.matchMedia.bind(window);
    window.matchMedia = query => /^\(display-mode: (standalone|fullscreen|minimal-ui)\)$/.test(query) ? { matches: installed && query === `(display-mode: ${displayMode})` } : nativeMatch(query);
    let current = permission, sub = null;
    const listeners = [];
    window.__push = { requests: 0, saves: 0, unsubscribes: 0, setPermission(value) { current = value; listeners.forEach(fn => fn()); } };
    const subscription = { endpoint: 'https://push.example.invalid/device', getKey: () => new Uint8Array([1, 2, 3]).buffer, unsubscribe: async () => { sub = null; window.__push.unsubscribes++; return true; } };
    Object.defineProperty(window, 'Notification', { configurable: true, value: class {
      static get permission() { return current; }
      static async requestPermission() { window.__push.requests++; current = 'granted'; return current; }
    } });
    if (supported) window.PushManager = class {};
    else delete window.PushManager;
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => sub, subscribe: async () => { sub = subscription; return sub; } } }) } });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: async () => ({ addEventListener: (_, fn) => listeners.push(fn) }) } });
  }, { permission, installed, supported, displayMode });
}

// A quick right swipe, as the app's go-back gesture.
export async function swipeRight(page) {
  await page.evaluate(() => {
    const target = document.querySelector('main');
    const touch = (x, y) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
    const send = (type, x, y) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [touch(x, y)], changedTouches: [touch(x, y)] }));
    send('touchstart', 60, 300);
    send('touchend', 230, 305);
  });
}
