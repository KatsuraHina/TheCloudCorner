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

// The 7 real weekdays (excludes "master"), Monday-first.
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const $ = (id) => document.getElementById(id);

// Firebase handles, populated by loadFirebase() only when configured.
let fb = null;          // { auth, db, ...firestore fns, ...auth fns }
let currentUid = null;
let unsubTasks = null;
let allTasks = [];                              // cached snapshot of every task
let currentWeekStart = mondayKey(new Date());   // "YYYY-MM-DD" of the viewed week's Monday
const celebratedKeys = new Set();               // columns already shown as complete
let lastRenderWeek = null;                       // for suppressing popups on load / week switch

// ── Recurring (repeating) to-dos ──────────────────────────────────────────────
let unsubRules = null;
let recurringRules = [];            // cached snapshot of users/{uid}/recurringRules
let ruleFreq = "daily";             // current selection in the create form
let selectedWeekdays = new Set();   // weekday keys chosen in the create form
let pendingDelete = null;           // task awaiting the delete-choice modal
const WEEKDAY_SHORT = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

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
wireRecurring();
wireReminders();
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
  $("reminders-btn").hidden = false;

  setupWeekNav();
  listenToTasks(user.uid);
  listenToRules(user.uid);
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
// list is shared across all weeks. (WEEKDAY_KEYS is declared near the top.)

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
  ensureRecurring(); // materialize any repeating to-dos due in the viewed week
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
  del.addEventListener("click", () => {
    if (data.recurring && data.ruleId) openDeleteChoice(data);
    else deleteDoc(doc(db, "users", uid, "tasks", id));
  });

  if (data.recurring) {
    const badge = document.createElement("span");
    badge.className = "todo-badge";
    badge.textContent = "🔁";
    badge.title = "Repeating to-do";
    li.append(box, span, badge, del);
  } else {
    li.append(box, span, del);
  }
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

// ─────────────────────────────────────────────────────────────────────────────
//  Recurring (repeating) to-dos
//
//  Rules live in users/{uid}/recurringRules. For whichever week is on screen we
//  materialize the due occurrences as normal task docs with deterministic ids
//  (rec_{ruleId}_{YYYY-MM-DD}) so checkboxes, editing, deletion, and the day-
//  complete celebration all work with no special cases. Generation is idempotent
//  (skips ids that already exist and dates the user removed), so re-renders and
//  week navigation never create duplicates.
// ─────────────────────────────────────────────────────────────────────────────

