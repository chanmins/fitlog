const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBvDzUOnsZmTqST-pUJ0ZuXq6Eba_oVrWQ",
  authDomain: "fitlog-4fe54.firebaseapp.com",
  projectId: "fitlog-4fe54",
  storageBucket: "fitlog-4fe54.firebasestorage.app",
  messagingSenderId: "257610683834",
  appId: "1:257610683834:web:30d51394eb5123b592f983",
};

function isFirebaseConfigured() {
  return !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.projectId);
}
