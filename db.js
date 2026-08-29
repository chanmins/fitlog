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

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllSessions() {
    const db = await open();
    const tx = db.transaction("sessions", "readonly");
    const rows = await requestToPromise(tx.objectStore("sessions").getAll());
    return (rows || []).sort((a, b) => b.date.localeCompare(a.date));
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
    return (rows || []).sort((a, b) => a.date.localeCompare(b.date));
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
    tx.objectStore("sessions").clear();
    tx.objectStore("customExercises").clear();
    for (const session of sessions || []) {
      if (session && session.date) tx.objectStore("sessions").put(session);
    }
    for (const exercise of customExercises || []) {
      if (exercise && exercise.id) tx.objectStore("customExercises").put(exercise);
    }
    return txDone(tx);
  }

  async function exportAll() {
    const [sessions, customExercises] = await Promise.all([
      getAllSessions(),
      getCustomExercises(),
    ]);
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      customExercises,
    };
  }

  async function importAll(payload) {
    if (!payload || !Array.isArray(payload.sessions)) {
      throw new Error("올바른 백업 파일이 아닙니다.");
    }
    await replaceAll(payload.sessions, payload.customExercises || []);
  }

  /* 옮겨올 데이터를 '읽기만' 하는 용도입니다. 버전을 지정하면 그 DB 를
     업그레이드하려 들고, 이미 더 높은 버전이면 VersionError 로 실패합니다.
     읽으러 가서 남의 저장소 구조를 건드릴 이유가 없으므로 버전 없이 엽니다. */
  function openNamed(name) {
    return new Promise((resolve) => {
      const req = indexedDB.open(name);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
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
    deleteRoutine,
    getMetrics,
    putMetric,
    deleteMetric,
    replaceAll,
    exportAll,
    importAll,
    readLegacy,
    readGuest,
  };
})();
