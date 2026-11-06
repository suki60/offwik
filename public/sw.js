// The service worker that lets the app open offline. It sits between the page
// and the network and keeps a copy of the app's own files in the Cache API.
// - install: caches every file of the build (listed in asset-manifest.json,
//   see vite.config.ts), so the app works offline after the first visit.
// - fetch: network first, so online visits get the latest build; the cached
//   copy when the network fails.
// Skipped: /data/* (store.ts keeps it in OPFS) except meta.json, and other
// origins (WebLLM caches its own models).

const CACHE = "offwik-app";

self.addEventListener("install", (event) => {
  event.waitUntil(precache());

  // Take over without waiting for old tabs to close.
  self.skipWaiting();
});

// Control the already open page too, not only the next load.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function precache() {
  const manifest = await (await fetch("/asset-manifest.json")).json();
  const files = Object.values(manifest).map((entry) => `/${entry.file}`);
  const cache = await caches.open(CACHE);
  await cache.addAll(["/", "/manifest.webmanifest", "/icon-180.png", ...files]);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    url.origin !== self.location.origin ||
    (url.pathname.startsWith("/data/") && url.pathname !== "/data/meta.json")
  ) {
    return;
  }

  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? Response.error();
  }
}
