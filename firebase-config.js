/* ── authDomain and redirect_uri_mismatch ──────────────────────────────────
   authDomain decides the OAuth redirect URI Firebase sends to Google:
       https://<authDomain>/__/auth/handler
   Google rejects any redirect URI that is not registered on the OAuth client
   with "400: redirect_uri_mismatch" — and the client Firebase auto-creates
   registers ONLY the firebaseapp.com handler:
       https://fitlog-4fe54.firebaseapp.com/__/auth/handler   ← registered
       https://fitlog-4fe54.web.app/__/auth/handler           ← NOT registered

   So pointing authDomain at the page's own origin (web.app) — which looks like
   the tidier, same-site choice — is exactly what broke Google sign-in. Keep it
   on firebaseapp.com: the popup opens that handler cross-origin and posts the
   result back, which works fine and needs no console setup.

   Want the same-origin version back (marginally better for signInWithRedirect
   on Safari, where cross-site storage gets partitioned)? Then FIRST register
   the web.app handler, and only after that flip SAME_ORIGIN_AUTH to true:
     Google Cloud Console → APIs & Services → Credentials
       → OAuth 2.0 Client IDs → "Web client (auto created by Google Service)"
       → Authorized redirect URIs  += https://fitlog-4fe54.web.app/__/auth/handler
       → Authorized JavaScript origins += https://fitlog-4fe54.web.app
   Propagation can take a few minutes. */
const SAME_ORIGIN_AUTH = false;

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvDzUOnsZmTqST-pUJ0ZuXq6Eba_oVrWQ",
  authDomain: (function () {
    if (!SAME_ORIGIN_AUTH) return "fitlog-4fe54.firebaseapp.com";
    try {
      const h = location.hostname;
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
