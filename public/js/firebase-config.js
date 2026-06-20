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
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME.firebaseapp.com",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME.appspot.com",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};

// Quick check so the app shows a friendly message instead of failing silently
// when the config hasn't been filled in yet.
export const isConfigured = !Object.values(firebaseConfig).some((v) =>
  String(v).includes("REPLACE_ME")
);
