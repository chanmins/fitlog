const CACHE = "fitlog-v70";
/* Photos live in their own cache that version bumps do NOT clear. They never
   change once published, and re-downloading 2MB of them on every update would
   spend the free tier's daily transfer for nothing. */
const MEDIA_CACHE = "fitlog-media-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=70",
  "./native-bridge.js?v=70",
  "./app.js?v=70",
  "./db.js?v=70",
  "./exercises.js?v=70",
  "./exercise-photos.js?v=70",
  "./cloud.js?v=70",
  "./firebase-config.js?v=70",
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
      .then(keys => {
        /* 지우고 남길 것을 가르기 전에, 예전 버전 캐시가 있었는지를 봅니다.
           있었으면 '업데이트', 없었으면 '첫 설치' 입니다. 이 구분이 필요한
           이유는 아래 알림 때문입니다 — 첫 설치에도 알리면, 앱을 처음 여는
           사람이 로그인 비밀번호를 반쯤 입력한 순간에 페이지가 새로고침되어
           입력하던 게 날아갑니다. */
        const old = keys.filter(k => k !== CACHE && k !== MEDIA_CACHE && k.indexOf("fitlog-v") === 0);
        const isUpgrade = old.length > 0;
        return Promise.all(keys.filter(k => k !== CACHE && k !== MEDIA_CACHE).map(k => caches.delete(k)))
          .then(() => isUpgrade);
      })
      .then(isUpgrade => self.clients.claim().then(() => isUpgrade))
      .then(isUpgrade => {
        if (!isUpgrade) return;
        /* 알리기만 하고 새로고침은 페이지에 맡깁니다.
           예전에는 여기서 client.navigate() 로 직접 새로고침했는데, 그러면
           페이지가 "지금은 곤란하다"(과거 기록을 고치는 중이라 저장 안 된
           변경이 있다 / 로그인 중이다)고 판단해도 소용이 없었습니다.
           무엇을 잃게 되는지 아는 쪽은 페이지입니다. */
        return self.clients.matchAll({ type: "window" }).then(clients => {
          clients.forEach(client => {
            try { client.postMessage({ type: "SW_UPDATED", version: CACHE }); } catch (_) {}
          });
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
      fetch(event.request)
        .then(res => {
          /* fetch 는 500 이나 호스팅 오류 페이지에도 '성공'으로 응답합니다.
             그대로 넘기면 캐시에 멀쩡한 앱 껍데기를 두고도 오류 페이지를
             띄우게 됩니다. 상태를 보고 아니면 캐시로 갑니다. */
          if (res && res.ok) return res;
          return caches.match("./index.html").then(c => c || res);
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* Exercise photos: cache-first. They are immutable, so going to the network
     for one we already hold is pure waste — and it makes the info sheet open
     instantly the second time. */
  if (url.pathname.indexOf("/media/") !== -1) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        /* 여기까지 왔다는 건 캐시에 없다는 뜻입니다. 예전에는 실패했을 때
           .catch(() => cached) 로 돌려줬는데, cached 는 반드시 undefined 라
           respondWith 가 "Response 가 아닙니다" 예외를 던졌습니다. 줄 게
           없으면 그냥 네트워크 오류로 두는 편이 낫습니다. */
        return fetch(event.request).then(response => {
          if (response && response.status === 200 && response.type !== "opaque") {
            const copy = response.clone();
            caches.open(MEDIA_CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        });
      })
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
        /* 캐시에 없으면 그대로 실패시킵니다.
           예전에는 index.html 을 돌려줬는데, 그건 스크립트나 CSS 요청에도
           적용됐습니다. 브라우저는 app.js 자리에서 HTML 을 받고 MIME 검사로
           실행을 거부하거나 HTML 을 자바스크립트로 읽다 터집니다. 어느 쪽이든
           앱이 안 뜨는데, 원인은 '네트워크 오류' 가 아니라 '이상한 문법
           오류' 로 보여 진단이 불가능해집니다. */
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          throw new Error("offline: " + url.pathname);
        })
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
