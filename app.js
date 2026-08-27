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
    exerciseSearch: '',
    exerciseInfoId: null,
    weightPicker: null,   /* { exId, setId, value } */
    repsPicker:   null,   /* { exId, setId, value } */

    /* Auth */
    authReady: false,
    user: null,
    guest: false,
    authMode: 'signin',
    authEmail: '',
    authPassword: '',
    authBusy: false,
    authError: '',
    syncing: false,

    /* Toast */
    toast: '',
    toastTimer: 0,
  };

  /* ── DOM root ───────────────────────────── */
  const appEl = document.getElementById('app');
  const importInput = document.getElementById('import-file');

  /* ── Data helpers ───────────────────────── */
  function emptySession(date) {
    return { date, parts: [], notes: '', exercises: [], run: { km:'', minutes:'', notes:'' } };
  }
  function normalizeSession(raw) {
    return {
      date: raw.date,
      parts: Array.isArray(raw.parts) ? raw.parts : [],
      notes: raw.notes || '',
      exercises: Array.isArray(raw.exercises) ? raw.exercises : [],
      run: { km: raw.run?.km ?? '', minutes: raw.run?.minutes ?? '', notes: raw.run?.notes ?? '' },
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
    return (ex.sets||[]).reduce((sum, st) => {
      const kg = Number(st.kg), reps = Number(st.reps);
      return sum + (Number.isFinite(kg) && Number.isFinite(reps) ? kg * reps : 0);
    }, 0);
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

  /* ── Chart helpers ───────────────────────── */
  function renderWeeklyVolumeChart() {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const toMon = dow === 0 ? 6 : dow - 1;
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const mon = new Date(today);
      mon.setDate(today.getDate() - toMon - w * 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      const s0 = mon.toISOString().slice(0,10);
      const s1 = sun.toISOString().slice(0,10);
      const vol = state.sessions
        .filter(s => s.date >= s0 && s.date <= s1)
        .reduce((acc, s) => acc + (s.exercises||[]).reduce((a,ex)=>a+exVolume(ex),0), 0);
      weeks.push({ label: `${mon.getMonth()+1}/${mon.getDate()}`, vol });
    }
    const maxVol = Math.max(...weeks.map(w=>w.vol), 1);
    const thisVol = weeks[weeks.length-1].vol;
    const W = 100 / weeks.length;
    const bars = weeks.map((w, i) => {
      const h = Math.round((w.vol / maxVol) * 50);
      const x = (i * W + W * 0.15).toFixed(1);
      const bw = (W * 0.7).toFixed(1);
      return `<rect x="${x}%" y="${52-h}" width="${bw}%" height="${h}" rx="2" fill="${w.vol>0?'var(--accent)':'var(--line)'}"/>
        <text x="${(i*W+W*0.5).toFixed(1)}%" y="68" text-anchor="middle" font-size="6.5" fill="var(--muted)">${w.label}</text>`;
    }).join('');
    const infoStr = thisVol > 0
      ? `이번 주 ${thisVol>=1000?(thisVol/1000).toFixed(1)+'t':fmtNum(thisVol)+'kg'}`
      : `최고 ${maxVol>=1000?(maxVol/1000).toFixed(1)+'t':fmtNum(maxVol)+'kg'}`;
    return `<div class="vol-chart-card">
      <div class="vol-chart-header">
        <span class="vol-chart-title">주간 볼륨</span>
        <span class="vol-chart-info">${infoStr}</span>
      </div>
      <svg viewBox="0 0 100 72" class="vol-chart-svg" preserveAspectRatio="none">${bars}</svg>
    </div>`;
  }

  function renderExerciseTrend(exName) {
    const history = [];
    const sorted = [...state.sessions].sort((a,b) => a.date < b.date ? -1 : 1);
    for (const s of sorted) {
      const ex = (s.exercises||[]).find(e => e.name === exName);
      if (!ex) continue;
      const maxKg = Math.max(...(ex.sets||[]).map(st=>Number(st.kg)||0));
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
  function getWeekDays() {
    const today = new Date();
    const day = today.getDay(); // 0=Sun
    const mon = new Date(today); mon.setDate(today.getDate() - ((day+6)%7));
    return Array.from({length:7}, (_,i) => {
      const d = new Date(mon); d.setDate(mon.getDate()+i);
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
    state.exerciseInfoId = null;
    state.weightPicker = null;
    state.repsPicker = null;
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

  /* ── Body Map SVG ─────────────────────────── */
  function bodyMapSVG(primary = [], secondary = []) {
    const P = new Set(primary);
    const S = new Set(secondary);
    function mc(ids) {
      const arr = [].concat(ids);
      if (arr.some(id => P.has(id))) return 'mp';
      if (arr.some(id => S.has(id))) return 'ms';
      return 'mi';
    }

    const outline = `
      <ellipse class="bb" cx="40" cy="11" rx="9" ry="10"/>
      <path class="bb" d="M31,20 Q40,17 49,20 L58,27 Q68,33 67,46 L67,91 Q67,96 61,97 L55,97 L55,91 L25,91 L25,97 L19,97 Q13,96 13,91 L13,46 Q12,33 22,27 Z"/>
      <path class="bb" d="M13,42 Q5,47 4,59 L5,73 Q6,79 11,80 L15,79 L15,42 Z"/>
      <path class="bb" d="M67,42 Q75,47 76,59 L75,73 Q74,79 69,80 L65,79 L65,42 Z"/>
      <path class="bb" d="M25,91 L20,95 Q14,101 14,117 L15,130 Q16,135 22,136 L29,136 L31,117 L31,91 Z"/>
      <path class="bb" d="M55,91 L60,95 Q66,101 66,117 L65,130 Q64,135 58,136 L51,136 L49,117 L49,91 Z"/>
      <rect class="bb" x="29" y="130" width="4" height="16" rx="2"/>
      <rect class="bb" x="47" y="130" width="4" height="16" rx="2"/>`;

    const frontMuscles = `
      <ellipse class="${mc('chest')}"      cx="33" cy="38" rx="9" ry="9"/>
      <ellipse class="${mc('chest')}"      cx="47" cy="38" rx="9" ry="9"/>
      <ellipse class="${mc('shoulders')}"  cx="14" cy="34" rx="7" ry="7"/>
      <ellipse class="${mc('shoulders')}"  cx="66" cy="34" rx="7" ry="7"/>
      <ellipse class="${mc('biceps')}"     cx="9"  cy="55" rx="5" ry="10"/>
      <ellipse class="${mc('biceps')}"     cx="71" cy="55" rx="5" ry="10"/>
      <ellipse class="${mc('abs')}"        cx="40" cy="67" rx="8" ry="12"/>
      <ellipse class="${mc('quads')}"      cx="28" cy="111" rx="9" ry="15"/>
      <ellipse class="${mc('quads')}"      cx="52" cy="111" rx="9" ry="15"/>
      <ellipse class="${mc('calves')}"     cx="28" cy="138" rx="6" ry="9"/>
      <ellipse class="${mc('calves')}"     cx="52" cy="138" rx="6" ry="9"/>`;

    const backMuscles = `
      <path class="${mc('traps')}"         d="M27,21 Q40,16 53,21 L53,31 Q40,26 27,31 Z"/>
      <ellipse class="${mc('lats')}"       cx="24" cy="56" rx="10" ry="15"/>
      <ellipse class="${mc('lats')}"       cx="56" cy="56" rx="10" ry="15"/>
      <ellipse class="${mc('lower_back')}" cx="40" cy="74" rx="9" ry="9"/>
      <ellipse class="${mc('triceps')}"    cx="9"  cy="55" rx="5" ry="10"/>
      <ellipse class="${mc('triceps')}"    cx="71" cy="55" rx="5" ry="10"/>
      <ellipse class="${mc('shoulders')}"  cx="14" cy="34" rx="7" ry="7"/>
      <ellipse class="${mc('shoulders')}"  cx="66" cy="34" rx="7" ry="7"/>
      <ellipse class="${mc('glutes')}"     cx="28" cy="98" rx="12" ry="11"/>
      <ellipse class="${mc('glutes')}"     cx="52" cy="98" rx="12" ry="11"/>
      <ellipse class="${mc('hamstrings')}" cx="28" cy="118" rx="9" ry="15"/>
      <ellipse class="${mc('hamstrings')}" cx="52" cy="118" rx="9" ry="15"/>`;

    return `
      <div class="body-map-wrap">
        <input type="radio" name="bv" id="bv-f" class="bv-radio" checked>
        <input type="radio" name="bv" id="bv-b" class="bv-radio">
        <div class="bm-tabs">
          <label for="bv-f" class="bm-tab">앞면</label>
          <label for="bv-b" class="bm-tab">뒷면</label>
        </div>
        <div class="bm-panel bm-front">
          <svg viewBox="0 0 80 160" xmlns="http://www.w3.org/2000/svg">
            ${outline}${frontMuscles}
          </svg>
        </div>
        <div class="bm-panel bm-back">
          <svg viewBox="0 0 80 160" xmlns="http://www.w3.org/2000/svg">
            ${outline}${backMuscles}
          </svg>
        </div>
      </div>`;
  }

  /* ── Render Root ──────────────────────────── */
  function render() {
    if (!state.authReady) { appEl.innerHTML = renderSplash(); return; }
    if (!state.user && !state.guest) { appEl.innerHTML = renderLogin(); bindEvents(); return; }

    let html = '';
    if (state.tab === 'home')          html = renderHome();
    else if (state.tab === 'workout')  html = renderWorkout();
    else if (state.tab === 'history')  html = renderHistory();
    else if (state.tab === 'settings') html = renderSettings();

    if (state.weightPicker)   html += renderWeightPickerSheet();
    if (state.repsPicker)     html += renderRepsPickerSheet();
    if (state.exerciseInfoId) html += renderExerciseInfoSheet(state.exerciseInfoId);
    if (state.pickerPart)     html += renderExercisePickerSheet(state.pickerPart);

    html += renderBottomNav();
    appEl.innerHTML = html;
    bindEvents();
  }

  /* ── Auth screens ─────────────────────────── */
  function renderSplash() {
    return `<main class="splash-wrap">
      <div class="splash-brand">FIT<span>LOG</span></div>
      <div class="spinner"></div>
    </main>`;
  }

  function renderLogin() {
    const configured = typeof Cloud !== 'undefined' && Cloud.configured();
    const isSignup = state.authMode === 'signup';
    const busy = state.authBusy;
    return `<main class="login-screen">
      <div class="topbar-brand">FIT<span>LOG</span></div>
      <h1 class="login-title">오늘의 운동을<br>가장 멋지게 기록하세요</h1>
      <p class="login-sub">폰과 PC에서 기록이 자동으로 이어집니다.</p>
      ${configured ? `
        ${state.authError ? `<p class="login-error">${esc(state.authError)}</p>` : ''}
        <button class="btn-google" data-act="login-google" ${busy ? 'disabled' : ''}>
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.7 7.5l6.3 5.3C37.3 38.2 44 33 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
          ${busy ? '처리 중…' : 'Google로 계속하기'}
        </button>
        <div class="login-or">또는 이메일로 계속하기</div>
        <div class="login-tabs">
          <button class="login-tab${!isSignup?' active':''}" data-act="toggle-auth-mode" data-mode="signin">로그인</button>
          <button class="login-tab${isSignup?' active':''}" data-act="toggle-auth-mode" data-mode="signup">회원가입</button>
        </div>
        <input class="login-input" id="auth-email" type="email" inputmode="email" autocomplete="email" placeholder="이메일" value="${esc(state.authEmail)}">
        <input class="login-input" id="auth-password" type="password" autocomplete="${isSignup?'new-password':'current-password'}" placeholder="비밀번호 (6자 이상)" value="${esc(state.authPassword)}">
        ${isSignup ? `<input class="login-input" id="auth-password2" type="password" autocomplete="new-password" placeholder="비밀번호 확인" value="">` : ''}
        <button class="btn-hero" style="margin-top:6px" data-act="login-email" ${busy ? 'disabled' : ''}>
          ${isSignup ? '이메일로 회원가입' : '이메일로 로그인'}
        </button>
      ` : `
        <div class="login-setup">Firebase 연결 전에는 이 기기에서만 사용할 수 있습니다.</div>
      `}
      <button class="login-guest" data-act="login-guest" ${busy ? 'disabled' : ''}>로그인 없이 이 기기에서만 쓰기</button>
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
    const weekVol = weekSessions.reduce((a,s)=>a+(s.exercises||[]).reduce((b,ex)=>b+exVolume(ex),0),0);
    const weekKm = weekSessions.reduce((a,s)=>a+(Number(s.run?.km)||0),0);
    const volStr = weekVol >= 1000 ? (weekVol/1000).toFixed(1) : fmtNum(weekVol);
    const volUnit = weekVol >= 1000 ? 't' : 'kg';

    let todayBlock;
    if (todaySess) {
      const parts = (todaySess.parts||[]).map(id=>{
        const p = PARTS.find(x=>x.id===id);
        return p ? `<span class="muscle-tag" style="background:color-mix(in srgb,${p.color} 16%,var(--surface-2));color:${p.color}">${p.label}</span>` : '';
      }).join('');
      todayBlock = `<div class="today-card">
        <div class="today-card-top">
          <div class="badge-done">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            오늘 운동 완료
          </div>
          <button class="btn-ghost" style="height:34px" data-act="today">기록 편집</button>
        </div>
        <div class="today-card-parts">${parts || '<span class="sec-sub">기록 완료</span>'}</div>
      </div>`;
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
        const vol = (s.exercises||[]).reduce((a,ex)=>a+exVolume(ex),0);
        const metaVol = vol > 0 ? `${vol>=1000?(vol/1000).toFixed(1)+'t':fmtNum(vol)+'kg'} · ` : '';
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
          <div class="stat-card"><div class="stat-val">${volStr}<span>${volUnit}</span></div><div class="stat-lbl">주간 볼륨</div></div>
          <div class="stat-card"><div class="stat-val">${weekKm?weekKm.toFixed(weekKm%1?1:0):0}<span>km</span></div><div class="stat-lbl">주간 러닝</div></div>
        </div>
        ${todayBlock}
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
          <div class="sum-item">
            <div class="sum-val">${fmtNum(stats.volume)}<span>kg</span></div>
            <div class="sum-lbl">총 볼륨</div>
          </div>
          ${hasRunData(s.run) ? `
          <div class="sum-item">
            <div class="sum-val">${Number.isFinite(runKm)&&runKm?runKm:'-'}<span>km</span></div>
            <div class="sum-lbl">러닝</div>
          </div>` : ''}
        </div>
        ${stats.total ? `<div class="sum-bar"><div class="sum-bar-fill" style="width:${pct}%"></div></div>` : ''}
      </div>` : '';

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
      </main>`;
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

    const sets = ex.sets.map((set, idx) => {
      const done = set.done;
      const kg   = (set.kg   !== '' && set.kg   != null) ? set.kg   : '--';
      const reps = (set.reps !== '' && set.reps != null) ? set.reps : '--';
      return `<div class="set-row${done?' done':''}">
        <div class="set-num">${idx+1}</div>
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
    const vol = exVolume(ex);
    const allDone = prog.total > 0 && prog.done === prog.total;
    const metaBits = [];
    if (prog.total) metaBits.push(`${prog.done}/${prog.total} 세트`);
    if (vol > 0)    metaBits.push(`${fmtNum(vol)}kg`);

    return `<article class="ex-card${allDone?' all-done':''}">
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
    const { value, str = '' } = state.weightPicker;
    const display = str || (value == null || value === '' ? '0' : String(value));
    const ex = state.session?.exercises.find(x => x.id === state.weightPicker.exId);
    const idx = ex ? ex.sets.findIndex(st => st.id === state.weightPicker.setId) : -1;
    const sub = ex ? `${ex.name} · ${idx+1}세트` : '';
    const WEIGHT_PRESETS = [20,30,40,50,60,70,80,90,100,110,120,140];
    const presets = WEIGHT_PRESETS.map(w =>
      `<button class="preset-chip${Number(value)===w&&!str?' on':''}" data-act="set-weight-preset" data-val="${w}">${w}</button>`
    ).join('');
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
        <div class="picker-big">
          <div class="picker-big-num">${esc(display)}</div>
          <div class="picker-big-unit">kg</div>
        </div>
        <div class="numpad">${numpad}</div>
        <div class="picker-adj-row">
          <button class="adj-btn minus" data-act="step-weight" data-delta="-5">−5</button>
          <button class="adj-btn minus" data-act="step-weight" data-delta="-2.5">−2.5</button>
          <button class="adj-btn plus" data-act="step-weight" data-delta="2.5">+2.5</button>
          <button class="adj-btn plus" data-act="step-weight" data-delta="5">+5</button>
        </div>
        <div class="presets-scroll">${presets}</div>
        <button class="picker-confirm" data-act="confirm-weight">확인</button>
      </div>
    </div>`;
  }

  /* ── Reps Picker Sheet ────────────────────── */
  function renderRepsPickerSheet() {
    const { value, str = '' } = state.repsPicker;
    const display = str || (value == null || value === '' ? '0' : String(value));
    const ex = state.session?.exercises.find(x => x.id === state.repsPicker.exId);
    const idx = ex ? ex.sets.findIndex(st => st.id === state.repsPicker.setId) : -1;
    const sub = ex ? `${ex.name} · ${idx+1}세트` : '';
    const REPS_PRESETS = [1,3,5,6,8,10,12,15,20,25,30];
    const presets = REPS_PRESETS.map(r =>
      `<button class="preset-chip${Number(value)===r&&!str?' on':''}" data-act="set-reps-preset" data-val="${r}">${r}</button>`
    ).join('');
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
        <div class="picker-big">
          <div class="picker-big-num">${esc(display)}</div>
          <div class="picker-big-unit">회</div>
        </div>
        <div class="numpad">${numpad}</div>
        <div class="picker-adj-row">
          <button class="adj-btn minus" data-act="step-reps" data-delta="-2">−2</button>
          <button class="adj-btn minus" data-act="step-reps" data-delta="-1">−1</button>
          <button class="adj-btn plus" data-act="step-reps" data-delta="1">+1</button>
          <button class="adj-btn plus" data-act="step-reps" data-delta="2">+2</button>
        </div>
        <div class="presets-scroll">${presets}</div>
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

  /* ── Exercise pick items (shared by sheet + live search) ── */
  function buildPickItems(partId) {
    const added = new Set((state.session?.exercises||[]).filter(e=>e.part===partId).map(e=>e.name));
    const q = state.exerciseSearch.toLowerCase();
    const library = libraryFor(partId).filter(e => !q || e.name.toLowerCase().includes(q) || (e.nameEn||'').toLowerCase().includes(q));
    if (!library.length) return '<div class="help-text">검색 결과가 없습니다.</div>';
    return library.map(item => {
      const on = added.has(item.name);
      const eq = EQUIPMENT_LABEL[item.equipment] || '';
      return `<div class="pick-item${on?' on':''}">
        <button class="pick-item-name" data-act="pick-ex" data-part="${partId}" data-name="${esc(item.name)}" data-exid="${esc(item.id||'')}">
          <span>${esc(item.name)}</span>
          ${item.nameEn ? `<span class="pick-item-en">${esc(item.nameEn)}</span>` : ''}
        </button>
        ${eq ? `<span class="pick-item-eq">${esc(eq)}</span>` : ''}
        ${on ? `<button class="custom-del" data-act="quick-del-ex" data-name="${esc(item.name)}" data-part="${partId}">빼기</button>` : ''}
        ${item.custom ? `<button class="custom-del" data-act="del-custom" data-id="${esc(item.id)}">삭제</button>` : ''}
        <div class="pick-check">${on ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
      </div>`;
    }).join('');
  }

  /* ── Exercise Picker Sheet ────────────────── */
  function renderExercisePickerSheet(partId) {
    const part = PARTS.find(p => p.id === partId);
    return `<div class="sheet-backdrop">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div class="sheet-title">${part?part.label:''} 운동</div>
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
      </div>
    </div>`;
  }

  /* ── History Tab ──────────────────────────── */
  function renderHistory() {
    if (!state.sessions.length) return `
      <header class="topbar"><div class="topbar-title">히스토리</div></header>
      <main class="screen"><div class="empty-state"><div class="empty-icon">📊</div>아직 기록이 없습니다.<br>첫 운동을 기록해 보세요!</div></main>`;

    const groups = new Map();
    for (const s of state.sessions) {
      const k = monthKey(s.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    let body = renderWeeklyVolumeChart();
    for (const [key, rows] of groups) {
      body += `<div class="month-label">${fmtMonth(key)}</div><div class="recent-list">`;
      for (const s of rows) {
        const [, m, d] = s.date.split('-').map(Number);
        const summary = sessionSummary(s) || '기록';
        const dots = (s.parts||[]).map(id=>{
          const p = PARTS.find(x=>x.id===id);
          return p ? `<span class="pdot" style="background:${p.color}"></span>` : '';
        }).join('');
        const vol = (s.exercises||[]).reduce((a,ex)=>a+exVolume(ex),0);
        const volStr = vol > 0 ? (vol>=1000?(vol/1000).toFixed(1)+'t':fmtNum(vol)+'kg') : '';
        body += `<button class="recent-row" data-act="open-day" data-date="${s.date}">
          <div class="recent-daybox">
            <div class="recent-day-d">${d}</div>
            <div class="recent-day-m">${m}월</div>
          </div>
          <div class="recent-mid">
            <div class="recent-parts">${esc(summary)}</div>
            <div class="recent-meta"><span class="dotline">${dots}</span></div>
          </div>
          ${volStr ? `<div class="recent-vol">${volStr}</div>` : ''}
          <svg class="recent-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
      }
      body += '</div>';
    }
    return `<header class="topbar"><div class="topbar-title">히스토리</div></header>
      <main class="screen">${body}</main>`;
  }

  /* ── Settings Tab ─────────────────────────── */
  function renderSettings() {
    const u = state.user;
    const account = u ? `
      <div class="settings-label">계정</div>
      <div class="account-card">
        ${u.photoURL ? `<img class="account-avatar" src="${esc(u.photoURL)}" alt="">` : `<div class="account-avatar fallback">${esc((u.displayName||'?').slice(0,1))}</div>`}
        <div class="settings-item-text">
          <div class="settings-item-title">${esc(u.displayName || '사용자')}</div>
          <div class="settings-item-sub">${esc(u.email || '클라우드에 동기화 중')}</div>
        </div>
      </div>
      <button class="settings-item" data-act="logout">
        <div class="settings-item-icon" style="background:var(--red-soft);color:var(--red)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </div>
        <div class="settings-item-text">
          <div class="settings-item-title">로그아웃</div>
          <div class="settings-item-sub">이 기기에서 계정 연결 해제</div>
        </div>
      </button>` : `
      <div class="settings-label">계정</div>
      <button class="settings-item" data-act="show-login">
        <div class="settings-item-icon" style="background:var(--accent-soft);color:var(--accent)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="settings-item-text">
          <div class="settings-item-title">로그인</div>
          <div class="settings-item-sub">지금 기록은 이 기기에만 저장됩니다</div>
        </div>
        <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>`;

    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen">
        <div style="height:8px"></div>
        ${account}
        <div class="settings-label">데이터</div>
        <button class="settings-item" data-act="export">
          <div class="settings-item-icon" style="background:var(--accent-soft);color:var(--accent)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">백업 내보내기</div>
            <div class="settings-item-sub">JSON 파일로 저장</div>
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button class="settings-item" data-act="import">
          <div class="settings-item-icon" style="background:color-mix(in srgb, var(--blue) 15%, var(--surface));color:var(--blue)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">백업 가져오기</div>
            <div class="settings-item-sub">JSON 파일에서 복원</div>
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <div class="settings-label">앱 추가</div>
        <div class="settings-item" style="cursor:default">
          <div class="settings-item-icon" style="background:color-mix(in srgb, var(--purple) 15%, var(--surface));color:var(--purple)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">홈 화면에 추가</div>
            <div class="settings-item-sub">브라우저 메뉴 → 홈 화면에 추가</div>
          </div>
        </div>

        <div class="settings-label">FITLOG</div>
        <div class="settings-item" style="cursor:default">
          <div class="settings-item-text">
            <div class="settings-item-title">버전 2.0</div>
            <div class="settings-item-sub">${state.user ? '기록은 계정 클라우드와 이 기기에 저장됩니다' : '기록은 이 기기 브라우저에만 저장됩니다'}</div>
          </div>
        </div>
        <div style="height:24px"></div>
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
    if (act === 'open-day')   { await loadDay(btn.dataset.date); return; }

    /* Sheet openers */
    if (act === 'open-picker') {
      state.pickerPart = btn.dataset.part;
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
      state.weightPicker = { exId: btn.dataset.ex, setId: btn.dataset.set, value: set.kg };
      render(); return;
    }
    if (act === 'open-reps') {
      const ex = state.session.exercises.find(x=>x.id===btn.dataset.ex);
      const set = ex?.sets.find(s=>s.id===btn.dataset.set);
      if (!set) return;
      state.repsPicker = { exId: btn.dataset.ex, setId: btn.dataset.set, value: set.reps };
      render(); return;
    }

    /* Sheet closers */
    if (act === 'close-picker' || act === 'close-info' || act === 'close-sheet') { closeAllSheets(); render(); return; }

    /* Weight picker controls */
    if (act === 'set-weight-preset') {
      if (!state.weightPicker) return;
      state.weightPicker.value = Number(btn.dataset.val);
      state.weightPicker.str = '';
      render(); return;
    }
    if (act === 'step-weight') {
      if (!state.weightPicker) return;
      const p = state.weightPicker;
      const cur = p.str ? (parseFloat(p.str)||0) : (Number(p.value)||0);
      const next = Math.max(0, Math.round((cur + Number(btn.dataset.delta)) * 4) / 4);
      p.value = next; p.str = '';
      render(); return;
    }
    if (act === 'numpad-w-digit') {
      if (!state.weightPicker) return;
      const p = state.weightPicker;
      if ((p.str||'').length < 5) p.str = (p.str||'') + btn.dataset.d;
      render(); return;
    }
    if (act === 'numpad-w-dot') {
      if (!state.weightPicker) return;
      const p = state.weightPicker;
      if (!(p.str||'').includes('.') && (p.str||'').length < 5)
        p.str = (p.str||'0') + '.';
      render(); return;
    }
    if (act === 'numpad-w-back') {
      if (!state.weightPicker) return;
      state.weightPicker.str = (state.weightPicker.str||'').slice(0,-1);
      render(); return;
    }
    if (act === 'confirm-weight') {
      if (!state.weightPicker) return;
      const { exId, setId, str } = state.weightPicker;
      let value = state.weightPicker.value;
      if (str) value = parseFloat(str) || 0;
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.kg = value; await persist(); }
      state.weightPicker = null;
      render(); return;
    }

    /* Reps picker controls */
    if (act === 'set-reps-preset') {
      if (!state.repsPicker) return;
      state.repsPicker.value = Number(btn.dataset.val);
      state.repsPicker.str = '';
      render(); return;
    }
    if (act === 'step-reps') {
      if (!state.repsPicker) return;
      const p = state.repsPicker;
      const cur = p.str ? (parseInt(p.str)||0) : (Number(p.value)||0);
      const next = Math.max(0, Math.round(cur + Number(btn.dataset.delta)));
      p.value = next; p.str = '';
      render(); return;
    }
    if (act === 'numpad-r-digit') {
      if (!state.repsPicker) return;
      const p = state.repsPicker;
      if ((p.str||'').length < 3) p.str = (p.str||'') + btn.dataset.d;
      render(); return;
    }
    if (act === 'numpad-r-back') {
      if (!state.repsPicker) return;
      state.repsPicker.str = (state.repsPicker.str||'').slice(0,-1);
      render(); return;
    }
    if (act === 'numpad-r-clear') {
      if (!state.repsPicker) return;
      state.repsPicker.str = '';
      state.repsPicker.value = 0;
      render(); return;
    }
    if (act === 'confirm-reps') {
      if (!state.repsPicker) return;
      const { exId, setId, str } = state.repsPicker;
      let value = state.repsPicker.value;
      if (str) value = parseInt(str) || 0;
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.reps = value; await persist(); }
      state.repsPicker = null;
      render(); return;
    }

    /* Exercise actions */
    if (act === 'pick-ex')  { await handlePickEx(btn.dataset.part, btn.dataset.name, btn.dataset.exid); return; }
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
    if (act === 'toggle-part') { await handleTogglePart(btn.dataset.part); return; }
    if (act === 'delete-day') { await handleDeleteDay(); return; }
    if (act === 'export') { await exportJson(); return; }
    if (act === 'import') { importInput.click(); return; }
    if (act === 'login-google') { await handleGoogleLogin(); return; }
    if (act === 'login-email') { await handleEmailLogin(); return; }
    if (act === 'login-guest') { await enterApp(null, { guest: true }); return; }
    if (act === 'toggle-auth-mode') {
      /* save current input values before re-rendering */
      const emailEl = document.getElementById('auth-email');
      const passEl  = document.getElementById('auth-password');
      if (emailEl) state.authEmail    = emailEl.value;
      if (passEl)  state.authPassword = passEl.value;
      state.authMode  = btn.dataset.mode || (state.authMode === 'signup' ? 'signin' : 'signup');
      state.authError = '';
      render(); return;
    }
    if (act === 'show-login') {
      state.guest = false;
      localStorage.removeItem('fitlog-guest');
      state.authError = '';
      render(); return;
    }
    if (act === 'logout') { await handleLogout(); return; }
  }

  /* ── Input handler ───────────────────────── */
  async function onInput(e) {
    const t = e.target;
    if (t.dataset.auth === 'email') { state.authEmail = t.value; return; }
    if (t.dataset.auth === 'password') { state.authPassword = t.value; return; }
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

  /* ── Action handlers ─────────────────────── */
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

  async function handlePickEx(partId, name, exId) {
    if (!name) return;
    const s = state.session;
    if (s.exercises.some(e=>e.part===partId&&e.name===name)) {
      toast('이미 추가된 운동입니다');
      return;
    }
    const last = lastLog(name, s.date);
    const firstSet = last?.sets?.[0] || { kg:'', reps:'' };
    s.exercises.push({ id: exId||uid(), part: partId, name, sets: [{ id:uid(), kg:firstSet.kg, reps:firstSet.reps, done:false }] });
    if (!s.parts.includes(partId)) s.parts.push(partId);
    await persist();
    state.pickerPart = null;
    state.exerciseSearch = '';
    render();
  }

  async function handleAddCustom(partId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const lib = libraryFor(partId);
    if (lib.some(e=>e.name===trimmed)) {
      await handlePickEx(partId, trimmed, '');
      return;
    }
    const item = { id: 'c_'+uid(), part: partId, name: trimmed, custom: true };
    await WorkoutDB.putCustomExercise(item);
    await cloudSync(() => Cloud.saveCustom(item));
    state.customExercises.push(item);
    await handlePickEx(partId, trimmed, item.id);
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
    ex.sets.push({ id:uid(), kg:prev.kg, reps:prev.reps, done:false });
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
    await persist(); render();
  }

  async function handleCopyLast(exId) {
    const ex = state.session.exercises.find(e=>e.id===exId);
    if (!ex) return;
    const last = lastLog(ex.name, state.session.date);
    if (!last) { toast('이전 기록이 없습니다'); return; }
    ex.sets = last.sets.map(s=>({ id:uid(), kg:s.kg, reps:s.reps, done:false }));
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

  async function adoptLocalDataIfNeeded(cloudData) {
    const cloudEmpty = !(cloudData.sessions && cloudData.sessions.length);
    if (!cloudEmpty) return cloudData;
    const guest = await WorkoutDB.readGuest();
    const legacy = await WorkoutDB.readLegacy();
    const localSessions = [...(guest.sessions || []), ...(legacy.sessions || [])];
    const localCustom = [...(guest.customExercises || []), ...(legacy.customExercises || [])];
    if (!localSessions.length && !localCustom.length) return cloudData;
    if (!confirm('이 기기에 있던 이전 기록을 이 계정으로 가져올까요?')) return cloudData;
    return {
      sessions: mergeByDate(localSessions, cloudData.sessions),
      customExercises: mergeCustom(localCustom, cloudData.customExercises),
    };
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
    state.authReady = true;
    render();
    if (user && arrivedFromLogin) toast('로그인했습니다');

    if (user) syncInBackground();
  }

  async function syncInBackground() {
    if (state.syncing) return;
    state.syncing = true;
    try {
      await withTimeout(Cloud.touchProfile(), 8000, '프로필');
      let cloudData = await withTimeout(Cloud.pullAll(), 12000, '불러오기');
      cloudData = await adoptLocalDataIfNeeded(cloudData);
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

  async function handleEmailLogin() {
    if (state.authBusy) return;
    if (!Cloud.configured()) { state.authError = 'Firebase가 아직 연결되지 않았습니다.'; render(); return; }

    /* Read directly from DOM so we don't rely on oninput timing */
    const emailEl = document.getElementById('auth-email');
    const passEl  = document.getElementById('auth-password');
    const pass2El = document.getElementById('auth-password2');
    const email    = (emailEl ? emailEl.value : state.authEmail).trim();
    const password = passEl ? passEl.value : state.authPassword;

    if (!email || !password) {
      state.authError = '이메일과 비밀번호를 입력해 주세요.';
      render(); return;
    }
    if (state.authMode === 'signup' && pass2El && pass2El.value !== password) {
      state.authError = '비밀번호가 일치하지 않습니다.';
      render(); return;
    }

    state.authEmail    = email;
    state.authPassword = password;
    state.authBusy     = true;
    state.authError    = '';
    render();
    try {
      const user = state.authMode === 'signup'
        ? await Cloud.signUpEmail(email, password)
        : await Cloud.signInEmail(email, password);
      await enterApp(user);
    } catch (err) {
      state.authBusy = false;
      state.authError = Cloud.authMessage(err);
      render();
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

  /* ── Init ────────────────────────────────── */
  async function init() {
    render();
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
