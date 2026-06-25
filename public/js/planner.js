// ─────────────────────────────────────────────────────────────────────────────
//  planner.js — the homepage: auth gate + weekly to-dos (Firestore)
//
//  The layout renders immediately with NO network dependency. The Firebase SDK
//  is loaded lazily (dynamic import) only when real config keys are present, so
//  "preview mode" works fully offline.
// ─────────────────────────────────────────────────────────────────────────────
import { isConfigured } from "./firebase-config.js";
import { startClock } from "./clock.js";
import { getMovieQuote } from "./quotes.js";

// Columns, in screenshot order (two rows of four).
const DAYS = [
  { key: "monday",    label: "Monday",            icon: "☁️" },
  { key: "tuesday",   label: "Tuesday",           icon: "☁️" },
  { key: "wednesday", label: "Wednesday",         icon: "☁️" },
  { key: "thursday",  label: "Thursday",          icon: "☁️" },
  { key: "friday",    label: "Friday",            icon: "☁️" },
  { key: "saturday",  label: "Saturday",          icon: "☁️" },
  { key: "sunday",    label: "Sunday",            icon: "☁️" },
  { key: "master",    label: "Master to-do list", icon: "☁️" },
];

const $ = (id) => document.getElementById(id);

// Firebase handles, populated by loadFirebase() only when configured.
let fb = null;          // { auth, db, ...firestore fns, ...auth fns }
let currentUid = null;
let unsubTasks = null;
let allTasks = [];                              // cached snapshot of every task
let currentWeekStart = mondayKey(new Date());   // "YYYY-MM-DD" of the viewed week's Monday
const celebratedKeys = new Set();               // columns already shown as complete
let lastRenderWeek = null;                       // for suppressing popups on load / week switch

// ── Week date helpers ─────────────────────────────────────────────────────────
// Monday is treated as the start of the week (matches the Mon–Sun columns).
function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7; // 0 if Monday, 6 if Sunday
  d.setDate(d.getDate() - offset);
  return d;
}
function mondayKey(date) {
  const m = mondayOf(date);
  const mm = String(m.getMonth() + 1).padStart(2, "0");
  const dd = String(m.getDate()).padStart(2, "0");
  return `${m.getFullYear()}-${mm}-${dd}`;
}
function keyToDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// ── Build the shell while it's still hidden behind the loader ────────────────
buildSkeleton();
startClock();
renderWeekLabel();
wireCelebrate();
$("welcome-name").textContent = "friend";

if (!isConfigured) {
  // No auth to wait for in preview mode — show the layout straight away.
  revealApp();
  banner("Preview mode — add your Firebase keys in js/firebase-config.js to enable sign-in and saving. See the README.");
} else {
  // Keep the loader up until auth resolves, so the page never flashes before
  // a signed-out visitor is redirected to the login page.
  initFirebase().catch((err) => {
    console.error(err);
    revealApp(); // don't trap the user on the loader if Firebase fails to load
    banner("Couldn't reach Firebase. Check your connection and config keys.");
  });
}

// ── Lazy-load the Firebase SDK + wire the auth gate ──────────────────────────
async function initFirebase() {
  const [{ auth, db }, authSdk, fsSdk] = await Promise.all([
    import("./firebase-init.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
  ]);
  fb = { auth, db, ...authSdk, ...fsSdk };

  fb.onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    bootForUser(user);
  });
}

// ── Boot the planner for a signed-in user ────────────────────────────────────
function bootForUser(user) {
  revealApp(); // confirmed signed in — now it's safe to show the page
  const name = user.displayName || (user.email ? user.email.split("@")[0] : "friend");
  $("welcome-name").textContent = name;

  const chip = $("user-chip");
  chip.textContent = `☁️ ${name}`;
  chip.hidden = false;
  const signoutBtn = $("signout-btn");
  signoutBtn.hidden = false;
  signoutBtn.onclick = () => fb.signOut(fb.auth);

  setupWeekNav();
  listenToTasks(user.uid);
}

