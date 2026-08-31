/* FITLOG — 웹 ↔ 네이티브 브릿지 ────────────────────────────────────────────
   이 파일은 웹앱이 '네이티브 껍데기 안에서 돌고 있는가' 를 확인하고, 돌고
   있다면 휴식 타이머를 네이티브에 넘겨 주는 통로입니다.

   왜 넘겨야 하나:
   웹앱의 휴식 타이머는 끝나는 '시각' 을 저장해 두는 방식이라 앱을 껐다 켜도
   남은 시간이 맞습니다. 하지만 앱이 화면 밖에 있는 동안 정확히 그 시각에
   소리를 내거나 알림을 띄우지는 못합니다 — 브라우저가 죽은 탭을 대신 깨워
   주지 않으니까요. 그건 OS 만 할 수 있고, OS 에 부탁하려면 네이티브 코드가
   필요합니다.

   그래서 역할을 이렇게 나눕니다.
     · 화면에 보이는 카운트다운(바, ±15, 취소)  → 지금까지처럼 웹이
     · 앱이 화면 밖일 때 정확한 시각의 알림      → 네이티브가
   양쪽 모두 같은 endsAt(끝나는 시각, epoch ms)을 보고 있으므로 서로 어긋날
   일이 없습니다. 남은 시간을 주고받는 게 아니라 '끝나는 시각' 을 주고받는
   것이 이 설계의 핵심입니다.

   네이티브가 없으면(그냥 브라우저·PWA) 이 파일은 ok=false 인 껍데기로 남고,
   앱은 지금까지와 똑같이 동작합니다. */
(() => {
  'use strict';

  /* iOS 는 WKWebView 의 메시지 핸들러 하나(fitlog)로 모든 요청을 받습니다.
     Android 는 addJavascriptInterface 로 심은 객체의 메서드를 직접 부릅니다.
     Android 쪽만 값을 '동기적으로' 돌려줄 수 있다는 차이가 있어서, 앱을 열
     때 이미 돌아가던 타이머를 되찾는 방법이 플랫폼마다 다릅니다(아래 pending). */
  function iosHandler() {
    try { return window.webkit.messageHandlers.fitlog; } catch (_) { return null; }
  }
  function androidObj() {
    try { return window.FitLogAndroid || null; } catch (_) { return null; }
  }

  const platform = iosHandler() ? 'ios' : (androidObj() ? 'android' : null);

  function send(action, payload) {
    const msg = Object.assign({ action }, payload || {});
    try {
      if (platform === 'ios') { iosHandler().postMessage(msg); return true; }
      if (platform === 'android') {
        const a = androidObj();
        if (typeof a[action] !== 'function') return false;
        /* Android 인터페이스는 문자열 하나만 안전하게 넘길 수 있습니다.
           숫자를 그대로 넘기면 큰 정수(epoch ms)가 int 로 잘립니다. */
        a[action](JSON.stringify(msg));
        return true;
      }
    } catch (_) {}
    return false;
  }

  /* 네이티브에 넘기는 것은 딱 네 가지입니다. label 은 알림 본문에 쓰이고,
     duration 은 알림의 진행 표시에, setId 는 지금 필요 없지만 나중에 어느
     세트였는지 되짚을 수 있도록 같이 실어 둡니다. */
  function shape(rt) {
    if (!rt) return null;
    return {
      endsAt: Number(rt.endsAt) || 0,
      duration: Number(rt.duration) || 0,
      label: String(rt.label || ''),
      setId: String(rt.setId || ''),
    };
  }

  const Native = {
    /* 앱 코드는 이 값 하나만 보면 됩니다. */
    ok: !!platform,
    platform,

    /* 웹이 알림을 띄우면 안 되는 상황인지. 네이티브가 있으면 알림은 전부
       네이티브 몫입니다 — 양쪽이 다 띄우면 같은 내용이 두 번 쌓입니다. */
    ownsNotifications: !!platform,

    startRest(rt) { return send('startRest', shape(rt)); },
    updateRest(rt) { return send('updateRest', shape(rt)); },
    stopRest() { return send('stopRest'); },

    /* 알림 권한. iOS 는 앱을 처음 열 때 네이티브가 이미 물어봅니다.
       Android 13+ 는 런타임 권한이라 필요할 때 부릅니다. */
    requestNotificationPermission() { return send('requestNotificationPermission'); },

    /* 앱을 다시 열었을 때, 네이티브가 아직 들고 있는 휴식이 있으면 그걸
       돌려줍니다. 이쪽이 localStorage 보다 진실에 가깝습니다 — 앱이 완전히
       죽어 있는 동안에도 계속 돌던 쪽이니까요.

       iOS 는 동기 응답이 안 되므로, 네이티브가 페이지 스크립트보다 먼저
       window.__fitlogNativeRest 에 값을 넣어 둡니다(WKUserScript,
       atDocumentStart). Android 는 그냥 물어보면 됩니다. */
    pending() {
      try {
        if (platform === 'android') {
          const raw = androidObj().pendingRest();
          if (raw) return normalize(JSON.parse(raw));
        }
      } catch (_) {}
      try {
        const raw = window.__fitlogNativeRest;
        if (raw) return normalize(typeof raw === 'string' ? JSON.parse(raw) : raw);
      } catch (_) {}
      return null;
    },

    /* ── 네이티브 → 웹 ────────────────────────────────────────────────────
       네이티브는 아래 두 개만 부릅니다. 앱 코드가 startRestTicker 안에서
       핸들러를 꽂아 둡니다. 아직 안 꽂혔을 때 온 호출은(스크립트가 다 뜨기
       전에 알림을 눌러 들어온 경우) 버리지 않고 들고 있다가 넘깁니다. */
    _queued: [],
    _onFinish: null,
    _onCancel: null,

    onFinish(fn) {
      Native._onFinish = fn;
      flush();
    },
    onCancel(fn) {
      Native._onCancel = fn;
      flush();
    },

    /* 타이머가 끝났다고 네이티브가 알려 줍니다. 웹은 어차피 매초 endsAt 을
       다시 재고 있어서 이게 없어도 맞지만, 알림을 눌러 앱이 막 깨어난
       순간에는 이 신호가 화면을 즉시 맞춰 줍니다. */
    _finished() { dispatch('finish'); },
    /* 사용자가 네이티브 알림에서 휴식을 직접 껐습니다. */
    _cancelled() { dispatch('cancel'); },
  };

  function normalize(o) {
    if (!o || !o.endsAt) return null;
    const endsAt = Number(o.endsAt);
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return null;
    return {
      endsAt,
      duration: Number(o.duration) || Math.max(5, Math.round((endsAt - Date.now()) / 1000)),
      label: String(o.label || ''),
      setId: String(o.setId || ''),
    };
  }

  function dispatch(kind) {
    const fn = kind === 'finish' ? Native._onFinish : Native._onCancel;
    if (typeof fn === 'function') { try { fn(); } catch (_) {} return; }
    Native._queued.push(kind);
  }

  function flush() {
    if (!Native._queued.length) return;
    const q = Native._queued.slice();
    Native._queued.length = 0;
    q.forEach(dispatch);
  }

  window.FitLogNative = Native;

  /* 네이티브 안에서 돌 때는 <html> 에 표시를 남깁니다. CSS 에서 껍데기별로
     여백(안전영역)이나 스크롤 튕김을 손봐야 할 때 걸 곳이 필요합니다. */
  try {
    if (platform) document.documentElement.setAttribute('data-native', platform);
  } catch (_) {}
})();
