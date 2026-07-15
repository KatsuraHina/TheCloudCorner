// ─────────────────────────────────────────────────────────────────────────────
//  auth.js — sign in / sign up page logic (login.html)
// ─────────────────────────────────────────────────────────────────────────────
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isConfigured } from "./firebase-init.js";

const $ = (id) => document.getElementById(id);
const errorBox = $("auth-error");

// If config is still the placeholder, tell the user kindly.
if (!isConfigured) {
  showError(
    "Firebase isn't set up yet — add your project keys to js/firebase-config.js. See the README."
  );
}

// Already signed in? Skip the login page.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.replace("index.html");
});

// ── Tab toggle (sign in vs sign up) ──────────────────────────────────────────
let mode = "signin";
const tabSignin = $("tab-signin");
const tabSignup = $("tab-signup");
const nameField = $("name-field");
const submitBtn = $("submit-btn");
const passwordInput = $("password");

function setMode(next) {
  mode = next;
  const signup = mode === "signup";
  tabSignup.classList.toggle("active", signup);
  tabSignin.classList.toggle("active", !signup);
  nameField.hidden = !signup;
  submitBtn.textContent = signup ? "Create account" : "Sign in";
  passwordInput.autocomplete = signup ? "new-password" : "current-password";
  hideError();
}
tabSignin.addEventListener("click", () => setMode("signin"));
tabSignup.addEventListener("click", () => setMode("signup"));

// ── Helpers ──────────────────────────────────────────────────────────────────
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
function hideError() {
  errorBox.hidden = true;
}
function friendly(code) {
  const map = {
    "auth/invalid-credential": "Hmm, that email or password doesn't match.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/email-already-in-use": "That email already has an account — try signing in.",
    "auth/weak-password": "Password needs to be at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

// Create the user's root profile doc on first sign-in.
async function ensureUserDoc(user, displayName) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      displayName: displayName || user.displayName || "friend",
      email: user.email || null,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
}

// ── Email / password submit ──────────────────────────────────────────────────
$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError();
  if (!isConfigured) return;

  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("display-name").value.trim();
  submitBtn.disabled = true;

  try {
    if (mode === "signup") {
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(user, { displayName: name });
      await ensureUserDoc(user, name);
    } else {
      const { user } = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDoc(user);
    }
    window.location.replace("index.html");
  } catch (err) {
    showError(friendly(err.code));
  } finally {
    submitBtn.disabled = false;
  }
});

// ── Google sign-in ────────────────────────────────────────────────────────────
$("google-btn").addEventListener("click", async () => {
  hideError();
  if (!isConfigured) return;
  try {
    const provider = new GoogleAuthProvider();
    const { user } = await signInWithPopup(auth, provider);
    await ensureUserDoc(user);
    window.location.replace("index.html");
  } catch (err) {
    showError(friendly(err.code));
  }
});

// Register the service worker (push notifications + PWA offline shell).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => {});
}
