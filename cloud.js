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

  /* No-op until firebase-config.js has a real RECAPTCHA_V3_SITE_KEY — see the
     comment there. Wrapped defensively: App Check is an anti-abuse layer, not
     something that should ever be able to take the app down if it's missing,
     misconfigured, or the compat script failed to load. */
  function activateAppCheck() {
    try {
      const key = typeof RECAPTCHA_V3_SITE_KEY !== "undefined" ? RECAPTCHA_V3_SITE_KEY : "";
      if (!key || typeof firebase.appCheck !== "function") return;
      firebase.appCheck().activate(key, true);
    } catch (_) {}
  }

  function init() {
    if (!configured()) {
      authResolved = true;
      authWaiters.splice(0).forEach((fn) => fn(null));
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    activateAppCheck();
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
    let host = "";
    try { host = location.hostname; } catch (_) {}
    const map = {
      "auth/invalid-email": "이메일 형식이 올바르지 않습니다.",
      "auth/user-not-found": "가입되지 않은 이메일입니다.",
      /* The single most confusing failure in this app: the account exists but
         has no password because it was created via Google. Say so, instead of
         letting the user retype a password that was never set. */
      "auth/invalid-credential": "비밀번호가 맞지 않습니다. 구글로 가입한 계정이라면 'Google로 계속하기'로 로그인하거나, 아래 '비밀번호 찾기'로 비밀번호를 새로 설정해 주세요.",
      "auth/wrong-password": "비밀번호가 맞지 않습니다. 구글로 가입한 계정이라면 'Google로 계속하기'로 로그인하거나, 아래 '비밀번호 찾기'로 비밀번호를 새로 설정해 주세요.",
      "auth/account-exists-with-different-credential": "이미 다른 로그인 방법으로 가입된 이메일입니다. 기존 방법으로 로그인해 주세요.",
      "auth/missing-email": "이메일을 입력해 주세요.",
      "auth/email-already-in-use": "이미 가입된 이메일입니다.",
      "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
      "auth/popup-closed-by-user": "로그인 창이 닫혔습니다.",
      "auth/cancelled-popup-request": "로그인이 취소되었습니다.",
      "auth/network-request-failed": "네트워크 오류입니다. 연결을 확인해 주세요.",
      "auth/too-many-requests": "시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      "auth/operation-not-allowed": "Firebase에서 이 로그인 방법이 꺼져 있습니다. Firebase 콘솔 → Authentication → Sign-in method 에서 Google을 켜 주세요.",
      /* Firebase only auto-authorizes localhost + the project's *.web.app / *.firebaseapp.com
         domains. Any other origin (GitHub Pages, a custom domain, etc.) must be added by hand
         under Authentication → Settings → Authorized domains — show the exact host so the
         fix is a copy-paste, not a guess, however many domains this app ends up deployed to. */
      "auth/unauthorized-domain": `이 도메인(${host || "현재 주소"})이 Firebase 승인 목록에 없습니다. Firebase 콘솔 → Authentication → Settings → Authorized domains 에서 "${host || "이 도메인"}"을 추가해 주세요.`,
      "auth/popup-blocked": "팝업이 차단됐습니다. 브라우저 설정에서 팝업을 허용해 주세요.",
    };
    return map[code] || (err && err.message) || "로그인에 실패했습니다.";
  }

  function googleProvider() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  async function signInGoogle() {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    const provider = googleProvider();
    /* Popup first: same-origin hosting keeps the result in this tab.
       Redirect is the fallback when the browser blocks the popup (iOS PWA, in-app browsers).
       The caller must invoke this directly from the click handler — no render() beforehand. */
    try {
      const cred = await auth.signInWithPopup(provider);
      return cred && cred.user ? profile(cred.user) : null;
    } catch (err) {
      const code = err && err.code ? err.code : "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        try { sessionStorage.setItem("fitlog-auth-pending", "1"); } catch (_) {}
        await auth.signInWithRedirect(provider);
        return null;
      }
      throw err;
    }
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

  /* Doubles as "set a password on an account that has none".
     An account created through Google Sign-In exists in Auth with the
     google.com provider only — signing up again says email-already-in-use,
     while signing in with a password fails, because there is no password to
     match. Firebase's reset flow attaches a password credential to that same
     account, so afterwards BOTH Google and email/password sign-in work. */
  async function sendPasswordReset(email) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    const addr = String(email || "").trim();
    if (!addr) throw new Error("이메일을 입력해 주세요.");
    await auth.sendPasswordResetEmail(addr);
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

  /* ── Account & data deletion ──────────────── */
  /* Firestore has no "delete this collection" call — every doc has to go one
     by one, batched. Batches cap at 500 writes; 400 leaves headroom. */
  async function deleteAllDocs(colName) {
    const col = userCol(colName);
    if (!col) return;
    const snap = await col.get();
    const docs = snap.docs.slice();
    while (docs.length) {
      const chunk = docs.splice(0, 400);
      const batch = store.batch();
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  /* Deletes Firestore data FIRST while still authenticated (security rules
     require request.auth.uid === userId), then the Auth account itself.
     If Firebase demands a fresh login (auth/requires-recent-login — common
     when the session is more than a few minutes old), the Firestore wipe has
     already happened; the caller should reauthenticate() and call this again
     to finish deleting the Auth account. Re-running is safe either way since
     deleting an already-empty collection is a no-op. */
  async function deleteAccountAndData() {
    const u = auth && auth.currentUser;
    if (!u) throw new Error("로그인 상태가 아닙니다.");
    await deleteAllDocs("sessions");
    await deleteAllDocs("customExercises");
    if (store) { try { await store.collection("users").doc(u.uid).delete(); } catch (_) {} }
    await u.delete();
  }

  /* Re-proves identity right before a sensitive op (here: account deletion)
     so a stale session doesn't hard-block the user with no way forward. */
  async function reauthenticate() {
    const u = auth && auth.currentUser;
    if (!u) throw new Error("로그인 상태가 아닙니다.");
    const providerId = (u.providerData[0] || {}).providerId;
    if (providerId === "google.com") {
      await u.reauthenticateWithPopup(googleProvider());
      return;
    }
    const password = prompt("본인 확인을 위해 비밀번호를 다시 입력해 주세요.");
    if (!password) throw new Error("취소되었습니다.");
    const cred = firebase.auth.EmailAuthProvider.credential(u.email, password);
    await u.reauthenticateWithCredential(cred);
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
    sendPasswordReset,
    signOut,
    touchProfile,
    saveSession,
    deleteSession,
    saveCustom,
    deleteCustom,
    pullAll,
    pushAll,
    deleteAccountAndData,
    reauthenticate,
  };
})();
