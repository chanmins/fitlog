/* FITLOG — Main Application */
(() => {
  /* ── Utilities ──────────────────────────── */
  const WEEKDAYS = ['일','월','화','수','목','금','토'];
  const WEEKDAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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


  /* ── DOM root ───────────────────────────── */
  const appEl = document.getElementById('app');
  const importInput = document.getElementById('import-file');

  /* ── Data helpers ───────────────────────── */
  function emptySession(date) {
    return { date, parts: [], notes: '', exercises: [], run: { km:'', minutes:'', notes:'' },
             completed: false, completedAt: 0 };
  }
  function normalizeSession(raw) {
    return {
      date: raw.date,
      parts: Array.isArray(raw.parts) ? raw.parts : [],
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
  function sessionSummary(s) {
    return orderedParts(s.parts).map(p => p.label).join(', ');
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
  /* ── 개인 기록 (PR) ──────────────────────────────────────────────────────
     "이번 세트가 지금까지 중 최고인가" 를 판단합니다. 기준은 두 가지입니다.

       · 최고 중량   그 운동에서 들어본 가장 무거운 무게
       · 추정 1RM    한 번에 들 수 있는 무게의 추정치 (Epley: kg × (1 + 회수/30))

     중량만 보면 100kg×1 이 90kg×10 을 이깁니다. 실제로는 후자가 훨씬 강한
     수행인데도요. 그래서 둘 다 봅니다. 웜업 세트는 제외합니다 — 가볍게 몸을
     푼 것을 기록이라고 부르면 기록이라는 말이 값을 잃습니다. */
  function epley1RM(kg, reps) {
    if (!Number.isFinite(kg) || !Number.isFinite(reps) || kg <= 0 || reps <= 0) return 0;
    return kg * (1 + reps / 30);
  }

  function setScore(st) {
    const kg = Number(st.kg), reps = Number(st.reps);
    if (st.warmup || !Number.isFinite(kg) || !Number.isFinite(reps) || kg <= 0 || reps <= 0) return null;
    return { kg, reps, orm: epley1RM(kg, reps) };
  }

  /* 이 운동의 지금까지 최고 기록. beforeDate 를 주면 그 날은 빼고 셉니다
     (오늘 세트가 오늘의 다른 세트에 밀려 기록이 아닌 것으로 판정되면
     곤란하므로, 판정할 때는 항상 오늘을 빼고 봅니다). */
  function personalBest(name, beforeDate) {
    let best = null;
    for (const s of state.sessions) {
      if (beforeDate && s.date >= beforeDate) continue;
      for (const ex of s.exercises || []) {
        if (ex.name !== name) continue;
        for (const st of ex.sets || []) {
          if (!st.done) continue;
          const sc = setScore(st);
          if (!sc) continue;
          if (!best || sc.kg > best.kg) best = { ...sc, date: s.date, kind: 'kg' };
        }
      }
    }
    return best;
  }

  function bestOrm(name, beforeDate) {
    let best = 0;
    for (const s of state.sessions) {
      if (beforeDate && s.date >= beforeDate) continue;
      for (const ex of s.exercises || []) {
        if (ex.name !== name) continue;
        for (const st of ex.sets || []) {
          if (!st.done) continue;
          const sc = setScore(st);
          if (sc && sc.orm > best) best = sc.orm;
        }
      }
    }
    return best;
  }

  /* 방금 완료한 세트가 기록을 깼는지. 깼으면 무엇을 깼는지 돌려줍니다. */
  function checkPR(ex, set, date) {
    const sc = setScore(set);
    if (!sc) return null;
    const prevKg = personalBest(ex.name, date);
    const prevOrm = bestOrm(ex.name, date);
    /* 첫 기록은 PR 로 치지 않습니다. 처음 한 것은 전부 최고 기록이라
       축하가 의미를 잃습니다. */
    if (!prevKg && !prevOrm) return null;
    if (sc.kg > (prevKg ? prevKg.kg : 0)) return { type: 'kg', kg: sc.kg, reps: sc.reps, prev: prevKg ? prevKg.kg : 0 };
    if (sc.orm > prevOrm + 0.01) return { type: 'orm', kg: sc.kg, reps: sc.reps, orm: sc.orm, prev: prevOrm };
    return null;
  }

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

  function fmtSets(sets) {
    return (sets||[])
      .filter(s => s.kg!==''||s.reps!=='')
      .map(s => `${s.kg??'-'}kg×${s.reps??'-'}`)
      .join(' · ');
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
  /* ── 소모 칼로리 추정 ────────────────────────────────────────────────────
     계산식은 운동생리학의 표준인 MET 를 씁니다.

         kcal = MET × 3.5 × 체중(kg) ÷ 200 × 분

     MET 값은 2024 Adult Compendium of Physical Activities 에서 가져왔습니다.
     이 문서는 활동별 에너지 소비를 실측해 정리한, 이 분야에서 가장 널리
     쓰이는 기준표입니다.

     ── 러닝은 근거가 단단합니다
     거리와 시간이 있으니 속도가 나오고, 속도별 MET 는 표에 그대로 있습니다.

     ── 웨이트는 시간이 관건입니다
     세트 수만으로는 칼로리를 알 수 없습니다. 같은 10세트라도 40분에 한 것과
     90분에 걸쳐 한 것은 소모가 다릅니다. 그래서 세트를 완료할 때 시각을
     남기고(doneAt), 첫 세트부터 마지막 세트까지의 실제 시간을 씁니다.
     그 기록이 없는 예전 운동은 세트당 2.2분으로 어림잡습니다 — 세트 수행
     40초에 휴식 90초를 더한 값입니다.

     ── 왜 '추정' 이라고 적는가
     같은 사람이 같은 운동을 해도 실제 소모는 날마다 다르고, 어떤 공식도
     그걸 맞히지 못합니다. 이 숫자는 추세를 보는 용도이지 다이어트 계산기가
     아닙니다. 화면에 항상 '추정' 이라고 적는 이유입니다. */
  const MET_LIFT = { light: 3.5, normal: 5.0, hard: 6.0 };
  const LIFT_INTENSITY_LABEL = { light: '가볍게', normal: '보통', hard: '고강도' };
  const MIN_PER_SET_FALLBACK = 2.2;

  function liftIntensity() {
    const v = localStorage.getItem('fitlog-intensity');
    return MET_LIFT[v] ? v : 'normal';
  }
  function setLiftIntensity(v) {
    try { localStorage.setItem('fitlog-intensity', v); } catch (_) {}
  }

  function bodyWeight() {
    const w = Number(state.profile?.weightKg);
    return Number.isFinite(w) && w > 20 ? w : 0;
  }

  /* 속도(km/h) → MET. Compendium 의 구간표를 그대로 옮기고 사이는 이어 씁니다. */
  function runMet(kmh) {
    if (!Number.isFinite(kmh) || kmh <= 0) return 0;
    const T = [[6.4,6.5],[7.2,7.8],[8.4,8.5],[9.0,9.0],[9.7,9.3],[10.8,10.5],
               [11.3,11.0],[12.9,11.8],[14.5,13.0],[16.1,14.8],[19.3,18.5],[22.5,23.0]];
    if (kmh <= T[0][0]) return T[0][1];
    for (let i = 1; i < T.length; i++) {
      if (kmh <= T[i][0]) {
        const [x0, y0] = T[i - 1], [x1, y1] = T[i];
        return y0 + (y1 - y0) * ((kmh - x0) / (x1 - x0));
      }
    }
    return T[T.length - 1][1];
  }

  function kcalFrom(met, minutes, weight) {
    if (!met || !minutes || !weight) return 0;
    return met * 3.5 * weight / 200 * minutes;
  }

  /* 웨이트에 실제로 쓴 시간(분). 완료 시각이 둘 이상 있으면 실측, 없으면 추정. */
  function liftMinutes(s) {
    const stamps = [];
    let doneSets = 0;
    for (const ex of s.exercises || []) {
      for (const st of ex.sets || []) {
        if (!st.done) continue;
        doneSets++;
        if (Number.isFinite(st.doneAt)) stamps.push(st.doneAt);
      }
    }
    if (!doneSets) return { minutes: 0, measured: false, sets: 0 };
    if (stamps.length >= 2) {
      stamps.sort((a, b) => a - b);
      /* 마지막 세트 자체의 수행 시간이 끝 시각 뒤에 안 잡히므로 한 세트분을
         더합니다. 그리고 4시간을 넘기면 중간에 앱을 켜둔 채 자리를 뜬
         경우로 보고 추정값으로 되돌립니다 — 그대로 쓰면 하루 소모가
         터무니없이 커집니다. */
      const span = (stamps[stamps.length - 1] - stamps[0]) / 60000 + MIN_PER_SET_FALLBACK;
      if (span > 0 && span <= 240) return { minutes: span, measured: true, sets: doneSets };
    }
    return { minutes: doneSets * MIN_PER_SET_FALLBACK, measured: false, sets: doneSets };
  }

  /* 하루치 소모. { lift, run, total, measured, minutes } */
  function sessionKcal(s) {
    const w = bodyWeight();
    const empty = { lift: 0, run: 0, total: 0, measured: false, minutes: 0, runMin: 0 };
    if (!w || !s) return empty;

    const lm = liftMinutes(s);
    const lift = kcalFrom(MET_LIFT[liftIntensity()], lm.minutes, w);

    const km = Number(s.run?.km), min = Number(s.run?.minutes);
    let run = 0;
    if (Number.isFinite(min) && min > 0) {
      const kmh = (Number.isFinite(km) && km > 0) ? km / (min / 60) : 0;
      /* 거리를 안 적었으면 '조깅, 자기 페이스' 7.5 MET 를 씁니다. */
      run = kcalFrom(kmh ? runMet(kmh) : 7.5, min, w);
    }
    return {
      lift: Math.round(lift), run: Math.round(run), total: Math.round(lift + run),
      measured: lm.measured, minutes: Math.round(lm.minutes), runMin: Number.isFinite(min) ? min : 0,
    };
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
  function fmtNum(n) {
    return Math.round(n).toLocaleString('ko-KR');
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
  function renderExerciseTrend(exName) {
    const history = [];
    const sorted = [...state.sessions].sort((a,b) => a.date < b.date ? -1 : 1);
    for (const s of sorted) {
      const ex = (s.exercises||[]).find(e => e.name === exName);
      if (!ex) continue;
      const working = (ex.sets||[]).filter(st => !st.warmup);
      const maxKg = Math.max(...working.map(st=>Number(st.kg)||0), 0);
      if (maxKg > 0) history.push({ date: shortDate(s.date), kg: maxKg });
      if (history.length >= 10) break;
    }
    if (history.length < 2) return '';
    const pr = Math.max(...history.map(p=>p.kg));
    const minKg = Math.min(...history.map(p=>p.kg));
    const range = pr - minKg || 1;
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
        ${last?`<text x="${c.x.toFixed(1)}" y="${(c.y-7).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="800" fill="var(--accent)">${c.kg}kg</text>`:''}`;
    }).join('');
    return `<div class="trend-card">
      <div class="trend-header">
        <span class="trend-title">최고 무게 추이</span>
        <span class="trend-pr">PR <strong>${pr}kg</strong></span>
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
  /* Sunday-first, matching WEEKDAYS_SHORT and the history calendar.
     (This used to start on Monday while the labels started on Sunday, so
     every day in the week strip was captioned one day off.) */
  function getWeekDays() {
    const today = new Date();
    const sun = new Date(today);
    sun.setDate(today.getDate() - today.getDay());
    return Array.from({length:7}, (_,i) => {
      const d = new Date(sun); d.setDate(sun.getDate()+i);
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
    await WorkoutDB.putSession(clone(s));
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

  /* 칼로리 숫자 옆에는 반드시 '어떻게 나온 값인지' 로 가는 길이 있어야
     합니다. 근거 없이 숫자만 있는 건 그냥 지어낸 값과 구분되지 않습니다. */
  async function showKcalInfo() {
    const w = bodyWeight();
    const s = state.session;
    const k = s ? sessionKcal(s) : null;
    const lines = [
      'MET × 3.5 × 체중 ÷ 200 × 분',
      '',
      `· 체중 ${w ? w + 'kg' : '(설정 안 됨)'} 기준`,
      `· 웨이트 ${LIFT_INTENSITY_LABEL[liftIntensity()]} = ${MET_LIFT[liftIntensity()]} MET`,
      '· 러닝은 거리와 시간으로 속도를 내어 그 속도의 MET 적용',
      '',
      k && k.total
        ? (k.measured
            ? `오늘은 세트 완료 시각으로 잰 실제 ${k.minutes}분을 썼습니다.`
            : `오늘은 시간 기록이 없어 세트당 2.2분으로 어림잡았습니다 (${k.minutes}분).`)
        : '세트를 완료하면 그 시각을 기록해 실제 운동 시간을 잽니다.',
      '',
      'MET 값 출처는 2024 Adult Compendium of Physical Activities 입니다.',
      '같은 운동도 그날 컨디션에 따라 실제 소모가 달라지므로, 정확한 값이',
      '아니라 추세를 보는 용도로 쓰세요.',
    ];
    await ask({ title: '소모 칼로리는 어떻게 계산하나요', body: lines.join('\n'), confirmText: '알겠어요', cancelText: '' });
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

  /* Repaint ONLY the big number inside an open picker sheet.
     Going through render() would swap appEl.innerHTML, destroying and
     rebuilding the sheet — which replays its slide-up animation and makes the
     whole panel appear to blink on every single keypress. */
  function paintPickerValue() {
    const p = state.weightPicker || state.repsPicker;
    if (!p) return;
    const el = document.querySelector('.picker-big-num');
    if (!el) { render(); return; }
    el.textContent = pickerDisplay(p);
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
    try { saved = JSON.parse(localStorage.getItem(REST_KEY) || 'null'); } catch (_) {}
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

  function startRestTimer(seconds, label) {
    /* Checked here rather than at each call site so nothing can start the timer
       behind the setting's back. */
    if (!restTimerOn()) return;
    state.restTimer = { endsAt: Date.now() + seconds * 1000, duration: seconds, label: label || '', chimed: false };
    saveRestTimer();
    renderRestTimerBar();
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
    if (!state.restTimer) return;
    state.restTimer.endsAt += deltaSec * 1000;
    state.restTimer.duration = Math.max(5, state.restTimer.duration + deltaSec);
    saveRestTimer();
    renderRestTimerBar();
    pushRestNotification();
  }

  function cancelRestTimer() {
    state.restTimer = null;
    saveRestTimer();
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
      if (navigator.vibrate) { try { navigator.vibrate([120, 80, 120]); } catch (_) {} }
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
  }

  /* ── Navigation ─────────────────────────── */
  async function goTab(tab) {
    /* Leaving the screen is the one moment a held past-day edit would be lost
       silently, so it is the one place that has to ask. */
    if (!await confirmLeavePast()) return;
    state.tab = tab;
    /* The tab bar is visible over the day-summary overlay now, so tapping a tab
       has to dismiss it — otherwise the tab switches behind a screen that is
       still covering it. */
    state.summaryDate = null;
    closeAllSheets();
    if (tab === 'workout' && !state.session) {
      state.session = normalizeSession(await WorkoutDB.getSession(state.date) || emptySession(state.date));
    }
    render();
  }
  function closeAllSheets() {
    state.pickerPart = null;
    state.pickSelection = [];
    state.routineSheet = false;
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

  /* Reverts and leaves edit mode. Used when navigating away from the day. */
  function discardPastEdit() {
    revertPastEdit();
    state.editingPast = false;
    state.pastBaseline = null;
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
  function render() {
    if (!state.authReady) { appEl.innerHTML = renderSplash(); return; }
    if (!state.user && !state.guest) {
      appEl.innerHTML = (state.authMode === 'signup' ? renderSignup()
                      : state.authMode === 'reset'  ? renderReset()
                      : renderLogin())
                      + (state.yearPicker ? renderYearPickerSheet() : '');
      bindEvents(); positionYearWheel(); return;
    }
    /* Signed in but no 아이디 yet — finish setting the account up first. */
    if (state.user && state.onboarding) {
      appEl.innerHTML = renderOnboarding() + (state.yearPicker ? renderYearPickerSheet() : '');
      bindEvents(); positionYearWheel(); return;
    }

    let html = '';
    if (state.tab === 'home')          html = renderHome();
    else if (state.tab === 'workout')  html = renderWorkout();
    else if (state.tab === 'history')  html = renderHistory();
    else if (state.tab === 'settings') html = renderSettings();

    if (state.profileEditing) html += renderProfileSheet();
    if (state.yearPicker)     html += renderYearPickerSheet();
    if (state.weightPicker)   html += renderWeightPickerSheet();
    if (state.repsPicker)     html += renderRepsPickerSheet();
    if (state.exerciseInfoId) html += renderExerciseInfoSheet(state.exerciseInfoId);
    if (state.pickerPart)     html += renderExercisePickerSheet(state.pickerPart);
    if (state.routineSheet)   html += renderRoutineSheet();
    if (state.routineEdit)    html += renderRoutineEditor();

    html += renderBottomNav();
    /* Full-screen overlay, so it can be opened from home, history or the
       workout screen without any of them needing to know about it. */
    if (state.summaryDate) html += renderDaySummary(state.summaryDate);
    appEl.innerHTML = html;
    bindEvents();
    positionYearWheel();
    syncOverlayScroll();
    flushPendingFlash();
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
    const overlay = document.querySelector('.detail-screen');
    document.body.classList.toggle('overlay-open', !!overlay);
    const key = !overlay ? null
      : state.routineEdit ? `routine:${state.routineEdit.id || 'new'}`
      : state.summaryDate ? `day:${state.summaryDate}`
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
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
          <label class="field-label" for="su-height">키 (cm)</label>
          <input class="login-input" id="su-height" data-su="heightCm" type="text"
                 inputmode="decimal" maxlength="5" placeholder="175" value="${esc(s.heightCm)}">
        </div>
        <div>
          <label class="field-label" for="su-weight">몸무게 (kg)</label>
          <input class="login-input" id="su-weight" data-su="weightKg" type="text"
                 inputmode="decimal" maxlength="5" placeholder="70" value="${esc(s.weightKg)}">
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
    return `<div class="sheet-backdrop">
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
                     inputmode="decimal" maxlength="5" placeholder="175" value="${esc(s.heightCm)}">
              <span class="form-row-unit">cm</span>
            </div>
            <div class="form-row">
              <label class="form-row-label" for="pf-weight">몸무게</label>
              <input class="form-row-input num" id="pf-weight" data-su="weightKg" type="text"
                     inputmode="decimal" maxlength="5" placeholder="70" value="${esc(s.weightKg)}">
              <span class="form-row-unit">kg</span>
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
    return `<div class="sheet-backdrop">
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
            <label class="field-label" for="ob-height">키 (cm)</label>
            <input class="login-input" id="ob-height" data-su="heightCm" type="text" inputmode="decimal" maxlength="5" placeholder="175" value="${esc(s.heightCm)}">
          </div>
          <div>
            <label class="field-label" for="ob-weight">몸무게 (kg)</label>
            <input class="login-input" id="ob-weight" data-su="weightKg" type="text" inputmode="decimal" maxlength="5" placeholder="70" value="${esc(s.weightKg)}">
          </div>
        </div>
      </div>

      <div class="signup-actions">
        <button class="btn-hero" data-act="onboarding-save" ${busy ? 'disabled' : ''}>${busy ? '저장 중…' : '시작하기'}</button>
      </div>
    </main>`;
  }

  /* ── Bottom Nav ───────────────────────────── */
  function renderBottomNav() {
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
    return `<nav class="bottom-nav">${tabs.map(t=>`
      <button class="nav-tab${state.tab===t.id?' active':''}" data-act="go-tab" data-tab="${t.id}">
        ${t.icon}<span>${t.label}</span>
      </button>`).join('')}</nav>`;
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
          <strong>${esc(names)}</strong>가 부족해요 — ${esc(why)}.
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
    const td = new Date();

    const weekStrip = weekDays.map((iso, i) => {
      const [, , d] = iso.split('-').map(Number);
      const hasSess = state.sessions.some(s => s.date === iso);
      const isToday = iso === today;
      return `<div class="week-day${hasSess?' done':''}${isToday?' today':''}">
        <div class="ring">${hasSess ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : d}</div>
        <span class="wd-label">${WEEKDAYS_SHORT[i]}</span>
      </div>`;
    }).join('');

    /* week stats */
    const weekSessions = state.sessions.filter(s => weekDays.includes(s.date));
    const weekCount = weekSessions.length;
    const weekKm = weekSessions.reduce((a,s)=>a+(Number(s.run?.km)||0),0);
    /* Running only earns a slot once there is running to show — an eternal
       "0 km" is just a reminder of something the user doesn't do. */
    const everRan = state.sessions.some(s => Number(s.run?.km) > 0);

    let todayBlock;
    if (todaySess) {
      const parts = (todaySess.parts||[]).map(id=>{
        const p = PARTS.find(x=>x.id===id);
        return p ? `<span class="muscle-tag" style="background:color-mix(in srgb,${p.color} 16%,var(--surface-2));color:${p.color}">${p.label}</span>` : '';
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
      todayBlock = `<button class="today-card${finished ? ' done' : ''}" data-act="open-summary" data-date="${todaySess.date}">
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
          <span><b>${todaySess.exercises.length}</b>개 운동</span>
          <span><b>${tStats.done}</b>세트 완료</span>
          ${Number.isFinite(tRun) && tRun ? `<span><b>${tRun}</b>km</span>` : ''}
        </div>
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

    const recent = state.sessions.slice(0, 8);
    const recentHtml = recent.length ? `
      <div class="sec-head"><div class="sec-title">최근 기록</div></div>
      <div class="recent-list">${recent.map(s => {
        const [, m, d] = s.date.split('-').map(Number);
        const dots = (s.parts||[]).map(id=>{
          const p = PARTS.find(x=>x.id===id);
          return p ? `<span class="pdot" style="background:${p.color}"></span>` : '';
        }).join('');
        const sets = (s.exercises||[]).reduce((a,ex)=>a+(ex.sets||[]).filter(st=>st.done).length,0);
        const metaVol = sets ? `${sets}세트 · ` : '';
        return `<button class="recent-row" data-act="open-day" data-date="${s.date}">
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
      }).join('')}</div>` : '';

    const hour = td.getHours();
    const greet = hour < 5 ? '늦은 밤이네요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen">
        <div class="home-hero">
          <div class="home-date">${td.getMonth()+1}월 ${td.getDate()}일 (${WEEKDAYS[td.getDay()]})</div>
          <div class="home-title">${greet},<br><em>오늘도 가볍게</em> 시작해요</div>
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

  /* ── Workout Tab ──────────────────────────── */
  function renderWorkout() {
    const s = state.session;
    if (!s) return `<header class="topbar"><div class="topbar-title">기록</div></header>
      <main class="screen"><div class="empty-state"><div class="empty-icon">🏋️</div>오늘의 운동을 시작하세요</div>
      <button class="btn-hero" data-act="today">오늘 기록 시작하기</button></main>`;

    const partTiles = PARTS.map(p => {
      const on = s.parts.includes(p.id);
      const count = p.kind === 'weight' ? s.exercises.filter(e => e.part === p.id).length : 0;
      const sub = on
        ? (p.kind === 'weight' ? `${count}개 운동` : '기록 중')
        : '탭하여 추가';
      return `<button class="part-tile${on?' on':''}" style="--pt-color:${p.color}" data-act="toggle-part" data-part="${p.id}">
        <span class="pt-check"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
        <span class="pt-icon">${PART_ICONS[p.id]||''}</span>
        <span class="pt-name">${p.label}</span>
        <span class="pt-count">${sub}</span>
      </button>`;
    }).join('');

    let blocks = '';

    if (s.parts.includes('run')) {
      blocks += `<div class="run-card">
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

    for (const part of PARTS) {
      if (part.kind !== 'weight') continue;
      if (!s.parts.includes(part.id)) continue;
      const exercises = s.exercises.filter(e => e.part === part.id);
      blocks += `<div class="sec-head">
        <div class="sec-title" style="color:${part.color}">${part.label}</div>
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

    if (!s.parts.length) {
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
          ${s.exercises.length ? `
          <div class="sum-item">
            <div class="sum-val">${s.exercises.length}<span>개</span></div>
            <div class="sum-lbl">운동</div>
          </div>` : ''}
          ${hasRunData(s.run) ? `
          <div class="sum-item">
            <div class="sum-val">${Number.isFinite(runKm)&&runKm?runKm:'-'}<span>km</span></div>
            <div class="sum-lbl">러닝</div>
          </div>` : ''}
          ${(() => {
            const k = sessionKcal(s);
            if (!k.total) return '';
            return `<button class="sum-item" data-act="kcal-info">
              <div class="sum-val">${fmtNum(k.total)}<span>kcal</span></div>
              <div class="sum-lbl">추정 소모 ⓘ</div>
            </button>`;
          })()}
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
          <button class="btn-ghost" data-act="open-summary" data-date="${s.date}">기록 보기</button>
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
        <button class="btn-icon ghost" data-act="go-tab" data-tab="home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">운동 기록</div>
        <div class="topbar-spacer"></div>
        ${isToday ? '' : `<button class="btn-today" data-act="today">오늘로</button>`}
      </header>
      <main class="screen">
        <div class="day-nav">
          <button class="day-nav-arrow" data-act="shift-day" data-delta="-1" aria-label="이전 날">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <label class="day-nav-mid">
            <div class="day-nav-date">${esc(longDate(s.date))}</div>
            <div class="day-nav-rel">${esc(relDayLabel(s.date))}</div>
            <input type="date" data-act="change-date" value="${s.date}" max="${todayISO()}" aria-label="날짜 선택">
          </label>
          <button class="day-nav-arrow" data-act="shift-day" data-delta="1" aria-label="다음 날"${isToday?' disabled':''}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
        ${summary}
        <div class="sec-head" style="margin-top:18px">
          <div class="sec-title">부위 선택</div>
          <button class="routine-btn" data-act="open-routines">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>
            루틴${state.routines.length ? ` ${state.routines.length}` : ''}
          </button>
        </div>
        <div class="part-grid">${partTiles}</div>

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
            const kg = (set.kg !== '' && set.kg != null) ? set.kg : '–';
            const reps = (set.reps !== '' && set.reps != null) ? set.reps : '–';
            /* A held stretch carries no weight, so "–kg × 30" would be noise
               around the only number that means anything: the seconds. */
            const val = hold
              ? `${esc(String(reps))}<i>초</i>`
              : `${esc(String(kg))}<i>kg</i> × ${esc(String(reps))}`;
            return `<span class="dsum-set${warm ? ' warm' : ''}${set.done ? ' done' : ''}${set.pr ? ' pr' : ''}">
              <b>${warm ? 'W' : workingNo}</b>${val}${set.pr ? '<em>PR</em>' : ''}
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
          <div class="dsum-parts">${orderedParts(s.parts).map(p =>
            `<span class="muscle-tag" style="background:color-mix(in srgb,${p.color} 16%,var(--surface-2));color:${p.color}">${p.label}</span>`
          ).join('')}</div>
          <div class="dsum-stats">
            <div><b>${s.exercises.length}</b><span>운동</span></div>
            <div><b>${stats.done}</b><span>완료 세트</span></div>
            ${hasRunData(s.run) && Number.isFinite(runKm) && runKm ? `<div><b>${runKm}</b><span>km</span></div>` : ''}
            ${(() => { const k = sessionKcal(s); return k.total ? `<div><b>${fmtNum(k.total)}</b><span>kcal 추정</span></div>` : ''; })()}
          </div>
        </div>
        ${body}
        <button class="btn-ghost dsum-edit" data-act="edit-day" data-date="${s.date}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          이 날 기록 편집하기
        </button>`;
  }

  /* 홈이나 기록 화면에서 열 때 쓰는 전체 화면판. */
  function renderDaySummary(date) {
    const s = findDay(date);
    if (!s) return '';
    return `<div class="detail-screen">
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

  /* ── Exercise Card ────────────────────────── */
  function renderExerciseCard(ex) {
    const libEx = findExercise(ex.id) || state.customExercises.find(e => e.id === ex.id);
    const last = lastLog(ex.name, state.session.date);
    const primary = libEx?.primary || [];
    const secondary = libEx?.secondary || [];
    const allMuscles = [...primary, ...secondary];

    const muscleTags = allMuscles.map(m =>
      `<span class="muscle-tag${primary.includes(m)?' primary':''}">${esc(MUSCLE_GROUPS[m]||m)}</span>`
    ).join('');


    /* Warm-ups are labelled W and don't consume a number, so the working sets
       still read 1, 2, 3 — which is how a lifter counts them. */
    let workingNo = 0;
    const hold = isHoldExercise(ex);
    const sets = ex.sets.map((set) => {
      const done = set.done;
      const warmup = !!set.warmup;
      if (!warmup) workingNo++;
      const label = warmup ? 'W' : workingNo;
      const kg   = (set.kg   !== '' && set.kg   != null) ? set.kg   : '--';
      const reps = (set.reps !== '' && set.reps != null) ? set.reps : '--';
      return `<div class="set-row${done?' done':''}${warmup?' warmup':''}${hold?' hold':''}">
        <button class="set-num${warmup?' warmup':''}" data-act="toggle-warmup" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="웜업 세트로 전환" title="탭하면 웜업/일반 세트 전환">${label}</button>
        ${hold ? '' : `<button class="val-chip${done?' done':''}" data-act="open-weight" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${kg}</span>
          <span class="val-chip-unit">kg</span>
        </button>`}
        <button class="val-chip${done?' done':''}" data-act="open-reps" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${reps}</span>
          <span class="val-chip-unit">${hold ? '초' : '회'}</span>
        </button>
        ${set.pr ? '<span class="pr-flag" title="개인 기록">PR</span>' : ''}
        <button class="done-toggle${done?' done':''}" data-act="toggle-done" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="세트 완료">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
        <button class="set-del" data-act="del-set" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="세트 삭제">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('');

    const prog = exProgress(ex);
    const allDone = prog.total > 0 && prog.done === prog.total;
    const metaBits = [];
    if (prog.total) metaBits.push(`${prog.done}/${prog.total} 세트`);

    return `<article class="ex-card${allDone?' all-done':''}" data-exid="${esc(ex.id)}">
      <div class="ex-card-head">
        <div style="flex:1;min-width:0">
          <div class="ex-card-name">${allDone?'<span class="ex-done-tick"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>':''}${esc(ex.name)}</div>
          ${muscleTags ? `<div class="ex-card-sub">${muscleTags}</div>` : ''}
          ${metaBits.length ? `<div class="ex-card-meta">${esc(metaBits.join(' · '))}</div>` : ''}
        </div>
        <button class="btn-icon ghost" data-act="show-ex-info" data-exid="${esc(ex.id)}" data-exname="${esc(ex.name)}">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <button class="btn-icon ghost danger" data-act="del-ex" data-ex="${esc(ex.id)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="set-table">
        <div class="set-table-head${hold ? ' hold' : ''}"><span>#</span>${hold ? '' : '<span>무게</span>'}<span>${hold ? '시간' : '횟수'}</span><span>완료</span><span></span></div>
        ${sets}
        <button class="add-set-row" data-act="add-set" data-ex="${esc(ex.id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          세트 추가
        </button>
      </div>
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
    return `<div class="sheet-backdrop">
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
          <div class="picker-big-unit">kg</div>
        </button>
        ${adjRow('numpad-w-adj', WEIGHT_STEPS)}
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
    return `<div class="sheet-backdrop">
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
      : '';

    return `<div class="sheet-backdrop">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div class="info-hero">
            <div class="info-name">${esc(libEx.name)}</div>
            ${libEx.nameEn ? `<div class="info-name-en">${esc(libEx.nameEn)}</div>` : ''}
          </div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="info-meta" style="margin-top:0;margin-bottom:16px">
          <span class="info-badge eq">${esc(eq)}</span>
          <span class="info-badge"><span class="diff-stars">${diffStars}</span></span>
        </div>
        ${photo}
        <div class="muscle-legend">
          <div class="muscle-legend-title">주동근</div>
          <div class="muscle-legend-row">${primaryPills}</div>
          ${secondary.length ? `<div class="muscle-legend-title" style="margin-top:8px">협력근</div><div class="muscle-legend-row">${secondaryPills}</div>` : ''}
        </div>
        ${renderExerciseTrend(libEx.name)}
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
    const library = libraryFor(partId).filter(e => !q || e.name.toLowerCase().includes(q) || (e.nameEn||'').toLowerCase().includes(q));
    if (!library.length) return '<div class="help-text">검색 결과가 없습니다. 아래에서 직접 추가할 수 있습니다.</div>';
    return library.map(item => {
      /* Three visual states, kept distinct so the footer count always matches
         what looks selected: already in today's session (muted, "빼기"),
         newly picked (bright check), and untouched. */
      const inSession = added.has(item.name);
      const picked = state.pickSelection.some(x => x.name === item.name);
      const eq = EQUIPMENT_LABEL[item.equipment] || '';
      return `<div class="pick-item${inSession ? ' added' : picked ? ' on' : ''}">
        <button class="pick-item-name" data-act="toggle-pick" data-part="${partId}" data-name="${esc(item.name)}" data-exid="${esc(item.id||'')}" ${inSession?'disabled':''}>
          <span>${esc(item.name)}</span>
          ${item.nameEn ? `<span class="pick-item-en">${esc(item.nameEn)}</span>` : ''}
        </button>
        ${eq ? `<span class="pick-item-eq">${esc(eq)}</span>` : ''}
        ${inSession ? `<span class="pick-added-tag">추가됨</span><button class="custom-del" data-act="quick-del-ex" data-name="${esc(item.name)}" data-part="${partId}">빼기</button>` : ''}
        ${item.custom && !inSession ? `<button class="custom-del" data-act="del-custom" data-id="${esc(item.id)}">삭제</button>` : ''}
        ${inSession ? '' : `<div class="pick-check${picked?' on':''}">${picked ? CHECK_SVG : ''}</div>`}
      </div>`;
    }).join('');
  }

  /* ── Exercise Picker Sheet ────────────────── */
  function renderExercisePickerSheet(partId) {
    const part = PARTS.find(p => p.id === partId);
    const n = state.pickSelection.length;
    return `<div class="sheet-backdrop">
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
        <div class="search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="picker-search" placeholder="운동 검색" value="${esc(state.exerciseSearch)}" data-act="search-ex">
        </div>
        <div class="pick-list">${buildPickItems(partId)}</div>
        <div class="custom-add-row">
          <input id="custom-name" placeholder="나만의 운동 직접 추가">
          <button class="btn-add-sm" data-act="add-custom" data-part="${partId}">추가</button>
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
    const lead = first.getDay();               /* 0=일 */
    const today = todayISO();

    const byDate = new Map(state.sessions.map(s => [s.date, s]));
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${mKey}-${String(d).padStart(2, '0')}`;
      const s = byDate.get(iso);
      const isToday = iso === today;
      const future = iso > today;
      const dots = s ? (s.parts || []).slice(0, 4).map(id => {
        const p = PARTS.find(x => x.id === id);
        return p ? `<span class="cal-dot" style="background:${p.color}"></span>` : '';
      }).join('') : '';
      cells += `<button class="cal-cell${s ? ' done' : ''}${isToday ? ' today' : ''}${future ? ' future' : ''}"
        data-act="open-day" data-date="${iso}"${future ? ' disabled' : ''}>
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
        <div class="cal-dow">${['일','월','화','수','목','금','토'].map((w, i) =>
          `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</span>`).join('')}</div>
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

  /* 월요일 시작 주의 첫날 */
  function weekStart(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.toISOString().slice(0, 10);
  }

  function statsBuckets() {
    const mode = statsRange();
    const n = STATS_BUCKETS[mode];
    const keys = [];
    const today = new Date(todayISO() + 'T00:00:00');
    for (let i = n - 1; i >= 0; i--) {
      if (mode === 'week') {
        const d = new Date(today); d.setDate(d.getDate() - i * 7);
        keys.push(weekStart(d.toISOString().slice(0, 10)));
      } else {
        const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
        keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }
    const blank = () => ({ km: 0, min: 0, sets: {}, total: 0, days: 0, volume: 0, kcal: 0 });
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
      if (any) { b.days++; b.kcal += sessionKcal(s).total; }
    }
    return keys.map(k => {
      const b = map.get(k);
      const label = mode === 'week'
        ? (() => { const [, m, d] = k.split('-'); return `${Number(m)}/${Number(d)}`; })()
        : `${Number(k.split('-')[1])}월`;
      return { key: k, label, ...b };
    });
  }

  /* 세로 막대 하나. 위쪽 끝만 둥글게 깎아 바닥선에 붙어 있게 둡니다. */
  function bar(x, y, w, h, color, round) {
    if (h <= 0) return '';
    const r = Math.min(round || 0, w / 2, h);
    return `<path d="M${x} ${y + h} L${x} ${y + r} Q${x} ${y} ${x + r} ${y}
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
      return bar(x, y, bw, h, 'var(--run-color)', 4)
        + (r.km ? `<text x="${x + bw / 2}" y="${y - 4}" class="ch-val">${r.km % 1 ? r.km.toFixed(1) : r.km}</text>` : '')
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
        out += bar(x, y + (first ? 0 : 1), bw, Math.max(1, h - (first ? 0 : 2)), part.color, first ? 4 : 0);
        acc += h; first = false;
      }
      const detail = weightParts.filter(p => r.sets[p.id]).map(p => `${p.label} ${r.sets[p.id]}`).join(', ');
      return out
        + (r.total ? `<text x="${x + bw / 2}" y="${PAD_T + plotH - acc - 4}" class="ch-val">${r.total}</text>` : '')
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

    /* ── 총 볼륨 (무게 × 횟수)
          세트 수는 60kg×10 과 100kg×10 을 똑같이 1세트로 셉니다. 실제로 든
          무게를 곱해야 힘든 날과 가벼운 날이 구분됩니다. 한 종류라 범례는
          필요 없습니다 — 제목이 곧 이름입니다. */
    const maxVol = Math.max(...rows.map(r => r.volume), 1);
    const fmtVol = v => v >= 10000 ? `${(v / 1000).toFixed(1)}t` : fmtNum(v);
    const volBars = rows.map((r, i) => {
      const x = PAD_L + slot * i + (slot - bw) / 2;
      const h = r.volume ? Math.max(3, (r.volume / maxVol) * plotH) : 0;
      const y = PAD_T + plotH - h;
      return bar(x, y, bw, h, 'var(--vol-color)', 4)
        + (r.volume ? `<text x="${x + bw / 2}" y="${y - 4}" class="ch-val">${fmtVol(r.volume)}</text>` : '')
        + `<title>${r.label} · ${fmtNum(r.volume)}kg</title>`;
    }).join('');

    /* ── 추정 소모 칼로리 (한 종류라 범례 없음) */
    const maxKcal = Math.max(...rows.map(r => r.kcal), 1);
    const kcalBars = rows.map((r, i) => {
      const x = PAD_L + slot * i + (slot - bw) / 2;
      const h = r.kcal ? Math.max(3, (r.kcal / maxKcal) * plotH) : 0;
      const y = PAD_T + plotH - h;
      return bar(x, y, bw, h, 'var(--kcal-color)', 4)
        + (r.kcal ? `<text x="${x + bw / 2}" y="${y - 4}" class="ch-val">${fmtNum(r.kcal)}</text>` : '')
        + `<title>${r.label} · 약 ${fmtNum(r.kcal)}kcal</title>`;
    }).join('');

    const totKm = rows.reduce((a, r) => a + r.km, 0);
    const totSets = rows.reduce((a, r) => a + r.total, 0);
    const totDays = rows.reduce((a, r) => a + r.days, 0);
    const totVol = rows.reduce((a, r) => a + r.volume, 0);
    const totKcal = rows.reduce((a, r) => a + r.kcal, 0);

    return `<div class="stats-card">
      <div class="stats-head"><div class="sec-title">운동량 추이</div>${toggle}</div>

      <div class="stats-sum">
        <div><b>${totDays}</b><span>운동일</span></div>
        <div><b>${totSets}</b><span>세트</span></div>
        <div><b>${fmtVol(totVol)}</b><span>총 볼륨</span></div>
        ${totKcal ? `<div><b>${fmtNum(totKcal)}</b><span>kcal 추정</span></div>` : ''}
        <div><b>${totKm % 1 ? totKm.toFixed(1) : totKm}</b><span>km</span></div>
      </div>

      <div class="ch-title">러닝 <span>km</span></div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 러닝 거리">
        ${base}${yLab(maxKm % 1 ? maxKm.toFixed(1) : maxKm)}${runBars}${axis}
      </svg>

      ${totKcal ? `
      <div class="ch-title">추정 소모 <span>kcal · 눌러서 계산 방법 보기</span></div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 추정 소모 칼로리" data-act="kcal-info">
        ${base}${yLab(fmtNum(maxKcal))}${kcalBars}${axis}
      </svg>` : ''}

      <div class="ch-title">총 볼륨 <span>무게 × 횟수</span></div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 총 볼륨">
        ${base}${yLab(fmtVol(maxVol))}${volBars}${axis}
      </svg>

      <div class="ch-title">부위별 세트</div>
      <svg class="ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="${modeLabel}별 부위 세트 수">
        ${base}${yLab(maxSets)}${setBars}${axis}
      </svg>
      ${legend ? `<div class="ch-legend">${legend}</div>` : ''}
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
        <span class="pr-kg">${r.kg}<i>kg</i> <s>×${r.reps}</s></span>
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
        body += `<button class="recent-row" data-act="open-day" data-date="${s.date}">
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

    return `<header class="topbar"><div class="topbar-title">히스토리</div></header>
      <main class="screen">${body}</main>`;
  }

  /* ── Settings Tab ─────────────────────────── */
  function renderSettings() {
    const u = state.user;
    const p = state.profile || {};
    const bits = [];
    if (p.gender) bits.push({ male: '남성', female: '여성' }[p.gender]);
    if (p.birthYear) bits.push(`${new Date().getFullYear() - Number(p.birthYear) + 1}세`);
    if (p.heightCm) bits.push(`${p.heightCm}cm`);
    if (p.weightKg) bits.push(`${p.weightKg}kg`);

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
      <main class="screen settings-screen">
        ${account}

        <div class="settings-label">운동</div>
        <div class="settings-group">
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

          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">운동 강도</div>
              <div class="settings-item-sub">소모 칼로리를 어림잡는 기준입니다${bodyWeight() ? '' : ' · 몸무게를 넣어야 계산됩니다'}</div>
            </div>
            <div class="presets-scroll">
              ${Object.keys(MET_LIFT).map(k => `<button class="preset-chip${liftIntensity()===k?' on':''}" data-act="set-intensity" data-v="${k}">${LIFT_INTENSITY_LABEL[k]}</button>`).join('')}
            </div>
            <button class="kcal-how" data-act="kcal-info">소모 칼로리는 어떻게 계산하나요?</button>
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
        <div class="settings-label danger-label">위험 구역</div>
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

        <!-- 운동 그림의 저작자 표기. CC BY-SA 4.0 은 저작자와 라이선스를
             밝히도록 요구하므로 화면 어딘가에 반드시 있어야 합니다. -->
        <div class="credit-block">
          <p>운동 그림 &copy; <a href="https://bryllim.com" target="_blank" rel="noopener">Bryl Lim</a>
             (Workout Guide) &middot; 원작 <a href="https://github.com/everkinetic/data" target="_blank" rel="noopener">Everkinetic</a>
             &middot; <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>
             &middot; 크기 조정 외 변경 없음</p>
          <p>일부 그림은 <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a>
             (퍼블릭 도메인) 및 직접 그린 그림입니다.</p>
        </div>
      </main>`;
  }

  /* ── Event Binding ────────────────────────── */
  function bindEvents() {
    appEl.onclick  = onClick;
    appEl.oninput  = onInput;
    appEl.onchange = onChangeEvt;
  }

  async function onClick(e) {
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
      if (state.tab === 'history') { state.histDay = state.histDay === btn.dataset.date ? null : btn.dataset.date; }
      else state.summaryDate = btn.dataset.date;
      render(); return;
    }
    if (act === 'close-hist-day') { state.histDay = null; render(); return; }
    if (act === 'stats-range') { state.statsRange = btn.dataset.range; render(); return; }
    if (act === 'pr-toggle') { state.prAll = !state.prAll; render(); return; }
    if (act === 'hist-all')  { state.histAll = !state.histAll; render(); return; }
    if (act === 'kcal-info') { await showKcalInfo(); return; }
    if (act === 'set-intensity') {
      setLiftIntensity(btn.dataset.v);
      render();
      toast(`운동 강도: ${LIFT_INTENSITY_LABEL[btn.dataset.v]}`);
      return;
    }
    if (act === 'open-routines') { state.routineSheet = true; render(); return; }
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
    if (act === 'open-weight') {
      const ex = state.session.exercises.find(x=>x.id===btn.dataset.ex);
      const set = ex?.sets.find(s=>s.id===btn.dataset.set);
      if (!set) return;
      state.weightPicker = newPicker(btn.dataset.ex, btn.dataset.set, set.kg);
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
    if (act === 'close-picker' || act === 'close-info' || act === 'close-sheet') { closeAllSheets(); render(); return; }

    /* Weight picker controls */
    if (act === 'numpad-w-digit') {
      if (!state.weightPicker) return;
      pickerDigit(state.weightPicker, btn.dataset.d, 5);
      paintPickerValue(); return;
    }
    if (act === 'numpad-w-adj') {
      if (!state.weightPicker) return;
      pickerAdjust(state.weightPicker, Number(btn.dataset.delta), 0, 999);
      paintPickerValue(); return;
    }
    if (act === 'numpad-r-adj') {
      if (!state.repsPicker) return;
      pickerAdjust(state.repsPicker, Number(btn.dataset.delta), 0, 999);
      paintPickerValue(); return;
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
      const value = pickerValue(state.weightPicker);
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.kg = value; await persist(); }
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
           The ✓ stays tappable to undo or to tick a set off by hand. */
        if (value > 0 && !set.done) {
          set.done = true;
          startRestTimer(restDurationFor(set), ex ? ex.name : '');
        }
        await persist();
      }
      state.repsPicker = null;
      render(); return;
    }

    if (act === 'toggle-warmup') { await handleToggleWarmup(btn.dataset.ex, btn.dataset.set); return; }

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
      const input = document.getElementById('custom-name');
      if (input && input.value.trim()) {
        await handleAddCustom(btn.dataset.part, input.value.trim());
      }
      return;
    }
    if (act === 'del-ex') { await handleDeleteEx(btn.dataset.ex); return; }
    if (act === 'add-set') { await handleAddSet(btn.dataset.ex); return; }
    if (act === 'del-set') { await handleDeleteSet(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'shift-day') {
      if (!await confirmLeavePast()) return;
      await persist();
      await loadDay(shiftDate(state.session.date, Number(btn.dataset.delta)));
      return;
    }
    if (act === 'toggle-done') { await handleToggleDone(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'open-summary') { state.summaryDate = btn.dataset.date; render(); return; }
    if (act === 'close-summary') { state.summaryDate = null; render(); return; }
    if (act === 'edit-day') {
      state.summaryDate = null;
      await loadDay(btn.dataset.date);
      return;
    }
    if (act === 'save-past') { await savePastEdit(); return; }
    if (act === 'cancel-past') {
      if (!state.pastDirty) { state.editingPast = false; state.pastBaseline = null; await goTab('history'); return; }
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
    if (act === 'toggle-part') { await handleTogglePart(btn.dataset.part); return; }
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
        birthYear: p.birthYear || '', heightCm: p.heightCm || '', weightKg: p.weightKg || '',
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
      if (!on && state.restTimer) { state.restTimer = null; renderRestTimerBar(); }
      render();
      return;
    }
  }

  /* ── Input handler ───────────────────────── */
  async function onInput(e) {
    const t = e.target;
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

  function collectProfile() {
    const s = state.signup;
    return {
      name: s.name, gender: s.gender,
      birthYear: s.birthYear, heightCm: s.heightCm, weightKg: s.weightKg,
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
      const user = await Cloud.signUpUsername({
        username: id, password: s.password, email: s.email, profile: prof,
      });
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
      state.profileEditing = false;
      render();
      toast('프로필 저장에 실패했습니다');
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

    const cm = Number(s.heightCm);
    if (!String(s.heightCm || '').trim()) return '키를 입력해 주세요.';
    if (!Number.isFinite(cm) || cm < 100 || cm > 250) return '키는 100~250cm 사이로 입력해 주세요.';

    const kg = Number(s.weightKg);
    if (!String(s.weightKg || '').trim()) return '몸무게를 입력해 주세요.';
    /* Strictly above 20, matching sanitizeProfile — a value it would drop must
       not be accepted here, or the field would look saved and come back empty. */
    if (!Number.isFinite(kg) || kg <= 20 || kg > 300) return '몸무게는 21~300kg 사이로 입력해 주세요.';

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
      await Cloud.claimUsername(id);
      await Cloud.saveProfile(collectProfile());

      /* Read it back before believing it.

         This gate is the one screen that must not be shown twice, and the only
         thing that stops it coming back is users/{uid}.username actually being
         on the server. Trusting the write and caching "set up" locally is how
         an account ends up looking finished on this device while every other
         device — and this one after a cache clear — keeps asking again. So the
         cache is only written once the server has confirmed the value. */
      const saved = await Cloud.loadProfile(state.user ? state.user.uid : null);
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
    await persist();
    /* persist() is queued; state.sessions is what the summary reads from, so
       refresh it here rather than racing the write. */
    state.sessions = await WorkoutDB.getAllSessions();
    state.summaryDate = s.date;
    render();
    toast('오늘 운동을 저장했습니다');
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

  async function handleTogglePart(partId) {
    const s = state.session;
    const on = s.parts.includes(partId);
    if (on) {
      const hasEx = s.exercises.some(e=>e.part===partId);
      const runBusy = partId === 'run' && hasRunData(s.run);
      if (hasEx || runBusy) {
        if (!await ask({ title: '이 부위 기록도 지울까요?',
                         body: '부위를 해제하면 그 부위에 기록한 운동이 함께 사라집니다.',
                         confirmText: '지우기', danger: true })) return;
        s.exercises = s.exercises.filter(e=>e.part!==partId);
        if (partId === 'run') s.run = { km:'', minutes:'', notes:'' };
      }
      s.parts = s.parts.filter(id=>id!==partId);
    } else {
      s.parts.push(partId);
    }
    await persist(); render();
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

  async function handlePickEx(partId, name, exId) {
    const before = new Set(state.session.exercises.map(e => e.id));
    if (!addExerciseToSession(partId, name, exId)) { toast('이미 추가된 운동입니다'); return; }
    await persist();
    closeAllSheets();
    const added = state.session.exercises.find(e => !before.has(e.id));
    if (added) flashExercise(added.id);
    render();
    toast('운동을 추가했습니다');
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
       from the custom list gets a generated id that the pick never carried. */
    for (const ex of state.session.exercises) {
      if (!before.has(ex.id)) { firstId = ex.id; break; }
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

    return `<div class="detail-screen">
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
          <div class="routine-sub">${esc(routineParts(r).map(p => p.label).join(', ') || '빈 루틴')} · ${r.exercises.length}개 운동</div>
        </button>
        <button class="rt-edit" data-act="edit-routine" data-id="${esc(r.id)}" aria-label="수정">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button class="custom-del" data-act="del-routine" data-id="${esc(r.id)}">삭제</button>
      </div>`).join('');
    return `<div class="sheet-backdrop">
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
    render();
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
    ex.sets.push({ id:uid(), kg:prev.kg, reps:prev.reps, done:false, warmup:false });
    await persist(); render();
  }

  async function handleDeleteSet(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    if (!ex) return;
    if (ex.sets.length <= 1) { toast('마지막 세트는 지울 수 없습니다'); return; }
    ex.sets = ex.sets.filter(s => s.id !== setId);
    await persist(); render();
  }

  async function handleToggleDone(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    const set = ex?.sets.find(s=>s.id===setId);
    if (!set) return;
    set.done = !set.done;
    /* 완료 시각을 남깁니다. 이게 있어야 그 운동에 실제로 몇 분을 썼는지
       알 수 있고, 칼로리가 '세트 수로 어림잡은 값' 이 아니라 실제 시간에
       근거한 값이 됩니다. 체크를 풀면 지웁니다. */
    if (set.done) set.doneAt = Date.now(); else delete set.doneAt;
    /* Only kick off rest when a set is completed, not when un-checking it. */
    if (set.done) startRestTimer(restDurationFor(set), ex?.name || '');
    else cancelRestTimer();

    /* 기록 판정은 저장 '전에' 합니다. 저장하고 나면 방금 그 세트도 과거
       기록에 섞여 들어가, 자기 자신과 비교해 늘 "기록 아님" 이 됩니다. */
    let pr = null;
    if (set.done) {
      pr = checkPR(ex, set, state.session.date);
      set.pr = !!pr;
    } else {
      delete set.pr;
    }

    await persist(); render();

    if (pr) {
      if (navigator.vibrate) { try { navigator.vibrate([25, 45, 25]); } catch (_) {} }
      toast(pr.type === 'kg'
        ? `개인 기록! ${ex.name} ${pr.kg}kg (이전 ${pr.prev}kg)`
        : `개인 기록! ${ex.name} ${pr.kg}kg × ${pr.reps} — 추정 1RM ${Math.round(pr.orm)}kg`);
    }
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
    a.href = url; a.download = `fitlog-backup-${todayISO()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('파일을 저장했습니다');
  }

  async function importJson(file) {
    let payload;
    try { payload = JSON.parse(await file.text()); } catch { alert('JSON을 읽을 수 없습니다.'); return; }
    if (!await ask({ title: '백업 파일로 교체할까요?',
                     body: '지금 이 기기에 있는 기록이 백업 파일의 내용으로 바뀝니다.',
                     confirmText: '교체', danger: true })) return;
    await WorkoutDB.importAll(payload);
    state.sessions = await WorkoutDB.getAllSessions();
    state.customExercises = await WorkoutDB.getCustomExercises();
    await cloudSync(() => Cloud.pushAll(state.sessions, state.customExercises));
    state.tab = 'home';
    render(); toast('가져왔습니다');
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file) await importJson(file);
  });

  function mergeByDate(localRows, cloudRows) {
    const map = new Map();
    for (const row of localRows || []) {
      if (row && row.date) map.set(row.date, row);
    }
    for (const row of cloudRows || []) {
      if (!row || !row.date) continue;
      const prev = map.get(row.date);
      if (!prev || (row.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(row.date, row);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  function mergeCustom(localRows, cloudRows) {
    const map = new Map();
    for (const row of [...(localRows || []), ...(cloudRows || [])]) {
      if (row && row.id) map.set(row.id, row);
    }
    return [...map.values()];
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
      if (!current.length) {
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

  async function syncInBackground() {
    if (state.syncing) return;
    state.syncing = true;
    try {
      await withTimeout(Cloud.touchProfile(), 8000, '프로필');
      let cloudData = await withTimeout(Cloud.pullAll(), 12000, '불러오기');
      /* Detect only — importing is the user's call, made from the home screen. */
      state.pendingImport = await detectImportableLocal(cloudData);
      const localSessions = await WorkoutDB.getAllSessions();
      const localCustom = await WorkoutDB.getCustomExercises();
      const sessions = mergeByDate(localSessions, cloudData.sessions);
      const customExercises = mergeCustom(localCustom, cloudData.customExercises);
      await WorkoutDB.replaceAll(sessions, customExercises);
      await withTimeout(Cloud.pushAll(sessions, customExercises), 15000, '저장');

      /* Refresh data in place — loadWorkspace() would reset the tab and close
         sheets, yanking the user out of whatever they were editing. */
      state.sessions = await WorkoutDB.getAllSessions();
      state.customExercises = await WorkoutDB.getCustomExercises();
      const saved = await WorkoutDB.getSession(state.date);
      if (saved) state.session = normalizeSession(saved);

      state.syncing = false;
      render();
    } catch (err) {
      console.warn('cloud sync failed', err);
      state.syncing = false;
      render();
      toast('클라우드 동기화 실패 — 기록은 이 기기에 저장됩니다');
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
      const user = rawId.includes('@')
        ? await Cloud.signInEmail(rawId, password)
        : await Cloud.signInUsername(rawId, password);
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
      const saved = await WorkoutDB.getSession(state.date);
      if (saved) state.session = normalizeSession(saved);
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
      toast(err && err.message === 'cancelled' ? '삭제를 취소했습니다' : `삭제 실패: ${Cloud.authMessage(err)}`);
    }
  }

  async function deleteAccountWithReauth() {
    try {
      await Cloud.deleteAccountAndData();
    } catch (err) {
      if (!err || err.code !== 'auth/requires-recent-login') throw err;
      toast('보안을 위해 다시 로그인이 필요합니다');
      try {
        await Cloud.reauthenticate();
      } catch (_) {
        throw new Error('cancelled');
      }
      await Cloud.deleteAccountAndData();
    }
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
    const recheck = () => {
      if (document.hidden) return;
      if (!state.onboarding || !state.user || state.authBusy) return;
      loadProfileThenMaybeOnboard(state.user, 8000);
    };
    /* Three events rather than one, because iOS is the case that matters and
       is the least predictable: switching tabs fires visibilitychange, but
       returning to a tab the OS froze comes back through pageshow (restored
       from the back-forward cache), and sometimes only focus is raised. They
       are cheap and idempotent — the guard above drops all but the first. */
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('pageshow', recheck);
    window.addEventListener('focus', recheck);
  }

  async function init() {
    markDisplayMode();
    render();
    startRestTicker();
    /* 앱을 껐다 켜도 쉬던 중이었다면 남은 시간이 이어집니다. */
    restoreRestTimer();
    watchForGateGoingStale();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type !== 'SW_UPDATED') return;
        try { if (sessionStorage.getItem('fitlog-auth-pending')) return; } catch (_) {}
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
    try { if (redirectUser) sessionStorage.removeItem('fitlog-auth-pending'); } catch (_) {}

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
