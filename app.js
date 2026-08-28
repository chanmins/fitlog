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

    /* Password reset screen */
    resetTarget: '',      /* address resolved from 아이디, awaiting confirmation */
    resetSent: '',        /* masked address once the mail has gone out */
    resetCooldown: 0,     /* seconds left before 다시 보내기 is allowed */

    /* History calendar — 보고 있는 달 (YYYY-MM) */
    histMonth: null,

    /* Day the read-only summary overlay is showing, or null */
    summaryDate: null,

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
  function sessionSummary(s) {
    return (s.parts||[]).map(id=>PARTS.find(p=>p.id===id)?.label).filter(Boolean).join(', ');
  }
  function hasRunData(run) {
    return run && ((run.km!==''&&run.km!=null)||(run.minutes!==''&&run.minutes!=null));
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

  function startRestTimer(seconds, label) {
    state.restTimer = { endsAt: Date.now() + seconds * 1000, duration: seconds, label: label || '', chimed: false };
    renderRestTimerBar();
    /* Ask once, lazily, only when the feature is actually used — so a background
       notification can fire if the user switches tabs/apps while resting. Never
       re-prompt if they dismissed or denied it. */
    try {
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    } catch (_) {}
  }

  function adjustRestTimer(deltaSec) {
    if (!state.restTimer) return;
    state.restTimer.endsAt += deltaSec * 1000;
    state.restTimer.duration = Math.max(5, state.restTimer.duration + deltaSec);
    renderRestTimerBar();
  }

  function cancelRestTimer() {
    state.restTimer = null;
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
      playRestChime();
      if (navigator.vibrate) { try { navigator.vibrate([120, 80, 120]); } catch (_) {} }
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('휴식 종료', { body: '다음 세트를 시작하세요 💪', tag: 'fitlog-rest' }); } catch (_) {}
      }
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
  }

  /* ── Navigation ─────────────────────────── */
  async function goTab(tab) {
    state.tab = tab;
    closeAllSheets();
    if (tab === 'workout' && !state.session) {
      state.session = normalizeSession(await WorkoutDB.getSession(state.date) || emptySession(state.date));
    }
    render();
  }
  function closeAllSheets() {
    state.pickerPart = null;
    state.pickSelection = [];
    state.exerciseInfoId = null;
    state.weightPicker = null;
    state.repsPicker = null;
    state.yearPicker = null;
    state.profileEditing = false;
    state.exerciseSearch = '';
  }

  async function loadDay(date) {
    state.date = date;
    const saved = await WorkoutDB.getSession(date);
    state.session = normalizeSession(saved || emptySession(date));
    closeAllSheets();
    state.tab = 'workout';
    render();
  }

  /* ── Body Map SVG ────────────────────────── */
  /* ── Part icons ───────────────────────────── */
  const PART_ICONS = {
    chest: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5c2.6-1.7 5.4-1.1 7.5.6M21 7.5c-2.6-1.7-5.4-1.1-7.5.6"/><path d="M3 7.5v3.5c0 3 2.4 5 5.5 5 2.2 0 3.5-1.3 3.5-3.4M21 7.5v3.5c0 3-2.4 5-5.5 5-2.2 0-3.5-1.3-3.5-3.4"/></svg>`,
    back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><path d="M12 6.5C10 4.2 6.6 4.2 4.5 6.3c1 3.4 3.3 4.7 5.5 4.7M12 6.5c2-2.3 5.4-2.3 7.5-.2-1 3.4-3.3 4.7-5.5 4.7"/></svg>`,
    shoulders: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="10" r="3.2"/><circle cx="18" cy="10" r="3.2"/><path d="M9 11.5h6"/></svg>`,
    arms: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8.5" width="3" height="7" rx="1.2"/><rect x="18.5" y="8.5" width="3" height="7" rx="1.2"/><path d="M5.5 12h2M16.5 12h2M8 12h8"/></svg>`,
    legs: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6l-1.5 12M15 3v6l1.5 12M9 9h6"/></svg>`,
    core: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="4" width="10" height="16" rx="3.5"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="7.5" y1="10" x2="16.5" y2="10"/><line x1="7.5" y1="14" x2="16.5" y2="14"/></svg>`,
    run: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="14" cy="5" r="2"/><path d="M13 8l-3 3 2 2 1 5M12 13l-2 2-5-1M15 10l2-1 3 2 1-1"/></svg>`,
  };

  /* ── Body Map SVG ─────────────────────────────────────────────────────────
     An anatomical chart, not a 3D render: muscle groups are drawn as their
     real shapes (fanned pec, V-taper lat, teardrop quad, the two heads of a
     calf) and shaded by how hard the exercise hits them — solid red for the
     prime mover, dimmer red for assisting muscles. Mirroring the right half
     from the left with a scale(-1) group keeps the body symmetric and halves
     the number of paths to maintain.
     ------------------------------------------------------------------------ */
  function bodyMapSVG(primary = [], secondary = []) {
    const P = new Set(primary);
    const S = new Set(secondary);
    function mc(ids) {
      const arr = [].concat(ids);
      if (arr.some(id => P.has(id))) return 'mp';   /* 주동근 — 진한 빨강 */
      if (arr.some(id => S.has(id))) return 'ms';   /* 협응근 — 옅은 빨강 */
      return 'mi';                                   /* 미사용 — 어두운 회색 */
    }

    /* Silhouette. Head/neck/torso are drawn whole; the arm and leg are drawn
       as the left limb only and mirrored with the muscles, which keeps the
       figure symmetric and the coordinates easy to reason about.
       Landmarks (viewBox 80×152): shoulder line y=28, waist y=60,
       hip y=86, knee y=118, ankle y=146. */
    const torso = `
      <ellipse class="bb" cx="40" cy="10.6" rx="6.8" ry="8.4"/>
      <path class="bb" d="M36.4 15.6h7.2v7.2c0 1.3-1.2 2-3.6 2s-3.6-.7-3.6-2z"/>
      <path class="bb" d="M24.5 28q.5-3.5 6.5-4.8Q40 21.6 49 23.2q6 1.3 6.5 4.8 1 8-2 14-2.5 9-3.5 18-.6 8 1.5 16 1 6-2.5 10H31q-3.5-4-2.5-10 2.1-8 1.5-16-1-9-3.5-18-3-6-2-14Z"/>`;

    const limbs = `
      <path class="bb" d="M24.2 28.2q-4.8 1.2-6.3 6-1.4 6-1.6 13l-.8 13q-.4 8 .4 14 .4 2.6 2.6 2.6t2.6-2.6q.8-6 .4-14l.8-13q.2-7 1.6-12 1.2-4.4-.9-7Z"/>
      <path class="bb" d="M31 86q-3.5 2-4 10-.6 10 0 20l.6 6q-.6 10 0 18 .4 5.6 3 5.6t3-5.6q.8-8 .4-18l.6-6q1.4-10 2.6-20 .8-6 2.4-10Z"/>`;

    /* Left-half muscle shapes; mirrored to the right side at render time. */
    const frontHalf = `
      <path class="${mc('shoulders')}" d="M24.4 28.2q-5 1.2-6.5 6-.9 3.8-.3 6.4.4 1.4 1.8.8 3.6-1.6 5.6-5 1.6-3 1.4-6.4-.1-2-2-1.8Z"/>
      <path class="${mc('chest')}" d="M39 27.4 28.6 30q-2.6 1.4-2.6 5 0 4.2 3.4 7.2 3.2 2.8 8 3.4 1.6.2 1.6-1.4Z"/>
      <path class="${mc('abs')}" d="M39 45.8v25q0 1.4-1.4 1.4h-2.6q-1.6 0-1.8-1.6-.6-8-.2-16 .2-5 .8-7.4.2-1.4 1.6-1.4Z"/>
      <path class="${mc('biceps')}" d="M25.2 33.6q.8 6.4-.2 13-.8 5-2.6 6-1.8.8-2.8-1.2-1.2-2.8-.8-7.4.4-5.6 2.2-9.4 1.6-3.2 3-2.8 1.1.4 1.2 1.8Z"/>
      <path class="${mc('quads')}" d="M38.2 88.6q-1.2 11.4-3 21.4-1.2 6.6-3.2 7.4-2 .6-3-3-1.4-5.8-.8-14.4.6-8 2.4-11.6 1.4-2.6 4.4-2.2 2.8.4 3.2 2.4Z"/>
      <path class="${mc('calves')}" d="M34.2 123q.6 7-.2 13.4-.6 4.6-2.6 5.2-2 .4-2.8-3.2-.6-5 0-10.8.6-5.2 2-6.2 1.6-1 2.8 0 .7.6.8 1.6Z"/>`;

    const backHalf = `
      <path class="${mc('traps')}" d="M40 22.8q-4.2.6-6.8 3.4-2.8 3-3 7.8-.2 4 1.8 6.8 2.4 3.2 6.6 4.6 1.4.4 1.4-.8Z"/>
      <path class="${mc('shoulders')}" d="M24.4 28.2q-5 1.2-6.5 6-.9 3.8-.3 6.4.4 1.4 1.8.8 3.6-1.6 5.6-5 1.6-3 1.4-6.4-.1-2-2-1.8Z"/>
      <path class="${mc(['lats','back'])}" d="M39 38.8 28.6 41.4q-1.8 1-1.2 4.8 1 6.4 3.8 10.6 2 3.2 5 5.4 1.8 1.2 2.8.4Z"/>
      <path class="${mc('triceps')}" d="M25.2 33.6q.8 6.4-.2 13-.8 5-2.6 6-1.8.8-2.8-1.2-1.2-2.8-.8-7.4.4-5.6 2.2-9.4 1.6-3.2 3-2.8 1.1.4 1.2 1.8Z"/>
      <path class="${mc('lower_back')}" d="M40 61.4v18.2h-4q-1.8 0-2-2-.6-6.6.2-12.6.3-2.6 2-2.8Z"/>
      <path class="${mc('glutes')}" d="M39.2 73.4q-4.8.8-7.6 3.4-2.8 2.6-2.8 6.6 0 4.2 2.6 6.4 2.8 2.4 7.8 3 1.6.2 1.6-1.2Z"/>
      <path class="${mc('hamstrings')}" d="M38 92.6q-1 10.4-2.6 19.4-1 5.6-3 6.2-2 .4-3-3.2-1.2-5.4-.8-13 .4-7.4 2-10.4 1.4-2.4 4.4-2 2.6.4 3 3Z"/>
      <path class="${mc('calves')}" d="M34.2 123q.6 7-.2 13.4-.6 4.6-2.6 5.2-2 .4-2.8-3.2-.6-5 0-10.8.6-5.2 2-6.2 1.6-1 2.8 0 .7.6.8 1.6Z"/>`;

    const mirrored = (half) => `${half}<g transform="translate(80,0) scale(-1,1)">${half}</g>`;
    const figure = (half) => `${torso}${mirrored(limbs)}${mirrored(half)}`;

    return `
      <div class="body-map-wrap">
        <input type="radio" name="bv" id="bv-f" class="bv-radio" checked>
        <input type="radio" name="bv" id="bv-b" class="bv-radio">
        <div class="bm-tabs">
          <label for="bv-f" class="bm-tab">앞면</label>
          <label for="bv-b" class="bm-tab">뒷면</label>
        </div>
        <div class="bm-panel bm-front">
          <svg viewBox="0 0 80 152" xmlns="http://www.w3.org/2000/svg">${figure(frontHalf)}</svg>
        </div>
        <div class="bm-panel bm-back">
          <svg viewBox="0 0 80 152" xmlns="http://www.w3.org/2000/svg">${figure(backHalf)}</svg>
        </div>
      </div>`;
  }

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

    html += renderBottomNav();
    /* Full-screen overlay, so it can be opened from home, history or the
       workout screen without any of them needing to know about it. */
    if (state.summaryDate) html += renderDaySummary(state.summaryDate);
    appEl.innerHTML = html;
    bindEvents();
    positionYearWheel();
    flushPendingFlash();
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
      <button class="login-guest" data-act="login-guest" ${busy ? 'disabled' : ''}>로그인 없이 이 기기에서만 쓰기</button>
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
      <p class="signup-sub">아이디를 정하고 기본 정보만 채우면 시작합니다.</p>

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
    const anything = stats.total > 0 || hasRunData(s.run) || s.exercises.length > 0;
    const finishBar = !anything ? '' : (s.completed ? `
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
      <div class="finish-bar">
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
        <button class="btn-icon danger" data-act="delete-day">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
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
        <div class="sec-head" style="margin-top:18px"><div class="sec-title">부위 선택</div></div>
        <div class="part-grid">${partTiles}</div>
        ${blocks}
        ${finishBar}
      </main>`;
  }

  /* ── Day summary ──────────────────────────────────────────────────────────
     A read-only "what did I actually do" view, opened by tapping a day card.
     The editing screen answers "what am I doing next" — it is full of inputs,
     pickers and part tiles, which is the wrong shape for looking back at a
     finished session. This one has no controls at all: every set is laid out as
     a chip so a whole workout reads in one glance. */
  function renderDaySummary(date) {
    const s = state.sessions.find(x => x.date === date)
           || (state.session && state.session.date === date ? state.session : null);
    if (!s) return '';
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
          const chips = (ex.sets || []).map(set => {
            const warm = !!set.warmup;
            if (!warm) workingNo++;
            const kg = (set.kg !== '' && set.kg != null) ? set.kg : '–';
            const reps = (set.reps !== '' && set.reps != null) ? set.reps : '–';
            return `<span class="dsum-set${warm ? ' warm' : ''}${set.done ? ' done' : ''}">
              <b>${warm ? 'W' : workingNo}</b>${esc(String(kg))}<i>kg</i> × ${esc(String(reps))}
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

    return `<div class="detail-screen">
      <header class="topbar">
        <button class="btn-icon ghost" data-act="close-summary" aria-label="닫기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">${esc(longDate(s.date))}</div>
        <div class="topbar-spacer"></div>
      </header>
      <main class="screen">
        <div class="dsum-hero${done ? ' done' : ''}">
          <div class="dsum-badge">
            ${done ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>운동 완료`
                   : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>진행 중`}
          </div>
          <div class="dsum-parts">${(s.parts || []).map(id => {
            const p = PARTS.find(x => x.id === id);
            return p ? `<span class="muscle-tag" style="background:color-mix(in srgb,${p.color} 16%,var(--surface-2));color:${p.color}">${p.label}</span>` : '';
          }).join('')}</div>
          <div class="dsum-stats">
            <div><b>${s.exercises.length}</b><span>운동</span></div>
            <div><b>${stats.done}</b><span>완료 세트</span></div>
            ${hasRunData(s.run) && Number.isFinite(runKm) && runKm ? `<div><b>${runKm}</b><span>km</span></div>` : ''}
          </div>
        </div>
        ${body}
        <button class="btn-ghost dsum-edit" data-act="edit-day" data-date="${s.date}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
          이 날 기록 편집하기
        </button>
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

    const prevHint = last
      ? `<button class="prev-hint" data-act="copy-last" data-ex="${esc(ex.id)}">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
           <span><strong>지난 기록 ${shortDate(last.date)}</strong> · ${esc(fmtSets(last.sets)||'기록 없음')} · 탭하면 불러오기</span>
         </button>`
      : '';

    /* Warm-ups are labelled W and don't consume a number, so the working sets
       still read 1, 2, 3 — which is how a lifter counts them. */
    let workingNo = 0;
    const sets = ex.sets.map((set) => {
      const done = set.done;
      const warmup = !!set.warmup;
      if (!warmup) workingNo++;
      const label = warmup ? 'W' : workingNo;
      const kg   = (set.kg   !== '' && set.kg   != null) ? set.kg   : '--';
      const reps = (set.reps !== '' && set.reps != null) ? set.reps : '--';
      return `<div class="set-row${done?' done':''}${warmup?' warmup':''}">
        <button class="set-num${warmup?' warmup':''}" data-act="toggle-warmup" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="웜업 세트로 전환" title="탭하면 웜업/일반 세트 전환">${label}</button>
        <button class="val-chip${done?' done':''}" data-act="open-weight" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${kg}</span>
          <span class="val-chip-unit">kg</span>
        </button>
        <button class="val-chip${done?' done':''}" data-act="open-reps" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <span class="val-chip-num">${reps}</span>
          <span class="val-chip-unit">회</span>
        </button>
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
      ${prevHint}
      <div class="set-table">
        <div class="set-table-head"><span>#</span><span>무게</span><span>횟수</span><span>완료</span><span></span></div>
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
          <div><div class="sheet-title">횟수</div>${sub?`<div class="sheet-title-sub">${esc(sub)}</div>`:''}</div>
          <button class="sheet-x" data-act="close-sheet" aria-label="닫기">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <button class="picker-big" data-act="numpad-r-clear" aria-label="입력한 횟수 지우기">
          <div class="${numCls}">${esc(display)}</div>
          <div class="picker-big-unit">회</div>
        </button>
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
        ${bodyMapSVG(primary, secondary)}
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
    const added = new Set((state.session?.exercises||[]).filter(e=>e.part===partId).map(e=>e.name));
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

  function renderHistory() {
    const mKey = state.histMonth || monthKey(todayISO());
    let body = renderCalendar(mKey);

    const rows = state.sessions.filter(s => s.date.startsWith(mKey));
    if (rows.length) {
      body += `<div class="sec-head"><div class="sec-title">이 달의 기록</div></div><div class="recent-list">`;
      for (const s of rows) {
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
          <div class="settings-item settings-block">
            <div class="settings-item-text">
              <div class="settings-item-title">세트 완료 시 기본 휴식 시간</div>
              <div class="settings-item-sub">횟수를 입력하거나 완료(✓)를 누르면 자동으로 시작됩니다. 웜업 세트는 더 짧게 잡습니다.</div>
            </div>
            <div class="presets-scroll">
              ${REST_PRESETS.map(sec => `<button class="preset-chip${restDuration()===sec?' on':''}" data-act="set-rest-dur" data-val="${sec}">${sec}초</button>`).join('')}
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
    if (act === 'today')      { await loadDay(todayISO()); return; }
    /* Tapping a past day shows what was done rather than opening the editor.
       Looking back is the common intent; 편집 is one tap further in, inside the
       summary, where it is an explicit choice rather than the default. */
    if (act === 'open-day')   { state.summaryDate = btn.dataset.date; render(); return; }
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
      const s = state.session;
      const name = btn.dataset.name;
      s.exercises = s.exercises.filter(e => !(e.part===btn.dataset.part && e.name===name));
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
      await persist();
      await loadDay(shiftDate(state.session.date, Number(btn.dataset.delta)));
      return;
    }
    if (act === 'toggle-done') { await handleToggleDone(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'copy-last') { await handleCopyLast(btn.dataset.ex); return; }
    if (act === 'open-summary') { state.summaryDate = btn.dataset.date; render(); return; }
    if (act === 'close-summary') { state.summaryDate = null; render(); return; }
    if (act === 'edit-day') {
      state.summaryDate = null;
      await loadDay(btn.dataset.date);
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
      state.authMode = 'signin';
      state.resetTarget = ''; state.resetSent = ''; state.authError = '';
      render(); return;
    }
    if (act === 'reset-lookup') { await handleResetLookup(); return; }
    if (act === 'reset-send') { await handleResetSend(); return; }
    if (act === 'reset-resend') { await handleResetSend({ resend: true }); return; }
    if (act === 'import-local') { await handleImportLocal(); return; }
    if (act === 'dismiss-import') {
      if (!confirm('가져오지 않으면 이 기록은 계정에 올라가지 않습니다.\n다음부터 다시 묻지 않습니다. 계속할까요?')) return;
      try { localStorage.setItem(importDismissKey(), '1'); } catch (_) {}
      state.pendingImport = null;
      render(); return;
    }
    if (act === 'login-guest') { await enterApp(null, { guest: true }); return; }
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
      await persist(); return;
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
      try { free = await Cloud.isUsernameFree(id); }
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

  function resetSignup() {
    state.signup = {
      username: '', password: '', password2: '', email: '',
      name: '', gender: '', birthYear: '', heightCm: '', weightKg: '',
    };
    state.idCheck = { id: '', status: '', message: '' };
    state.signupStep = 1;
    state.authError = '';
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
      if (user && user.uid) markSetUp(user.uid);
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

  async function handleOnboardingSave() {
    if (state.authBusy) return;
    const s = state.signup;
    const id = Cloud.normalizeUsername(s.username);
    const bad = Cloud.usernameError(id);
    if (bad) { state.authError = bad; render(); return; }
    state.authBusy = true;
    state.authError = '';
    render();
    try {
      await Cloud.claimUsername(id);
      state.profile = { ...(await Cloud.saveProfile(collectProfile())), username: id };
      if (state.user) markSetUp(state.user.uid);
      state.onboarding = false;
      state.authBusy = false;
      resetSignup();
      render();
      toast('설정을 저장했습니다');
    } catch (err) {
      state.authBusy = false;
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
        if (!confirm('이 부위 기록을 함께 지울까요?')) return;
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
    const firstSet = last?.sets?.[0] || { kg:'', reps:'' };
    s.exercises.push({
      id: exId || uid(), part: partId, name,
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
    if (!confirm(`'${item.name}'을(를) 목록에서 삭제할까요?`)) return;
    await WorkoutDB.deleteCustomExercise(id);
    state.customExercises = state.customExercises.filter(e=>e.id!==id);
    await cloudSync(() => Cloud.deleteCustom(id));
    render();
  }

  async function handleDeleteEx(exId) {
    state.session.exercises = state.session.exercises.filter(e=>e.id!==exId);
    await persist(); render();
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
    /* Only kick off rest when a set is completed, not when un-checking it. */
    if (set.done) startRestTimer(restDurationFor(set), ex?.name || '');
    else cancelRestTimer();
    await persist(); render();
  }

  async function handleToggleWarmup(exId, setId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    const set = ex?.sets.find(s=>s.id===setId);
    if (!set) return;
    set.warmup = !set.warmup;
    await persist(); render();
  }

  async function handleCopyLast(exId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    if (!ex) return;
    const last = lastLog(ex.name, state.session.date);
    if (!last) { toast('이전 기록이 없습니다'); return; }
    ex.sets = last.sets.map(s=>({ id:uid(), kg:s.kg, reps:s.reps, done:false, warmup:!!s.warmup }));
    await persist(); render();
    toast('지난 기록을 불러왔습니다');
  }

  async function handleDeleteDay() {
    if (!confirm('이 날 기록을 삭제할까요?')) return;
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
    if (!confirm('현재 기록을 백업 파일로 교체할까요?')) return;
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
    const saved = await WorkoutDB.getSession(today);
    state.session = normalizeSession(saved || emptySession(today));
    closeAllSheets();
    state.tab = 'home';
  }

  async function enterApp(user, opts = {}) {
    if (user && state.user && state.user.uid === user.uid && state.authReady && !opts.force) return;
    const arrivedFromLogin = !state.authReady || (!state.user && !state.guest);
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
    if (prof && prof.username) { markSetUp(user.uid); return; }

    /* Prefill from whatever Google already told us so the gate is one tap for
       most people. */
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
    if (!confirm('로그아웃할까요? 이 기기 기록은 남아 있고, 계정 기록은 클라우드에 유지됩니다.')) return;
    state.user = null;
    state.guest = false;
    localStorage.removeItem('fitlog-guest');
    WorkoutDB.setScope('guest');
    await WorkoutDB.open();
    await loadWorkspace();
    state.authReady = true;
    render();
    await Cloud.signOut();
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
    if (!confirm(msg)) return;
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
    if (!confirm('계정을 삭제하면 클라우드에 저장된 모든 운동 기록이 영구적으로 사라집니다. 이 작업은 되돌릴 수 없습니다. 계속할까요?')) return;
    if (!confirm('정말로 계정과 모든 데이터를 삭제할까요? 마지막 확인입니다.')) return;

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

  async function init() {
    markDisplayMode();
    render();
    startRestTicker();
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
