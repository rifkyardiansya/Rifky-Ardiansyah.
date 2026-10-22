/* =====================================================================
 *  Service Worker — Restoran Nusantara
 *
 *  Strategi:
 *   - navigasi halaman  : network-first, fallback ke cache, lalu offline page
 *   - aset statis       : cache-first (precache shell saat install)
 *   - aset gambar       : stale-while-revalidate
 *   - request /api/     : network-only (data harus selalu segar; antrean
 *                         offline ditangani di sisi aplikasi via IndexedDB)
 *
 *  Pada blueprint produksi, file ini digantikan Workbox (next-pwa) yang
 *  menghasilkan manifest precache secara otomatis.
 * ===================================================================== */

const VERSION = 'v3';
const CACHE = `resto-nusantara-${VERSION}`;

const SHELL = [
  '/',
  '/customer',
  '/login',
  '/kitchen',
  '/booking',
  '/pos',
  '/inventory',
  '/reports',
  '/notifications',
  '/manifest.json',
  '/offline',
];

/* ------------------------------ Install ------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        // Individu agar satu halaman gagal tidak membatalkan seluruh precache
        Promise.allSettled(SHELL.map((url) => cache.add(url)))
      )
      .then(() => self.skipWaiting())
  );
});

/* ------------------------------ Activate ----------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ------------------------------- Fetch ------------------------------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API & SSE: selalu ke jaringan (tidak boleh dari cache)
  if (url.pathname.startsWith('/api/')) return;

  // Halaman: network-first
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? (await caches.match('/offline')) ?? Response.error();
        })
    );
    return;
  }

  // Gambar: stale-while-revalidate
  if (request.destination === 'image') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response.status === 200) cache.put(request, response.clone());
            return response;
          })
          .catch(() => cached ?? Response.error());
        return cached ?? network;
      })
    );
    return;
  }

  // Aset statis: cache-first
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    )
  );
});

/* --------------------- Push notification (Web Push) --------------------- */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || 'Restoran Nusantara';
  const options = {
    body: payload.body || 'Ada pembaruan terbaru.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'restoran-update',
    data: { url: payload.url || '/customer' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/customer';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(target) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

/* ---------------------- Background sync (antrean) --------------------- */
/* Dijalankan saat browser Supporting Background Sync API.
   Antrean offline tetap disimpan di IndexedDB oleh aplikasi sebagai
   sumber kebenaran; worker ini hanya membantu memicu flush. */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-pending-orders') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => client.postMessage({ type: 'FLUSH_PENDING_ORDERS' }));
      })
    );
  }
});

/* ------------------------------ Message ------------------------------ */
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});