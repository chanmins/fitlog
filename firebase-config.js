const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvDzUOnsZmTqST-pUJ0ZuXq6Eba_oVrWQ",
  /* Match the page origin so Google redirect/popup storage is same-site.
     web.app and firebaseapp.com are different origins — a mismatched authDomain
     makes signInWithRedirect come back logged out. */
  authDomain: (function () {
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
