/* ── authDomain, redirect_uri_mismatch, and why iOS broke ──────────────────
   authDomain decides the OAuth redirect URI Firebase sends to Google:
       https://<authDomain>/__/auth/handler

   Pointing it at fitlog-4fe54.firebaseapp.com while the app itself is served
   from fitlog-4fe54.web.app makes the sign-in handler a THIRD-PARTY origin.
   Safari/WebKit — which every iOS browser is, Chrome for iOS included —
   partitions third-party storage, so the handler writes the auth result into a
   storage bucket the app can never read back. The redirect completes, Google is
   happy, and the app still shows the login screen. That is the "구글 로그인이
   안 된다" on iPhone: not a wrong password, not a blocked popup, just two
   origins that are no longer allowed to share state.

   Serving auth from the SAME origin as the app removes the third-party hop
   entirely, which is why this is now true.

   ⚠️ BEFORE DEPLOYING WITH true, register the web.app handler — Firebase only
   auto-registers the firebaseapp.com one, and Google rejects anything else with
   "400: redirect_uri_mismatch":
     Google Cloud Console → APIs & Services → Credentials
       → OAuth 2.0 Client IDs → "Web client (auto created by Google Service)"
       → Authorized redirect URIs      += https://fitlog-4fe54.web.app/__/auth/handler
       → Authorized JavaScript origins += https://fitlog-4fe54.web.app
   Propagation takes a few minutes. If Google sign-in starts failing with
   redirect_uri_mismatch, that registration is missing — flip this back to false
   to restore the old (desktop-only) behaviour while you sort it out. */
const SAME_ORIGIN_AUTH = true;

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvDzUOnsZmTqST-pUJ0ZuXq6Eba_oVrWQ",
  authDomain: (function () {
    if (!SAME_ORIGIN_AUTH) return "fitlog-4fe54.firebaseapp.com";
    try {
      const h = location.hostname;
      /* Only these two are Firebase Hosting origins that actually serve their
         own /__/auth/handler. Anywhere else (localhost, a file:// page, a
         preview channel) has no handler, so fall back to the canonical domain
         rather than pointing auth at a 404. */
      if (h === "fitlog-4fe54.web.app" || h === "fitlog-4fe54.firebaseapp.com") return h;
    } catch (_) {}
    return "fitlog-4fe54.firebaseapp.com";
  })(),
  projectId: "fitlog-4fe54",
  storageBucket: "fitlog-4fe54.firebasestorage.app",
  messagingSenderId: "257610683834",
  appId: "1:257610683834:web:30d51394eb5123b592f983",
};

function isFirebaseConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}

/* App Check (anti-abuse) — OFF until you fill this in, on purpose.
   Without it, anyone can point a script straight at your Firestore/Auth
   endpoints using this same public API key and burn through your quota.
   To turn it on:
     1. https://www.google.com/recaptcha/admin/create → register a reCAPTCHA v3
        site for this exact domain (fitlog-4fe54.web.app, + any custom domain).
     2. Firebase 콘솔 → Build → App Check → 앱 등록 → 이 웹 앱 선택 → provider
        "reCAPTCHA v3" → 방금 만든 site key 입력.
     3. Paste that site key below.
     4. Only once you've confirmed login/sync still work with a real key:
        App Check → Firestore / Authentication → "Enforce" 로 전환.
        (Leave it un-enforced while testing — enforcing with a bad/missing
        key locks out every real user too.) */
const RECAPTCHA_V3_SITE_KEY = "";
