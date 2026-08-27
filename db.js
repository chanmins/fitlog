const WorkoutDB = (() => {
  const DB_NAME = "workout-log";
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "date" });
        }
        if (!db.objectStoreNames.contains("customExercises")) {
          db.createObjectStore("customExercises", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function requestToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteSession(date) {
    const db = await open();
    const tx = db.transaction("sessions", "readwrite");
    tx.objectStore("sessions").delete(date);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteCustomExercise(id) {
    const db = await open();
    const tx = db.transaction("customExercises", "readwrite");
    tx.objectStore("customExercises").delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
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
    const db = await open();
    const tx = db.transaction(["sessions", "customExercises"], "readwrite");
    tx.objectStore("sessions").clear();
    tx.objectStore("customExercises").clear();
    for (const session of payload.sessions) {
      if (session && session.date) tx.objectStore("sessions").put(session);
    }
    for (const exercise of payload.customExercises || []) {
      if (exercise && exercise.id) tx.objectStore("customExercises").put(exercise);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    open,
    getAllSessions,
    getSession,
    putSession,
    deleteSession,
    getCustomExercises,
    putCustomExercise,
    deleteCustomExercise,
    exportAll,
    importAll,
  };
})();