function ymd(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}
function weekdayKeyOfDate(date) {
  return WEEKDAY_KEYS[(date.getDay() + 6) % 7]; // Monday-first index
}
function datesInWeek(weekStart) {
  const monday = keyToDate(weekStart);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
function weeksBetween(anchorMondayKey, weekStartKey) {
  return Math.round((keyToDate(weekStartKey) - keyToDate(anchorMondayKey)) / (7 * 86400000));
}

function ruleMatchesDate(rule, date) {
  const dkey = ymd(date);
  if (rule.startDate && dkey < rule.startDate) return false;
  if (rule.endDate && dkey >= rule.endDate) return false;
  if (rule.skip && rule.skip[dkey]) return false;
  switch (rule.freq) {
    case "daily":
      return true;
    case "weekly":
      return (rule.weekdays || []).includes(weekdayKeyOfDate(date));
    case "fortnightly": {
      if (!(rule.weekdays || []).includes(weekdayKeyOfDate(date))) return false;
      const anchor = rule.anchorMonday || rule.startDate || currentWeekStart;
      const wk = weeksBetween(anchor, mondayKey(date));
      return (((wk % 2) + 2) % 2) === 0; // same fortnightly phase as the anchor week
    }
    case "monthly":
      return date.getDate() === rule.dayOfMonth;
    case "yearly":
      return (date.getMonth() + 1) === rule.month && date.getDate() === rule.dayOfMonth;
    default:
      return false;
  }
}

// Create any missing occurrences for the week currently being viewed.
function ensureRecurring() {
  if (!currentUid || !fb || !recurringRules.length) return;
  const { db, doc, setDoc, serverTimestamp } = fb;
  const existing = new Set(allTasks.map((t) => t.id));

  for (const rule of recurringRules) {
    for (const date of datesInWeek(currentWeekStart)) {
      if (!ruleMatchesDate(rule, date)) continue;
      const dkey = ymd(date);
      const id = `rec_${rule.id}_${dkey}`;
      if (existing.has(id)) continue;

      const day = weekdayKeyOfDate(date);
      const fields = {
        text: rule.text, done: false, day, weekStart: mondayKey(date),
        ruleId: rule.id, recurring: true, recurDate: dkey,
      };
      // Optimistically cache so this render shows it now; persist in the background.
      allTasks.push({ id, ...fields });
      existing.add(id);
      setDoc(doc(db, "users", currentUid, "tasks", id), { ...fields, createdAt: serverTimestamp() })
        .catch((err) => console.error(err));
    }
  }
}

function listenToRules(uid) {
  if (unsubRules) unsubRules();
  const { db, collection, onSnapshot } = fb;
  unsubRules = onSnapshot(collection(db, "users", uid, "recurringRules"), (snap) => {
    recurringRules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render(); // render() calls ensureRecurring() first
  });
}

// ── Recurring: management modal ───────────────────────────────────────────────
function wireRecurring() {
  // Weekday chips + month options (built once).
  const chips = $("weekday-chips");
  chips.innerHTML = WEEKDAY_KEYS
    .map((k) => `<button type="button" class="wchip" data-wd="${k}">${WEEKDAY_SHORT[k]}</button>`)
    .join("");
  chips.querySelectorAll(".wchip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.wd;
      if (selectedWeekdays.has(k)) { selectedWeekdays.delete(k); btn.classList.remove("on"); }
      else { selectedWeekdays.add(k); btn.classList.add("on"); }
    });
  });
  $("rule-month").innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");

  // Frequency segmented control.
  $("freq-toggle").querySelectorAll(".freq").forEach((btn) => {
    btn.addEventListener("click", () => {
      ruleFreq = btn.dataset.freq;
      $("freq-toggle").querySelectorAll(".freq").forEach((b) => b.classList.toggle("active", b === btn));
      updateFreqSubforms();
    });
  });

  $("recurring-btn").onclick = openRecurringModal;
  $("recurring-close").onclick = () => ($("recurring").hidden = true);
  $("recurring").addEventListener("click", (e) => { if (e.target.id === "recurring") $("recurring").hidden = true; });
  $("rule-form").addEventListener("submit", (e) => { e.preventDefault(); createRule(); });

  // Delete-choice modal.
  $("recur-delete-close").onclick = closeDeleteChoice;
  $("recur-delete").addEventListener("click", (e) => { if (e.target.id === "recur-delete") closeDeleteChoice(); });
  $("recur-delete").querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => applyDelete(btn.dataset.mode));
  });
}

function updateFreqSubforms() {
  $("sub-weekdays").hidden = !(ruleFreq === "weekly" || ruleFreq === "fortnightly");
  $("sub-monthly").hidden = ruleFreq !== "monthly";
  $("sub-yearly").hidden = ruleFreq !== "yearly";
}

function openRecurringModal() {
  renderRulesList();
  $("rule-text").value = "";
  ruleFreq = "daily";
  $("freq-toggle").querySelectorAll(".freq").forEach((b) => b.classList.toggle("active", b.dataset.freq === "daily"));
  selectedWeekdays = new Set();
  $("weekday-chips").querySelectorAll(".wchip").forEach((b) => b.classList.remove("on"));
  $("rule-dom").value = 1;
  $("rule-yday").value = 1;
  $("rule-month").value = 1;
  $("rule-error").hidden = true;
  updateFreqSubforms();
  $("recurring").hidden = false;
}

function describeRule(rule) {
  const days = (rule.weekdays || []).map((k) => WEEKDAY_SHORT[k]).join(", ");
  switch (rule.freq) {
    case "daily":       return "Every day";
    case "weekly":      return `Weekly · ${days}`;
    case "fortnightly": return `Fortnightly · ${days}`;
    case "monthly":     return `Monthly · day ${rule.dayOfMonth}`;
    case "yearly":      return `Yearly · ${MONTHS[(rule.month || 1) - 1]} ${rule.dayOfMonth}`;
    default:            return "";
  }
}

