const CACHE_PREFIX = "taskfollower-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v18`;
const APP_ROOT = self.registration.scope;
const APP_SCOPE_URL = new URL(APP_ROOT);
const SHELL_URLS = [
  APP_ROOT,
  new URL("index.html", APP_ROOT).toString(),
  new URL("manifest.webmanifest", APP_ROOT).toString(),
  new URL("icons/icon-192.png", APP_ROOT).toString(),
  new URL("icons/icon-512.png", APP_ROOT).toString(),
];

const isWithinTaskFollowerScope = (url) =>
  url.origin === APP_SCOPE_URL.origin &&
  url.pathname.startsWith(APP_SCOPE_URL.pathname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isWithinTaskFollowerScope(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);

        try {
          const response = await fetch(request);
          if (response.ok) {
            await cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (
            (await cache.match(request)) ||
            (await cache.match(new URL("index.html", APP_ROOT).toString())) ||
            (await cache.match(APP_ROOT))
          );
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })(),
  );
});
