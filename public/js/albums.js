// ─────────────────────────────────────────────────────────────────────────────
//  albums.js — shared family photo/video albums (Firestore + Storage)
//
//  Mirrors planner.js: the shell renders immediately, the Firebase SDK is loaded
//  lazily, and a signed-out visitor is bounced to login.html. Albums are
//  communal — every signed-in user sees and can add to the same shelf — so they
//  live in top-level `albums/{id}` (not under users/{uid}). Each album/item is
//  stamped with its owner, and only the owner can edit or delete what they made.
// ─────────────────────────────────────────────────────────────────────────────
import { isConfigured } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);

// Firebase handles, populated by initFirebase() only when configured.
let fb = null; // { auth, db, storage, ...firestore fns, ...storage fns, ...auth fns }
let currentUid = null;
let currentUserName = "friend";

let albums = [];          // cached shelf
let unsubAlbums = null;

let currentAlbumId = null;
let currentAlbum = null;  // cached album doc data
let items = [];           // cached items of the open album
let unsubItems = null;
let unsubAlbumDoc = null;

let lightboxIndex = -1;

// ── Boot ─────────────────────────────────────────────────────────────────────
wireStaticUi();

if (!isConfigured) {
  revealApp();
  banner("Preview mode — add your Firebase keys in js/firebase-config.js to enable albums. See the README.");
} else {
  initFirebase().catch((err) => {
    console.error(err);
    revealApp();
    banner("Couldn't reach Firebase. Check your connection and config keys.");
  });
}

// ── Lazy-load the Firebase SDK + wire the auth gate ──────────────────────────
async function initFirebase() {
  const [{ auth, db, storage }, authSdk, fsSdk, stSdk] = await Promise.all([
    import("./firebase-init.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js"),
  ]);
  fb = { auth, db, storage, ...authSdk, ...fsSdk, ...stSdk };

  fb.onAuthStateChanged(auth, (user) => {
    if (!user) {
      window.location.replace("login.html");
      return;
    }
    bootForUser(user);
  });
}

function bootForUser(user) {
  revealApp();
  currentUid = user.uid;
  currentUserName = user.displayName || (user.email ? user.email.split("@")[0] : "friend");

  const chip = $("user-chip");
  chip.textContent = `☁️ ${currentUserName}`;
  chip.hidden = false;
  const signoutBtn = $("signout-btn");
  signoutBtn.hidden = false;
  signoutBtn.onclick = () => fb.signOut(fb.auth);

  listenToAlbums();
}

// ── Albums shelf ─────────────────────────────────────────────────────────────
function listenToAlbums() {
  const { db, collection, query, orderBy, onSnapshot } = fb;
  const q = query(collection(db, "albums"), orderBy("createdAt", "desc"));
  unsubAlbums = onSnapshot(q, (snap) => {
    albums = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderShelf();
    // If the open album was deleted by someone, fall back to the shelf.
    if (currentAlbumId && !albums.some((a) => a.id === currentAlbumId)) {
      showBookshelf();
    }
  });
}

function renderShelf() {
  const grid = $("shelf-grid");
  grid.innerHTML = "";

  for (const album of albums) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "album-item";
    card.addEventListener("click", () => openAlbum(album.id));

    const cover = album.coverUrl
      ? `<img class="album-cover" src="${escapeAttr(album.coverUrl)}" alt="" loading="lazy" />`
      : `<div class="album-cover album-cover-empty">☁️</div>`;
    const count = album.itemCount
      ? `<span class="album-count">${album.itemCount} ${album.itemCount === 1 ? "item" : "items"}</span>`
      : "";

    card.innerHTML = `
      ${cover}
      <div class="album-label">${escapeHtml(album.title || "Untitled")}${count}</div>
    `;
    grid.appendChild(card);
  }

  // "New album" card always last.
  const add = document.createElement("button");
  add.type = "button";
  add.className = "album-item album-add";
  add.innerHTML = `<div class="album-add-plus">＋</div><div class="album-label">New album</div>`;
  add.addEventListener("click", openCreateModal);
  grid.appendChild(add);
}

// ── Create album ─────────────────────────────────────────────────────────────
function openCreateModal() {
  $("create-name").value = "";
  $("create-letter").value = "";
  openModal("create-modal");
  $("create-name").focus();
}

