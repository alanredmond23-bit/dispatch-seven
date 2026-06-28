// D7 Service Worker — offline shell + cache strategy
const VERSION  = "d7-v3";  // bumped to bust stale blank-page cache
const BASE     = "/dispatch-seven";
const SHELL    = [BASE + "/", BASE + "/index.html", BASE + "/manifest.json"];
const API_HOST = "api.github.com";

// Install: cache the app shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: purge old caches (including d7-v1, d7-v2 with wrong paths)
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: network-first for API, cache-first for shell assets
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname === API_HOST) return; // never cache GitHub API
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
