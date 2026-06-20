// ─────────────────────────────────────────────────────────────────────────────
//  planner.js — the homepage: auth gate, weekly to-dos (Firestore), page links
//
//  The layout renders immediately with NO network dependency. The Firebase SDK
//  is loaded lazily (dynamic import) only when real config keys are present, so
//  "preview mode" works fully offline.
// ─────────────────────────────────────────────────────────────────────────────
import { isConfigured } from "./firebase-config.js";
import { startClock } from "./clock.js";

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
let unsubPages = null;

// ── Render the shell right away (works with or without Firebase) ─────────────
revealApp();
buildSkeleton();
startClock();
$("welcome-name").textContent = "friend";

if (!isConfigured) {
  renderPreviewPages();
  banner("Preview mode — add your Firebase keys in js/firebase-config.js to enable sign-in and saving. See the README.");
} else {
  initFirebase().catch((err) => {
    console.error(err);
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
  const name = user.displayName || (user.email ? user.email.split("@")[0] : "friend");
  $("welcome-name").textContent = name;

  const chip = $("user-chip");
  chip.textContent = `☁️ ${name}`;
  chip.hidden = false;
  const signoutBtn = $("signout-btn");
  signoutBtn.hidden = false;
  signoutBtn.onclick = () => fb.signOut(fb.auth);

  listenToTasks(user.uid);
  listenToPages(user.uid);
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
function listenToTasks(uid) {
  currentUid = uid;
  if (unsubTasks) unsubTasks();
  const { db, collection, query, orderBy, onSnapshot } = fb;
  const q = query(collection(db, "users", uid, "tasks"), orderBy("createdAt", "asc"));
  unsubTasks = onSnapshot(q, (snap) => {
    document.querySelectorAll(".todo-list").forEach((ul) => (ul.innerHTML = ""));
    snap.forEach((d) => renderTask(d.id, d.data(), uid));
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
  return addDoc(collection(db, "users", currentUid, "tasks"), {
    text, done: false, day, createdAt: serverTimestamp(),
  });
}

// Static page links shown in preview mode (no Firebase) so the rails aren't empty.
function renderPreviewPages() {
  const sample = [
    { title: "University",    emoji: "🎓", section: "main" },
    { title: "Habit tracker", emoji: "🌱", section: "main" },
    { title: "Bookish",       emoji: "📚", section: "fun" },
  ];
  for (const p of sample) {
    const li = document.createElement("li");
    li.className = "link-item";
    li.innerHTML = `<span class="link-emoji">${p.emoji}</span><span>${p.title}</span>`;
    $(p.section === "fun" ? "pages-fun" : "pages-main").appendChild(li);
  }
}

// ── Page link rails ──────────────────────────────────────────────────────────
function listenToPages(uid) {
  if (unsubPages) unsubPages();
  const { db, collection, onSnapshot } = fb;
  const col = collection(db, "users", uid, "pages");
  unsubPages = onSnapshot(col, async (snap) => {
    if (snap.empty) {
      await seedDefaultPages(uid);
      return; // snapshot fires again with the seeded docs
    }
    const main = $("pages-main");
    const fun = $("pages-fun");
    main.innerHTML = "";
    fun.innerHTML = "";
    snap.forEach((d) => {
      const p = d.data();
      const li = document.createElement("li");
      li.className = "link-item";
      li.innerHTML = `<span class="link-emoji">${p.emoji || "📄"}</span>` +
        (p.url
          ? `<a href="${p.url}" target="_blank" rel="noopener">${p.title}</a>`
          : `<span>${p.title}</span>`);
      (p.section === "fun" ? fun : main).appendChild(li);
    });
  });
}

async function seedDefaultPages(uid) {
  const { db, collection, addDoc, getDocs, serverTimestamp } = fb;
  const defaults = [
    { title: "University",    emoji: "🎓", section: "main" },
    { title: "Habit tracker", emoji: "🌱", section: "main" },
    { title: "Bookish",       emoji: "📚", section: "fun" },
  ];
  const existing = await getDocs(collection(db, "users", uid, "pages"));
  if (!existing.empty) return; // avoid double-seeding on a snapshot race
  for (const p of defaults) {
    await addDoc(collection(db, "users", uid, "pages"), {
      ...p, url: "", createdAt: serverTimestamp(),
    });
  }
}