// ── Week navigation ──────────────────────────────────────────────────────────
function setupWeekNav() {
  $("week-prev").onclick = () => shiftWeek(-7);
  $("week-next").onclick = () => shiftWeek(7);
  $("week-label").onclick = () => {
    currentWeekStart = mondayKey(new Date());
    render();
  };
  renderWeekLabel();
}

function shiftWeek(days) {
  currentWeekStart = mondayKey(addDays(keyToDate(currentWeekStart), days));
  render();
}

function renderWeekLabel() {
  const monday = keyToDate(currentWeekStart);
  const sunday = addDays(monday, 6);
  const thisWeek = mondayKey(new Date());
  const fmt = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  // Friendly relative name for the current / next / last week.
  const diffWeeks = Math.round((monday - keyToDate(thisWeek)) / (7 * 86400000));
  let title = `Week of ${fmt(monday)}`;
  if (diffWeeks === 0) title = "This week";
  else if (diffWeeks === 1) title = "Next week";
  else if (diffWeeks === -1) title = "Last week";

  const label = $("week-label");
  label.innerHTML = `${title}<span class="week-sub">${fmt(monday)} – ${fmt(sunday)}</span>`;
  label.classList.toggle("is-current", diffWeeks === 0);
}

// ── Reveal main, hide loader ─────────────────────────────────────────────────
function revealApp() {
  const veil = $("loading-veil");
  if (veil) veil.hidden = true;
  $("app").hidden = false;
}

function banner(text) {
  const b = document.createElement("div");
  b.className = "info-banner";
  b.textContent = text;
  document.querySelector(".app").prepend(b);
}

// ── Build the empty grid columns once ────────────────────────────────────────
function buildSkeleton() {
  const grid = $("week-grid");
  grid.innerHTML = "";
  for (const day of DAYS) {
    const col = document.createElement("section");
    col.className = "day-col" + (day.key === "master" ? " master-col" : "");
    col.dataset.day = day.key;
    col.innerHTML = `
      <header class="day-head"><span class="callout-icon">${day.icon}</span>${day.label}</header>
      <ul class="todo-list" data-list="${day.key}"></ul>
      <form class="add-form" data-add="${day.key}">
        <input type="text" class="add-input" placeholder="+ add to-do" aria-label="Add to-do for ${day.label}" />
      </form>
    `;
    grid.appendChild(col);
  }

  // Wire the add-task forms (only persist when signed in).
  grid.querySelectorAll(".add-form").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector(".add-input");
      const text = input.value.trim();
      if (!text) return;
      if (currentUid) addTask(form.dataset.add, text);
      input.value = "";
    });
  });
}

// ── Live to-dos ──────────────────────────────────────────────────────────────
// One listener caches every task; render() shows the right slice for the week
// being viewed. Weekday tasks belong to a specific week (weekStart); the Master
// list is shared across all weeks.
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function listenToTasks(uid) {
  currentUid = uid;
  if (unsubTasks) unsubTasks();
  const { db, collection, onSnapshot } = fb;
  unsubTasks = onSnapshot(collection(db, "users", uid, "tasks"), (snap) => {
    allTasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    migrateLegacyTasks(uid);
    render();
  });
}

// Older tasks were saved before weeks existed (weekday set, no weekStart).
// Park them in the real current week so they don't vanish from the grid.
function migrateLegacyTasks(uid) {
  const { db, doc, updateDoc } = fb;
  const thisWeek = mondayKey(new Date());
  for (const t of allTasks) {
    if (WEEKDAY_KEYS.includes(t.day) && !t.weekStart) {
      t.weekStart = thisWeek; // update cache immediately so render is correct now
      updateDoc(doc(db, "users", uid, "tasks", t.id), { weekStart: thisWeek });
    }
  }
}

function render() {
  renderWeekLabel();
  document.querySelectorAll(".todo-list").forEach((ul) => (ul.innerHTML = ""));

  const visible = allTasks
    .filter((t) =>
      t.day === "master"
        ? true                                   // Master list: every week
        : t.weekStart === currentWeekStart       // weekday: only the viewed week
    )
    .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));

  for (const t of visible) renderTask(t.id, t, currentUid);

  detectCompletions(visible);
}

