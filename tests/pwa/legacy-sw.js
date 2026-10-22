const CACHE = 'another-cup-shell-v3-' + (new URL(self.location.href).searchParams.get('build') || 'development');
const SHELL = ['./', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './fonts/bricolage-latin-ext.woff2',
  './fonts/bricolage-latin.woff2',
  './fonts/bricolage-vietnamese.woff2',
  './fonts/bricolage.css',
  './fonts/manrope-cyrillic-ext.woff2',
  './fonts/manrope-cyrillic.woff2',
  './fonts/manrope-greek.woff2',
  './fonts/manrope-latin-ext.woff2',
  './fonts/manrope-latin.woff2',
  './fonts/manrope-vietnamese.woff2',
  './fonts/manrope.css'];
const timedFetch = request => fetch(request, { signal: AbortSignal.timeout(6000) });
function entryAssets(html, url) {
  return [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)]
    .map(match => new URL(match[1], url))
    .filter(asset => asset.origin === self.location.origin && asset.href.startsWith(self.registration.scope));
}
async function cachePage(cache, request, response) {
  // Commit HTML only after its entry files are cached. A failed deployment or
  // connection must not leave an offline page pointing at missing bundles.
  const assets = entryAssets(await response.clone().text(), response.url || new URL(request, self.registration.scope).href);
  await Promise.all(assets.map(async asset => {
    if (await cache.match(asset.href)) return;
    const fetched = await timedFetch(asset.href);
    if (!fetched.ok) throw new Error('Entry asset unavailable');
    await cache.put(asset.href, fetched);
  }));
  await cache.put(request, response);
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.slice(1).map(async path => {
      const url = new URL(path, self.registration.scope).href;
      const response = await timedFetch(url);
      if (!response.ok) throw new Error('App shell unavailable');
      await cache.put(url, response);
    }));
    const url = self.registration.scope;
    const response = await timedFetch(url);
    if (!response.ok) throw new Error('App page unavailable');
    await cachePage(cache, url, response);
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('another-cup-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await timedFetch(event.request);
      if (response.ok) {
        const copy = response.clone();
        const write = response.headers.get('content-type')?.includes('text/html')
          ? cachePage(cache, event.request, copy) : cache.put(event.request, copy);
        event.waitUntil(write.catch(() => {}));
      }
      if (!response.ok && event.request.mode === 'navigate') {
        const cached = await cache.match(event.request) || await cache.match(self.registration.scope);
        if (cached) return cached;
      }
      return response;
    } catch {
      return await cache.match(event.request)
        || (event.request.mode === 'navigate' ? await cache.match(self.registration.scope) : null)
        || Response.error();
    }
  })());
});

// A push from the Mac: show it, and open the app when it is tapped.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Another Cup', {
    body: data.body || '', icon: './icon-192.png', badge: './icon-192.png', data: { url: data.url || './' } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) if ('focus' in client) return client.focus();
    return self.clients.openWindow(event.notification.data.url);
  }));
});