function renderRulesList() {
  const wrap = $("rules-list");
  wrap.innerHTML = "";
  if (!recurringRules.length) {
    const p = document.createElement("p");
    p.className = "rules-empty";
    p.textContent = "No repeating to-dos yet — add one below.";
    wrap.appendChild(p);
    return;
  }
  for (const rule of recurringRules) {
    const row = document.createElement("div");
    row.className = "rule-row";

    const info = document.createElement("div");
    info.className = "rule-info";
    const t = document.createElement("span");
    t.className = "rule-row-text";
    t.textContent = rule.text;
    const f = document.createElement("span");
    f.className = "rule-row-freq";
    f.textContent = describeRule(rule);
    info.append(t, f);

    const del = document.createElement("button");
    del.className = "rule-del";
    del.type = "button";
    del.setAttribute("aria-label", "Delete this repeating to-do");
    del.textContent = "×";
    del.addEventListener("click", () => deleteSeries(rule));

    row.append(info, del);
    wrap.appendChild(row);
  }
}

function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}
function showRuleError(msg) {
  const e = $("rule-error");
  e.textContent = msg;
  e.hidden = false;
}

async function createRule() {
  if (!currentUid) return;
  const text = $("rule-text").value.trim();
  if (!text) return showRuleError("Please enter a to-do.");

  const rule = {
    text,
    freq: ruleFreq,
    startDate: ymd(new Date()),
    anchorMonday: mondayKey(new Date()),
    createdAt: fb.serverTimestamp(),
  };
  if (ruleFreq === "weekly" || ruleFreq === "fortnightly") {
    if (!selectedWeekdays.size) return showRuleError("Pick at least one day of the week.");
    rule.weekdays = [...selectedWeekdays];
  } else if (ruleFreq === "monthly") {
    const dom = clampInt($("rule-dom").value, 1, 31);
    if (!dom) return showRuleError("Enter a day of the month (1–31).");
    rule.dayOfMonth = dom;
  } else if (ruleFreq === "yearly") {
    rule.month = clampInt($("rule-month").value, 1, 12);
    const dom = clampInt($("rule-yday").value, 1, 31);
    if (!dom) return showRuleError("Enter a day (1–31).");
    rule.dayOfMonth = dom;
  }

  const { db, collection, addDoc } = fb;
  try {
    await addDoc(collection(db, "users", currentUid, "recurringRules"), rule);
    $("recurring").hidden = true; // rules snapshot → ensureRecurring → render
  } catch (err) {
    console.error(err);
    showRuleError("Couldn't save that. Please try again.");
  }
}

// Delete the whole series (rule + every generated occurrence).
async function deleteSeries(rule) {
  const { db, doc, deleteDoc } = fb;
  // Drop from the cache first so a delete's snapshot can't regenerate it.
  recurringRules = recurringRules.filter((r) => r.id !== rule.id);
  const gone = allTasks.filter((t) => t.ruleId === rule.id);
  await Promise.all(gone.map((t) => deleteDoc(doc(db, "users", currentUid, "tasks", t.id)).catch(() => {})));
  await deleteDoc(doc(db, "users", currentUid, "recurringRules", rule.id)).catch((e) => console.error(e));
  renderRulesList();
}

// ── Recurring: per-occurrence delete choice ──────────────────────────────────
function openDeleteChoice(task) {
  pendingDelete = task;
  $("recur-delete-text").textContent = `“${task.text}” is a repeating to-do. How much would you like to remove?`;
  $("recur-delete").hidden = false;
}
function closeDeleteChoice() {
  $("recur-delete").hidden = true;
  pendingDelete = null;
}

