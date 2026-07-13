// ─────────────────────────────────────────────────────────────────────────────
//  Cloud Functions — daily "unfinished to-dos" push reminder
//
//  Runs at the top of every hour. For each user who opted in (a doc under
//  users/{uid}/pushSubs), if the current time equals their chosen hour in their
//  timezone AND they still have unfinished to-dos for today, sends a Web Push
//  notification via FCM. Deploy with:  firebase deploy --only functions
// ─────────────────────────────────────────────────────────────────────────────
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.remindUnfinished = onSchedule(
  { schedule: "0 * * * *", timeZone: "UTC" },
  async () => {
    const subsSnap = await db.collectionGroup("pushSubs").get();
    if (subsSnap.empty) return;

    // Group each user's device subscriptions together.
    const byUid = new Map();
    subsSnap.forEach((docSnap) => {
      const uid = docSnap.ref.parent.parent.id;
      if (!byUid.has(uid)) byUid.set(uid, []);
      byUid.get(uid).push({ token: docSnap.id, ...docSnap.data() });
    });

    const now = new Date();

    for (const [uid, subs] of byUid) {
      const tz = subs[0].timezone || "UTC";
      const reminderHour = Number.isInteger(subs[0].reminderHour) ? subs[0].reminderHour : 20;
      const local = localParts(now, tz);
      if (local.hour !== reminderHour) continue;

      // This week's weekday tasks (single-field query → no composite index),
      // then keep just today's unfinished ones.
      const weekSnap = await db
        .collection("users").doc(uid).collection("tasks")
        .where("weekStart", "==", local.weekStart)
        .get();
      const count = weekSnap.docs.filter((d) => {
        const t = d.data();
        return t.day === local.weekdayKey && !t.done;
      }).length;
      if (!count) continue;

      const tokens = subs.map((s) => s.token);
      const body = `You still have ${count} to-do${count > 1 ? "s" : ""} left for today ☁️`;

      let resp;
      try {
        resp = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title: "The Cloud Corner", body },
          webpush: {
            notification: { icon: "/assets/favicon.svg" },
            fcmOptions: { link: "https://thecloudcorner-b9c9c.web.app/" },
          },
        });
      } catch (err) {
        console.error("send failed for", uid, err);
        continue;
      }

      // Drop tokens the browser has invalidated so they don't pile up.
      await Promise.all(resp.responses.map((r, i) => {
        const code = r.error && r.error.code;
        if (!r.success &&
            (code === "messaging/registration-token-not-registered" ||
             code === "messaging/invalid-argument")) {
          return db.collection("users").doc(uid).collection("pushSubs")
            .doc(tokens[i]).delete().catch(() => {});
        }
        return null;
      }));
    }
  }
);

// Current hour, weekday key, and week-start (Monday) key in the given timezone.
function localParts(now, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short", hour: "2-digit", hour12: false,
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const hour = parseInt(parts.hour, 10) % 24; // some locales render midnight as 24
  const order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const wdMap = {
    Mon: "monday", Tue: "tuesday", Wed: "wednesday", Thu: "thursday",
    Fri: "friday", Sat: "saturday", Sun: "sunday",
  };
  const weekdayKey = wdMap[parts.weekday] || "monday";
  const offset = order.indexOf(weekdayKey);
  const base = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  base.setUTCDate(base.getUTCDate() - offset);
  const pad = (n) => String(n).padStart(2, "0");
  const weekStart = `${base.getUTCFullYear()}-${pad(base.getUTCMonth() + 1)}-${pad(base.getUTCDate())}`;
  return { hour, weekdayKey, weekStart };
}
