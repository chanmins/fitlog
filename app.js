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
  async function doSave() {
    const s = state.session;
    if (!s) return;
    if (!worthSaving(s)) {
      await WorkoutDB.deleteSession(s.date);
      state.sessions = state.sessions.filter(x => x.date !== s.date);
      return;
    }
    await WorkoutDB.putSession(clone(s));
    const idx = state.sessions.findIndex(x => x.date === s.date);
    const copy = clone(s);
    if (idx >= 0) state.sessions[idx] = copy; else state.sessions.push(copy);
    state.sessions.sort((a,b) => b.date.localeCompare(a.date));
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
  function bodyMapSVG(primary = [], secondary = []) {
    const P = new Set(primary);
    const S = new Set(secondary);
    function mc(ids) {
      const arr = [].concat(ids);
      if (arr.some(id=>P.has(id))) return 'mp';
      if (arr.some(id=>S.has(id))) return 'ms';
      return 'mi';
    }

    /* Reusable body outline paths (front & back share the same silhouette) */
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
      <div class="body-map">
        <figure class="body-view">
          <svg viewBox="0 0 80 160" xmlns="http://www.w3.org/2000/svg">
            ${outline}${frontMuscles}
          </svg>
          <figcaption>앞</figcaption>
        </figure>
        <figure class="body-view">
          <svg viewBox="0 0 80 160" xmlns="http://www.w3.org/2000/svg">
            ${outline}${backMuscles}
          </svg>
          <figcaption>뒤</figcaption>
        </figure>
      </div>`;
  }

  /* ── Render Root ─────────────────────────── */
  function render() {
    let html = '';
    if (state.tab === 'home')     html = renderHome();
    else if (state.tab === 'workout') html = renderWorkout();
    else if (state.tab === 'history') html = renderHistory();
    else if (state.tab === 'settings') html = renderSettings();

    /* Sheets on top */
    if (state.weightPicker)   html += renderWeightPickerSheet();
    if (state.repsPicker)     html += renderRepsPickerSheet();
    if (state.exerciseInfoId) html += renderExerciseInfoSheet(state.exerciseInfoId);
    if (state.pickerPart)     html += renderExercisePickerSheet(state.pickerPart);

    html += renderBottomNav();
    appEl.innerHTML = html;
    bindEvents();
  }

  /* ── Bottom Nav ──────────────────────────── */
  function renderBottomNav() {
    const tabs = [
      { id:'home',     label:'홈',
        icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>` },
      { id:'workout',  label:'기록',
        icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>` },
      { id:'history',  label:'히스토리',
        icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` },
      { id:'settings', label:'설정',
        icon:`<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` },
    ];
    return `<nav class="bottom-nav">${tabs.map(t=>`
      <button class="nav-tab${state.tab===t.id?' active':''}" data-act="go-tab" data-tab="${t.id}">
        ${t.icon}<span>${t.label}</span>
      </button>`).join('')}</nav>`;
  }

  /* ── Home Tab ────────────────────────────── */
  function renderHome() {
    const today = todayISO();
    const todaySess = state.sessions.find(s => s.date === today);
    const weekDays = getWeekDays();
    const todayDate = new Date();

    const weekStrip = weekDays.map((iso, i) => {
      const [,m,d] = iso.split('-').map(Number);
      const hasSess = state.sessions.some(s => s.date === iso);
      const isToday = iso === today;
      const isPast  = iso < today;
      return `<div class="week-day${hasSess?' done':''}${isToday?' today':''}">
        <div class="dot">${hasSess ? '✓' : (isPast ? '·' : '')}</div>
        <span>${WEEKDAYS_SHORT[i]}</span>
      </div>`;
    }).join('');

    let todayBlock;
    if (todaySess) {
      const summary = sessionSummary(todaySess) || '기록 완료';
      todayBlock = `<div class="today-card">
        <div class="today-card-top">
          <div class="today-status-badge done">✓ 오늘 완료</div>
          <button class="btn-ghost" style="height:32px;padding:0 12px;font-size:13px" data-act="today">편집</button>
        </div>
        <div style="font-size:15px;color:var(--sub);font-weight:600">${esc(summary)}</div>
      </div>`;
    } else {
      todayBlock = `<div style="margin-bottom:20px">
        <button class="btn-hero" data-act="today">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          오늘 운동 기록하기
        </button>
      </div>`;
    }

    const recent = state.sessions.slice(0, 8);
    const recentHtml = recent.length
      ? `<div class="sec-head"><div class="sec-title">최근 기록</div></div>
         <div class="recent-list">${recent.map(s => `
           <button class="recent-row" data-act="open-day" data-date="${s.date}">
             <div class="recent-date">${shortDate(s.date)}</div>
             <div class="recent-parts">${esc(sessionSummary(s) || '기록')}</div>
             <svg class="recent-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
           </button>`).join('')}</div>`
      : '';

    const greetings = ['파이팅! 💪', '꾸준함이 답입니다 🔥', '오늘도 한 걸음 더 🚀', '몸이 자산입니다 ⚡'];
    const greeting = greetings[new Date().getDay() % greetings.length];
    const weekCount = weekDays.filter(iso => state.sessions.some(s => s.date === iso)).length;

    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen">
        <div class="home-greeting">
          <div class="home-date">${todayDate.getMonth()+1}월 ${todayDate.getDate()}일 (${WEEKDAYS[todayDate.getDay()]}) · 이번 주 ${weekCount}회</div>
          <div class="home-title">오늘도 <em>${greeting}</em></div>
        </div>
        <div class="week-strip">${weekStrip}</div>
        ${todayBlock}
        ${recentHtml}
      </main>`;
  }

  /* ── Workout Tab ─────────────────────────── */
  function renderWorkout() {
    const s = state.session;
    if (!s) return `<header class="topbar"><div class="topbar-title">기록</div></header>
      <main class="screen"><div class="empty-state"><div class="empty-icon">🏋️</div>오늘의 운동을 시작하세요</div>
      <button class="btn-hero" data-act="today">오늘 기록 시작하기</button></main>`;

    const chips = PARTS.map(p => {
      const on = s.parts.includes(p.id);
      return `<button class="part-chip${on?' on':''}" style="color:${p.color}" data-act="toggle-part" data-part="${p.id}">
        <div class="dot"></div>${p.label}</button>`;
    }).join('');

    let blocks = '';

    /* Running */
    if (s.parts.includes('run')) {
      blocks += `<div class="run-card">
        <div class="sec-head" style="margin-top:0">
          <div class="sec-title" style="color:var(--blue)">러닝</div>
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

    /* Weight exercises by part */
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
        blocks += `<div class="help-text" style="margin-bottom:8px">+ 운동 추가로 종목을 넣어보세요.</div>`;
      }
    }

    if (!s.parts.length) {
      blocks = `<div class="empty-state" style="padding:32px 0"><div class="empty-icon">👆</div>부위를 선택하면<br>운동을 기록할 수 있습니다.</div>`;
    }

    return `
      <header class="topbar">
        <button class="btn-icon" data-act="go-tab" data-tab="home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div class="topbar-title">${esc(longDate(s.date))}</div>
        <button class="btn-icon danger" data-act="delete-day">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </header>
      <main class="screen">
        <input type="date" class="date-pick" style="margin-bottom:14px" data-act="change-date" value="${s.date}">
        <div class="sec-head" style="margin-top:0"><div class="sec-title">부위 선택</div></div>
        <div class="part-chips">${chips}</div>
        ${blocks}
        <div class="sec-head"><div class="sec-title">메모</div></div>
        <textarea class="memo-field" data-notes placeholder="컨디션, 페이스, 목표 무게 등">${esc(s.notes)}</textarea>
        <p class="help-text">모든 변경은 자동 저장됩니다.</p>
      </main>`;
  }

  /* ── Exercise Card ───────────────────────── */
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
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.7"/></svg>
           <strong>지난번 ${shortDate(last.date)}</strong> · ${esc(fmtSets(last.sets)||'기록 있음')} — 탭하면 불러오기
         </button>`
      : '';

    const sets = ex.sets.map((set, idx) => {
      const done = set.done;
      const kg   = (set.kg   !== '' && set.kg   != null) ? set.kg   : '--';
      const reps = (set.reps !== '' && set.reps != null) ? set.reps : '--';
      return `<div class="set-row${done?' done':''}">
        <div class="set-num">${idx+1}</div>
        <button class="val-chip${done?' done':''}" data-act="open-weight" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <div class="val-chip-num">${kg}</div>
          <div class="val-chip-unit">kg</div>
        </button>
        <button class="val-chip${done?' done':''}" data-act="open-reps" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}">
          <div class="val-chip-num">${reps}</div>
          <div class="val-chip-unit">회</div>
        </button>
        <button class="done-toggle${done?' done':''}" data-act="toggle-done" data-ex="${esc(ex.id)}" data-set="${esc(set.id)}" aria-label="세트 완료">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>`;
    }).join('');

    return `<article class="ex-card">
      <div class="ex-card-head">
        <div style="flex:1">
          <div class="ex-card-name">${esc(ex.name)}</div>
          <div class="ex-card-sub">${muscleTags}</div>
        </div>
        <button class="btn-icon" style="margin-top:2px" data-act="show-ex-info" data-exid="${esc(ex.id)}" data-exname="${esc(ex.name)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
        </button>
        <button class="btn-icon danger" data-act="del-ex" data-ex="${esc(ex.id)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      ${prevHint}
      <div class="set-table">
        <div class="set-table-head"><span>#</span><span>무게</span><span>횟수</span><span>완료</span></div>
        ${sets}
        <button class="add-set-row" data-act="add-set" data-ex="${esc(ex.id)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          세트 추가
        </button>
      </div>
    </article>`;
  }

  /* ── Weight Picker Sheet ─────────────────── */
  function renderWeightPickerSheet() {
    const { value } = state.weightPicker;
    const display = (value === '' || value == null) ? '0' : String(value);
    const WEIGHT_PRESETS = [20,30,40,50,60,70,80,90,100,110,120,140,160];
    const presets = WEIGHT_PRESETS.map(w =>
      `<button class="preset-chip${Number(value)===w?' on':''}" data-act="set-weight-preset" data-val="${w}">${w}</button>`
    ).join('');
    const steps = [
      {label:'-10',  delta:-10,  cls:'minus'}, {label:'-5',  delta:-5,  cls:'minus'}, {label:'-2.5', delta:-2.5, cls:'minus'},
      {label:'+2.5', delta:2.5,  cls:'plus'},  {label:'+5',  delta:5,   cls:'plus'},  {label:'+10',  delta:10,   cls:'plus'},
    ];
    const stepBtns = steps.map(s =>
      `<button class="stepper-btn ${s.cls}" data-act="step-weight" data-delta="${s.delta}">${s.label}</button>`
    ).join('');
    return `<div class="sheet-backdrop" data-act="close-picker">
      <div class="sheet-panel" id="sheet-weight">
        <div class="sheet-grab"></div>
        <div class="sheet-title">무게 선택</div>
        <div class="picker-big">
          <div class="picker-big-num">${esc(display)}</div>
          <div class="picker-big-unit">kg</div>
        </div>
        <div class="presets-scroll">${presets}</div>
        <div class="stepper-grid">${stepBtns}</div>
        <button class="picker-confirm" data-act="confirm-weight">확인</button>
      </div>
    </div>`;
  }

  /* ── Reps Picker Sheet ────────────────────── */
  function renderRepsPickerSheet() {
    const { value } = state.repsPicker;
    const display = (value === '' || value == null) ? '0' : String(value);
    const REPS_PRESETS = [1,3,5,6,8,10,12,15,20,25,30];
    const presets = REPS_PRESETS.map(r =>
      `<button class="preset-chip${Number(value)===r?' on':''}" data-act="set-reps-preset" data-val="${r}">${r}</button>`
    ).join('');
    const steps = [
      {label:'-2', delta:-2, cls:'minus'}, {label:'-1', delta:-1, cls:'minus'}, {label:'0', delta:0, cls:''},
      {label:'+1', delta:1, cls:'plus'},   {label:'+2', delta:2, cls:'plus'},   {label:'+5', delta:5, cls:'plus'},
    ];
    const stepBtns = steps.map(s =>
      s.delta === 0
        ? `<button class="stepper-btn" style="color:var(--muted)" data-act="set-reps-preset" data-val="0">초기화</button>`
        : `<button class="stepper-btn ${s.cls}" data-act="step-reps" data-delta="${s.delta}">${s.label>0?'+':''}${s.label}</button>`
    ).join('');
    return `<div class="sheet-backdrop" data-act="close-picker">
      <div class="sheet-panel" id="sheet-reps">
        <div class="sheet-grab"></div>
        <div class="sheet-title">횟수 선택</div>
        <div class="picker-big">
          <div class="picker-big-num">${esc(display)}</div>
          <div class="picker-big-unit">회</div>
        </div>
        <div class="presets-scroll">${presets}</div>
        <div class="stepper-grid">${stepBtns}</div>
        <button class="picker-confirm" data-act="confirm-reps">확인</button>
      </div>
    </div>`;
  }

  /* ── Exercise Info Sheet ──────────────────── */
  function renderExerciseInfoSheet(exId) {
    /* exId may be a library id, custom id, or exercise name */
    const libEx = findExercise(exId) || state.customExercises.find(e => e.id === exId || e.name === exId);
    if (!libEx) return '';

    const primary   = libEx.primary || [];
    const secondary = libEx.secondary || [];
    const diffStars = '★'.repeat(libEx.difficulty||1) + '☆'.repeat(3-(libEx.difficulty||1));
    const eq = EQUIPMENT_LABEL[libEx.equipment] || libEx.equipment || '기타';

    const primaryPills   = primary.map(m => `<span class="muscle-pill primary"><span class="muscle-pill-dot"></span>${esc(MUSCLE_GROUPS[m]||m)}</span>`).join('');
    const secondaryPills = secondary.map(m => `<span class="muscle-pill secondary"><span class="muscle-pill-dot"></span>${esc(MUSCLE_GROUPS[m]||m)}</span>`).join('');

    const tips = (libEx.tips||[]).map((tip,i)=>`
      <li>
        <div class="tip-num">${i+1}</div>
        <span>${esc(tip)}</span>
      </li>`).join('');

    return `<div class="sheet-backdrop" data-act="close-info">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div class="info-hero">
          <div class="info-hero-text">
            <div class="info-name">${esc(libEx.name)}</div>
            ${libEx.nameEn ? `<div class="info-name-en">${esc(libEx.nameEn)}</div>` : ''}
            <div class="info-meta">
              <span class="info-badge eq">${esc(eq)}</span>
              <span class="info-badge"><span class="diff-stars">${diffStars}</span></span>
            </div>
          </div>
        </div>
        ${bodyMapSVG(primary, secondary)}
        <div class="muscle-legend">
          <div class="muscle-legend-title">주동근</div>
          <div class="muscle-legend-row">${primaryPills}</div>
          ${secondary.length ? `<div class="muscle-legend-title" style="margin-top:8px">협력근</div><div class="muscle-legend-row">${secondaryPills}</div>` : ''}
        </div>
        ${libEx.description ? `<p class="info-desc">${esc(libEx.description)}</p>` : ''}
        ${tips ? `<div class="sec-title" style="margin-bottom:10px">수행 팁</div><ul class="tips-list">${tips}</ul>` : ''}
      </div>
    </div>`;
  }

  /* ── Exercise Picker Sheet ────────────────── */
  function renderExercisePickerSheet(partId) {
    const part = PARTS.find(p => p.id === partId);
    const added = new Set((state.session?.exercises||[]).filter(e=>e.part===partId).map(e=>e.name));
    const q = state.exerciseSearch.toLowerCase();
    const library = libraryFor(partId).filter(e => !q || e.name.toLowerCase().includes(q) || (e.nameEn||'').toLowerCase().includes(q));

    const items = library.map(item => {
      const on = added.has(item.name);
      const eq = EQUIPMENT_LABEL[item.equipment] || '';
      return `<div class="pick-item${on?' on':''}">
        <button class="pick-item-name" data-act="pick-ex" data-part="${partId}" data-name="${esc(item.name)}" data-exid="${esc(item.id||'')}">
          ${esc(item.name)}
        </button>
        ${eq ? `<span class="pick-item-eq">${esc(eq)}</span>` : ''}
        ${on ? `<button class="custom-del" data-act="quick-del-ex" data-name="${esc(item.name)}" data-part="${partId}">빼기</button>` : ''}
        ${item.custom ? `<button class="custom-del" data-act="del-custom" data-id="${esc(item.id)}">삭제</button>` : ''}
        <div class="pick-check">${on ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
      </div>`;
    }).join('');

    return `<div class="sheet-backdrop" data-act="close-picker">
      <div class="sheet-panel">
        <div class="sheet-grab"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="sheet-title" style="margin:0">${part?part.label:''} 운동</div>
          <button class="btn-ghost" style="height:36px;padding:0 14px;font-size:14px" data-act="close-picker">완료</button>
        </div>
        <div class="search-bar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input id="picker-search" placeholder="운동 검색" value="${esc(state.exerciseSearch)}" data-act="search-ex">
        </div>
        <div class="pick-list">${items || '<div class="help-text">검색 결과가 없습니다.</div>'}</div>
        <div class="custom-add-row">
          <input id="custom-name" placeholder="없는 운동 직접 추가">
          <button class="btn-add-sm" data-act="add-custom" data-part="${partId}">추가</button>
        </div>
      </div>
    </div>`;
  }

  /* ── History Tab ──────────────────────────── */
  function renderHistory() {
    if (!state.sessions.length) return `
      <header class="topbar"><div class="topbar-title">히스토리</div></header>
      <main class="screen"><div class="empty-state"><div class="empty-icon">📋</div>아직 기록이 없습니다.<br>첫 운동을 기록해 보세요!</div></main>`;

    const groups = new Map();
    for (const s of state.sessions) {
      const k = monthKey(s.date);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    let body = '';
    for (const [key, rows] of groups) {
      body += `<div class="month-label">${fmtMonth(key)}</div><div class="recent-list">`;
      for (const s of rows) {
        const summary = sessionSummary(s) || '기록';
        body += `<button class="recent-row" data-act="open-day" data-date="${s.date}">
          <div class="recent-date">${shortDate(s.date)}</div>
          <div class="recent-parts">${esc(summary)}</div>
          <svg class="recent-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
      }
      body += '</div>';
    }
    return `<header class="topbar"><div class="topbar-title">히스토리</div></header>
      <main class="screen">${body}</main>`;
  }

  /* ── Settings Tab ─────────────────────────── */
  function renderSettings() {
    return `
      <header class="topbar">
        <div class="topbar-brand">FIT<span>LOG</span></div>
      </header>
      <main class="screen">
        <div style="height:12px"></div>
        <div class="settings-label">데이터</div>
        <button class="settings-item" data-act="export">
          <div class="settings-item-icon" style="background:var(--accent-bg);color:var(--accent)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">백업 내보내기</div>
            <div class="settings-item-sub">JSON 파일로 저장</div>
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <button class="settings-item" data-act="import">
          <div class="settings-item-icon" style="background:color-mix(in srgb, var(--blue) 14%, var(--bg));color:var(--blue)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">백업 가져오기</div>
            <div class="settings-item-sub">JSON 파일에서 복원</div>
          </div>
          <svg class="settings-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        <div class="settings-label" style="margin-top:20px">앱 추가</div>
        <div class="settings-item" style="cursor:default">
          <div class="settings-item-icon" style="background:color-mix(in srgb, var(--purple) 14%, var(--bg));color:var(--purple)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          </div>
          <div class="settings-item-text">
            <div class="settings-item-title">홈 화면에 추가</div>
            <div class="settings-item-sub">크롬 메뉴 → 홈 화면에 추가</div>
          </div>
        </div>

        <div class="settings-label" style="margin-top:20px">FITLOG</div>
        <div class="settings-item" style="cursor:default">
          <div class="settings-item-text">
            <div class="settings-item-title">버전 1.0</div>
            <div class="settings-item-sub">기록은 이 기기 브라우저에만 저장됩니다</div>
          </div>
        </div>
        <div style="height:24px"></div>
      </main>`;
  }

  /* ── Event Binding ───────────────────────── */
  function bindEvents() {
    appEl.onclick  = onClick;
    appEl.oninput  = onInput;
    appEl.onchange = onChangeEvt;

    /* Sheet panels: stop click/input from bubbling to the backdrop,
       but still run the handler so inner actions work. */
    appEl.querySelectorAll('.sheet-panel').forEach(panel => {
      panel.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
      panel.addEventListener('input', e => { e.stopPropagation(); onInput(e); });
    });
  }

  /* ── Click handler ───────────────────────── */
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
    if (act === 'close-picker') { state.pickerPart = null; state.exerciseSearch = ''; render(); return; }
    if (act === 'close-info')   { state.exerciseInfoId = null; render(); return; }

    /* Weight picker controls */
    if (act === 'set-weight-preset') {
      if (!state.weightPicker) return;
      state.weightPicker.value = Number(btn.dataset.val);
      render(); return;
    }
    if (act === 'step-weight') {
      if (!state.weightPicker) return;
      const cur = Number(state.weightPicker.value) || 0;
      const next = Math.max(0, Math.round((cur + Number(btn.dataset.delta)) * 4) / 4);
      state.weightPicker.value = next;
      render(); return;
    }
    if (act === 'confirm-weight') {
      if (!state.weightPicker) return;
      const { exId, setId, value } = state.weightPicker;
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.kg = parseNum(value); await persist(); }
      state.weightPicker = null;
      render(); return;
    }

    /* Reps picker controls */
    if (act === 'set-reps-preset') {
      if (!state.repsPicker) return;
      state.repsPicker.value = Number(btn.dataset.val);
      render(); return;
    }
    if (act === 'step-reps') {
      if (!state.repsPicker) return;
      const cur = Number(state.repsPicker.value) || 0;
      const next = Math.max(0, Math.round(cur + Number(btn.dataset.delta)));
      state.repsPicker.value = next;
      render(); return;
    }
    if (act === 'confirm-reps') {
      if (!state.repsPicker) return;
      const { exId, setId, value } = state.repsPicker;
      const ex = state.session.exercises.find(x=>x.id===exId);
      const set = ex?.sets.find(s=>s.id===setId);
      if (set) { set.reps = parseNum(value); await persist(); }
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
    if (act === 'toggle-done') { await handleToggleDone(btn.dataset.ex, btn.dataset.set); return; }
    if (act === 'copy-last') { await handleCopyLast(btn.dataset.ex); return; }
    if (act === 'toggle-part') { await handleTogglePart(btn.dataset.part); return; }
    if (act === 'delete-day') { await handleDeleteDay(); return; }
    if (act === 'export') { await exportJson(); return; }
    if (act === 'import') { importInput.click(); return; }
  }

  /* ── Input handler ───────────────────────── */
  async function onInput(e) {
    const t = e.target;
    if (t.dataset.run != null) {
      const val = parseNum(t.value);
      state.session.run[t.dataset.run] = val !== '' ? val : t.value;
      await persist(); return;
    }
    if (t.hasAttribute('data-notes')) {
      state.session.notes = t.value;
      await persist(); return;
    }
    if (t.dataset.act === 'search-ex') {
      state.exerciseSearch = t.value;
      /* Live-update picker list only */
      const list = document.querySelector('.pick-list');
      if (list) {
        const partId = state.pickerPart;
        const added = new Set((state.session?.exercises||[]).filter(e=>e.part===partId).map(e=>e.name));
        const q = state.exerciseSearch.toLowerCase();
        const library = libraryFor(partId).filter(e => !q || e.name.toLowerCase().includes(q) || (e.nameEn||'').toLowerCase().includes(q));
        list.innerHTML = library.map(item => {
          const on = added.has(item.name);
          const eq = EQUIPMENT_LABEL[item.equipment] || '';
          return `<div class="pick-item${on?' on':''}">
            <button class="pick-item-name" data-act="pick-ex" data-part="${partId}" data-name="${esc(item.name)}" data-exid="${esc(item.id||'')}">
              ${esc(item.name)}
            </button>
            ${eq ? `<span class="pick-item-eq">${esc(eq)}</span>` : ''}
            ${on ? `<button class="custom-del" data-act="quick-del-ex" data-name="${esc(item.name)}" data-part="${partId}">빼기</button>` : ''}
            ${item.custom ? `<button class="custom-del" data-act="del-custom" data-id="${esc(item.id)}">삭제</button>` : ''}
            <div class="pick-check">${on ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
          </div>`;
        }).join('') || '<div class="help-text">검색 결과가 없습니다.</div>';
        bindEvents();
      }
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
    state.customExercises.push(item);
    await handlePickEx(partId, trimmed, item.id);
  }

  async function handleDeleteCustom(id) {
    const item = state.customExercises.find(e=>e.id===id);
    if (!item) return;
    if (!confirm(`'${item.name}'을(를) 목록에서 삭제할까요?`)) return;
    await WorkoutDB.deleteCustomExercise(id);
    state.customExercises = state.customExercises.filter(e=>e.id!==id);
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
    state.tab = 'home';
    render(); toast('가져왔습니다');
  }

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (file) await importJson(file);
  });

  /* ── Init ────────────────────────────────── */
  async function init() {
    await WorkoutDB.open();
    state.sessions = await WorkoutDB.getAllSessions();
    state.customExercises = await WorkoutDB.getCustomExercises();
    /* Pre-load today's session */
    const today = todayISO();
    const saved = await WorkoutDB.getSession(today);
    state.session = normalizeSession(saved || emptySession(today));
    render();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
  }

  init().catch(err => {
    appEl.innerHTML = `<main style="padding:40px 24px;color:#f87171;font-family:system-ui">
      저장소 오류: ${String(err)}</main>`;
  });
})();