// Show a celebration popup the moment every to-do in a column gets checked off.
// Seeding suppresses popups on first load and when switching weeks, so only a
// fresh user completion pops.
function detectCompletions(visible) {
  const seeding = lastRenderWeek !== currentWeekStart;

  for (const day of DAYS) {
    const items = visible.filter((t) => (t.day || "master") === day.key);
    const complete = items.length > 0 && items.every((t) => t.done);
    const keyId = day.key === "master" ? "master" : `${currentWeekStart}/${day.key}`;

    if (complete) {
      if (!celebratedKeys.has(keyId)) {
        celebratedKeys.add(keyId);
        if (!seeding) celebrate(day.label);
      }
    } else {
      celebratedKeys.delete(keyId);
    }
  }

  lastRenderWeek = currentWeekStart;
}

// ── Celebration popup ─────────────────────────────────────────────────────────
let celebrateTimer = null;

async function celebrate(dayLabel) {
  const overlay = $("celebrate");
  if (!overlay) return;

  $("celebrate-title").textContent = `${dayLabel} complete!`;
  $("celebrate-quote").textContent = "…";
  $("celebrate-movie").textContent = "";
  showCelebrate(overlay);

  const { text, movie } = await getMovieQuote();
  // Only fill in if the popup is still open (user may have dismissed it).
  if (!overlay.hidden) {
    $("celebrate-quote").textContent = `“${text}”`;
    $("celebrate-movie").textContent = `— ${movie}`;
  }
}

function showCelebrate(overlay) {
  overlay.hidden = false;
  // restart the pop-in animation
  const card = overlay.querySelector(".celebrate-card");
  card.classList.remove("pop");
  void card.offsetWidth;
  card.classList.add("pop");

  clearTimeout(celebrateTimer);
  celebrateTimer = setTimeout(hideCelebrate, 6000);
}

function hideCelebrate() {
  const overlay = $("celebrate");
  if (overlay) overlay.hidden = true;
  clearTimeout(celebrateTimer);
}

function wireCelebrate() {
  const overlay = $("celebrate");
  if (!overlay) return;
  $("celebrate-close").onclick = hideCelebrate;
  // click on the backdrop (but not the card) closes it
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) hideCelebrate();
  });
}

function renderTask(id, data, uid) {
  const list = document.querySelector(`.todo-list[data-list="${data.day || "master"}"]`);
  if (!list) return;
  const { db, doc, updateDoc, deleteDoc } = fb;

  const li = document.createElement("li");
  li.className = "todo-item" + (data.done ? " done" : "");

  const box = document.createElement("input");
  box.type = "checkbox";
  box.className = "todo-box";
  box.checked = !!data.done;
  box.addEventListener("change", () =>
    updateDoc(doc(db, "users", uid, "tasks", id), { done: box.checked })
  );

  const span = document.createElement("span");
  span.className = "todo-text";
  span.textContent = data.text;
  span.addEventListener("dblclick", () => {
    const next = prompt("Edit to-do:", data.text);
    if (next != null && next.trim())
      updateDoc(doc(db, "users", uid, "tasks", id), { text: next.trim() });
  });

  const del = document.createElement("button");
  del.className = "todo-del";
  del.type = "button";
  del.setAttribute("aria-label", "Delete to-do");
  del.textContent = "×";
  del.addEventListener("click", () => deleteDoc(doc(db, "users", uid, "tasks", id)));

  li.append(box, span, del);
  list.appendChild(li);
}

function addTask(day, text) {
  const { db, collection, addDoc, serverTimestamp } = fb;
  // Weekday tasks belong to the week currently being viewed; Master is shared.
  const weekStart = day === "master" ? null : currentWeekStart;
  return addDoc(collection(db, "users", currentUid, "tasks"), {
    text, done: false, day, weekStart, createdAt: serverTimestamp(),
  });
}
