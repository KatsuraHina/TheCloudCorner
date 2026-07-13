// ─────────────────────────────────────────────────────────────────────────────
//  Firebase project configuration
// ─────────────────────────────────────────────────────────────────────────────
//  Replace the placeholder values below with the config from YOUR Firebase
//  project. To find them:
//    1. Go to https://console.firebase.google.com → create / open your project
//    2. Project settings (gear icon) → "Your apps" → Web app (</>) → Register
//    3. Copy the `firebaseConfig` object it shows you and paste the values here
//
//  NOTE: It is safe to commit these values. A web "apiKey" is a public project
//  identifier, NOT a secret — real security is enforced by Firestore rules
//  (see firestore.rules), which only let a signed-in user touch their own data.
// ─────────────────────────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey: "AIzaSyCF2zYfohgia1MyinbdVmXTPa9RuSuWvlg",
  authDomain: "thecloudcorner-b9c9c.firebaseapp.com",
  projectId: "thecloudcorner-b9c9c",
  storageBucket: "thecloudcorner-b9c9c.firebasestorage.app",
  messagingSenderId: "774870607136",
  appId: "1:774870607136:web:98031b91e6fe5c4dd02345",
  measurementId: "G-K2E5H08PMV",
};

// Quick check so the app shows a friendly message instead of failing silently
// when the config hasn't been filled in yet.
export const isConfigured = !Object.values(firebaseConfig).some((v) =>
  String(v).includes("REPLACE_ME")
);

// ── Web Push (reminders) ──────────────────────────────────────────────────────
//  Needed only for the "unfinished to-dos" push notifications. Get it from:
//  Firebase console → Project settings → Cloud Messaging → "Web Push
//  certificates" → Generate key pair → copy the key string here.
//  It is a PUBLIC key (safe to commit), like the apiKey above.
export const vapidKey = "REPLACE_WITH_VAPID_KEY";
export const pushConfigured = !vapidKey.includes("REPLACE_WITH");