async function submitCreateAlbum() {
  const title = $("create-name").value.trim();
  if (!title) { $("create-name").focus(); return; }
  const letter = $("create-letter").value.trim();
  const btn = $("create-submit");
  btn.disabled = true;
  try {
    const { db, collection, addDoc, serverTimestamp } = fb;
    const refDoc = await addDoc(collection(db, "albums"), {
      title,
      letter,
      coverUrl: "",
      coverPath: "",
      ownerUid: currentUid,
      ownerName: currentUserName,
      itemCount: 0,
      createdAt: serverTimestamp(),
    });
    closeModal("create-modal");
    openAlbum(refDoc.id);
  } catch (err) {
    console.error(err);
    alert("Couldn't create the album. Please try again.");
  } finally {
    btn.disabled = false;
  }
}

// ── Open a single album ──────────────────────────────────────────────────────
function openAlbum(albumId) {
  currentAlbumId = albumId;
  items = [];
  if (unsubItems) { unsubItems(); unsubItems = null; }
  if (unsubAlbumDoc) { unsubAlbumDoc(); unsubAlbumDoc = null; }

  const { db, doc, collection, query, orderBy, onSnapshot } = fb;

  unsubAlbumDoc = onSnapshot(doc(db, "albums", albumId), (snap) => {
    if (!snap.exists()) { showBookshelf(); return; }
    currentAlbum = { id: snap.id, ...snap.data() };
    paintAlbumChrome();
  });

  const q = query(collection(db, "albums", albumId, "items"), orderBy("createdAt", "asc"));
  unsubItems = onSnapshot(q, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMasonry();
  });

  showGallery();
}

function paintAlbumChrome() {
  if (!currentAlbum) return;
  $("gallery-title").textContent = currentAlbum.title || "Album";
  $("letter-btn").hidden = !(currentAlbum.letter && currentAlbum.letter.trim());
  $("delete-album-btn").hidden = currentAlbum.ownerUid !== currentUid;
}

function renderMasonry() {
  const wrap = $("masonry");
  wrap.innerHTML = "";
  $("gallery-empty").hidden = items.length > 0;

  // You can curate an item if you uploaded it, or if you own the album.
  const canCurate = (item) =>
    item.ownerUid === currentUid || (currentAlbum && currentAlbum.ownerUid === currentUid);

  items.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "memory-card";

    const media = item.type === "video"
      ? `<video class="memory-media" src="${escapeAttr(item.url)}" preload="metadata" muted playsinline></video>
         <span class="memory-play">▶</span>`
      : `<img class="memory-media" src="${escapeAttr(item.url)}" alt="" loading="lazy" />`;

    // Caption text only appears once one exists — no placeholder clutter.
    const caption = item.caption
      ? `<div class="memory-caption">${escapeHtml(item.caption)}</div>`
      : "";
    // Hover actions (edit caption + delete) for people who can curate the item.
    const actions = canCurate(item)
      ? `<div class="memory-actions">
           <button class="memory-act memory-edit" type="button" title="${item.caption ? "Edit caption" : "Add caption"}" aria-label="Edit caption">✎</button>
           <button class="memory-act memory-del" type="button" title="Delete" aria-label="Delete">×</button>
         </div>`
      : "";

    card.innerHTML = `<div class="memory-frame">${media}</div>${actions}${caption}`;

    card.querySelector(".memory-frame").addEventListener("click", () => openLightbox(index));

    const editBtn = card.querySelector(".memory-edit");
    if (editBtn) editBtn.addEventListener("click", () => openCaptionModal(item));

    const cap = card.querySelector(".memory-caption");
    if (cap && canCurate(item)) {
      cap.title = "Double-click to edit caption";
      cap.addEventListener("dblclick", () => openCaptionModal(item));
    }

    const delBtn = card.querySelector(".memory-del");
    if (delBtn) delBtn.addEventListener("click", () => deleteItem(item));

    wrap.appendChild(card);
  });
}

let captionItem = null; // item currently open in the caption modal

function openCaptionModal(item) {
  captionItem = item;
  const input = $("caption-input");
  input.value = item.caption || "";
  $("caption-modal-title").textContent = item.caption ? "Edit caption" : "Add caption";
  openModal("caption-modal");
  input.focus();
  input.select();
}

