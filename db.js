const WorkoutDB = (() => {
  const LEGACY_NAME = "workout-log";
  /* 저장소를 하나 추가할 때마다 이 숫자를 올려야 합니다.
       1 → sessions, customExercises
       2 → + routines (루틴 저장)
       3 → + metrics  (몸무게 등 신체 기록)
     올리는 걸 잊으면, 아래 '빠진 저장소 복구' 가 DB 를 2 로 올려놓은 뒤
     다음 실행에서 다시 1 을 요청하게 되어 VersionError 가 납니다. */
  const DB_VERSION = 3;
  let scope = "guest";
  let dbPromise = null;

  function dbName() {
    return scope === "guest" ? "fitlog-guest" : `fitlog-${scope}`;
  }

  function setScope(uid) {
    const next = uid || "guest";
    if (next === scope && dbPromise) return;
    /* Close the connection we are walking away from. Dropping the promise on
       its own leaves the old database open, which blocks any later version
       change on it and keeps a live handle that in-flight callers can still
       transact against after the scope has moved on. */
    const stale = dbPromise;
    if (stale) stale.then((db) => { try { db.close(); } catch (_) {} }, () => {});
    scope = next;
    dbPromise = null;
  }

  function createStores(db) {
    if (!db.objectStoreNames.contains("sessions")) {
      db.createObjectStore("sessions", { keyPath: "date" });
    }
    if (!db.objectStoreNames.contains("customExercises")) {
      db.createObjectStore("customExercises", { keyPath: "id" });
    }
    /* 저장한 루틴 (자주 하는 부위·운동 조합) */
    if (!db.objectStoreNames.contains("routines")) {
      db.createObjectStore("routines", { keyPath: "id" });
    }
    /* 몸무게 같은 신체 기록. 하루에 하나면 충분하므로 날짜가 곧 키입니다. */
    if (!db.objectStoreNames.contains("metrics")) {
      db.createObjectStore("metrics", { keyPath: "date" });
    }
  }

  function openAt(name, version) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      req.onupgradeneeded = () => createStores(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB blocked"));
    });
  }

  /* 이 기기의 DB 가 코드가 아는 버전보다 앞서 있을 수 있습니다 — 예전 버전의
     복구 경로가 버전을 올려놨거나, 새 버전을 쓰던 기기에서 옛 앱을 열었거나.
     그때 낮은 버전을 요청하면 IndexedDB 는 VersionError 를 던지고 앱이 통째로
     막힙니다. 버전을 지정하지 않고 열면 있는 그대로 열리므로, 그렇게 연 뒤
     빠진 저장소가 있으면 아래 복구가 처리합니다. */
  async function openCurrent(name) {
    try {
      return await openAt(name, DB_VERSION);
    } catch (err) {
      if (err && err.name === "VersionError") return await openAt(name, undefined);
      throw err;
    }
  }

  function open() {
    if (dbPromise) return dbPromise;
    const p = (async () => {
      let db = await openCurrent(dbName());
      /* A database can sit at the right version and still be missing its
         stores — an upgrade interrupted by a closed tab, an evicted private
         session, or a scope switch mid-open leaves exactly that. Every
         transaction then throws "object stores was not found", which is what
         made 로그아웃 fail halfway: the screen stayed on the app while the
         sign-out below it never ran. Reopening one version higher re-runs
         onupgradeneeded and repairs the database in place. */
      if (!db.objectStoreNames.contains("sessions") ||
          !db.objectStoreNames.contains("customExercises") ||
          !db.objectStoreNames.contains("routines") ||
          !db.objectStoreNames.contains("metrics")) {
        const bumped = db.version + 1;
        try { db.close(); } catch (_) {}
        db = await openAt(dbName(), bumped);
      }
      return db;
    })();
    /* A failed open must not stay cached, or every later call replays the same
       rejection and the app cannot recover without a reload. */
    p.catch(() => { if (dbPromise === p) dbPromise = null; });
    dbPromise = p;
    return p;
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* abort 를 반드시 함께 받습니다.
     IndexedDB 트랜잭션은 error 를 거치지 않고 곧바로 중단될 수 있습니다 —
     저장 공간 부족(iOS 에서 흔합니다), 다른 탭의 버전 변경, 연결이 밑에서
     닫히는 경우(setScope 가 그렇게 합니다). 예전에는 그때 이 약속이 영영
     결말이 나지 않았고, 저장은 promise 사슬로 줄을 서 있어서 그 뒤의 모든
     저장이 통째로 멈췄습니다. 화면의 숫자는 state 에 있으니 멀쩡해 보이고,
     "입력하는 즉시 저장됩니다" 라는 안내도 그대로인데, 새로고침하면 중단
     시점 이후가 전부 사라집니다. */
  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("transaction error"));
      tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });
  }

  async function getAllSessions() {
    const db = await open();
    const tx = db.transaction("sessions", "readonly");
    const rows = await requestToPromise(tx.objectStore("sessions").getAll());
    /* date 가 문자열이 아닌 행이 하나라도 섞이면 localeCompare 가 터지고,
       그 예외는 loadWorkspace → init 까지 올라가 앱이 아예 안 열립니다.
       기록은 저장소에 멀쩡히 있는데 설정 화면조차 못 가서 손쓸 방법이
       없어집니다. 이상한 행은 조용히 빼고 나머지를 보여 줍니다. */
    return (rows || [])
      .filter(r => r && typeof r.date === "string")
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  async function getSession(date) {
    const db = await open();
    const tx = db.transaction("sessions", "readonly");
    return requestToPromise(tx.objectStore("sessions").get(date));
  }

  async function putSession(session) {
    const db = await open();
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").put(session);
    return txDone(tx);
  }

  async function deleteSession(date) {
    const db = await open();
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").delete(date);
    return txDone(tx);
  }

  async function getCustomExercises() {
    const db = await open();
    const tx = db.transaction("customExercises", "readonly");
    return requestToPromise(tx.objectStore("customExercises").getAll());
  }

  async function putCustomExercise(exercise) {
    const db = await open();
    const tx = db.transaction("customExercises", "readwrite");
    tx.objectStore("customExercises").put(exercise);
    return txDone(tx);
  }

  async function deleteCustomExercise(id) {
    const db = await open();
    const tx = db.transaction("customExercises", "readwrite");
    tx.objectStore("customExercises").delete(id);
    return txDone(tx);
  }

  async function getRoutines() {
    const db = await open();
    const tx = db.transaction("routines", "readonly");
    const rows = await requestToPromise(tx.objectStore("routines").getAll());
    return (rows || []).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
  }

  async function putRoutine(routine) {
    const db = await open();
    const tx = db.transaction("routines", "readwrite");
    tx.objectStore("routines").put(routine);
    return txDone(tx);
  }

  /* 여러 건을 한 트랜잭션에 넣습니다.
     동기화는 합친 목록을 통째로 다시 씁니다. 한 건씩 putRoutine/putMetric 을
     부르면 그때마다 트랜잭션이 새로 열려, 1년치 몸무게가 쌓인 사람은 동기화
     한 번에 트랜잭션이 365개 열렸습니다. */
  async function putMany(storeName, rows) {
    const list = (rows || []).filter(Boolean);
    if (!list.length) return;
    const db = await open();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    for (const row of list) store.put(row);
    return txDone(tx);
  }

  async function putRoutines(rows) {
    return putMany("routines", (rows || []).filter(r => r && r.id));
  }

  async function putMetrics(rows) {
    return putMany("metrics", (rows || []).filter(r => r && typeof r.date === "string"));
  }

  async function deleteRoutine(id) {
    const db = await open();
    const tx = db.transaction("routines", "readwrite");
    tx.objectStore("routines").delete(id);
    return txDone(tx);
  }

  async function getMetrics() {
    const db = await open();
    const tx = db.transaction("metrics", "readonly");
    const rows = await requestToPromise(tx.objectStore("metrics").getAll());
    /* getAllSessions() 와 같은 이유입니다 — date 가 문자열이 아닌 행이
       섞이면 localeCompare 가 TypeError 를 던지고, 그 예외가 loadWorkspace
       까지 올라가 앱이 아예 안 열립니다. 몸무게 기록 하나가 이상하다고
       전체 앱이 막히면 안 되므로 이상한 행은 조용히 걸러내고 나머지를
       보여 줍니다. */
    return (rows || [])
      .filter(r => r && typeof r.date === "string")
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async function putMetric(row) {
    const db = await open();
    const tx = db.transaction("metrics", "readwrite");
    tx.objectStore("metrics").put(row);
    return txDone(tx);
  }

  async function deleteMetric(date) {
    const db = await open();
    const tx = db.transaction("metrics", "readwrite");
    tx.objectStore("metrics").delete(date);
    return txDone(tx);
  }

  async function replaceAll(sessions, customExercises) {
    const db = await open();
    const tx = db.transaction(["sessions", "customExercises"], "readwrite");
    /* clear() 든 put() 이든 이 트랜잭션 안의 요청 하나가 실패하면 IndexedDB
       가 트랜잭션 전체를 abort 시킵니다 — sessions 는 지워지고
       customExercises 만 남는 식의 절반짜리 결과는 스펙상 나오지 않습니다.
       다만 txDone() 이 reject 될 수 있으므로, 호출자(importAll)가 실패를
       "가져오기 실패" 로 분명히 알 수 있도록 에러를 그대로 던집니다. */
    tx.objectStore("sessions").clear();
    tx.objectStore("customExercises").clear();
    for (const session of sessions || []) {
      if (session && session.date) tx.objectStore("sessions").put(session);
    }
    for (const exercise of customExercises || []) {
      if (exercise && exercise.id) tx.objectStore("customExercises").put(exercise);
    }
    try {
      return await txDone(tx);
    } catch (err) {
      console.warn("[fitlog] replaceAll transaction failed, no data was changed:", err);
      throw err;
    }
  }

  /* 백업에는 저장소 네 곳이 전부 들어가야 합니다.
     예전에는 sessions 와 customExercises 만 담았습니다. 그래서 루틴 6개와
     1년치 몸무게를 쌓아 둔 사람이 폰을 바꾸며 백업으로 옮기면, 그 둘이
     통째로 사라졌습니다 — 그런데 화면에는 "파일을 저장했습니다" 라고만
     떴습니다. 로그인하지 않은 사람에게는 이 파일이 유일한 사본입니다. */
  async function exportAll() {
    const [sessions, customExercises, routines, metrics] = await Promise.all([
      getAllSessions(),
      getCustomExercises(),
      /* 루틴/몸무게 로드 실패로 세션 백업 전체가 막히면 안 되므로 빈 배열로
         넘어가되, 콘솔에는 남겨 "내보내기 완료" 파일에 왜 루틴이 0개인지
         나중에 추적할 수 있게 합니다. */
      getRoutines().catch((err) => { console.warn("[fitlog] exportAll: getRoutines failed, exporting 0 routines:", err); return []; }),
      getMetrics().catch((err) => { console.warn("[fitlog] exportAll: getMetrics failed, exporting 0 metrics:", err); return []; }),
    ]);
    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      sessions,
      customExercises,
      routines,
      metrics,
    };
  }

  /* 가져오기 전에 실제로 FITLOG 백업인지 확인합니다.
     예전 검사는 "sessions 라는 이름의 배열이 있는가" 뿐이었습니다. 그래서
     다른 앱의 내보내기 파일이나 빈 배열([])도 통과했고, replaceAll 이 기존
     기록을 전부 지운 뒤 쓸 만한 게 없어 그대로 끝났습니다 — 로그인하지 않은
     사람은 2년치를 그렇게 잃습니다. 게다가 date 가 숫자인 행이 하나만 있어도
     그 뒤로 앱이 아예 안 열렸습니다.

     그래서 각 행을 실제로 뜯어보고, 쓸 수 있는 것만 남깁니다. 남은 게 하나도
     없으면 아무것도 건드리지 않고 거절합니다. */
  function cleanSessions(rows) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || typeof r.date !== "string") continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) continue;
      out.push({
        ...r,
        exercises: Array.isArray(r.exercises) ? r.exercises.filter(e => e && typeof e === "object") : [],
        parts: Array.isArray(r.parts) ? r.parts.filter(x => typeof x === "string") : [],
      });
    }
    return out;
  }

  async function importAll(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("올바른 백업 파일이 아닙니다.");
    }
    const sessions = cleanSessions(payload.sessions);
    const customExercises = (Array.isArray(payload.customExercises) ? payload.customExercises : [])
      .filter(e => e && typeof e.id === "string" && e.id);
    if (!sessions.length && !customExercises.length) {
      throw new Error("이 파일에는 불러올 기록이 없습니다.");
    }
    await replaceAll(sessions, customExercises);

    /* 루틴과 몸무게는 버전 2 백업부터 들어 있습니다. 옛 백업에는 없으므로,
       없으면 지우지 않고 그냥 둡니다 — 없는 걸 가져왔다고 있던 걸 지우면
       안 됩니다.
       개별 put() 이 하나 실패해도(예: 저장 공간 부족) 나머지 항목은 계속
       시도하고, 실제로 몇 개가 들어갔는지와 실패 건수를 반환값에 남깁니다
       — 이전에는 실패가 조용히 삼켜져서 "가져오기 완료" 라고만 뜨고 정작
       루틴 절반이 안 들어간 걸 알 방법이 없었습니다. */
    let routinesOk = 0, routinesFailed = 0;
    if (Array.isArray(payload.routines)) {
      for (const r of payload.routines) {
        if (!(r && typeof r.id === "string" && r.id)) continue;
        try {
          await putRoutine(r);
          routinesOk++;
        } catch (err) {
          routinesFailed++;
          console.warn("[fitlog] importAll: failed to import routine", r.id, err);
        }
      }
    }
    let metricsOk = 0, metricsFailed = 0;
    if (Array.isArray(payload.metrics)) {
      for (const m of payload.metrics) {
        if (!(m && typeof m.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.date) && Number(m.weightKg) > 0)) continue;
        try {
          await putMetric({ date: m.date, weightKg: Number(m.weightKg) });
          metricsOk++;
        } catch (err) {
          metricsFailed++;
          console.warn("[fitlog] importAll: failed to import metric", m.date, err);
        }
      }
    }
    return {
      sessions: sessions.length,
      customExercises: customExercises.length,
      routines: routinesOk,
      routinesFailed,
      metrics: metricsOk,
      metricsFailed,
    };
  }

  /* 옮겨올 데이터를 '읽기만' 하는 용도입니다. 버전을 지정하면 그 DB 를
     업그레이드하려 들고, 이미 더 높은 버전이면 VersionError 로 실패합니다.
     읽으러 가서 남의 저장소 구조를 건드릴 이유가 없으므로 버전 없이 엽니다. */
  function openNamed(name) {
    return new Promise((resolve) => {
      const req = indexedDB.open(name);
      /* 실패해도 호출자에게는 여전히 null 을 돌려줍니다 — readLegacy/readGuest
         쪽에서 "옮겨올 게 없다" 와 "열지 못했다" 를 구분해 처리하지 않기
         때문입니다. 다만 콘솔에는 남겨서, 데이터가 안 옮겨졌을 때 저장 공간
         부족이나 다른 탭의 버전 충돌처럼 원인이 있었는지 나중에 확인할 수
         있게 합니다. */
      req.onerror = () => { console.warn(`[fitlog] openNamed(${name}) failed:`, req.error); resolve(null); };
      req.onblocked = () => { console.warn(`[fitlog] openNamed(${name}) blocked by another tab`); resolve(null); };
      req.onsuccess = () => resolve(req.result);
    });
  }

  async function readFromDb(db) {
    if (!db || !db.objectStoreNames.contains("sessions")) {
      return { sessions: [], customExercises: [] };
    }
    const tx = db.transaction(
      ["sessions", "customExercises"].filter((n) => db.objectStoreNames.contains(n)),
      "readonly"
    );
    const sessions = await requestToPromise(tx.objectStore("sessions").getAll());
    let customExercises = [];
    if (db.objectStoreNames.contains("customExercises")) {
      customExercises = await requestToPromise(tx.objectStore("customExercises").getAll());
    }
    return {
      sessions: sessions || [],
      customExercises: customExercises || [],
    };
  }

  async function readLegacy() {
    const db = await openNamed(LEGACY_NAME);
    if (!db) return { sessions: [], customExercises: [] };
    try {
      return await readFromDb(db);
    } finally {
      db.close();
    }
  }

  async function readGuest() {
    if (scope === "guest") {
      return {
        sessions: await getAllSessions(),
        customExercises: await getCustomExercises(),
      };
    }
    const db = await openNamed("fitlog-guest");
    if (!db) return { sessions: [], customExercises: [] };
    try {
      return await readFromDb(db);
    } finally {
      db.close();
    }
  }

  return {
    setScope,
    open,
    getAllSessions,
    getSession,
    putSession,
    deleteSession,
    getCustomExercises,
    putCustomExercise,
    deleteCustomExercise,
    getRoutines,
    putRoutine,
    putRoutines,
    deleteRoutine,
    getMetrics,
    putMetric,
    putMetrics,
    deleteMetric,
    replaceAll,
    exportAll,
    importAll,
    readLegacy,
    readGuest,
  };
})();
