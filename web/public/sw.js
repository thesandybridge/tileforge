const CACHE_NAME = "tileforge-v1";
const PRECACHE_ASSETS = [
  "/wasm/tileforge_wasm.js",
  "/wasm/tileforge_wasm_bg.wasm",
  "/tileforge.worker.js",
];

// Install: precache WASM and worker files
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith("tileforge-") && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // Claim clients immediately
  self.clients.claim();
});

// Fetch: serve WASM and worker files from cache, fallback to network
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only intercept requests for WASM and worker files
  if (url.pathname.startsWith("/wasm/") || url.pathname.endsWith(".worker.js")) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // If not in cache, fetch from network and cache it
        return fetch(event.request).then((networkResponse) => {
          // Clone the response before caching
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        });
      })
    );
  }
});
