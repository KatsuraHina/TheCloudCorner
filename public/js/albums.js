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
    const prevCover = currentAlbum && currentAlbum.coverPath;
    currentAlbum = { id: snap.id, ...snap.data() };
    paintAlbumChrome();
    // Re-render only when the cover changed, so the ★ highlight follows it
    // (avoids churn from itemCount updates during uploads).
    if (currentAlbum.coverPath !== prevCover) renderMasonry();
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

// Natural aspect ratios (width / height), measured once per URL and cached.
const aspectCache = new Map();
let galleryToken = 0;

function measureAspect(item) {
  if (aspectCache.has(item.url)) return Promise.resolve(aspectCache.get(item.url));
  const fallback = 1.4;
  return new Promise((resolve) => {
    if (item.type === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => {
        const a = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : fallback;
        aspectCache.set(item.url, a); resolve(a);
      };
      v.onerror = () => { aspectCache.set(item.url, fallback); resolve(fallback); };
      v.src = item.url;
    } else {
      const img = new Image();
      img.onload = () => {
        const a = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : fallback;
        aspectCache.set(item.url, a); resolve(a);
      };
      img.onerror = () => { aspectCache.set(item.url, fallback); resolve(fallback); };
      img.src = item.url;
    }
  });
}

async function renderMasonry() {
  const wrap = $("masonry");
  $("gallery-empty").hidden = items.length > 0;
  if (!items.length) { wrap.innerHTML = ""; return; }

  const token = ++galleryToken;
  const list = items.slice();

  const canCurate = (item) =>
    item.ownerUid === currentUid || (currentAlbum && currentAlbum.ownerUid === currentUid);

  wrap.innerHTML = "";
  list.forEach((item, index) => wrap.appendChild(buildCard(item, index, canCurate)));

  // Measure aspect ratios (cached), then lay the rows out justified.
  await Promise.all(list.map(measureAspect));
  if (token !== galleryToken) return; // a newer render superseded this one
  Array.from(wrap.children).forEach((card, i) => {
    card.dataset.aspect = aspectCache.get(list[i].url) || 1.4;
  });
  layoutJustified();
}

function buildCard(item, index, canCurate) {
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
  // Hover actions for curators: set-as-cover (photos only), edit caption, delete.
  const isCover = currentAlbum && item.path && currentAlbum.coverPath === item.path;
  const coverBtn = item.type === "photo"
    ? `<button class="memory-act memory-cover${isCover ? " is-cover" : ""}" type="button"
               title="${isCover ? "This is the album cover" : "Set as album cover"}" aria-label="Set as album cover">★</button>`
    : "";
  const actions = canCurate(item)
    ? `<div class="memory-actions">
         ${coverBtn}
         <button class="memory-act memory-edit" type="button" title="${item.caption ? "Edit caption" : "Add caption"}" aria-label="Edit caption">✎</button>
         <button class="memory-act memory-del" type="button" title="Delete" aria-label="Delete">×</button>
       </div>`
    : "";

  // Placeholder frame height avoids a collapsed flash before layout runs.
  card.innerHTML = `<div class="memory-frame" style="height:240px">${media}</div>${actions}${caption}`;

  card.querySelector(".memory-frame").addEventListener("click", () => openLightbox(index));

  const coverEl = card.querySelector(".memory-cover");
  if (coverEl) coverEl.addEventListener("click", () => setCover(item));

  const editBtn = card.querySelector(".memory-edit");
  if (editBtn) editBtn.addEventListener("click", () => openCaptionModal(item));

  const cap = card.querySelector(".memory-caption");
  if (cap && canCurate(item)) {
    cap.title = "Double-click to edit caption";
    cap.addEventListener("dblclick", () => openCaptionModal(item));
  }

  const delBtn = card.querySelector(".memory-del");
  if (delBtn) delBtn.addEventListener("click", () => deleteItem(item));

  return card;
}

// Google-Photos-style justified rows: greedily pack cards into rows that fill
// the width at a target height; full rows are scaled to fill exactly (uniform
// height, no gaps), and the last row keeps the target height and centers.
const GALLERY_GAP = 14;    // must match .masonry-wrapper gap
const GALLERY_CHROME = 16; // .memory-card horizontal padding (8 + 8), border-box

function layoutJustified() {
  const wrap = $("masonry");
  const cards = Array.from(wrap.children);
  if (!cards.length) return;
  const W = wrap.clientWidth;
  if (!W) return;
  const targetH = W < 600 ? 190 : 250;

  const aspectOf = (c) => Number(c.dataset.aspect) || 1.4;

  const rows = [];
  let row = [];
  for (const card of cards) {
    row.push(card);
    const sumA = row.reduce((s, c) => s + aspectOf(c), 0);
    const need = targetH * sumA + GALLERY_CHROME * row.length + GALLERY_GAP * (row.length - 1);
    if (need >= W) { rows.push({ cards: row, full: true }); row = []; }
  }
  if (row.length) rows.push({ cards: row, full: false });

  for (const r of rows) {
    const sumA = r.cards.reduce((s, c) => s + aspectOf(c), 0);
    const avail = W - GALLERY_CHROME * r.cards.length - GALLERY_GAP * (r.cards.length - 1);
    let h = avail / sumA;
    if (!r.full) h = Math.min(h, targetH); // last row: don't upscale — center it instead
    for (const card of r.cards) {
      const frameW = Math.floor(h * aspectOf(card));
      card.style.width = (frameW + GALLERY_CHROME) + "px";
      card.querySelector(".memory-frame").style.height = Math.floor(h) + "px";
    }
  }
}

async function setCover(item) {
  if (item.type !== "photo") return;
  try {
    const { db, doc, updateDoc } = fb;
    await updateDoc(doc(db, "albums", currentAlbumId), {
      coverUrl: item.url,
      coverPath: item.path,
    });
  } catch (err) {
    console.error(err);
    alert("Couldn't set the cover. Please try again.");
  }
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

  // Re-justify the gallery rows when the window width changes.
  let glResize;
  window.addEventListener("resize", () => {
    if ($("gallery-view").hidden) return;
    clearTimeout(glResize);
    glResize = setTimeout(layoutJustified, 150);
  });

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

// Register the service worker (push notifications + PWA offline shell).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => {});
}
