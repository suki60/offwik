// Stage 10, step 1: the service worker that lets the app open offline. It sits
// between the page and the network and keeps a copy of the app's own files
// (index.html, the built JS, manifest, icons) in the Cache API.
// - Install: caches every file of the build, read from asset-manifest.json
//   (written by `vite build`, see vite.config.ts), so the app works offline
//   right after the first visit.
// - Every request: network first, so an online visit always gets the latest
//   build (and refreshes the copy); the cached copy only when the network
//   fails.
// Not handled here, each has its own storage: /data/* (streamed into OPFS by
// store.ts; caching it too would keep the 449 MB twice) and WebLLM's weights
// and wasm (other origins, kept in WebLLM's own Cache API caches).
// Registered by main.tsx, only in builds (`npm run build` + `npm run preview`).

const CACHE = "wiki-rag-app";

self.addEventListener("install", (event) => {
  event.waitUntil(precache());

  // Take over without waiting for every open tab of the old version to close.
  self.skipWaiting();
});

// Control the already open page too, not only the next load.
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function precache() {
  const response = await fetch("/asset-manifest.json");
  const manifest = await response.json();

  // One entry per module of the build: its file plus the CSS and assets
  // (images, wasm) it pulls in.
  const files = Object.values(manifest).flatMap((entry) => [
    entry.file,
    ...(entry.css ?? []),
    ...(entry.assets ?? []),
  ]);

  const cache = await caches.open(CACHE);

  await cache.addAll([
    "/",
    "/manifest.webmanifest",
    "/icon.svg",
    "/icon-180.png",
    ...files.map((file) => `/${file}`),
  ]);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/data/")
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
    // ignoreSearch: "/?source=pwa" and "/" are the same page.
    const cached = await cache.match(request, { ignoreSearch: true });
    return cached ?? Response.error();
  }
}
