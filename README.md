# ☁️ The Cloud Corner

A Cinnamoroll-inspired personal planner — a fluffy pastel-blue homepage with a
weekly to-do grid, a master to-do list, a live date card, and page links.
Built with plain **HTML / CSS / JavaScript** and **Firebase** (Auth + Firestore +
Hosting). No build step, no framework.

![theme: pastel sky blue, clouds, sparkles](public/assets/favicon.svg)

## ✨ What it does

- **Weekly planner grid** — Monday → Sunday plus a *Master to-do list*. Add, check
  off, edit (double-click), and delete to-dos. Everything saves to Firestore and
  syncs live across every device you're signed in on.
- **Login** — email/password or one-click Google sign-in. Each person gets their
  own private planner ("Welcome home, _name_!").
- **Date card** — a flip-clock-style tile showing the current month / day / weekday.
- **Page links** — "Main pages" and "Just for fun" rails (seeded with University,
  Habit tracker, Bookish — edit in Firestore or extend later).

## 📁 Project structure

```
public/                  ← everything that gets deployed
  index.html             ← the planner homepage
  login.html             ← sign in / sign up
  css/styles.css         ← the Cinnamoroll cloud theme
  js/
    firebase-config.js   ← YOUR Firebase keys go here  ← edit this
    firebase-init.js     ← shared Firebase setup
    auth.js              ← login/signup logic
    planner.js           ← to-do CRUD + live rendering
    clock.js             ← date card
  assets/                ← SVG clouds + image slots for Cinnamoroll art
firebase.json            ← hosting + emulator config
firestore.rules          ← per-user security rules
.firebaserc              ← your project id
```

## 🚀 Get it running (one-time setup)

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and **Add project**.
2. In the project, open **Build → Authentication → Get started**, and enable
   **Email/Password** and **Google** sign-in providers.
3. Open **Build → Firestore Database → Create database** (start in *production*
   mode — our `firestore.rules` handle access).

### 2. Add your config keys
1. In the Firebase console: **Project settings (⚙️) → Your apps → Web app (`</>`)**
   → register an app.
2. Copy the `firebaseConfig` values it shows you into
   **`public/js/firebase-config.js`** (replace every `REPLACE_ME`).
   > These web keys are *not* secrets — they're safe to commit. Security comes from
   > `firestore.rules`.
3. Also set your project id in **`.firebaserc`** (replace
   `REPLACE_WITH_YOUR_PROJECT_ID`).

### 3. Install the Firebase CLI & sign in
```bash
npm install -g firebase-tools
firebase login
firebase use --add        # pick the project you created
```

### 4. Deploy 🎉
```bash
firebase deploy
```
The CLI prints your live URL, e.g. `https://your-project.web.app`. Open it,
sign up, and start planning!

To update later, just re-run `firebase deploy`.

## 🧪 Preview locally (optional, no deploy)

- **Layout only** (no login/saving) — just open `public/index.html`, or:
  ```bash
  cd public && python3 -m http.server 8000   # → http://localhost:8000
  ```
  Without Firebase keys the app runs in **preview mode**: you'll see the full
  design, and a friendly banner reminds you to add keys to enable saving/login.

- **Full app with Auth + Firestore, locally** — use the Firebase Emulator Suite:
  ```bash
  firebase emulators:start
  ```
  Then open the Hosting emulator URL it prints (default
  <http://localhost:5000>). Create a test account, add/check/delete tasks, reload
  to confirm they persist, and sign out/in to confirm per-user isolation.

## 🎀 Adding real Cinnamoroll art

The design ships with original cloud/sparkle SVGs as stand-ins. To use Cinnamoroll
images, drop your own PNGs into `public/assets/` with these names:

| File | Where it shows |
|------|----------------|
| `cinnamoroll-banner.png` | the top banner (then delete the `hidden` attribute on the `.banner-art` `<img>` in `index.html`) |
| `cinnamoroll-sit.png`    | the little mascot under the welcome callout, and the login card |

If an image file is missing, the app automatically falls back to a ☁️ cloud, so
nothing breaks. (Sanrio art is copyrighted — fine for personal use; please don't
redistribute it.)

## 🔒 Data model

```
users/{uid}                  { displayName, email, createdAt }
users/{uid}/tasks/{taskId}   { text, done, day, createdAt }   # day: monday..sunday | "master"
users/{uid}/pages/{pageId}   { title, emoji, url, section }   # section: "main" | "fun"
```

Have a fluffy day ☁️
