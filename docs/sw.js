const RELEASE = {"id":"d19192f4bd733703c11f","legacyAssets":["assets/index-DFxxJJkI.css","assets/index-d6lNUuPa.js"],"assets":[{"url":".nojekyll","sha256":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"},{"url":"assets/index-DMFqQWlV.css","sha256":"db3e2d2b9f045057bcb6560834ff43e7ca44f8aedabc204c3d52be7068c69157"},{"url":"assets/index-DRaNlJe6.js","sha256":"fdc51fe44d0193453964fdfef3a77747afd3134cae21cbc14928392da7e037a8"},{"url":"fonts/OFL-Bricolage.txt","sha256":"4b5a7d8f37f5602621c8a8d7358a6a2e71317e6c231c661e15aef0275d3e07ba"},{"url":"fonts/OFL-Manrope.txt","sha256":"58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b"},{"url":"fonts/bricolage-latin-ext.woff2","sha256":"1d04719f1325400ea4267e630dba29b02af87eb094d7d71d2e4d80a05479d07a"},{"url":"fonts/bricolage-latin.woff2","sha256":"85f55a58a31e61a2e19e8bb25fed503181bf2a6b4cab76c589992cfaac377447"},{"url":"fonts/bricolage-vietnamese.woff2","sha256":"7e13a14cb0bd5fcacf4907e47ac01fb4adb471540663987ecf356043612368c0"},{"url":"fonts/bricolage.css","sha256":"ec67deec6131c5fa9dda9f3323d15c5f80dc9a1116bf3297af5e4b65ad3037b4"},{"url":"fonts/manrope-cyrillic-ext.woff2","sha256":"e8c0b39992f06b3dc9a9834494088014859f363bf6ca8792b6bb07e17c7965f3"},{"url":"fonts/manrope-cyrillic.woff2","sha256":"95a493061fe0a8d0d027c2892747134ba747141112d3be4d5022e70ab7d3a1a6"},{"url":"fonts/manrope-greek.woff2","sha256":"40af11327fe5308166c6cb5787808b042db6da889abf602f0a4876c49675d87e"},{"url":"fonts/manrope-latin-ext.woff2","sha256":"ce093b341d9c10658ee1eaa85c5f8042ff3307bc6ccfc5f405616eb437f0009e"},{"url":"fonts/manrope-latin.woff2","sha256":"e310b55a7fd9677f5e3555e6c6c4d064fa1f1d24393f0ddbe217cea12a8c432f"},{"url":"fonts/manrope-vietnamese.woff2","sha256":"bab757f8a0a1bc04055ee98cb5777f3254aab11f6d222366e1f40a36f390506a"},{"url":"fonts/manrope.css","sha256":"909750705556e64a28861f94c333619bf26a70117315cf8719f91a8b8f613207"},{"url":"icon-192.png","sha256":"001fb60af0b053664c59de4ee30ff2e9b2c382bdd7f83225f732964fb17f1b0a"},{"url":"icon-512.png","sha256":"bca636cd2cc6589d93d710983f0e65f7372a1edcebdd2c89505b3da597a5125b"},{"url":"icon-any-v2-192.png","sha256":"a07029f50d8d615e7c000f6b4d03b72082ebc14bd86659d8cf769a33f235a4d5"},{"url":"icon-any-v2-512.png","sha256":"f0bfb2688b43f57cccf1a09d97347c7fead5df08449dd52dfbd4b5fab7dbbfe2"},{"url":"icon-any-v2.svg","sha256":"ac0d14c6ea190a88c9284f3fca7221270559eff09c2b8f85c481a0a06ebaf3dc"},{"url":"icon-maskable-v2-192.png","sha256":"99bc31d90ae11599851de3f9d6f22fb92740e99b275e3642031566010b05f8d0"},{"url":"icon-maskable-v2-512.png","sha256":"5753a1044152d8abc83acf9151de02ce34bb751bee08493a9f502a7772e8c047"},{"url":"icon-maskable-v2.svg","sha256":"d2a7cb6af2912956bbba13ebdf4571ba81a0381a4a5089eed037f3757e3a67cd"},{"url":"icon.svg","sha256":"c70bac87cd66cb0d3ec29f73a7041ffdc24f6578739c33a8742c638e254af842"},{"url":"index.html","sha256":"30c35de4a1ea93097c36b6a44ee1a8aa8955c6c043cc1977508d34c80a389f72"},{"url":"manifest.webmanifest","sha256":"21c9aa9238b187664f527086b7bb654aebd9ec6c88ea15aec1e5babcc7694d37"}]};
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
