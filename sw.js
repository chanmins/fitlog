const CACHE = "fitlog-v52";
/* Photos live in their own cache that version bumps do NOT clear. They never
   change once published, and re-downloading 2MB of them on every update would
   spend the free tier's daily transfer for nothing. */
const MEDIA_CACHE = "fitlog-media-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=52",
  "./app.js?v=52",
  "./db.js?v=52",
  "./exercises.js?v=52",
  "./exercise-photos.js?v=52",
  "./cloud.js?v=52",
  "./firebase-config.js?v=52",
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

/* 휴식 알림을 누르면 앱으로 돌아옵니다. 이미 열려 있는 창이 있으면 그 창을
   앞으로 가져오고(새 창을 또 띄우면 기록이 두 군데로 갈립니다), 없을 때만
   새로 엽니다. */
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
