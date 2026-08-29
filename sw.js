const CACHE = "fitlog-v44";
/* Photos live in their own cache that version bumps do NOT clear. They never
   change once published, and re-downloading 2MB of them on every update would
   spend the free tier's daily transfer for nothing. */
const MEDIA_CACHE = "fitlog-media-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=44",
  "./app.js?v=44",
  "./db.js?v=44",
  "./exercises.js?v=44",
  "./exercise-photos.js?v=44",
  "./cloud.js?v=44",
  "./firebase-config.js?v=44",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== MEDIA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => {
        return self.clients.matchAll({ type: "window" }).then(clients => {
          return Promise.all(clients.map(client => {
            try { client.postMessage({ type: "SW_UPDATED", version: CACHE }); } catch (_) {}
            if (typeof client.navigate === "function") {
              const u = client.url || "";
              if (u.indexOf("/__/auth") !== -1) return Promise.resolve();
              return client.navigate(u);
            }
            return Promise.resolve();
          }));
        });
      })
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  /* Never intercept Firebase Auth / Google identity — caching these breaks login. */
  if (
    url.pathname.startsWith("/__/auth") ||
    url.pathname.startsWith("/__/") ||
    url.hostname.endsWith("gstatic.com") ||
    url.hostname.endsWith("googleapis.com") ||
    url.hostname.endsWith("google.com") ||
    url.hostname.endsWith("firebaseio.com") ||
    url.hostname.endsWith("identitytoolkit.googleapis.com")
  ) {
    return;
  }

  /* HTML navigations: always hit the network so users are not stuck on an old shell. */
  if (event.request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* Exercise photos: cache-first. They are immutable, so going to the network
     for one we already hold is pure waste — and it makes the info sheet open
     instantly the second time. */
  if (url.pathname.indexOf("/media/") !== -1) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
        if (response && response.status === 200 && response.type !== "opaque") {
          const copy = response.clone();
          caches.open(MEDIA_CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type !== "opaque") {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request)
          .then(cached => cached || caches.match("./index.html"))
      )
  );
});