async function applyDelete(mode) {
  const task = pendingDelete;
  if (!task) return;
  const { db, doc, deleteDoc, updateDoc } = fb;
  const ruleRef = doc(db, "users", currentUid, "recurringRules", task.ruleId);
  const rule = recurringRules.find((r) => r.id === task.ruleId);

  try {
    if (mode === "one") {
      // Cache the skip first so the deletion's snapshot doesn't regenerate it.
      if (rule) rule.skip = { ...(rule.skip || {}), [task.recurDate]: true };
      if (rule) await updateDoc(ruleRef, { [`skip.${task.recurDate}`]: true });
      await deleteDoc(doc(db, "users", currentUid, "tasks", task.id));
    } else if (mode === "future") {
      if (rule) rule.endDate = task.recurDate; // stop regeneration from here on, now
      if (rule) await updateDoc(ruleRef, { endDate: task.recurDate });
      const gone = allTasks.filter((t) => t.ruleId === task.ruleId && t.recurDate && t.recurDate >= task.recurDate);
      await Promise.all(gone.map((t) => deleteDoc(doc(db, "users", currentUid, "tasks", t.id)).catch(() => {})));
    } else if (mode === "series") {
      recurringRules = recurringRules.filter((r) => r.id !== task.ruleId); // stop regeneration now
      const gone = allTasks.filter((t) => t.ruleId === task.ruleId);
      await Promise.all(gone.map((t) => deleteDoc(doc(db, "users", currentUid, "tasks", t.id)).catch(() => {})));
      if (rule) await deleteDoc(ruleRef).catch((e) => console.error(e));
    }
  } catch (err) {
    console.error(err);
  }
  closeDeleteChoice();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Daily reminder (Web Push) — opt-in UI. The actual send happens server-side
//  in functions/index.js; this just lets a signed-in user turn it on/off and
//  pick the hour. push.js is imported lazily (only when the modal is used) so
//  the messaging SDK isn't loaded for everyone.
// ─────────────────────────────────────────────────────────────────────────────
function wireReminders() {
  const sel = $("reminder-hour");
  if (sel) {
    sel.innerHTML = Array.from({ length: 24 }, (_, h) => {
      const label = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });
      return `<option value="${h}">${label}</option>`;
    }).join("");
    sel.value = "20"; // default 8pm
  }

  const btn = $("reminders-btn");
  if (btn) btn.onclick = openReminders;
  $("reminders-close").onclick = () => ($("reminders").hidden = true);
  $("reminders").addEventListener("click", (e) => { if (e.target.id === "reminders") $("reminders").hidden = true; });
  $("reminders-enable").onclick = enableRemindersClick;
  $("reminders-disable").onclick = disableRemindersClick;
}

async function openReminders() {
  try {
    const { reminderPermission } = await import("./push.js");
    reflectReminderState(reminderPermission());
  } catch (e) {
    console.error(e);
  }
  $("reminders").hidden = false;
}

function setReminderMessage(msg) {
  const s = $("reminders-status");
  s.textContent = msg;
  s.hidden = false;
}

function reflectReminderState(perm) {
  const status = $("reminders-status");
  const enableBtn = $("reminders-enable");
  const disableBtn = $("reminders-disable");
  status.hidden = true;
  disableBtn.hidden = true;
  enableBtn.disabled = false;

  if (perm === "granted") {
    enableBtn.textContent = "Update time";
    disableBtn.hidden = false;
  } else if (perm === "denied") {
    enableBtn.textContent = "Enable reminders";
    setReminderMessage("Notifications are blocked for this site in your browser settings — allow them, then try again.");
  } else if (perm === "unsupported") {
    enableBtn.textContent = "Enable reminders";
    enableBtn.disabled = true;
    setReminderMessage("This browser doesn't support push notifications.");
  } else {
    enableBtn.textContent = "Enable reminders";
  }
}

function reminderReasonMessage(reason) {
  switch (reason) {
    case "no-vapid":    return "Reminders aren't fully set up yet (missing web-push key).";
    case "unsupported": return "This browser doesn't support push notifications.";
    case "denied":      return "You blocked notifications — allow them in your browser's site settings, then try again.";
    case "dismissed":   return "Permission was dismissed. Tap Enable and choose Allow.";
    default:            return "Couldn't set up reminders. Please try again.";
  }
}

async function enableRemindersClick() {
  if (!currentUid) return;
  const hour = parseInt($("reminder-hour").value, 10);
  const btn = $("reminders-enable");
  btn.disabled = true;
  try {
    const push = await import("./push.js");
    if (push.reminderPermission() === "granted") {
      await push.updateReminderHour(currentUid, hour);
      setReminderMessage("Saved — reminder time updated. ✓");
      reflectReminderState("granted");
    } else {
      const res = await push.enableReminders(currentUid, hour);
      if (res.ok) {
        reflectReminderState("granted");
        setReminderMessage("Reminders are on. You'll get a nudge if the day isn't finished. ✓");
      } else {
        reflectReminderState(res.reason === "denied" ? "denied" : "default");
        setReminderMessage(reminderReasonMessage(res.reason));
      }
    }
  } catch (err) {
    console.error(err);
    setReminderMessage("Something went wrong. Please try again.");
  } finally {
    btn.disabled = false;
  }
}

async function disableRemindersClick() {
  if (!currentUid) return;
  try {
    const push = await import("./push.js");
    await push.disableReminders(currentUid);
  } catch (err) {
    console.error(err);
  }
  reflectReminderState("default");
  setReminderMessage("Turned off on this device.");
}
