/* Tracer service worker — offline-first for the app shell. */
const VERSION = "tracer-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/config.js",
  "./js/util.js",
  "./js/model.js",
  "./js/providers.js",
  "./js/retailers.js",
  "./js/insights.js",
  "./js/chart.js",
  "./js/exporters.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;

  // Navigations: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Static assets: cache-first, then network (and cache the result).
  e.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => hit)
    )
  );
});
