// ─────────────────────────────────────────────────────────────────────────────
//  push.js — opt-in Web Push reminders ("you still have to-dos for today")
//
//  The browser can't wake itself when the tab is closed, so a Cloud Function
//  (functions/index.js) sends the actual push each evening. This module just
//  handles the client side: ask permission, get an FCM token, and store it
//  (with the user's timezone + preferred hour) under users/{uid}/pushSubs/{token}
//  so the function knows where and when to send.
// ─────────────────────────────────────────────────────────────────────────────
import { db } from "./firebase-init.js";
import { vapidKey, pushConfigured, firebaseConfig } from "./firebase-config.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SW_URL = "/firebase-messaging-sw.js";

// Reflects what the UI should show. "unsupported" | "default" | "granted" | "denied"
export function reminderPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission; // "default" | "granted" | "denied"
}

// Turn reminders on: request permission, register the SW, mint an FCM token,
// and save the subscription. Returns { ok, reason }.
export async function enableReminders(uid, reminderHour) {
  if (!pushConfigured) {
    return { ok: false, reason: "no-vapid" };
  }
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, reason: "unsupported" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: permission === "denied" ? "denied" : "dismissed" };
  }

  try {
    const registration = await navigator.serviceWorker.register(SW_URL);
    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: "no-token" };

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await setDoc(
      doc(db, "users", uid, "pushSubs", token),
      {
        timezone,
        reminderHour: Number.isInteger(reminderHour) ? reminderHour : 20,
        userAgent: navigator.userAgent,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    // Foreground messages (tab open): show them ourselves since the browser won't.
    onMessage(messaging, (payload) => {
      const n = payload.notification || {};
      if (Notification.permission === "granted" && registration.showNotification) {
        registration.showNotification(n.title || "The Cloud Corner ☁️", {
          body: n.body || "",
          icon: "/assets/favicon.svg",
        });
      }
    });

    return { ok: true, token };
  } catch (err) {
    console.error(err);
    return { ok: false, reason: "error" };
  }
}

// Update just the preferred hour on every subscription for this device's token.
export async function updateReminderHour(uid, reminderHour) {
  if (!(await isSupported().catch(() => false))) return;
  try {
    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey }).catch(() => null);
    if (!token) return;
    await setDoc(
      doc(db, "users", uid, "pushSubs", token),
      { reminderHour, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    console.error(err);
  }
}

// Turn reminders off for this device (delete its stored subscription).
export async function disableReminders(uid) {
  try {
    const messaging = getMessaging();
    const token = await getToken(messaging, { vapidKey }).catch(() => null);
    if (token) await deleteDoc(doc(db, "users", uid, "pushSubs", token)).catch(() => {});
  } catch (err) {
    console.error(err);
  }
}

// Referenced so bundlers keep it; also documents that the SW inlines this config.
export const _config = firebaseConfig;
