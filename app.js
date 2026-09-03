/* FITLOG — Main Application */
/* index.html 의 '빈 화면 복구' 가 이 표시를 봅니다. 이 줄이 실행됐다는 건
   스크립트가 내려받아져 돌기 시작했다는 뜻이고, 그러면 화면이 잠깐 비어
   있어도 그건 아직 그리는 중이지 고장이 아닙니다. 맨 위에 둡니다 — 아래에서
   무슨 오류가 나든 '받아지긴 했다' 는 사실은 남아야 합니다. */
try { window.__fitlogBooted = true; } catch (_) {}
/* 버전은 이 파일을 부르는 <script src="./app.js?v=NN"> 에서 그대로 읽습니다.
   따로 상수를 두면 배포 번호와 화면에 뜨는 번호가 언젠가 어긋나고, 그러면
   "무슨 버전 쓰세요?" 라고 물어봐야 소용이 없어집니다. 여기서 읽으면 캐시
   번호를 올리는 순간 화면 표기도 같이 따라옵니다. */
const APP_VERSION = (() => {
  try {
    const src = (document.currentScript && document.currentScript.src) || '';
    const m = src.match(/[?&]v=([\w.-]+)/);
    return m ? 'v' + m[1] : '';
  } catch (_) { return ''; }
})();
(() => {
  /* ── Utilities ──────────────────────────── */
  const WEEKDAYS = ['일','월','화','수','목','금','토'];
  const WEEKDAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  /* 날짜를 YYYY-MM-DD 로 적을 때 toISOString() 을 쓰면 안 됩니다. 그 함수는
     UTC 기준이라, 한국(UTC+9)에서 자정으로 맞춘 날짜는 전날 15시로 바뀌어
     하루 앞선 날짜가 나옵니다. 이 앱의 날짜는 전부 사용자의 달력 날짜입니다. */
  function isoLocal(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  /* 앞 단어의 받침에 따라 조사를 고릅니다 — "코어를" / "팔을".
     받침 여부는 한글 음절 코드에서 바로 나옵니다: (코드 - 0xAC00) % 28 이
     0 이면 받침이 없습니다. 한글이 아니면 받침 없는 쪽을 씁니다. */
  function josa(word, withJong, withoutJong) {
    const ch = String(word || '').trim().slice(-1);
    if (!ch) return withoutJong;
    const code = ch.charCodeAt(0);
    if (!(code >= 0xac00 && code <= 0xd7a3)) return withoutJong;
    return (code - 0xac00) % 28 ? withJong : withoutJong;
  }
  function isoToDate(iso)  { const [y,m,d] = iso.split('-').map(Number); return new Date(y,m-1,d); }
  function shortDate(iso)  { const [,m,d] = iso.split('-'); return `${Number(m)}.${Number(d)}`; }
  function longDate(iso)   { const [y,m,d] = iso.split('-').map(Number); return `${m}월 ${d}일 (${WEEKDAYS[new Date(y,m-1,d).getDay()]})`; }
  function monthKey(iso)   { return iso.slice(0,7); }
  function fmtMonth(key)   { const [y,m] = key.split('-'); return `${y}년 ${Number(m)}월`; }
  function clone(v)        { return JSON.parse(JSON.stringify(v)); }
  function uid()           { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
  function esc(s)          {
    return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function parseNum(v) {
    if (v === '' || v == null) return '';
    const n = Number(v);
    return Number.isFinite(n) ? n : '';
  }

  /* Reject instead of hanging forever. The Firestore SDK never settles when the
     database is missing/unreachable, so every cloud call needs a hard deadline. */
  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label || '작업'} 시간 초과`)), ms);
      }),
    ]);
  }

  /* ── 테마 ────────────────────────────────────────────────────────────────
     'auto' 는 아무것도 안 하는 상태입니다 — data-theme 속성을 지우면 CSS 의
     prefers-color-scheme 이 시스템 설정을 그대로 따릅니다. 'light'/'dark' 는
     그 위에 속성으로 덮어씁니다(속성 선택자가 미디어쿼리보다 우선합니다). */
  const THEME_MODES = ['auto', 'light', 'dark'];

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('fitlog-theme-mode'); } catch (_) {}
    state.themeMode = THEME_MODES.includes(saved) ? saved : 'auto';
    applyTheme();
    /* auto 로 두고 해가 지면(또는 시스템이 밤에 자동 전환되면) 앱을 다시
       열지 않아도 색이 따라갑니다. CSS 는 알아서 바뀌지만 주소창 색은
       JS 가 다시 칠해 줘야 합니다. */
    try {
      window.matchMedia('(prefers-color-scheme: light)')
        .addEventListener('change', () => { if (state.themeMode === 'auto') applyTheme(); });
    } catch (_) {}
  }

  /* 지금 실제로 보이는 테마 — 'auto' 면 시스템 설정을 읽습니다. */
  function effectiveTheme() {
    if (state.themeMode !== 'auto') return state.themeMode;
    try { return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; }
    catch (_) { return 'dark'; }
  }

  function applyTheme() {
    const html = document.documentElement;
    if (state.themeMode === 'auto') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', state.themeMode);

    /* 주소창·상태바 색도 같이 맞춥니다. 이게 없으면 라이트 화면 위에 검은
       상태바가 남아 앱이 반쯤만 바뀐 것처럼 보입니다. */
    try {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', effectiveTheme() === 'light' ? '#FAFBFC' : '#09090D');
    } catch (_) {}
  }

  function setThemeMode(mode) {
    if (!THEME_MODES.includes(mode)) return;
    state.themeMode = mode;
    try { localStorage.setItem('fitlog-theme-mode', mode); } catch (_) {}
    applyTheme();
  }

  /* ── State ──────────────────────────────── */
  const state = {
    tab: 'home',
    date: todayISO(),
    session: null,
    sessions: [],
    customExercises: [],

    /* Sheets */
    pickerPart: null,
    pickSelection: [],   /* 시트에서 고른 운동들 — 완료를 눌러야 실제로 추가됨 */
    exerciseSearch: '',
    exerciseInfoId: null,
    weightPicker: null,   /* { exId, setId, str, fresh } */
    repsPicker:   null,   /* { exId, setId, str, fresh } */

    /* Auth */
    authReady: false,
    user: null,
    guest: false,
    /* 기기 저장이 실패한 적이 있는지 — 같은 경고를 반복하지 않으려고 둡니다. */
    saveBroken: false,
    /* 피커에서 '나만의 운동 직접 추가' 칸에 적고 있는 이름 */
    customName: '',
    authMode: 'signin',       /* 'signin' | 'signup' */
    authId: '',               /* 아이디 (or email) typed on the sign-in screen */
    authPassword: '',
    authBusy: false,
    authError: '',
    syncing: false,
    accountBusy: false,

    /* Signup wizard. Kept in state rather than read off the DOM at submit time
       so moving between steps doesn't lose what was typed. */
    signupStep: 1,
    /* True from the moment createUser fires until signup has finished cleaning
       up. Firebase signs the new account in the instant it is created — long
       before the users/{uid} document exists — so without this the auth
       listener would walk a half-built account into the app and the onboarding
       gate would read a profile that has not been written yet. */
    signingUp: false,
    signup: {
      username: '', password: '', password2: '', email: '',
      name: '', gender: '', birthYear: '', heightCm: '', weightKg: '',
    },
    /* Live 아이디 availability: '' | 'checking' | 'free' | 'taken' | message */
    idCheck: { id: '', status: '', message: '' },

    /* Profile, and the one-time gate that collects it.
       onboarding is true when someone is signed in but has no 아이디 yet —
       every Google account starts there, which is what keeps a Google user and
       a password user from ending up as two different kinds of account. */
    profile: null,
    onboarding: false,
    profileEditing: false,
    /* Year the 출생연도 wheel is showing, or null when it is closed. Held
       separately from state.signup.birthYear so scrolling around inside the
       wheel doesn't commit anything until 확인 is pressed. */
    yearPicker: null,

    /* Pre-login records found on this device, offered on the home screen.
       null when there is nothing to offer or the user has dismissed it. */
    pendingImport: null,

    /* Editing a day that is not today: changes are held until 저장.
       pastBaseline is the record as it was on disk, so 취소 can restore it. */
    editingPast: false,
    pastDirty: false,
    pastBaseline: null,

    /* Password reset screen */
    resetTarget: '',      /* address resolved from 아이디, awaiting confirmation */
    resetSent: '',        /* masked address once the mail has gone out */
    resetCooldown: 0,     /* seconds left before 다시 보내기 is allowed */

    /* History calendar — 보고 있는 달 (YYYY-MM) */
    histMonth: null,

    /* Day the read-only summary overlay is showing, or null */
    summaryDate: null,
    /* 히스토리 달력에서 펼쳐 놓은 날짜 (전체 화면 summaryDate 와는 별개) */
    histDay: null,
    /* 운동량 추이 그래프의 범위 — 'week' | 'month' */
    statsRange: 'week',
    /* 개인 기록 목록을 전부 펼쳤는지 */
    prAll: false,

    /* 기록 검색 — 히스토리 상단 돋보기로 열리는 전체 화면 */
    searchOpen: false,
    logSearch: '',
    searchLibOpen: false,
    /* 운동 이력 화면에 띄운 운동 이름 (없으면 null). id 가 아니라 이름인
       이유는 lastLog·allPersonalBests 가 이미 이름으로 묶기 때문입니다. */
    exHistoryName: null,
    exhRange: '3m',        /* '3m' | '1y' | 'all' */
    /* 이 달의 기록 목록을 전부 펼쳤는지 */
    histAll: false,

    /* Toast */
    toast: '',
    toastTimer: 0,

    /* Rest timer — { endsAt, duration, label } while a rest is running, else null.
       Rendered as its own DOM node appended to <body> (see startRestTimer), never
       through the normal render() innerHTML swap, so a live countdown can't steal
       focus from a numpad or input the user is mid-edit on. */
    restTimer: null,

    /* Theme mode: 'auto' | 'light' | 'dark' */
    themeMode: 'auto',

    /* 운동 카드 아코디언 — { exId: true/false }. 값이 없으면 기본값을
       씁니다(다 끝낸 운동은 접힘). exIsExpanded() 참고. */
    expandedExercises: {},

    /* '＋ 부위' 로 여는 부위 선택 시트 */
    partSheet: false,
    /* 부위를 고르는 중일 때의 '아직 확정 안 된' 목록. null 이면 고르는 중이
       아니고, 화면은 session.parts 를 그대로 보여 줍니다. 운동 피커의
       pickSelection 과 같은 방식입니다 — 누르는 즉시 반영되면, 부위를 잘못
       눌렀을 때 그 부위에 딸린 기록까지 지울지 묻는 대화가 곧바로 뜹니다. */
    partSelection: null,

    /* 방금 마지막 세트를 채운 운동 — 접히기 전 잠깐 더 펼쳐 두는 유예. */
    justCompletedExId: null,
  };

  const REST_PRESETS = [30, 60, 90, 120, 180];
  function restDuration() {
    const n = Number(localStorage.getItem('fitlog-rest-dur'));
    return REST_PRESETS.includes(n) ? n : 90;
  }
  function setRestDuration(sec) {
    localStorage.setItem('fitlog-rest-dur', String(sec));
  }
  /* Off unless asked for. The timer takes over the bottom of the screen the
     moment a set is ticked, which is in the way for anyone who is not actually
     resting to a clock — and most people are not. */
  function restTimerOn() {
    try { return localStorage.getItem('fitlog-rest-on') === '1'; } catch (_) { return false; }
  }
  function setRestTimerOn(on) {
    try {
      if (on) localStorage.setItem('fitlog-rest-on', '1');
      else localStorage.removeItem('fitlog-rest-on');
    } catch (_) {}
  }
  /* Warm-ups need far less recovery than a working set. */
  function restDurationFor(set) {
    return set && set.warmup ? Math.max(20, Math.round(restDuration() * 0.4)) : restDuration();
  }

  /* ── 화면 꺼짐 방지 ───────────────────────────────────────────────────────
     세트를 하나 끝내고 폰을 내려놨다가 다시 집으면 잠금화면이 떠 있습니다.
     운동 한 번에 열 번 넘게 겪는 일이고, 그때마다 얼굴을 들이대거나 비밀번호를
     칩니다 — 손에 초크나 땀이 묻어 있으면 지문도 안 먹습니다. 기록하려고 연
     앱인데 기록까지 가는 데 매번 한 단계가 더 붙습니다.

     Screen Wake Lock 은 '화면이 보이는 동안' 만 유지됩니다. 주머니에 넣거나
     다른 앱으로 넘어가면 브라우저가 알아서 풀어 주므로, 켜 둔 채 잊어버려도
     배터리가 계속 새지는 않습니다. 대신 돌아왔을 때 자동으로 복구되지도
     않습니다 — visibilitychange 에서 우리가 다시 잡아야 합니다. 이 API 를 쓸 때
     가장 흔히 빠뜨리는 부분이고, 빠뜨리면 "처음 몇 분만 되다가 만다" 는
     재현하기 까다로운 증상으로 나타납니다.

     잠그는 범위는 '기록 탭이 열려 있는 동안' 으로 좁힙니다. 홈이나 히스토리를
     들여다보는 건 운동 중이라는 뜻이 아니고, 거기서까지 화면을 붙잡으면 그냥
     배터리를 먹는 앱이 됩니다. */
  const WAKE_KEY = 'fitlog-wakelock';

  /* 기본값은 켜짐입니다. 휴식 타이머는 기본 꺼짐인데 이건 반대인 이유:
     타이머는 화면 아래를 차지해서 안 쓰는 사람에게 방해가 되지만, 이건
     아무 자리도 차지하지 않고 기록 탭에 있는 동안에만 조용히 동작합니다.
     끄고 싶은 사람을 위해 스위치는 둡니다. */
  function wakeLockOn() {
    try { return localStorage.getItem(WAKE_KEY) !== '0'; } catch (_) { return true; }
  }
  function setWakeLockOn(on) {
    try {
      if (on) localStorage.removeItem(WAKE_KEY);
      else localStorage.setItem(WAKE_KEY, '0');
    } catch (_) {}
  }

  let _wakeSentinel = null;   /* 지금 잡고 있는 WakeLockSentinel, 없으면 null */
  let _wakeBusy = false;      /* request() 가 아직 안 끝남 — 중복 요청 방지 */
  let _wakeBlocked = false;   /* 이번 포그라운드에서 거절당함 — 조르지 않음 */

  function wakeLockWanted() {
    return wakeLockOn()
        && state.tab === 'workout'
        && document.visibilityState === 'visible';
  }

  /* render() 끝과 visibilitychange 에서 부릅니다. 여러 번 불려도 안전하도록
     '지금 상태' 와 '원하는 상태' 를 비교해서 차이만 처리합니다 — 렌더는 세트를
     하나 체크할 때마다 도는데, 그때마다 잠금을 새로 잡으면 안 됩니다. */
  async function syncWakeLock() {
    const want = wakeLockWanted();

    if (!want) {
      /* 네이티브 껍데기에는 웹 Wake Lock 이 아예 없을 수 있으므로(WKWebView·
         Android WebView 는 노출하지 않습니다) 양쪽 모두에 알립니다. 껍데기가
         없으면 이 호출은 조용한 no-op 입니다. */
      try { window.FitLogNative?.keepAwake(false); } catch (_) {}
      const s = _wakeSentinel;
      _wakeSentinel = null;
      if (s) { try { await s.release(); } catch (_) {} }
      return;
    }

    try { window.FitLogNative?.keepAwake(true); } catch (_) {}
    if (_wakeSentinel || _wakeBusy || _wakeBlocked) return;
    if (!navigator.wakeLock) return;

    _wakeBusy = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      /* 기다리는 사이에 탭을 옮겼거나 화면이 꺼졌을 수 있습니다. 그대로 들고
         있으면 히스토리를 넘겨 보는 내내 화면이 안 꺼집니다. */
      if (!wakeLockWanted()) {
        try { await s.release(); } catch (_) {}
      } else {
        _wakeSentinel = s;
        /* 브라우저가 스스로 풀었을 때(화면 꺼짐, 다른 앱으로 전환) 우리 쪽
           참조도 같이 비웁니다. 안 비우면 돌아왔을 때 '이미 잡고 있다' 고
           착각해서 다시 잡지 않습니다 — 위에서 말한 그 증상입니다. */
        s.addEventListener('release', () => { if (_wakeSentinel === s) _wakeSentinel = null; });
      }
    } catch (_) {
      /* NotAllowedError(저전력 모드, 권한 정책, 백그라운드) 또는 미지원.
         조용히 넘깁니다 — 화면이 꺼지는 건 불편할 뿐 기록에는 아무 영향이
         없고, 사용자가 손쓸 수 있는 일도 아니라서 토스트를 띄울 이유가
         없습니다. 다만 다음 렌더마다 다시 조르지 않도록 표시해 두고, 앱이
         다시 앞으로 나올 때 한 번 더 기회를 줍니다(저전력 모드는 풀립니다). */
      _wakeBlocked = true;
    } finally {
      _wakeBusy = false;
    }
  }

  function watchWakeLock() {
    document.addEventListener('visibilitychange', () => {
      /* 앞으로 나온 순간은 새 기회입니다 — 뒤에서 거절당했던 것이 지금은
         될 수 있습니다. */
      if (document.visibilityState === 'visible') _wakeBlocked = false;
      syncWakeLock();
    });
    /* iOS 에서 OS 가 얼려 둔 페이지는 visibilitychange 없이 pageshow 로만
       돌아오는 경우가 있습니다. restoreRestTimer 쪽이 이미 같은 이유로 세
       가지 이벤트를 듣고 있고, 여기서도 같은 판단을 합니다. */
    window.addEventListener('pageshow', () => { _wakeBlocked = false; syncWakeLock(); });
  }

  /* ── 개인화 · 접근성 설정 ──────────────────────────────────────────────────
     휴식 타이머 설정과 같은 방식입니다: 계정이 아니라 이 기기에 딸린 취향이라
     localStorage 에 각각 따로 둡니다. 기본값은 지금까지의 동작과 정확히
     같게 잡아서, 아무도 손대지 않으면 v61 과 화면·동작이 같습니다. */
  const START_TABS = ['home', 'workout', 'history', 'settings'];
  function startTab() {
    try {
      const v = localStorage.getItem('fitlog-start-tab');
      return START_TABS.includes(v) ? v : 'home';
    } catch (_) { return 'home'; }
  }
  function setStartTab(tab) { try { localStorage.setItem('fitlog-start-tab', tab); } catch (_) {} }

  /* 월요일 시작이 지금까지의 기본 동작(weekStart, statsBuckets 등이 이미
     월요일 기준)이라, 기본값은 true 로 둬서 스위치를 안 건드리면 그대로입니다. */
  function weekStartsMon() {
    try { return localStorage.getItem('fitlog-week-start') !== 'sun'; } catch (_) { return true; }
  }
  function setWeekStartsMon(mon) {
    try { localStorage.setItem('fitlog-week-start', mon ? 'mon' : 'sun'); } catch (_) {}
  }
  /* 오늘이 속한 주의 시작일(자정). 설정에 따라 월요일 또는 일요일 기준. */
  function weekStartOf(d) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const dow = weekStartsMon() ? (x.getDay() + 6) % 7 : x.getDay();
    x.setDate(x.getDate() - dow);
    return x;
  }
  /* 달력/주간 스트립에서 요일 헤더를 설정에 맞게 돌려 씁니다.
     WEEKDAYS·WEEKDAYS_SHORT 원본 배열은 다른 곳(longDate 등)이 실제
     요일 인덱스로 그대로 쓰고 있어 손대면 안 되고, 여기서만 회전한
     사본을 만들어 씁니다. */
  function weekdayStartIdx() { return weekStartsMon() ? 1 : 0; }
  function weekdayLabelsKR()    { const s = weekdayStartIdx(); return Array.from({length:7}, (_,i)=>WEEKDAYS[(s+i)%7]); }
  function weekdayLabelsShort() { const s = weekdayStartIdx(); return Array.from({length:7}, (_,i)=>WEEKDAYS_SHORT[(s+i)%7]); }

  const FONT_SCALES = [0.92, 1, 1.08, 1.18];
  function fontScale() {
    const n = Number(localStorage.getItem('fitlog-font-scale'));
    return FONT_SCALES.includes(n) ? n : 1;
  }
  function setFontScale(n) { try { localStorage.setItem('fitlog-font-scale', String(n)); } catch (_) {} }
  /* 폰트가 아니라 화면 전체를 CSS zoom 으로 같이 키웁니다 — 기존 CSS 가
     px 고정값 위주라 폰트 크기만 올리면 아이콘·여백·터치 영역은 그대로라
     레이아웃이 깨집니다. zoom 은 그 전부를 비율대로 같이 키워 줍니다. */
  function applyFontScale() {
    try { document.documentElement.style.setProperty('--ui-scale', String(fontScale())); } catch (_) {}
  }

  /* 진동은 지금까지 항상 켜져 있었으니(휴식 종료·PR) 기본값 true. */
  function hapticsOn() {
    try { return localStorage.getItem('fitlog-haptics') !== '0'; } catch (_) { return true; }
  }
  function setHapticsOn(on) { try { localStorage.setItem('fitlog-haptics', on ? '1' : '0'); } catch (_) {} }
  function vibrate(pattern) {
    if (!hapticsOn() || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (_) {}
  }
  /* 무게·키 단위. 저장은 언제나 kg·cm — 화면에 보여주고 입력받을 때만
     변환합니다. 그래야 단위를 몇 번을 바꿔도 기록 자체는 절대 어긋나지
     않습니다(오늘 100kg 로 적은 세트가 내일 단위를 바꿨다고 값이 미끄러지면
     개인 기록·볼륨 계산이 전부 조용히 틀어집니다). */
  function unitWeight() { try { return localStorage.getItem('fitlog-unit-weight') === 'lb' ? 'lb' : 'kg'; } catch (_) { return 'kg'; } }
  function setUnitWeight(u) { try { localStorage.setItem('fitlog-unit-weight', u); } catch (_) {} }
  function unitHeight() { try { return localStorage.getItem('fitlog-unit-height') === 'in' ? 'in' : 'cm'; } catch (_) { return 'cm'; } }
  function setUnitHeight(u) { try { localStorage.setItem('fitlog-unit-height', u); } catch (_) {} }

  const LB_PER_KG = 2.2046226218;
  /* 저장된 kg 값을 지금 단위의 "숫자만" 화면용으로 바꿉니다. */
  function toDisplayWeight(kg) {
    if (kg === '' || kg == null || !Number.isFinite(Number(kg))) return kg;
    const n = Number(kg);
    return unitWeight() === 'lb' ? Math.round(n * LB_PER_KG * 10) / 10 : Math.round(n * 10) / 10;
  }
  /* 지금 단위로 입력된 숫자를 저장용 kg 로 바꿉니다. */
  function fromDisplayWeight(v) {
    if (v === '' || v == null) return v;
    const n = Number(v);
    if (!Number.isFinite(n)) return n;
    return unitWeight() === 'lb' ? Math.round((n / LB_PER_KG) * 100) / 100 : n;
  }
  function weightUnitLabel() { return unitWeight(); }
  function toDisplayHeight(cm) {
    if (cm === '' || cm == null || !Number.isFinite(Number(cm))) return cm;
    const n = Number(cm);
    return unitHeight() === 'in' ? Math.round(n / 2.54 * 10) / 10 : Math.round(n);
  }
  function fromDisplayHeight(v) {
    if (v === '' || v == null) return v;
    const n = Number(v);
    if (!Number.isFinite(n)) return n;
    return unitHeight() === 'in' ? Math.round(n * 2.54 * 10) / 10 : Math.round(n);
  }
  function heightUnitLabel() { return unitHeight(); }

  /* 자주 쓰는 운동 즐겨찾기. id 가 있는 운동(기본 제공 + 나만의 운동)만
     대상입니다 — id 없이는 나중에 다시 찾아 켤 방법이 없습니다. */
  const FAV_KEY = 'fitlog-fav-ex';
  function favoriteIds() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (_) { return []; }
  }
  function isFavoriteEx(id) { return !!id && favoriteIds().includes(id); }
  function toggleFavoriteEx(id) {
    if (!id) return;
    const cur = favoriteIds();
    const i = cur.indexOf(id);
    if (i === -1) cur.push(id); else cur.splice(i, 1);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(cur)); } catch (_) {}
  }


  /* ── DOM root ───────────────────────────── */
  const appEl = document.getElementById('app');
  const importInput = document.getElementById('import-file');

  /* 탭을 눌러 옮겨갈 때만 방향이 있는 슬라이드를 씁니다. goTab() 이 매 렌더
     직전에 채워 두고, render() 가 그 값을 한 번 읽자마자 비웁니다 — 그래야
     체크박스 하나 누른 것 같은, 탭과 무관한 재렌더에서는 다시 슬라이드가
     재생되지 않습니다. */
  let navDir = null;
  /* 세트를 옆으로 미는 동작이 끝나자마자 그 아래 버튼의 클릭으로도 잡히는
     것을 막는 1회용 플래그. */
  let suppressNextClick = false;
  /* .set-swipe-action 너비와 맞춥니다. 세트 줄이 좁아서(6칸이 빽빽합니다),
     너무 많이 밀면 세트 번호까지 왼쪽 밖으로 밀려 나가 뭘 지우는 중인지
     안 보입니다 — 삭제 버튼이 겨우 들어갈 만큼만 잡아 둡니다. */
  /* 밀었을 때 드러나는 거리. 삭제 버튼 자체는 60px 이고, 6px 은 완료(✓)
     버튼과 삭제 버튼 사이의 틈으로 남습니다 — 틈이 없으면 초록 ✓ 와 빨간
     삭제가 맞붙어 하나의 덩어리로 읽혀서, 어디까지가 어느 버튼인지 손이
     알 수 없습니다. */
  const SWIPE_REVEAL = 66;
  let openSwipeRow = null;
  /* 방금 추가된 운동·세트의 id. renderExerciseCard 가 이번 렌더에서 한 번
     읽어 살짝 커지며 나타나는 클래스를 붙이고, render() 가 곧바로 비웁니다
     — DOM 을 통째로 새로 그리는 구조라, "새로 생겼다" 는 사실 자체를 상태로
     들고 있다가 한 번만 써먹는 수밖에 없습니다. */
  let pendingEnterExIds = new Set();
  let pendingEnterSetIds = new Set();
  /* 같은 방식으로, '방금 접힌' 운동. 접히는 순간 짧은 움직임을 한 번 주려고
     둡니다 — 움직임이 없으면 카드가 줄어든 게 아니라 내용이 사라진 것처럼
     보입니다. */
  let pendingFoldExIds = new Set();

  /* ── Data helpers ───────────────────────── */
  function emptySession(date) {
    return { date, parts: [], notes: '', exercises: [], run: { km:'', minutes:'', notes:'' },
             completed: false, completedAt: 0 };
  }
  function normalizeSession(raw) {
    /* 편집할 세션은 여기서 한 번 고쳐 둡니다 — 운동은 있는데 부위 칩이 빠진
       기록이면 칩을 도로 채워, 칩과 목록이 서로 다른 말을 하지 않게 합니다.
       (보여주기만 하는 다른 날 기록은 sessionPartIds 가 같은 일을 합니다.) */
    const parts = Array.isArray(raw.parts) ? raw.parts.slice() : [];
    for (const ex of Array.isArray(raw.exercises) ? raw.exercises : []) {
      if (ex && ex.part && !parts.includes(ex.part)) parts.push(ex.part);
    }
    return {
      date: raw.date,
      parts,
      notes: raw.notes || '',
      exercises: Array.isArray(raw.exercises) ? raw.exercises : [],
      run: { km: raw.run?.km ?? '', minutes: raw.run?.minutes ?? '', notes: raw.run?.notes ?? '' },
      /* Sessions written before this field existed are treated as finished:
         they were logged and left alone, so showing every one of them as
         "진행 중" in the history would be wrong. */
      completed: raw.completed === undefined ? true : !!raw.completed,
      completedAt: Number(raw.completedAt) || 0,
    };
  }
  /* 부위는 고른 순서가 아니라 항상 같은 순서로 적습니다. 가슴을 먼저 골랐든
     팔을 먼저 골랐든 "가슴, 팔" 로 나와야, 기록 목록을 훑을 때 같은 조합이
     같은 글자로 보여 눈에 익습니다. 순서는 PARTS 에 정의된 순서
     (가슴·등·어깨·팔·하체·코어·스트레칭·러닝) 를 그대로 씁니다. */
  function orderedParts(ids) {
    const want = new Set(ids || []);
    return PARTS.filter(p => want.has(p.id));
  }
  /* 그날 실제로 있는 부위 = 고른 부위 칩 + 기록된 운동의 부위.
     둘을 합치는 이유: 예전 버전이나 가져오기(import)로 들어온 기록에는
     parts 가 비어 있는데 운동은 들어 있는 경우가 있습니다. 칩만 보고 그리면
     그 운동들이 화면에서 통째로 사라져 — 세트 수는 15 라고 나오는데 정작
     목록에는 아무것도 없는 — 기록을 잃은 것처럼 보입니다. 운동이 있다는 건
     그 부위를 했다는 뜻이므로, 운동 쪽을 사실로 봅니다. */
  function sessionPartIds(s) {
    const ids = new Set(Array.isArray(s?.parts) ? s.parts : []);
    for (const ex of s?.exercises || []) if (ex && ex.part) ids.add(ex.part);
    if (hasRunData(s?.run)) ids.add('run');
    return [...ids];
  }
  function sessionSummary(s) {
    return orderedParts(sessionPartIds(s)).map(p => p.label).join(', ');
  }
  /* A stretch is held, not lifted: there is no weight, and the number that
     matters is seconds. The library marks these with hold:true and the set row
     drops its kg column accordingly — asking someone how many kilos of 아기
     자세 they did would be nonsense. */
  function isHoldExercise(ex) {
    if (!ex) return false;
    if (ex.hold != null) return !!ex.hold;
    const lib = findExercise(ex.id) || state.customExercises.find(e => e.id === ex.id);
    return !!(lib && lib.hold);
  }

  function hasRunData(run) {
    return run && ((run.km!==''&&run.km!=null)||(run.minutes!==''&&run.minutes!=null));
  }
  /* Is there anything on this day worth offering 운동 마치기 for? */
  function sessionHasAnything(s) {
    if (!s) return false;
    const sets = (s.exercises || []).reduce((a, ex) => a + (ex.sets || []).length, 0);
    return sets > 0 || (s.exercises || []).length > 0 || hasRunData(s.run);
  }

  /* Shows or hides the finish bar in place. Used by the 러닝 inputs, which
     cannot re-render without dropping the keyboard mid-entry. */
  function paintFinishBar() {
    const bar = document.querySelector('.finish-bar');
    if (!bar || bar.classList.contains('done')) return;
    bar.classList.toggle('is-empty', !sessionHasAnything(state.session));
  }

  function worthSaving(s) {
    return s && ((s.parts||[]).length||(s.exercises||[]).length||hasRunData(s.run)||(s.notes||'').trim());
  }
  function libraryFor(partId) {
    const defaults = DEFAULT_EXERCISES[partId] || [];
    const custom = state.customExercises.filter(e => e.part === partId);
    return [...custom, ...defaults];
  }
  function lastLog(name, beforeDate) {
    const prev = state.sessions
      .filter(s => s.date < beforeDate)
      .sort((a,b) => b.date.localeCompare(a.date));
    for (const s of prev) {
      const ex = (s.exercises||[]).find(e => e.name === name);
      if (ex && (ex.sets||[]).length) return { date: s.date, sets: ex.sets };
    }
    return null;
  }
  /* ── 개인 기록 ───────────────────────────────────────────────────────────
     기록으로 셀 수 있는 세트인지 가려내고, 그 무게와 횟수를 돌려줍니다.
     웜업은 제외합니다 — 가볍게 몸을 푼 것을 기록이라고 부르면 기록이라는
     말이 값을 잃습니다. 무게나 횟수가 비어 있는 세트도 셀 수 없습니다. */
  function setScore(st) {
    const kg = Number(st.kg), reps = Number(st.reps);
    if (st.warmup || !Number.isFinite(kg) || !Number.isFinite(reps) || kg <= 0 || reps <= 0) return null;
    return { kg, reps };
  }

  /* 세트를 완료할 때 하던 실시간 PR 판정(personalBest / bestOrm / checkPR)은
     걷어냈습니다. 화면 어디에도 그 결과를 쓰지 않는데 세트를 체크할 때마다
     전체 기록을 두 번 훑고 있었습니다. 운동별 최고 기록은 아래
     allPersonalBests() 가 히스토리의 "개인 기록" 카드에서 한 번에 계산합니다. */

  /* 운동별 최고 기록 목록 — 히스토리의 "개인 기록" 카드에서 씁니다. */
  function allPersonalBests() {
    const map = new Map();
    for (const s of state.sessions) {
      for (const ex of s.exercises || []) {
        for (const st of ex.sets || []) {
          if (!st.done) continue;
          const sc = setScore(st);
          if (!sc) continue;
          const cur = map.get(ex.name);
          if (!cur || sc.kg > cur.kg) map.set(ex.name, { ...sc, date: s.date, part: ex.part });
        }
      }
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => {
        const pa = PARTS.findIndex(p => p.id === a.part), pb = PARTS.findIndex(p => p.id === b.part);
        if (pa !== pb) return pa - pb;
        return b.kg - a.kg;
      });
  }

  function exVolume(ex) {
    /* Warm-up sets don't count toward working volume — matches how lifters
       actually think about volume, and keeps the number meaningful. */
    return (ex.sets||[]).reduce((sum, st) => {
      if (st.warmup) return sum;
      const kg = Number(st.kg), reps = Number(st.reps);
      return sum + (Number.isFinite(kg) && Number.isFinite(reps) ? kg * reps : 0);
    }, 0);
  }
  /* "2세트" / "웜업" — matches the numbering shown in the set table. */
  function setLabelFor(ex, setId) {
    let n = 0;
    for (const st of ex.sets || []) {
      if (!st.warmup) n++;
      if (st.id === setId) return st.warmup ? '웜업' : `${n}세트`;
    }
    return '';
  }
  function exProgress(ex) {
    const sets = ex.sets || [];
    return { done: sets.filter(s => s.done).length, total: sets.length };
  }
  /* ── 세트 간 휴식 ────────────────────────────────────────────────────────
     세트를 완료할 때 남긴 시각으로 계산합니다. 그 간격들의 중앙값이 세트 간
     휴식입니다. 총 운동 시간(첫~마지막 세트 사이)은 더는 화면에 보여주지
     않습니다 — 세트를 몰아서 나중에 한꺼번에 체크하면(흔한 사용 패턴입니다)
     실제 운동 시간과 크게 어긋나는데, 그 두 경우를 구분할 방법이 없어서
     부정확하다는 지적을 받았습니다. minutes 는 그래도 계산해서 남겨
     둡니다 — 세션이 통째로 말이 안 되면(0분 이하거나 300분 초과) 휴식
     중앙값도 같이 버리는 안전장치로만 씁니다.

     평균이 아니라 중앙값을 쓰는 이유: 중간에 전화를 받거나 자리를 비우면
     간격 하나가 20분이 되는데, 평균은 그 하나에 통째로 끌려갑니다. 중앙값은
     그런 이상치에 흔들리지 않아 "보통 얼마나 쉬는가" 를 제대로 말해 줍니다. */
  function sessionTiming(s) {
    const stamps = [];
    for (const ex of s?.exercises || []) {
      for (const st of ex.sets || []) {
        if (st.done && Number.isFinite(st.doneAt)) stamps.push(st.doneAt);
      }
    }
    if (stamps.length < 2) return null;
    stamps.sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) {
      const g = (stamps[i] - stamps[i - 1]) / 1000;
      /* 8분이 넘는 간격은 '쉰 것' 이 아니라 '자리를 뜬 것' 으로 봅니다. */
      if (g > 3 && g <= 480) gaps.push(g);
    }
    const minutes = Math.round((stamps[stamps.length - 1] - stamps[0]) / 60000);
    if (minutes <= 0 || minutes > 300) return null;
    let rest = 0;
    if (gaps.length) {
      const sorted = gaps.slice().sort((a, b) => a - b);
      rest = Math.round(sorted[Math.floor(sorted.length / 2)]);
    }
    return { minutes, rest, sets: stamps.length };
  }

  function fmtDur(sec) {
    const m = Math.floor(sec / 60), ss = Math.round(sec % 60);
    return m ? `${m}분 ${ss}초` : `${ss}초`;
  }

  /* ── 부위별 볼륨 분석 ────────────────────────────────────────────────────
     세트 수만 세면 40kg 12세트와 100kg 12세트가 같은 운동이 됩니다. 그래서
     세트 수와 볼륨(무게 × 횟수)을 함께 봅니다.

     세트 수 기준은 근비대 메타분석에서 가져왔습니다 — 주당 근육군별로
     최소 4세트는 있어야 자극이 되고, 5~10세트 구간의 효율이 가장 좋으며,
     그보다 많아도 효과는 이어지되 시간 대비 수익이 줄어듭니다.

     다만 이 앱의 '부위' 는 근육 하나가 아니라 묶음입니다(팔 = 이두 + 삼두).
     그래서 기준을 그대로 들이대면 실제보다 많아 보입니다. 화면에서 이 점을
     밝히고, 숫자를 단정이 아니라 참고로 제시합니다. */
  const VOL_MIN = 4, VOL_GOOD_LO = 5, VOL_GOOD_HI = 10, VOL_HIGH = 20;
  const ANALYSIS_WEEKS = 4;

  /* 스트레칭은 이 분석에서 뺍니다. 위 기준은 근비대를 위한 '작업 세트' 수라서
     스트레칭에 갖다 대면 "주 4세트 미만이라 부족" 같은 틀린 말이 나옵니다.
     스트레칭은 볼륨을 쌓는 운동이 아닙니다. */
  function analysisParts() {
    return PARTS.filter(p => p.kind === 'weight' && p.id !== 'stretch');
  }

  /* 최근 n주 / 그 직전 n주의 부위별 세트·볼륨·최대중량 */
  /* 두 창은 반드시 같은 길이여야 합니다.
     예전에는 이번 창을 '3주 전 월요일부터 오늘까지' 로 잡아 놓고 4주로
     나눴습니다. 그러면 월요일에는 22일치를 4주로 나눠 실제보다 21% 낮게
     나오고, 직전 창은 꼬박 28일이라 그대로 나옵니다. 매주 목요일에만 운동
     하는 사람이 월·화·수에는 "주 3.8세트 · 부족", "볼륨 25% 감소" 를 보게
     되고 목요일이 되면 멀쩡해집니다 — 매주 반복됩니다.
     그래서 오늘부터 거꾸로 센 28일과, 그 앞의 28일로 잡습니다. */
  function partWindows(weeks = ANALYSIS_WEEKS) {
    const today = new Date(todayISO() + 'T00:00:00');
    const days = weeks * 7;
    const curFrom = new Date(today); curFrom.setDate(curFrom.getDate() - (days - 1));
    const prevFrom = new Date(curFrom); prevFrom.setDate(prevFrom.getDate() - days);
    const iso = isoLocal;
    const blank = () => ({ sets: 0, volume: 0, maxKg: 0, days: new Set() });
    const cur = {}, prev = {};
    for (const part of PARTS) { cur[part.id] = blank(); prev[part.id] = blank(); }

    const curTo = iso(today);
    for (const s of state.sessions) {
      const inCur = s.date >= iso(curFrom) && s.date <= curTo;
      const inPrev = s.date >= iso(prevFrom) && s.date < iso(curFrom);
      if (!inCur && !inPrev) continue;
      const bucket = inCur ? cur : prev;
      for (const ex of s.exercises || []) {
        const b = bucket[ex.part]; if (!b) continue;
        for (const st of ex.sets || []) {
          if (!st.done || st.warmup) continue;
          const kg = Number(st.kg), reps = Number(st.reps);
          b.sets++;
          b.days.add(s.date);
          if (Number.isFinite(kg) && Number.isFinite(reps)) b.volume += kg * reps;
          if (Number.isFinite(kg) && kg > b.maxKg) b.maxKg = kg;
        }
      }
    }
    const wrap = o => Object.fromEntries(Object.entries(o).map(([k, v]) =>
      [k, { sets: v.sets, volume: v.volume, maxKg: v.maxKg, days: v.days.size,
            setsPerWeek: v.sets / weeks, volPerWeek: v.volume / weeks }]));
    return { weeks, cur: wrap(cur), prev: wrap(prev) };
  }

  function volumeVerdict(setsPerWeek) {
    if (setsPerWeek <= 0) return { key: 'none', label: '안 함', cls: 'bad' };
    if (setsPerWeek < VOL_MIN) return { key: 'low', label: '부족', cls: 'bad' };
    /* 4~5 사이는 '자극은 되지만 권장 구간(5~10)에는 못 미치는' 자리입니다.
       예전에는 이 구간을 그냥 '적정' 이라 했는데, 바로 옆의 ⓘ 안내는
       "5~10세트 — 적정 / 4세트 미만 — 부족" 이라 4.5세트를 설명하지 못했습니다.
       화면과 기준이 다른 말을 하면 둘 다 못 믿게 됩니다. */
    if (setsPerWeek < VOL_GOOD_LO) return { key: 'ok', label: '조금 부족', cls: 'ok' };
    if (setsPerWeek <= VOL_GOOD_HI) return { key: 'good', label: '적정', cls: 'good' };
    if (setsPerWeek <= VOL_HIGH) return { key: 'plenty', label: '충분', cls: 'ok' };
    return { key: 'over', label: '많음', cls: 'ok' };
  }

  function pctChange(now, before) {
    if (!before) return now > 0 ? null : 0;   // 이전이 0이면 배수로 말할 수 없습니다
    return Math.round(((now - before) / before) * 100);
  }

  /* ── 변화 읽기 ───────────────────────────────────────────────────────────
     전부 세트 기준입니다. 예전에는 볼륨과 부위별 최고 중량까지 섞어 문장을
     만들었는데, 그 두 숫자는 이제 화면 어디에도 없습니다 — 근거가 보이지
     않는 "볼륨이 12% 늘었어요" 는 사용자가 확인할 방법이 없는 말입니다.

     부위 단위의 최고 중량은 애초에 읽을 값이 아니기도 합니다: '가슴 최고
     100kg' 이 벤치프레스인지 케이블 플라이인지에 따라 뜻이 완전히 달라지고,
     그건 "개인 기록" 카드가 운동별로 이미 정확히 보여 줍니다. */
  function readChange(now, before) {
    const dSets = pctChange(now.setsPerWeek, before.setsPerWeek);
    const up = v => v != null && v >= 8;
    const down = v => v != null && v <= -8;

    if (!before.sets && now.sets) return { tone: 'good', text: '새로 시작했어요' };
    if (before.sets && !now.sets)  return { tone: 'bad',  text: `${ANALYSIS_WEEKS}주째 안 했어요` };
    if (up(dSets))   return { tone: 'good', text: `세트가 ${dSets}% 늘었어요` };
    if (down(dSets)) return { tone: 'warn', text: `세트가 ${Math.abs(dSets)}% 줄었어요` };
    return { tone: 'flat', text: '지난 기간과 비슷해요' };
  }

  /* 운동별 정체: 계속 하고 있는데 최고 중량이 오래 그대로인 것 */
  function stalledExercises(minWeeks = 4) {
    const byName = new Map();
    for (const s of state.sessions) {
      for (const ex of s.exercises || []) {
        let best = 0;
        for (const st of ex.sets || []) {
          if (!st.done || st.warmup) continue;
          const kg = Number(st.kg);
          if (Number.isFinite(kg) && kg > best) best = kg;
        }
        if (!best) continue;
        const cur = byName.get(ex.name) || { name: ex.name, part: ex.part, days: [] };
        cur.days.push({ date: s.date, kg: best });
        byName.set(ex.name, cur);
      }
    }
    const today = new Date(todayISO() + 'T00:00:00');
    const out = [];
    for (const v of byName.values()) {
      v.days.sort((a, b) => a.date.localeCompare(b.date));
      /* 최근 3주 안에 한 적이 있어야 '정체' 입니다. 아예 안 하는 운동은
         정체가 아니라 그냥 안 하는 것이고, 그건 다른 이야기입니다. */
      const last = v.days[v.days.length - 1];
      const sinceLast = (today - new Date(last.date + 'T00:00:00')) / 86400000;
      if (sinceLast > 21 || v.days.length < 4) continue;
      const best = Math.max(...v.days.map(d => d.kg));
      /* 지금도 그 무게를 들고 있어야 '정체' 입니다. 예전에 50kg 을 들었다가
         요즘 35kg 으로 내려온 운동은 정체가 아니라 후퇴이고, 거기에 대고
         "무게를 올려 보세요" 라고 하면 틀린 조언이 됩니다. 무게가 내려간
         이야기는 위의 부위별 '변화' 줄이 이미 하고 있습니다. */
      if (last.kg < best * 0.95) continue;
      const firstBest = v.days.find(d => d.kg === best);
      const weeks = Math.floor((today - new Date(firstBest.date + 'T00:00:00')) / 604800000);
      if (weeks >= minWeeks) out.push({ ...v, kg: best, weeks, since: firstBest.date });
    }
    return out.sort((a, b) => b.weeks - a.weeks).slice(0, 4);
  }

  function sessionStats(s) {
    let done = 0, total = 0, volume = 0;
    for (const ex of s.exercises || []) {
      const p = exProgress(ex);
      done += p.done; total += p.total;
      volume += exVolume(ex);
    }
    return { done, total, volume };
  }
  /* Korean subject particle: 이 after a final consonant, 가 after a vowel.
     Needed because the phrase it follows is assembled at runtime — it can end
     in "기록" (consonant → 이) or "3개" (vowel → 가), and a hard-coded particle
     is wrong half the time. */
  function subjectParticle(word) {
    const ch = String(word || '').trim().slice(-1);
    if (!ch) return '이';
    const code = ch.charCodeAt(0);
    if (code < 0xAC00 || code > 0xD7A3) return '이';
    return (code - 0xAC00) % 28 === 0 ? '가' : '이';
  }

  /* ── Chart helpers ───────────────────────── */
  /* 이 운동의 '최근' 10회. 예전에는 날짜 오름차순으로 훑다가 10개에서 멈춰
     가장 오래된 10회를 그렸습니다 — 1년 동안 60kg → 100kg 을 올린 사람이
     작년 첫 열 번(60~68kg)을 보면서 'PR 68kg' 이라는 글자를 읽게 됩니다.
     그래프도 열 번째 기록 이후로 영원히 멈춰 있었습니다.
     완료한 세트만 셉니다 — 적어만 두고 하지 않은 200kg 이 최고 기록으로
     찍히면 안 됩니다(개인 기록 카드는 이미 완료한 세트만 봅니다). */
  function renderExerciseTrend(exName) {
    const all = [];
    const sorted = [...state.sessions].sort((a, b) => a.date < b.date ? -1 : 1);
    for (const s of sorted) {
      const ex = (s.exercises||[]).find(e => e.name === exName);
      if (!ex) continue;
      /* setScore 와 같은 기준을 씁니다 — 무게와 횟수가 둘 다 있는 완료 세트만.
         예전에는 횟수를 안 보고 무게만 봐서, 무게만 적고 횟수를 비워 둔 세트가
         이 그래프에서는 최고 기록으로 잡혔습니다. 그러면 같은 운동에 대해
         ⓘ 화면은 "PR 120kg", 히스토리의 개인 기록 카드는 "95kg" 이라고
         서로 다른 말을 합니다. */
      const working = (ex.sets||[]).filter(st => st.done && setScore(st));
      const maxKg = Math.max(...working.map(st=>Number(st.kg)||0), 0);
      if (maxKg > 0) all.push({ date: shortDate(s.date), kg: maxKg });
    }
    const history = all.slice(-10);
    if (history.length < 2) return '';
    /* 'PR' 은 전체 기록 기준입니다. 그래프에 보이는 10회 중 최고를 PR 이라고
       하면, 최고 기록이 11회 전이었을 때 실제보다 낮은 숫자가 PR 로 뜹니다. */
    const prAll = Math.max(...all.map(p => p.kg));
    const maxKg = Math.max(...history.map(p=>p.kg));
    const minKg = Math.min(...history.map(p=>p.kg));
    const range = maxKg - minKg || 1;
    const n = history.length;
    const coords = history.map((p, i) => ({
      x: (i/(n-1))*86+7, y: 36-((p.kg-minKg)/range)*28,
      kg: p.kg, date: p.date,
    }));
    const line = coords.map(c=>`${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const area = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)} `
      + coords.slice(1).map(c=>`L${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
      + ` L${coords[n-1].x.toFixed(1)},42 L${coords[0].x.toFixed(1)},42 Z`;
    const dots = coords.map((c,i) => {
      const last = i===n-1;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${last?4:2.5}"
        fill="${last?'var(--accent)':'var(--bg)'}" stroke="var(--accent)" stroke-width="1.5"/>
        ${last?`<text x="${c.x.toFixed(1)}" y="${(c.y-7).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="800" fill="var(--accent)">${toDisplayWeight(c.kg)}${weightUnitLabel()}</text>`:''}`;
    }).join('');
    return `<div class="trend-card">
      <div class="trend-header">
        <span class="trend-title">최고 무게 추이</span>
        <span class="trend-pr">PR <strong>${toDisplayWeight(prAll)}${weightUnitLabel()}</strong></span>
      </div>
      <svg viewBox="0 0 100 46" class="trend-svg" overflow="visible">
        <defs><linearGradient id="tgrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity=".22"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${area}" fill="url(#tgrad)"/>
        <polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        ${dots}
      </svg>
      <div class="trend-dates"><span>${history[0].date}</span><span>${history[n-1].date}</span></div>
    </div>`;
  }

  function shiftDate(iso, delta) {
    const d = isoToDate(iso);
    d.setDate(d.getDate() + delta);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function relDayLabel(iso) {
    const today = todayISO();
    if (iso === today) return '오늘';
    const diff = Math.round((isoToDate(today) - isoToDate(iso)) / 86400000);
    if (diff === 1) return '어제';
    if (diff === 2) return '그제';
    if (diff > 0)   return `${diff}일 전`;
    if (diff === -1) return '내일';
    return `${-diff}일 후`;
  }
  /* 설정의 주 시작 요일을 따릅니다. 라벨은 weekdayLabelsShort() 로 같이
     회전해서 쓰므로 인덱스가 항상 서로 맞습니다. */
  function getWeekDays() {
    const start = weekStartOf(new Date());
    return Array.from({length:7}, (_,i) => {
      const d = new Date(start); d.setDate(start.getDate()+i);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    });
  }

  /* ── Persist queue ──────────────────────── */
  let _pq = Promise.resolve();
  function persist() {
    _pq = _pq.then(doSave, doSave);
    return _pq;
  }
  /* Fire-and-forget. The local IndexedDB write has already succeeded by the time
     this runs, so a slow or unreachable Firestore must never block the UI. */
  function cloudSync(task) {
    if (!state.user) return Promise.resolve();
    withTimeout(Promise.resolve().then(task), 10000, '동기화')
      .catch((err) => console.warn('cloud sync failed', err));
    return Promise.resolve();
  }

  async function doSave() {
    const s = state.session;
    if (!s) return;
    /* Editing a past day is held until 저장 is pressed.

       Today's workout still saves on every keystroke — losing a set mid-session
       because the phone rang is far worse than any amount of ambiguity about
       when it saved. But a past record is being deliberately corrected, often
       tentatively, and there the expected behaviour is the opposite: nothing
       changes until you say so, and 취소 puts it back. */
    if (state.editingPast) { state.pastDirty = true; paintPastBar(); return; }
    if (!worthSaving(s)) {
      await WorkoutDB.deleteSession(s.date);
      state.sessions = state.sessions.filter(x => x.date !== s.date);
      await cloudSync(() => Cloud.deleteSession(s.date));
      return;
    }
    s.updatedAt = Date.now();
    /* 저장이 실패하면 반드시 말해 줍니다.
       예전에는 실패가 조용히 지나갔습니다. 저장 공간이 꽉 찬 폰에서는 그때
       부터 기록한 세트가 전부 화면에만 존재하는데, 화면 아래 안내는 여전히
       "입력하는 즉시 저장되니 도중에 나가도 사라지지 않아요" 라고 말합니다.
       사용자는 90분을 채우고 앱을 닫은 뒤에야 알게 됩니다. */
    try {
      await WorkoutDB.putSession(clone(s));
      state.saveBroken = false;
    } catch (err) {
      console.warn('save failed', err);
      /* 매번 띄우면 세트를 누를 때마다 토스트가 뜹니다 — 한 번만 알립니다. */
      if (!state.saveBroken) {
        state.saveBroken = true;
        toast('저장에 실패했습니다 — 기기 저장 공간을 확인해 주세요');
      }
      throw err;
    }
    const idx = state.sessions.findIndex(x => x.date === s.date);
    const copy = clone(s);
    if (idx >= 0) state.sessions[idx] = copy; else state.sessions.push(copy);
    state.sessions.sort((a,b) => b.date.localeCompare(a.date));
    await cloudSync(() => Cloud.saveSession(copy));
  }

  /* ── Confirm dialog ───────────────────────────────────────────────────────
     Replaces window.confirm everywhere.

     The browser's own dialog announces the domain, styles itself in the OS's
     colours, and on iOS Chrome adds a third "대화상자 숨기기" button that has
     nothing to do with the question being asked — so the most serious moments
     in the app (로그아웃, 기록 삭제, 계정 삭제) were the ones that looked least
     like the app. This one is ordinary DOM: it can mark which action is
     destructive, and it reads as part of the same product.

     Appended to <body> rather than into the render tree so it survives a
     re-render mid-question, exactly like the toast and the rest timer. */
  function ask(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-backdrop';
      wrap.innerHTML = `
        <div class="dialog" role="alertdialog" aria-modal="true">
          <div class="dialog-title">${esc(o.title || '확인')}</div>
          ${o.body ? `<div class="dialog-body${o.body.includes('\n') ? ' pre' : ''}">${esc(o.body)}</div>` : ''}
          <div class="dialog-actions">
            ${o.cancelText === '' ? '' : `<button class="dialog-btn cancel" data-v="0">${esc(o.cancelText || '취소')}</button>`}
            <button class="dialog-btn ${o.danger ? 'danger' : 'go'}" data-v="1">${esc(o.confirmText || '확인')}</button>
          </div>
        </div>`;

      let settled = false;
      const close = (val) => {
        if (settled) return;
        settled = true;
        wrap.classList.add('is-closing');
        setTimeout(() => wrap.remove(), 140);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onKey = (e) => { if (e.key === 'Escape') close(false); };

      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-v]');
        if (btn) { close(btn.dataset.v === '1'); return; }
        /* Tapping the dimmed area cancels — never confirms. */
        if (e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(wrap);
      requestAnimationFrame(() => {
        const first = wrap.querySelector('.dialog-btn.cancel') || wrap.querySelector('.dialog-btn');
        if (first) first.focus();
      });
    });
  }

  /* ask 와 같은 모양이되 한 줄을 받아 오는 대화상자. 브라우저 기본
     window.prompt 은 ask 를 걷어낸 이유와 똑같은 문제를 갖고 있어 쓰지
     않습니다. */
  function promptText(opts) {
    const o = opts || {};
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'dialog-backdrop';
      wrap.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <div class="dialog-title">${esc(o.title || '입력')}</div>
          ${o.message ? `<div class="dialog-body">${esc(o.message)}</div>` : ''}
          <input class="dialog-input" type="text" maxlength="40"
                 value="${esc(o.value || '')}" placeholder="${esc(o.placeholder || '')}">
          <div class="dialog-actions">
            <button class="dialog-btn cancel" data-v="0">취소</button>
            <button class="dialog-btn go" data-v="1">${esc(o.confirmText || '저장')}</button>
          </div>
        </div>`;
      const input = wrap.querySelector('.dialog-input');
      let settled = false;
      const close = (val) => {
        if (settled) return;
        settled = true;
        wrap.classList.add('is-closing');
        setTimeout(() => wrap.remove(), 140);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const submit = () => close(input.value.trim() || null);
      const onKey = (e) => {
        if (e.key === 'Escape') close(null);
        if (e.key === 'Enter' && document.activeElement === input) submit();
      };
      wrap.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-v]');
        if (btn) { btn.dataset.v === '1' ? submit() : close(null); return; }
        if (e.target === wrap) close(null);
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(wrap);
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  /* 판정에 쓴 기준은 반드시 밝힙니다. '부족' 이라는 말은 근거가 없으면
     그냥 앱이 훈수 두는 것이 됩니다. */
  async function showVolumeInfo() {
    await ask({
      title: '부위별 분석 기준',
      body: [
        `최근 ${ANALYSIS_WEEKS}주를 평균 내어 주당 세트 수로 봅니다.`,
        '',
        `· ${VOL_MIN}세트 미만 — 부족`,
        `· ${VOL_MIN}~${VOL_GOOD_LO}세트 — 조금 부족`,
        `· ${VOL_GOOD_LO}~${VOL_GOOD_HI}세트 — 적정`,
        `· ~${VOL_HIGH}세트 — 충분`,
        `· ${VOL_HIGH}세트 초과 — 많음`,
        '',
        '근비대 연구를 모은 메타분석에서 가져온 구간입니다. 최소 4세트는',
        '있어야 자극이 되고, 5~10세트 구간이 시간 대비 효율이 가장 좋으며,',
        '그보다 많아도 효과는 이어지되 수익이 줄어듭니다.',
        '',
        '주의: 이 앱의 부위는 근육 하나가 아니라 묶음입니다. "팔" 에는',
        '이두와 삼두가 함께 들어가므로, 실제 근육별 세트 수는 여기 숫자보다',
        '적습니다. 단정이 아니라 참고로 보세요.',
        '',
        '이 카드는 세트 수만 봅니다. 40kg 12세트와 100kg 12세트가 같게',
        '읽힌다는 뜻이니, 무게가 어떻게 늘었는지는 "개인 기록" 에서 운동별로',
        '확인하세요.',
      ].join('\n'),
      confirmText: '알겠어요', cancelText: '',
    });
  }

  /* ── Toast ──────────────────────────────── */
  function toast(msg) {
    state.toast = msg;
    clearTimeout(state.toastTimer);
    const el = document.querySelector('.toast');
    if (el) el.textContent = msg;
    else {
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = msg;
      document.body.appendChild(t);
    }
    state.toastTimer = setTimeout(() => {
      document.querySelector('.toast')?.remove();
      state.toast = '';
    }, 1800);
  }

  /* ── Number pad buffer ────────────────────────────────────────────────────
     `str` is the single source of truth for what the pad shows: what you see is
     exactly what you have typed. The old version fell back to the set's stored
     `value` whenever `str` was empty, which produced two bugs that fed each
     other — backspacing down to nothing made the previous number reappear (so
     ⌫ looked broken), and clearing left a "0" on screen that was really the
     old value showing through, so the next keypress read as 0 → 5 → 0 = "050".

     `fresh` marks a pad that has been opened but not typed into yet. It shows
     the existing number so you can see what you are changing, then the first
     digit replaces it wholesale — the way a calculator or a stopwatch entry
     field behaves. Backspace and clear drop `fresh`, so from that point on
     digits append normally. */
  function newPicker(exId, setId, value) {
    const num = Number(value);
    const has = value !== null && value !== undefined && value !== '' && !Number.isNaN(num) && num !== 0;
    return { exId, setId, str: has ? String(num) : '', fresh: true };
  }

  function pickerDigit(p, digit, maxLen) {
    if (p.fresh) { p.str = ''; p.fresh = false; }
    /* No leading zeros: "0" then "5" is 5, not 05. "0." is untouched so 0.5
       stays reachable. */
    if (p.str === '0') p.str = '';
    if (p.str.length >= maxLen) return;
    p.str += digit;
  }

  function pickerDot(p) {
    if (p.fresh) { p.str = ''; p.fresh = false; }
    if (p.str.includes('.') || p.str.length >= 5) return;
    p.str = (p.str === '' ? '0' : p.str) + '.';
  }

  function pickerBack(p) {
    p.fresh = false;
    p.str = p.str.slice(0, -1);
  }

  function pickerClear(p) {
    p.fresh = false;
    p.str = '';
  }

  /* Empty buffer reads as 0 on confirm — an intentional "no weight" for
     bodyweight work, not a rejected entry. */
  function pickerValue(p) {
    if (!p.str) return 0;
    const n = parseFloat(p.str);
    return Number.isFinite(n) ? n : 0;
  }

  function pickerDisplay(p) {
    return p.str === '' ? '0' : p.str;
  }

  /* Nudges the current value without retyping it. Most set-to-set changes are
     one plate or a couple of reps, which is a whole number's worth of typing
     for a value the pad already knows. */
  function pickerAdjust(p, delta, min, max) {
    const next = Math.round((pickerValue(p) + delta) * 100) / 100;
    const clamped = Math.min(max, Math.max(min, next));
    p.fresh = false;
    p.str = clamped ? String(clamped) : '';
  }

  const WEIGHT_STEPS = [-5, -2.5, 2.5, 5];
  /* lb 에서는 반 플레이트/반 원판 단위인 kg 스텝이 어색해서(2.5kg ≈
     5.5lb), 흔히 쓰는 5·10lb 단위로 바꿔 보여줍니다. */
  function weightStepValues() { return unitWeight() === 'lb' ? [-10, -5, 5, 10] : WEIGHT_STEPS; }
  const REPS_STEPS = [-5, -1, 1, 5];
  /* Held stretches move in useful chunks of seconds, not single ticks. */
  const HOLD_STEPS = [-30, -10, 10, 30];
  function adjRow(act, steps) {
    return `<div class="picker-adj-row">${steps.map(v => {
      const cls = v < 0 ? 'adj-btn minus' : 'adj-btn plus';
      const label = (v > 0 ? '+' : '−') + String(Math.abs(v));
      return `<button class="${cls}" data-act="${act}" data-delta="${v}">${label}</button>`;
    }).join('')}</div>`;
  }

  /* +/- 버튼으로 값을 조정할 때만 숫자가 세는 듯 지나가며 바뀝니다. 자판을
     직접 두드릴 때는(digit/dot/back) 누른 그대로 바로 보여야지, 한 자
     칠 때마다 이전 값에서 세어 올라가면 오히려 산만합니다 — 그래서 animate
     인자는 조정 버튼 쪽에서만 true 로 넘깁니다. */
  function animateNumberText(el, toStr) {
    const from = parseFloat(el.textContent);
    const to = parseFloat(toStr);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) { el.textContent = toStr; return; }
    const decimals = (toStr.split('.')[1] || '').length;
    const dur = 180;
    const t0 = performance.now();
    const runId = (el._tweenRun = (el._tweenRun || 0) + 1);
    function step(now) {
      if (el._tweenRun !== runId) return; /* 그새 다른 값으로 또 바뀌었으면 중단 */
      const t = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        el.textContent = (from + (to - from) * eased).toFixed(decimals);
        requestAnimationFrame(step);
      } else {
        el.textContent = toStr;
      }
    }
    requestAnimationFrame(step);
  }

  /* Repaint ONLY the big number inside an open picker sheet.
     Going through render() would swap appEl.innerHTML, destroying and
     rebuilding the sheet — which replays its slide-up animation and makes the
     whole panel appear to blink on every single keypress. */
  function paintPickerValue(animate) {
    const p = state.weightPicker || state.repsPicker;
    if (!p) return;
    const el = document.querySelector('.picker-big-num');
    if (!el) { render(); return; }
    const next = pickerDisplay(p);
    if (animate) animateNumberText(el, next);
    else { el._tweenRun = (el._tweenRun || 0) + 1; el.textContent = next; }
    /* Dim the placeholder zero so an empty pad never looks like a typed 0. */
    el.classList.toggle('is-empty', p.str === '');
    el.classList.toggle('is-fresh', !!p.fresh);
  }

  const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  function paintPickRow(row, on) {
    if (!row) return;
    row.classList.toggle('on', on);
    const check = row.querySelector('.pick-check');
    if (check) { check.classList.toggle('on', on); check.innerHTML = on ? CHECK_SVG : ''; }
  }

  function paintPickFooter() {
    const btn = document.querySelector('[data-act="commit-picks"]');
    if (!btn) return;
    const n = state.pickSelection.length;
    btn.disabled = !n;
    btn.classList.toggle('ghost', !n);
    btn.textContent = n ? `${n}개 운동 추가` : '운동을 선택해 주세요';
  }

  /* ── Rest Timer ─────────────────────────── */
  /* Renders into its own node on <body>, ticked by a single setInterval — never
     through render()'s innerHTML swap, so a live countdown can never steal focus
     from a numpad, an open sheet, or an input the user is mid-edit on. */
  let _restTickHandle = null;

  function playRestChime() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beep = (freq, start, dur) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
      };
      beep(880, 0, 0.16);
      beep(1175, 0.18, 0.24);
      setTimeout(() => ctx.close().catch(() => {}), 900);
    } catch (_) {}
  }

  /* ── 앱 밖에서도 남는 휴식 타이머 ────────────────────────────────────────
     웹앱은 다른 앱 위에 떠 있는 창(안드로이드의 오버레이)을 만들 수 없습니다.
     그건 네이티브 앱만 가진 권한입니다. 대신 웹앱이 할 수 있는 두 가지로
     같은 목적을 채웁니다.

     1) 타이머를 종료 '시각'으로 저장해 둡니다. 앱을 완전히 껐다 켜도 남은
        시간이 그대로 이어집니다 — 화면이 꺼져 있던 동안 시간이 멈추지
        않으니까요.
     2) 휴식을 시작할 때 알림을 하나 띄우고 거기에 끝나는 시각을 적습니다.
        알림창을 내리면 "11:32 종료" 가 보입니다. 남은 시간을 1초씩 세는
        알림은 만들 수 없지만(브라우저가 알림을 대신 갱신해 주지 않습니다),
        끝나는 시각은 앱이 죽어도 계속 맞습니다.

     알림은 페이지가 아니라 서비스워커로 띄웁니다. 페이지에서 띄운 알림은
     탭이 사라지면 같이 사라지지만, 서비스워커 알림은 남습니다. */
  const REST_KEY = 'fitlog-rest';

  function saveRestTimer() {
    try {
      if (state.restTimer) localStorage.setItem(REST_KEY, JSON.stringify({
        endsAt: state.restTimer.endsAt, duration: state.restTimer.duration, label: state.restTimer.label,
      }));
      else localStorage.removeItem(REST_KEY);
    } catch (_) {}
  }

  function restoreRestTimer() {
    if (!restTimerOn()) return;
    let saved = null;
    /* 네이티브 껍데기 안에서는 네이티브가 들고 있는 타이머가 진실입니다.
       앱이 완전히 죽어 있는 동안에도 계속 돌던 쪽이 그쪽이고, localStorage 는
       마지막으로 화면이 살아 있던 순간에 멈춰 있습니다. 네이티브가 없거나
       네이티브에도 남은 게 없으면 지금까지처럼 localStorage 를 봅니다. */
    if (window.FitLogNative && window.FitLogNative.ok) {
      try { saved = window.FitLogNative.pending(); } catch (_) {}
    }
    if (!saved) { try { saved = JSON.parse(localStorage.getItem(REST_KEY) || 'null'); } catch (_) {} }
    if (!saved || !saved.endsAt) return;
    /* 이미 끝난 타이머는 되살리지 않습니다 — 어제 남은 알림이 오늘 뜨면
       그게 더 이상합니다. */
    if (saved.endsAt <= Date.now()) { try { localStorage.removeItem(REST_KEY); } catch (_) {} return; }
    state.restTimer = { ...saved, chimed: false };
    renderRestTimerBar();
  }

  function endClock(ts) {
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  async function showRestNotification(title, body, silent) {
    /* 네이티브 껍데기 안에서는 알림을 네이티브가 띄웁니다. 여기서 또 띄우면
       같은 휴식에 대해 알림이 두 줄 쌓이고, 웹 쪽 알림은 앱이 화면 밖으로
       나가면 어차피 정확한 시각에 울리지도 못합니다. */
    if (window.FitLogNative && window.FitLogNative.ownsNotifications) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = {
      body, tag: 'fitlog-rest', renotify: !silent, silent: !!silent,
      icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) { await reg.showNotification(title, opts); return; }
    } catch (_) {}
    try { new Notification(title, opts); } catch (_) {}
  }

  async function clearRestNotification() {
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.ready;
      if (!reg || !reg.getNotifications) return;
      (await reg.getNotifications({ tag: 'fitlog-rest' })).forEach(n => n.close());
    } catch (_) {}
  }

  function startRestTimer(seconds, label, setId) {
    /* Checked here rather than at each call site so nothing can start the timer
       behind the setting's back. */
    if (!restTimerOn()) return;
    /* setId 를 함께 둡니다 — 어느 세트가 시작한 휴식인지 알아야, 다른 세트의
       체크를 푸는 것만으로 돌아가던 휴식이 사라지지 않습니다. */
    state.restTimer = { endsAt: Date.now() + seconds * 1000, duration: seconds, label: label || '', setId: setId || '', chimed: false };
    saveRestTimer();
    renderRestTimerBar();
    /* 네이티브가 있으면 여기서 손을 뗍니다. 끝나는 시각을 넘겨 주면 그 뒤는
       OS 가 책임집니다 — 앱을 완전히 닫아도, 화면이 꺼져 있어도 정확히 그
       시각에 울립니다. 아래 웹 알림 경로는 네이티브가 없을 때만 씁니다. */
    if (window.FitLogNative && window.FitLogNative.ok) {
      window.FitLogNative.startRest(state.restTimer);
      return;
    }
    /* Ask once, lazily, only when the feature is actually used — so a background
       notification can fire if the user switches tabs/apps while resting. Never
       re-prompt if they dismissed or denied it. */
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(() => pushRestNotification());
      } else pushRestNotification();
    } catch (_) {}
  }

  /* 남은 시간과 끝나는 시각을 알림에 적습니다. 앱이 살아 있는 동안에는
     주기적으로 다시 적어 남은 시간이 갱신되고, 앱이 죽으면 마지막에 적힌
     "끝나는 시각" 이 그대로 남습니다. */
  function pushRestNotification() {
    const rt = state.restTimer;
    if (!rt) return;
    const left = Math.max(0, Math.round((rt.endsAt - Date.now()) / 1000));
    if (left <= 0) return;
    const mm = Math.floor(left / 60), ss = left % 60;
    const body = `${mm}:${String(ss).padStart(2,'0')} 남음 · ${endClock(rt.endsAt)} 종료`
               + (rt.label ? ` · ${rt.label}` : '');
    showRestNotification('휴식 중', body, true);
  }

  function adjustRestTimer(deltaSec) {
    const rt = state.restTimer;
    if (!rt) return;
    /* 이미 끝난 타이머에 +15 를 누르면 '지금부터 15초' 여야 합니다.
       예전에는 지나간 endsAt 에 그냥 더해서, 2분 전에 끝난 휴식에 15초를
       더해 봐야 여전히 과거였습니다 — 화면은 "완료!" 그대로고 버튼이 죽은
       것처럼 보였습니다. */
    const base = Math.max(rt.endsAt, Date.now());
    rt.endsAt = base + deltaSec * 1000;
    rt.duration = Math.max(5, rt.duration + deltaSec);
    if (rt.endsAt > Date.now()) rt.chimed = false;   // 다시 재는 중이면 종료 알림도 다시
    saveRestTimer();
    renderRestTimerBar();
    /* ±15 는 끝나는 시각을 옮기는 일입니다. 네이티브에 예약해 둔 알림도 같이
       옮겨 주지 않으면, 화면은 1:45 인데 알림은 1:30 에 울립니다. */
    if (window.FitLogNative && window.FitLogNative.ok) window.FitLogNative.updateRest(rt);
    pushRestNotification();
  }

  function cancelRestTimer() {
    state.restTimer = null;
    saveRestTimer();
    if (window.FitLogNative && window.FitLogNative.ok) window.FitLogNative.stopRest();
    clearRestNotification();
    document.querySelector('.rest-timer-bar')?.remove();
    document.body.classList.remove('has-rest-timer');
  }

  function renderRestTimerBar() {
    const rt = state.restTimer;
    let el = document.querySelector('.rest-timer-bar');
    if (!rt) { el?.remove(); document.body.classList.remove('has-rest-timer'); return; }

    const remaining = Math.max(0, Math.round((rt.endsAt - Date.now()) / 1000));
    if (remaining <= 0 && !rt.chimed) {
      rt.chimed = true;
      try { localStorage.removeItem(REST_KEY); } catch (_) {}
      playRestChime();
      vibrate([120, 80, 120]);
      /* 끝났을 때는 화면을 보고 있든 아니든 알립니다 — 다른 앱을 보다가
         돌아오는 게 이 기능의 목적이라, 화면이 켜져 있다고 조용할 이유가
         없습니다. */
      showRestNotification('휴식 종료', (rt.label ? rt.label + ' · ' : '') + '다음 세트를 시작하세요 💪', false);
    }

    const pct = Math.max(0, Math.min(100, (remaining / rt.duration) * 100));
    const R = 16, C = 2 * Math.PI * R;
    const offset = (C * (1 - pct / 100)).toFixed(1);
    const mm = Math.floor(remaining / 60), ss = remaining % 60;
    const timeStr = `${mm}:${String(ss).padStart(2, '0')}`;

    const html = `
      <svg class="rest-ring" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="${R}" class="rest-ring-bg"/>
        <circle cx="18" cy="18" r="${R}" class="rest-ring-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset}"/>
      </svg>
      <div class="rest-timer-mid">
        <div class="rest-timer-time${remaining <= 0 ? ' zero' : ''}">${remaining <= 0 ? '완료!' : timeStr}</div>
        ${rt.label ? `<div class="rest-timer-label">${esc(rt.label)}</div>` : ''}
      </div>
      <button class="rest-timer-adj" data-rest-act="minus15" aria-label="15초 빼기">−15</button>
      <button class="rest-timer-adj" data-rest-act="plus15" aria-label="15초 더하기">+15</button>
      <button class="rest-timer-close" data-rest-act="cancel" aria-label="타이머 닫기">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;

    if (!el) {
      el = document.createElement('div');
      el.className = 'rest-timer-bar';
      el.addEventListener('click', onRestTimerClick);
      document.body.appendChild(el);
      document.body.classList.add('has-rest-timer');
    }
    /* 초당 네 번 도는 타이머가 매번 innerHTML 을 새로 쓰면, 표시가 바뀌지
       않는 동안에도 SVG 링까지 통째로 다시 만들고 버튼의 눌림 상태가 계속
       날아갑니다. 끝난 뒤에는 화면이 더 바뀔 것도 없으므로 한 번만 그립니다. */
    const stamp = `${remaining}|${rt.label}`;
    if (el.dataset.stamp === stamp) return;
    el.dataset.stamp = stamp;
    el.innerHTML = html;
  }

  function onRestTimerClick(e) {
    const btn = e.target.closest('[data-rest-act]');
    if (!btn) return;
    const act = btn.dataset.restAct;
    if (act === 'cancel') cancelRestTimer();
    else if (act === 'plus15') adjustRestTimer(15);
    else if (act === 'minus15') adjustRestTimer(-15);
  }

  function startRestTicker() {
    if (_restTickHandle) return;
    _restTickHandle = setInterval(() => { if (state.restTimer) renderRestTimerBar(); }, 250);
    /* 알림 본문은 15초에 한 번만 다시 씁니다. 매초 갱신하면 알림이 계속
       새로 뜬 것처럼 굴어 시끄럽습니다. */
    setInterval(() => { if (state.restTimer && !state.restTimer.chimed) pushRestNotification(); }, 15000);
    /* 화면이 꺼져 있던 동안에도 시간은 흘렀으므로, 돌아오는 순간 다시 계산해
       바를 맞춥니다. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.restTimer) renderRestTimerBar();
    });
    /* 네이티브에서 오는 두 가지 소식을 받습니다. 끝났다는 소식은 없어도
       250ms 뒤 틱이 알아서 알아채지만, 알림을 눌러 앱이 막 깨어난 순간에는
       이걸 받아야 화면이 곧바로 맞습니다. 껐다는 소식은 반드시 필요합니다 —
       네이티브 알림에서 끈 휴식이 웹 화면에만 계속 남아 있으면 안 됩니다. */
    if (window.FitLogNative && window.FitLogNative.ok) {
      window.FitLogNative.onFinish(() => { if (state.restTimer) renderRestTimerBar(); });
      window.FitLogNative.onCancel(() => {
        /* 이미 네이티브가 스스로 끈 상태라 stopRest 를 되쏘지 않습니다. */
        state.restTimer = null;
        saveRestTimer();
        document.querySelector('.rest-timer-bar')?.remove();
        document.body.classList.remove('has-rest-timer');
      });
    }
  }

  /* ── Navigation ─────────────────────────── */
  const TAB_ORDER = ['home', 'workout', 'history', 'settings'];
  async function goTab(tab) {
    /* Leaving the screen is the one moment a held past-day edit would be lost
       silently, so it is the one place that has to ask. */
    if (!await confirmLeavePast()) return;
    /* 하단 탭의 왼쪽→오른쪽 순서를 그대로 방향으로 씁니다. 오른쪽 탭으로
       가면 새 화면이 오른쪽에서, 왼쪽 탭으로 가면 왼쪽에서 들어옵니다 —
       탭 순서와 반대로 미끄러지면 오히려 어디로 이동했는지 헷갈립니다. */
    navDir = tab === state.tab ? null
      : (TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(state.tab) ? 'fwd' : 'back');
    state.tab = tab;
    /* The tab bar is visible over the day-summary overlay now, so tapping a tab
       has to dismiss it — otherwise the tab switches behind a screen that is
       still covering it. */
    state.summaryDate = null;
    /* 검색·운동 이력도 같은 이유로 닫습니다. 하단 탭은 전체 화면 밑으로
       계속 보이고 눌리므로, 안 닫으면 탭만 바뀌고 위 화면은 그대로 남습니다. */
    state.searchOpen = false;
    state.exHistoryName = null;
    state.logSearch = '';
    /* 루틴 만들기 화면도 함께 닫습니다. 이 화면은 시트가 아니라 전체 화면
       (position:fixed) 이라 closeAllSheets 가 건드리지 않았고, 그래서 하단
       탭을 눌러도 밑에서 화면만 바뀌고 위는 그대로였습니다 — 사용자에게는
       탭이 그냥 안 눌리는 것으로 보입니다. */
    state.routineEdit = null;
    closeAllSheets();
    if (tab === 'workout' && !state.session) {
      state.session = normalizeSession(await WorkoutDB.getSession(state.date) || emptySession(state.date));
    }
    render();
  }
  function closeAllSheets() {
    state.pickerPart = null;
    state.pickSelection = [];
    state.customName = '';
    state.routineSheet = false;
    state.partSheet = false;
    /* 확정하지 않고 시트를 닫으면 고르던 것은 버립니다 — 운동 피커의
       pickSelection 과 같습니다. */
    state.partSelection = null;
    /* routineEdit 는 시트가 아니라 화면이므로 여기서 닫지 않습니다 —
       운동을 고르고 나면 만들던 자리로 돌아와야 합니다. */
    state.exerciseInfoId = null;
    state.weightPicker = null;
    state.repsPicker = null;
    state.yearPicker = null;
    state.profileEditing = false;
    state.exerciseSearch = '';
  }

  async function loadDay(date, opts = {}) {
    state.date = date;
    const saved = await WorkoutDB.getSession(date);
    state.session = normalizeSession(saved || emptySession(date));
    closeAllSheets();
    /* 전체 화면으로 뜨는 것들도 같이 닫습니다.
       loadDay 는 goTab 을 거치지 않고 state.tab 을 직접 바꿉니다. 그래서
       goTab 에서만 닫으면, 검색 → 운동 이력 → 날짜 → '이 날 기록 편집하기'
       로 들어왔을 때 편집 화면이 열리긴 하는데 그 위를 이력 화면이 그대로
       덮고 있습니다. 사용자에게는 편집 버튼이 안 먹은 것처럼 보이고, 뒤로
       두 번을 눌러야 비로소 편집 화면이 나옵니다. */
    state.searchOpen = false;
    state.exHistoryName = null;
    state.logSearch = '';
    state.summaryDate = null;
    /* 히스토리 달력에서 펼쳐 둔 날짜도 접습니다 — 다른 날을 편집하러 들어온
       뒤에 히스토리로 돌아가면 엉뚱한 날이 펼쳐진 채로 있습니다. */
    state.histDay = null;
    state.tab = 'workout';

    /* A past day is edited against a snapshot, so 취소 has something to put
       back. Today is left on autosave. */
    const past = date !== todayISO();
    state.editingPast = past;
    state.pastDirty = false;
    state.pastBaseline = past ? JSON.stringify(state.session) : null;

    render();
  }

  /* Reveals or hides the 저장/취소 bar without a re-render, so it can be called
     from input handlers that must not disturb the keyboard. */
  function paintPastBar() {
    const bar = document.querySelector('.pastsave-bar');
    if (bar) bar.classList.toggle('is-clean', !state.pastDirty);
  }

  /* True when a past-day edit has changes that have not been saved. */
  function hasUnsavedPast() {
    return !!(state.editingPast && state.pastDirty);
  }

  /* Asks before throwing away a past-day edit. Resolves false to stay put. */
  async function confirmLeavePast() {
    if (!hasUnsavedPast()) return true;
    if (await ask({ title: '저장하지 않고 나갈까요?',
                    body: '이 날 기록에 저장하지 않은 변경이 있습니다. 나가면 변경한 내용은 사라집니다.',
                    confirmText: '나가기', cancelText: '계속 편집', danger: true })) {
      discardPastEdit();
      return true;
    }
    return false;
  }

  /* Puts the record back to how it was saved but STAYS in edit mode — the user
     is still looking at a past day, so whatever they do next has to keep being
     held rather than quietly starting to autosave again. */
  function revertPastEdit() {
    if (state.pastBaseline && state.session) {
      try { state.session = normalizeSession(JSON.parse(state.pastBaseline)); } catch (_) {}
    }
    state.pastDirty = false;
  }

  /* Reverts and leaves edit mode. Used when navigating away from the day.

     날짜도 오늘로 되돌립니다. 예전에는 editingPast 만 끄고 state.session 과
     state.date 는 그 과거 날짜에 그대로 두었습니다. goTab 은 세션이 있으면
     다시 읽지 않으므로, 홈으로 나갔다가 기록 탭으로 돌아오면 같은 과거 날짜가
     그대로 떠 있는데 저장/취소 바만 사라진 상태가 됩니다. 그때부터는

       · 고치는 족족 디스크와 클라우드에 바로 써지고(되돌릴 수 없습니다)
       · 세트를 체크하면 12일 전 세트에 '오늘' 시각이 찍혀 그날의 운동 시간·
         휴식 계산이 영구히 망가지고, 휴식 타이머까지 올라오고
       · 부위 칩을 끄면 그 날 기록이 통째로 삭제될 수도 있습니다.

     화면은 편집 중일 때와 바 하나 차이라 사용자가 알아차릴 방법이 없습니다.
     그래서 '떠난다' 는 말 그대로 그 날에서 나옵니다. */
  function discardPastEdit() {
    revertPastEdit();
    state.editingPast = false;
    state.pastBaseline = null;
    state.date = todayISO();
    state.session = null;      // 다음에 기록 탭을 열 때 오늘 것으로 다시 읽습니다
  }

  async function savePastEdit() {
    if (!state.editingPast || !state.session) return;
    /* Drop the hold, then run the normal save path so the record goes through
       exactly the same write and cloud sync as any other. */
    state.editingPast = false;
    await persist();
    state.sessions = await WorkoutDB.getAllSessions();
    state.pastDirty = false;
    state.pastBaseline = JSON.stringify(state.session);
    state.editingPast = true;      // stay in edit mode, now clean
    render();
    toast('기록을 저장했습니다');
  }

  /* ── 부위 아이콘 ────────────────────────── */
  /* ── Part icons ───────────────────────────── */
  const PART_ICONS = {
    chest: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5c2.6-1.7 5.4-1.1 7.5.6M21 7.5c-2.6-1.7-5.4-1.1-7.5.6"/><path d="M3 7.5v3.5c0 3 2.4 5 5.5 5 2.2 0 3.5-1.3 3.5-3.4M21 7.5v3.5c0 3-2.4 5-5.5 5-2.2 0-3.5-1.3-3.5-3.4"/></svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M12 6.5C10 4.2 6.6 4.2 4.5 6.3c1 3.4 3.3 4.7 5.5 4.7M12 6.5c2-2.3 5.4-2.3 7.5-.2-1 3.4-3.3 4.7-5.5 4.7"/></svg>`,
    shoulders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="10" r="3.2"/><circle cx="18" cy="10" r="3.2"/><path d="M9 11.5h6"/></svg>`,
    arms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8.5" width="3" height="7" rx="1.2"/><rect x="18.5" y="8.5" width="3" height="7" rx="1.2"/><path d="M5.5 12h2M16.5 12h2M8 12h8"/></svg>`,
    legs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6l-1.5 12M15 3v6l1.5 12M9 9h6"/></svg>`,
    core: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="4" width="10" height="16" rx="3.5"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="7.5" y1="10" x2="16.5" y2="10"/><line x1="7.5" y1="14" x2="16.5" y2="14"/></svg>`,
    run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="5" r="2"/><path d="M13 8l-3 3 2 2 1 5M12 13l-2 2-5-1M15 10l2-1 3 2 1-1"/></svg>`,
    /* A figure folded forward over a straight leg — the shape of a held
       stretch, drawn to sit next to the other part icons rather than an
       emoji that would break the set. */
    stretch: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="5.5" r="2"/><path d="M7 8v4.5"/><path d="M7 12.5h9"/><path d="M7 12.5l-2.5 6"/><path d="M8.5 9.5L15 12"/></svg>`,
  };


  /* ── Render Root ──────────────────────────── */

  /* ── 열릴 때만 움직이기 ───────────────────────────────────────────────────
     render() 는 #app 을 innerHTML 로 통째로 갈아 끼웁니다. 그래서 시트가 떠
     있는 동안 부위를 하나 고르거나 세트를 하나 체크하면, 그 시트의 DOM 도
     새로 만들어지고 CSS 진입 애니메이션(fadeIn, sheetUp, detail-in)이 처음
     부터 다시 재생됩니다 — 화면에는 시트가 아래로 쑥 내려갔다 다시 올라오는
     것으로 보입니다. 부위를 고를 때마다, 운동을 고를 때마다 그랬습니다.

     그래서 애니메이션 클래스를 '이번 렌더에서 처음 열린' 것에만 붙입니다.
     지난 렌더에 무엇이 열려 있었는지를 들고 있다가 대조합니다. 키에 대상까지
     넣는 이유는(info:벤치프레스), 시트는 그대로인데 안의 내용만 바뀐 경우와
     정말 다른 시트가 열린 경우를 구분해야 하기 때문입니다.

     세트 추가(.set-row.enter)가 이미 같은 방식으로 한 번만 재생됩니다. */
  let _openOverlays = new Set();
  let _renderOverlays = null;
  function overlayIn(key) {
    if (!_renderOverlays) _renderOverlays = new Set();
    _renderOverlays.add(key);
    return _openOverlays.has(key) ? '' : ' anim-in';
  }
  function commitOverlays() {
    _openOverlays = _renderOverlays || new Set();
    _renderOverlays = null;
  }

  /* render() 는 이른 return 이 여럿이라 커밋을 빠뜨리기 쉽습니다. 한 군데를
     놓치면 그 화면의 시트가 다시는 애니메이션을 안 하거나 매번 다시 하는데,
     둘 다 원인을 짚기 어려운 종류입니다. finally 로 감싸 두면 어느 길로
     나가든 반드시 지나갑니다. */
  function render() {
    try { renderNow(); } finally { commitOverlays(); }
  }

  /* ── 부드럽게 바꾸기 ─────────────────────────────────────────────────────
     화면 내용이 '크게' 바뀌는 순간에만 씁니다 — 부위를 확정해서 그리드가
     운동 목록으로 바뀔 때처럼, 앞뒤가 서로 다른 화면인 경우입니다.

     브라우저의 View Transition 이 바뀌기 직전 화면을 찍어 두었다가 새 화면과
     겹쳐 넘겨 줍니다. render() 가 innerHTML 을 통째로 갈아 끼우는 구조에
     정확히 맞는 도구입니다 — 우리가 무엇이 사라지고 무엇이 생겼는지 추적할
     필요가 없습니다.

     모든 render() 에 걸지 않는 이유가 중요합니다. 세트를 하나 체크할 때마다
     화면 전체가 0.26초씩 겹쳐 넘어가면, 그건 v79 에서 걷어낸 그 깜빡임과
     똑같은 것이 이름만 바꿔 돌아온 것입니다. 그래서 '화면이 바뀌었다' 고 할
     만한 동작에만 손으로 붙입니다.

     지원하지 않는 브라우저(사파리 17 이하 등)에서는 그냥 지금까지처럼
     즉시 바뀝니다 — 없으면 없는 대로 동작합니다. */
  function softRender() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || typeof document.startViewTransition !== 'function') { render(); return; }
    try { document.startViewTransition(() => render()); }
    catch (_) { render(); }
  }

  function renderNow() {
    /* 매 렌더마다 DOM 을 통째로 새로 그리므로, 스와이프로 열어 둔 세트나
       진행 중이던 드래그가 가리키던 노드는 더 이상 존재하지 않습니다.
       참조를 들고 있으면 다음 동작에서 죽은 노드를 건드리게 되니 비워 둡니다. */
    openSwipeRow = null;
    gesture = null;
    /* 운동별 집계 캐시를 여기서 버립니다.
       기록을 바꾸는 곳이 열네 군데라 그 각각에 무효화를 심으면 언젠가 하나를
       빠뜨리고, 그러면 '방금 기록한 운동이 검색에 안 나오는' 조용한 버그가
       됩니다. 상태가 바뀌면 반드시 render() 를 거치므로 여기 한 줄이 그 전부를
       덮습니다. 타이핑 중에는 render() 가 아니라 결과 목록만 갈아 끼우므로
       (아래 search-log 참고) 정작 캐시가 필요한 구간에서는 살아 있습니다. */
    invalidateExIndex();
    if (!state.authReady) { appEl.innerHTML = renderSplash(); paintNav(false); return; }
    if (!state.user && !state.guest) {
      appEl.innerHTML = (state.authMode === 'signup' ? renderSignup()
                      : state.authMode === 'reset'  ? renderReset()
                      : renderLogin())
                      + (state.yearPicker ? renderYearPickerSheet() : '');
      paintNav(false); bindEvents(); positionYearWheel(); return;
    }
    /* Signed in but no 아이디 yet — finish setting the account up first. */
    if (state.user && state.onboarding) {
      appEl.innerHTML = renderOnboarding() + (state.yearPicker ? renderYearPickerSheet() : '');
      paintNav(false); bindEvents(); positionYearWheel(); return;
    }

    let html = '';
    if (state.tab === 'home')          html = renderHome();
    else if (state.tab === 'workout')  html = renderWorkout();
    else if (state.tab === 'history')  html = renderHistory();
    else if (state.tab === 'settings') html = renderSettings();
    /* 위 네 함수가 이번 렌더에서 navDir·pendingEnter* 를 읽어 화면에 이미
       반영했습니다. 다음 렌더(탭 이동이나 새로 추가한 게 아닌 보통의 상태
       변화)에서는 다시 재생되면 안 되므로 여기서 곧바로 비웁니다. */
    navDir = null;
    pendingEnterExIds = new Set();
    pendingEnterSetIds = new Set();
    pendingFoldExIds = new Set();

    if (state.profileEditing) html += renderProfileSheet();
    if (state.yearPicker)     html += renderYearPickerSheet();
    if (state.weightPicker)   html += renderWeightPickerSheet();
    if (state.repsPicker)     html += renderRepsPickerSheet();
    if (state.partSheet)      html += renderPartSheet();
    if (state.pickerPart)     html += renderExercisePickerSheet(state.pickerPart);
    /* 정보 시트는 피커보다 뒤에 그립니다 — 운동을 고르는 도중에 "이게 무슨
       동작이지?" 하고 열었을 때 피커 밑에 깔리면 아무것도 안 보입니다. */
    if (state.exerciseInfoId) html += renderExerciseInfoSheet(state.exerciseInfoId);
    if (state.routineSheet)   html += renderRoutineSheet();
    if (state.routineEdit)    html += renderRoutineEditor();

    /* 전체 화면들은 전부 z-index 45 라 DOM 순서가 곧 쌓이는 순서입니다.
       검색 → 운동 이력 → 하루 요약 순으로 붙여야, 검색에서 운동을 열고 거기서
       날짜를 눌렀을 때 마지막에 연 것이 맨 위에 옵니다. */
    if (state.searchOpen)     html += renderSearchScreen();
    if (state.exHistoryName)  html += renderExHistory(state.exHistoryName);
    /* Full-screen overlay, so it can be opened from home, history or the
       workout screen without any of them needing to know about it. */
    if (state.summaryDate) html += renderDaySummary(state.summaryDate);
    appEl.innerHTML = html;
    paintNav(true);
    bindEvents();
    positionYearWheel();
    syncOverlayScroll();
    flushPendingFlash();
    /* 탭이 바뀌었는지, 설정이 바뀌었는지를 여기서 따로 추적하지 않습니다 —
       상태가 바뀌면 반드시 render() 를 거치므로, 이 한 줄이 모든 경로를
       덮습니다. syncWakeLock 은 차이가 없으면 아무 일도 하지 않습니다. */
    syncWakeLock();
  }

  /* An overlay opens at its own top, and the page under it stops scrolling.

     Both were missing: 운동 마치기 pushed the summary in over a page that was
     still scrolled to wherever the last set was, and the overlay inherited a
     scroll position from whatever had been shown there before, so it arrived
     mid-content and jumped as the entry animation finished. */
  /* 전체 화면이 '새로 열릴 때만' 맨 위로 보냅니다.
     매 렌더마다 되돌리면, 루틴을 만들다 운동을 하나 담을 때마다 화면이
     맨 위로 튀어 방금 보던 자리를 잃습니다. 무엇이 열려 있는지를 키로 삼아
     바뀐 순간에만 초기화합니다. */
  let _overlayKey = null;
  function syncOverlayScroll() {
    /* 전체 화면이 두 겹까지 쌓입니다(검색 → 운동 이력). 맨 위 것을 잡아야
       합니다 — 첫 번째를 잡으면 이력 화면을 열 때 밑에 깔린 검색 화면의
       스크롤이 맨 위로 되돌아가서, 돌아왔을 때 보던 자리를 잃습니다. */
    const screens = document.querySelectorAll('.detail-screen');
    const overlay = screens[screens.length - 1] || null;
    document.body.classList.toggle('overlay-open', !!overlay);
    const key = !overlay ? null
      : state.summaryDate ? `day:${state.summaryDate}`
      : state.exHistoryName ? `exhist:${state.exHistoryName}`
      : state.searchOpen ? 'search'
      : state.routineEdit ? `routine:${state.routineEdit.id || 'new'}`
      : 'other';
    if (key !== _overlayKey) {
      _overlayKey = key;
      if (overlay) overlay.scrollTop = 0;
    }
  }

  /* Newly added exercises get scrolled to and briefly outlined.
     A toast alone was not enough: the picker closes, the page is long, and the
     card that was just created often lands below the fold — so "추가된 건지 안
     된 건지" was a fair question. Showing the user the thing they created is a
     more convincing answer than telling them about it. */
  let pendingFlash = null;
  function flashExercise(exId) { pendingFlash = exId; }
  function flushPendingFlash() {
    if (!pendingFlash) return;
    const id = pendingFlash;
    pendingFlash = null;
    requestAnimationFrame(() => {
      const el = document.querySelector(`.ex-card[data-exid="${CSS.escape(id)}"]`);
      if (!el) return;
      scrollElIntoView(el, 'center');
      el.classList.add('just-added');
      setTimeout(() => el.classList.remove('just-added'), 1500);
    });
  }

  /* ── Auth screens ─────────────────────────── */
  function renderSplash() {
    return `<main class="splash-wrap">
      <div class="splash-brand">FIT<span>LOG</span></div>
      <div class="spinner"></div>
    </main>`;
  }

  const GOOGLE_MARK = `<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.7 7.5l6.3 5.3C37.3 38.2 44 33 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>`;

  function renderLogin() {
    const configured = typeof Cloud !== 'undefined' && Cloud.configured();
    const busy = state.authBusy;
    return `<main class="login-screen">
      <div class="login-top">
        <button class="topbar-brand" data-act="auth-home">FIT<span>LOG</span></button>
        <h1 class="login-title">오늘의 운동을<br>가장 멋지게 기록하세요</h1>
      </div>
      ${configured ? `
        ${state.authError ? `<p class="login-error">${esc(state.authError)}</p>` : ''}
        <button class="btn-google" data-act="login-google" ${busy ? 'disabled' : ''}>
          ${GOOGLE_MARK}${busy ? '처리 중…' : 'Google로 계속하기'}
        </button>
        <div class="login-or"><span>또는</span></div>
        <input class="login-input" id="auth-id" type="text" inputmode="text" autocapitalize="none"
               autocorrect="off" spellcheck="false" autocomplete="username"
               placeholder="아이디" value="${esc(state.authId)}">
        <input class="login-input" id="auth-password" type="password" autocomplete="current-password"
               placeholder="비밀번호" value="${esc(state.authPassword)}">
        <button class="btn-hero" style="margin-top:10px" data-act="login-id" ${busy ? 'disabled' : ''}>
          ${busy ? '처리 중…' : '로그인'}
        </button>
        <div class="login-links">
          <button class="login-link" data-act="reset-password" ${busy ? 'disabled' : ''}>비밀번호 찾기</button>
          <span class="login-link-sep"></span>
          <button class="login-link strong" data-act="go-signup" ${busy ? 'disabled' : ''}>회원가입</button>
        </div>
      ` : `
        <div class="login-setup">Firebase 연결 전에는 이 기기에서만 사용할 수 있습니다.</div>
      `}
    </main>`;
  }

  /* ── Password reset ───────────────────────────────────────────────────────
     A dedicated screen, not a one-tap action on the login form.

     Sending the link IS the identity check — someone who has forgotten their
     password has no other credential to prove with, so every service settles
     for "only the owner of the registered inbox can open the link". Nothing
     extra can meaningfully be verified beforehand.

     What was missing is the part in front of it: a confirmation step. The old
     button fired immediately off whatever was in the login field, so a stray
     tap sent mail and the user never learned which address it went to. Now the
     address is resolved first, shown masked, and only then sent. */
  function maskEmail(addr) {
    const at = String(addr || '').indexOf('@');
    if (at < 1) return addr || '';
    const local = addr.slice(0, at);
    const domain = addr.slice(at);
    if (local.length <= 2) return local[0] + '*'.repeat(3) + domain;
    return local[0] + '*'.repeat(Math.min(local.length - 2, 6)) + local[local.length - 1] + domain;
  }

  function renderReset() {
    const busy = state.authBusy;
    const sent = state.resetSent;
    const wait = state.resetCooldown > 0;

    if (sent) {
      return `<main class="login-screen signup-screen">
        <div class="signup-head">
          <button class="signup-back" data-act="reset-back" aria-label="뒤로">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <button class="topbar-brand" data-act="auth-home">FIT<span>LOG</span></button>
        </div>
        <div class="reset-sent-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><polyline points="3 6.5 12 13 21 6.5"/></svg>
        </div>
        <h1 class="signup-title">메일을 보냈습니다</h1>
        <p class="signup-sub"><strong class="reset-addr">${esc(sent)}</strong> 로 재설정 링크를 보냈습니다.<br>링크를 열어 새 비밀번호를 정해 주세요.</p>
        <div class="signup-note">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          <span>몇 분이 지나도 오지 않으면 스팸함을 확인해 주세요. 메일은 Firebase(noreply@fitlog-4fe54.firebaseapp.com)에서 발송됩니다.</span>
        </div>
        <div class="signup-body"></div>
        <div class="signup-actions">
          <button class="btn-hero" data-act="reset-back">로그인으로 돌아가기</button>
          <button class="login-link" data-act="reset-resend" ${busy || wait ? 'disabled' : ''}>
            ${wait ? `다시 보내기 (${state.resetCooldown}초)` : '메일이 오지 않았나요? 다시 보내기'}
          </button>
        </div>
      </main>`;
    }

    return `<main class="login-screen signup-screen">
      <div class="signup-head">
        <button class="signup-back" data-act="reset-back" aria-label="뒤로">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="topbar-brand" data-act="auth-home">FIT<span>LOG</span></button>
      </div>
      <h1 class="signup-title">비밀번호 재설정</h1>
      <p class="signup-sub">가입할 때 등록한 이메일로 재설정 링크를 보냅니다.</p>

      ${state.authError ? `<p class="login-error">${esc(state.authError)}</p>` : ''}

      <div class="signup-body">
        <label class="field-label" for="reset-id">아이디 또는 이메일</label>
        <input class="login-input" id="reset-id" data-su="resetId" type="text"
               inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false"
               autocomplete="username" placeholder="아이디 또는 가입 이메일" value="${esc(state.signup.resetId || '')}">
        <p class="field-hint">아이디를 넣으면 등록된 주소를 찾아 그쪽으로만 보냅니다.</p>

        ${state.resetTarget ? `
        <div class="reset-confirm">
          <div class="reset-confirm-label">이 주소로 보냅니다</div>
          <div class="reset-confirm-addr">${esc(maskEmail(state.resetTarget))}</div>
        </div>` : ''}
      </div>

      <div class="signup-actions">
        <button class="btn-hero" data-act="${state.resetTarget ? 'reset-send' : 'reset-lookup'}" ${busy ? 'disabled' : ''}>
          ${busy ? '처리 중…' : state.resetTarget ? '재설정 메일 보내기' : '다음'}
        </button>
      </div>
    </main>`;
  }

  /* ── Signup wizard ────────────────────────────────────────────────────────
     Three short steps instead of one wall of inputs. The old screen asked for
     email, password and password-confirm at once, under a pair of tabs that
     also switched the form's meaning — so "회원가입" looked identical to
     "로그인" and every field was equally mandatory-looking.

     Splitting it means each step asks one thing, and the 아이디 can be checked
     for availability while you are still on that step rather than failing at
     submit.

     Step 3 has no validation, so every profile field is still optional — the
     explicit 건너뛰기 button was removed because it read as a second, competing
     way to finish. Leaving the fields blank and pressing 가입 완료 does exactly
     what it used to do. */
  const SIGNUP_STEPS = [
    { n: 1, title: '아이디와 비밀번호', sub: '로그인할 때 쓸 아이디를 정해 주세요.' },
    { n: 2, title: '복구용 이메일',     sub: '비밀번호를 잊었을 때 재설정 링크를 받을 주소입니다.' },
    { n: 3, title: '프로필',            sub: '나중에 설정에서 바꿀 수 있어요.' },
  ];

  function renderSignupStep1() {
    const s = state.signup;
    const chk = state.idCheck;
    const showChk = chk.id && chk.id === Cloud.normalizeUsername(s.username);
    const chkCls = chk.status === 'free' ? 'ok' : chk.status === 'checking' ? 'muted' : 'bad';
    const chkText = !showChk ? ''
      : chk.status === 'checking' ? '확인 중…'
      : chk.status === 'free' ? '사용할 수 있는 아이디예요'
      : chk.message || '사용할 수 없는 아이디입니다';
    const pwLen = (s.password || '').length;
    const pwMatch = s.password2 && s.password === s.password2;
    return `
      <label class="field-label" for="su-username">아이디</label>
      <input class="login-input" id="su-username" data-su="username" type="text"
             inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false"
             autocomplete="username" maxlength="20"
             placeholder="영문 소문자·숫자 3~20자" value="${esc(s.username)}">
      ${showChk ? `<p class="field-hint ${chkCls}">${esc(chkText)}</p>` : `<p class="field-hint">나중에 바꿀 수 없으니 신중히 정해 주세요.</p>`}

      <label class="field-label" for="su-password">비밀번호</label>
      <input class="login-input" id="su-password" data-su="password" type="password"
             autocomplete="new-password" placeholder="6자 이상" value="${esc(s.password)}">
      <input class="login-input" id="su-password2" data-su="password2" type="password"
             autocomplete="new-password" placeholder="비밀번호 확인" value="${esc(s.password2)}">
      <!-- Always present, even when empty: paintSignupHints() writes into this
           node instead of re-rendering, so it has to exist before the first
           keystroke or the match/length feedback never appears at all. Its
           reserved min-height also stops the layout jumping when text arrives. -->
      <p class="field-hint${s.password2 ? (pwMatch ? ' ok' : ' bad') : (pwLen && pwLen < 6 ? ' bad' : '')}">${
        s.password2 ? (pwMatch ? '비밀번호가 일치합니다' : '비밀번호가 일치하지 않습니다')
                    : (pwLen && pwLen < 6 ? '6자 이상 입력해 주세요' : '')}</p>`;
  }

  function renderSignupStep2() {
    const s = state.signup;
    return `
      <label class="field-label" for="su-email">이메일</label>
      <input class="login-input" id="su-email" data-su="email" type="email"
             inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false"
             autocomplete="email" placeholder="you@example.com" value="${esc(s.email)}">
      <p class="field-hint">로그인에는 쓰이지 않습니다. 비밀번호를 잊었을 때 이 주소로만 재설정 링크를 보냅니다.</p>
      <div class="signup-note">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="16" x2="12" y2="11"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        <span>받을 수 있는 주소를 넣어 주세요. 이 주소가 없으면 비밀번호를 잊었을 때 기록을 되찾을 방법이 없습니다.</span>
      </div>`;
  }

  function renderSignupStep3() {
    const s = state.signup;
    const genders = [['male','남성'],['female','여성']];
    return `
      <label class="field-label" for="su-name">이름</label>
      <input class="login-input" id="su-name" data-su="name" type="text"
             autocomplete="name" maxlength="40" placeholder="앱에서 부를 이름" value="${esc(s.name)}">

      <label class="field-label">성별</label>
      <div class="seg-row">
        ${genders.map(([v,l]) => `<button class="seg-btn${s.gender===v?' on':''}" data-act="su-gender" data-val="${v}">${l}</button>`).join('')}
      </div>

      <div class="field-grid">
        <div>
          <label class="field-label">출생연도</label>
          ${yearField(s.birthYear)}
        </div>
        <div>
          <label class="field-label" for="su-height">키 (${heightUnitLabel()})</label>
          <input class="login-input" id="su-height" data-su="heightCm" type="text"
                 inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayHeight(175))}" value="${esc(s.heightCm)}">
        </div>
        <div>
          <label class="field-label" for="su-weight">몸무게 (${weightUnitLabel()})</label>
          <input class="login-input" id="su-weight" data-su="weightKg" type="text"
                 inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayWeight(70))}" value="${esc(s.weightKg)}">
        </div>
      </div>
      <p class="field-hint">몸무게를 넣어두면 맨몸 운동의 부하를 자동으로 계산해 드립니다.</p>`;
  }

  function renderSignup() {
    const step = SIGNUP_STEPS.find(x => x.n === state.signupStep) || SIGNUP_STEPS[0];
    const busy = state.authBusy;
    const last = state.signupStep === 3;
    const body = state.signupStep === 1 ? renderSignupStep1()
               : state.signupStep === 2 ? renderSignupStep2()
               : renderSignupStep3();
    return `<main class="login-screen signup-screen">
      <div class="signup-head">
        <button class="signup-back" data-act="signup-back" aria-label="뒤로">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="topbar-brand" data-act="auth-home">FIT<span>LOG</span></button>
        <div class="signup-steps">
          ${SIGNUP_STEPS.map(x => `<span class="signup-dot${x.n === state.signupStep ? ' on' : ''}${x.n < state.signupStep ? ' done' : ''}"></span>`).join('')}
        </div>
        <span class="signup-count">${state.signupStep}/3</span>
      </div>

      <h1 class="signup-title">${esc(step.title)}</h1>
      <p class="signup-sub">${esc(step.sub)}</p>

      ${state.authError ? `<p class="login-error">${esc(state.authError)}</p>` : ''}

      <div class="signup-body">${body}</div>

      <div class="signup-actions">
        <button class="btn-hero" data-act="signup-next" ${busy ? 'disabled' : ''}>
          ${busy ? '처리 중…' : last ? '가입 완료' : '다음'}
        </button>
      </div>
    </main>`;
  }

  /* Same fields as signup step 3, in a sheet. The 아이디 is shown but not
     editable — it is a stable public handle, and letting it change would strand
     the usernames/{id} pointer that sign-in depends on. */
  function renderProfileSheet() {
    const s = state.signup;
    const genders = [['male','남성'],['female','여성']];
    const uname = state.profile?.username || '';
    return `<div class="sheet-backdrop${overlayIn('profile')}">
      <div class="sheet-panel" id="sheet-profile">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div><div class="sheet-title">프로필</div></div>
          <button class="sheet-x" data-act="close-profile" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="sheet-scroll">
          ${uname ? `
          <div class="form-group">
            <div class="form-row static">
              <span class="form-row-label">아이디</span>
              <span class="form-row-value">@${esc(uname)}</span>
            </div>
          </div>` : ''}

          <div class="form-label">기본 정보</div>
          <div class="form-group">
            <div class="form-row">
              <label class="form-row-label" for="pf-name">이름</label>
              <input class="form-row-input" id="pf-name" data-su="name" type="text"
                     maxlength="40" placeholder="앱에서 부를 이름" value="${esc(s.name)}">
            </div>
            <div class="form-row">
              <span class="form-row-label">성별</span>
              <div class="form-row-seg">
                ${genders.map(([v,l]) => `<button class="seg-btn${s.gender===v?' on':''}" data-act="su-gender" data-val="${v}">${l}</button>`).join('')}
              </div>
            </div>
          </div>

          <!-- Grouped rows with the value on the right, rather than the old
               three-across grid of bare inputs. That grid squeezed "출생연도",
               "키 (cm)" and "몸무게 (kg)" into a third of the width each, so the
               labels wrapped and the units had nowhere to sit. -->
          <div class="form-label">신체 정보</div>
          <div class="form-group">
            <button class="form-row tappable" data-act="open-year">
              <span class="form-row-label">출생연도</span>
              <span class="form-row-value${s.birthYear ? '' : ' empty'}">${s.birthYear ? esc(s.birthYear) : '선택'}</span>
              <svg class="form-row-chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="form-row">
              <label class="form-row-label" for="pf-height">키</label>
              <input class="form-row-input num" id="pf-height" data-su="heightCm" type="text"
                     inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayHeight(175))}" value="${esc(s.heightCm)}">
              <span class="form-row-unit">${heightUnitLabel()}</span>
            </div>
            <div class="form-row">
              <label class="form-row-label" for="pf-weight">몸무게</label>
              <input class="form-row-input num" id="pf-weight" data-su="weightKg" type="text"
                     inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayWeight(70))}" value="${esc(s.weightKg)}">
              <span class="form-row-unit">${weightUnitLabel()}</span>
            </div>
          </div>
        </div>
        <button class="picker-confirm" data-act="save-profile" ${state.authBusy?'disabled':''}>${state.authBusy?'저장 중…':'저장'}</button>
      </div>
    </div>`;
  }

  /* ── 출생연도 wheel ───────────────────────────────────────────────────────
     A birth year is picked, not typed. The old text field asked for four
     digits on a numeric keyboard, accepted 19 and 3000 alike, and put a
     keyboard over half the screen to collect a number from a range the app
     already knows. A wheel can only produce a year that exists.

     Built on CSS scroll-snap rather than a drag library: the browser supplies
     the momentum, the snapping and the accessibility, and a tap on any row is
     an ordinary button. The selected row is whatever sits in the centre band,
     which is read back on scroll. */
  const YEAR_MIN = 1920;
  function yearList() {
    const now = new Date().getFullYear();
    const out = [];
    for (let y = now; y >= YEAR_MIN; y--) out.push(y);
    return out;
  }

  function renderYearPickerSheet() {
    const sel = Number(state.yearPicker) || 0;
    const years = yearList();
    const age = sel ? (new Date().getFullYear() - sel) : null;
    return `<div class="sheet-backdrop${overlayIn('year')}">
      <div class="sheet-panel" id="sheet-year">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div>
            <div class="sheet-title">출생연도</div>
            <div class="sheet-title-sub">${age !== null ? `만 ${age}세` : '위아래로 넘겨 선택하세요'}</div>
          </div>
          <button class="sheet-x" data-act="close-year" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="wheel" id="year-wheel">
          <div class="wheel-band" aria-hidden="true"></div>
          <div class="wheel-scroll" id="year-scroll" role="listbox" aria-label="출생연도">
            <div class="wheel-pad"></div>
            ${years.map(y => `<button class="wheel-item${y === sel ? ' on' : ''}" role="option"
              aria-selected="${y === sel}" data-act="pick-year" data-year="${y}">${y}</button>`).join('')}
            <div class="wheel-pad"></div>
          </div>
        </div>
        <button class="picker-confirm" data-act="confirm-year">확인</button>
      </div>
    </div>`;
  }

  /* The wheel is a scroll container, so the current value has to be scrolled
     to after every paint — there is no declarative way to say "start here". */
  function positionYearWheel() {
    const scroll = document.getElementById('year-scroll');
    if (!scroll) return;
    const active = scroll.querySelector('.wheel-item.on') || scroll.querySelector('.wheel-item');
    if (!active) return;
    scroll.scrollTop = active.offsetTop - (scroll.clientHeight - active.offsetHeight) / 2;
    bindYearWheel(scroll);
  }

  /* Reads the centre row back out as the user scrolls, so the header ("만 30세")
     and the highlight track the wheel instead of waiting for 확인. */
  function bindYearWheel(scroll) {
    if (scroll.dataset.bound) return;
    scroll.dataset.bound = '1';
    let raf = 0;
    scroll.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const mid = scroll.scrollTop + scroll.clientHeight / 2;
        let best = null, bestGap = Infinity;
        scroll.querySelectorAll('.wheel-item').forEach(el => {
          const gap = Math.abs((el.offsetTop + el.offsetHeight / 2) - mid);
          if (gap < bestGap) { bestGap = gap; best = el; }
        });
        if (!best) return;
        const y = Number(best.dataset.year);
        if (y === state.yearPicker) return;
        state.yearPicker = y;
        scroll.querySelectorAll('.wheel-item.on').forEach(el => {
          el.classList.remove('on'); el.setAttribute('aria-selected', 'false');
        });
        best.classList.add('on'); best.setAttribute('aria-selected', 'true');
        const sub = document.querySelector('#sheet-year .sheet-title-sub');
        if (sub) sub.textContent = `만 ${new Date().getFullYear() - y}세`;
      });
    }, { passive: true });
  }

  /* Shown in place of the old text input. A button, so it is obvious that
     tapping it opens something rather than raising a keyboard. */
  function yearField(value) {
    const v = Number(value) || 0;
    return `<button class="field-picker${v ? '' : ' is-empty'}" data-act="open-year">
      <span>${v ? v : '선택'}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>`;
  }

  /* ── Onboarding gate ──────────────────────────────────────────────────────
     Shown once to any signed-in account that has no 아이디 yet, which in
     practice means every Google account. Without it a Google user and a
     password user would be two different species — one with a handle and a
     profile, one with neither — which is exactly the inconsistency that made
     the two sign-in paths feel like different apps. */
  function renderOnboarding() {
    const s = state.signup;
    const chk = state.idCheck;
    const showChk = chk.id && chk.id === Cloud.normalizeUsername(s.username);
    const chkCls = chk.status === 'free' ? 'ok' : chk.status === 'checking' ? 'muted' : 'bad';
    const chkText = chk.status === 'checking' ? '확인 중…'
      : chk.status === 'free' ? '사용할 수 있는 아이디예요'
      : chk.message || '사용할 수 없는 아이디입니다';
    const genders = [['male','남성'],['female','여성']];
    const busy = state.authBusy;
    return `<main class="login-screen signup-screen">
      <div class="signup-head"><div class="topbar-brand">FIT<span>LOG</span></div></div>
      <h1 class="signup-title">거의 다 됐어요</h1>
      <p class="signup-sub">모든 항목을 채우면 시작합니다. 한 번만 물어봅니다.</p>

      ${state.authError ? `<p class="login-error">${esc(state.authError)}</p>` : ''}

      <div class="signup-body">
        <label class="field-label" for="ob-username">아이디</label>
        <input class="login-input" id="ob-username" data-su="username" type="text"
               inputmode="text" autocapitalize="none" autocorrect="off" spellcheck="false"
               maxlength="20" placeholder="영문 소문자·숫자 3~20자" value="${esc(s.username)}">
        ${showChk ? `<p class="field-hint ${chkCls}">${esc(chkText)}</p>` : `<p class="field-hint">나중에 바꿀 수 없으니 신중히 정해 주세요.</p>`}

        <label class="field-label" for="ob-name">이름</label>
        <input class="login-input" id="ob-name" data-su="name" type="text" maxlength="40"
               placeholder="앱에서 부를 이름" value="${esc(s.name)}">

        <label class="field-label">성별</label>
        <div class="seg-row">
          ${genders.map(([v,l]) => `<button class="seg-btn${s.gender===v?' on':''}" data-act="su-gender" data-val="${v}">${l}</button>`).join('')}
        </div>

        <div class="field-grid">
          <div>
            <label class="field-label">출생연도</label>
            ${yearField(s.birthYear)}
          </div>
          <div>
            <label class="field-label" for="ob-height">키 (${heightUnitLabel()})</label>
            <input class="login-input" id="ob-height" data-su="heightCm" type="text" inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayHeight(175))}" value="${esc(s.heightCm)}">
          </div>
          <div>
            <label class="field-label" for="ob-weight">몸무게 (${weightUnitLabel()})</label>
            <input class="login-input" id="ob-weight" data-su="weightKg" type="text" inputmode="decimal" maxlength="5" placeholder="${Math.round(toDisplayWeight(70))}" value="${esc(s.weightKg)}">
          </div>
        </div>
      </div>

      <div class="signup-actions">
        <button class="btn-hero" data-act="onboarding-save" ${busy ? 'disabled' : ''}>${busy ? '저장 중…' : '시작하기'}</button>
      </div>
    </main>`;
  }

  /* ── Bottom Nav ───────────────────────────── */
  /* ── 하단 탭 ──────────────────────────────────────────────────────────────
     탭 바는 #app 안이 아니라 <body> 에 직접 붙입니다.

     render() 가 #app 을 통째로 갈아 끼우기 때문에, 탭 바가 그 안에 있으면
     탭을 옮길 때마다 바가 통째로 새로 만들어집니다. 새로 만들어진 요소에는
     '직전 위치' 가 없고 CSS 전환은 값이 바뀌어야 걸리므로, 강조 표시가
     미끄러질 방법이 아예 없었습니다 — 매번 새 자리에 그냥 나타날 뿐이었죠.

     body 에 한 번만 만들어 두면 그 요소가 계속 살아 있으므로, 자리만 바꿔
     주면 브라우저가 그 사이를 채웁니다. 휴식 타이머 바를 body 에 둔 것과
     같은 이유입니다. */
  let navEl = null;
  /* 직전에 어느 칸에 있었는지. 첫 그리기(-1)에는 움직임을 만들지 않습니다. */
  let navIdx = -1;

  function ensureNavEl() {
    if (navEl && navEl.isConnected) return navEl;
    navEl = document.createElement('nav');
    navEl.className = 'bottom-nav no-anim';
    navEl.innerHTML = '<span class="nav-pill" aria-hidden="true"></span>' + navTabsHtml();
    /* 클릭은 #app 에 묶여 있는데 이 바는 그 밖에 있으므로 따로 받아 넘깁니다.
       같은 onClick 이라 data-act 처리 규칙은 완전히 같습니다. */
    navEl.onclick = onClick;
    document.body.appendChild(navEl);
    /* 첫 그리기에서는 미끄러지면 안 됩니다 — 앱을 열자마자 알약이 왼쪽에서
       현재 탭까지 날아오면 전환이 아니라 오작동으로 보입니다. */
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { navEl.classList.remove('no-anim'); } catch (_) {}
    }));
    return navEl;
  }

  /* render() 끝에서 부릅니다. DOM 을 다시 만들지 않고 상태만 칠합니다 —
     다시 만들면 위에 적은 이유로 미끄러짐이 사라집니다. */
  function paintNav(show) {
    const el = ensureNavEl();
    el.hidden = !show;
    document.body.classList.toggle('has-nav', !!show);
    if (!show) return;
    const i = Math.max(0, TAB_ORDER.indexOf(state.tab));

    /* 물방울처럼 보이게 하는 것은 '이동' 이 아니라 '늘어났다 줄어드는 것'
       입니다. 옮겨 가는 동안 진행 방향으로 납작하게 늘어졌다가 도착해서
       도로 뭉치면, 같은 거리를 같은 시간에 움직여도 딱딱한 사각형이 아니라
       한 덩어리의 액체가 흘러간 것으로 읽힙니다.

       늘어나는 양을 건너뛴 칸 수에 비례시킵니다 — 옆 칸으로 갈 때와 끝에서
       끝으로 갈 때가 똑같이 늘어나면, 멀리 갈수록 오히려 뻣뻣해 보입니다.

       옮기는 일(translate)은 바깥 상자가, 늘어나는 일(scale)은 안쪽이
       맡습니다. 한 요소에 둘 다 걸면 transform 이 서로를 덮어씁니다. */
    if (navIdx >= 0 && navIdx !== i) {
      const dist = Math.min(3, Math.abs(i - navIdx));
      el.style.setProperty('--goo', (0.20 + dist * 0.17).toFixed(2));
      /* 클래스를 뗐다 붙이는 것만으로는 같은 애니메이션이 다시 시작되지
         않습니다(브라우저가 한 프레임 안의 변화를 합쳐 버립니다). 사이에
         레이아웃을 한 번 읽어 강제로 끊어 줍니다. */
      el.classList.remove('moving');
      void el.offsetWidth;
      el.classList.add('moving');
    }
    navIdx = i;
    el.style.setProperty('--nav-i', String(i));
    el.querySelectorAll('.nav-tab').forEach((b, n) => {
      const on = n === i;
      b.classList.toggle('active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function navTabsHtml() {
    const tabs = [
      { id:'home',     label:'홈',
        icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
      { id:'workout',  label:'기록',
        icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="9" width="3" height="6" rx="1.2"/><rect x="18.5" y="9" width="3" height="6" rx="1.2"/><path d="M5.5 12h2M16.5 12h2M8 12h8"/></svg>` },
      { id:'history',  label:'히스토리',
        icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>` },
      { id:'settings', label:'설정',
        icon:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` },
    ];
    /* 순서는 TAB_ORDER 와 반드시 같아야 합니다 — 알약 위치를 그 인덱스로
       계산하므로, 여기서만 순서를 바꾸면 알약이 엉뚱한 탭에 앉습니다. */
    return tabs.map(t=>`
      <button class="nav-tab" data-act="go-tab" data-tab="${t.id}">
        ${t.icon}<span>${t.label}</span>
      </button>`).join('');
  }

  /* ── Training balance ─────────────────────────────────────────────────────
     Replaces the weekly set/volume counters. A set total answers "how much did
     I lift", which is a number you can't act on and which quietly punishes
     bodyweight and low-rep work. What actually changes the next session is
     which muscle groups have gone stale — so the home screen answers "what have
     I been skipping" instead.

     A part counts as trained on a day when at least one of its sets was ticked
     done; a planned-but-empty part doesn't count, otherwise adding a part tile
     and walking out would read as a workout. Recency is tracked separately from
     frequency because three chest days a fortnight ago is a different problem
     from three spread through this week. */
  const BALANCE_WINDOW = 14;

  /* Consecutive days ending today (or yesterday, so the streak survives until
     the day is actually over rather than resetting at midnight). */
  function streakDays() {
    const logged = new Set(state.sessions.filter(hasAnyWork).map(s => s.date));
    if (!logged.size) return 0;
    const today = todayISO();
    let cursor = logged.has(today) ? today : shiftDate(today, -1);
    if (!logged.has(cursor)) return 0;
    let n = 0;
    while (logged.has(cursor)) { n += 1; cursor = shiftDate(cursor, -1); }
    return n;
  }

  /* A session counts as a workout only if something was actually completed —
     a ticked set or a logged run. Opening the app and adding a part tile is
     not a training day. */
  function hasAnyWork(s) {
    if (!s) return false;
    if (Number(s.run?.km) > 0 || Number(s.run?.minutes) > 0) return true;
    return (s.exercises || []).some(ex => (ex.sets || []).some(st => st.done));
  }

  function partBalance() {
    const parts = PARTS.filter(p => p.kind === 'weight');
    const today = todayISO();
    const since = shiftDate(today, -(BALANCE_WINDOW - 1));
    const stats = {};
    parts.forEach(p => { stats[p.id] = { part: p, days: 0, sets: 0, last: null }; });

    for (const s of state.sessions) {
      if (!s.date || s.date < since || s.date > today) continue;
      const trainedToday = new Set();
      for (const ex of s.exercises || []) {
        const st = stats[ex.part];
        if (!st) continue;
        const done = (ex.sets || []).filter(x => x.done).length;
        if (!done) continue;
        st.sets += done;
        trainedToday.add(ex.part);
      }
      trainedToday.forEach(id => {
        stats[id].days += 1;
        if (!stats[id].last || s.date > stats[id].last) stats[id].last = s.date;
      });
    }
    return parts.map(p => stats[p.id]);
  }

  /* Days since a part was last trained; null (never in range) sorts as "longest
     ago" so untouched groups surface first rather than being skipped by a
     numeric comparison against nothing. */
  function daysSince(iso) {
    if (!iso) return Infinity;
    return Math.round((isoToDate(todayISO()) - isoToDate(iso)) / 86400000);
  }

  /* Sortable staleness. daysSince returns Infinity for a group with no session
     in the window, and Infinity - Infinity is NaN — a comparator returning NaN
     leaves the array in an arbitrary order, which for a new user (every group
     untrained, so every pair NaN) is exactly when the suggestion matters most.
     Clamping "never" to just past the window keeps it the largest finite gap. */
  function staleRank(row) {
    const d = daysSince(row.last);
    return Number.isFinite(d) ? d : BALANCE_WINDOW + 1;
  }

  function balanceSuggestion(rows) {
    const ranked = rows.slice().sort((a, b) => {
      if (a.days !== b.days) return a.days - b.days;
      if (staleRank(a) !== staleRank(b)) return staleRank(b) - staleRank(a);
      /* Final tiebreak on the canonical PARTS order so the same input always
         produces the same suggestion instead of drifting between renders. */
      return PARTS.indexOf(a.part) - PARTS.indexOf(b.part);
    });
    return ranked.slice(0, 2);
  }

  function renderBalanceCard() {
    const rows = partBalance();
    const trained = rows.filter(r => r.days > 0);

    /* Nothing logged yet in the window — a bar chart of six zeros teaches
       nothing, so say what the card will do once there is data. */
    if (!trained.length) {
      return `<div class="balance-card">
        <div class="balance-head">
          <div class="sec-title">부위 밸런스</div>
          <span class="balance-window">최근 ${BALANCE_WINDOW}일</span>
        </div>
        <p class="balance-empty">운동을 기록하면 부위별로 얼마나 했는지, 어디가 부족한지 여기에 정리해 드려요.</p>
      </div>`;
    }

    const max = Math.max(...rows.map(r => r.days), 1);
    const bars = rows.map(r => {
      const pct = Math.round((r.days / max) * 100);
      const gap = daysSince(r.last);
      const meta = r.days
        ? `${r.days}일 · ${r.sets}세트`
        : `${BALANCE_WINDOW}일간 없음`;
      const staleCls = r.days === 0 ? ' stale' : (gap >= 7 ? ' warn' : '');
      return `<div class="balance-row${staleCls}">
        <span class="balance-name">${esc(r.part.label)}</span>
        <span class="balance-track"><span class="balance-fill" style="width:${Math.max(pct, r.days ? 8 : 3)}%;background:${r.part.color}"></span></span>
        <span class="balance-meta">${esc(meta)}</span>
      </div>`;
    }).join('');

    const picks = balanceSuggestion(rows);
    const names = picks.map(p => p.part.label).join('·');
    const primary = picks[0];
    const gap = daysSince(primary.last);
    const why = primary.days === 0
      ? `${BALANCE_WINDOW}일 동안 기록이 없어요`
      : gap >= 7 ? `마지막으로 한 지 ${gap}일 됐어요`
      : `다른 부위보다 적게 했어요`;

    return `<div class="balance-card">
      <div class="balance-head">
        <div class="sec-title">부위 밸런스</div>
        <span class="balance-window">최근 ${BALANCE_WINDOW}일</span>
      </div>
      <div class="balance-bars">${bars}</div>
      <div class="balance-tip">
        <div class="balance-tip-text">
          <strong>${esc(names)}</strong>${josa(names, '이', '가')} 부족해요 — ${esc(why)}.
        </div>
        <button class="balance-go" data-act="start-part" data-part="${esc(primary.part.id)}">
          ${esc(primary.part.label)} 시작
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>`;
  }

  /* Offers pre-login records without interrupting anything. States what was
     found and where it came from, so "가져오기" is an informed choice rather
     than a yes/no to a question the user didn't expect. */
  function renderImportCard() {
    const p = state.pendingImport;
    if (!p || !state.user) return '';
    const days = p.sessions.length;
    const bits = [];
    if (days) bits.push(`${days}일치 운동 기록`);
    if (p.customExercises.length) bits.push(`직접 만든 운동 ${p.customExercises.length}개`);
    return `<div class="import-card">
      <div class="import-head">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        로그인 전 기록이 있어요
      </div>
      <p class="import-body">이 기기에서 <strong>로그인하지 않고 기록한</strong> ${esc(bits.join(' · '))}${subjectParticle(bits[bits.length - 1])} 남아 있습니다. 내 계정으로 가져올까요?</p>
      <div class="import-actions">
        <button class="btn-ghost" data-act="dismiss-import">아니요</button>
        <button class="btn-ghost import-yes" data-act="import-local">가져오기</button>
      </div>
    </div>`;
  }

  /* ── Home Tab ─────────────────────────────── */
  function renderHome() {
    const today = todayISO();
    const todaySess = state.sessions.find(s => s.date === today);
    const weekDays = getWeekDays();
    const wdLabels = weekdayLabelsShort();
    const td = new Date();

    const weekStrip = weekDays.map((iso, i) => {
      const [, , d] = iso.split('-').map(Number);
      const hasSess = state.sessions.some(s => s.date === iso && hasAnyWork(s));
      const isToday = iso === today;
      /* 날짜 숫자는 운동한 날에도 그대로 둡니다. 예전에는 체크 표시로
         바꿨는데, 그러면 한 주가 "✓ ✓ 11 ✓ 13 ✓ 15" 처럼 읽혀 며칠인지
         가늠이 안 됐습니다 — 오늘 날짜조차 체크에 가렸습니다. 완료했다는
         사실은 링을 강조색으로 채워서 이미 충분히 말하고 있으니, 숫자
         자리를 뺏을 필요가 없습니다. */
      return `<div class="week-day${hasSess?' done':''}${isToday?' today':''}">
        <div class="ring">${d}</div>
        <span class="wd-label">${wdLabels[i]}</span>
      </div>`;
    }).join('');

    /* week stats */
    /* 세트를 하나도 찍지 않은 날은 운동한 날이 아닙니다 — hasAnyWork 의 주석과
       streakDays() 가 쓰는 기준을 여기서도 그대로 씁니다. 부위 칩만 눌러 둔
       날에 ✓ 가 칠해지면 '연속 기록 0일' 과 '이번 주 운동 1일' 이 같은 화면에서
       서로 다른 말을 합니다. */
    const weekSessions = state.sessions.filter(s => weekDays.includes(s.date) && hasAnyWork(s));
    const weekCount = weekSessions.length;
    const weekKm = weekSessions.reduce((a,s)=>a+(Number(s.run?.km)||0),0);
    /* Running only earns a slot once there is running to show — an eternal
       "0 km" is just a reminder of something the user doesn't do. */
    const everRan = state.sessions.some(s => Number(s.run?.km) > 0);

    let todayBlock;
    if (todaySess) {
      const parts = sessionPartIds(todaySess).map(id=>{
        const p = PARTS.find(x=>x.id===id);
        return p ? `<span class="muscle-tag part" style="--pc:${p.color}">${p.label}</span>` : '';
      }).join('');
      /* The whole card is the tap target — looking at what you did is the far
         more common intent than editing it, and 편집 stays one tap away inside.
         Wrapped in a <button> rather than given an onclick so it is reachable
         by keyboard and announced as an action. */
      const tStats = sessionStats(todaySess);
      const tRun = Number(todaySess.run?.km);
      const finished = !!todaySess.completed;
      const names = (todaySess.exercises || []).map(e => e.name);
      const preview = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` 외 ${names.length - 3}개` : '');
      todayBlock = `<button class="today-card${finished ? ' done' : ''}" data-act="open-summary" data-date="${esc(todaySess.date)}">
        <div class="today-card-top">
          <div class="badge-done${finished ? '' : ' progress'}">
            ${finished
              ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>오늘 운동 완료`
              : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>기록하는 중`}
          </div>
          <svg class="today-card-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        <div class="today-card-parts">${parts || '<span class="sec-sub">부위 미선택</span>'}</div>
        ${preview ? `<div class="today-card-ex">${esc(preview)}</div>` : ''}
        <div class="today-card-stats">
          <span><b>${(todaySess.exercises || []).length}</b>개 운동</span>
          <span><b>${tStats.done}</b>${tStats.total ? `<i>/${tStats.total}</i>` : ''} 세트</span>
          ${Number.isFinite(tRun) && tRun ? `<span><b>${tRun}</b>km</span>` : ''}
        </div>
        ${tStats.total ? `<div class="today-card-bar"><span style="width:${Math.round(tStats.done / tStats.total * 100)}%"></span></div>` : ''}
      </button>
      <button class="btn-ghost today-edit" data-act="today">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        ${finished ? '오늘 기록 이어서 편집' : '기록 계속하기'}
      </button>`;
    } else {
      todayBlock = `<div style="margin-bottom:20px">
        <button class="btn-hero" data-act="today">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          오늘 운동 기록하기
        </button>
      </div>`;
    }

  /* 홈에는 최근 5개까지만. 전체는 히스토리 탭에 달력과 함께 있고, 홈에서
     같은 목록을 길게 늘어놓으면 아래쪽 카드들이 스크롤 저편으로 밀립니다. */
    const RECENT_ON_HOME = 5;
    const recent = state.sessions.slice(0, RECENT_ON_HOME);
    const recentHtml = recent.length ? `
      <div class="sec-head"><div class="sec-title">최근 기록</div></div>
      <div class="recent-list">${recent.map(s => {
        const [, m, d] = s.date.split('-').map(Number);
        const dots = sessionPartIds(s).map(id=>{
          const p = PARTS.find(x=>x.id===id);
          return p ? `<span class="pdot" style="background:${p.color}"></span>` : '';
        }).join('');
        const sets = (s.exercises||[]).reduce((a,ex)=>a+(ex.sets||[]).filter(st=>st.done).length,0);
        /* 점이 없는데 '15세트 · ' 로 끝나면 뒤에 뭔가 잘린 것처럼 보입니다. */
        const metaVol = sets ? (dots ? `${sets}세트 · ` : `${sets}세트`) : '';
        return `<button class="recent-row" data-act="open-day" data-date="${esc(s.date)}">
          <div class="recent-daybox">
            <div class="recent-day-d">${d}</div>
            <div class="recent-day-m">${m}월</div>
          </div>
          <div class="recent-mid">
            <div class="recent-parts">${esc(sessionSummary(s) || '기록')}</div>
            <div class="recent-meta">${metaVol}<span class="dotline">${dots}</span></div>
          </div>
          <svg class="recent-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
      }).join('')}</div>
      ${state.sessions.length > RECENT_ON_HOME
        ? `<button class="btn-ghost recent-more" data-act="go-tab" data-tab="history">
             기록 ${state.sessions.length}개 전체 보기
           </button>` : ''}` : '';

    /* 예전에는 시간대에 맞춘 인사말("좋은 저녁이에요")이 이 자리에서 가장 큰
       글씨였습니다. 하루에 두 번째로 열 때부터는 읽을 것이 없는 문장인데
       화면 맨 위를 차지했습니다. 대신 날짜를 그 자리로 올립니다 — 매일
       바뀌고, 아래 주간 스트립이 날짜만 보여 주니 '몇 월인지' 를 여기서
       받아 줍니다. */
    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen${navDir ? ' nav-' + navDir : ''}">
        <div class="home-hero">
          <div class="home-title">${td.getMonth()+1}월 ${td.getDate()}일<span>${WEEKDAYS[td.getDay()]}요일</span></div>
        </div>
        <div class="week-strip">${weekStrip}</div>
        <div class="stat-row">
          <div class="stat-card"><div class="stat-val">${weekCount}<span>일</span></div><div class="stat-lbl">이번 주 운동</div></div>
          <div class="stat-card"><div class="stat-val">${streakDays()}<span>일</span></div><div class="stat-lbl">연속 기록</div></div>
          ${everRan ? `<div class="stat-card"><div class="stat-val">${weekKm?weekKm.toFixed(weekKm%1?1:0):0}<span>km</span></div><div class="stat-lbl">주간 러닝</div></div>` : ''}
        </div>
        ${renderImportCard()}
        ${todayBlock}
        ${renderBalanceCard()}
        ${recentHtml}
      </main>`;
  }

  /* 8칸 부위 그리드. 아직 부위를 안 고른 날의 본문이자, 고르고 난 뒤에는
     '＋ 부위' 시트의 내용물입니다 — 같은 그리드를 두 곳에서 씁니다. */
  /* 지금 화면에 '켜져 있다' 고 보여 줄 부위 목록. 고르는 중이면 확정 전
     선택을, 아니면 실제로 저장된 부위를 씁니다. */
  function stagedParts(s) {
    return state.partSelection || s.parts;
  }
  function partsDirty(s) {
    if (!state.partSelection) return false;
    const a = state.partSelection.slice().sort().join(',');
    const b = s.parts.slice().sort().join(',');
    return a !== b;
  }

  /* 고른 것을 실제로 반영하는 버튼. 바뀐 게 없으면 눌러도 할 일이 없으므로
     비활성으로 두고, 무엇이 일어날지를 그대로 적습니다 — '3개 부위 추가' 와
     '1개 빼기' 는 결과가 아주 다른데 버튼이 '확인' 하나면 알 수 없습니다. */
  function renderPartConfirm(s) {
    const next = stagedParts(s);
    const added = next.filter(id => !s.parts.includes(id)).length;
    const removed = s.parts.filter(id => !next.includes(id)).length;
    /* 바뀐 게 없으면 아무것도 그리지 않습니다. 눌러도 할 일이 없는 버튼을
       회색으로 띄워 두면 화면에 '막힌 곳' 이 하나 생길 뿐이고, 무엇을 해야
       하는지는 타일의 '탭하여 추가' 가 이미 말하고 있습니다. */
    if (!added && !removed) return '';
    const bits = [];
    if (added) bits.push(`${added}개 추가`);
    if (removed) bits.push(`${removed}개 빼기`);
    return `<button class="picker-confirm" data-act="commit-parts">${bits.join(' · ')}</button>`;
  }

  function renderPartTiles(s) {
    const staged = stagedParts(s);
    return PARTS.map(p => {
      const on = staged.includes(p.id);
      const count = p.kind === 'weight' ? s.exercises.filter(e => e.part === p.id).length : 0;
      const isNew = on && !s.parts.includes(p.id);
      const sub = isNew ? '추가 예정'
        : on ? (p.kind === 'weight' ? `${count}개 운동` : '기록 중')
        : '탭하여 추가';
      return `<button class="part-tile${on?' on':''}" style="--pt-color:${p.color}" data-act="toggle-part" data-part="${p.id}">
        <span class="pt-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="pt-icon">${PART_ICONS[p.id]||''}</span>
        <span class="pt-name">${p.label}</span>
        <span class="pt-count">${sub}</span>
      </button>`;
    }).join('');
  }

  /* 부위를 고른 뒤의 축약형. 칩을 누르면 그 부위 자리로 스크롤합니다 —
     칩 줄이 자리를 아끼는 동시에 긴 목록의 목차 노릇을 합니다. 부위를
     더하거나 빼는 건 '＋ 부위' 시트에서만 되도록 갈라 놨습니다. 여기서
     탭이 '이동' 과 '해제' 두 가지 뜻을 가지면, 다음 운동을 보려고 누른
     손끝이 그 부위를 통째로 지워 버릴 수 있습니다. */
  function renderPartChips(s, ids) {
    const chips = ids.map(id => {
      const p = PARTS.find(x => x.id === id);
      if (!p) return '';
      const n = p.kind === 'weight' ? s.exercises.filter(e => e.part === id).length : 0;
      return `<button class="pchip" style="--pc:${p.color}" data-act="jump-part" data-part="${esc(id)}">
        <i></i>${esc(p.label)}${n ? `<b>${n}</b>` : ''}
      </button>`;
    }).join('');
    return `<div class="pchip-row">${chips}
      <button class="pchip add" data-act="open-part-sheet">＋ 부위</button>
    </div>`;
  }

  function renderPartSheet() {
    const s = state.session;
    if (!s) return '';
    return `<div class="sheet-backdrop${overlayIn('part')}">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div><div class="sheet-title">부위 선택</div><div class="sheet-title-sub">고른 부위가 기록 화면에 나타납니다</div></div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="part-grid">${renderPartTiles(s)}</div>
        <div style="margin-top:14px">${renderPartConfirm(s)}</div>
        <button class="btn-ghost" style="margin-top:10px" data-act="open-routines">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
          루틴 불러오기${state.routines.length ? ` (${state.routines.length})` : ''}
        </button>
      </div>
    </div>`;
  }

  /* ── Workout Tab ──────────────────────────── */
  function renderWorkout() {
    const s = state.session;
    if (!s) return `<header class="topbar"><div class="topbar-title">기록</div></header>
      <main class="screen${navDir ? ' nav-' + navDir : ''}"><div class="empty-state"><div class="empty-icon">🏋️</div>오늘의 운동을 시작하세요</div>
      <button class="btn-hero" data-act="today">오늘 기록 시작하기</button></main>`;

    /* 부위 선택기는 두 얼굴을 갖습니다.

       아직 아무 부위도 안 고른 날에는 이게 이 화면의 유일한 할 일이므로
       8칸 그리드를 그대로 펼쳐 둡니다. 하지만 하나라도 고르고 나면 그때부터
       이건 '이미 끝난 결정' 입니다 — 그런데도 210px 짜리 두 줄이 화면 맨
       위에 계속 남아, 운동하는 내내 스크롤을 위로 올릴 때마다 첫 화면의
       4분의 1을 차지했습니다. 그래서 고른 뒤에는 34px 짜리 칩 한 줄로
       접고, 부위를 더하거나 빼는 일은 '＋ 부위' 로 여는 시트에 맡깁니다. */
    const chosenIds = orderedParts(sessionPartIds(s)).map(p => p.id);
    const partPicker = chosenIds.length
      ? renderPartChips(s, chosenIds)
      : `<div class="sec-head" style="margin-top:18px">
           <div class="sec-title">부위 선택</div>
           <button class="routine-btn" data-act="open-routines">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
             루틴${state.routines.length ? ` ${state.routines.length}` : ''}
           </button>
         </div>
         <div class="part-grid">${renderPartTiles(s)}</div>
         <div style="margin-top:12px">${renderPartConfirm(s)}</div>`;

    let blocks = '';

    if (s.parts.includes('run')) {
      blocks += `<div class="run-card" id="part-run">
        <div class="run-card-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="5" r="2"/><path d="M13 8l-3 3 2 2 1 5M12 13l-2 2-5-1M15 10l2-1 3 2 1-1"/></svg>
          러닝
        </div>
        <div class="run-fields">
          <div>
            <label>거리</label>
            <div class="run-input-wrap">
              <input class="run-input" data-run="km" inputmode="decimal" value="${esc(s.run.km)}" placeholder="0">
              <span class="run-unit">km</span>
            </div>
          </div>
          <div>
            <label>시간</label>
            <div class="run-input-wrap">
              <input class="run-input" data-run="minutes" inputmode="decimal" value="${esc(s.run.minutes)}" placeholder="0">
              <span class="run-unit">분</span>
            </div>
          </div>
        </div>
      </div>`;
    }

    const shown = sessionPartIds(s);
    for (const part of PARTS) {
      if (part.kind !== 'weight') continue;
      if (!shown.includes(part.id)) continue;
      const exercises = s.exercises.filter(e => e.part === part.id);
      const pdone = exercises.reduce((a, e) => a + (e.sets||[]).filter(st => st.done).length, 0);
      const ptotal = exercises.reduce((a, e) => a + (e.sets||[]).length, 0);
      /* 부위 제목은 스크롤을 따라 위에 붙습니다(.part-head). 목록 한가운데
         에서 "지금 보는 게 가슴인가 등인가" 를 다시 찾아 올라갈 일이
         없어집니다. 세트 진행도 같이 붙여 두면, 붙어 있는 그 한 줄이
         '이 부위는 얼마나 남았나' 까지 답합니다. */
      blocks += `<div class="sec-head part-head" id="part-${part.id}">
        <div class="sec-title part-title" style="--pc:${part.color}">${part.label}</div>
        ${ptotal ? `<span class="part-head-prog">${pdone}/${ptotal}</span>` : ''}
        <button class="btn-add-sm" data-act="open-picker" data-part="${part.id}">+ 운동 추가</button>
      </div>`;
      if (exercises.length) {
        blocks += exercises.map(ex => renderExerciseCard(ex)).join('');
      } else {
        blocks += `<button class="add-ex-cta" data-act="open-picker" data-part="${part.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          ${part.label} 운동 추가하기
        </button>`;
      }
    }

    if (!shown.length) {
      blocks = `<div class="pick-prompt">
        <div class="pick-prompt-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5h11M6.5 17.5h11M4 9.5v5M20 9.5v5M9 12h6"/></svg>
        </div>
        <div class="pick-prompt-title">오늘은 어디를 단련할까요?</div>
        <div class="pick-prompt-sub">위에서 부위를 선택하면<br>운동을 기록할 수 있어요.</div>
      </div>`;
    }

    const isToday = s.date === todayISO();
    const stats = sessionStats(s);
    const pct = stats.total ? Math.round(stats.done / stats.total * 100) : 0;
    const runKm = Number(s.run.km);
    const showSummary = stats.total > 0 || hasRunData(s.run);

    const summary = showSummary ? `
      <div class="sum-card">
        <div class="sum-grid">
          <div class="sum-item">
            <div class="sum-val">${stats.done}<span>/${stats.total}</span></div>
            <div class="sum-lbl">완료 세트</div>
          </div>
          ${(s.exercises || []).length ? `
          <div class="sum-item">
            <div class="sum-val">${(s.exercises || []).length}<span>개</span></div>
            <div class="sum-lbl">운동</div>
          </div>` : ''}
          ${hasRunData(s.run) ? `
          <div class="sum-item">
            <div class="sum-val">${Number.isFinite(runKm)&&runKm?runKm:'-'}<span>km</span></div>
            <div class="sum-lbl">러닝</div>
          </div>` : ''}
        </div>
        ${stats.total ? `<div class="sum-bar"><div class="sum-bar-fill" style="width:${pct}%"></div></div>` : ''}
      </div>` : '';

    /* The save button people asked for.
       Every edit is already written to storage the moment it happens, so this
       is not what makes the data durable — but "언제 저장된 거지?" is a real
       question with no answer on a screen that only ever autosaves silently.
       So the button marks the session finished and hands back a summary, and
       the line under it states plainly that nothing was waiting to be saved.
       Framing it as 마치기 rather than 저장 keeps that honest: pressing it is
       about closing the workout, not rescuing unsaved work. */
    /* Rendered even when there is nothing yet, and hidden with a class instead.

       Typing in the 러닝 fields writes to state and saves, but deliberately does
       NOT re-render — a re-render mid-keystroke drops focus and closes the
       keyboard. That meant a running-only day never got its 운동 마치기 button:
       the bar was decided at render time and nothing rendered again. Keeping the
       bar in the DOM lets paintFinishBar() reveal it without a re-render. */
    const anything = sessionHasAnything(s);
    const finishBar = (s.completed ? `
      <div class="finish-bar done">
        <div class="finish-msg">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>${esc(relDayLabel(s.date))} 운동을 마쳤습니다</span>
        </div>
        <div class="finish-actions">
          <button class="btn-ghost" data-act="open-summary" data-date="${esc(s.date)}">기록 보기</button>
          <button class="btn-ghost" data-act="reopen-day">다시 열기</button>
        </div>
      </div>` : `
      <div class="finish-bar${anything ? '' : ' is-empty'}">
        <button class="btn-hero" data-act="finish-day">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          운동 마치기
        </button>
        <p class="finish-note">입력하는 즉시 저장되니 도중에 나가도 사라지지 않아요.</p>
      </div>`);

    return `
      <header class="topbar">
        <button class="btn-icon ghost" data-act="go-tab" data-tab="home" aria-label="홈으로">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">운동 기록</div>
        <div class="topbar-spacer"></div>
        ${isToday ? '' : `<button class="btn-today" data-act="today">오늘로</button>`}
      </header>
      <main class="screen${navDir ? ' nav-' + navDir : ''}">
        <div class="day-nav">
          <button class="day-nav-arrow" data-act="shift-day" data-delta="-1" aria-label="이전 날">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <label class="day-nav-mid">
            <div class="day-nav-date">${esc(longDate(s.date))}</div>
            <div class="day-nav-rel">${esc(relDayLabel(s.date))}</div>
            <input type="date" data-act="change-date" value="${esc(s.date)}" max="${todayISO()}" aria-label="날짜 선택">
          </label>
          <button class="day-nav-arrow" data-act="shift-day" data-delta="1" aria-label="다음 날"${isToday?' disabled':''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        ${summary}
        ${partPicker}

        ${blocks}
        ${finishBar}
        ${state.editingPast ? `
        <div class="pastsave-bar${state.pastDirty ? '' : ' is-clean'}">
          <div class="pastsave-msg">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>저장하지 않은 변경이 있습니다</span>
          </div>
          <div class="pastsave-actions">
            <button class="btn-ghost" data-act="cancel-past">취소</button>
            <button class="btn-hero" data-act="save-past">저장</button>
          </div>
        </div>` : ''}
        ${sessionHasAnything(s) ? `
        <button class="day-wipe" data-act="delete-day">이 날 기록 전체 삭제</button>` : ''}
      </main>`;
  }

  /* ── Day summary ──────────────────────────────────────────────────────────
     A read-only "what did I actually do" view, opened by tapping a day card.
     The editing screen answers "what am I doing next" — it is full of inputs,
     pickers and part tiles, which is the wrong shape for looking back at a
     finished session. This one has no controls at all: every set is laid out as
     a chip so a whole workout reads in one glance. */
  function findDay(date) {
    return state.sessions.find(x => x.date === date)
        || (state.session && state.session.date === date ? state.session : null);
  }

  /* 하루치 기록의 '내용'만 만듭니다. 전체 화면으로 띄울 때와 히스토리 달력
     아래에 끼워 넣을 때가 똑같은 내용을 써야 하므로, 껍데기(상단바 등)와
     분리해 둡니다. */
  function daySummaryBody(s) {
    const stats = sessionStats(s);
    const runKm = Number(s.run?.km);
    const runMin = Number(s.run?.minutes);
    const done = !!s.completed;

    const byPart = PARTS.filter(p => p.kind === 'weight').map(part => {
      const list = (s.exercises || []).filter(e => e.part === part.id);
      if (!list.length) return '';
      return `<div class="dsum-part">
        <div class="dsum-part-head">
          <span class="dsum-dot" style="background:${part.color}"></span>${part.label}
          <span class="dsum-part-count">${list.length}개 운동</span>
        </div>
        ${list.map(ex => {
          let workingNo = 0;
          const hold = isHoldExercise(ex);
          const chips = (ex.sets || []).map(set => {
            const warm = !!set.warmup;
            if (!warm) workingNo++;
            const kg = (set.kg !== '' && set.kg != null) ? toDisplayWeight(set.kg) : '–';
            const reps = (set.reps !== '' && set.reps != null) ? set.reps : '–';
            /* A held stretch carries no weight, so "–kg × 30" would be noise
               around the only number that means anything: the seconds. */
            const val = hold
              ? `${esc(String(reps))}<i>초</i>`
              : `${esc(String(kg))}<i>${weightUnitLabel()}</i> × ${esc(String(reps))}`;
            return `<span class="dsum-set${warm ? ' warm' : ''}${set.done ? ' done' : ''}">
              <b>${warm ? 'W' : workingNo}</b>${val}
            </span>`;
          }).join('');
          const p = exProgress(ex);
          return `<div class="dsum-ex">
            <div class="dsum-ex-head">
              <span class="dsum-ex-name">${esc(ex.name)}</span>
              <span class="dsum-ex-meta">${p.done}/${p.total} 세트</span>
            </div>
            <div class="dsum-sets">${chips || '<span class="dsum-empty">기록된 세트가 없습니다</span>'}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');

    const runBlock = hasRunData(s.run) ? `<div class="dsum-part">
      <div class="dsum-part-head"><span class="dsum-dot" style="background:${PARTS.find(p=>p.id==='run').color}"></span>러닝</div>
      <div class="dsum-ex"><div class="dsum-sets">
        ${Number.isFinite(runKm) && runKm ? `<span class="dsum-set">${runKm}<i>km</i></span>` : ''}
        ${Number.isFinite(runMin) && runMin ? `<span class="dsum-set">${runMin}<i>분</i></span>` : ''}
      </div></div>
    </div>` : '';

    const body = (byPart + runBlock) || `<div class="empty-state" style="margin-top:30px">이 날은 기록된 운동이 없습니다.</div>`;

    return `
        <div class="dsum-hero${done ? ' done' : ''}">
          <div class="dsum-badge">
            ${done ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>운동 완료`
                   : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>진행 중`}
          </div>
          <div class="dsum-parts">${orderedParts(sessionPartIds(s)).map(p =>
            `<span class="muscle-tag part" style="--pc:${p.color}">${p.label}</span>`
          ).join('')}</div>
          <div class="dsum-stats">
            <div><b>${(s.exercises || []).length}</b><span>운동</span></div>
            <div><b>${stats.done}</b><span>완료 세트</span></div>
            ${hasRunData(s.run) && Number.isFinite(runKm) && runKm ? `<div><b>${runKm}</b><span>km</span></div>` : ''}
          </div>
        </div>
        ${body}
        ${(() => {
          /* 총 운동 시간(첫 세트~마지막 세트)은 표시하지 않습니다 — 세트를
             몰아서 나중에 한꺼번에 체크하거나, 중간에 딴짓을 하다 돌아오면
             실제와 크게 어긋나는데 그걸 구분할 방법이 없습니다. 세트 사이
             '보통' 휴식(중앙값)은 그런 이상치 하나에 흔들리지 않아 남겨
             둡니다. */
          const t = sessionTiming(s);
          return t && t.rest ? `<p class="dsum-timing">세트 사이 보통 ${esc(fmtDur(t.rest))} 쉬었어요</p>` : '';
        })()}
        <button class="btn-ghost dsum-edit" data-act="edit-day" data-date="${esc(s.date)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          이 날 기록 편집하기
        </button>`;
  }

  /* 홈이나 기록 화면에서 열 때 쓰는 전체 화면판. */
  function renderDaySummary(date) {
    const s = findDay(date);
    if (!s) return '';
    return `<div class="detail-screen${overlayIn(`day:${date}`)}">
      <header class="topbar">
        <button class="btn-icon ghost" data-act="close-summary" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">${esc(longDate(s.date))}</div>
        <div class="topbar-spacer"></div>
      </header>
      <main class="screen">
        ${daySummaryBody(s)}
        <div style="height:20px"></div>
      </main>
    </div>`;
  }

  /* 접힌 카드에 남길 한 줄 — 그날 이 운동에서 가장 무겁게 든 완료 세트.
     "4/4 세트" 만 남으면 무엇을 했는지가 사라집니다. 평균이 아니라 최고
     세트를 쓰는 이유는, 다음에 이 운동을 볼 때 기준이 되는 숫자가 그거라서
     입니다. 웜업은 뺍니다 — 오늘의 성과가 아닙니다. */
  function topSetLine(ex) {
    const done = (ex.sets || []).filter(s => s.done && !s.warmup);
    if (!done.length) return '';
    if (isHoldExercise(ex)) {
      const best = Math.max(...done.map(s => Number(s.reps) || 0), 0);
      return best ? `${best}초` : '';
    }
    let best = null;
    for (const s of done) {
      const kg = Number(s.kg), reps = Number(s.reps);
      if (!Number.isFinite(kg) || !Number.isFinite(reps) || !kg) continue;
      if (!best || kg > best.kg) best = { kg, reps };
    }
    return best ? `${toDisplayWeight(best.kg)}${weightUnitLabel()} × ${best.reps}` : '';
  }

  /* 이 운동이 기본으로 펼쳐져 있어야 하는지. 다 끝낸 운동은 접습니다 —
     끝난 일이 남은 일과 같은 자리를 차지할 이유가 없습니다. 사용자가 직접
     펼치거나 접은 적이 있으면(expandedExercises 에 값이 있으면) 그 선택이
     항상 이깁니다. */
  function exDefaultExpanded(ex) {
    const p = exProgress(ex);
    return !(p.total > 0 && p.done === p.total);
  }
  function exIsExpanded(ex) {
    const v = state.expandedExercises[ex.id];
    if (v !== undefined) return v;              /* 직접 접거나 편 적이 있으면 그게 이깁니다 */
    if (state.justCompletedExId === ex.id) return true;  /* 접히기 직전의 유예 */
    return exDefaultExpanded(ex);
  }

  /* 마지막 세트를 채웠을 때 카드가 접히는 시점을 잠깐 미룹니다.

     체크한 손가락 밑에서 카드가 그 자리에서 접히면, 처음 겪는 사람에게는
     방금 적은 세트가 통째로 사라진 것처럼 보입니다 — 접힌 게 아니라 지워진
     걸로 읽힙니다. 그래서 ✓ 가 켜지고 테두리가 초록으로 바뀌는 걸 먼저
     보여 준 다음(0.9초), 그때 접습니다. 접히는 렌더에는 짧은 움직임을
     붙여서, 마지막으로 눈에 남는 게 '사라짐' 이 아니라 '접힘' 이 되게 합니다.

     0.9초는 세트를 끝내고 손을 떼는 데 걸리는 시간쯤입니다. 더 짧으면
     여전히 손가락 밑에서 움직이고, 더 길면 접히는 이유가 방금 그 체크
     때문이라는 게 연결되지 않습니다. */
  let foldTimer = 0;
  function scheduleAutoFold(ex) {
    clearTimeout(foldTimer);
    state.justCompletedExId = ex.id;
    foldTimer = setTimeout(() => {
      if (state.justCompletedExId !== ex.id) return;
      state.justCompletedExId = null;
      pendingFoldExIds.add(ex.id);
      render();
    }, 900);
  }
  function cancelAutoFold(exId) {
    if (state.justCompletedExId !== exId) return;
    clearTimeout(foldTimer);
    state.justCompletedExId = null;
  }

  /* ── Exercise Card ────────────────────────── */
  function renderExerciseCard(ex) {
    const libEx = findExercise(ex.id) || state.customExercises.find(e => e.id === ex.id);
    const primary = libEx?.primary || [];
    const secondary = libEx?.secondary || [];
    const allMuscles = [...primary, ...secondary];

    const muscleTags = allMuscles.map(m =>
      `<span class="muscle-tag${primary.includes(m)?' primary':''}">${esc(MUSCLE_GROUPS[m]||m)}</span>`
    ).join('');

    const prog = exProgress(ex);
    const allDone = prog.total > 0 && prog.done === prog.total;
    const isExpanded = exIsExpanded(ex);
    const hold = isHoldExercise(ex);

    /* Warm-ups are labelled W and don't consume a number, so the working sets
       still read 1, 2, 3 — which is how a lifter counts them. */
    let workingNo = 0;
    const sets = !isExpanded ? '' : ex.sets.map((set) => {
      const done = set.done;
      const warmup = !!set.warmup;
      if (!warmup) workingNo++;
      const label = warmup ? 'W' : workingNo;
      const kg   = (set.kg   !== '' && set.kg   != null) ? toDisplayWeight(set.kg) : '--';
      const reps = (set.reps !== '' && set.reps != null) ? set.reps : '--';
      const enter = pendingEnterSetIds.has(set.id) ? ' enter' : '';
      /* .set-swipe 가 실제 목록 항목의 경계입니다 — 왼쪽으로 밀면 뒤에 깔린
         빨간 삭제 버튼이 드러납니다. 원래 있던 작은 X 버튼은 없앴습니다 —
         이제 지우는 길은 스와이프 하나뿐입니다. */
      /* 등장 애니메이션은 .set-row 가 아니라 이 바깥 상자에 붙입니다.
         .set-row 는 뒤에 깔린 빨간 '삭제' 버튼을 덮어 가리는 뚜껑인데,
         거기에 opacity 0 → 1 을 걸면 뚜껑이 투명한 동안 빨간 버튼이 그대로
         비쳐 보입니다. 세트를 추가할 때마다 완료 버튼 자리에 빨간 것이
         번쩍이던 것이 이것이었습니다. */
      return `<div class="set-swipe${enter}" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
        <button class="set-swipe-action" data-act="del-set" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="세트 삭제">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          <span>삭제</span>
        </button>
        <div class="set-row${done?' done':''}${warmup?' warmup':''}${hold?' hold':''}" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
        <button class="set-num${warmup?' warmup':''}" data-act="toggle-warmup" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="웜업 세트로 전환" title="탭하면 웜업/일반 세트 전환">${label}</button>
        ${hold ? '' : `<button class="val-chip${done?' done':''}" data-act="open-weight" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${kg}</span>
          <span class="val-chip-unit">${weightUnitLabel()}</span>
        </button>`}
        <button class="val-chip${done?' done':''}" data-act="open-reps" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${reps}</span>
          <span class="val-chip-unit">${hold ? '초' : '회'}</span>
        </button>
        <button class="done-toggle${done?' done':''}" data-act="toggle-done" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="세트 완료">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        </div>
      </div>`;
    }).join('');

    /* 접었을 때는 근육 태그 대신 "무엇을 했는지" 한 줄이 옵니다. 접힌 카드가
       차지하는 두 줄은 '이 운동은 끝났다' 와 '얼마로 끝냈다' 에 쓰는 게
       맞습니다 — 무슨 근육을 쓰는지는 지금 할 일이 아닙니다. */
    const metaBits = [];
    if (prog.total) metaBits.push(`${prog.done}/${prog.total} 세트`);
    if (!isExpanded) { const t = topSetLine(ex); if (t) metaBits.push(t); }
    const exEnter = pendingEnterExIds.has(ex.id) ? ' enter' : '';
    const exFold  = pendingFoldExIds.has(ex.id) ? ' just-folded' : '';

    return `<article class="ex-card${allDone?' all-done':''}${exEnter}${exFold}${isExpanded?' expanded':''}" data-exid="${esc(ex.id)}">
      <div class="ex-card-head">
        <button class="ex-card-toggle" data-act="toggle-ex-accordion" data-ex="${esc(ex.id)}" aria-expanded="${isExpanded}">
          <span class="ex-card-chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
          <div class="ex-card-titles">
            <div class="ex-card-name">${allDone?'<span class="ex-done-tick"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>':''}${esc(ex.name)}</div>
            ${(isExpanded && muscleTags) ? `<div class="ex-card-sub">${muscleTags}</div>` : ''}
            ${metaBits.length ? `<div class="ex-card-meta">${esc(metaBits.join(' · '))}</div>` : ''}
          </div>
        </button>
        <button class="btn-icon ghost" data-act="show-ex-info" data-exid="${esc(ex.id)}" data-exname="${esc(ex.name)}" aria-label="${esc(ex.name)} 운동 정보">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <button class="btn-icon ghost danger" data-act="del-ex" data-ex="${esc(ex.id)}" aria-label="${esc(ex.name)} 삭제">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${isExpanded ? `
      <div class="set-table">
        <div class="set-table-head${hold ? ' hold' : ''}"><span>#</span>${hold ? '' : '<span>무게</span>'}<span>${hold ? '시간' : '횟수'}</span><span>완료</span></div>
        ${sets}
        <button class="add-set-row" data-act="add-set" data-ex="${esc(ex.id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          세트 추가
        </button>
      </div>` : ''}
    </article>`;
  }

  /* ── Weight Picker Sheet ──────────────────── */
  function renderWeightPickerSheet() {
    const p = state.weightPicker;
    const display = pickerDisplay(p);
    const numCls = `picker-big-num${p.str === '' ? ' is-empty' : ''}${p.fresh ? ' is-fresh' : ''}`;
    const ex = state.session?.exercises.find(x => x.id === state.weightPicker.exId);
    const sub = ex ? `${ex.name} · ${setLabelFor(ex, state.weightPicker.setId)}` : '';
    const numpadRows = [['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']];
    const numpad = numpadRows.map(row =>
      `<div class="numpad-row">${row.map(k => {
        const act = k==='⌫' ? 'numpad-w-back' : k==='.' ? 'numpad-w-dot' : 'numpad-w-digit';
        const cls = k==='⌫' ? 'numpad-key back' : 'numpad-key';
        return `<button class="${cls}" data-act="${act}" data-d="${k}">${k}</button>`;
      }).join('')}</div>`
    ).join('');
    return `<div class="sheet-backdrop${overlayIn('weight')}">
      <div class="sheet-panel" id="sheet-weight">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div><div class="sheet-title">무게</div>${sub?`<div class="sheet-title-sub">${esc(sub)}</div>`:''}</div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <button class="picker-big" data-act="numpad-w-clear" aria-label="입력한 무게 지우기">
          <div class="${numCls}">${esc(display)}</div>
          <div class="picker-big-unit">${weightUnitLabel()}</div>
        </button>
        ${adjRow('numpad-w-adj', weightStepValues())}
        <div class="numpad">${numpad}</div>
        <button class="picker-confirm" data-act="confirm-weight">확인</button>
      </div>
    </div>`;
  }

  /* ── Reps Picker Sheet ────────────────────── */
  function renderRepsPickerSheet() {
    const p = state.repsPicker;
    const display = pickerDisplay(p);
    const numCls = `picker-big-num${p.str === '' ? ' is-empty' : ''}${p.fresh ? ' is-fresh' : ''}`;
    const ex = state.session?.exercises.find(x => x.id === state.repsPicker.exId);
    const sub = ex ? `${ex.name} · ${setLabelFor(ex, state.repsPicker.setId)}` : '';
    /* A held stretch is measured in seconds, so the sheet has to say so —
       "횟수 / 회" over a 아기 자세 would be asking the wrong question. */
    const holdEx = isHoldExercise(ex);
    const numpadRows = [['7','8','9'],['4','5','6'],['1','2','3'],['C','0','⌫']];
    const numpad = numpadRows.map(row =>
      `<div class="numpad-row">${row.map(k => {
        const act = k==='⌫' ? 'numpad-r-back' : k==='C' ? 'numpad-r-clear' : 'numpad-r-digit';
        const cls = k==='⌫' ? 'numpad-key back' : k==='C' ? 'numpad-key clear' : 'numpad-key';
        return `<button class="${cls}" data-act="${act}" data-d="${k}">${k}</button>`;
      }).join('')}</div>`
    ).join('');
    return `<div class="sheet-backdrop${overlayIn('reps')}">
      <div class="sheet-panel" id="sheet-reps">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div><div class="sheet-title">${holdEx ? '시간' : '횟수'}</div>${sub?`<div class="sheet-title-sub">${esc(sub)}</div>`:''}</div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <button class="picker-big" data-act="numpad-r-clear" aria-label="${holdEx ? '입력한 시간 지우기' : '입력한 횟수 지우기'}">
          <div class="${numCls}">${esc(display)}</div>
          <div class="picker-big-unit">${holdEx ? '초' : '회'}</div>
        </button>
        ${adjRow('numpad-r-adj', holdEx ? HOLD_STEPS : REPS_STEPS)}
        <div class="numpad">${numpad}</div>
        <button class="picker-confirm" data-act="confirm-reps">확인</button>
      </div>
    </div>`;
  }

  /* ── Exercise Info Sheet ──────────────────── */
  /* ── 근육 지도 ────────────────────────────────────────────────────────────
     운동마다 어느 근육을 쓰는지는 exercises.js 의 primary/secondary 에 이미
     적혀 있습니다. 그동안 그 값을 글자로만 보여 줬는데("가슴, 삼두근"),
     초보자에게 그건 몸의 어디인지 알려 주지 않습니다. 같은 데이터로 사람
     그림에 색을 칠하면 한눈에 들어옵니다 — 새 그림 파일 없이 이 함수 하나로,
     운동 98개 전부와 앞으로 추가할 운동까지 자동으로 됩니다.

     드물게 쓰이는 세부 근육(소흉근·능형근 등)은 그릴 칸이 따로 없어서 가장
     가까운 큰 부위로 접어 넣습니다. 안 그러면 그 운동만 아무 데도 칠해지지
     않아 고장난 것처럼 보입니다. */
  const MUSCLE_REGION = {
    pecs_minor: 'chest',   chest_wall: 'back',    rhomboids: 'back',
    levator:    'traps',   quads_rf:   'quads',   hip_flexor: 'quads',
    adductors:  'quads',
  };

  function renderBodyMap(primary, secondary) {
    const P = new Set(), S = new Set();
    (primary   || []).forEach(m => P.add(MUSCLE_REGION[m] || m));
    (secondary || []).forEach(m => { const r = MUSCLE_REGION[m] || m; if (!P.has(r)) S.add(r); });
    const cls = m => P.has(m) ? ' p' : S.has(m) ? ' s' : '';
    const r = (m, d, o) => `<path class="bm${cls(m)}" d="${d}"${o ? ' opacity=".5"' : ''}/>`;
    const n = d => `<path class="bm-n" d="${d}"/>`;

    /* 앞면 */
    const front = `
      <ellipse class="bm-n" cx="55" cy="16" rx="10" ry="12.5"/>
      ${n('M49 27q6 2 12 0l1 8H48z')}
      ${r('traps',     'M46 35q9 2 18 0l6 9q-15-3-30 0z')}
      ${r('shoulders', 'M40 43q-11 2-14 15 -1 5 3 6l9-3q0-11 2-18z')}
      ${r('shoulders', 'M70 43q11 2 14 15 1 5-3 6l-9-3q0-11-2-18z')}
      ${r('chest',     'M39 45q8-2 16-1v25q-11-1-17-8 -2-9 1-16z')}
      ${r('chest',     'M71 45q-8-2-16-1v25q11-1 17-8 2-9-1-16z')}
      ${r('biceps',    'M29 64l8-3 -1 25q-5 2-9 0z')}
      ${r('biceps',    'M81 64l-8-3 1 25q5 2 9 0z')}
      ${n('M27 88q5 2 9 0l-2 27q-4 2-7 0z')}
      ${n('M83 88q-5 2-9 0l2 27q4 2 7 0z')}
      ${r('abs',       'M42 69q13 3 26 0l-4 39q-9 3-18 0z')}
      ${n('M45 110q10 3 20 0l2 20q-12 3-24 0z')}
      ${r('quads',     'M43 131q6 2 11 1l-1 46q-6 2-11 0z')}
      ${r('quads',     'M67 131q-6 2-11 1l1 46q6 2 11 0z')}
      ${n('M42 180q6 2 11 0v7q-6 2-11 0z')}
      ${n('M68 180q-6 2-11 0v7q6 2 11 0z')}
      ${r('calves',    'M43 189q5 2 10 0l-2 33q-4 2-8 0z')}
      ${r('calves',    'M67 189q-5 2-10 0l2 33q4 2 8 0z')}
      ${n('M43 224q4 2 8 0l1 8H42z')}
      ${n('M67 224q-4 2-8 0l-1 8h10z')}`;

    /* 뒷면 */
    const back = `
      <ellipse class="bm-n" cx="55" cy="16" rx="10" ry="12.5"/>
      ${n('M49 27q6 2 12 0l1 8H48z')}
      ${r('traps',      'M46 32q9 3 18 0l6 11q-4 18-15 24 -11-6-15-24z')}
      ${r('shoulders',  'M40 43q-11 2-14 15 -1 5 3 6l9-3q0-11 2-18z')}
      ${r('shoulders',  'M70 43q11 2 14 15 1 5-3 6l-9-3q0-11-2-18z')}
      ${r('triceps',    'M29 64l8-3 -1 25q-5 2-9 0z')}
      ${r('triceps',    'M81 64l-8-3 1 25q5 2 9 0z')}
      ${n('M27 88q5 2 9 0l-2 27q-4 2-7 0z')}
      ${n('M83 88q-5 2-9 0l2 27q4 2 7 0z')}
      ${r('lats',       'M42 58q7 4 13 6v28q-10-3-16-11 -1-13 3-23z')}
      ${r('lats',       'M68 58q-7 4-13 6v28q10-3 16-11 1-13-3-23z')}
      ${r('back',       'M46 60q9 3 18 0v32q-9 2-18 0z')}
      ${r('lower_back', 'M44 94q11 3 22 0l-1 16q-10 3-20 0z')}
      ${r('glutes',     'M43 112q12 3 24 0l1 20q-13 3-26 0z')}
      ${r('hamstrings', 'M43 134q6 2 11 1l-1 44q-6 2-11 0z')}
      ${r('hamstrings', 'M67 134q-6 2-11 1l1 44q6 2 11 0z')}
      ${n('M42 180q6 2 11 0v7q-6 2-11 0z')}
      ${n('M68 180q-6 2-11 0v7q6 2 11 0z')}
      ${r('calves',     'M43 189q5 2 10 0l-2 33q-4 2-8 0z')}
      ${r('calves',     'M67 189q-5 2-10 0l2 33q4 2 8 0z')}
      ${n('M43 224q4 2 8 0l1 8H42z')}
      ${n('M67 224q-4 2-8 0l-1 8h10z')}`;

    return `<div class="bodymap">
      <figure><svg viewBox="0 0 110 236" role="img" aria-label="앞에서 본 사용 근육">${front}</svg><figcaption>앞</figcaption></figure>
      <figure><svg viewBox="0 0 110 236" role="img" aria-label="뒤에서 본 사용 근육">${back}</svg><figcaption>뒤</figcaption></figure>
    </div>`;
  }

  function renderExerciseInfoSheet(exId) {
    const libEx = findExercise(exId) || state.customExercises.find(e => e.id === exId || e.name === exId);
    if (!libEx) return '';

    const primary   = libEx.primary || [];
    const secondary = libEx.secondary || [];
    const diffStars = '★'.repeat(libEx.difficulty||1) + '☆'.repeat(3-(libEx.difficulty||1));
    const eq = EQUIPMENT_LABEL[libEx.equipment] || libEx.equipment || '기타';

    const primaryPills   = primary.map(m => `<span class="muscle-pill primary"><span class="muscle-pill-dot"></span>${esc(MUSCLE_GROUPS[m]||m)}</span>`).join('');
    const secondaryPills = secondary.map(m => `<span class="muscle-pill secondary"><span class="muscle-pill-dot"></span>${esc(MUSCLE_GROUPS[m]||m)}</span>`).join('');

    const tips = (libEx.tips||[]).map((tip,i)=>`
      <li><div class="tip-num">${i+1}</div><span>${esc(tip)}</span></li>`).join('');

    /* Three drawings of the same body moving through the lift, stepped on a
       loop. Two photographs alternating read as "the picture changed"; three
       frames of one figure read as movement, which is the whole point of
       showing a picture here. A single frame just sits still — right for a
       held stretch.

       세 장 다 곧바로 받습니다(lazy 아님). 2·3번은 시작할 때 투명한데,
       게을리 받게 두면 자기 차례가 왔을 때 아직 도착하지 않아 한 번 비어
       보입니다. 어차피 이 시트를 열 때만 만들어지는 태그라 미리 받아도
       손해가 없습니다. */
    const media = (typeof EXERCISE_MEDIA !== 'undefined' && libEx.id) ? EXERCISE_MEDIA[libEx.id] : null;
    const photo = media
      ? `<div class="ex-photo f${media.n}">
           ${Array.from({ length: media.n }, (_, i) =>
             `<img class="ex-photo-img" src="./media/${esc(libEx.id)}-${i + 1}.${esc(media.t)}"
                   alt="${esc(libEx.name)} 동작 ${i + 1}" decoding="sync">`).join('')}
         </div>`
      /* 그림이 아직 없는 운동(머신 라이브러리)은 빈 자리를 그냥 두지 않고
         한 줄로 말해 줍니다. 아무 말도 없으면 "왜 이것만 그림이 없지 —
         고장인가" 가 되고, 그 질문에 답할 방법이 화면에 없습니다. */
      : `<p class="ex-photo-none">동작 그림은 준비 중입니다. 아래 근육 지도와 팁을 참고하세요.</p>`;

    return `<div class="sheet-backdrop${overlayIn(`info:${exId}`)}">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div class="info-hero">
            <div class="info-name">${esc(libEx.name)}</div>
            ${libEx.nameEn ? `<div class="info-name-en">${esc(libEx.nameEn)}</div>` : ''}
          </div>
          <button class="sheet-x" data-act="close-info" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="info-meta" style="margin-top:0;margin-bottom:16px">
          <span class="info-badge eq">${esc(eq)}</span>
          <span class="info-badge"><span class="diff-stars">${diffStars}</span></span>
        </div>
        ${photo}
        <div class="muscle-legend">
          ${renderBodyMap(primary, secondary)}
          <div class="muscle-legend-text">
            <div class="muscle-legend-title">주동근</div>
            <div class="muscle-legend-row">${primaryPills}</div>
            ${secondary.length ? `<div class="muscle-legend-title" style="margin-top:8px">협력근</div><div class="muscle-legend-row">${secondaryPills}</div>` : ''}
          </div>
        </div>
        ${renderExerciseTrend(libEx.name)}
        <button class="btn-ghost" data-act="open-ex-history" data-name="${esc(libEx.name)}" style="margin-bottom:14px">
          전체 기록 보기
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        ${libEx.description ? `<p class="info-desc">${esc(libEx.description)}</p>` : ''}
        ${tips ? `<div class="sec-title" style="margin-bottom:10px">수행 팁</div><ul class="tips-list">${tips}</ul>` : ''}
      </div>
    </div>`;
  }

  /* ── Exercise pick items (shared by sheet + live search) ──
     Tapping a row toggles it in state.pickSelection instead of adding it
     immediately, so several exercises can be queued and committed in one go
     with the 완료 button. Rows already in today's session show as 추가됨. */
  function buildPickItems(partId) {
    /* '추가됨' 표시는 지금 담고 있는 대상 기준입니다 — 루틴을 만드는 중이면
       그 루틴, 아니면 오늘 기록. */
    const target = state.routineEdit ? state.routineEdit.exercises : (state.session?.exercises || []);
    const added = new Set(target.filter(e => e.part === partId).map(e => e.name));
    const q = state.exerciseSearch.trim().toLowerCase();
    let library = libraryFor(partId).filter(e => !q || e.name.toLowerCase().includes(q) || (e.nameEn||'').toLowerCase().includes(q));
    if (!library.length) return '<div class="help-text">검색 결과가 없습니다. 아래에서 직접 추가할 수 있습니다.</div>';
    /* 즐겨찾기를 맨 위로 — 같은 그룹(즐겨찾기/일반) 안에서는 원래 순서
       그대로 두는 안정 정렬입니다. */
    const favs = favoriteIds();
    if (favs.length) {
      library = library.map((item, i) => ({ item, i, fav: item.id && favs.includes(item.id) }))
        .sort((a, b) => (b.fav - a.fav) || (a.i - b.i))
        .map(x => x.item);
    }
    return library.map(item => {
      /* Three visual states, kept distinct so the footer count always matches
         what looks selected: already in today's session (muted, "빼기"),
         newly picked (bright check), and untouched. */
      const inSession = added.has(item.name);
      const picked = state.pickSelection.some(x => x.name === item.name);
      const eq = EQUIPMENT_LABEL[item.equipment] || '';
      const fav = item.id && isFavoriteEx(item.id);
      return `<div class="pick-item${inSession ? ' added' : picked ? ' on' : ''}">
        ${item.id ? `<button class="pick-fav${fav?' on':''}" data-act="toggle-fav" data-exid="${esc(item.id)}" aria-label="${esc(item.name)} 즐겨찾기 ${fav?'해제':'추가'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="${fav?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>` : ''}
        <button class="pick-item-name" data-act="toggle-pick" data-part="${partId}" data-name="${esc(item.name)}" data-exid="${esc(item.id||'')}" ${inSession?'disabled':''}>
          <span>${esc(item.name)}</span>
          ${item.nameEn ? `<span class="pick-item-en">${esc(item.nameEn)}</span>` : ''}
        </button>
        ${eq ? `<span class="pick-item-eq">${esc(eq)}</span>` : ''}
        ${item.id ? `<button class="pick-info" data-act="show-ex-info" data-exid="${esc(item.id)}" aria-label="${esc(item.name)} 설명 보기">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>` : ''}
        ${inSession ? `<span class="pick-added-tag">추가됨</span><button class="custom-del" data-act="quick-del-ex" data-name="${esc(item.name)}" data-part="${partId}">빼기</button>` : ''}
        ${item.custom && !inSession ? `<button class="custom-del" data-act="del-custom" data-id="${esc(item.id)}">삭제</button>` : ''}
        ${inSession ? '' : `<div class="pick-check${picked?' on':''}">${picked ? CHECK_SVG : ''}</div>`}
      </div>`;
    }).join('');
  }

  /* ── Exercise Picker Sheet ────────────────── */
  /* 검색창+목록+직접추가 를 .picker-scroll 로 따로 묶어서 그 안에서만
     스크롤되게 합니다. 예전에는 이 셋이 .picker-footer(하단 "N개 운동
     추가" 버튼)와 같은 스크롤 영역(.sheet-panel) 안에 있었는데, 버튼이
     position:sticky 로 화면 하단에 붙다 보니 스크롤을 전혀 안 한
     시작 상태에서도 목록 뒤쪽 항목들과 같은 화면 위치를 다투게 되어
     버튼 밑으로 다음 운동(예: "프론트 스쿼트") 이 겹쳐 보이는
     버그가 있었습니다. 버튼을 별도 스크롤 영역 바깥의 flex 자식으로
     두면 애초에 겹칠 자리가 없습니다. */
  function renderExercisePickerSheet(partId) {
    const part = PARTS.find(p => p.id === partId);
    const n = state.pickSelection.length;
    return `<div class="sheet-backdrop${overlayIn(`pick:${partId}`)}">
      <div class="sheet-panel picker-sheet">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div>
            <div class="sheet-title">${part?part.label:''} 운동</div>
            <div class="sheet-title-sub">여러 개를 골라 한 번에 추가할 수 있어요</div>
          </div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="picker-scroll">
          <div class="search-bar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input id="picker-search" placeholder="운동 검색" value="${esc(state.exerciseSearch)}" data-act="search-ex">
          </div>
          <div class="pick-list">${buildPickItems(partId)}</div>
          <div class="custom-add-row">
            <input id="custom-name" placeholder="나만의 운동 직접 추가"
                   data-act="custom-name" value="${esc(state.customName)}">
            <button class="btn-add-sm" data-act="add-custom" data-part="${partId}">추가</button>
          </div>
        </div>
        <div class="picker-footer">
          <button class="picker-confirm${n?'':' ghost'}" data-act="commit-picks" data-part="${partId}" ${n?'':'disabled'}>
            ${n ? `${n}개 운동 추가` : '운동을 선택해 주세요'}
          </button>
        </div>
      </div>
    </div>`;
  }

  /* ── History Tab — month calendar ──────────────────────────────────────
     A month grid reads at a glance the way a list never does: which days you
     trained, how the week actually went, where the gaps are. Each trained day
     is dotted with the colours of the body parts worked; tapping one opens
     that day's record. state.histMonth is the month being viewed. */
  function shiftMonth(key, delta) {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function renderCalendar(mKey) {
    const [y, m] = mKey.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const daysInMonth = new Date(y, m, 0).getDate();
    /* 설정의 주 시작 요일을 따릅니다 — 월요일 시작이면 화요일이 1일일 때
       빈 칸이 1개(월요일 자리), 일요일 시작이면 2개(일·월 자리). */
    const lead = (first.getDay() - weekdayStartIdx() + 7) % 7;
    const today = todayISO();

    const byDate = new Map(state.sessions.map(s => [s.date, s]));
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${mKey}-${String(d).padStart(2, '0')}`;
      const s = byDate.get(iso);
      const isToday = iso === today;
      const future = iso > today;
      const dots = s ? sessionPartIds(s).slice(0, 4).map(id => {
        const p = PARTS.find(x => x.id === id);
        return p ? `<span class="cal-dot" style="background:${p.color}"></span>` : '';
      }).join('') : '';
      cells += `<button class="cal-cell${s ? ' done' : ''}${isToday ? ' today' : ''}${future ? ' future' : ''}"
        data-act="open-day" data-date="${esc(iso)}"${future ? ' disabled' : ''}>
        <span class="cal-num">${d}</span>
        <span class="cal-dots">${dots}</span>
      </button>`;
    }

    const monthSessions = state.sessions.filter(s => s.date.startsWith(mKey));
    const monthSets = monthSessions.reduce((a, s) =>
      a + (s.exercises || []).reduce((b, ex) => b + (ex.sets || []).filter(st => st.done).length, 0), 0);
    const canGoNext = shiftMonth(mKey, 1) <= monthKey(today);

    return `
      <div class="cal-card">
        <div class="cal-head">
          <button class="cal-nav" data-act="cal-shift" data-delta="-1" aria-label="이전 달">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="cal-title">${fmtMonth(mKey)}</div>
          <button class="cal-nav" data-act="cal-shift" data-delta="1" aria-label="다음 달"${canGoNext ? '' : ' disabled'}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        <div class="cal-dow">${weekdayLabelsKR().map((w, i) => {
          const real = (weekdayStartIdx() + i) % 7;
          return `<span class="${real === 0 ? 'sun' : real === 6 ? 'sat' : ''}">${w}</span>`;
        }).join('')}</div>
        <div class="cal-grid">${cells}</div>
        <div class="cal-foot">
          <span><strong>${monthSessions.length}</strong>일 운동</span>
          <span><strong>${monthSets}</strong>세트 완료</span>
        </div>
      </div>`;
  }

  /* ── 주간·월간 통계 ──────────────────────────────────────────────────────
     "얼마나 했나" 는 두 가지 서로 다른 숫자입니다 — 달린 거리(km)와 들어올린
     세트 수. 단위가 다른 둘을 한 그래프에 축 두 개로 겹치면 아무 관계나
     있어 보이게 되므로, 그래프를 둘로 나눕니다.

     부위 색은 앱에서 이미 쓰는 색 그대로입니다. 이 색들은 어두운 배경 기준
     밝기 대역 검사에서는 떨어지지만(전부 밝은 축), 정작 중요한 색맹 구분
     (ΔE 9.9)과 배경 대비는 통과합니다. 그리고 사용자는 이미 기록 카드의
     점 색으로 부위를 익혔기 때문에, 그래프에서만 다른 색을 쓰면 오히려
     알아보기 어려워집니다. 대신 색만으로 구분하지 않도록 범례·구분 간격·
     길게 눌렀을 때의 수치를 함께 넣습니다. */
  const STATS_BUCKETS = { week: 8, month: 6 };

  function statsRange() { return state.statsRange === 'month' ? 'month' : 'week'; }

  /* 설정의 주 시작 요일(월/일) 기준 그 주의 첫날 */
  function weekStart(iso) {
    return isoLocal(weekStartOf(new Date(iso + 'T00:00:00')));
  }

  function statsBuckets() {
    const mode = statsRange();
    const n = STATS_BUCKETS[mode];
    const keys = [];
    const today = new Date(todayISO() + 'T00:00:00');
    for (let i = n - 1; i >= 0; i--) {
      if (mode === 'week') {
        const d = new Date(today); d.setDate(d.getDate() - i * 7);
        keys.push(weekStart(isoLocal(d)));
      } else {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }
    const blank = () => ({ km: 0, min: 0, sets: {}, total: 0, days: 0, volume: 0 });
    const map = new Map(keys.map(k => [k, blank()]));
    for (const s of state.sessions) {
      const key = mode === 'week' ? weekStart(s.date) : monthKey(s.date);
      const b = map.get(key);
      if (!b) continue;
      let any = false;
      for (const ex of s.exercises || []) {
        const done = (ex.sets || []).filter(st => st.done).length;
        if (!done) continue;
        b.sets[ex.part] = (b.sets[ex.part] || 0) + done;
        b.total += done; any = true;
        /* 완료한 세트만 볼륨에 넣습니다. 적어만 두고 안 한 세트까지 더하면
           숫자가 실제 한 운동량보다 커집니다. */
        b.volume += (ex.sets || []).reduce((sum, st) => {
          if (!st.done || st.warmup) return sum;
          const kg = Number(st.kg), reps = Number(st.reps);
          return sum + (Number.isFinite(kg) && Number.isFinite(reps) ? kg * reps : 0);
        }, 0);
      }
      const km = Number(s.run?.km), min = Number(s.run?.minutes);
      if (Number.isFinite(km) && km) { b.km += km; any = true; }
      if (Number.isFinite(min) && min) { b.min += min; any = true; }
      if (any) b.days++;
    }
    return keys.map(k => {
      const b = map.get(k);
      const label = mode === 'week'
        ? (() => { const [, m, d] = k.split('-'); return `${Number(m)}/${Number(d)}`; })()
        : `${Number(k.split('-')[1])}월`;
      return { key: k, label, ...b };
    });
  }

  /* 세로 막대 하나. 위쪽 끝만 둥글게 깎아 바닥선에 붙어 있게 둡니다.
     i 는 왼쪽부터의 순번입니다 — 카드가 처음 그려질 때 이 순서대로 조금씩
     늦게 올라옵니다. 전부 한꺼번에 솟으면 '그래프가 그려졌다' 가 아니라
     '화면이 한 번 번쩍했다' 로 보입니다. */
  function bar(x, y, w, h, color, round, i) {
    if (h <= 0) return '';
    const r = Math.min(round || 0, w / 2, h);
    return `<path class="ch-bar" style="--i:${i || 0}" d="M${x} ${y + h} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}
      L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + h} Z"
      fill="${color}"/>`;
  }

  function renderStatsCard() {
    const mode = statsRange();
    const rows = statsBuckets();
    const anyData = rows.some(r => r.total > 0 || r.km > 0);
    const modeLabel = mode === 'week' ? '주' : '달';

    const toggle = `<div class="stats-toggle" role="tablist">
      <button role="tab" aria-selected="${mode === 'week'}" class="stats-tab${mode === 'week' ? ' on' : ''}" data-act="stats-range" data-range="week">주간</button>
      <button role="tab" aria-selected="${mode === 'month'}" class="stats-tab${mode === 'month' ? ' on' : ''}" data-act="stats-range" data-range="month">월간</button>
    </div>`;

    if (!anyData) {
      return `<div class="stats-card">
        <div class="stats-head"><div class="sec-title">운동량 추이</div>${toggle}</div>
        <p class="balance-empty">기록이 쌓이면 ${modeLabel}마다 얼마나 달렸는지, 어느 부위를 얼마나 했는지 여기에 그려 드려요.</p>
      </div>`;
    }

    const W = 320, H = 118, PAD_L = 30, PAD_B = 20, PAD_T = 8;
    const n = rows.length;
    const slot = (W - PAD_L) / n;
    const bw = Math.min(26, slot * 0.62);
    const plotH = H - PAD_B - PAD_T;

    /* ── 러닝 (한 종류라 범례가 필요 없습니다 — 제목이 곧 이름입니다) */
    const maxKm = Math.max(...rows.map(r => r.km), 1);
    const runBars = rows.map((r, i) => {
      const x = PAD_L + slot * i + (slot - bw) / 2;
      const h = r.km ? Math.max(3, (r.km / maxKm) * plotH) : 0;
      const y = PAD_T + plotH - h;
      return bar(x, y, bw, h, 'var(--run-color)', 4, i)
        + (r.km ? `<text x="${x + bw / 2}" y="${y - 4}" class="ch-val" style="--i:${i}">${r.km % 1 ? r.km.toFixed(1) : r.km}</text>` : '')
        + `<title>${r.label} · ${r.km}km${r.min ? ` · ${r.min}분` : ''}</title>`;
    }).join('');

    /* ── 부위별 세트 (쌓은 막대. 조각 사이를 2px 띄워 색이 붙어 보이지
          않게 합니다 — 밝기가 비슷한 색끼리 맞닿으면 경계가 사라집니다.) */
    const weightParts = PARTS.filter(p => p.kind === 'weight');
    const maxSets = Math.max(...rows.map(r => r.total), 1);
    const setBars = rows.map((r, i) => {
      const x = PAD_L + slot * i + (slot - bw) / 2;
      let acc = 0, out = '', first = true;
      for (const part of weightParts) {
        const v = r.sets[part.id] || 0;
        if (!v) continue;
        const h = (v / maxSets) * plotH;
        const y = PAD_T + plotH - acc - h;
        out += bar(x, y + (first ? 0 : 1), bw, Math.max(1, h - (first ? 0 : 2)), part.color, first ? 4 : 0, i);
        acc += h; first = false;
      }
      const detail = weightParts.filter(p => r.sets[p.id]).map(p => `${p.label} ${r.sets[p.id]}`).join(', ');
      return out
        + (r.total ? `<text x="${x + bw / 2}" y="${PAD_T + plotH - acc - 4}" class="ch-val" style="--i:${i}">${r.total}</text>` : '')
        + `<title>${r.label} · ${r.total}세트${detail ? ` (${detail})` : ''}</title>`;
    }).join('');

    const axis = rows.map((r, i) =>
      `<text x="${PAD_L + slot * i + slot / 2}" y="${H - 6}" class="ch-axis">${esc(r.label)}</text>`).join('');
    const yLab = v => `<text x="${PAD_L - 6}" y="${PAD_T + 4}" class="ch-axis" text-anchor="end">${v}</text>`
                    + `<text x="${PAD_L - 6}" y="${PAD_T + plotH + 4}" class="ch-axis" text-anchor="end">0</text>`;
    const base = `<line x1="${PAD_L}" y1="${PAD_T + plotH}" x2="${W}" y2="${PAD_T + plotH}" class="ch-base"/>`;

    const usedParts = weightParts.filter(p => rows.some(r => r.sets[p.id]));
    const legend = usedParts.map(p =>
      `<span class="ch-leg"><i style="background:${p.color}"></i>${esc(p.label)}</span>`).join('');

    /* 총 볼륨 그래프는 뺐습니다 — 그리던 코드도 같이 지웁니다. 남겨 두면
       화면에 없는 값을 매 렌더마다 계산하고, 다음에 이 함수를 읽는 사람이
       "이 막대는 어디에 그려지지?" 를 한참 찾게 됩니다. */

    const totKm = rows.reduce((a, r) => a + r.km, 0);
    const totSets = rows.reduce((a, r) => a + r.total, 0);
    const totDays = rows.reduce((a, r) => a + r.days, 0);

    /* 요약 줄은 운동일·세트·러닝 세 가지입니다. 볼륨은 요약에서도
       그래프에서도 뺐습니다. */
    /* 히스토리 탭에 들어온 그 렌더에서만 애니메이션이 붙습니다. 주/달을
       바꿀 때도 다시 붙는데, 그때는 그래프가 통째로 다른 데이터가 되므로
       다시 그려지는 편이 맞습니다. 시트에 쓰는 것과 같은 장치입니다 —
       안 그러면 날짜 하나만 눌러도 그래프 전체가 다시 솟아오릅니다. */
    return `<div class="stats-card${overlayIn('stats:' + mode)}">
      <div class="stats-head"><div class="sec-title">운동량 추이</div>${toggle}</div>

      <div class="stats-sum">
        <div><b>${totDays}</b><span>운동일</span></div>
        <div><b>${totSets}</b><span>세트</span></div>
        <div><b>${totKm % 1 ? totKm.toFixed(1) : totKm}</b><span>km</span></div>
      </div>

      <div class="ch-title">러닝 <span>km</span></div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 러닝 거리">
        ${base}${yLab(maxKm % 1 ? maxKm.toFixed(1) : maxKm)}${runBars}${axis}
      </svg>

      <div class="ch-title">부위별 세트</div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 부위 세트 수">
        ${base}${yLab(maxSets)}${setBars}${axis}
      </svg>
      ${legend ? `<div class="ch-legend">${legend}</div>` : ''}
    </div>`;
  }

  /* ── 몸무게 ──────────────────────────────────────────────────────────────
     프로필의 몸무게는 한 번 적고 끝이라 '지금 몇 kg' 만 알 수 있습니다.
     날짜별로 쌓아 두면 운동량 추이와 나란히 놓고 볼 수 있습니다 — 볼륨이
     느는데 몸무게가 그대로인지, 같이 오르는지는 전혀 다른 신호입니다.

     선 그래프를 쓰는 이유: 몸무게는 이어지는 값이라 막대로 끊어 보이면
     하루하루가 별개의 사건처럼 읽힙니다. 그리고 0 부터 그리지 않습니다 —
     80kg 대의 1kg 변화를 0 기준 축에 얹으면 아무 변화도 없어 보입니다. */
  async function handleAddWeight() {
    const last = state.metrics[state.metrics.length - 1];
    const curKg = last ? last.weightKg : Number(state.profile?.weightKg) || '';
    const cur = curKg ? toDisplayWeight(curKg) : '';
    const v = await promptText({
      title: '몸무게 기록',
      message: '오늘 몸무게를 적어 주세요.',
      value: cur ? String(cur) : '',
      placeholder: weightUnitLabel(),
      confirmText: '기록',
    });
    if (!v) return;
    /* 입력은 지금 단위(kg 또는 lb) 그대로 받고, 저장 직전에만 kg 로
       바꿉니다 — state.metrics 는 언제나 kg 입니다. */
    const disp = Number(String(v).replace(/[^0-9.]/g, ''));
    const kg = fromDisplayWeight(disp);
    if (!Number.isFinite(kg) || kg < 20 || kg > 300) {
      toast(`${Math.round(toDisplayWeight(20))}~${Math.round(toDisplayWeight(300))}${weightUnitLabel()} 사이로 적어 주세요`);
      return;
    }
    const row = { date: todayISO(), weightKg: Math.round(kg * 10) / 10 };
    state.metrics = state.metrics.filter(m => m.date !== row.date).concat(row)
      .sort((a, b) => a.date.localeCompare(b.date));
    await WorkoutDB.putMetric(row);
    cloudSync(() => Cloud.saveMetrics(state.metrics));
    render();
    toast(`${toDisplayWeight(row.weightKg)}${weightUnitLabel()} 기록했습니다`);
  }


  /* ── 그래프 짚어 보기 ────────────────────────────────────────────────────
     선 그래프의 점마다 <title> 을 달아 두었지만 그건 마우스를 올려야 뜹니다.
     폰에는 올릴 마우스가 없어서, 화면에 보이는 숫자는 축에 적힌 최댓값·최솟값
     둘뿐이었습니다. "8월 12일에 몇 kg 이었지" 는 눈대중해야 했습니다.

     그래서 손가락을 대면 가장 가까운 점을 짚어 값을 띄웁니다. 좌우로 끌면
     따라옵니다.

     세로 스크롤을 막지 않는 것이 중요합니다 — 그래프가 카드 너비를 다 쓰기
     때문에, 여기서 스크롤이 안 되면 화면 한가운데에 손가락을 먹는 띠가
     생깁니다. CSS 의 touch-action: pan-y 가 그 일을 합니다: 세로 제스처는
     브라우저가 가져가 스크롤하고(그때 pointercancel 이 와서 우리는 물러
     납니다), 가로 제스처만 우리에게 옵니다.

     말풍선과 세로선은 렌더 템플릿에 넣지 않고 처음 짚을 때 만들어 붙입니다.
     render() 가 #app 을 통째로 갈아 끼우므로 어차피 매번 사라지고, 덕분에
     '짚고 있는 중' 이라는 상태가 화면 갱신마다 되살아나는 일도 없습니다. */
  let _scrub = null;

  function chScrubData(box) {
    const svg = box.querySelector('svg');
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    if (!vb || !vb.width) return null;
    const pts = Array.from(svg.querySelectorAll('circle[data-v]'))
      .map(c => ({
        cx: parseFloat(c.getAttribute('cx')),
        cy: parseFloat(c.getAttribute('cy')),
        d: c.getAttribute('data-d') || '',
        v: c.getAttribute('data-v') || '',
      }))
      .filter(p => Number.isFinite(p.cx) && Number.isFinite(p.cy));
    if (!pts.length) return null;
    return { svg, vbW: vb.width, vbH: vb.height || 1, pts };
  }

  function chScrubUI(box) {
    let tip = box.querySelector('.ch-tip');
    if (!tip) {
      box.insertAdjacentHTML('beforeend',
        '<span class="ch-cursor"></span><span class="ch-dot"></span><span class="ch-tip"></span>');
      tip = box.querySelector('.ch-tip');
    }
    return { tip, cur: box.querySelector('.ch-cursor'), dot: box.querySelector('.ch-dot') };
  }

  function chScrubTo(clientX) {
    const s = _scrub;
    if (!s) return;
    const r = s.svg.getBoundingClientRect();
    if (!r.width) return;
    const boxR = s.box.getBoundingClientRect();
    const offX = r.left - boxR.left, offY = r.top - boxR.top;

    /* 손가락이 점 위에 정확히 있을 필요는 없습니다 — x 로만 가장 가까운 점을
       고릅니다. 반지름 2.5px 짜리 점을 손끝으로 맞히라고 하면 아무도 못
       씁니다. */
    const vx = (clientX - r.left) / r.width * s.vbW;
    let best = s.pts[0];
    for (const p of s.pts) if (Math.abs(p.cx - vx) < Math.abs(best.cx - vx)) best = p;

    const px = offX + best.cx / s.vbW * r.width;
    const py = offY + best.cy / s.vbH * r.height;

    s.cur.style.left = px + 'px';
    s.dot.style.left = px + 'px';
    s.dot.style.top = py + 'px';
    s.tip.innerHTML = '<b>' + esc(best.v) + '</b>' + (best.d ? '<span>' + esc(best.d) + '</span>' : '');
    /* 양 끝 점을 짚었을 때 말풍선이 카드 밖으로 잘리지 않게 가둡니다.
       가운데 정렬은 그대로 두고 좌우 끝에서만 안쪽으로 밀어 넣습니다. */
    const half = s.tip.offsetWidth / 2 + 4;
    s.tip.style.left = Math.max(half, Math.min(boxR.width - half, px)) + 'px';
    s.tip.style.top = py + 'px';
    s.box.classList.add('scrubbing');
  }

  function chScrubEnd(hold) {
    const s = _scrub;
    if (!s) return;
    _scrub = null;
    /* 손을 떼자마자 지우면 정작 읽을 시간이 없습니다. 잠깐 두었다 사라집니다.
       스크롤에 뺏긴 경우(hold=0)에는 짚은 적이 없던 것처럼 곧바로 지웁니다. */
    const box = s.box;
    setTimeout(function () { try { box.classList.remove('scrubbing'); } catch (_) {} }, hold);
  }

  function watchChartScrub() {
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const box = e.target.closest && e.target.closest('.ch-scrub');
      if (!box) return;
      const data = chScrubData(box);
      if (!data) return;
      if (_scrub) chScrubEnd(0);
      _scrub = Object.assign({ box, pointerId: e.pointerId }, data, chScrubUI(box));
      /* 포인터를 잡아 두면 손가락이 그래프 밖으로 나가도 계속 따라옵니다. */
      try { box.setPointerCapture(e.pointerId); } catch (_) {}
      chScrubTo(e.clientX);
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (!_scrub || _scrub.pointerId !== e.pointerId) return;
      chScrubTo(e.clientX);
    }, { passive: true });

    document.addEventListener('pointerup', (e) => {
      if (!_scrub || _scrub.pointerId !== e.pointerId) return;
      chScrubEnd(1800);
    }, { passive: true });

    /* 브라우저가 세로 스크롤을 가져갔거나 전화가 왔거나 — 어느 쪽이든 이
       제스처는 우리 것이 아니었습니다. */
    document.addEventListener('pointercancel', (e) => {
      if (!_scrub || _scrub.pointerId !== e.pointerId) return;
      chScrubEnd(0);
    }, { passive: true });
  }

  function renderWeightCard() {
    /* state.metrics 는 항상 kg 입니다 — 그리기용으로 지금 단위 변환값을
       따로 붙인 사본을 씁니다. 원본은 건드리지 않습니다. */
    const rows = state.metrics.slice(-30).map(r => ({ ...r, dv: toDisplayWeight(r.weightKg) }));
    if (!rows.length) {
      return `<div class="stats-card">
        <div class="stats-head"><div class="sec-title">몸무게</div></div>
        <p class="balance-empty">몸무게를 기록해 두면 운동량과 함께 변화를 볼 수 있어요.</p>
        <button class="picker-confirm" data-act="add-weight" style="margin-top:12px">몸무게 기록하기</button>
      </div>`;
    }
    const W = 320, H = 108, PAD_L = 34, PAD_B = 18, PAD_T = 10;
    const plotH = H - PAD_B - PAD_T;
    const vals = rows.map(r => r.dv);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    const x = i => PAD_L + (rows.length === 1 ? (W - PAD_L) / 2 : (i / (rows.length - 1)) * (W - PAD_L - 6));
    const y = v => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;
    const line = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(r.dv).toFixed(1)}`).join(' ');
    const area = `${line} L${x(rows.length - 1).toFixed(1)} ${PAD_T + plotH} L${x(0).toFixed(1)} ${PAD_T + plotH} Z`;
    /* data-d / data-v 는 손가락으로 짚었을 때 띄울 값입니다. <title> 은
       마우스가 있는 환경과 스크린리더를 위해 그대로 둡니다. */
    const dots = rows.map((r, i) => `<circle class="ch-dotm" style="--i:${i};--n:${rows.length}" cx="${x(i).toFixed(1)}" cy="${y(r.dv).toFixed(1)}" r="${i === rows.length - 1 ? 4 : 2.5}"
      fill="var(--wt-color)" data-d="${esc(shortDate(r.date))}" data-v="${r.dv}${esc(weightUnitLabel())}"><title>${esc(r.date)} · ${r.dv}${esc(weightUnitLabel())}</title></circle>`).join('');

    const first = rows[0], last = rows[rows.length - 1];
    const diff = Math.round((last.dv - first.dv) * 10) / 10;
    const trend = diff > 0.1 ? `<span class="pa-up">+${diff}${weightUnitLabel()}</span>`
                : diff < -0.1 ? `<span class="pa-down">${diff}${weightUnitLabel()}</span>`
                : `<span class="pa-flat">변화 없음</span>`;

    return `<div class="stats-card${overlayIn('weight')}">
      <div class="stats-head">
        <div class="sec-title">몸무게</div>
        <button class="stats-tab on" data-act="add-weight">+ 기록</button>
      </div>
      <div class="wt-now"><b>${last.dv}</b><span>${weightUnitLabel()}</span> ${trend}
        <em>${esc(shortDate(first.date))} → ${esc(shortDate(last.date))}</em></div>
      <div class="ch-scrub" style="--ch-accent:var(--wt-color)">
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="몸무게 추이">
        <text x="${PAD_L - 6}" y="${PAD_T + 4}" class="ch-axis" text-anchor="end">${hi.toFixed(1)}</text>
        <text x="${PAD_L - 6}" y="${PAD_T + plotH + 4}" class="ch-axis" text-anchor="end">${lo.toFixed(1)}</text>
        <path class="ch-area" d="${area}" fill="var(--wt-fill)"/>
        <path class="ch-line" pathLength="1" d="${line}" fill="none" stroke="var(--wt-color)" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
      </div>`;
  }

  /* ── 부위별 분석 카드 ── */
  function renderPartAnalysisCard() {
    const w = partWindows();
    const parts = analysisParts();
    /* 한 세트도 안 한 부위는 막대를 그려 봐야 0 짜리 선 하나에 "안 함 · 주
       0.0세트 · 0kg" 이 붙습니다. 네 부위가 그러면 카드 절반이 빈 줄입니다.
       안 한다는 사실 자체는 균형을 볼 때 중요하니 버리지는 않고, 카드 아래
       한 줄로 모읍니다. */
    const trained = parts.filter(p => w.cur[p.id].sets > 0 || w.prev[p.id].sets > 0);
    const untouched = parts.filter(p => !w.cur[p.id].sets && !w.prev[p.id].sets);
    if (!trained.length) return '';

    /* 막대와 화살표도 세트 기준입니다. 볼륨 숫자를 카드에서 뺐으니, 막대
       길이만 볼륨으로 남겨 두면 "주 5세트" 라고 적힌 줄이 옆줄보다 짧아
       보이는 이유를 화면 어디에서도 설명하지 못합니다. */
    const maxSets = Math.max(...trained.map(p => w.cur[p.id].setsPerWeek), 1);
    const rows = trained.map((part, i) => {
      const c = w.cur[part.id], pv = w.prev[part.id];
      const v = volumeVerdict(c.setsPerWeek);
      const dSets = pctChange(c.setsPerWeek, pv.setsPerWeek);
      const arrow = dSets == null ? '' : dSets >= 8 ? `<span class="pa-up">▲${dSets}%</span>`
                  : dSets <= -8 ? `<span class="pa-down">▼${Math.abs(dSets)}%</span>`
                  : `<span class="pa-flat">–</span>`;
      const width = Math.max(2, Math.round((c.setsPerWeek / maxSets) * 100));
      return `<div class="pa-row">
        <div class="pa-head">
          <span class="dsum-dot" style="background:${part.color}"></span>
          <span class="pa-name">${part.label}</span>
          <span class="pa-verdict ${v.cls}">${v.label}</span>
          ${arrow}
        </div>
        <div class="pa-bar"><span style="width:${width}%;background:${part.color};--i:${i}"></span></div>
        <div class="pa-meta">주 ${c.setsPerWeek.toFixed(1)}세트</div>
      </div>`;
    }).join('');

    return `<div class="stats-card${overlayIn('partanalysis')}">
      <div class="stats-head">
        <div class="sec-title">부위별 분석</div>
        <button class="stats-tab" data-act="vol-info">최근 ${w.weeks}주 ⓘ</button>
      </div>
      <div class="pa-list">${rows}</div>
      ${untouched.length ? (() => {
        const names = untouched.map(p => p.label);
        return `<p class="pa-none">최근 ${w.weeks}주 동안 <b>${names.map(esc).join(' · ')}</b>${josa(names[names.length - 1], '은', '는')} 한 번도 안 했어요.</p>`;
      })() : ''}
    </div>`;
  }

  /* ── 변화 리포트 카드 ── */
  function renderChangeCard() {
    const w = partWindows();
    const parts = analysisParts();
    const items = parts
      .filter(p => w.cur[p.id].sets || w.prev[p.id].sets)
      .map(p => ({ part: p, ch: readChange(w.cur[p.id], w.prev[p.id]) }));
    const stalled = stalledExercises();
    if (!items.length && !stalled.length) return '';

    /* 전체 합계도 같은 방식으로 한 줄 요약합니다. */
    const sum = (o) => parts.reduce((a, p) => ({
      sets: a.sets + o[p.id].sets, setsPerWeek: a.setsPerWeek + o[p.id].setsPerWeek,
      volPerWeek: a.volPerWeek + o[p.id].volPerWeek, volume: a.volume + o[p.id].volume,
      maxKg: Math.max(a.maxKg, o[p.id].maxKg),
    }), { sets: 0, setsPerWeek: 0, volPerWeek: 0, volume: 0, maxKg: 0 });
    const overall = readChange(sum(w.cur), sum(w.prev));

    const rows = items.map(({ part, ch }) => `
      <div class="ch-row">
        <span class="dsum-dot" style="background:${part.color}"></span>
        <span class="ch-part">${part.label}</span>
        <span class="ch-text ${ch.tone}">${esc(ch.text)}</span>
      </div>`).join('');

    const stall = stalled.length ? `
      <div class="ch-stall-head">무게가 오래 그대로예요</div>
      ${stalled.map(x => `<div class="ch-stall">
        <span class="ch-stall-name">${esc(x.name)}</span>
        <span class="ch-stall-kg">${toDisplayWeight(x.kg)}${weightUnitLabel()}</span>
        <span class="ch-stall-wk">${x.weeks}주째</span>
      </div>`).join('')}
      <p class="ch-note">이 정도 기간이면 무게를 조금 올리거나 횟수를 늘려볼 때입니다.</p>` : '';

    return `<div class="stats-card">
      <div class="stats-head">
        <div class="sec-title">변화</div>
        <span class="balance-window">최근 ${w.weeks}주 vs 직전 ${w.weeks}주</span>
      </div>
      <div class="ch-overall ${overall.tone}">${esc(overall.text)}</div>
      <div class="ch-list">${rows}</div>
      ${stall}
    </div>`;
  }

  function renderPRCard() {
    const rows = allPersonalBests();
    if (!rows.length) return '';
    const shown = state.prAll ? rows : rows.slice(0, 6);
    const items = shown.map(r => {
      const part = PARTS.find(p => p.id === r.part);
      return `<div class="pr-row">
        <span class="pr-dot" style="background:${part ? part.color : 'var(--muted)'}"></span>
        <span class="pr-name">${esc(r.name)}</span>
        <span class="pr-kg">${toDisplayWeight(r.kg)}<i>${weightUnitLabel()}</i> <s>×${r.reps}</s></span>
        <span class="pr-date">${esc(shortDate(r.date))}</span>
      </div>`;
    }).join('');
    return `<div class="stats-card">
      <div class="stats-head">
        <div class="sec-title">개인 기록</div>
        ${rows.length > 6 ? `<button class="stats-tab" data-act="pr-toggle">${state.prAll ? '접기' : `전체 ${rows.length}개`}</button>` : ''}
      </div>
      <div class="pr-list">${items}</div>
    </div>`;
  }


  /* ── 기록 검색 ────────────────────────────────────────────────────────────
     기록 앱에 던지는 질문은 축이 둘입니다. '3월 12일에 뭐 했지'(날짜 축)는
     히스토리 달력이 이미 답합니다. 남은 것이 '벤치, 내가 어떻게 해왔지'
     (운동 축)인데, 지금까지 그 화면으로 가는 길은 두 개뿐이었습니다 — 그
     운동이 오늘 기록에 담겨 있을 때, 또는 운동을 고르는 중일 때. 반년 전에
     하던 운동의 이력을 보려면 일단 오늘 기록에 담았다가 보고 다시 지워야
     했습니다.

     그래서 검색 결과의 단위는 '세션' 이 아니라 '운동' 입니다. 매칭된 날짜를
     늘어놓으면 달력이 하는 일을 더 나쁘게 다시 하는 것뿐입니다. */

  /* 한글 초성. 운동 이름이 길어서(인클라인 덤벨 벤치프레스) 끝까지 치는
     사람이 없습니다. ㅇㅋㄹㅇ 으로 찾을 수 있어야 쓸 만해집니다.
     유니코드 한글 음절은 (초성 × 21 × 28) 순서로 규칙적이라 나누기 한 번이면
     초성이 나옵니다. */
  const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  function chosung(str) {
    let out = '';
    for (const ch of String(str)) {
      const c = ch.charCodeAt(0) - 0xAC00;
      out += (c >= 0 && c <= 11171) ? CHO[Math.floor(c / 588)] : ch;
    }
    return out;
  }
  /* 초성 매칭은 '자모가 섞여 있을 때만' 씁니다.
     '벤치' 를 치면 초성은 'ㅂㅊ' 인데, 이걸 항상 매칭에 쓰면 이름에 '벤치'
     가 없는 운동까지 결과에 끼어듭니다. 자모가 보인다는 건 사용자가 초성을
     치고 있거나 한글을 조합하는 중이라는 뜻이고, 그때만 켜면 됩니다. */
  function hasJamo(s) { return /[ㄱ-ㅣ]/.test(s); }

  /* ── 운동별 집계 ─────────────────────────────────────────────────────────
     state.sessions 는 이미 전부 메모리에 있습니다. 2년치라도 300세션 남짓이라
     한 번 훑는 데 1ms 대고, 그래서 인덱스 저장소 같은 건 필요 없습니다.
     다만 키를 칠 때마다 다시 훑으면 저사양 기기에서 입력이 밀리므로 한 번만
     만들어 들고 있습니다. */
  let _exIndex = null;
  function invalidateExIndex() { _exIndex = null; }

  function exIndex() {
    if (_exIndex) return _exIndex;
    const map = new Map();
    for (const s of state.sessions) {
      if (!s || !s.date) continue;
      for (const ex of s.exercises || []) {
        if (!ex || !ex.name) continue;
        const done = (ex.sets || []).filter(st => st.done);
        if (!done.length) continue;
        let row = map.get(ex.name);
        if (!row) {
          row = { name: ex.name, part: ex.part, count: 0, sets: 0, volume: 0,
                  best: null, lastDate: null, hold: !!ex.hold };
          map.set(ex.name, row);
        }
        row.count += 1;
        row.sets += done.length;
        for (const st of done) {
          const sc = setScore(st);
          if (!sc) continue;
          row.volume += sc.kg * sc.reps;
          /* 개인 기록 카드(allPersonalBests)와 같은 기준 — 무게가 가장 큰
             완료 세트. 여기서만 다른 기준을 쓰면 같은 운동에 대해 화면마다
             다른 숫자가 뜹니다. */
          if (!row.best || sc.kg > row.best.kg) row.best = { kg: sc.kg, reps: sc.reps, date: s.date };
        }
        if (!row.lastDate || s.date > row.lastDate) row.lastDate = s.date;
      }
    }
    _exIndex = [...map.values()]
      .sort((a, b) => b.count - a.count || (b.lastDate || '').localeCompare(a.lastDate || ''));
    return _exIndex;
  }

  /* 이 운동을 한 날들. 이력 화면을 열 때만 부르므로 캐시하지 않습니다 —
     state.sessions 가 최신순이라 결과도 최신순으로 나옵니다. */
  function exHistoryRows(name) {
    const rows = [];
    for (const s of state.sessions) {
      const ex = (s.exercises || []).find(e => e && e.name === name);
      if (!ex) continue;
      const done = (ex.sets || []).filter(st => st.done);
      if (!done.length) continue;
      rows.push({ date: s.date, sets: done, hold: !!ex.hold });
    }
    return rows;
  }

  /* 이름이 곧 키입니다. lastLog·allPersonalBests·renderExerciseTrend 가 전부
     ex.name 으로 묶고 있어서, 검색만 id 로 묶으면 같은 운동인데 화면마다 다른
     이력이 나옵니다. 부작용(이름을 바꾸면 이력이 끊김)은 이미 있는 것이고
     여기서 새로 만들지 않습니다. */
  function searchMatches(q) {
    const query = String(q || '').trim().toLowerCase();
    if (!query) return null;
    const qCho = chosung(query);
    const useCho = hasJamo(query);

    /* 순위: 이름 앞부분 → 이름 포함 → 영문 포함 → 초성.
       이 순서라야 '벤치' 를 쳤을 때 벤치프레스가 클로즈그립 벤치보다 위에
       옵니다. 뒤집히면 매번 눈으로 골라야 합니다. */
    function rank(name, nameEn) {
      const n = String(name || '').toLowerCase();
      const e = String(nameEn || '').toLowerCase();
      if (n.startsWith(query)) return 0;
      if (n.includes(query)) return 1;
      if (e && e.includes(query)) return 2;
      if (useCho && chosung(n).includes(qCho)) return 3;
      return null;
    }
    function libInfo(name) {
      return findExercise(name) || state.customExercises.find(e => e.name === name) || null;
    }

    const mine = [];
    for (const r of exIndex()) {
      const k = rank(r.name, libInfo(r.name)?.nameEn);
      if (k !== null) mine.push({ ...r, _rank: k });
    }
    mine.sort((a, b) => a._rank - b._rank || b.count - a.count);

    /* 아직 안 해 본 것은 따로 모읍니다. '벤치' 하나로 벤치프레스·인클라인·
       디클라인·클로즈그립·덤벨벤치가 전부 걸리는데, 실제로 하는 건 보통
       둘입니다. 해 본 것과 안 해 본 것을 한 목록에 섞으면 매번 눈으로
       골라내야 합니다. */
    const seen = new Set(mine.map(r => r.name));
    const lib = [];
    for (const p of PARTS) {
      const pool = [...state.customExercises.filter(e => e.part === p.id),
                    ...(typeof DEFAULT_EXERCISES !== 'undefined' ? (DEFAULT_EXERCISES[p.id] || []) : [])];
      for (const item of pool) {
        if (!item || !item.name || seen.has(item.name)) continue;
        const k = rank(item.name, item.nameEn);
        if (k === null) continue;
        seen.add(item.name);
        lib.push({ name: item.name, part: p.id, id: item.id || '', _rank: k });
      }
    }
    lib.sort((a, b) => a._rank - b._rank || a.name.localeCompare(b.name));
    return { mine, lib };
  }

  /* ── 검색 결과 조각 ──────────────────────────────────────────────────── */
  function daysAgoLabel(iso) {
    if (!iso) return '';
    const d = daysSince(iso);
    if (!Number.isFinite(d)) return esc(shortDate(iso));
    if (d <= 0) return '오늘';
    if (d === 1) return '어제';
    if (d < 30) return `${d}일 전`;
    return esc(shortDate(iso));
  }

  function srRow(row, logged) {
    const p = PARTS.find(x => x.id === row.part);
    const bits = [];
    if (logged) {
      bits.push(`${row.count}회`);
      if (row.best) bits.push(`최고 ${toDisplayWeight(row.best.kg)}${weightUnitLabel()}×${row.best.reps}`);
      const ago = daysAgoLabel(row.lastDate);
      if (ago) bits.push(ago);
    } else {
      bits.push(p ? p.label : '');
      bits.push('아직 기록 없음');
    }
    return `<button class="sr-row" data-act="open-ex-history" data-name="${esc(row.name)}">
      <span class="sr-dot" style="background:${p ? p.color : 'var(--muted)'}"></span>
      <span class="recent-mid">
        <span class="recent-parts">${esc(row.name)}</span>
        <span class="recent-meta">${esc(bits.filter(Boolean).join(' · '))}</span>
      </span>
      <svg class="recent-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;
  }

  /* 아무것도 치지 않았을 때가 이 화면에서 가장 중요합니다. 빈 화면을 주면
     사람은 뭘 쳐야 할지 모르고, 사실 대부분은 치고 싶지도 않습니다 — 같은
     운동을 반복하니까요. 자주 한 운동을 그냥 띄워 주면 검색의 대부분이
     타이핑 없이 탭 한 번으로 끝납니다.

     '자주' 는 세트 수나 볼륨이 아니라 '몇 번 했나' 입니다. 세트 수로 하면
     고반복 운동이, 볼륨으로 하면 하체가 목록을 독차지합니다. */
  function buildSearchResults() {
    const q = state.logSearch.trim();
    if (!q) {
      const all = exIndex();
      if (!all.length) {
        return `<div class="empty-state">아직 기록이 없습니다.<br>운동을 기록하면 여기서 찾을 수 있어요.</div>`;
      }
      const often = all.slice(0, 8);
      const oftenNames = new Set(often.map(r => r.name));
      const recent = all.filter(r => !oftenNames.has(r.name))
        .sort((a, b) => (b.lastDate || '').localeCompare(a.lastDate || ''))
        .slice(0, 4);
      return `
        <div class="sec-head"><div class="sec-title">자주 한 운동</div></div>
        <div class="sr-list">${often.map(r => srRow(r, true)).join('')}</div>
        ${recent.length ? `
          <div class="sec-head" style="margin-top:20px"><div class="sec-title">최근 기록한 운동</div></div>
          <div class="sr-list">${recent.map(r => srRow(r, true)).join('')}</div>` : ''}`;
    }

    const res = searchMatches(q);
    if (!res.mine.length && !res.lib.length) {
      return `<div class="empty-state">'${esc(q)}' 에 해당하는 운동이 없습니다.</div>`;
    }
    let html = '';
    if (res.mine.length) {
      html += `<div class="sec-head"><div class="sec-title">내가 기록한 운동</div></div>
        <div class="sr-list">${res.mine.map(r => srRow(r, true)).join('')}</div>`;
    }
    if (res.lib.length) {
      const open = state.searchLibOpen || !res.mine.length;
      html += `<div class="sec-head" style="margin-top:${res.mine.length ? 20 : 0}px">
          <div class="sec-title">운동 라이브러리</div>
          <button class="stats-tab${open ? ' on' : ''}" data-act="toggle-search-lib">${open ? '접기' : `${res.lib.length}개 보기`}</button>
        </div>
        ${open ? `<div class="sr-list">${res.lib.map(r => srRow(r, false)).join('')}</div>` : ''}`;
    }
    return html;
  }

  function renderSearchScreen() {
    return `<div class="detail-screen search-screen${overlayIn('search')}">
      <header class="topbar">
        <button class="btn-icon ghost" data-act="close-search" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="search-bar sr-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="log-search" type="search" placeholder="운동 이름으로 찾기"
                 value="${esc(state.logSearch)}" data-act="search-log"
                 autocomplete="off" autocorrect="off" spellcheck="false">
        </div>
      </header>
      <main class="screen">
        <div class="search-results">${buildSearchResults()}</div>
        <div style="height:20px"></div>
      </main>
    </div>`;
  }

  /* ── 운동 이력 화면 ──────────────────────────────────────────────────────
     정보 시트(사진·근육맵·팁)와 일부러 나눠 둡니다. 저기는 '이 운동을 어떻게
     하나', 여기는 '내가 어떻게 해왔나' 로 답하는 질문이 다르고, 한 화면에 다
     넣으면 사진 세 장 + 바디맵 + 그래프 + 수십 줄 목록 + 팁이 되어 아무것도
     찾을 수 없게 됩니다. 서로 링크만 겁니다.

     덤으로 여기는 커스텀 운동도 열립니다 — 정보 시트는 라이브러리에 없으면
     빈 문자열을 돌려주고 끝이라 직접 추가한 운동은 아예 못 엽니다. */
  const EXH_RANGES = [
    { id: '3m',  label: '3개월', days: 92 },
    { id: '1y',  label: '1년',   days: 366 },
    { id: 'all', label: '전체',  days: 0 },
  ];

  function exhRangeDays() {
    const r = EXH_RANGES.find(x => x.id === state.exhRange);
    return r ? r.days : 92;
  }

  function renderExHistoryChart(rows) {
    /* 세션당 가장 무거운 완료 세트 하나. 그래프에 점이 하나뿐이면 선이 안
       그려지고 '추세' 라고 부를 것도 없으므로 카드를 통째로 뺍니다. */
    const pts = rows.slice().reverse()
      .map(r => {
        let best = 0;
        for (const st of r.sets) { const sc = setScore(st); if (sc && sc.kg > best) best = sc.kg; }
        return best > 0 ? { date: r.date, kg: toDisplayWeight(best) } : null;
      })
      .filter(Boolean);
    if (pts.length < 2) return '';

    const W = 320, H = 108, PAD_L = 34, PAD_B = 18, PAD_T = 10;
    const plotH = H - PAD_B - PAD_T;
    const vals = pts.map(p => p.kg);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 2) { const mid = (hi + lo) / 2; lo = mid - 1; hi = mid + 1; }
    const pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    const x = i => PAD_L + (pts.length === 1 ? (W - PAD_L) / 2 : (i / (pts.length - 1)) * (W - PAD_L - 6));
    const y = v => PAD_T + plotH - ((v - lo) / (hi - lo)) * plotH;
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(' ');
    const area = `${line} L${x(pts.length - 1).toFixed(1)} ${PAD_T + plotH} L${x(0).toFixed(1)} ${PAD_T + plotH} Z`;
    /* 점이 아주 많으면(1년, 전체) 원을 다 찍으면 선이 안 보입니다. 다만
       지우지는 않고 투명하게만 둡니다 — 짚기 기능이 이 원들의 cx 를 읽어
       가장 가까운 점을 찾기 때문에, 없애 버리면 그 구간만 안 짚힙니다. */
    const faint = pts.length > 40 ? ' opacity="0"' : '';
    const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}"
      r="${i === pts.length - 1 ? 4 : 2.4}" fill="var(--accent)"${faint}
      data-d="${esc(p.date)}" data-v="${p.kg}${esc(weightUnitLabel())}"><title>${esc(p.date)} · ${p.kg}${esc(weightUnitLabel())}</title></circle>`).join('');

    return `<div class="ch-scrub"><svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="무게 추이">
      <text x="${PAD_L - 6}" y="${PAD_T + 4}" class="ch-axis" text-anchor="end">${hi.toFixed(0)}</text>
      <text x="${PAD_L - 6}" y="${PAD_T + plotH + 4}" class="ch-axis" text-anchor="end">${lo.toFixed(0)}</text>
      <path d="${area}" fill="var(--accent-soft)"/>
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg></div>
    <div class="exh-chart-foot"><span>${esc(shortDate(pts[0].date))}</span><span>${esc(shortDate(pts[pts.length - 1].date))}</span></div>`;
  }

  function renderExHistory(name) {
    const all = exHistoryRows(name);
    const idx = exIndex().find(r => r.name === name);
    const lib = findExercise(name) || state.customExercises.find(e => e.name === name);
    const part = PARTS.find(p => p.id === (idx?.part || lib?.part));
    const hold = !!(idx?.hold || lib?.hold);

    const days = exhRangeDays();
    const since = days ? shiftDate(todayISO(), -days) : '';
    const rows = days ? all.filter(r => r.date >= since) : all;

    let body;
    if (!all.length) {
      body = `<div class="empty-state">아직 이 운동의 기록이 없습니다.${
        lib ? '<br>동작을 먼저 확인해 보세요.' : ''}</div>`;
    } else {
      const best = idx?.best;
      const vol = idx?.volume || 0;
      /* 총 볼륨은 톤으로 보여 줍니다 — 82,150kg 은 자릿수를 세어야 읽히고,
         82t 은 한눈에 읽힙니다. */
      const volLabel = vol >= 1000 ? `${(vol / 1000).toFixed(vol >= 10000 ? 0 : 1)}t` : `${Math.round(vol)}kg`;
      const stats = `<div class="exh-stats">
        <div><b>${idx?.count || 0}</b><span>기록</span></div>
        <div><b>${best ? `${toDisplayWeight(best.kg)}<i>${weightUnitLabel()}</i>×${best.reps}` : '—'}</b><span>최고 기록</span></div>
        ${hold ? '' : `<div><b>${volLabel}</b><span>총 볼륨</span></div>`}
      </div>`;

      const tabs = `<div class="stats-toggle" role="tablist">${EXH_RANGES.map(r =>
        `<button class="stats-tab${state.exhRange === r.id ? ' on' : ''}" data-act="exh-range" data-val="${r.id}" role="tab">${r.label}</button>`
      ).join('')}</div>`;

      const chart = renderExHistoryChart(rows);
      const chartCard = chart
        ? `<div class="stats-card"><div class="stats-head"><div class="sec-title">무게 추이</div>${tabs}</div>${chart}</div>`
        : `<div class="stats-card"><div class="stats-head"><div class="sec-title">무게 추이</div>${tabs}</div>
             <p class="balance-empty">이 기간에는 그릴 만한 기록이 없습니다.</p></div>`;

      /* 그래프는 추세를 보여 주지만 정확한 숫자를 못 읽습니다. "작년 여름에
         몇 kg 했더라" 의 실제 답은 이 목록입니다. 그리고 날짜를 누르면 그날
         전체 기록으로 건너갑니다 — 운동 축에서 날짜 축으로 가는 다리입니다. */
      const bestDate = best?.date;
      const list = rows.length ? rows.map(r => {
        const parts = r.sets.map(st => {
          const kg = Number(st.kg), reps = Number(st.reps);
          if (hold) return `${Number.isFinite(reps) ? reps : '-'}초`;
          if (!Number.isFinite(kg) || !Number.isFinite(reps)) return '—';
          return `${toDisplayWeight(kg)}×${reps}${st.warmup ? 'W' : ''}`;
        }).join('  ');
        const [, m, d] = r.date.split('-').map(Number);
        return `<button class="recent-row exh-row" data-act="open-day" data-date="${esc(r.date)}">
          <div class="recent-daybox">
            <div class="recent-day-d">${d}</div>
            <div class="recent-day-m">${m}월</div>
          </div>
          <div class="recent-mid">
            <div class="recent-parts">${esc(parts)}</div>
            <div class="recent-meta">${r.date === bestDate ? '<span class="exh-pr">최고</span>' : ''}${esc(r.date.slice(0, 4))}년</div>
          </div>
          <svg class="recent-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
      }).join('') : `<div class="help-text">이 기간에는 기록이 없습니다.</div>`;

      body = `${stats}${chartCard}
        <div class="sec-head" style="margin-top:20px">
          <div class="sec-title">기록</div>
          <div class="sec-sub">${rows.length}일</div>
        </div>
        <div class="recent-list">${list}</div>`;
    }

    return `<div class="detail-screen exh-screen${overlayIn(`exh:${name}`)}">
      <header class="topbar">
        <button class="btn-icon ghost" data-act="close-ex-history" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">${part ? `<span class="pdot" style="background:${part.color};margin-right:7px"></span>` : ''}${esc(name)}</div>
        <div class="topbar-spacer"></div>
        ${lib && lib.id ? `<button class="stats-tab" data-act="show-ex-info" data-exid="${esc(lib.id)}" data-exname="${esc(name)}">동작 보기</button>` : ''}
      </header>
      <main class="screen">
        ${body}
        <div style="height:20px"></div>
      </main>
    </div>`;
  }

  /* ── 화면 열고 닫기 ──────────────────────────────────────────────────────
     하드웨어 뒤로 가기(history/popstate)는 일부러 붙이지 않았습니다.
     이 앱에는 전체 화면·시트가 이미 여덟 군데 있고(하루 요약, 루틴 편집기,
     각종 피커, 정보 시트…) 그중 어느 것도 뒤로 가기를 처리하지 않습니다.
     새로 만드는 두 화면에만 붙이면 "어떤 화면은 뒤로 가기로 닫히고 어떤
     화면은 앱이 꺼지는" 상태가 되는데, 그건 아예 없는 것보다 나쁩니다.
     뒤로 가기는 여덟 곳을 한 번에 정리하는 별도 작업으로 두는 게 맞습니다. */
  async function openSearch() {
    if (!await confirmLeavePast()) return;
    state.searchOpen = true;
    state.logSearch = '';
    state.searchLibOpen = false;
    render();
    /* 검색 화면은 열자마자 칠 수 있어야 합니다. render 가 방금 DOM 을 새로
       만들었으므로 다음 프레임에 잡습니다. */
    requestAnimationFrame(() => { try { document.getElementById('log-search')?.focus(); } catch (_) {} });
  }

  function openExHistory(name) {
    if (!name) return;
    /* 정보 시트에서 넘어온 경우 그 시트는 닫습니다 — 시트(z-index 70)가 이력
       화면(45) 위에 계속 떠 있으면 방금 연 화면이 안 보입니다. */
    state.exerciseInfoId = null;
    state.exHistoryName = name;
    state.exhRange = state.exhRange || '3m';
    render();
  }

  function renderHistory() {
    const mKey = state.histMonth || monthKey(todayISO());
    let body = renderCalendar(mKey);

    /* 날짜를 고르면 전체 화면으로 덮지 않고 달력 바로 아래에서 펼칩니다.
       달력이 사라지면 "옆 날짜는 어땠지" 를 보려고 매번 뒤로 나갔다
       들어와야 합니다. 달력을 남겨 두면 그냥 다른 날을 누르면 됩니다. */
    const picked = state.histDay && state.histDay.startsWith(mKey) ? findDay(state.histDay) : null;
    if (picked) {
      body += `<div class="hist-day">
        <div class="hist-day-head">
          <div class="hist-day-title">${esc(longDate(picked.date))}</div>
          <button class="btn-icon ghost" data-act="close-hist-day" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        ${daySummaryBody(picked)}
      </div>`;
    }

    /* 그래프와 개인 기록을 목록보다 먼저 둡니다.
       한 달치 기록을 전부 줄로 늘어놓으면 22줄이 넘어가고, 정작 이 화면에
       올 이유인 '얼마나 했나' 가 그 아래 파묻힙니다. 어느 날 운동했는지는
       위 달력이 이미 보여주고, 날짜를 누르면 그 자리에서 펼쳐집니다. */
    body += renderStatsCard();
    body += renderPartAnalysisCard();
    body += renderChangeCard();
    body += renderWeightCard();
    body += renderPRCard();

    const rows = state.sessions.filter(s => s.date.startsWith(mKey));
    if (rows.length) {
      const limit = 5;
      const shown = state.histAll ? rows : rows.slice(0, limit);
      body += `<div class="sec-head" style="margin-top:22px">
        <div class="sec-title">이 달의 기록</div>
        ${rows.length > limit ? `<button class="stats-tab" data-act="hist-all">${state.histAll ? '접기' : `전체 ${rows.length}일`}</button>` : ''}
      </div><div class="recent-list">`;
      for (const s of shown) {
        const [, m, d] = s.date.split('-').map(Number);
        const summary = sessionSummary(s) || '기록';
        const sets = (s.exercises || []).reduce((a, ex) => a + (ex.sets || []).filter(st => st.done).length, 0);
        const meta = [];
        if ((s.exercises || []).length) meta.push(`${s.exercises.length}개 운동`);
        if (sets) meta.push(`${sets}세트`);
        if (hasRunData(s.run)) meta.push(`러닝 ${s.run.km || '-'}km`);
        body += `<button class="recent-row" data-act="open-day" data-date="${esc(s.date)}">
          <div class="recent-daybox">
            <div class="recent-day-d">${d}</div>
            <div class="recent-day-m">${m}월</div>
          </div>
          <div class="recent-mid">
            <div class="recent-parts">${esc(summary)}</div>
            ${meta.length ? `<div class="recent-meta">${esc(meta.join(' · '))}</div>` : ''}
          </div>
          <svg class="recent-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
      }
      body += '</div>';
    } else {
      body += `<div class="empty-state" style="margin-top:22px">이 달에는 아직 기록이 없습니다.</div>`;
    }

    /* 마지막 카드가 하단 탭바에 가리지 않도록 여백을 둡니다. */
    body += '<div style="height:18px"></div>';

    return `<header class="topbar">
        <div class="topbar-title">히스토리</div>
        <div class="topbar-spacer"></div>
        <button class="btn-icon ghost" data-act="open-search" aria-label="기록 검색">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.5"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>
        </button>
      </header>
      <main class="screen${navDir ? ' nav-' + navDir : ''}">${body}</main>`;
  }

  /* ── Settings Tab ─────────────────────────── */
  function renderSettings() {
    const u = state.user;
    const p = state.profile || {};
    const bits = [];
    if (p.gender) bits.push({ male: '남성', female: '여성' }[p.gender]);
    /* 만 나이로 통일합니다. 예전에는 여기만 +1(세는나이)이라, 출생연도를
       고르는 화면은 "만 36세" 인데 바로 아래 설정 줄은 "37세" 였습니다. */
    if (p.birthYear) bits.push(`만 ${new Date().getFullYear() - Number(p.birthYear)}세`);
    if (p.heightCm) bits.push(`${toDisplayHeight(p.heightCm)}${heightUnitLabel()}`);
    if (p.weightKg) bits.push(`${toDisplayWeight(p.weightKg)}${weightUnitLabel()}`);

    /* One identity row instead of an avatar card followed by a 프로필 row that
       repeated the same person underneath it. The avatar, the name, the handle
       and the body stats are all facts about one account, so they belong to one
       tappable row that opens the editor. */
    const account = u ? `
      <div class="settings-label">계정</div>
      <div class="settings-group">
        <button class="settings-item profile-row" data-act="edit-profile">
          ${u.photoURL
            ? `<img class="account-avatar" src="${esc(u.photoURL)}" alt="">`
            : `<div class="account-avatar fallback">${esc((p.name || u.displayName || '?').slice(0,1))}</div>`}
          <div class="settings-item-text">
            <div class="settings-item-title">${esc(p.name || u.displayName || '사용자')}</div>
            <div class="settings-item-sub">${p.username ? '@' + esc(p.username) : esc(u.email || '동기화 중')}</div>
            ${bits.length
              ? `<div class="profile-bits">${esc(bits.join(' · '))}</div>`
              : `<div class="profile-bits empty">프로필을 입력해 보세요</div>`}
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button class="settings-item" data-act="logout">
          <div class="settings-item-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">로그아웃</div>
          </div>
        </button>
      </div>
      ` : `
      <div class="settings-label">계정</div>
      <div class="settings-group">
        <button class="settings-item" data-act="show-login">
          <div class="settings-item-icon accent">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">로그인</div>
            <div class="settings-item-sub">지금 기록은 이 기기에만 저장됩니다</div>
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>`;

    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen settings-screen${navDir ? ' nav-' + navDir : ''}">
        ${account}

        <div class="settings-label">운동</div>
        <div class="settings-group">
          <button class="settings-item" data-act="toggle-wake-lock" role="switch" aria-checked="${wakeLockOn()}">
            <div class="settings-item-icon${wakeLockOn() ? ' accent' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2.5"/><circle cx="12" cy="12" r="3"/><path d="M12 6.5v1.5M12 16v1.5M17.5 12H16M8 12H6.5"/></svg>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">화면 꺼짐 방지</div>
              <div class="settings-item-sub">기록 화면을 보고 있는 동안만 화면이 켜져 있습니다</div>
            </div>
            <span class="switch${wakeLockOn() ? ' on' : ''}" aria-hidden="true"><i></i></span>
          </button>
          <button class="settings-item" data-act="toggle-rest-timer" role="switch" aria-checked="${restTimerOn()}">
            <div class="settings-item-icon${restTimerOn() ? ' accent' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5"/><path d="M9 2h6"/></svg>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">휴식 타이머</div>
              <div class="settings-item-sub">세트를 완료하면 화면 아래에 타이머가 뜹니다</div>
            </div>
            <span class="switch${restTimerOn() ? ' on' : ''}" aria-hidden="true"><i></i></span>
          </button>
          ${restTimerOn() ? `
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">기본 휴식 시간</div>
              <div class="settings-item-sub">웜업 세트는 더 짧게 잡습니다.</div>
            </div>
            <div class="presets-scroll">
              ${REST_PRESETS.map(sec => `<button class="preset-chip${restDuration()===sec?' on':''}" data-act="set-rest-dur" data-val="${sec}">${sec}초</button>`).join('')}
            </div>
          </div>` : ''}
          ${restTimerOn() ? `
          <button class="settings-item" data-act="toggle-haptics" role="switch" aria-checked="${hapticsOn()}">
            <div class="settings-item-icon${hapticsOn() ? ' accent' : ''}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">진동</div>
              <div class="settings-item-sub">휴식 종료·개인 기록 때 짧게 울립니다</div>
            </div>
            <span class="switch${hapticsOn() ? ' on' : ''}" aria-hidden="true"><i></i></span>
          </button>` : ''}
        </div>

        <div class="settings-label">개인화</div>
        <div class="settings-group">
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">시작 탭</div>
              <div class="settings-item-sub">앱을 열면 처음 보일 화면</div>
            </div>
            <div class="presets-scroll">
              ${[['home','홈'],['workout','기록'],['history','히스토리'],['settings','설정']]
                .map(([v,l]) => `<button class="preset-chip${startTab()===v?' on':''}" data-act="set-start-tab" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">주 시작 요일</div>
              <div class="settings-item-sub">히스토리 달력과 이번 주 통계에 적용됩니다</div>
            </div>
            <div class="presets-scroll">
              <button class="preset-chip${weekStartsMon()?' on':''}" data-act="set-week-start" data-val="mon">월요일</button>
              <button class="preset-chip${!weekStartsMon()?' on':''}" data-act="set-week-start" data-val="sun">일요일</button>
            </div>
          </div>
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">무게 단위</div>
            </div>
            <div class="presets-scroll">
              <button class="preset-chip${unitWeight()==='kg'?' on':''}" data-act="set-unit-weight" data-val="kg">kg</button>
              <button class="preset-chip${unitWeight()==='lb'?' on':''}" data-act="set-unit-weight" data-val="lb">lb</button>
            </div>
          </div>
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">키 단위</div>
            </div>
            <div class="presets-scroll">
              <button class="preset-chip${unitHeight()==='cm'?' on':''}" data-act="set-unit-height" data-val="cm">cm</button>
              <button class="preset-chip${unitHeight()==='in'?' on':''}" data-act="set-unit-height" data-val="in">in</button>
            </div>
          </div>
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">글씨 크기</div>
              <div class="settings-item-sub">화면 전체가 함께 커집니다</div>
            </div>
            <div class="presets-scroll">
              ${[[0.92,'작게'],[1,'보통'],[1.08,'크게'],[1.18,'아주 크게']]
                .map(([v,l]) => `<button class="preset-chip${fontScale()===v?' on':''}" data-act="set-font-scale" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">테마</div>
              <div class="settings-item-sub">야간 운동 시 눈 피로 감소</div>
            </div>
            <div class="presets-scroll">
              ${[['auto','자동'],['light','라이트'],['dark','다크']]
                .map(([v,l]) => `<button class="preset-chip${state.themeMode===v?' on':''}" data-act="set-theme" data-val="${v}">${l}</button>`).join('')}
            </div>
          </div>
        </div>

        <p class="settings-note">${state.user
          ? '기록은 계정 클라우드와 이 기기에 함께 저장됩니다. 기기를 바꿔도 로그인하면 그대로 이어집니다.'
          : '지금은 이 기기에만 저장됩니다. 로그인하면 기기가 바뀌어도 기록이 이어집니다.'}</p>

        <!-- Backup lives behind a disclosure on purpose. Export/import move raw
             JSON around, which is a developer's mental model, not a lifter's —
             and for a signed-in user the cloud already is the backup, so putting
             these at the top level made the tab look more technical than it is.
             Still one tap away for anyone who wants a local copy. -->
        <details class="settings-adv">
          <summary class="settings-adv-summary">
            <span>고급 · 백업 파일</span>
            <svg class="settings-adv-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="settings-adv-body">
            <div class="settings-group">
              <button class="settings-item" data-act="export">
                <div class="settings-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </div>
                <div class="settings-item-text">
                  <div class="settings-item-title">백업 내보내기</div>
                  <div class="settings-item-sub">전체 기록을 파일 하나로 저장</div>
                </div>
                <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
              <button class="settings-item" data-act="import">
                <div class="settings-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div class="settings-item-text">
                  <div class="settings-item-title">백업 가져오기</div>
                  <div class="settings-item-sub">내보낸 파일에서 기록 복원</div>
                </div>
                <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </details>

        <!-- Destructive actions, fenced off at the very bottom rather than
             sitting a thumb's width from "백업 내보내기". Both are irreversible
             and both used to live inline next to routine items — the reset was
             directly under import, which is precisely where a mis-tap lands. -->
        <details class="settings-adv danger-adv">
          <summary class="settings-adv-summary danger-label">
            <span>계정 및 데이터 관리</span>
            <svg class="settings-adv-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </summary>
          <div class="settings-adv-body">
        <div class="settings-group danger-zone">
          <button class="settings-item danger-item" data-act="clear-local-data">
            <div class="settings-item-icon danger">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">이 기기 기록 초기화</div>
              <div class="settings-item-sub">${state.user ? '이 기기에서만 지워지고 클라우드 기록은 남습니다' : '이 기기에 저장된 모든 기록이 사라집니다'}</div>
            </div>
          </button>
          ${u ? `
          <button class="settings-item danger-item" data-act="delete-account" ${state.accountBusy?'disabled':''}>
            <div class="settings-item-icon danger">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/><line x1="17" y1="8" x2="22" y2="13"/><line x1="22" y1="8" x2="17" y2="13"/></svg>
            </div>
            <div class="settings-item-text">
              <div class="settings-item-title">${state.accountBusy?'삭제 중…':'계정 및 데이터 삭제'}</div>
              <div class="settings-item-sub">클라우드 기록까지 완전히 삭제 · 되돌릴 수 없음</div>
            </div>
          </button>` : ''}
        </div>
          </div>
        </details>

        <!-- 운동 그림의 저작자 표기. CC BY-SA 4.0 은 저작자와 라이선스를
             밝히도록 요구하므로 화면 어딘가에 반드시 있어야 합니다. -->
        <div class="credit-block">
          <p>운동 그림 &copy; <a href="https://bryllim.com" target="_blank" rel="noopener">Bryl Lim</a>
             (Workout Guide) &middot; 원작 <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a>
             &middot; <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>
             &middot; 크기 조정 외 변경 없음</p>
          <p>일부 그림은 <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a>
             (퍼블릭 도메인) 및 직접 그린 그림입니다.</p>
          ${APP_VERSION ? `<p class="app-version">FITLOG ${esc(APP_VERSION)}</p>` : ''}
        </div>
      </main>`;
  }

  /* ── 손짓: 세트 옆으로 밀어 지우기 ───────────────────────────────────────
     새로고침은 아래 bindPullRefresh 가 따로 받습니다. 한 포인터 핸들러에
     섞어 두면, 세로로 움직이는 순간 스와이프가 제스처를 삼켜 버려
     당기기가 시작조차 못 했습니다. */
  let gesture = null;
  function onSwipePointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.set-swipe-action')) { gesture = null; return; }
    const row = e.target.closest('.set-row');
    if (openSwipeRow && row !== openSwipeRow) closeOpenSwipe();
    gesture = {
      mode: null,
      row: row || null,
      wasOpen: !!row && row === openSwipeRow,
      startX: e.clientX, startY: e.clientY,
      pointerId: e.pointerId,
    };
  }
  function onSwipePointerMove(e) {
    if (!gesture || gesture.pointerId !== e.pointerId) return;
    const dx = e.clientX - gesture.startX;
    const dy = e.clientY - gesture.startY;
    if (!gesture.mode) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (gesture.row && Math.abs(dx) > Math.abs(dy)) {
        gesture.mode = 'swipe';
        gesture.row.classList.add('swiping');
        try { gesture.row.setPointerCapture(e.pointerId); } catch (_) {}
      } else {
        gesture = null;
        return;
      }
    }
    if (gesture.mode === 'swipe') {
      e.preventDefault();
      const base = gesture.wasOpen ? -SWIPE_REVEAL : 0;
      gesture.dx = Math.max(-SWIPE_REVEAL, Math.min(0, base + dx));
      gesture.row.style.transform = `translateX(${gesture.dx}px)`;
    }
  }
  function onSwipePointerUp(e) {
    if (!gesture || (e.pointerId != null && gesture.pointerId !== e.pointerId)) return;
    const g = gesture;
    gesture = null;
    if (g.mode === 'swipe') {
      suppressNextClick = true;
      g.row.classList.remove('swiping');
      if (g.dx <= -SWIPE_REVEAL / 2) {
        g.row.style.transform = `translateX(-${SWIPE_REVEAL}px)`;
        openSwipeRow = g.row;
      } else {
        g.row.style.transform = '';
        if (openSwipeRow === g.row) openSwipeRow = null;
      }
    } else if (!g.mode && g.row && g.wasOpen) {
      g.row.classList.remove('swiping');
      g.row.style.transform = '';
      if (openSwipeRow === g.row) openSwipeRow = null;
      suppressNextClick = true;
    }
  }
  function closeOpenSwipe() {
    if (openSwipeRow && openSwipeRow.isConnected) {
      openSwipeRow.style.transform = '';
      openSwipeRow.classList.remove('swiping');
    }
    openSwipeRow = null;
  }

  /* 지우기 전에 그 자리를 눈에 보이게 접어 줍니다. 상태부터 바꾸고 다시
     그리면(render()) 지울 노드가 그 순간 이미 DOM 에서 없어서, 사라지는
     모습을 태울 대상이 없습니다 — 그래서 실제 노드를 먼저 움츠러들게 하고,
     그 트랜지션이 끝나야 상태를 바꿉니다. 대상이 없으면(이미 스크롤 밖으로
     사라졌거나 셀렉터가 못 찾은 경우) 그냥 곧바로 지웁니다. */
  /* 기기에서 '동작 줄이기' 를 켠 사람에게는 화면이 미끄러지는 것 자체가
     문제입니다. CSS 애니메이션은 미디어쿼리가 막아 주지만, JS 가 직접
     시키는 부드러운 스크롤은 여기서 따로 물어봐야 합니다. */
  function prefersReducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (_) { return false; }
  }
  function scrollElIntoView(el, block) {
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block });
  }

  function animateRemoval(el) {
    return new Promise(resolve => {
      if (!el) { resolve(); return; }
      const h = el.getBoundingClientRect().height;
      el.style.height = h + 'px';
      el.style.overflow = 'hidden';
      el.classList.add('removing');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.height = '0px';
          el.style.marginTop = '0px';
          el.style.marginBottom = '0px';
          el.style.opacity = '0';
          /* 안쪽 여백과 테두리도 같이 걷어야 합니다.
             box-sizing 이 border-box 라 height:0 은 '내용 높이 0' 일 뿐,
             운동 카드의 padding 15px 두 겹과 테두리 1px 두 겹은 그대로
             남습니다. 그래서 카드가 32px 에서 멈춰 있다가 렌더가 끝나는
             순간 사라졌고, 그 마지막 32px 이 툭 끊기는 것으로 보였습니다. */
          el.style.paddingTop = '0px';
          el.style.paddingBottom = '0px';
          el.style.borderTopWidth = '0px';
          el.style.borderBottomWidth = '0px';
        });
      });
      setTimeout(resolve, 220);
    });
  }

  /* 당겨서 새로고침 표시. render() 가 지울 수 있는 appEl 안이 아니라
     body 에 직접 붙여 둡니다 — 휴식 타이머 바와 같은 이유로, 동기화가
     도는 동안 어딜 누르든(탭을 옮기든) 표시가 끊기면 안 됩니다. */
  const PULL_TABS = { home: 1, workout: 1, history: 1 };
  const PULL_FIRE = 36;
  let pullEl = null;
  let pull = null;
  function ensurePullEl() {
    if (pullEl) return pullEl;
    pullEl = document.createElement('div');
    pullEl.className = 'pull-refresh';
    pullEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
    document.body.appendChild(pullEl);
    return pullEl;
  }
  function updatePullVisual(dist) {
    const el = ensurePullEl();
    el.classList.toggle('armed', dist >= PULL_FIRE);
    el.style.transform = `translateY(${dist}px)`;
    const svg = el.querySelector('svg');
    if (svg) svg.style.transform = `rotate(${Math.min(180, dist * 3)}deg)`;
  }
  function showSyncIndicator() {
    const el = ensurePullEl();
    el.classList.remove('dragging', 'armed');
    el.classList.add('loading');
    el.style.transform = 'translateY(52px)';
    const svg = el.querySelector('svg');
    if (svg) svg.style.transform = '';
  }
  function hideSyncIndicator() {
    if (!pullEl) return;
    pullEl.classList.remove('dragging', 'loading', 'armed');
    pullEl.style.transform = '';
    const svg = pullEl.querySelector('svg');
    if (svg) svg.style.transform = '';
  }
  function pageScrollTop() {
    const tops = [
      window.scrollY || 0,
      window.pageYOffset || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0,
    ];
    const se = document.scrollingElement;
    if (se) tops.push(se.scrollTop || 0);
    let el = appEl;
    while (el) {
      tops.push(el.scrollTop || 0);
      el = el.parentElement;
    }
    return Math.max.apply(null, tops);
  }
  function isPageAtTop() {
    /* iOS 바운스·주소창 때문에 맨 위인데도 몇 px 남는 경우가 있습니다. */
    return pageScrollTop() <= 16;
  }
  function canPullFrom(target) {
    if (!PULL_TABS[state.tab] || state.syncing || !state.authReady) return false;
    /* 로그인·가입 화면은 빼고, 앱 안에 들어온 뒤(계정·게스트)만. */
    if (!state.user && !state.guest) return false;
    if (target && target.closest('.detail-screen, .sheet-backdrop, .dialog, .bottom-nav, .set-swipe-action')) return false;
    return isPageAtTop();
  }
  async function refreshFromPull() {
    if (state.syncing) return;
    if (state.user) {
      syncInBackground(true);
      return;
    }
    showSyncIndicator();
    const shownAt = Date.now();
    try {
      /* 저장 큐를 먼저 비웁니다. 안 그러면 방금 체크한 세트가 디스크에
         닿기도 전에 옛 목록을 읽어 화면을 덮습니다. 열린 기록은 디스크
         것으로 갈아끼우지 않습니다 — 그게 기록을 지우던 경로입니다. */
      try { await persist(); } catch (_) {}
      state.sessions = await WorkoutDB.getAllSessions();
      state.customExercises = await WorkoutDB.getCustomExercises();
      applyOpenSessionToList();
      render();
    } catch (err) {
      console.warn('local refresh failed', err);
    } finally {
      const wait = Math.max(0, 420 - (Date.now() - shownAt));
      setTimeout(hideSyncIndicator, wait);
    }
  }
  function pullStart(x, y, target) {
    if (!canPullFrom(target)) { pull = null; return; }
    pull = { startX: x, startY: y, dist: 0, armed: false };
  }
  function pullMove(x, y, prevent) {
    if (!pull) return;
    const dy = y - pull.startY;
    const dx = x - pull.startX;
    if (!pull.armed) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { pull = null; return; }
      if (dy < -10) { pull = null; return; }
      if (dy > 6 && dy >= Math.abs(dx) && isPageAtTop()) {
        pull.armed = true;
        ensurePullEl().classList.add('dragging');
      } else {
        return;
      }
    }
    if (prevent) prevent();
    pull.dist = Math.min(100, Math.max(0, dy) * 0.65);
    updatePullVisual(pull.dist);
  }
  function pullEnd() {
    if (!pull) return;
    const armed = pull.armed;
    const dist = pull.dist;
    pull = null;
    if (!armed) return;
    ensurePullEl().classList.remove('dragging');
    if (dist >= PULL_FIRE) refreshFromPull();
    else hideSyncIndicator();
  }
  /* 터치로만 받습니다. iOS 는 pointermove 의 preventDefault 로 스크롤을
     막지 못하고, 스와이프 핸들러에 섞으면 세로 움직임이 바로 버려집니다.
     document 에 한 번만 묶습니다. 홈·기록·히스토리, 맨 위에서 아래로
     당기면(일반 앱과 같습니다) 동그라미가 따라옵니다. */
  (function bindPullRefresh() {
    document.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { pull = null; return; }
      const t = e.touches[0];
      pullStart(t.clientX, t.clientY, e.target);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!pull || e.touches.length !== 1) return;
      const t = e.touches[0];
      pullMove(t.clientX, t.clientY, () => e.preventDefault());
    }, { passive: false });
    document.addEventListener('touchend', pullEnd);
    document.addEventListener('touchcancel', pullEnd);
    /* 마우스로 확인할 때. 터치 기기는 위에서 이미 받으므로 건너뜁니다. */
    document.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pullStart(e.clientX, e.clientY, e.target);
    });
    document.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || !pull) return;
      pullMove(e.clientX, e.clientY, () => e.preventDefault());
    });
    document.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') return;
      pullEnd();
    });
    document.addEventListener('pointercancel', e => {
      if (e.pointerType === 'touch') return;
      pullEnd();
    });
  })();

  /* ── Event Binding ────────────────────────── */
  function bindEvents() {
    appEl.onclick  = onClick;
    appEl.oninput  = onInput;
    appEl.onchange = onChangeEvt;
    appEl.onpointerdown = onSwipePointerDown;
    appEl.onpointermove = onSwipePointerMove;
    appEl.onpointerup = onSwipePointerUp;
    appEl.onpointercancel = onSwipePointerUp;
  }

  async function onClick(e) {
    /* 세트를 옆으로 밀었다 놓은 동작(또는 열려 있던 걸 닫으려 한 탭)이
       바로 뒤에 클릭으로도 잡히면, 밀기가 끝나자마자 그 아래 버튼(완료 체크
       등)이 같이 눌린 것처럼 동작해 버립니다. 스와이프 쪽에서 표시해 두면
       그 클릭 한 번만 건너뜁니다. */
    if (suppressNextClick) { suppressNextClick = false; return; }

    /* del-custom needs to stop before pick-item fires */
    const delCustom = e.target.closest('[data-act="del-custom"]');
    if (delCustom) { e.stopPropagation(); await handleDeleteCustom(delCustom.dataset.id); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    /* Navigation */
    if (act === 'go-tab')     { await goTab(btn.dataset.tab); return; }
    if (act === 'today')      { if (!await confirmLeavePast()) return; await loadDay(todayISO()); return; }
    /* Tapping a past day shows what was done rather than opening the editor.
       Looking back is the common intent; 편집 is one tap further in, inside the
       summary, where it is an explicit choice rather than the default. */
    if (act === 'open-day') {
      /* 히스토리 안에서는 달력을 남긴 채 아래에서 펼치고, 다른 화면(홈 등)
         에서는 지금처럼 전체 화면으로 띄웁니다. */
      /* 운동 이력에서 날짜를 누른 것이면 히스토리 탭에 있더라도 전체 화면으로
         띄웁니다 — 달력 아래에서 펼쳐 봐야 이력 화면에 가려 안 보입니다. */
      if (state.tab === 'history' && !state.exHistoryName) { state.histDay = state.histDay === btn.dataset.date ? null : btn.dataset.date; }
      else state.summaryDate = btn.dataset.date;
      render(); return;
    }
    if (act === 'close-hist-day') { state.histDay = null; render(); return; }
    if (act === 'stats-range') { state.statsRange = btn.dataset.range; render(); return; }
    if (act === 'pr-toggle') { state.prAll = !state.prAll; render(); return; }
    if (act === 'hist-all')  { state.histAll = !state.histAll; render(); return; }
    if (act === 'add-weight') { await handleAddWeight(); return; }
    if (act === 'vol-info')   { await showVolumeInfo(); return; }
    if (act === 'open-routines') { state.partSheet = false; state.routineSheet = true; render(); return; }
    if (act === 'open-part-sheet') { state.partSheet = true; render(); return; }
    if (act === 'jump-part') {
      /* 칩 줄은 긴 목록의 목차입니다. 부드럽게 굴러가야 지금 화면이 어디로
         옮겨 갔는지 눈이 따라옵니다 — 순간이동하면 같은 화면이 그냥 다른
         내용으로 바뀐 것처럼 보입니다. 붙어 있는 제목에 가려지지 않도록
         스크롤 여백은 CSS 의 scroll-margin-top 이 잡습니다. */
      const el = document.getElementById('part-' + btn.dataset.part);
      scrollElIntoView(el, 'start');
      return;
    }
    if (act === 'new-routine')   { openRoutineEditor(null); return; }
    if (act === 'edit-routine')  { openRoutineEditor(btn.dataset.id); return; }
    if (act === 'apply-routine') { await handleApplyRoutine(btn.dataset.id); return; }
    if (act === 'del-routine')   { await handleDeleteRoutine(btn.dataset.id); return; }
    if (act === 'save-routine-edit')    { await handleSaveRoutineEdit(); return; }
    if (act === 'close-routine-editor') { await closeRoutineEditor(); return; }
    if (act === 'rt-pick') {
      /* 루틴을 만드는 중에도 운동 고르기는 같은 시트를 씁니다. 담는 곳만
         오늘 기록이 아니라 만들던 루틴으로 바뀝니다. */
      state.routineEdit.name = document.getElementById('routine-name')?.value || state.routineEdit.name;
      state.pickerPart = btn.dataset.part;
      state.pickSelection = [];
      render(); return;
    }
    if (act === 'rt-del-ex') {
      const d = state.routineEdit;
      d.name = document.getElementById('routine-name')?.value || d.name;
      d.exercises = d.exercises.filter(e => !(e.part === btn.dataset.part && e.name === btn.dataset.name));
      render(); return;
    }
    if (act === 'cal-shift')  {
      state.histMonth = shiftMonth(state.histMonth || monthKey(todayISO()), Number(btn.dataset.delta));
      render(); return;
    }

    /* Sheet openers */
    if (act === 'open-picker') {
      state.pickerPart = btn.dataset.part;
      state.pickSelection = [];
      state.exerciseSearch = '';
      render(); return;
    }
    if (act === 'show-ex-info') {
      const id = btn.dataset.exid || btn.dataset.exname;
      state.exerciseInfoId = id;
      render(); return;
    }
    if (act === 'toggle-fav') {
      toggleFavoriteEx(btn.dataset.exid);
      render(); return;
    }
    if (act === 'open-weight') {
      const ex = state.session.exercises.find(x=>x.id===btn.dataset.ex);
      const set = ex?.sets.find(s=>s.id===btn.dataset.set);
      if (!set) return;
      /* 저장은 kg, 숫자판은 지금 단위 — 열 때 변환해서 보여줍니다. */
      state.weightPicker = newPicker(btn.dataset.ex, btn.dataset.set, toDisplayWeight(set.kg));
      render(); return;
    }
    if (act === 'open-reps') {
      const ex = state.session.exercises.find(x=>x.id===btn.dataset.ex);
      const set = ex?.sets.find(s=>s.id===btn.dataset.set);
      if (!set) return;
      state.repsPicker = newPicker(btn.dataset.ex, btn.dataset.set, set.reps);
      render(); return;
    }

    /* 출생연도 wheel. Opening seeds it with the current value, or with a
       sensible middle-aged default so the wheel never starts at 1920 and make
       the user flick through a century to reach a plausible year. */
    if (act === 'open-year') {
      const cur = Number(state.signup.birthYear);
      state.yearPicker = (cur >= YEAR_MIN && cur <= new Date().getFullYear())
        ? cur : new Date().getFullYear() - 30;
      render(); return;
    }
    if (act === 'pick-year') {
      state.yearPicker = Number(btn.dataset.year);
      render(); return;
    }
    if (act === 'confirm-year') {
      state.signup.birthYear = String(state.yearPicker || '');
      state.yearPicker = null;
      render(); return;
    }
    /* Closes only the wheel. The generic closer below also dismisses the
       profile sheet, which is usually the thing the wheel was opened from. */
    if (act === 'close-year') { state.yearPicker = null; render(); return; }

    /* Sheet closers */
    /* 정보 시트만 닫습니다. 피커에서 열었다면 고르던 목록과 선택이 그대로
       남아 있어야 합니다 — 여기서 전부 닫으면 고르던 걸 처음부터 다시 해야
       합니다. */
    if (act === 'close-info') { state.exerciseInfoId = null; render(); return; }
    if (act === 'close-picker' || act === 'close-sheet') { closeAllSheets(); render(); return; }

    /* Weight picker controls */
    if (act === 'numpad-w-digit') {
      if (!state.weightPicker) return;
      pickerDigit(state.weightPicker, btn.dataset.d, 5);
      paintPickerValue(); return;
    }
    if (act === 'numpad-w-adj') {
      if (!state.weightPicker) return;
      pickerAdjust(state.weightPicker, Number(btn.dataset.delta), 0, 999);
      paintPickerValue(true); return;
    }
    if (act === 'numpad-r-adj') {
      if (!state.repsPicker) return;
      pickerAdjust(state.repsPicker, Number(btn.dataset.delta), 0, 999);
      paintPickerValue(true); return;
    }
    if (act === 'numpad-w-dot') {
      if (!state.weightPicker) return;
      pickerDot(state.weightPicker);
      paintPickerValue(); return;
    }
    if (act === 'numpad-w-back') {
      if (!state.weightPicker) return;
      pickerBack(state.weightPicker);
      paintPickerValue(); return;
    }
    if (act === 'numpad-w-clear') {
      if (!state.weightPicker) return;
      pickerClear(state.weightPicker);
      paintPickerValue(); return;
    }
    if (act === 'confirm-weight') {
      if (!state.weightPicker) return;
      const { exId, setId } = state.weightPicker;
      /* 숫자판 값은 지금 단위 기준이라, 저장 직전에 kg 로 바꿉니다. */
      const value = pickerValue(state.weightPicker);
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.kg = fromDisplayWeight(value); await persist(); }
      state.weightPicker = null;
      render(); return;
    }

    /* Reps picker controls */
    if (act === 'numpad-r-digit') {
      if (!state.repsPicker) return;
      pickerDigit(state.repsPicker, btn.dataset.d, 3);
      paintPickerValue(); return;
    }
    if (act === 'numpad-r-back') {
      if (!state.repsPicker) return;
      pickerBack(state.repsPicker);
      paintPickerValue(); return;
    }
    if (act === 'numpad-r-clear') {
      if (!state.repsPicker) return;
      pickerClear(state.repsPicker);
      paintPickerValue(); return;
    }
    if (act === 'confirm-reps') {
      if (!state.repsPicker) return;
      const { exId, setId } = state.repsPicker;
      const value = Math.round(pickerValue(state.repsPicker));
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) {
        set.reps = value;
        /* Entering reps IS finishing the set — that is the last thing you do
           after racking the weight. Mark it done and start the rest countdown
           automatically instead of making the user hunt for a second button.
           The ✓ stays tappable to undo or to tick a set off by hand.

           ✓ 를 누르는 길과 똑같은 markSetDone 을 씁니다 — 완료 시각과 개인
           기록 판정이 한쪽에만 빠지는 일이 다시 생기지 않게. */
        if (value > 0 && !set.done) markSetDone(ex, set, true);
        await persist();
        state.repsPicker = null;
        render();
        return;
      }
      state.repsPicker = null;
      render(); return;
    }

    if (act === 'toggle-warmup') { await handleToggleWarmup(btn.dataset.ex, btn.dataset.set); return; }

    if (act === 'toggle-ex-accordion') {
      const exId = btn.dataset.ex;
      const ex = state.session?.exercises.find(e => e.id === exId);
      if (!ex) return;
      /* 지금 보이는 상태의 반대로 뒤집습니다. 아직 아무것도 안 누른 운동이면
         '지금 보이는 상태' 는 기본값이므로, 첫 탭이 눈에 보이는 것과 반대로
         움직이는 일이 없습니다. */
      state.expandedExercises[exId] = !exIsExpanded(ex);
      cancelAutoFold(exId);   /* 직접 골랐으면 예약된 자동 접기는 없던 일로 */
      render();
      return;
    }

    /* Exercise actions */
    if (act === 'toggle-pick') {
      const name = btn.dataset.name;
      const i = state.pickSelection.findIndex(x => x.name === name);
      const nowOn = i < 0;
      if (i >= 0) state.pickSelection.splice(i, 1);
      else state.pickSelection.push({ part: btn.dataset.part, name, exId: btn.dataset.exid || '' });
      /* Repaint just this row and the footer count. A full render() would
         rebuild the sheet and replay its slide-up animation on every tap —
         and choosing several exercises means several taps in a row. */
      paintPickRow(btn.closest('.pick-item'), nowOn);
      paintPickFooter();
      return;
    }
    if (act === 'commit-picks') { await handleCommitPicks(btn.dataset.part); return; }
    if (act === 'quick-del-ex') {
      const name = btn.dataset.name, part = btn.dataset.part;
      if (state.routineEdit) {
        state.routineEdit.exercises = state.routineEdit.exercises.filter(e => !(e.part === part && e.name === name));
        render(); return;
      }
      const s = state.session;
      s.exercises = s.exercises.filter(e => !(e.part===part && e.name===name));
      await persist(); render(); return;
    }
    if (act === 'add-custom') {
      /* DOM 을 먼저 봅니다 — 자동완성이나 붙여넣기는 input 이벤트를 안 내는
         경우가 있어, state 만 믿으면 방금 붙여넣은 이름을 놓칩니다. */
      const input = document.getElementById('custom-name');
      const name = ((input ? input.value : state.customName) || '').trim();
      if (!name) { toast('운동 이름을 적어 주세요'); return; }
      state.customName = '';
      await handleAddCustom(btn.dataset.part, name);
      return;
    }
    if (act === 'del-ex') { await handleDeleteEx(btn.dataset.ex); return; }
    if (act === 'add-set') { await handleAddSet(btn.dataset.ex); return; }
    if (act === 'del-set') { await handleDeleteSet(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'shift-day') {
      /* 기준 날짜를 물어보기 '전에' 붙잡아 둡니다. confirmLeavePast 가
         '나가기' 로 끝나면 discardPastEdit 이 세션을 비우므로(그 날에서 실제로
         나오기 위해서입니다), 그 뒤에 state.session.date 를 읽으면 널 참조로
         터집니다. */
      const from = (state.session && state.session.date) || state.date;
      if (!await confirmLeavePast()) return;
      await persist();
      await loadDay(shiftDate(from, Number(btn.dataset.delta)));
      return;
    }
    if (act === 'toggle-done') { await handleToggleDone(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'open-summary') { state.summaryDate = btn.dataset.date; render(); return; }
    if (act === 'open-search')  { await openSearch(); return; }
    if (act === 'close-search') { state.searchOpen = false; state.logSearch = ''; state.searchLibOpen = false; render(); return; }
    if (act === 'toggle-search-lib') {
      state.searchLibOpen = !state.searchLibOpen;
      /* 결과 목록만 갈아 끼웁니다 — 여기서 render() 를 부르면 검색어를 치던
         input 이 사라지고 키보드가 내려갑니다. */
      const box = document.querySelector('.search-results');
      if (box) box.innerHTML = buildSearchResults();
      return;
    }
    if (act === 'open-ex-history')  { openExHistory(btn.dataset.name); return; }
    if (act === 'close-ex-history') { state.exHistoryName = null; render(); return; }
    if (act === 'exh-range') { state.exhRange = btn.dataset.val; render(); return; }
    if (act === 'close-summary') { state.summaryDate = null; render(); return; }
    if (act === 'edit-day') {
      /* 다른 날을 고치던 중이었다면 먼저 물어봅니다. 여기만 빠져 있어서,
         8월 20일을 고치다가 '기록 보기' → '이 날 기록 편집하기' 로 돌아오면
         고치던 내용이 아무 말 없이 사라졌습니다(loadDay 가 디스크에서 다시
         읽어 옵니다). 나머지 출구는 전부 물어보고 있었습니다. */
      if (!await confirmLeavePast()) return;
      state.summaryDate = null;
      await loadDay(btn.dataset.date);
      return;
    }
    if (act === 'save-past') { await savePastEdit(); return; }
    if (act === 'cancel-past') {
      /* 고친 게 없으면 그냥 나갑니다. discardPastEdit 을 써서 날짜까지 오늘로
         되돌립니다 — 여기서 editingPast 만 끄면 위와 똑같이 '바 없는 과거
         날짜' 상태가 남습니다. */
      if (!state.pastDirty) { discardPastEdit(); await goTab('history'); return; }
      if (!await ask({ title: '변경을 되돌릴까요?',
                       body: '마지막으로 저장한 상태로 돌아갑니다.',
                       confirmText: '되돌리기', danger: true })) return;
      revertPastEdit();
      render();
      toast('변경을 되돌렸습니다');
      return;
    }
    if (act === 'finish-day') { await handleFinishDay(); return; }
    if (act === 'reopen-day') {
      state.session.completed = false;
      state.session.completedAt = 0;
      await persist(); render();
      toast('다시 편집할 수 있습니다');
      return;
    }
    if (act === 'start-part') { await handleStartPart(btn.dataset.part); return; }
    if (act === 'toggle-part') { handleTogglePart(btn.dataset.part); return; }
    if (act === 'commit-parts') { await handleCommitParts(); return; }
    if (act === 'delete-day') { await handleDeleteDay(); return; }
    if (act === 'export') { await exportJson(); return; }
    if (act === 'import') { importInput.click(); return; }
    if (act === 'login-google') { await handleGoogleLogin(); return; }
    if (act === 'login-id') { await handleIdLogin(); return; }
    if (act === 'reset-password') {
      const idEl = document.getElementById('auth-id');
      state.signup.resetId = (idEl ? idEl.value : state.authId).trim();
      state.resetTarget = ''; state.resetSent = ''; state.authError = '';
      state.authMode = 'reset';
      render(); return;
    }
    if (act === 'reset-back') {
      /* Same rule as leaving 회원가입: coming back to the start clears what was
         being typed, here and on the login screen underneath. */
      resetSignup();
      state.authMode = 'signin';
      state.resetTarget = ''; state.resetSent = ''; state.authError = '';
      render(); return;
    }
    if (act === 'reset-lookup') { await handleResetLookup(); return; }
    if (act === 'reset-send') { await handleResetSend(); return; }
    if (act === 'reset-resend') { await handleResetSend({ resend: true }); return; }
    if (act === 'import-local') { await handleImportLocal(); return; }
    if (act === 'dismiss-import') {
      if (!await ask({ title: '가져오지 않을까요?',
                       body: '이 기록은 계정에 올라가지 않고, 다음부터 다시 묻지 않습니다.',
                       confirmText: '가져오지 않기', danger: true })) return;
      try { localStorage.setItem(importDismissKey(), '1'); } catch (_) {}
      state.pendingImport = null;
      render(); return;
    }
    /* FITLOG wordmark, shown on every pre-login screen. On the login screen
       itself this is a no-op re-render; from anywhere inside signup or the
       password-reset flow it discards whatever was typed and jumps straight
       back to login, in one tap, instead of stepping back screen by screen. */
    if (act === 'auth-home') {
      resetSignup();
      state.resetTarget = ''; state.resetSent = ''; state.authError = '';
      state.authMode = 'signin';
      render(); return;
    }
    if (act === 'go-signup') {
      resetSignup();
      state.authMode = 'signup';
      render(); return;
    }
    if (act === 'signup-back') {
      /* Step 1's back arrow leaves the wizard entirely rather than dead-ending;
         anywhere else it is a normal step back. */
      if (state.signupStep > 1) { state.signupStep -= 1; state.authError = ''; }
      else { resetSignup(); state.authMode = 'signin'; }
      render(); return;
    }
    if (act === 'signup-next') { await handleSignupNext(); return; }
    if (act === 'su-gender') {
      state.signup.gender = state.signup.gender === btn.dataset.val ? '' : btn.dataset.val;
      /* Repaint just the segmented control — a full render would blur whatever
         text field the user was in. */
      document.querySelectorAll('[data-act="su-gender"]').forEach(b => {
        b.classList.toggle('on', b.dataset.val === state.signup.gender);
      });
      return;
    }
    if (act === 'onboarding-save') { await handleOnboardingSave(); return; }
    if (act === 'save-profile') { await handleSaveProfile(); return; }
    if (act === 'edit-profile') {
      const p = state.profile || {};
      state.signup = {
        ...state.signup,
        name: p.name || '', gender: p.gender || '',
        birthYear: p.birthYear || '',
        /* 저장된 값은 항상 cm·kg 이고, 폼에는 지금 선택된 단위로 채웁니다. */
        heightCm: p.heightCm ? toDisplayHeight(p.heightCm) : '',
        weightKg: p.weightKg ? toDisplayWeight(p.weightKg) : '',
      };
      state.profileEditing = true;
      render(); return;
    }
    if (act === 'close-profile') { state.profileEditing = false; render(); return; }
    if (act === 'show-login') {
      state.guest = false;
      localStorage.removeItem('fitlog-guest');
      state.authError = '';
      render(); return;
    }
    if (act === 'logout') { await handleLogout(); return; }
    if (act === 'delete-account') { await handleDeleteAccount(); return; }
    if (act === 'clear-local-data') { await handleClearLocalData(); return; }
    if (act === 'set-rest-dur') { setRestDuration(Number(btn.dataset.val)); render(); return; }
    if (act === 'toggle-rest-timer') {
      const on = !restTimerOn();
      setRestTimerOn(on);
      /* Turning it off mid-rest should clear what is already on screen. */
      /* cancelRestTimer() 를 씁니다. 예전에는 state 만 비워서, 트레이에 뜬
       "휴식 중 · 1:00 남음" 알림이 영영 안 지워지고(그걸 지울 코드가 state 를
       필요로 하는데 이미 비었습니다), localStorage 에 남은 기록 때문에 설정을
       다시 켜면 취소한 휴식이 되살아났습니다. */
    if (!on && state.restTimer) cancelRestTimer();
      render();
      return;
    }
    if (act === 'toggle-haptics') { setHapticsOn(!hapticsOn()); render(); return; }
    /* render() 끝의 syncWakeLock() 이 켜고 끄는 일을 실제로 합니다 — 여기서
       직접 잡거나 놓지 않습니다. 상태를 바꾸는 곳과 그 상태를 화면·장치에
       반영하는 곳을 하나로 유지하려는 것입니다. */
    if (act === 'toggle-wake-lock') { setWakeLockOn(!wakeLockOn()); render(); return; }
    if (act === 'set-start-tab') { setStartTab(btn.dataset.val); render(); return; }
    if (act === 'set-week-start') { setWeekStartsMon(btn.dataset.val === 'mon'); render(); return; }
    if (act === 'set-unit-weight') { setUnitWeight(btn.dataset.val); render(); return; }
    if (act === 'set-unit-height') { setUnitHeight(btn.dataset.val); render(); return; }
    if (act === 'set-font-scale') { setFontScale(Number(btn.dataset.val)); applyFontScale(); render(); return; }
    if (act === 'set-theme') { setThemeMode(btn.dataset.val); render(); return; }
  }

  /* ── Input handler ───────────────────────── */
  async function onInput(e) {
    const t = e.target;
    /* 직접 추가할 운동 이름을 state 에 담아 둡니다. 예전에는 이 칸만 state 에
       연결돼 있지 않아서(바로 옆 검색 칸은 연결돼 있습니다), 다시 그리는 일이
       한 번이라도 생기면 — 다른 운동의 ⓘ 를 열어 보거나, 나만의 운동 하나를
       지우거나, 백그라운드 동기화가 끝나기만 해도 — 적던 이름이 사라졌습니다.
       다시 그리지는 않습니다: 여기서 render 하면 글자를 칠 때마다 포커스가
       날아가고 한글 조합이 끊깁니다. */
    if (t.dataset.act === 'custom-name') { state.customName = t.value; return; }
    /* Signup fields write straight to state and deliberately do NOT re-render:
       replacing the DOM mid-keystroke would drop focus and, on phones, dismiss
       the keyboard. Feedback is painted into the existing nodes instead. */
    if (t.dataset.su) {
      state.signup[t.dataset.su] = t.value;
      /* Drop a stale error the moment editing resumes. Leaving "이메일 형식이
         올바르지 않습니다" on screen above a field the user has since fixed
         reads as though the app hasn't noticed. Removed from the DOM directly
         for the same reason nothing else here re-renders — focus. */
      if (state.authError) {
        state.authError = '';
        document.querySelector('.login-error')?.remove();
      }
      if (t.dataset.su === 'username') scheduleIdCheck(t.value);
      else paintSignupHints();
      return;
    }
    if (t.dataset.run != null) {
      const val = parseNum(t.value);
      state.session.run[t.dataset.run] = val !== '' ? val : t.value;
      await persist();
      paintFinishBar();
      return;
    }
    if (t.dataset.act === 'search-ex') {
      state.exerciseSearch = t.value;
      const list = document.querySelector('.pick-list');
      if (list && state.pickerPart) list.innerHTML = buildPickItems(state.pickerPart);
    }
    /* 피커 검색과 같은 이유로 render() 를 부르지 않습니다 — #app 을 통째로
       갈아 끼우면 지금 치고 있는 input 이 파괴되고 키보드가 내려갑니다. */
    if (t.dataset.act === 'search-log') {
      state.logSearch = t.value;
      const box = document.querySelector('.search-results');
      if (box) box.innerHTML = buildSearchResults();
    }
  }

  async function onChangeEvt(e) {
    const t = e.target;
    if (t.dataset.act === 'change-date' && t.value) {
      if (!await confirmLeavePast()) { render(); return; }
      await persist();
      await loadDay(t.value);
    }
  }

  /* ── Signup helpers ───────────────────────────────────────────────────────
     Availability is checked while typing rather than at submit, because
     "이미 사용 중인 아이디입니다" arriving only after you have filled in a
     password, an email and a profile is the worst possible moment to learn it.

     Debounced: every keystroke would otherwise be a Firestore read, and the
     answer for a half-typed name is noise. The token guard drops responses that
     arrive out of order — a slow lookup for "chan" must not overwrite a fresh
     one for "chanmin". */
  let idCheckTimer = 0;
  let idCheckToken = 0;

  function scheduleIdCheck(raw) {
    clearTimeout(idCheckTimer);
    const id = Cloud.normalizeUsername(raw);
    const bad = Cloud.usernameError(id);
    if (bad) {
      state.idCheck = { id, status: 'invalid', message: bad };
      paintSignupHints();
      return;
    }
    state.idCheck = { id, status: 'checking', message: '' };
    paintSignupHints();
    const token = ++idCheckToken;
    idCheckTimer = setTimeout(async () => {
      let free = false;
      /* Cloud.uid() is null in the signup wizard (no account yet) and set in
         the onboarding gate. Passing it means a signed-in user re-entering a
         name they already reserved is told it is available, instead of being
         refused their own 아이디 with no way forward. */
      try { free = await Cloud.isUsernameAvailableFor(id, Cloud.uid()); }
      catch (_) {
        if (token !== idCheckToken) return;
        /* Offline or rules blocked the read — say nothing rather than claim the
           name is free and fail at submit. */
        state.idCheck = { id, status: '', message: '' };
        paintSignupHints();
        return;
      }
      if (token !== idCheckToken) return;
      state.idCheck = { id, status: free ? 'free' : 'taken', message: free ? '' : '이미 사용 중인 아이디입니다' };
      paintSignupHints();
    }, 420);
  }

  function paintSignupHints() {
    const s = state.signup;
    const chk = state.idCheck;
    const idField = document.querySelector('[data-su="username"]');
    if (idField) {
      /* The hint is always the element right after its input. Searching the
         parent instead would find whichever .field-hint happens to come first,
         which is the wrong one on any screen that has more than one. */
      const hint = idField.nextElementSibling;
      if (hint && hint.classList.contains('field-hint')) {
        const live = chk.id === Cloud.normalizeUsername(s.username) && chk.status;
        hint.className = 'field-hint' + (
          !live ? '' :
          chk.status === 'free' ? ' ok' :
          chk.status === 'checking' ? ' muted' : ' bad');
        hint.textContent = !live ? '나중에 바꿀 수 없으니 신중히 정해 주세요.'
          : chk.status === 'checking' ? '확인 중…'
          : chk.status === 'free' ? '사용할 수 있는 아이디예요'
          : (chk.message || '사용할 수 없는 아이디입니다');
      }
    }
    const pw2 = document.querySelector('[data-su="password2"]');
    if (pw2) {
      const hint = pw2.nextElementSibling;
      if (hint && hint.classList.contains('field-hint')) {
        if (s.password2) {
          const match = s.password === s.password2;
          hint.className = 'field-hint ' + (match ? 'ok' : 'bad');
          hint.textContent = match ? '비밀번호가 일치합니다' : '비밀번호가 일치하지 않습니다';
        } else if ((s.password || '').length && s.password.length < 6) {
          hint.className = 'field-hint bad';
          hint.textContent = '6자 이상 입력해 주세요';
        } else {
          hint.className = 'field-hint';
          hint.textContent = '';
        }
      }
    }
  }

  /* Clears the signup wizard AND the sign-in fields behind it.

     Both are "what was being typed before we came back to the start", and they
     were being treated differently: leaving 회원가입 wiped the wizard but left a
     half-typed 아이디 and password sitting on the login screen underneath. On a
     shared or borrowed phone that is somebody's credentials left on screen, and
     even alone it is confusing — the screen looks like a fresh start while
     holding old input.

     Callers that want a value prefilled afterwards set it after calling this;
     finishing 회원가입 does exactly that with the new 아이디. */
  function resetSignup() {
    state.signup = {
      username: '', password: '', password2: '', email: '',
      name: '', gender: '', birthYear: '', heightCm: '', weightKg: '',
    };
    state.idCheck = { id: '', status: '', message: '' };
    state.signupStep = 1;
    state.authError = '';
    state.authId = '';
    state.authPassword = '';
  }

  /* 폼에 적힌 키·몸무게는 지금 선택된 단위(예: in·lb) 기준입니다 — 화면에
     보여주는 값 그대로를 사용자가 typing 합니다. 실제로 저장·전송하는
     값은 항상 cm·kg 이어야 하므로, 폼을 빠져나가는 이 지점에서만
     변환합니다. 그래야 단위를 몇 번 바꿔도 기록 자체(서버에 쌓이는 값)는
     흔들리지 않습니다. */
  function collectProfile() {
    const s = state.signup;
    return {
      name: s.name, gender: s.gender,
      birthYear: s.birthYear,
      heightCm: fromDisplayHeight(s.heightCm),
      weightKg: fromDisplayWeight(s.weightKg),
    };
  }

  /* Blocks moving on only for things that make the account impossible to
     create. The profile step validates nothing — it is allowed to be empty. */
  function signupStepError() {
    const s = state.signup;
    if (state.signupStep === 1) {
      const id = Cloud.normalizeUsername(s.username);
      const bad = Cloud.usernameError(id);
      if (bad) return bad;
      if (state.idCheck.id === id && state.idCheck.status === 'taken') return '이미 사용 중인 아이디입니다.';
      if ((s.password || '').length < 6) return '비밀번호는 6자 이상이어야 합니다.';
      if (s.password !== s.password2) return '비밀번호가 일치하지 않습니다.';
      return '';
    }
    if (state.signupStep === 2) {
      const mail = (s.email || '').trim();
      if (!mail) return '이메일을 입력해 주세요.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return '이메일 형식이 올바르지 않습니다.';
      return '';
    }
    /* 3단계(신체 정보)도 구글 가입과 같은 기준으로 봅니다.
       예전에는 여기서 아무것도 검사하지 않고 통과시킨 뒤 '설정 완료' 로
       표시해 버려서, 비밀번호로 가입한 사람은 프로필이 통째로 비어 있어도
       그냥 들어왔습니다. 구글로 가입한 사람은 같은 항목을 전부 채워야만
       들어올 수 있는데요. 같은 앱에서 들어온 문에 따라 다른 데이터가 쌓이면
       분석 화면이 누구에게는 되고 누구에게는 안 됩니다. */
    if (state.signupStep === 3) return onboardingMissing();
    return '';
  }

  async function handleSignupNext() {
    if (state.authBusy) return;
    const err = signupStepError();
    if (err) { state.authError = err; render(); return; }
    if (state.signupStep < 3) {
      state.signupStep += 1;
      state.authError = '';
      render();
      return;
    }
    await submitSignup(collectProfile());
  }

  /* Signing up ends at the login screen, not inside the app.
     The wizard already asked for the 아이디, the password and the profile, so
     dropping the finished account straight into the onboarding gate ("거의 다
     됐어요") was asking for all of it a second time — the gate exists for
     Google accounts, which arrive with no 아이디 at all, and this path is the
     one case that has definitively already answered it.

     Firebase signs the new account in as a side effect of creating it, so
     finishing here means explicitly signing back out. The cost is one extra
     password entry; in exchange the account is never half-entered, and the
     아이디 is carried over to the login field so only the password is left. */
  async function submitSignup(prof) {
    const s = state.signup;
    const id = Cloud.normalizeUsername(s.username);
    state.authBusy = true;
    state.authError = '';
    state.signingUp = true;
    render();
    try {
      /* 감싸지 않으면 파이어스토어가 응답 없이 멈출 때 authBusy 와 signingUp
         이 둘 다 켜진 채로 굳습니다. signingUp 이 켜져 있으면 인증 리스너까지
         죽어서(방금 만든 계정에 반응하지 않게 하려는 장치입니다) 그 뒤로는
         어떤 로그인도 앱에 반영되지 않습니다. */
      const user = await withTimeout(Cloud.signUpUsername({
        username: id, password: s.password, email: s.email, profile: prof,
      }), 25000, '회원가입');
      /* The gate keys off this flag, so record the answer now: the next login
         skips the profile read entirely instead of waiting on it. */
      if (user && user.uid) { markSetUp(user.uid); rememberUsername(user.uid, id); }
      try { await Cloud.signOut(); } catch (_) {}

      resetSignup();
      state.authMode = 'signin';
      state.authBusy = false;
      state.signingUp = false;
      state.authId = id;
      state.authPassword = '';
      render();
      toast('가입이 완료되었습니다. 로그인해 주세요');
    } catch (err) {
      state.authBusy = false;
      state.signingUp = false;
      /* createUser may have succeeded before a later step threw, which would
         leave the browser signed in as a half-built account sitting behind the
         login screen. Drop it so the next attempt starts clean. */
      try { if (Cloud.uid()) await Cloud.signOut(); } catch (_) {}
      /* A taken name is a step-1 problem — send them back to the field that
         needs fixing instead of leaving them stranded on the profile step. */
      if (err && err.code === 'fitlog/username-taken') {
        state.signupStep = 1;
        state.idCheck = { id, status: 'taken', message: '이미 사용 중인 아이디입니다' };
      }
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  async function handleSaveProfile() {
    if (state.authBusy) return;
    /* 온보딩과 같은 검사를 여기서도 합니다. 예전에는 검사가 없어서, 키를
       175 에서 17 로 잘못 고치고 저장하면 sanitizeProfile 이 범위 밖이라며
       조용히 빼 버리는데 화면에는 "프로필을 저장했습니다" 가 떴습니다.
       설정의 키 표기는 사라지고(지워진 것처럼 보임), 서버에는 175 가 그대로
       남아 다음에 앱을 켜면 되살아납니다 — 저장한 것도 아니고 안 한 것도
       아닌 상태입니다. 받을 수 없는 값이면 받지 않았다고 말합니다. */
    const bad = onboardingMissing();
    if (bad) { toast(bad); return; }
    state.authBusy = true;
    render();
    try {
      state.profile = { ...(await Cloud.saveProfile(collectProfile())), username: state.profile?.username || '' };
      state.profileEditing = false;
      state.authBusy = false;
      render();
      toast('프로필을 저장했습니다');
    } catch (err) {
      state.authBusy = false;
      /* 시트를 닫지 않습니다. 닫으면 방금 적은 이름·성별·출생연도·키·몸무게를
         전부 다시 입력해야 하는데, 실패 이유는 대개 잠깐의 네트워크 문제라
         한 번 더 누르면 되는 일입니다. */
      render();
      toast('프로필 저장에 실패했습니다 — 잠시 후 다시 눌러 주세요');
      console.warn('profile save failed', err);
    }
  }

  /* Which required field is still empty, as a message — or '' when the form is
     complete. Ranges are the same ones sanitizeProfile enforces before writing,
     so nothing can be accepted here and then silently dropped on save. */
  function onboardingMissing() {
    const s = state.signup;
    if (!String(s.name || '').trim()) return '이름을 입력해 주세요.';
    if (!s.gender) return '성별을 선택해 주세요.';

    const year = Number(s.birthYear);
    const thisYear = new Date().getFullYear();
    if (!s.birthYear) return '출생연도를 선택해 주세요.';
    if (!Number.isFinite(year) || year < 1900 || year > thisYear) return '출생연도가 올바르지 않습니다.';

    /* 폼 값은 지금 단위 기준이라, 진짜 범위(cm·kg)로 바꾼 뒤에 검사합니다.
       메시지에 적는 숫자만 지금 단위에 맞게 다시 보여줍니다. */
    if (!String(s.heightCm || '').trim()) return '키를 입력해 주세요.';
    const cm = fromDisplayHeight(s.heightCm);
    if (!Number.isFinite(cm) || cm < 100 || cm > 250) {
      return `키는 ${Math.round(toDisplayHeight(100))}~${Math.round(toDisplayHeight(250))}${heightUnitLabel()} 사이로 입력해 주세요.`;
    }

    if (!String(s.weightKg || '').trim()) return '몸무게를 입력해 주세요.';
    const kg = fromDisplayWeight(s.weightKg);
    /* Strictly above 20, matching sanitizeProfile — a value it would drop must
       not be accepted here, or the field would look saved and come back empty. */
    if (!Number.isFinite(kg) || kg <= 20 || kg > 300) {
      return `몸무게는 ${Math.round(toDisplayWeight(21))}~${Math.round(toDisplayWeight(300))}${weightUnitLabel()} 사이로 입력해 주세요.`;
    }

    return '';
  }

  async function handleOnboardingSave() {
    if (state.authBusy) return;
    const s = state.signup;
    const id = Cloud.normalizeUsername(s.username);
    const bad = Cloud.usernameError(id);
    if (bad) { state.authError = bad; render(); return; }

    /* Every field is required here. The gate is shown once per account, so it
       is the one moment where asking for all of it is reasonable — and the
       balance and analysis screens are built on these numbers. */
    const missing = onboardingMissing();
    if (missing) { state.authError = missing; render(); return; }

    state.authBusy = true;
    state.authError = '';
    render();
    try {
      /* withTimeout 으로 감쌉니다. 파이어스토어는 닿지 않을 때 '거부' 가 아니라
         '영영 응답 없음' 으로 멈추는 경우가 있어서, 감싸지 않으면 authBusy 가
         true 인 채로 굳습니다. 그런데 이 화면에는 로그아웃도, 뒤로도, 다른
         버튼도 없습니다 — 앱이 통째로 잠겨 새로고침(설치형 PWA 라면 강제
         종료) 말고는 길이 없어집니다. 이 파일의 다른 클라우드 호출은 전부
         감싸져 있는데 여기만 빠져 있었습니다. */
      await withTimeout(Cloud.claimUsername(id), 12000, '아이디 저장');
      await withTimeout(Cloud.saveProfile(collectProfile()), 12000, '프로필 저장');

      /* Read it back before believing it.

         This gate is the one screen that must not be shown twice, and the only
         thing that stops it coming back is users/{uid}.username actually being
         on the server. Trusting the write and caching "set up" locally is how
         an account ends up looking finished on this device while every other
         device — and this one after a cache clear — keeps asking again. So the
         cache is only written once the server has confirmed the value. */
      const saved = await withTimeout(Cloud.loadProfile(state.user ? state.user.uid : null), 12000, '확인');
      if (!saved || !saved.username) {
        const e = new Error('username did not persist');
        e.code = 'fitlog/claim-unverified';
        throw e;
      }

      state.profile = saved;
      if (state.user) { markSetUp(state.user.uid); rememberUsername(state.user.uid, id); }
      state.onboarding = false;
      state.authBusy = false;
      resetSignup();
      render();
      toast('설정을 저장했습니다');
    } catch (err) {
      state.authBusy = false;

      /* The account turned out to already have an 아이디 — this screen should
         never have been shown. Refusing the new name is right, but stopping
         here would strand the user on a setup screen they cannot complete and
         cannot leave. Use the name the account actually holds and let them in;
         nothing was missing except the app's knowledge of it. */
      if (err && err.code === 'fitlog/username-locked' && err.held) {
        rememberUsername(state.user ? state.user.uid : '', err.held);
        if (state.user) markSetUp(state.user.uid);
        try { state.profile = await Cloud.loadProfile(state.user ? state.user.uid : null); } catch (_) {}
        state.onboarding = false;
        state.authError = '';
        resetSignup();
        render();
        toast(`이미 등록된 아이디로 로그인했습니다 · @${err.held}`);
        return;
      }

      if (err && err.code === 'fitlog/username-taken') {
        state.idCheck = { id, status: 'taken', message: '이미 사용 중인 아이디입니다' };
      }
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  /* ── Action handlers ─────────────────────── */
  /* One tap from "등이 부족해요" to a session with 등 already open and its
     exercise picker up. Going through loadDay first means today's existing
     record is loaded rather than overwritten, so tapping the suggestion after
     already training something else adds to the day instead of replacing it. */
  /* Closes out the day and drops the user straight into the summary — the
     point of the button is to see what you did, not to watch a toast. */
  async function handleFinishDay() {
    const s = state.session;
    if (!s) return;
    s.completed = true;
    s.completedAt = Date.now();
    /* 과거 기록에서는 persist() 가 일부러 저장을 미룹니다(pastDirty 만 세우고
       돌아갑니다). 그대로 두면 '마치기' 가 아무것도 쓰지 않은 채 디스크에서
       기록을 다시 읽어 오고, 요약 화면은 방금 추가한 운동도 없고 배지도
       "진행 중" 인 옛 기록을 보여 줍니다. 그러면서 토스트만 저장했다고
       말합니다. 마치기는 명시적인 확정이므로 여기서는 실제로 씁니다. */
    if (state.editingPast) {
      /* 붙잡아 두던 걸 잠깐 풀고 평소와 똑같은 저장 경로를 태웁니다. 그러면
         클라우드 동기화까지 다른 저장과 동일하게 지나갑니다. 저장 바는
         깨끗해진 상태로 되돌려 놓습니다. */
      state.editingPast = false;
      await persist();
      state.pastDirty = false;
      state.pastBaseline = JSON.stringify(state.session);
      state.editingPast = true;
    } else {
      await persist();
    }
    /* persist() is queued; state.sessions is what the summary reads from, so
       refresh it here rather than racing the write. */
    state.sessions = await WorkoutDB.getAllSessions();
    state.summaryDate = s.date;
    render();
    toast(`${relDayLabel(s.date)} 운동을 저장했습니다`);
  }

  async function handleStartPart(partId) {
    if (!PARTS.some(p => p.id === partId)) return;
    await loadDay(todayISO());
    const s = state.session;
    if (!s.parts.includes(partId)) {
      s.parts.push(partId);
      await persist();
    }
    state.pickerPart = partId;
    state.pickSelection = [];
    state.exerciseSearch = '';
    render();
  }

  /* 타일을 누르면 '고르기' 만 합니다. 실제 반영은 아래 버튼(commit-parts)이
     합니다. 예전에는 누르는 즉시 반영돼서, 부위를 잘못 누르면 그 자리에서
     "이 부위 기록도 지울까요?" 가 떴습니다 — 고르는 중인 사람에게 되돌릴 수
     없는 질문을 던지는 셈이었습니다. 이제 고르는 동안에는 아무것도 사라지지
     않고, 지울 것이 있으면 확정하는 순간 한 번만 묻습니다. */
  function handleTogglePart(partId) {
    const s = state.session;
    const next = stagedParts(s).slice();
    const i = next.indexOf(partId);
    if (i === -1) next.push(partId); else next.splice(i, 1);
    state.partSelection = next;
    render();
  }

  async function handleCommitParts() {
    const s = state.session;
    const next = state.partSelection;
    if (!next) return;
    const removed = s.parts.filter(id => !next.includes(id));

    /* 빼는 부위 중 실제로 기록이 들어 있는 것만 묻습니다. 비어 있는 부위를
       빼는 데까지 확인을 받으면, 잘못 눌렀다 되돌리는 흔한 동작이 매번
       대화 상자를 지나가야 합니다. */
    const losing = removed.filter(id =>
      s.exercises.some(e => e.part === id) || (id === 'run' && hasRunData(s.run)));
    if (losing.length) {
      const names = losing.map(id => (PARTS.find(p => p.id === id) || {}).label || id).join(', ');
      if (!await ask({ title: '이 부위 기록도 지울까요?',
                       body: `${names} — 부위를 빼면 그 부위에 기록한 운동이 함께 사라집니다.`,
                       confirmText: '지우기', danger: true })) return;
    }
    for (const id of removed) {
      s.exercises = s.exercises.filter(e => e.part !== id);
      if (id === 'run') s.run = { km:'', minutes:'', notes:'' };
    }
    /* PARTS 순서를 따릅니다 — 고른 순서대로 두면 같은 조합인데 날마다 화면
       순서가 달라집니다. */
    s.parts = PARTS.filter(p => next.includes(p.id)).map(p => p.id);
    state.partSelection = null;
    state.partSheet = false;
    await persist();
    /* 부위 그리드가 통째로 운동 목록으로 바뀌는 자리 — 앞뒤가 다른 화면이라
       겹쳐 넘기는 편이 읽기 쉽습니다. */
    softRender();
  }

  /* Appends one exercise to the session, pre-filling the first set from the
     last time this exercise was logged. Does NOT touch sheet state or render —
     handleCommitPicks drives several of these and then renders once. */
  function addExerciseToSession(partId, name, exId) {
    const s = state.session;
    if (!name || s.exercises.some(e => e.part === partId && e.name === name)) return false;
    const last = lastLog(name, s.date);
    /* Stretches record seconds, not kilos. Stamp the flag onto the session
       exercise so the row keeps reading as a hold even if the library entry
       is ever renamed or removed, and start it at the 30초 everyone means by
       "정적 스트레칭 한 세트" rather than an empty pad. */
    const lib = findExercise(exId) || findExercise(name) ||
                state.customExercises.find(e => e.id === exId || e.name === name);
    const hold = !!(lib && lib.hold);
    const firstSet = last?.sets?.[0] || { kg:'', reps: hold ? 30 : '' };
    s.exercises.push({
      id: exId || uid(), part: partId, name,
      ...(hold ? { hold: true } : {}),
      sets: [{ id: uid(), kg: firstSet.kg, reps: firstSet.reps, done: false, warmup: false }],
    });
    if (!s.parts.includes(partId)) s.parts.push(partId);
    return true;
  }

  /* Commit every exercise queued in the picker in one shot. */
  async function handleCommitPicks(partId) {
    const picks = state.pickSelection.slice();
    if (!picks.length) return;

    /* 루틴을 만드는 중이면 오늘 기록이 아니라 그 루틴에 담습니다. 화면도
       기록으로 돌아가지 않고 만들던 자리에 그대로 남습니다. */
    if (state.routineEdit) {
      const d = state.routineEdit;
      let added = 0;
      for (const p of picks) {
        const part = p.part || partId;
        if (d.exercises.some(e => e.part === part && e.name === p.name)) continue;
        d.exercises.push({ id: p.exId || uid(), part, name: p.name });
        added++;
      }
      closeAllSheets();
      render();
      toast(added ? `${added}개 운동을 담았습니다` : '이미 담겨 있습니다');
      return;
    }

    let n = 0;
    let firstId = null;
    const before = new Set(state.session.exercises.map(e => e.id));
    for (const p of picks) if (addExerciseToSession(p.part || partId, p.name, p.exId)) n++;
    /* Scroll to the first genuinely new card. Diffing against the ids that
       existed beforehand rather than trusting p.exId, because an exercise added
       from the custom list gets a generated id that the pick never carried.
       첫 카드는 스크롤과 함께 눈에 띄는 테두리 펄스(flashExercise)를 받으니,
       나머지 새 카드들만 살짝 커지며 나타나는 쪽을 씁니다 — 둘 다 같은
       카드에 겹치면 애니메이션 속성이 서로 덮어써 하나만 재생됩니다. */
    for (const ex of state.session.exercises) {
      if (!before.has(ex.id)) {
        if (!firstId) firstId = ex.id;
        else pendingEnterExIds.add(ex.id);
      }
    }
    await persist();
    closeAllSheets();
    if (firstId) flashExercise(firstId);
    render();
    toast(n > 1 ? `${n}개 운동을 추가했습니다` : '운동을 추가했습니다');
  }

  /* Saves a user-defined exercise and queues it in the picker rather than
     committing straight away, so the sheet stays open and it can be added
     together with whatever else is already selected. */
  async function handleAddCustom(partId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lib = libraryFor(partId);
    const existing = lib.find(e => e.name === trimmed);
    if (!existing) {
      const item = { id: 'c_' + uid(), part: partId, name: trimmed, custom: true };
      await WorkoutDB.putCustomExercise(item);
      await cloudSync(() => Cloud.saveCustom(item));
      state.customExercises.push(item);
    }
    const id = existing ? (existing.id || '') : state.customExercises[state.customExercises.length - 1].id;
    const already = (state.session?.exercises || []).some(e => e.part === partId && e.name === trimmed);
    if (!already && !state.pickSelection.some(x => x.name === trimmed)) {
      state.pickSelection.push({ part: partId, name: trimmed, exId: id });
    }
    state.exerciseSearch = '';
    render();
  }

  async function handleDeleteCustom(id) {
    const item = state.customExercises.find(e=>e.id===id);
    if (!item) return;
    if (!await ask({ title: '운동을 삭제할까요?',
                     body: `'${item.name}'을(를) 내 운동 목록에서 지웁니다.`,
                     confirmText: '삭제', danger: true })) return;
    await WorkoutDB.deleteCustomExercise(id);
    state.customExercises = state.customExercises.filter(e=>e.id!==id);
    await cloudSync(() => Cloud.deleteCustom(id));
    render();
  }

  async function handleDeleteEx(exId) {
    /* 지우고 나서 다시 그리면 그 순간 카드가 이미 없어, 사라지는 걸 태울
       대상이 없습니다. 그래서 상태를 바꾸기 '전에' 실제 카드를 먼저
       움츠러들게 하고, 그게 끝나야 지웁니다. */
    await animateRemoval(document.querySelector(`.ex-card[data-exid="${CSS.escape(exId)}"]`));
    state.session.exercises = state.session.exercises.filter(e=>e.id!==exId);
    await persist(); render();
  }

  /* ── 루틴 ────────────────────────────────────────────────────────────────
     처음에는 "오늘 구성한 걸 그대로 저장" 하나로 뒀는데, 그러면 루틴이
     '오늘 하다 보니 생긴 것' 이 되어 버립니다. 무엇이 루틴이고 무엇이 오늘
     기록인지 경계가 흐려지고, 만들 생각이 없었는데 버튼이 계속 보입니다.

     그래서 만드는 자리를 따로 뒀습니다. 루틴은 전용 화면에서 이름을 붙이고
     운동을 골라 '만드는' 것이고, 오늘 기록은 오늘 기록입니다. 둘이 섞이지
     않습니다.

     저장하는 것은 '무엇을 할지'(부위와 운동)뿐입니다. 무게와 횟수는 넣지
     않습니다 — 그건 그날 몸 상태를 보고 정하는 것이고, 루틴에 굳혀 두면
     오늘과 상관없는 숫자가 딸려옵니다. */
  async function persistRoutines() {
    for (const r of state.routines) await WorkoutDB.putRoutine(clone(r));
    cloudSync(() => Cloud.saveRoutines(state.routines));
  }

  function routineParts(r) {
    const ids = [...new Set((r.exercises || []).map(e => e.part))];
    return orderedParts(ids);
  }

  /* ── 만들기/고치기 화면 ── */
  function openRoutineEditor(id) {
    const src = id ? state.routines.find(r => r.id === id) : null;
    state.routineEdit = src
      ? { id: src.id, name: src.name, exercises: (src.exercises || []).map(e => ({ ...e })) }
      : { id: null, name: '', exercises: [] };
    state.routineSheet = false;
    render();
    requestAnimationFrame(() => document.getElementById('routine-name')?.focus());
  }

  async function handleSaveRoutineEdit() {
    const d = state.routineEdit;
    if (!d) return;
    const name = (document.getElementById('routine-name')?.value || d.name).trim();
    if (!name) { toast('루틴 이름을 적어 주세요'); document.getElementById('routine-name')?.focus(); return; }
    if (!d.exercises.length) { toast('운동을 하나 이상 골라 주세요'); return; }
    const row = {
      id: d.id || uid(),
      name: name.slice(0, 40),
      parts: routineParts(d).map(p => p.id),
      exercises: d.exercises.map(e => ({ id: e.id, part: e.part, name: e.name })),
      usedAt: d.id ? (state.routines.find(r => r.id === d.id)?.usedAt || 0) : 0,
    };
    const at = state.routines.findIndex(r => r.id === row.id);
    if (at >= 0) state.routines[at] = row; else state.routines.unshift(row);
    await persistRoutines();
    state.routineEdit = null;
    render();
    toast(at >= 0 ? '루틴을 수정했습니다' : `"${row.name}" 루틴을 만들었습니다`);
  }

  async function closeRoutineEditor() {
    const d = state.routineEdit;
    const name = (document.getElementById('routine-name')?.value || '').trim();
    /* 뭔가 적거나 고른 게 있을 때만 물어봅니다. 빈 화면에서 나가는데 확인을
       받는 건 방해일 뿐입니다. */
    if (d && (name || d.exercises.length)) {
      if (!await ask({ title: '만들던 루틴을 버릴까요?', body: '저장하지 않은 내용은 사라집니다.', confirmText: '나가기', danger: true })) return;
    }
    state.routineEdit = null;
    render();
  }

  function renderRoutineEditor() {
    const d = state.routineEdit;
    const byPart = routineParts(d).map(part => {
      const list = d.exercises.filter(e => e.part === part.id);
      return `<div class="rt-part">
        <div class="rt-part-head">
          <span class="dsum-dot" style="background:${part.color}"></span>${part.label}
          <span class="rt-part-count">${list.length}개</span>
        </div>
        ${list.map(e => `<div class="rt-ex">
          <span>${esc(e.name)}</span>
          <button class="custom-del" data-act="rt-del-ex" data-part="${esc(e.part)}" data-name="${esc(e.name)}">빼기</button>
        </div>`).join('')}
      </div>`;
    }).join('');

    const tiles = PARTS.filter(p => p.kind === 'weight').map(p => {
      const n = d.exercises.filter(e => e.part === p.id).length;
      return `<button class="rt-tile${n ? ' on' : ''}" style="--pt-color:${p.color}" data-act="rt-pick" data-part="${p.id}">
        <span class="pt-icon">${PART_ICONS[p.id] || ''}</span>
        <span class="pt-name">${p.label}</span>
        <span class="pt-count">${n ? `${n}개` : '고르기'}</span>
      </button>`;
    }).join('');

    return `<div class="detail-screen${overlayIn('routine')}">
      <header class="topbar">
        <button class="btn-icon ghost" data-act="close-routine-editor" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">${d.id ? '루틴 수정' : '새 루틴 만들기'}</div>
        <div class="topbar-spacer"></div>
        <button class="btn-today" data-act="save-routine-edit">저장</button>
      </header>
      <main class="screen">
        <label class="field-label" for="routine-name">루틴 이름</label>
        <input class="login-input" id="routine-name" maxlength="40" value="${esc(d.name)}"
               placeholder="예: 가슴·삼두 데이">

        <div class="sec-head" style="margin-top:22px"><div class="sec-title">운동 고르기</div></div>
        <div class="part-grid">${tiles}</div>

        ${d.exercises.length ? `
          <div class="sec-head" style="margin-top:22px">
            <div class="sec-title">담은 운동</div>
            <span class="balance-window">${d.exercises.length}개</span>
          </div>
          ${byPart}` : `
          <p class="balance-empty" style="margin-top:18px">부위를 눌러 이 루틴에 넣을 운동을 고르세요.</p>`}
        <div style="height:24px"></div>
      </main>
    </div>`;
  }

  /* ── 목록(불러오기) ── */
  function renderRoutineSheet() {
    const rows = state.routines.map(r => `
      <div class="routine-row">
        <button class="routine-main" data-act="apply-routine" data-id="${esc(r.id)}">
          <div class="routine-name">${esc(r.name)}</div>
          <div class="routine-sub">${esc(routineParts(r).map(p => p.label).join(', ') || '빈 루틴')} · ${(r.exercises || []).length}개 운동</div>
        </button>
        <button class="rt-edit" data-act="edit-routine" data-id="${esc(r.id)}" aria-label="수정">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button class="custom-del" data-act="del-routine" data-id="${esc(r.id)}">삭제</button>
      </div>`).join('');
    return `<div class="sheet-backdrop${overlayIn('routines')}">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div>
            <div class="sheet-title">내 루틴</div>
            <div class="sheet-title-sub">눌러서 오늘 기록에 담습니다</div>
          </div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        ${rows || '<div class="help-text">아직 만든 루틴이 없습니다. 자주 하는 조합을 하나 만들어 두면 매번 부위를 고르고 운동을 담을 필요가 없어집니다.</div>'}
        <button class="picker-confirm" data-act="new-routine" style="margin-top:14px">+ 새 루틴 만들기</button>
      </div>
    </div>`;
  }

  async function handleApplyRoutine(id) {
    const r = state.routines.find(x => x.id === id);
    const s = state.session;
    if (!r || !s) return;
    let added = 0;
    for (const e of r.exercises) {
      if (!s.parts.includes(e.part)) s.parts.push(e.part);
      if (addExerciseToSession(e.part, e.name, e.id)) added++;
    }
    r.usedAt = Date.now();
    await persistRoutines();
    await persist();
    state.routineSheet = false;
    state.tab = 'workout';
    /* 루틴을 적용하면 빈 화면이 운동 목록으로 통째로 바뀝니다 — 부위 확정과
       같은 종류의 전환입니다. */
    softRender();
    toast(added ? `${r.name} — ${added}개 운동을 담았습니다` : '이미 다 담겨 있습니다');
  }

  async function handleDeleteRoutine(id) {
    const r = state.routines.find(x => x.id === id);
    if (!r) return;
    if (!await ask({ title: '루틴 삭제', body: `"${r.name}" 을(를) 지울까요? 지난 기록은 그대로 남습니다.`, confirmText: '삭제', danger: true })) return;
    state.routines = state.routines.filter(x => x.id !== id);
    await WorkoutDB.deleteRoutine(id);
    cloudSync(() => Cloud.saveRoutines(state.routines));
    render();
    toast('루틴을 지웠습니다');
  }

  async function handleAddSet(exId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    if (!ex) return;
    const prev = ex.sets[ex.sets.length-1] || { kg:'', reps:'' };
    const newSet = { id:uid(), kg:prev.kg, reps:prev.reps, done:false, warmup:false };
    ex.sets.push(newSet);
    pendingEnterSetIds.add(newSet.id);
    await persist(); render();
  }

  async function handleDeleteSet(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    if (!ex) return;
    if (ex.sets.length <= 1) { toast('마지막 세트는 지울 수 없습니다'); return; }
    await animateRemoval(document.querySelector(`.set-swipe[data-ex="${CSS.escape(exId)}"][data-set="${CSS.escape(setId)}"]`));
    ex.sets = ex.sets.filter(s => s.id !== setId);
    await persist(); render();
  }

  /* ── 세트 완료 처리는 여기 한 곳에서만 ──────────────────────────────────
     세트를 끝내는 길이 두 개입니다: ✓ 를 직접 누르는 길, 그리고 횟수를 입력
     하는 길(횟수를 적는 게 곧 세트를 끝낸다는 뜻이라 자동으로 완료됩니다).
     예전에는 두 길이 각자 코드를 갖고 있었고, 횟수 입력 쪽에 완료 시각이
     빠져 있었습니다. 그래서 횟수를 적어 기록하는 사람에게는 운동 시간·세트
     사이 휴식이 영영 안 나왔습니다 — 지나간 시간은 되돌려 적을 수 없습니다. */
  function markSetDone(ex, set, done) {
    set.done = done;
    /* 과거 기록을 고치는 중이면 '지금' 과 아무 상관이 없습니다.
       - 완료 시각에 오늘 시각을 찍으면 12일 전 세트가 오늘 한 것처럼 되어,
         그 날의 운동 시간·세트 사이 휴식 계산이 통째로 망가집니다.
       - 소파에 앉아 지난주 기록을 채워 넣는데 90초 휴식 타이머가 올라오고
         "휴식 중" 알림이 울릴 이유도 없습니다. */
    if (done) {
      if (!state.editingPast) {
        /* 완료 시각. 운동에 실제로 몇 분을 썼는지·세트 사이를 얼마나 쉬었는지는
           이 값이 없으면 나중에 어떤 방법으로도 알아낼 수 없습니다. */
        set.doneAt = Date.now();
        startRestTimer(restDurationFor(set), ex?.name || '', set.id);
      }
      /* 이 체크로 운동이 다 끝났으면, 잠시 뒤 카드를 접습니다. */
      if (ex) {
        const p = exProgress(ex);
        if (p.total > 0 && p.done === p.total) scheduleAutoFold(ex);
      }
      return null;
    }
    /* 체크를 다시 풀면 접을 이유가 없어집니다 — 예약해 둔 접기를 취소합니다.
       안 그러면 방금 되살린 세트가 0.9초 뒤에 접혀 버립니다. */
    if (ex) cancelAutoFold(ex.id);
    delete set.doneAt;
    /* 지금 돌아가는 휴식이 '이 세트' 가 시작한 것일 때만 끕니다.
       예전에는 무조건 껐습니다 — 3세트를 끝내 90초를 재는 중에 1세트를
       잘못 체크한 걸 발견해 풀면, 돌아가던 휴식이 같이 사라졌습니다. */
    if (state.restTimer && (!state.restTimer.setId || state.restTimer.setId === set.id)) {
      cancelRestTimer();
    }
    return null;
  }

  async function handleToggleDone(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    const set = ex?.sets.find(s=>s.id===setId);
    if (!set) return;
    markSetDone(ex, set, !set.done);
    await persist(); render();
  }

  async function handleToggleWarmup(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    const set = ex?.sets.find(s=>s.id===setId);
    if (!set) return;
    set.warmup = !set.warmup;
    await persist(); render();
  }


  async function handleDeleteDay() {
    if (!await ask({ title: '이 날 기록을 삭제할까요?',
                     body: '이 날 저장된 운동과 러닝 기록이 모두 사라집니다.',
                     confirmText: '삭제', danger: true })) return;
    await WorkoutDB.deleteSession(state.session.date);
    state.sessions = state.sessions.filter(s=>s.date!==state.session.date);
    await cloudSync(() => Cloud.deleteSession(state.session.date));
    state.session = emptySession(state.date);
    state.tab = 'home';
    render(); toast('삭제했습니다');
  }

  async function exportJson() {
    const payload = await WorkoutDB.exportAll();
    const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fitlog-backup-${todayISO()}.json`;
    /* 문서에 붙였다 뗍니다. 떠 있지 않은 <a> 의 click() 은 브라우저에 따라
       무시되고, 특히 iOS 사파리에서 그렇습니다. 그리고 URL 회수를 다음
       차례로 미룹니다 — 같은 순간에 회수하면 브라우저가 아직 읽지 않은
       내려받기가 취소될 수 있습니다. */
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} URL.revokeObjectURL(url); }, 2000);
    /* 무엇이 들어갔는지 말해 줍니다. 예전에는 "파일을 저장했습니다" 뿐이라,
       루틴과 몸무게가 빠져 있던 시절에도 똑같은 문구가 떴습니다. */
    const bits = [`${payload.sessions.length}일치 기록`];
    if (payload.customExercises.length) bits.push(`나만의 운동 ${payload.customExercises.length}개`);
    if ((payload.routines || []).length) bits.push(`루틴 ${payload.routines.length}개`);
    if ((payload.metrics || []).length) bits.push(`몸무게 ${payload.metrics.length}개`);
    toast(`백업 저장 — ${bits.join(' · ')}`);
  }

  async function importJson(file) {
    let payload;
    try { payload = JSON.parse(await file.text()); } catch { toast('JSON을 읽을 수 없습니다'); return; }

    /* 물어보기 '전에' 파일을 들여다봅니다.
       예전에는 아무것도 확인하지 않고 "교체할까요?" 부터 띄웠습니다. 다른 앱의
       파일을 잘못 골라도 그대로 진행돼 기존 기록이 전부 지워졌습니다. 지금은
       몇 일치가 들어 있는지 세어서 그 숫자를 보여 주고, 셀 게 없으면 아예
       묻지 않고 거절합니다 — 되돌릴 수 없는 일에 "정말요?" 만 두 번 묻는 건
       확인이 아닙니다. */
    const days = Array.isArray(payload?.sessions)
      ? payload.sessions.filter(r => r && typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)).length
      : 0;
    const customs = Array.isArray(payload?.customExercises) ? payload.customExercises.length : 0;
    if (!days && !customs) { toast('이 파일에는 불러올 기록이 없습니다'); return; }

    const extra = [];
    if (Array.isArray(payload?.routines) && payload.routines.length) extra.push(`루틴 ${payload.routines.length}개`);
    if (Array.isArray(payload?.metrics) && payload.metrics.length) extra.push(`몸무게 ${payload.metrics.length}개`);
    const have = state.sessions.length;

    if (!await ask({ title: '백업 파일로 교체할까요?',
                     body: `가져올 내용: ${days}일치 기록${customs ? ` · 나만의 운동 ${customs}개` : ''}`
                         + (extra.length ? ` · ${extra.join(' · ')}` : '')
                         + `\n지금 이 기기의 ${have}일치 기록이 이 내용으로 바뀝니다.`,
                     confirmText: '교체', danger: true })) return;
    try {
      await WorkoutDB.importAll(payload);
    } catch (err) {
      /* 예전에는 여기서 던진 오류를 아무도 받지 않아, 사용자가 가져오기를
         눌러도 화면에 아무 일도 일어나지 않았습니다. */
      console.warn('import failed', err);
      toast(err?.message || '가져오지 못했습니다');
      return;
    }
    state.sessions = await WorkoutDB.getAllSessions();
    state.customExercises = await WorkoutDB.getCustomExercises();
    state.routines = await WorkoutDB.getRoutines();
    state.metrics = await WorkoutDB.getMetrics();
    await cloudSync(() => Cloud.pushAll(state.sessions, state.customExercises));
    cloudSync(() => Cloud.saveRoutines(state.routines));
    cloudSync(() => Cloud.saveMetrics(state.metrics));
    state.tab = 'home';
    render(); toast(`${state.sessions.length}일치 기록을 가져왔습니다`);
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file) await importJson(file);
  });

  /* 지금 화면에 열린 기록은 메모리가 최신입니다. 디스크/클라우드 합친
     결과 위에 덮어, replaceAll 이 방금 입력한 세트를 지우지 않게 합니다.
     과거 편집(editingPast)은 아직 저장 전이라 디스크에 올리지 않습니다. */
  function overlayOpenSession(rows) {
    if (!state.session || !state.session.date || state.editingPast) return rows;
    const live = clone(state.session);
    /* 저장할 것이 없는 세션은 얹지 않습니다 — doSave() 가 지우는 것과 같은
       기준입니다. 얹으면 이 결과가 그대로 replaceAll 로 디스크에, pushAll 로
       클라우드에 올라가서, 앱을 열어보기만 해도 오늘이 '운동한 날' 로 남고
       새로고침할 때마다 되살아납니다.
       rows 를 그대로 돌려줍니다 — 여기서 live.date 를 지우면, 다른 기기에서
       오늘 운동했고 이 기기는 아직 못 받은 경우에 그 기록을 지웁니다. */
    if (!worthSaving(live)) return rows;
    if (!live.updatedAt) live.updatedAt = Date.now();
    const map = new Map();
    for (const row of rows || []) {
      if (row && typeof row.date === 'string') map.set(row.date, row);
    }
    map.set(live.date, live);
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }
  function applyOpenSessionToList() {
    if (!state.session || !state.session.date || state.editingPast) return;
    const copy = clone(state.session);
    const idx = state.sessions.findIndex(x => x.date === copy.date);
    /* doSave() 는 worthSaving 이 아닌 세션을 디스크에서도 목록에서도 지웁니다.
       같은 목록을 여기서만 검사 없이 밀어넣으면, 디스크에 없는 날이 화면에는
       남습니다 — 갓 가입한 사람의 홈에서 오늘이 '운동한 날' 로 체크되고,
       최근 기록에 빈 줄이 뜨고, '기록하는 중' 카드가 아무것도 없는 세션을
       가리키던 것이 전부 이 한 줄에서 나왔습니다. */
    if (!worthSaving(copy)) {
      if (idx >= 0) state.sessions.splice(idx, 1);
      return;
    }
    if (idx >= 0) state.sessions[idx] = copy;
    else state.sessions.push(copy);
    state.sessions.sort((a, b) => b.date.localeCompare(a.date));
  }

  function mergeByDate(localRows, cloudRows) {
    const map = new Map();
    for (const row of localRows || []) {
      if (row && typeof row.date === 'string') map.set(row.date, row);
    }
    for (const row of cloudRows || []) {
      if (!row || typeof row.date !== 'string') continue;
      const prev = map.get(row.date);
      /* 같은 시각이면 이 기기 것을 남깁니다(> 이지 >= 가 아닙니다).
         updatedAt 은 기기의 시계라 믿을 만한 심판이 아닙니다 — 시계가 조금
         느린 폰은 방금 자기가 고친 내용이 늘 '더 오래된 것' 으로 판정돼,
         동기화할 때마다 자기 편집을 클라우드의 옛 사본에게 빼앗깁니다.
         비길 때는 지금 사용자가 들고 있는 기기를 믿는 편이 낫습니다. */
      if (!prev || (row.updatedAt || 0) > (prev.updatedAt || 0)) map.set(row.date, row);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  function mergeCustom(localRows, cloudRows) {
    const map = new Map();
    /* 클라우드를 먼저 깔고 이 기기 것을 위에 얹습니다. 예전에는 순서가 반대라,
       이 기기에서 이름을 고친 나만의 운동이 동기화될 때마다 옛 이름으로
       되돌아갔습니다. */
    for (const row of cloudRows || []) if (row && row.id) map.set(row.id, row);
    for (const row of localRows || []) if (row && row.id) map.set(row.id, row);
    return [...map.values()];
  }

  /* 루틴 합치기 — 클라우드를 먼저 깔고 이 기기 것을 그 위에 얹습니다.
     같은 id 가 양쪽에 있으면 이 기기 쪽이 방금 편집한 것일 가능성이 높아
     이 기기를 남기되, '마지막으로 쓴 시각'만은 두 값 중 큰 쪽을 씁니다 —
     폰에서 쓴 루틴이 노트북에서 다시 오래된 것처럼 보이면 안 됩니다.

     삭제는 이 방식으로 되돌아옵니다(클라우드에 남아 있던 줄이 다시 들어옴).
     루틴 삭제는 곧바로 saveRoutines() 로 클라우드에도 반영되므로, 두 기기가
     동시에 오프라인인 드문 경우에만 생기는 일이고, 그 대가로 새 기기에서
     루틴이 통째로 비어 보이는 일은 없어집니다. */
  function mergeRoutines(localRows, cloudRows) {
    const map = new Map();
    for (const row of cloudRows || []) {
      if (row && row.id && row.name) map.set(row.id, row);
    }
    for (const row of localRows || []) {
      if (!row || !row.id) continue;
      const prev = map.get(row.id);
      const usedAt = Math.max(Number(row.usedAt) || 0, prev ? Number(prev.usedAt) || 0 : 0);
      map.set(row.id, { ...row, usedAt });
    }
    return [...map.values()].sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
  }

  /* 몸무게는 하루 한 줄이고 날짜가 열쇠입니다. 같은 날 양쪽에 값이 있으면
     이 기기 것을 남깁니다 — 오늘 잰 값을 적은 곳이 이 기기이기 때문입니다. */
  function mergeMetrics(localRows, cloudRows) {
    const map = new Map();
    for (const row of cloudRows || []) {
      if (row && row.date && Number(row.weightKg) > 0) map.set(row.date, row);
    }
    for (const row of localRows || []) {
      if (row && row.date && Number(row.weightKg) > 0) map.set(row.date, row);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /* ── Importing pre-login records ──────────────────────────────────────────
     Someone can log workouts without an account, then sign up later — that
     data is theirs and should be offered, not silently stranded.

     But it must never be a modal. The old version threw a raw browser
     confirm() from inside background sync: it interrupted at an arbitrary
     moment, looked nothing like the app, and hit every brand-new account the
     instant it finished signing up — asking about "이전 기록" that the user has
     no reason to know exists. Worse, an unexplained yes could pull in whatever
     a previous person left on a shared device.

     So detection is all that happens automatically. The offer becomes a card on
     the home screen that says where the data came from and how much there is,
     and it waits until the user chooses. Dismissing it is remembered, so it
     asks once and never nags. */
  function importDismissKey() {
    return `fitlog-import-dismissed:${state.user ? state.user.uid : 'guest'}`;
  }
  function importDismissed() {
    try { return localStorage.getItem(importDismissKey()) === '1'; } catch (_) { return false; }
  }

  async function detectImportableLocal(cloudData) {
    /* Only relevant for an account with nothing in the cloud yet — once there
       is real history, merging in stray device data would be a surprise. */
    if (cloudData.sessions && cloudData.sessions.length) return null;
    if (importDismissed()) return null;
    const guest = await WorkoutDB.readGuest();
    const legacy = await WorkoutDB.readLegacy();
    const sessions = [...(guest.sessions || []), ...(legacy.sessions || [])]
      .filter(s => s && s.date && hasAnyWork(s));
    const customExercises = [...(guest.customExercises || []), ...(legacy.customExercises || [])];
    if (!sessions.length && !customExercises.length) return null;
    return { sessions, customExercises };
  }

  async function loadWorkspace() {
    const today = todayISO();
    state.date = today;
    state.sessions = await WorkoutDB.getAllSessions();
    state.customExercises = await WorkoutDB.getCustomExercises();
    state.routines = await WorkoutDB.getRoutines();
    state.metrics = await WorkoutDB.getMetrics();
    const saved = await WorkoutDB.getSession(today);
    state.session = normalizeSession(saved || emptySession(today));
    closeAllSheets();
    state.tab = 'home';
  }

  async function enterApp(user, opts = {}) {
    if (user && state.user && state.user.uid === user.uid && state.authReady && !opts.force) return;
    const arrivedFromLogin = !state.authReady || (!state.user && !state.guest);
    /* Whether an account needs the gate is a fact about that account, decided
       below by reading its profile. Carrying the previous answer into a new
       entry is how a stale true survived a sign-out and gated an account that
       had already finished. */
    state.onboarding = false;
    state.user = user || null;
    state.guest = !user && !!opts.guest;
    state.authBusy = false;
    state.authError = '';
    if (state.guest) localStorage.setItem('fitlog-guest', '1');
    else localStorage.removeItem('fitlog-guest');
    WorkoutDB.setScope(user ? user.uid : 'guest');
    await WorkoutDB.open();

    if (!user) {
      const current = await WorkoutDB.getAllSessions();
      const currentCustom = await WorkoutDB.getCustomExercises();
      /* 옛 저장소에서 옮겨오는 건 '이 기기에 아직 아무것도 없을 때' 만입니다.
         예전에는 세션만 보고 판단했는데, replaceAll 은 나만의 운동 저장소까지
         비웁니다. 그래서 운동은 아직 안 했지만 나만의 운동을 다섯 개 만들어 둔
         사람이 앱을 다시 열면 그 다섯 개가 사라졌습니다. */
      if (!current.length && !currentCustom.length) {
        const legacy = await WorkoutDB.readLegacy();
        if ((legacy.sessions || []).length || (legacy.customExercises || []).length) {
          await WorkoutDB.replaceAll(legacy.sessions, legacy.customExercises);
        }
      }
    }

    /* Show the app immediately. Cloud sync runs in the background and must never
       block entry — the Firestore SDK retries silently forever when the database
       is missing or unreachable, which would otherwise freeze the splash screen. */
    await loadWorkspace();

    /* Resolve the onboarding gate BEFORE the first paint when there is any
       chance of needing it, so a new account goes splash → gate instead of
       splash → a flash of an empty home → gate.
       knownSetUp() makes that a one-time cost: once an account is confirmed to
       have an 아이디, the flag is cached per-uid and every later launch skips
       the wait entirely and refreshes the profile in the background. The wait is
       also capped, so a slow Firestore delays entry by a couple of seconds at
       worst rather than holding the app on a splash screen. */
    if (user && !knownSetUp(user.uid)) {
      await loadProfileThenMaybeOnboard(user, 2500);
    }

    /* 시작 탭은 진짜 새로 들어올 때만 적용합니다 — 계정을 바꾸는 것도
       아니고 그냥 다시 그려지는 매 render() 마다 사용자가 옮겨간 탭을
       도로 홈으로 되돌리면 안 되니까요. */
    if (arrivedFromLogin) state.tab = startTab();

    state.authReady = true;
    render();
    if (user && arrivedFromLogin && !state.onboarding) toast('로그인했습니다');

    if (user) {
      if (knownSetUp(user.uid)) loadProfileThenMaybeOnboard(user, 8000);
      syncInBackground();
    }
  }

  /* Cached "this account already picked an 아이디". Only ever set from a
     successful read, never from a failure, so a bad network can't permanently
     convince the app that setup is done. */
  function knownSetUp(uid) {
    try { return localStorage.getItem('fitlog-setup:' + uid) === '1'; } catch (_) { return false; }
  }
  function markSetUp(uid) {
    try { localStorage.setItem('fitlog-setup:' + uid, '1'); } catch (_) {}
  }

  /* The 아이디 this device successfully claimed for this account.

     Kept because the app has no other way to find it: the usernames directory
     allows reading a name you can already spell, but not listing names by
     owner, so once users/{uid}.username goes missing there is nothing left to
     look it up with — and the only thing the app can do is ask the user again,
     which is exactly the loop being closed here. */
  function rememberUsername(uid, id) {
    try { localStorage.setItem('fitlog-id:' + uid, id); } catch (_) {}
  }
  function rememberedUsername(uid) {
    try { return localStorage.getItem('fitlog-id:' + uid) || ''; } catch (_) { return ''; }
  }

  /* Fetches the profile after entry rather than before it, for the same reason
     sync runs in the background: a slow or unreachable Firestore must not hold
     the app hostage on a splash screen. The onboarding gate therefore appears a
     beat after login — acceptable, because the alternative is the app hanging
     for anyone whose network is having a bad day.
     A failed read is treated as "don't know", never as "no 아이디" — wrongly
     showing the gate to an existing user would invite them to claim a second
     name for an account that already has one. */
  async function loadProfileThenMaybeOnboard(user, timeoutMs) {
    let prof = null;
    /* Read this exact account, not "whoever Cloud thinks is signed in" — the
       two can differ for a moment right after a sign-in resolves. */
    try { prof = await withTimeout(Cloud.loadProfile(user.uid), timeoutMs || 8000, '프로필'); }
    catch (err) { console.warn('profile load failed', err); return; }
    if (!state.user || state.user.uid !== user.uid) return;
    state.profile = prof;
    /* null here means the read succeeded and the document simply isn't there —
       a brand-new account, which is precisely who the gate is for. Only a
       thrown error (handled above) counts as "don't know". */
    /* Confirmed set up — and the gate must be taken back down, not merely left
       un-raised.

       state.onboarding used to be cleared in exactly one place: finishing the
       form. So once it went up it stayed up for the life of the page, and any
       later render with a signed-in user put the gate back — even after the
       account was confirmed complete. Signing out and in again inside the same
       tab was enough to bring it back, and a second tab left open on the gate
       resurrected it every time it was touched, no matter what the server said. */
    if (prof && prof.username) {
      markSetUp(user.uid);
      rememberUsername(user.uid, prof.username);
      if (state.onboarding) {
        state.onboarding = false;
        if (state.authReady) render();
      }
      return;
    }

    /* Ask twice before believing it.

       Everything past this point pushes the user into claiming an 아이디, and
       that is permanent — so one read that came back empty is far too thin a
       reason to go there. A real account whose read happened to miss will
       answer properly a moment later; a genuinely new account answers "not
       there" every time. This is what sent a fully set-up account through setup
       again on a second browser, where nothing was cached to contradict it. */
    try {
      await new Promise(r => setTimeout(r, 600));
      const second = await withTimeout(Cloud.loadProfile(user.uid), 8000, '프로필');
      if (!state.user || state.user.uid !== user.uid) return;
      if (second && second.username) {
        state.profile = second;
        markSetUp(user.uid);
        rememberUsername(user.uid, second.username);
        if (state.onboarding) {
          state.onboarding = false;
          if (state.authReady) render();
        }
        return;
      }
    } catch (err) {
      /* Could not confirm — stay quiet rather than risk sending a real account
         through setup a second time. */
      console.warn('profile recheck failed', err);
      return;
    }

    /* Repair before asking.

       Reaching here means the server has no 아이디 for this account. If this
       device has already claimed one, that is not a new account — it is the
       same account with a value missing, and the honest response is to put the
       value back rather than make the user invent a name they already chose.

       claimUsername treats a name you already own as yours, so this is safe to
       repeat and cannot take a name from anybody else. The gate is still shown
       if the repair does not stick, because at that point the app genuinely
       does not know what the account is called. */
    const remembered = rememberedUsername(user.uid);
    if (remembered) {
      try {
        await Cloud.claimUsername(remembered);
        const again = await withTimeout(Cloud.loadProfile(user.uid), 8000, '프로필');
        if (again && again.username) {
          if (!state.user || state.user.uid !== user.uid) return;
          state.profile = again;
          markSetUp(user.uid);
          if (state.authReady) render();
          return;
        }
      } catch (err) {
        console.warn('username repair failed', err);
      }
      if (!state.user || state.user.uid !== user.uid) return;
    }

    /* Prefill from whatever Google already told us so the gate is one tap for
       most people. */
    state.signup.username = state.signup.username || remembered || '';
    state.signup.name = state.signup.name || user.displayName || '';
    state.onboarding = true;
    if (state.authReady) render();
  }

  /* ── 백그라운드 동기화 ────────────────────────────────────────────────────
     이 함수는 네트워크를 여러 번 기다립니다(최대 45초). 그 사이에 사용자가
     로그아웃하고 다른 계정으로 들어올 수 있습니다. 예전에는 누구를 위해
     도는 동기화인지 기억하지 않아서, 기다리는 동안 계정이 바뀌면 A 의 기록
     전체가 B 의 IndexedDB 와 B 의 Firestore(users/{B}/sessions)로 들어갔습니다.
     공용 폰에서 한 번만 일어나도 남의 운동 기록이 내 계정에 영구히 박힙니다.

     그래서 시작할 때 uid 를 붙잡아 두고, 기다림이 끝날 때마다 "아직 나인가"
     를 확인합니다. 아니면 아무것도 쓰지 않고 조용히 빠집니다.
     state.syncing 도 finally 에서 반드시 풉니다 — 예전에는 로그아웃으로
     중간에 버려진 동기화가 이 깃발을 켠 채로 남아, 다음 사람의 동기화가
     통째로 건너뛰어졌습니다. */
  async function syncInBackground(fromPull) {
    if (state.syncing) return;
    const myUid = state.user && state.user.uid;
    if (!myUid) return;
    const stillMe = () => !!state.user && state.user.uid === myUid;
    state.syncing = true;
    /* 동그라미는 당겨서 새로고침할 때만 보여 줍니다. 로그인 직후 자동
       동기화까지 띄우면 상단에 계속 앉아 있는 것처럼 보입니다. */
    if (fromPull) showSyncIndicator();
    try {
      /* 클라우드를 받기 전·후에 저장 큐를 비우고, 디스크는 네트워크가
         끝난 뒤에 다시 읽습니다. 예전에 시작 시점 스냅샷으로 replaceAll
         하면, 그 사이 persist 된 세트가 통째로 사라졌습니다. */
      try { await persist(); } catch (_) {}
      if (!stillMe()) return;
      await withTimeout(Cloud.touchProfile(), 8000, '프로필');
      if (!stillMe()) return;
      let cloudData = await withTimeout(Cloud.pullAll(), 12000, '불러오기');
      if (!stillMe()) return;
      /* Detect only — importing is the user's call, made from the home screen. */
      state.pendingImport = await detectImportableLocal(cloudData);
      try { await persist(); } catch (_) {}
      if (!stillMe()) return;
      const localSessions = await WorkoutDB.getAllSessions();
      const localCustom = await WorkoutDB.getCustomExercises();
      if (!stillMe()) return;
      let sessions = mergeByDate(localSessions, cloudData.sessions);
      sessions = overlayOpenSession(sessions);
      /* 빈 껍데기 기록을 털어냅니다 — doSave() 가 저장하지 않는 것과 같은
         기준입니다. 옛 버전이 클라우드에 올려 둔 빈 기록은 pullAll 로 매번
         다시 내려오는데 pushAll 은 덮어쓰기만 하고 지우지는 않아서, 그냥 두면
         새로고침할 때마다 오늘이 '운동한 날' 로 되살아납니다. */
      const junkDates = sessions.filter(s => !worthSaving(s)).map(s => s.date);
      if (junkDates.length) sessions = sessions.filter(worthSaving);
      const customExercises = mergeCustom(localCustom, cloudData.customExercises);
      if (!stillMe()) return;
      await WorkoutDB.replaceAll(sessions, customExercises);
      if (!stillMe()) return;
      await withTimeout(Cloud.pushAll(sessions, customExercises), 15000, '저장');
      if (!stillMe()) return;
      /* pushAll 은 덮어쓰기만 하므로, 위에서 걸러낸 빈 기록은 여기서 직접
         지워야 계정에서 사라집니다. 실패해도 동기화를 무너뜨릴 일은 아니라
         각각 감쌉니다 — 다음 동기화에서 다시 시도합니다. */
      for (const date of junkDates) {
        /* 지우는 사이에 그 날짜가 되살아났다면(동기화 도중 세트를 찍었다면)
           건너뜁니다. */
        if (state.session && state.session.date === date && worthSaving(state.session)) continue;
        try { await withTimeout(Cloud.deleteSession(date), 8000, '정리'); }
        catch (err) { console.warn('[fitlog] 빈 기록 정리 실패', date, err); }
      }
      if (!stillMe()) return;

      /* 루틴과 몸무게도 같이 맞춥니다. 예전에는 저장만 올려보내고 내려받는
         쪽이 없어서, 새 기기로 로그인하면 만들어 둔 루틴과 몸무게 기록이
         통째로 사라진 것처럼 보였습니다. */
      const routines = mergeRoutines(await WorkoutDB.getRoutines(), cloudData.routines);
      const metrics  = mergeMetrics(await WorkoutDB.getMetrics(), cloudData.metrics);
      if (!stillMe()) return;
      for (const r of routines) await WorkoutDB.putRoutine(clone(r));
      for (const m of metrics)  await WorkoutDB.putMetric(clone(m));
      state.routines = routines;
      state.metrics  = metrics;
      /* 합친 결과를 다시 올려야 이 기기에만 있던 줄이 클라우드로 갑니다.
         실패해도 동기화 전체를 무너뜨릴 만한 일은 아니라 따로 감쌉니다. */
      try {
        await withTimeout(Cloud.saveRoutines(routines), 10000, '루틴 저장');
        await withTimeout(Cloud.saveMetrics(metrics), 10000, '몸무게 저장');
      } catch (err) { console.warn('routine/metric push failed', err); }

      /* Refresh data in place — loadWorkspace() would reset the tab and close
         sheets, yanking the user out of whatever they were editing. */
      if (!stillMe()) return;
      state.sessions = await WorkoutDB.getAllSessions();
      state.customExercises = await WorkoutDB.getCustomExercises();
      /* 과거 기록을 고치는 중이면 손대지 않습니다. 그 편집은 일부러 저장을
         미뤄 state.session 에만 있고 디스크에는 없습니다. 오늘 기록도
         디스크 것으로 덮지 않습니다 — 동기화 중에 입력한 세트가 화면에서
         사라집니다. 목록만 열린 세션과 맞춥니다. */
      applyOpenSessionToList();

      render();
    } catch (err) {
      console.warn('cloud sync failed', err);
      /* 계정이 이미 바뀌었다면 지난 계정의 실패를 지금 사람에게 알릴 이유가
         없습니다 — 자기가 하지도 않은 일이 실패했다고 나옵니다. */
      if (stillMe()) {
        render();
        toast('클라우드 동기화 실패 — 기록은 이 기기에 저장됩니다');
      }
    } finally {
      state.syncing = false;
      hideSyncIndicator();
    }
  }

  async function handleGoogleLogin() {
    if (state.authBusy) return;
    if (!Cloud.configured()) { state.authError = 'Firebase가 아직 연결되지 않았습니다.'; render(); return; }
    state.authBusy = true;
    state.authError = '';
    /* Start Google auth from the click handler BEFORE any re-render.
       Replacing the DOM first drops the user-activation token, so iOS/Android
       browsers block the popup and the redirect never starts. */
    try {
      try { sessionStorage.setItem('fitlog-auth-pending', '1'); } catch (_) {}
      const user = await Cloud.signInGoogle();
      if (user) {
        try { sessionStorage.removeItem('fitlog-auth-pending'); } catch (_) {}
        await enterApp(user);
      } else {
        /* 리디렉트 방식(모바일)에서는 여기서 null 이 옵니다 — 브라우저가 곧
           구글로 떠나므로 보통은 아무 일도 없습니다. 그런데 사용자가 구글
           화면에서 뒤로가기를 누르면 이 페이지가 상태 그대로 되살아납니다.
           그때 authBusy 가 켜진 채면 로그인 화면의 모든 버튼이 죽어 있어
           로그인도, 회원가입도, 비밀번호 찾기도 못 합니다. 풀어 둡니다. */
        state.authBusy = false;
        render();
      }
    } catch (err) {
      try { sessionStorage.removeItem('fitlog-auth-pending'); } catch (_) {}
      state.authBusy = false;
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  /* Sign in with 아이디 — or an email, since anyone who signed up before this
     change has one and would otherwise be locked out of their own records. */
  async function handleIdLogin() {
    if (state.authBusy) return;
    if (!Cloud.configured()) { state.authError = 'Firebase가 아직 연결되지 않았습니다.'; render(); return; }

    /* Read from the DOM rather than trusting oninput timing — autofill and
       password managers populate fields without ever firing input. */
    const idEl   = document.getElementById('auth-id');
    const passEl = document.getElementById('auth-password');
    const rawId    = (idEl ? idEl.value : state.authId).trim();
    const password = passEl ? passEl.value : state.authPassword;

    if (!rawId || !password) {
      state.authError = '아이디와 비밀번호를 입력해 주세요.';
      render(); return;
    }

    state.authId       = rawId;
    state.authPassword = password;
    state.authBusy     = true;
    state.authError    = '';
    render();
    try {
      /* 아이디 로그인은 이메일 로그인과 달리 파이어스토어를 한 번 들릅니다
         (아이디 → 이메일). 그 읽기가 응답 없이 멈추면 authBusy 가 true 로
         굳고, 로그인 화면의 버튼이 — 구글, 로그인, 비밀번호 찾기, 회원가입
         전부 — 영영 눌리지 않게 됩니다. 이메일로 넣으면 멀쩡해서 원인을
         알기도 어렵습니다. */
      const user = rawId.includes('@')
        ? await withTimeout(Cloud.signInEmail(rawId, password), 20000, '로그인')
        : await withTimeout(Cloud.signInUsername(rawId, password), 20000, '로그인');
      state.authPassword = '';
      await enterApp(user);
    } catch (err) {
      state.authBusy = false;
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  /* Step 1 — turn the 아이디 into an address and show it for confirmation.
     Nothing is sent here, so a mistyped id costs a message, not an email to a
     stranger. Also the escape hatch for a Google-created account with no
     password: the reset link attaches one to that same account. */
  async function handleResetLookup() {
    if (state.authBusy) return;
    if (!Cloud.configured()) { state.authError = 'Firebase가 아직 연결되지 않았습니다.'; render(); return; }
    const el = document.getElementById('reset-id');
    const raw = (el ? el.value : state.signup.resetId || '').trim();
    state.signup.resetId = raw;
    if (!raw) { state.authError = '아이디 또는 가입할 때 쓴 이메일을 입력해 주세요.'; render(); return; }

    state.authBusy = true; state.authError = '';
    render();
    try {
      state.resetTarget = await Cloud.resolveResetTarget(raw);
      state.authBusy = false;
      render();
    } catch (err) {
      state.authBusy = false;
      state.resetTarget = '';
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  /* Step 2 — actually send, then show where it went. */
  async function handleResetSend(opts = {}) {
    if (state.authBusy) return;
    if (state.resetCooldown > 0 && opts.resend) return;
    const target = state.resetTarget || state.signup.resetId;
    state.authBusy = true; state.authError = '';
    render();
    try {
      const addr = await Cloud.sendPasswordResetFor(target);
      state.authBusy = false;
      state.resetSent = maskEmail(addr);
      startResetCooldown(60);
      render();
    } catch (err) {
      state.authBusy = false;
      state.authError = Cloud.authMessage(err);
      render();
    }
  }

  /* Rate-limits 다시 보내기 so an impatient tap doesn't fire five mails, and
     so Firebase's own abuse throttle isn't what the user runs into first. */
  let resetTimer = 0;
  function startResetCooldown(sec) {
    clearInterval(resetTimer);
    state.resetCooldown = sec;
    resetTimer = setInterval(() => {
      state.resetCooldown -= 1;
      if (state.resetCooldown <= 0) { clearInterval(resetTimer); state.resetCooldown = 0; }
      if (state.authMode === 'reset' && state.resetSent) render();
    }, 1000);
  }

  /* Merges pre-login records into the signed-in account, then pushes them so
     the other devices see them too. */
  async function handleImportLocal() {
    const p = state.pendingImport;
    if (!p || !state.user) return;
    state.pendingImport = null;
    render();
    try {
      const localSessions = await WorkoutDB.getAllSessions();
      const localCustom = await WorkoutDB.getCustomExercises();
      const sessions = mergeByDate(localSessions, p.sessions);
      const customExercises = mergeCustom(localCustom, p.customExercises);
      await WorkoutDB.replaceAll(sessions, customExercises);
      state.sessions = await WorkoutDB.getAllSessions();
      state.customExercises = await WorkoutDB.getCustomExercises();
      /* 동기화 쪽과 같은 이유 — 편집 중인 과거 기록은 덮지 않습니다. */
      if (!state.editingPast) {
        const saved = await WorkoutDB.getSession(state.date);
        if (saved) state.session = normalizeSession(saved);
      }
      try { localStorage.setItem(importDismissKey(), '1'); } catch (_) {}
      render();
      toast(`${p.sessions.length}일치 기록을 가져왔습니다`);
      cloudSync(() => Cloud.pushAll(sessions, customExercises));
    } catch (err) {
      console.warn('import failed', err);
      state.pendingImport = p;
      render();
      toast('가져오기에 실패했습니다');
    }
  }

  async function handleLogout() {
    if (!await ask({ title: '로그아웃할까요?',
                     body: '이 기기의 기록은 그대로 남고, 계정 기록은 클라우드에 유지됩니다.',
                     confirmText: '로그아웃' })) return;
    state.user = null;
    state.guest = false;
    /* Clear the gate's own state too. Leaving it set meant a later render —
       one triggered by anything that arrives after logout — could put the
       setup screen back on top of a signed-out app. */
    state.onboarding = false;
    state.profile = null;
    /* 이전 계정의 동기화 깃발과 '가져오시겠어요?' 카드를 남겨 두면, 다음
       사람의 동기화가 건너뛰어지고 남의 기록을 가져오라는 카드가 뜹니다. */
    state.syncing = false;
    hideSyncIndicator();
    state.pendingImport = null;
    resetSignup();
    localStorage.removeItem('fitlog-guest');

    /* Nothing about the local workspace may be allowed to stop the sign-out.

       These three lines used to run unguarded, and one IndexedDB failure threw
       straight out of the function — past render(), past signOut(). That left
       the app showing the signed-in screen while still holding a live Firebase
       session, so the next thing that caused a render flipped the user
       somewhere they had not asked to go. A broken local database should cost
       an empty list, not a half-finished logout. */
    try {
      WorkoutDB.setScope('guest');
      await WorkoutDB.open();
      await loadWorkspace();
    } catch (err) {
      console.warn('local workspace unavailable during logout', err);
      state.sessions = [];
      state.customExercises = [];
      state.session = null;
    }

    /* Signed out first, screen second — so there is never a moment where the
       login screen is up but the session underneath is still alive. */
    try { await Cloud.signOut(); }
    catch (err) { console.warn('sign out failed', err); }

    state.authReady = true;
    render();
    toast('로그아웃했습니다');
  }

  /* Clears only this device's local cache (IndexedDB). Safe to offer to both
     guest and logged-in users — for a logged-in user the cloud copy is
     untouched and re-syncs back down on next load; for a guest it's a real
     wipe, so that path gets its own, stronger confirmation. */
  async function handleClearLocalData() {
    const cloudBacked = !!state.user;
    const msg = cloudBacked
      ? '이 기기에 저장된 기록만 지웁니다. 클라우드 기록은 남아 있고, 다음에 접속하면 다시 내려받습니다. 계속할까요?'
      : '로그인하지 않은 상태라 이 기기 기록이 유일한 사본입니다. 삭제하면 되돌릴 수 없습니다. 계속할까요?';
    if (!await ask({ title: '이 기기 기록을 초기화할까요?', body: msg,
                     confirmText: '초기화', danger: true })) return;
    await WorkoutDB.replaceAll([], []);
    state.sessions = [];
    state.customExercises = [];
    state.session = emptySession(state.date);
    state.tab = 'home';
    render();
    toast('이 기기 기록을 초기화했습니다');
    if (cloudBacked) syncInBackground();
  }

  /* Deletes the Firestore data and the Firebase Auth account itself — not
     just a local reset. Firebase requires a *recent* login for this; if the
     session is stale it throws auth/requires-recent-login, so we transparently
     reauthenticate (Google popup, or a password prompt for email accounts)
     and retry once rather than dead-ending the user. */
  async function handleDeleteAccount() {
    if (state.accountBusy) return;
    if (!await ask({ title: '계정을 삭제할까요?',
                     body: '클라우드에 저장된 모든 운동 기록이 영구적으로 사라집니다. 되돌릴 수 없습니다.',
                     confirmText: '계속', danger: true })) return;
    if (!await ask({ title: '마지막 확인입니다',
                     body: '계정과 모든 데이터를 정말 삭제할까요?',
                     confirmText: '삭제', danger: true })) return;

    state.accountBusy = true;
    render();
    try {
      await deleteAccountWithReauth();
      await WorkoutDB.replaceAll([], []);
      state.user = null;
      state.guest = false;
      localStorage.removeItem('fitlog-guest');
      WorkoutDB.setScope('guest');
      await WorkoutDB.open();
      await loadWorkspace();
      state.accountBusy = false;
      state.authReady = true;
      render();
      toast('계정과 데이터를 삭제했습니다');
    } catch (err) {
      state.accountBusy = false;
      render();
      if (err && err.message === 'cancelled') {
        toast('삭제를 취소했습니다 — 기록은 그대로 있습니다');
      } else if (err && err.code === 'fitlog/reauth-failed') {
        toast(`본인 확인에 실패해 삭제하지 않았습니다 — ${err.message}`);
      } else {
        toast(`삭제 실패: ${Cloud.authMessage(err)}`);
      }
    }
  }

  /* ── 계정 삭제 ────────────────────────────────────────────────────────────
     순서가 중요합니다. 예전에는 곧바로 삭제를 시도했는데, 그 함수는 규칙상
     파이어스토어 기록을 '먼저' 다 지운 다음 계정을 지웁니다(계정이 사라지면
     그 사람의 문서를 지울 권한도 같이 사라지기 때문입니다). 그런데 마지막
     단계에서 파이어베이스가 "최근에 로그인한 적이 없다" 며 거부하는 일이
     흔하고, 그때 다시 로그인 창이 뜹니다. 여기서 사용자가 취소하거나(마음이
     바뀌어서, 또는 설치형 앱에서 구글 팝업이 막혀서) 하면 —

       · 클라우드의 운동 기록은 이미 전부 사라진 뒤이고
       · 아이디 예약도 이미 풀렸고
       · 계정은 멀쩡히 남아 로그인도 되는데
       · 화면에는 "삭제를 취소했습니다" 라고 떴습니다.

     다른 기기에만 있던 기록은 그대로 날아가는데 사용자는 아무 일도 없었다고
     믿습니다. 그래서 지우기 전에 본인 확인을 먼저 끝냅니다. 여기서 실패하면
     아무것도 건드리지 않은 상태이므로 '취소' 가 사실이 됩니다. */
  async function deleteAccountWithReauth() {
    try {
      await Cloud.reauthenticate();
    } catch (err) {
      const code = (err && err.code) || '';
      const cancelled = code === 'auth/popup-closed-by-user'
                     || code === 'auth/cancelled-popup-request'
                     || (err && err.message === '취소되었습니다');
      if (cancelled) throw new Error('cancelled');
      /* 팝업이 막혔거나 네트워크 문제인 경우 — 왜 안 됐는지는 말해 줘야
         합니다. 어느 쪽이든 아직 아무것도 지우지 않았습니다. */
      const e = new Error(Cloud.authMessage(err));
      e.code = 'fitlog/reauth-failed';
      throw e;
    }
    await Cloud.deleteAccountAndData();
  }

  /* ── Init ────────────────────────────────── */
  /* Flags an installed PWA for CSS. Only a standalone window draws to the
     hardware edge and needs the bottom safe-area inset reserved; inside a
     browser tab the toolbar already occupies that strip and reserving it again
     leaves a gap under the nav bar. iOS below 16.4 has no display-mode media
     query, so the legacy navigator.standalone flag backs it up. */
  function markDisplayMode() {
    try {
      const standalone =
        (window.matchMedia && (
          window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(display-mode: fullscreen)').matches ||
          window.matchMedia('(display-mode: minimal-ui)').matches
        )) || window.navigator.standalone === true;
      document.documentElement.classList.toggle('is-standalone', !!standalone);
    } catch (_) {}
  }

  /* A tab left open on the gate has no idea the account was finished somewhere
     else — another tab, another device, or a retry that finally landed. Auth
     state broadcasts between tabs, but "does this account have an 아이디" is a
     Firestore read that only happens on entry, so a backgrounded tab can sit on
     a screen that stopped being true minutes ago. Re-checking when the tab comes
     back costs one read and can only ever take the gate down. */
  function watchForGateGoingStale() {
    /* 이미 확인 중인지 표시해 둡니다.
       iOS 는 앱으로 돌아올 때 visibilitychange·pageshow·focus 를 한꺼번에
       올립니다. 예전 주석은 "가드가 첫 번째만 통과시킨다" 고 했지만 사실이
       아니었습니다 — 아래 함수는 한참 뒤에야 상태를 바꾸므로 세 개가 나란히
       들어갑니다. 그러면 셋 다 같은 아이디를 예약하려 들고, 하나만 이기고
       나머지는 실패하는데, 늦게 끝난 실패가 방금 복구된 계정 위에 설정
       화면을 다시 세웁니다. */
    let checking = false;
    const recheck = () => {
      if (checking || document.hidden) return;
      if (!state.onboarding || !state.user || state.authBusy) return;
      checking = true;
      Promise.resolve(loadProfileThenMaybeOnboard(state.user, 8000))
        .catch(() => {})
        .then(() => { checking = false; });
    };
    /* Three events rather than one, because iOS is the case that matters and
       is the least predictable: switching tabs fires visibilitychange, but
       returning to a tab the OS froze comes back through pageshow (restored
       from the back-forward cache), and sometimes only focus is raised. They
       are cheap and idempotent — the guard above drops all but the first. */
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('focus', recheck);

    /* 뒤로가기로 되살아난 페이지 구조.
       구글 로그인은 이 페이지를 떠났다가 돌아오는데, 사용자가 구글 화면에서
       뒤로가기를 누르면 브라우저가 자바스크립트 상태를 그대로 복원합니다
       (bfcache). 그때 '로그인 진행 중' 이 켜진 채면 화면의 모든 버튼이 죽어
       있습니다. 복원된 경우에만 풀어 줍니다 — 정상적인 진행 중에는 건드리지
       않아야 하므로 event.persisted 를 봅니다. */
    window.addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      if (state.user || !state.authBusy) return;
      state.authBusy = false;
      try { sessionStorage.removeItem('fitlog-auth-pending'); } catch (_) {}
      render();
    });
  }

  async function init() {
    markDisplayMode();
    applyFontScale();
    initTheme();
    render();
    startRestTicker();
    watchWakeLock();
    watchChartScrub();
    /* 앱을 껐다 켜도 쉬던 중이었다면 남은 시간이 이어집니다. */
    restoreRestTimer();
    watchForGateGoingStale();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type !== 'SW_UPDATED') return;
        try { if (sessionStorage.getItem('fitlog-auth-pending')) return; } catch (_) {}
        /* 과거 기록을 고치는 중이면 새로고침하지 않습니다. 그 편집은 일부러
           디스크에 없고 화면에만 있어서, 새로고침하면 예고 없이 사라집니다.
           새 버전은 다음에 앱을 열 때 어차피 적용되므로 급할 게 없습니다. */
        if (hasUnsavedPast()) {
          toast('새 버전이 있어요 — 지금 고치는 기록을 저장한 뒤 적용됩니다');
          return;
        }
        window.location.reload();
      });
    }
    Cloud.init();

    /* Process redirect result FIRST before waitAuth resolves with stale null.
       Firebase fires onAuthStateChanged(null) synchronously before getRedirectResult
       settles, so waitAuth() would otherwise resolve with null and show the login
       screen even though the redirect succeeded. */
    /* Watchdog: never leave the user staring at the splash screen. */
    const watchdog = setTimeout(() => {
      if (!state.authReady) {
        console.warn('init watchdog fired — forcing app to render');
        state.authReady = true;
        render();
      }
    }, 10000);

    let redirectUser = null;
    try { redirectUser = await withTimeout(Cloud.completeRedirect(), 15000, '로그인 확인'); }
    catch (err) { console.warn('redirect result failed', err); }
    /* 결과가 없어도 지웁니다. 이 표시는 "지금 구글 로그인 하러 나가 있음" 을
       뜻하는데, 여기까지 왔다는 건 돌아왔다는 뜻입니다. 예전에는 로그인이
       성공했을 때만 지워서, 구글 화면에서 취소하면 이 표시가 브라우저 세션이
       끝날 때까지 남았습니다. 그러면 새 버전이 나와도 자동 새로고침이 계속
       막힙니다(위 SW_UPDATED 처리가 이 표시를 보고 물러납니다). */
    try { sessionStorage.removeItem('fitlog-auth-pending'); } catch (_) {}

    Cloud.onAuth(async (user) => {
      if (!state.authReady) return;
      /* Signup drives its own ending (confirm, then back to the login screen).
         Letting this listener react to the account it just created would race
         that: it fires between createUser and the profile write, so the app
         would enter on a user whose 아이디 is not on the server yet. */
      if (state.signingUp) return;
      if (user && (!state.user || state.user.uid !== user.uid)) {
        await enterApp(user);
      }
      if (!user && state.user) {
        state.user = null;
        state.guest = false;
        localStorage.removeItem('fitlog-guest');
        WorkoutDB.setScope('guest');
        await WorkoutDB.open();
        await loadWorkspace();
        render();
      }
    });

    if (redirectUser) {
      clearTimeout(watchdog);
      await enterApp(redirectUser);
      return;
    }

    let existing = null;
    try { existing = await withTimeout(Cloud.waitAuth(), 8000, '인증 확인'); }
    catch (err) { console.warn('waitAuth failed', err); }

    clearTimeout(watchdog);

    if (existing) {
      await enterApp(existing);
      return;
    }
    WorkoutDB.setScope('guest');
    await WorkoutDB.open();
    const legacy = await WorkoutDB.readLegacy();
    const hasLegacy = (legacy.sessions || []).length || (legacy.customExercises || []).length;
    /* Guest mode can no longer be CHOSEN — the button that started it is gone,
       so signing in is the only way into the app from here.

       This resume path stays, deliberately. It only fires for a device that
       already has local records: someone who used the app before the button was
       removed, or whose records predate accounts entirely. Deleting it would not
       tighten anything — the records are already on the device — it would just
       strand them behind a login the owner may never have created. Their 설정
       screen still offers 로그인, which is how those records get carried into an
       account. */
    if (localStorage.getItem('fitlog-guest') === '1' || hasLegacy) {
      await enterApp(null, { guest: true });
      return;
    }

    state.authReady = true;
    render();
  }

  init().catch(err => {
    console.error('init failed', err);
    /* Fall back to local-only mode rather than showing a dead screen. */
    (async () => {
      try {
        WorkoutDB.setScope('guest');
        await WorkoutDB.open();
        await loadWorkspace();
        state.guest = true;
        state.authReady = true;
        render();
        toast('오프라인 모드로 시작했습니다');
      } catch (e) {
        appEl.innerHTML = `<main style="padding:40px 24px;color:#f87171;font-family:system-ui">
          저장소 오류: ${String(e)}</main>`;
      }
    })();
  });
})();
