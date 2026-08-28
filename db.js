const WorkoutDB = (() => {
  const LEGACY_NAME = "workout-log";
  const DB_VERSION = 1;
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

  function open() {
    if (dbPromise) return dbPromise;
    const p = (async () => {
      let db = await openAt(dbName(), DB_VERSION);
      /* A database can sit at the right version and still be missing its
         stores — an upgrade interrupted by a closed tab, an evicted private
         session, or a scope switch mid-open leaves exactly that. Every
         transaction then throws "object stores was not found", which is what
         made 로그아웃 fail halfway: the screen stayed on the app while the
         sign-out below it never ran. Reopening one version higher re-runs
         onupgradeneeded and repairs the database in place. */
      if (!db.objectStoreNames.contains("sessions") ||
          !db.objectStoreNames.contains("customExercises")) {
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

  function openNamed(name) {
    return new Promise((resolve) => {
      const req = indexedDB.open(name, DB_VERSION);
      req.onerror = () => resolve(null);
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
    replaceAll,
    exportAll,
    importAll,
    readLegacy,
    readGuest,
  };
})();