async function saveCaption() {
  if (!captionItem) return;
  const text = $("caption-input").value.trim();
  const item = captionItem;
  closeModal("caption-modal");
  captionItem = null;
  try {
    const { db, doc, updateDoc } = fb;
    await updateDoc(doc(db, "albums", currentAlbumId, "items", item.id), { caption: text });
  } catch (err) {
    console.error(err);
  }
}

// ── Upload ───────────────────────────────────────────────────────────────────
function openUploadModal() {
  $("upload-list").innerHTML = "";
  $("file-input").value = "";
  openModal("upload-modal");
}

function handleFiles(fileList) {
  const files = Array.from(fileList || []);
  for (const file of files) {
    if (!/^(image|video)\//.test(file.type)) {
      addUploadRow(file.name, "Skipped — not an image or video", true);
      continue;
    }
    if (file.size > 50 * 1024 * 1024) {
      addUploadRow(file.name, "Skipped — over 50 MB", true);
      continue;
    }
    uploadOne(file);
  }
}

function uploadOne(file) {
  const { db, storage, doc, collection, setDoc, serverTimestamp, increment, updateDoc,
          ref, uploadBytesResumable, getDownloadURL } = fb;

  const itemRef = doc(collection(db, "albums", currentAlbumId, "items"));
  const id = itemRef.id;
  const path = `albums/${currentAlbumId}/${id}-${safeName(file.name)}`;
  const type = file.type.startsWith("video/") ? "video" : "photo";

  const row = addUploadRow(file.name, "0%");
  const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });

  task.on("state_changed",
    (snap) => {
      const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
      row.setProgress(pct);
    },
    (err) => {
      console.error(err);
      row.fail("Upload failed");
    },
    async () => {
      try {
        const url = await getDownloadURL(task.snapshot.ref);
        await setDoc(itemRef, {
          type, url, path, caption: "",
          ownerUid: currentUid,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, "albums", currentAlbumId), { itemCount: increment(1) });
        // First photo becomes the album cover if none is set yet.
        if (type === "photo" && currentAlbum && !currentAlbum.coverUrl) {
          await updateDoc(doc(db, "albums", currentAlbumId), { coverUrl: url, coverPath: path });
        }
        row.done();
      } catch (err) {
        console.error(err);
        row.fail("Save failed");
      }
    }
  );
}

function addUploadRow(name, status, isError) {
  const list = $("upload-list");
  const row = document.createElement("div");
  row.className = "upload-row" + (isError ? " is-error" : "");
  row.innerHTML = `
    <div class="upload-name">${escapeHtml(name)}</div>
    <div class="upload-bar"><div class="upload-fill"></div></div>
    <div class="upload-status">${escapeHtml(status)}</div>
  `;
  list.prepend(row);
  const fill = row.querySelector(".upload-fill");
  const statusEl = row.querySelector(".upload-status");
  if (isError) row.querySelector(".upload-bar").style.display = "none";
  return {
    setProgress(pct) { fill.style.width = pct + "%"; statusEl.textContent = pct + "%"; },
    done() { fill.style.width = "100%"; statusEl.textContent = "✓"; row.classList.add("is-done"); },
    fail(msg) { statusEl.textContent = msg; row.classList.add("is-error"); },
  };
}

// ── Delete ───────────────────────────────────────────────────────────────────
async function deleteItem(item) {
  if (!confirm("Delete this from the album?")) return;
  const { db, storage, doc, deleteDoc, updateDoc, increment, ref, deleteObject } = fb;
  try {
    await deleteDoc(doc(db, "albums", currentAlbumId, "items", item.id));
    if (item.path) await deleteObject(ref(storage, item.path)).catch(() => {});
    await updateDoc(doc(db, "albums", currentAlbumId), { itemCount: increment(-1) });
    // If we removed the cover, pick the next surviving photo (or clear it).
    if (currentAlbum && currentAlbum.coverPath === item.path) {
      const nextPhoto = items.find((i) => i.id !== item.id && i.type === "photo");
      await updateDoc(doc(db, "albums", currentAlbumId), {
        coverUrl: nextPhoto ? nextPhoto.url : "",
        coverPath: nextPhoto ? nextPhoto.path : "",
      });
    }
  } catch (err) {
    console.error(err);
    alert("Couldn't delete that. Only the person who uploaded it can.");
  }
}

