// Basic, robust service worker to enable offline support for HoB Tools
// - Precaches build assets listed in CRA's asset-manifest.json
// - Caches runtime GET requests (cache-first strategy)
// - Falls back to cached index.html for SPA navigations when offline

const CACHE_NAME = 'hob-tools-v2';
const CORE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.svg',
  '/logo512.svg',
];

async function precacheFromManifest(cache) {
  try {
    const res = await fetch('/asset-manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    const files = manifest && manifest.files ? Object.values(manifest.files) : [];
    const urls = [...CORE_URLS, ...files].filter(Boolean);
    await cache.addAll(urls);
  } catch (err) {
    // If manifest fetch fails, at least cache core URLs
    await cache.addAll(CORE_URLS);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await precacheFromManifest(cache);
      // Activate SW immediately
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove old caches
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve()))
      );
      // Take control of uncontrolled clients
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Handle SPA navigations: serve cached index.html as fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Try network first to get latest page
          const networkResponse = await fetch(request);
          return networkResponse;
        } catch (err) {
          // Offline: return cached index.html
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match('/index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // For other GET requests, use cache-first with runtime caching
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        // Only cache successful, basic (same-origin) responses
        if (response && response.status === 200 && response.type === 'basic') {
          cache.put(request, response.clone());
        }
        return response;
      } catch (err) {
        // If network fails, try a core fallback for documents
        if (request.destination === 'document') {
          const fallback = await cache.match('/index.html');
          return fallback || Response.error();
        }
        return Response.error();
      }
    })()
  );
});
