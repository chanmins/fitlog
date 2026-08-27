/* FITLOG Firebase config
   Fill this in from Firebase Console → Project settings → Your apps → SDK setup.
   The web apiKey is expected to be public; access is limited by Auth domain + Firestore rules. */
const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

function isFirebaseConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}