async function deleteAlbum() {
  if (!currentAlbum || currentAlbum.ownerUid !== currentUid) return;
  if (!confirm(`Delete the whole "${currentAlbum.title}" album and everything in it?`)) return;
  const { db, storage, doc, collection, getDocs, deleteDoc, ref, deleteObject } = fb;
  try {
    const snap = await getDocs(collection(db, "albums", currentAlbumId, "items"));
    for (const d of snap.docs) {
      const data = d.data();
      if (data.path) await deleteObject(ref(storage, data.path)).catch(() => {});
      await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, "albums", currentAlbumId));
    showBookshelf();
  } catch (err) {
    console.error(err);
    alert("Couldn't delete the album. Only its owner can.");
  }
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(index) {
  lightboxIndex = index;
  paintLightbox();
  $("lightbox").hidden = false;
}

function paintLightbox() {
  const item = items[lightboxIndex];
  if (!item) return;
  const stage = $("lightbox-stage");
  stage.innerHTML = item.type === "video"
    ? `<video src="${escapeAttr(item.url)}" controls autoplay playsinline></video>`
    : `<img src="${escapeAttr(item.url)}" alt="" />`;
  $("lightbox-caption").textContent = item.caption || "";
}

function moveLightbox(step) {
  if (!items.length) return;
  lightboxIndex = (lightboxIndex + step + items.length) % items.length;
  paintLightbox();
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lightbox-stage").innerHTML = ""; // stop any playing video
  lightboxIndex = -1;
}

// ── View switching ───────────────────────────────────────────────────────────
function showGallery() {
  $("bookshelf-view").hidden = true;
  $("gallery-view").hidden = false;
  window.scrollTo({ top: 0 });
}

function showBookshelf() {
  if (unsubItems) { unsubItems(); unsubItems = null; }
  if (unsubAlbumDoc) { unsubAlbumDoc(); unsubAlbumDoc = null; }
  currentAlbumId = null;
  currentAlbum = null;
  items = [];
  $("gallery-view").hidden = true;
  $("bookshelf-view").hidden = false;
}

// ── Static UI wiring (safe before Firebase loads) ────────────────────────────
function wireStaticUi() {
  $("create-submit").onclick = () => submitCreateAlbum();
  $("caption-save").onclick = () => saveCaption();
  $("caption-cancel").onclick = () => { closeModal("caption-modal"); captionItem = null; };
  // Enter saves (Shift+Enter for a newline).
  $("caption-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveCaption(); }
  });
  $("back-btn").onclick = () => showBookshelf();
  $("upload-btn").onclick = () => openUploadModal();
  $("delete-album-btn").onclick = () => deleteAlbum();
  $("letter-btn").onclick = () => {
    if (!currentAlbum) return;
    $("letter-modal-title").textContent = currentAlbum.title || "A letter";
    $("letter-text").textContent = currentAlbum.letter || "";
    openModal("letter-modal");
  };

  // Modal close buttons + backdrop clicks.
  document.querySelectorAll(".modal-close").forEach((btn) => {
    btn.onclick = () => closeModal(btn.dataset.close);
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(overlay.id); });
  });

  // Upload picker + drag-and-drop.
  const dz = $("drop-zone");
  $("file-input").addEventListener("change", (e) => handleFiles(e.target.files));
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("is-over"); }));
  dz.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

  // Lightbox controls.
  $("lightbox-close").onclick = () => closeLightbox();
  $("lightbox-prev").onclick = () => moveLightbox(-1);
  $("lightbox-next").onclick = () => moveLightbox(1);
  $("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
  document.addEventListener("keydown", (e) => {
    if ($("lightbox").hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") moveLightbox(-1);
    else if (e.key === "ArrowRight") moveLightbox(1);
  });
}

function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }

// ── Small helpers ────────────────────────────────────────────────────────────
function revealApp() {
  const veil = $("loading-veil");
  if (veil) veil.hidden = true;
  $("app").hidden = false;
}

function banner(text) {
  const b = document.createElement("div");
  b.className = "info-banner";
  b.textContent = text;
  $("app").prepend(b);
}

function safeName(name) {
  return (name || "file").replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-60);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
