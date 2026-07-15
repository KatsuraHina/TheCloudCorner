/* firebase-messaging-sw.js — background push handler for The Cloud Corner.
 *
 * Served from the origin root (/firebase-messaging-sw.js). A service worker
 * can't use ES modules or import ./firebase-config.js, so the Firebase config
 * is inlined below — keep it in sync with public/js/firebase-config.js. These
 * are public identifiers (safe to commit), not secrets.
 */
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCF2zYfohgia1MyinbdVmXTPa9RuSuWvlg",
  authDomain: "thecloudcorner-b9c9c.firebaseapp.com",
  projectId: "thecloudcorner-b9c9c",
  storageBucket: "thecloudcorner-b9c9c.firebasestorage.app",
  messagingSenderId: "774870607136",
  appId: "1:774870607136:web:98031b91e6fe5c4dd02345",
});

const messaging = firebase.messaging();

// Fires for background data messages. (Notification-payload messages are shown
// automatically by the browser, so this is a belt-and-suspenders handler.)
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "The Cloud Corner ☁️", {
    body: n.body || "You still have to-dos for today.",
    icon: "/assets/favicon.svg",
    badge: "/assets/favicon.svg",
    data: { url: "/" },
  });
});

// Focus/open the planner when a notification is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin) && "focus" in w) return w.focus();
      }
      return clients.openWindow("/");
    })
  );
});

/* ── PWA app shell ───────────────────────────────────────────────────────────
 * Network-first with cache fallback: deploys show up immediately when online,
 * and the installed app still opens when offline. Bump CACHE on shape changes.
 */
const CACHE = "cloudcorner-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/login.html",
  "/albums.html",
  "/manifest.webmanifest",
  "/css/styles.css",
  "/css/albums.css",
  "/js/planner.js",
  "/js/auth.js",
  "/js/albums.js",
  "/js/clock.js",
  "/js/quotes.js",
  "/js/push.js",
  "/js/firebase-config.js",
  "/js/firebase-init.js",
  "/assets/favicon.svg",
  "/assets/decor.svg",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("cloudcorner-shell-") && k !== CACHE)
        .map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only same-origin GETs: Firebase/Google APIs must always hit the network.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return resp;
      })
      .catch(() =>
        caches.match(event.request).then(
          (hit) => hit || (event.request.mode === "navigate" ? caches.match("/index.html") : undefined)
        )
      )
  );
});
