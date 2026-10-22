const RELEASE = /*BUILD_RELEASE*/ null;
const PREFIX = 'another-cup-shell-';
const CACHE = PREFIX + 'v4-' + (RELEASE?.id || 'development');
const scope = self.registration.scope;
const urlOf = path => new URL(path, scope).href;
const COMPLETE = urlOf('__complete__');
const META = 'another-cup-client-releases';
const timedFetch = request => fetch(request, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
const tellClients = async type => {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) if (client.url.startsWith(scope)) client.postMessage({ type, release: RELEASE?.id });
};
async function verify(response, asset) {
  if (!response.ok || response.type === 'opaque') throw new Error('Incomplete release');
  if (asset.sha256) {
    const hash = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
    const actual = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== asset.sha256) throw new Error('Release asset mismatch');
  }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const assets = RELEASE?.assets || [{ url: 'index.html' }];
      // A bounded queue avoids opening dozens of simultaneous font connections.
      let index = 0;
      await Promise.all(Array.from({ length: Math.min(4, assets.length) }, async () => {
        while (index < assets.length) {
          const asset = assets[index++], url = urlOf(asset.url);
          const response = await timedFetch(url);
          await verify(response, asset);
          await cache.put(url, response);
        }
      }));
      await cache.put(COMPLETE, new Response('ready'));
      await tellClients('RELEASE_READY');
    } catch (error) { await caches.delete(CACHE); throw error; }
    // Updated workers wait for a safe, coordinated handover from the page.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim().then(() => tellClients('RELEASE_ACTIVE')));
});
async function rememberClient(event) {
  if (!event.source?.id || !event.source.url.startsWith(scope)) return;
  const meta = await caches.open(META);
  await meta.put(urlOf('__client__/' + event.source.id), new Response(event.data.release));
  const clients = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(client => client.url.startsWith(scope));
  const live = new Set();
  for (const client of clients) {
    const response = await meta.match(urlOf('__client__/' + client.id));
    // An old client has not identified its release yet: retain all old caches.
    if (!response) return;
    live.add(await response.text());
  }
  const keys = (await caches.keys()).filter(key => key.startsWith(PREFIX));
  const retained = new Set([CACHE, ...keys.slice(-3)]);
  for (const key of keys) if (!retained.has(key) && ![...live].some(id => key === PREFIX + 'v4-' + id)) await caches.delete(key);
  const liveIds = new Set(clients.map(client => urlOf('__client__/' + client.id)));
  for (const request of await meta.keys()) if (!liveIds.has(request.url)) await meta.delete(request);
}
self.addEventListener('message', event => {
  if (event.data?.type === 'RELEASE_STATUS') event.ports[0]?.postMessage({ id: RELEASE?.id, ready: true });
  if (event.data?.type === 'ACTIVATE_RELEASE' && event.data.release === RELEASE?.id) event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CLIENT_RELEASE' && typeof event.data.release === 'string') event.waitUntil(rememberClient(event));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(scope)) return;
  // Browser/Android metadata has its own lifecycle. Do not pin it to an old
  // page's release while that page has a draft open. Failed/offline checks can
  // still use the current complete shell's manifest.
  if (url.pathname === new URL('manifest.webmanifest', scope).pathname) {
    event.respondWith(timedFetch(event.request).then(response => {
      if (!response.ok) throw new Error('Manifest unavailable');
      return response;
    }).catch(async () => (await (await caches.open(CACHE)).match(urlOf('manifest.webmanifest'))) || Response.error()));
    return;
  }
  // Release discovery must always observe the server, never a cached manifest.
  if (url.pathname === new URL('release.json', scope).pathname) return;
  event.respondWith((async () => {
    let cache = await caches.open(CACHE);
    const navigation = event.request.mode === 'navigate';
    // An old open page also needs its own unversioned font stylesheets/files.
    if (!navigation && event.clientId) {
      const saved = await (await caches.open(META)).match(urlOf('__client__/' + event.clientId));
      const id = saved && await saved.text();
      const name = PREFIX + 'v4-' + id;
      if (id && await caches.has(name)) cache = await caches.open(name);
    }
    const key = navigation ? urlOf('index.html') : event.request;
    const cached = await cache.match(key);
    if (cached) return cached;
    // Old pages can still request their old hashed assets after activation.
    if (!navigation) for (const name of (await caches.keys()).filter(name => name.startsWith(PREFIX) && name !== CACHE)) {
      const previous = await (await caches.open(name)).match(key);
      if (previous) return previous;
    }
    // Never replace a verified shell with runtime HTML from another release.
    return timedFetch(event.request).catch(() => Response.error());
  })());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() || '' }; }
  event.waitUntil(Promise.all([
    tellClients('DATA_CHANGED'),
    self.registration.showNotification(data.title || 'Another Cup', {
      body: data.body || '', icon: './icon-192.png', badge: './icon-192.png', data: { url: data.url || './' }
    })
  ]));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) if (client.url.startsWith(scope) && 'focus' in client) {
      client.postMessage({ type: 'DATA_CHANGED' });
      return client.focus();
    }
    const destination = new URL(event.notification.data.url, scope);
    return self.clients.openWindow(destination.href.startsWith(scope) ? destination.href : scope);
  })());
});
