const CACHE = 'another-cup-shell-v2';
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
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
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
