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
