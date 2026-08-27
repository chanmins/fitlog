/* FITLOG — Firebase Auth + Firestore sync */
const Cloud = (() => {
  let auth = null;
  let store = null;
  let currentUser = null;
  let authResolved = false;
  const authWaiters = [];
  const listeners = [];

  function configured() {
    return typeof firebase !== "undefined" && typeof isFirebaseConfigured === "function" && isFirebaseConfigured();
  }

  function user() {
    return currentUser;
  }

  function uid() {
    return currentUser ? currentUser.uid : null;
  }

  function profile(u = currentUser) {
    if (!u) return null;
    return {
      uid: u.uid,
      email: u.email || "",
      displayName: u.displayName || (u.email ? u.email.split("@")[0] : "사용자"),
      photoURL: u.photoURL || "",
    };
  }

  function notify(next) {
    currentUser = next;
    listeners.slice().forEach((fn) => {
      try { fn(profile(next)); } catch (_) {}
    });
  }

  function init() {
    if (!configured()) {
      authResolved = true;
      authWaiters.splice(0).forEach((fn) => fn(null));
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    store = firebase.firestore();
    auth.useDeviceLanguage();
    auth.onAuthStateChanged((u) => {
      notify(u);
      if (!authResolved) {
        authResolved = true;
        authWaiters.splice(0).forEach((fn) => fn(profile(u)));
      }
    });
  }

  function waitAuth() {
    if (authResolved) return Promise.resolve(profile(currentUser));
    return new Promise((resolve) => authWaiters.push(resolve));
  }

  function onAuth(fn) {
    listeners.push(fn);
  }

  function authMessage(err) {
    const code = err && err.code ? err.code : "";
    const map = {
      "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
      "auth/user-not-found": "가입되지 않은 이메일입니다.",
      "auth/wrong-password": "비밀번호가 올바르지 않습니다.",
      "auth/invalid-credential": "이메일 또는 비밀번호가 올바르지 않습니다.",
      "auth/email-already-in-use": "이미 가입된 이메일입니다.",
      "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
      "auth/popup-closed-by-user": "로그인이 취소되었습니다.",
      "auth/cancelled-popup-request": "로그인이 취소되었습니다.",
      "auth/network-request-failed": "네트워크 오류입니다. 연결을 확인해 주세요.",
      "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      "auth/operation-not-allowed": "이 로그인 방법이 Firebase에서 아직 켜져 있지 않습니다.",
      "auth/unauthorized-domain": "이 도메인이 Firebase 승인 목록에 없습니다.",
    };
    return map[code] || (err && err.message) || "로그인에 실패했습니다.";
  }

  function googleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  function preferRedirect() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    return standalone || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  }

  async function signInGoogle() {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    if (preferRedirect()) {
      await auth.signInWithRedirect(googleProvider());
      return null;
    }
    const cred = await auth.signInWithPopup(googleProvider());
    return profile(cred.user);
  }

  async function completeRedirect() {
    if (!auth) return null;
    const cred = await auth.getRedirectResult();
    return cred && cred.user ? profile(cred.user) : null;
  }

  async function signInEmail(email, password) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    const cred = await auth.signInWithEmailAndPassword(String(email || "").trim(), password);
    return profile(cred.user);
  }

  async function signUpEmail(email, password) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    const cred = await auth.createUserWithEmailAndPassword(String(email || "").trim(), password);
    return profile(cred.user);
  }

  async function signOut() {
    if (!auth) return;
    await auth.signOut();
  }

  function userCol(name) {
    const id = uid();
    if (!store || !id) return null;
    return store.collection("users").doc(id).collection(name);
  }

  async function touchProfile() {
    const u = currentUser;
    if (!store || !u) return;
    await store.collection("users").doc(u.uid).set({
      email: u.email || "",
      displayName: u.displayName || "",
      photoURL: u.photoURL || "",
      lastLoginAt: Date.now(),
    }, { merge: true });
  }

  async function saveSession(session) {
    const col = userCol("sessions");
    if (!col || !session || !session.date) return;
    await col.doc(session.date).set(JSON.parse(JSON.stringify(session)));
  }

  async function deleteSession(date) {
    const col = userCol("sessions");
    if (!col || !date) return;
    await col.doc(date).delete();
  }

  async function saveCustom(exercise) {
    const col = userCol("customExercises");
    if (!col || !exercise || !exercise.id) return;
    await col.doc(exercise.id).set(JSON.parse(JSON.stringify(exercise)));
  }

  async function deleteCustom(id) {
    const col = userCol("customExercises");
    if (!col || !id) return;
    await col.doc(id).delete();
  }

  async function pullAll() {
    const sessionsCol = userCol("sessions");
    const customCol = userCol("customExercises");
    if (!sessionsCol) return { sessions: [], customExercises: [] };
    const [sessSnap, customSnap] = await Promise.all([sessionsCol.get(), customCol.get()]);
    return {
      sessions: sessSnap.docs.map((d) => d.data()).filter((s) => s && s.date),
      customExercises: customSnap.docs.map((d) => d.data()).filter((e) => e && e.id),
    };
  }

  async function pushAll(sessions, customExercises) {
    if (!uid() || !store) return;
    const writes = [];
    for (const session of sessions || []) writes.push(saveSession(session));
    for (const exercise of customExercises || []) writes.push(saveCustom(exercise));
    await Promise.all(writes);
  }

  return {
    configured,
    init,
    waitAuth,
    onAuth,
    user: () => profile(currentUser),
    uid,
    authMessage,
    signInGoogle,
    completeRedirect,
    signInEmail,
    signUpEmail,
    signOut,
    touchProfile,
    saveSession,
    deleteSession,
    saveCustom,
    deleteCustom,
    pullAll,
    pushAll,
  };
})();
