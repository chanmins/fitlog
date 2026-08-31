/* FITLOG — Firebase Auth + Firestore sync */
const Cloud = (() => {
  let auth = null;
  let store = null;
  let currentUser = null;
  let authResolved = false;
  let persistenceReady = Promise.resolve();
  const authWaiters = [];
  const listeners = [];

  /* Popups are the wrong default on phones.
     signInWithPopup opens a second window and waits for it to post a result
     back. On mobile that window is a browser-managed tab, and anything from a
     tab-limit to an app switch to the OS reclaiming memory closes it — which
     surfaces as auth/popup-closed-by-user even though the user never cancelled.
     Installed PWAs are worse: iOS standalone mode has no window to open, and
     in-app browsers (KakaoTalk, Instagram, Naver…) block window.open outright.
     Redirect has none of these problems, so phones get redirect from the start
     rather than after a failed popup. */
  function prefersRedirect() {
    try {
      const ua = navigator.userAgent || "";
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
      const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\/|NAVER|DaumApps|Snapchat|Twitter/i.test(ua);
      const standalone =
        (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        window.navigator.standalone === true;
      /* iPadOS 13+ reports a desktop UA; touch points give it away. */
      const iPadDesktopUA = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
      return mobile || inApp || standalone || iPadDesktopUA;
    } catch (_) {
      return false;
    }
  }

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

  /* Takes ownership of a user the moment a sign-in call hands one back.

     onAuthStateChanged is the only thing that used to set currentUser, and it
     does NOT fire before signInWithPopup / getRedirectResult / createUser
     resolve — it lands a moment later. Everything below that reaches Firestore
     (loadProfile, saveProfile, claimUsername, userCol) reads currentUser, so in
     that gap they all behaved as though nobody was signed in: reads returned
     null, writes silently went nowhere. That gap is what made Google sign-in ask
     for an 아이디 on every single login — the profile read came back empty, so
     the app concluded the account was brand new, and the 아이디 the user then
     typed was written for a user Firestore did not think existed.

     Adopting the credential here closes the gap. The real listener still fires
     afterwards and calls notify() as usual; this only means currentUser is
     never behind the call that just succeeded. */
  function adopt(u) {
    if (u) currentUser = u;
    return u;
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
    } catch (err) {
      /* 키가 설정된 뒤에도 activate() 가 조용히 실패하면 App Check 가 꺼진
         채로 앱이 정상 동작해 버려서 아무도 눈치채지 못합니다. 사이트 키
         자체가 없을 때(위 return)는 의도된 상태이므로 로깅하지 않습니다. */
      console.warn("[fitlog] App Check activate() failed:", err);
    }
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

    /* Keep the session across app restarts. LOCAL is Firebase's default, but
       it silently degrades to in-memory when IndexedDB is unavailable — which
       is exactly what happens in an installed PWA on iOS after the OS evicts
       storage, and is why "already logged in" users kept landing back on the
       login screen. Requesting it explicitly also lets a failure surface in the
       console instead of looking like a random logout. Sign-in calls await this
       so persistence is settled before a credential is created. */
    persistenceReady = auth
      .setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .catch((err) => { console.warn("auth persistence fell back to session", err); });

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
      /* Raised by signInEmail once it has confirmed with Firebase that this
         address has no password credential — see the comment there. */
      "fitlog/google-only": "이 이메일은 Google 계정으로 가입되어 있어서 비밀번호가 없습니다. 위의 'Google로 계속하기'로 로그인해 주세요. 비밀번호로도 쓰고 싶다면 아래 '비밀번호 찾기 / 새로 설정'을 눌러 새로 만들면 두 방법 모두 사용할 수 있습니다.",
      "fitlog/other-provider": "이 이메일은 다른 로그인 방법으로 가입되어 있습니다. 처음 가입할 때 사용한 방법으로 로그인해 주세요.",
      "fitlog/no-username": "존재하지 않는 아이디입니다. 다시 확인해 주세요.",
      "fitlog/username-taken": "이미 사용 중인 아이디입니다. 다른 아이디를 골라 주세요.",
      "fitlog/bad-username": "아이디 형식이 올바르지 않습니다.",
      "fitlog/auth-not-ready": "로그인 확인이 아직 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.",
      "fitlog/not-ready": "연결 준비 중입니다. 잠시 후 다시 시도해 주세요.",
      "fitlog/claim-unverified": "저장은 되었지만 서버에서 확인되지 않았습니다. 네트워크를 확인하고 다시 시도해 주세요.",
      "fitlog/username-locked": "이 계정에는 이미 아이디가 있습니다. 아이디는 바꿀 수 없습니다.",
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

  /* forceChooser: show Google's account picker even when the browser already
     has exactly one signed-in Google account.
     Off for normal sign-in — prompt:"select_account" makes Google re-ask every
     single time, which reads as "it forgot me again" when the whole point of
     tapping the button is to get back in. Google still shows the picker on its
     own when there are several accounts to choose between.
     On for reauthenticate(), where the user is confirming identity before a
     destructive action and an implicit silent match would defeat the purpose. */
  function googleProvider(forceChooser) {
    const provider = new firebase.auth.GoogleAuthProvider();
    if (forceChooser) provider.setCustomParameters({ prompt: "select_account" });
    return provider;
  }

  /* Returns a profile when sign-in completed in this tab (desktop popup), or
     null when the browser is navigating away to Google — in which case the
     result is picked up by completeRedirect() on the way back.
     The caller must invoke this straight from the click handler: re-rendering
     first drops the user-activation token and the popup gets blocked. */
  async function signInGoogle() {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    await persistenceReady;
    const provider = googleProvider();

    if (prefersRedirect()) {
      try { sessionStorage.setItem("fitlog-auth-pending", "1"); } catch (_) {}
      await auth.signInWithRedirect(provider);
      return null;
    }

    try {
      const cred = await auth.signInWithPopup(provider);
      return cred && cred.user ? profile(adopt(cred.user)) : null;
    } catch (err) {
      const code = err && err.code ? err.code : "";
      /* Desktop popup failures that are environmental rather than a real
         cancellation still deserve the redirect fallback. popup-closed-by-user
         is deliberately NOT in this list: on desktop that genuinely means the
         user shut the window, and bouncing them to Google anyway would ignore
         an explicit "no". */
      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/operation-not-supported-in-this-environment" ||
        code === "auth/web-storage-unsupported"
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
    return cred && cred.user ? profile(adopt(cred.user)) : null;
  }

  async function signInEmail(email, password) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    await persistenceReady;
    const addr = String(email || "").trim();
    try {
      const cred = await auth.signInWithEmailAndPassword(addr, password);
      return profile(adopt(cred.user));
    } catch (err) {
      const code = err && err.code ? err.code : "";
      /* "비밀번호가 맞지 않습니다" is a lie when the account has no password at
         all. An account created through Google Sign-In exists in Auth with only
         the google.com provider, so every password is wrong and retyping can
         never succeed. Ask Firebase which providers the address actually has
         and say the specific thing.
         fetchSignInMethodsForEmail returns [] when the project has email
         enumeration protection on, so an empty answer means "can't tell" — fall
         through to the generic message rather than guessing. */
      if (code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/user-not-found") {
        let methods = [];
        try { methods = await auth.fetchSignInMethodsForEmail(addr); } catch (_) {}
        if (methods.length && methods.indexOf("password") === -1) {
          const e = new Error("google-only account");
          e.code = methods.indexOf("google.com") !== -1 ? "fitlog/google-only" : "fitlog/other-provider";
          throw e;
        }
      }
      throw err;
    }
  }

  /* ── Username accounts ────────────────────────────────────────────────────
     Firebase Auth signs in with an email, full stop — there is no username
     provider. Two ways to fake one:

       (a) synthesise an address from the name (chanmin@fitlog.invalid) and use
           it as the auth identity. Login needs no lookup and uniqueness comes
           free from Auth itself — but the address is undeliverable, so
           "비밀번호 찾기" can never send anything and a forgotten password
           means a dead account.

       (b) keep the user's REAL email as the auth identity and treat 아이디 as a
           lookup key: 아이디 → email → signInWithEmailAndPassword.

     (b) is what runs here, because the user asked for recovery to work and
     Firebase's reset mail only goes to the account's own address. The cost is
     one public document per name (see firestore.rules for why `get` is open and
     `list` is not). */
  const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,19}$/;

  /* Case- and width-insensitive so "ChanMin" and "chanmin" can't both exist —
     usernames people type from memory should not depend on shift keys. */
  function normalizeUsername(raw) {
    return String(raw || "").normalize("NFKC").trim().toLowerCase();
  }

  function usernameError(id) {
    if (!id) return "아이디를 입력해 주세요.";
    if (id.length < 3) return "아이디는 3자 이상이어야 합니다.";
    if (id.length > 20) return "아이디는 20자 이하여야 합니다.";
    if (!/^[a-z0-9_.]+$/.test(id)) return "아이디는 영문 소문자, 숫자, _ . 만 쓸 수 있습니다.";
    if (!USERNAME_RE.test(id)) return "아이디는 영문 소문자나 숫자로 시작해야 합니다.";
    return "";
  }

  /* Single-document get — the only read the rules allow before sign-in. */
  async function lookupUsername(rawId) {
    const id = normalizeUsername(rawId);
    if (!store || !id) return null;
    const snap = await store.collection("usernames").doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async function isUsernameFree(rawId) {
    return !(await lookupUsername(rawId));
  }

  /* Who holds this 아이디 — the uid, or null if nobody does. */
  async function usernameOwner(rawId) {
    const rec = await lookupUsername(rawId);
    return rec && rec.uid ? rec.uid : null;
  }

  /* "Free, or already mine."

     Claiming a name writes to two places: usernames/{id} reserves it, and
     users/{uid}.username is what the app actually reads back. If the first
     write lands and the second does not — a dropped connection, a backgrounded
     tab, a phone switching from wifi to cellular mid-tap — the account ends up
     owning a name that the app cannot see. It then asks for an 아이디 again,
     refuses the user's own name as "이미 사용 중", and there is no way out
     except inventing a new name, which can strand another one the same way.

     Treating a name you already own as available is what breaks that loop. */
  async function isUsernameAvailableFor(rawId, forUid) {
    const owner = await usernameOwner(rawId);
    if (!owner) return true;
    return !!forUid && owner === forUid;
  }

  async function signInUsername(rawId, password) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    await persistenceReady;
    const id = normalizeUsername(rawId);
    const rec = await lookupUsername(id);
    if (!rec || !rec.email) {
      const e = new Error("no such username");
      e.code = "fitlog/no-username";
      throw e;
    }
    return signInEmail(rec.email, password);
  }

  /* Creates the Auth account, then claims the name.
     The claim has to come second — the rules require request.auth, which does
     not exist until the account does. That leaves a window where the account
     exists but the name is taken by someone who got there first, so a failed
     claim deletes the account it just made rather than leaving a signed-in user
     with no 아이디 and no way to pick one. */
  async function signUpUsername({ username, password, email, profile: prof }) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    await persistenceReady;
    const id = normalizeUsername(username);
    const bad = usernameError(id);
    if (bad) { const e = new Error(bad); e.code = "fitlog/bad-username"; throw e; }

    if (!(await isUsernameFree(id))) {
      const e = new Error("taken");
      e.code = "fitlog/username-taken";
      throw e;
    }

    const cred = await auth.createUserWithEmailAndPassword(String(email || "").trim(), password);
    const u = adopt(cred.user);
    try {
      await store.collection("usernames").doc(id).set({
        uid: u.uid,
        email: String(email || "").trim(),
        createdAt: Date.now(),
      });
    } catch (err) {
      /* 계정을 되돌리는 이 delete() 자체가 실패하면, 사용자는 아이디도 못
         쓰고(예약 실패) 이메일로 재가입도 안 되는(계정은 살아있으므로)
         상태로 남습니다. 원래 에러(username-taken)를 던지는 건 맞지만,
         되돌리기 실패는 조용히 삼키지 않고 남겨서 나중에 "가입도 재가입도
         안 된다" 는 문의가 오면 원인을 바로 찾을 수 있게 합니다. */
      try { await u.delete(); } catch (rollbackErr) {
        console.warn("[fitlog] signUpUsername: failed to roll back auth account after reservation failure", rollbackErr);
      }
      const e = new Error("taken");
      e.code = "fitlog/username-taken";
      throw e;
    }

    const displayName = (prof && prof.name) ? String(prof.name).trim() : id;
    try { await u.updateProfile({ displayName }); } catch (err) {
      console.warn("[fitlog] signUpUsername: updateProfile(displayName) failed, continuing", err);
    }
    /* 이 쓰기가 실패하면 아이디 예약과 인증 계정만 남습니다. 그러면 사용자는
       같은 아이디로 다시 가입할 수 없고("이미 사용 중인 아이디입니다" — 자기
       이름인데), 같은 이메일로도 못 합니다("이미 가입된 이메일입니다").
       양쪽 문이 다 닫히므로, 위의 예약 실패와 똑같이 되돌립니다. */
    try {
      await store.collection("users").doc(u.uid).set({
        username: id,
        email: String(email || "").trim(),
        displayName,
        profile: sanitizeProfile(prof),
        createdAt: Date.now(),
      }, { merge: true });
    } catch (err) {
      /* 되돌리기 두 단계 중 하나라도 실패하면 아이디/계정이 고아 상태로
         남는다는 뜻이라, 로그가 없으면 발견할 방법이 없습니다. */
      try { await store.collection("usernames").doc(id).delete(); } catch (rollbackErr) {
        console.warn("[fitlog] signUpUsername: failed to release reserved username after profile write failure", id, rollbackErr);
      }
      try { await u.delete(); } catch (rollbackErr) {
        console.warn("[fitlog] signUpUsername: failed to roll back auth account after profile write failure", rollbackErr);
      }
      throw err;
    }

    return profile(auth.currentUser || u);
  }

  /* Claims a name for an account that already exists — the Google path, where
     Auth created the user before any 아이디 was chosen. Same create-only rule
     does the uniqueness work, so a lost race surfaces as a permission error
     that we translate rather than a silent overwrite. */
  async function claimUsername(rawId) {
    const u = currentUser;
    if (!store || !u) throw new Error("로그인 상태가 아닙니다.");
    const id = normalizeUsername(rawId);
    const bad = usernameError(id);
    if (bad) { const e = new Error(bad); e.code = "fitlog/bad-username"; throw e; }

    const owner = await usernameOwner(id);
    if (owner && owner !== u.uid) {
      const e = new Error("taken"); e.code = "fitlog/username-taken"; throw e;
    }

    /* An 아이디 is claimed once and never changed.

       The screen says so, and sign-in depends on it: usernames/{id} points at
       a uid, and nothing ever removes that pointer, so letting an account take
       a second name does not rename it — it leaves the first name stranded,
       still resolving to this account, while the profile answers to the new
       one. That is how signing in on a second browser and being asked to set up
       again turned one account into two identities.

       Refusing on a failed read is deliberate. Claiming is irreversible, so
       "I could not check" has to mean stop, not proceed. */
    let held = null;
    try {
      const existing = await loadProfile(u.uid);
      held = existing && existing.username ? existing.username : null;
    } catch (err) {
      const e = new Error("could not verify current username");
      e.code = "fitlog/claim-unverified";
      throw e;
    }
    if (held && held !== id) {
      /* A name this account already reserved is still fair game — that is how
         an earlier name is restored, and how a half-written claim is repaired.
         Anything else would be minting a second identity. */
      if (owner !== u.uid) {
        const e = new Error("username already set");
        e.code = "fitlog/username-locked";
        e.held = held;
        throw e;
      }
    }

    /* Reserve the name only if it is not already reserved by us. Re-writing our
       own reservation would be an update, and the rules forbid updates outright
       (a name must never be re-pointed at a different account), so a repeat
       claim has to skip this step rather than fail on it. */
    if (!owner) {
      try {
        await store.collection("usernames").doc(id).set({
          uid: u.uid, email: u.email || "", createdAt: Date.now(),
        });
      } catch (_) {
        /* Lost a race: somebody created it between the read and the write. */
        const e = new Error("taken"); e.code = "fitlog/username-taken"; throw e;
      }
    }

    /* The field the app reads. Written every time, including on a repeat claim,
       because a missing value here is exactly the damage being repaired. */
    await store.collection("users").doc(u.uid).set({ username: id }, { merge: true });
    return id;
  }

  /* Resolves 아이디 (or an email) to the address a reset link would go to,
     WITHOUT sending anything. Lets the UI show the user where the mail is
     headed and ask for confirmation first, instead of firing on one tap. */
  async function resolveResetTarget(idOrEmail) {
    const raw = String(idOrEmail || "").trim();
    if (!raw) throw new Error("아이디 또는 이메일을 입력해 주세요.");
    if (raw.includes("@")) return raw;
    const rec = await lookupUsername(raw);
    if (!rec || !rec.email) {
      const e = new Error("no such username");
      e.code = "fitlog/no-username";
      throw e;
    }
    return rec.email;
  }

  /* Accepts 아이디 or an email — people rarely remember which one they used.
     Returns the address it sent to so the caller can confirm it on screen. */
  async function sendPasswordResetFor(idOrEmail) {
    if (!auth) throw new Error("Firebase가 설정되지 않았습니다.");
    const addr = await resolveResetTarget(idOrEmail);
    await sendPasswordReset(addr);
    return addr;
  }

  /* ── Profile ─────────────────────────────────────────────────────────────
     Stored on the user document rather than in Auth: Auth only carries a
     displayName and a photo, and height/weight/birth year are app data that
     belongs next to the workouts they explain. Every field is optional — the
     signup flow lets people skip the whole step. */
  const PROFILE_FIELDS = ["name", "gender", "birthYear", "heightCm", "weightKg", "username"];

  function sanitizeProfile(raw) {
    const src = raw || {};
    const out = {};
    if (src.name != null && String(src.name).trim()) out.name = String(src.name).trim().slice(0, 40);
    if (src.gender === "male" || src.gender === "female") out.gender = src.gender;
    const yr = Number(src.birthYear);
    const thisYear = new Date().getFullYear();
    if (Number.isFinite(yr) && yr >= 1900 && yr <= thisYear) out.birthYear = Math.round(yr);
    const h = Number(src.heightCm);
    if (Number.isFinite(h) && h > 60 && h < 260) out.heightCm = Math.round(h * 10) / 10;
    const w = Number(src.weightKg);
    if (Number.isFinite(w) && w > 20 && w < 400) out.weightKg = Math.round(w * 10) / 10;
    return out;
  }

  /* Throws rather than returning null when there is nobody to save for.
     Returning null made "nothing was written" look identical to "written
     successfully, nothing to report", so a save that silently went nowhere
     still ended with a 저장했습니다 toast. */
  /* 루틴은 개수가 적고 문서 하나에 다 들어가므로 users/{uid} 안에 둡니다.
     세션처럼 하위 컬렉션을 따로 둘 만큼 크지 않습니다. */
  async function saveRoutines(routines) {
    const u = currentUser;
    if (!store || !u) return;
    const clean = (routines || []).slice(0, 50).map(r => ({
      id: String(r.id || ""),
      name: String(r.name || "").slice(0, 40),
      parts: Array.isArray(r.parts) ? r.parts.slice(0, 12).map(String) : [],
      exercises: Array.isArray(r.exercises) ? r.exercises.slice(0, 60).map(e => ({
        id: String(e.id || ""), part: String(e.part || ""), name: String(e.name || "").slice(0, 60),
      })) : [],
      usedAt: Number(r.usedAt) || 0,
    })).filter(r => r.id && r.name);
    await store.collection("users").doc(u.uid).set({ routines: clean }, { merge: true });
  }

  /* 몸무게 기록도 문서 하나에 들어갈 만큼 작습니다. 하루 한 줄, 2년이면
     700줄 남짓이라 넉넉합니다. */
  async function saveMetrics(rows) {
    const u = currentUser;
    if (!store || !u) return;
    const clean = (rows || []).slice(-1000).map(r => ({
      date: String(r.date || "").slice(0, 10),
      weightKg: Number(r.weightKg) || 0,
    })).filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.weightKg > 0);
    await store.collection("users").doc(u.uid).set({ metrics: clean }, { merge: true });
  }

  async function saveProfile(prof) {
    const u = currentUser;
    if (!store || !u) {
      const e = new Error("인증이 아직 준비되지 않았습니다.");
      e.code = "fitlog/auth-not-ready";
      throw e;
    }
    const clean = sanitizeProfile(prof);
    const patch = { profile: clean, updatedAt: Date.now() };
    if (clean.name) patch.displayName = clean.name;
    await store.collection("users").doc(u.uid).set(patch, { merge: true });
    if (clean.name) {
      try { await u.updateProfile({ displayName: clean.name }); } catch (err) {
        /* Firestore 쪽(patch)은 이미 저장됐으니 실패해도 앱 데이터는
           멀쩡합니다 — Auth 쪽 표시 이름만 구버전으로 남는 사소한 불일치라
           throw 하지는 않지만, 왜 화면 이름이 안 바뀌었는지 추적할 수 있게
           남깁니다. */
        console.warn("[fitlog] saveProfile: auth updateProfile(displayName) failed", err);
      }
    }
    return clean;
  }

  /* Returns null ONLY when the document genuinely does not exist. "I could not
     tell" is a thrown error, never null — the caller shows the 아이디 gate on
     null, so the two must not be able to look the same. Takes the uid to read
     rather than assuming currentUser, so a caller that already holds a user
     cannot be answered about a different one. */
  async function loadProfile(forUid) {
    if (!store) {
      const e = new Error("Firestore가 아직 준비되지 않았습니다.");
      e.code = "fitlog/not-ready";
      throw e;
    }
    const id = forUid || uid();
    if (!id) {
      const e = new Error("인증이 아직 준비되지 않았습니다.");
      e.code = "fitlog/auth-not-ready";
      throw e;
    }
    const snap = await store.collection("users").doc(id).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    return { ...sanitizeProfile(data.profile), username: data.username || "" };
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

  /* 루틴과 몸무게는 users/{uid} 문서 한 곳에 들어 있으므로 여기서 같이 읽습니다.
     둘을 따로 읽는 함수를 두면 같은 문서를 두 번 읽게 되어 무료 요금제의
     하루 읽기 수를 이유 없이 두 배로 씁니다 — 그래서 이 한 곳에서만 읽습니다. */
  async function pullAll() {
    const sessionsCol = userCol("sessions");
    const customCol = userCol("customExercises");
    if (!sessionsCol) return { sessions: [], customExercises: [], routines: [], metrics: [] };
    const id = uid();
    const [sessSnap, customSnap, userSnap] = await Promise.all([
      sessionsCol.get(),
      customCol.get(),
      store.collection("users").doc(id).get(),
    ]);
    const userDoc = userSnap.exists ? (userSnap.data() || {}) : {};
    return {
      sessions: sessSnap.docs.map((d) => d.data()).filter((s) => s && s.date),
      customExercises: customSnap.docs.map((d) => d.data()).filter((e) => e && e.id),
      routines: Array.isArray(userDoc.routines) ? userDoc.routines : [],
      metrics: Array.isArray(userDoc.metrics) ? userDoc.metrics : [],
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
    /* Release the 아이디 before the user document that records it — once
       users/{uid} is gone there is nothing left to say which name to free, and
       the rules only let the owner delete it, so a leftover doc would reserve
       that name forever with no way to reclaim it. */
    if (store) {
      /* 아이디 예약을 푸는 데 실패했으면 여기서 멈춥니다.
         규칙상 usernames/{name} 은 그 주인만 지울 수 있는데, 주인의 계정이
         사라지면 아무도 못 지우고 아무도 다시 만들 수 없습니다 — 그 아이디는
         영원히 죽습니다(새로 가입하려는 사람에겐 "이미 사용 중"). 예전에는
         이 실패를 통째로 삼키고 계정 삭제로 넘어갔습니다. 요청 하나만
         떨어져도 그렇게 됩니다. 실패하면 되돌릴 수 있는 상태로 두고 알립니다. */
      const snap = await store.collection("users").doc(u.uid).get();
      const name = snap.exists ? (snap.data() || {}).username : "";
      if (name) await store.collection("usernames").doc(name).delete();
      /* 아이디 예약은 이미 풀렸으니 계정 삭제를 막을 이유는 없지만, 이
         문서 삭제만 실패하면 users/{uid} 가 고아로 남습니다 — 로그를 남겨
         나중에 추적할 수 있게 합니다. */
      try { await store.collection("users").doc(u.uid).delete(); } catch (err) {
        console.warn("[fitlog] deleteAccountAndData: failed to delete users/" + u.uid + " doc", err);
      }
    }
    await u.delete();
  }

  /* Re-proves identity right before a sensitive op (here: account deletion)
     so a stale session doesn't hard-block the user with no way forward. */
  async function reauthenticate() {
    const u = auth && auth.currentUser;
    if (!u) throw new Error("로그인 상태가 아닙니다.");
    const providerId = (u.providerData[0] || {}).providerId;
    if (providerId === "google.com") {
      await u.reauthenticateWithPopup(googleProvider(true));
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
    signInUsername,
    signUpUsername,
    claimUsername,
    lookupUsername,
    isUsernameFree,
    usernameOwner,
    isUsernameAvailableFor,
    normalizeUsername,
    usernameError,
    sendPasswordReset,
    sendPasswordResetFor,
    resolveResetTarget,
    saveProfile,
    saveRoutines,
    saveMetrics,
    loadProfile,
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
