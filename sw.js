/* Yomu service worker.
 *
 * The library itself lives in IndexedDB, put there by the sync on start-up, so
 * this only has to make the app *open* without a network: cache the shell and
 * the build assets, and serve them when offline.
 *
 * The bundle JSON is deliberately not cached — sync fetches it, and a stale copy
 * in a cache would only mask new issues.
 */

const VERSION = "v6";
const SHELL = `yomu-shell-${VERSION}`;
const ASSETS = `yomu-assets-${VERSION}`;
const KEEP = new Set([SHELL, ASSETS]);

const SHELL_URLS = ["/", "/issues/", "/issue/", "/read/", "/search/", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One missing entry must not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

function pageKey(url) {
  const u = new URL(url, self.location.origin);
  return u.origin + u.pathname;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always go to the network for library data; sync handles being offline.
  if (url.pathname.startsWith("/bundle/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(pageKey(request.url), copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(pageKey(request.url));
          return cached || (await caches.match("/")) || Response.error();
        })
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
            return response;
          })
      )
    );
  }
});
