// D7 Service Worker — offline shell + cache strategy
const VERSION  = "d7-v1";
const SHELL    = ["/", "/index.html", "/manifest.json"];
const API_HOST = "api.github.com";

// Install: cache the app shell
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// Activate: purge old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch strategy:
// - GitHub API: network-first, 30s timeout, fall back to cache
// - Anthropic API: network only (no caching AI responses)
// - App shell: cache-first
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Anthropic — never cache
  if (url.host === "api.anthropic.com") return;

  // GitHub API — network-first with 30s timeout
  if (url.host === API_HOST) {
    e.respondWith(
      Promise.race([
        fetch(e.request.clone()).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, clone));
          }
          return res;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000)),
      ]).catch(async () => {
        const cached = await caches.match(e.request);
        return cached || new Response(JSON.stringify({ error: "offline" }), {
          headers: { "Content-Type": "application/json" },
          status: 503,
        });
      })
    );
    return;
  }

  // App shell — cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});

// Background sync placeholder (future: queue offline captures)
self.addEventListener("sync", (e) => {
  if (e.tag === "d7-capture-queue") {
    // TODO: drain offline capture queue → GitHub Issues API
    console.log("[D7 SW] Background sync: capture queue");
  }
});
