// ── Firebase setup ──────────────────────────────────────────────
// Replace with the config from your Firebase project settings.
// This is safe to expose publicly — it is not a secret key.
// Real access control happens in Firestore Security Rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  writeBatch,
  deleteField,
  increment,
  limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDfgcIpOgJJeObDrWm_Ce0MuWSI7ZU0lB0",
  authDomain: "drgno-fst.firebaseapp.com",
  projectId: "drgno-fst",
  storageBucket: "drgno-fst.firebasestorage.app",
  messagingSenderId: "91216205592",
  appId: "1:91216205592:web:616c05cd40727421a2b06d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Push notifications (Cloudflare Worker + Web Push) ─────────────
// Fill these in after you deploy the Worker and generate VAPID keys —
// see the setup guide you were given alongside this file. Until
// VAPID_PUBLIC_KEY is filled in, push setup is skipped everywhere, so
// the rest of the app keeps working exactly as before.
const PUSH_WORKER_URL = "https://batchportal-push.batchportal-push.workers.dev";
const VAPID_PUBLIC_KEY = "BAZRsfpXEuMZNY0QOzkFr84aGTxWCxFXwBZtVVWs9uCN0Pt6J8dhMsUExJkF1VfGfyShnnk-KbsgMZGcXtrwFKs";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Registers the service worker and makes sure this device's push
// subscription is saved to Firestore under /pushSubscriptions/{uid}.
// Called silently (requestPermission:false) on every page load so an
// already-granted subscription stays fresh. The Settings page passes
// requestPermission:true from a button click — the only place the
// browser's permission prompt is allowed to appear.
async function ensurePushSubscription(user, { requestPermission = false } = {}) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE")) return "unconfigured";

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      if (Notification.permission === "denied") return "denied";
      if (Notification.permission !== "granted") {
        if (!requestPermission) return "not-subscribed";
        const perm = await Notification.requestPermission();
        if (perm !== "granted") return "denied";
      }
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    await setDoc(
      doc(db, "pushSubscriptions", user.uid),
      { subscriptions: arrayUnion(subscription.toJSON()) },
      { merge: true }
    );
    return "subscribed";
  } catch (err) {
    console.warn("Push setup failed:", err);
    return "error";
  }
}

// Asks the Cloudflare Worker to send a push. "broadcast" types (fund /
// announcement / event / project) go to every batchmate; "task" goes only
// to targetUid. This always fails silently — a missing/unreachable Worker
// must never block the admin's Firestore write, which has already
// succeeded by the time this is called.
async function sendPushNotification({ type, title, message, url, targetUid }) {
  if (!PUSH_WORKER_URL || PUSH_WORKER_URL.includes("YOUR-SUBDOMAIN")) return;
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch(PUSH_WORKER_URL + "/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, type, title, message, url, targetUid })
    });
  } catch (err) {
    console.warn("Push notification could not be sent:", err);
  }
}

// ── Theme (dark/light mode + color palette) ───────────────────────
// The actual application happens instantly on every page load via a
// tiny inline script in each page's <head> (reads the same
// localStorage keys, sets the same attributes) so there's no flash
// of the wrong theme before this module finishes loading. This
// module only needs to persist changes made on the Settings page and
// keep that page's controls in sync with whatever is currently set.
const THEME_MODE_KEY = "theme-mode";
const THEME_PALETTE_KEY = "theme-palette";

function applyTheme(mode, palette) {
  document.documentElement.setAttribute("data-mode", mode);
  document.documentElement.setAttribute("data-palette", palette);
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
    localStorage.setItem(THEME_PALETTE_KEY, palette);
  } catch (err) {
    // localStorage unavailable (private browsing, etc.) — the theme
    // still applies for this page view via the attributes above.
  }
}

// Wires the Appearance section on the Settings page. No-ops on every
// other page since #theme-mode-toggle / #theme-palette-grid won't exist.
function initThemeControls() {
  const modeToggle = document.getElementById("theme-mode-toggle");
  const paletteGrid = document.getElementById("theme-palette-grid");
  if (!modeToggle || !paletteGrid) return;

  function currentMode() {
    try { return localStorage.getItem(THEME_MODE_KEY) || "dark"; }
    catch (err) { return "dark"; }
  }
  function currentPalette() {
    try { return localStorage.getItem(THEME_PALETTE_KEY) || "blue"; }
    catch (err) { return "blue"; }
  }

  function refreshActiveStates(mode, palette) {
    modeToggle.querySelectorAll(".theme-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    paletteGrid.querySelectorAll(".theme-swatch").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.palette === palette);
    });
  }

  refreshActiveStates(currentMode(), currentPalette());

  modeToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-mode-btn");
    if (!btn) return;
    applyTheme(btn.dataset.mode, currentPalette());
    refreshActiveStates(btn.dataset.mode, currentPalette());
  });

  paletteGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".theme-swatch");
    if (!btn) return;
    applyTheme(currentMode(), btn.dataset.palette);
    refreshActiveStates(currentMode(), btn.dataset.palette);
  });
}


// ── Site-wide: modal pop/close animations + page-change transitions ──
// Runs on every page, unconditionally, before anything auth-related —
// the modal markup and nav links are already in the DOM by the time
// this module executes (type="module" scripts run after parsing).
initModalAnimations();
initPageTransitions();

// Every modal on the site is opened/closed elsewhere in this file with
// a plain `overlay.hidden = true` / `= false` — dozens of call sites.
// Rather than touch each one, this shadows the native `hidden`
// property on each .modal-overlay element: opening still removes
// [hidden] immediately (the CSS pop-in animation runs on its own),
// but closing first adds a `.closing` class and waits out the exit
// animation before actually setting [hidden], so every existing
// close call site gets an animated close for free.
function initModalAnimations() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    let hiddenState = overlay.hasAttribute("hidden");
    let closeTimer = null;

    Object.defineProperty(overlay, "hidden", {
      configurable: true,
      get() { return hiddenState; },
      set(value) {
        value = !!value;
        if (value === hiddenState) return;
        clearTimeout(closeTimer);
        if (value) {
          hiddenState = true;
          overlay.classList.add("closing");
          closeTimer = setTimeout(() => {
            overlay.classList.remove("closing");
            overlay.setAttribute("hidden", "");
          }, 180);
        } else {
          hiddenState = false;
          overlay.classList.remove("closing");
          overlay.removeAttribute("hidden");
        }
      }
    });
  });
}

// Intercepts clicks on same-site links (sidebar nav, "View" links, etc.),
// briefly fades the page out, then completes the navigation — external
// links, new-tab links, downloads, in-page "#" links, and modified
// clicks (Ctrl/Cmd/Shift/middle-click, for opening in a new tab) are
// left alone.
function initPageTransitions() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("http") || href.startsWith("mailto:") ||
        href.startsWith("tel:") || link.target === "_blank" || link.hasAttribute("download")) return;

    e.preventDefault();
    document.documentElement.classList.add("page-exit");
    setTimeout(() => { window.location.href = href; }, 150);
  });
}

// ── Login page logic ────────────────────────────────────────────
const loginForm = document.getElementById("login-form");
if (loginForm) {
  const errorMsg = document.getElementById("error-msg");
  const loginBtn = document.getElementById("login-btn");

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.hidden = true;
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.location.href = "home.html";
    } catch (err) {
      errorMsg.textContent = "Sign-in failed. Check your email and password.";
      errorMsg.hidden = false;
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  });

  // If already signed in, skip straight to the home page.
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = "home.html";
  });
}

// ── Shared logic for every page that has the sidebar ────────────
const sidebar = document.getElementById("sidebar");
if (sidebar) {
  const menuToggle = document.getElementById("menu-toggle");
  const overlay = document.getElementById("sidebar-overlay");
  const userEmailEl = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");

  function openMenu() { 
  sidebar.classList.add("open"); 
  overlay.classList.add("show"); 
  menuToggle?.classList.add("hidden");
}

function closeMenu() { 
  sidebar.classList.remove("open"); 
  overlay.classList.remove("show"); 
  menuToggle?.classList.remove("hidden");
}

  menuToggle?.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeMenu() : openMenu();
  });
  overlay?.addEventListener("click", closeMenu);

  logoutBtn?.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    if (userEmailEl) userEmailEl.textContent = user.email;

    // Silently keep this device's push subscription up to date. Never
    // prompts and never blocks the rest of the page from loading.
    ensurePushSubscription(user);

    const isAdmin = await checkIsAdmin(user.uid);
    const adminNavLink = document.getElementById("admin-nav-link");
    if (adminNavLink) adminNavLink.hidden = !isAdmin;

    if (document.getElementById("home-content")) await initHomePage(user);
    if (document.getElementById("wall-content")) await initWallPage();
    if (document.getElementById("badges-content")) await initBadgesPage(user);
    if (document.getElementById("record")) await initDashboardPage(user);
    if (document.getElementById("fund-page")) await initFundPage(user);
    if (document.getElementById("settings-page")) initSettingsPage(user);
    if (document.getElementById("admin-page")) await initAdminPage(isAdmin);
  });
}

// Checks whether the signed-in user has a document in /admins — this is
// the "passkey" collection. Existence of the doc = admin, nothing else
// needed. The real enforcement is in Firestore rules, not this check —
// this just controls what the UI shows.
async function checkIsAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    return snap.exists();
  } catch (err) {
    return false; // no admin doc, or read denied — treat as not-admin
  }
}

// ── Field render helpers (shared by dashboard) ───────────────────
function fieldRow(label, value) {
  const wrap = document.createElement("div");
  wrap.style.marginBottom = "14px";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  labelEl.style.display = "block";
  labelEl.style.fontSize = "11.5px";
  labelEl.style.color = "var(--muted)";
  labelEl.style.marginBottom = "2px";

  const valueEl = document.createElement("span");
  valueEl.textContent = (value === undefined || value === null || value === "") ? "—" : value;
  valueEl.style.fontSize = "14px";

  wrap.appendChild(labelEl);
  wrap.appendChild(valueEl);
  return wrap;
}

function fillGroup(elId, rows) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  rows.forEach(([label, value]) => el.appendChild(fieldRow(label, value)));
}

function fillPills(elId, items, emptyText, colorFn) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    li.style.background = "transparent";
    li.style.border = "none";
    li.style.color = "var(--muted)";
    li.style.padding = "0";
    el.appendChild(li);
    return;
  }
  list.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    if (colorFn) {
      const c = colorFn(item);
      li.style.background = c.bg;
      li.style.borderColor = c.border;
      li.style.color = c.text;
    }
    el.appendChild(li);
  });
}

// Shared named color palette — used for role pills (auto-assigned by hash)
// and event labels (admin-chosen by name from this same set, so the whole
// site stays visually consistent).
const LABEL_COLORS = {
  blue:   { bg: "#1E3A6E", border: "#2A5AD6", text: "#BFD3FF" },
  violet: { bg: "#3A1E5E", border: "#7C4DFF", text: "#D9C8FF" },
  teal:   { bg: "#0F4A3E", border: "#1FAE87", text: "#B6F2E1" },
  amber:  { bg: "#5E3A12", border: "#D6942A", text: "#FFE1B0" },
  rose:   { bg: "#5E1E2E", border: "#D6426E", text: "#FFC2D4" },
  cyan:   { bg: "#1E4A5E", border: "#2AACD6", text: "#BDEFFF" },
  lime:   { bg: "#3E5E1E", border: "#8FD62A", text: "#E4FFB0" }
};
const ROLE_PALETTE = Object.values(LABEL_COLORS);

function colorForRole(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ROLE_PALETTE[hash % ROLE_PALETTE.length];
}

function colorForLabelKey(key) {
  return LABEL_COLORS[key] || LABEL_COLORS.blue;
}

// Read-only badge list for the Records Details section — shows a
// batchmate's FULL task history (ongoing, pending verification, complete).
function renderTaskHistory(elId, tasks) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  if (tasks.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No tasks recorded.";
    li.classList.add("muted-list");
    el.appendChild(li);
    return;
  }
  tasks.forEach((task) => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.gap = "10px";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = task.taskName || "Untitled task";

    const badge = document.createElement("span");
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "600";
    badge.style.padding = "3px 10px";
    badge.style.borderRadius = "999px";
    badge.style.flexShrink = "0";

    if (task.status === "complete") {
      badge.textContent = "Complete";
      badge.style.background = "#0F4A3E";
      badge.style.color = "#7CE8C6";
      badge.style.border = "1px solid #1FAE87";
    } else if (task.status === "pending") {
      badge.textContent = "Pending Verification";
      badge.style.background = "#5E3A12";
      badge.style.color = "#FFC97A";
      badge.style.border = "1px solid #D6942A";
    } else {
      badge.textContent = "Ongoing";
      badge.style.background = "#1E3A6E";
      badge.style.color = "#BFD3FF";
      badge.style.border = "1px solid #2A5AD6";
    }

    li.appendChild(nameSpan);
    li.appendChild(badge);
    el.appendChild(li);
  });
}

// Tap-to-open task boxes for the top-of-dashboard "Active Tasks" card.
// Each box shows the task name and a live "Ongoing" (or "Pending
// Verification") indicator with a blinking dot. Tapping a box opens
// the task detail popup (name, description, due date, remaining-time
// indicator, and a "Notify me that task is completed" button — the
// action that flips the task from "ongoing" to "pending").
function renderActiveTasksCard(tasks) {
  const list = document.getElementById("active-tasks-list");
  list.innerHTML = "";

  const active = tasks.filter((t) => t.status !== "complete");
  if (active.length === 0) {
    list.innerHTML = '<p class="info-text" style="color:var(--muted)">No active tasks right now.</p>';
    return;
  }

  active.forEach((task) => {
    const box = document.createElement("div");
    box.className = "task-box";

    const name = document.createElement("div");
    name.className = "task-box-name";
    name.textContent = task.taskName || "Untitled task";
    box.appendChild(name);

    const isPending = task.status === "pending";
    const indicator = document.createElement("div");
    indicator.className = "task-box-indicator " + (isPending ? "pending" : "ongoing");
    indicator.innerHTML = '<span class="status-dot"></span>' + (isPending ? "Pending Verification" : "Ongoing");
    box.appendChild(indicator);

    box.addEventListener("click", () => openTaskModal(task));
    list.appendChild(box);
  });
}

function formatTaskDue(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

// Plain (non-ticking) remaining-time readout for a date-only due date —
// tasks only store a date, not a time, so a live per-second countdown
// (like the Upcoming Events one) isn't meaningful here.
function taskRemainingText(dateStr) {
  const target = new Date(dateStr + "T23:59:59");
  if (isNaN(target)) return "";
  const diffMs = target - new Date();
  if (diffMs <= 0) return "Overdue";
  const days = Math.floor(diffMs / 86400000);
  const hours = Math.floor((diffMs % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  return `${hours}h ${minutes}m remaining`;
}

let openTaskId = null;

function openTaskModal(task) {
  openTaskId = task.id;

  document.getElementById("task-modal-title").textContent = task.taskName || "Untitled task";

  const isPending = task.status === "pending";
  const statusBadge = document.getElementById("task-modal-status");
  statusBadge.textContent = isPending ? "Pending Verification" : "Ongoing";
  statusBadge.className = "status-badge " + (isPending ? "status-pending-badge" : "status-ongoing");

  document.getElementById("task-modal-desc").textContent = task.description || "No description provided.";
  document.getElementById("task-modal-due").textContent = task.dueDate ? formatTaskDue(task.dueDate) : "No due date set.";

  const remainingEl = document.getElementById("task-modal-remaining");
  if (task.dueDate && !isPending) {
    remainingEl.textContent = taskRemainingText(task.dueDate);
    remainingEl.hidden = false;
  } else {
    remainingEl.textContent = "";
    remainingEl.hidden = true;
  }

  const notifyBtn = document.getElementById("task-notify-btn");
  const noteEl = document.getElementById("task-modal-note");
  noteEl.textContent = "";
  if (isPending) {
    notifyBtn.hidden = true;
    noteEl.textContent = "Marked done — waiting for admin to verify.";
  } else {
    notifyBtn.hidden = false;
    notifyBtn.disabled = false;
    notifyBtn.textContent = "Notify Completed";
  }

  document.getElementById("task-modal-overlay").hidden = false;
}

function wireTaskModal() {
  const overlay = document.getElementById("task-modal-overlay");
  if (!overlay) return;
  const closeBtn = document.getElementById("task-modal-close");
  const notifyBtn = document.getElementById("task-notify-btn");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });

  notifyBtn.addEventListener("click", async () => {
    if (!openTaskId) return;
    notifyBtn.disabled = true;
    notifyBtn.textContent = "Notifying…";
    try {
      await markTaskDone(openTaskId);
      closeModal();
      if (auth.currentUser) await loadAndRenderTasks(auth.currentUser.uid);
    } catch (err) {
      notifyBtn.disabled = false;
      notifyBtn.textContent = "Notify Completed";
      alert("Could not update this task. Please try again.");
    }
  });
}

// Flips a task from "ongoing" to "pending" — the only change a batchmate
// is allowed to make, enforced by the Firestore security rule.
// completionRequestedAt records the date the batchmate actually said
// "done" — used at verification time to judge the deadline fairly, since
// an admin might not get to Verify until days later.
async function markTaskDone(taskId) {
  await updateDoc(doc(db, "tasks", taskId), {
    status: "pending",
    completionRequestedAt: new Date().toISOString().slice(0, 10)
  });
}

async function loadAndRenderTasks(uid) {
  const q = query(collection(db, "tasks"), where("assignedToUid", "==", uid));
  const snap = await getDocs(q);
  const tasks = [];
  snap.forEach((docSnap) => tasks.push({ id: docSnap.id, ...docSnap.data() }));

  renderActiveTasksCard(tasks);
  renderTaskHistory("f-tasks", tasks);
}

function fillLines(elId, items, emptyText) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  const list = Array.isArray(items) ? items : (items ? [items] : []);
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = emptyText;
    li.classList.add("muted-list");
    el.appendChild(li);
    return;
  }
  list.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

// ── Dashboard page ───────────────────────────────────────────────
// ── Prestige engine ──────────────────────────────────────────────
// The single reusable path every prestige-earning method (tasks, group
// projects, fund donations) writes through, so the "bad behavior slows
// earning speed" rule only has to live in one place. Called from admin
// actions (task verify, project/rating completion, fund transaction
// save), never directly from a batchmate's own client.
//
// Multiplier: each bad behavior record on file cuts earning speed by
// 15%, floored at 25% (so it always earns *something*, just slowly).
// This exact curve wasn't specified — it's a reasonable default; tune
// BAD_BEHAVIOR_STEP / BAD_BEHAVIOR_FLOOR below if you want it harsher
// or gentler.
const BAD_BEHAVIOR_STEP = 0.15;
const BAD_BEHAVIOR_FLOOR = 0.25;
const FUND_LKR_PER_POINT = 100; // every Rs. 100 a student personally donates = 1 prestige point

function badBehaviorMultiplier(count) {
  const n = Number(count) || 0;
  return Math.max(BAD_BEHAVIOR_FLOOR, 1 - BAD_BEHAVIOR_STEP * n);
}

// rawAmount: points before the bad-behavior multiplier is applied.
// source: short machine tag, e.g. "task", "project-overall",
//   "project-group", "member-rating", "leader-rating", "fund-donation".
// note: human-readable line for the batchmate's own prestige history.
// Returns the final (post-multiplier) amount actually awarded.
async function awardPrestige({ uid, rawAmount, source, note }) {
  if (!uid || !rawAmount) return 0;

  const bmSnap = await getDoc(doc(db, "batchmates", uid));
  const badCount = bmSnap.exists() && Array.isArray(bmSnap.data().badBehaviorRecords)
    ? bmSnap.data().badBehaviorRecords.length
    : 0;

  const multiplier = badBehaviorMultiplier(badCount);
  const finalAmount = Math.round(rawAmount * multiplier);

  await updateDoc(doc(db, "batchmates", uid), {
    prestigePoints: increment(finalAmount)
  });

  // NOT mirrored to batchmatesPublic — batchmates should be able to see
  // their own total (Dashboard, self-read on /batchmates) but not each
  // other's. The Admin leaderboard reads /batchmates directly instead,
  // using the admin-read bypass added in the prestige engine's first
  // pass.

  await addDoc(collection(db, "prestigeLog"), {
    uid,
    source,
    note: note || "",
    rawAmount,
    multiplier,
    badBehaviorCount: badCount,
    finalAmount,
    createdAt: serverTimestamp()
  });

  return finalAmount;
}

// Dashboard: a batchmate's own running total + recent history.
// batchmateData is the already-fetched /batchmates/{uid} doc data
// (from initDashboardPage), passed in to avoid a duplicate read.
async function loadAndRenderPrestige(uid, batchmateData) {
  const totalEl = document.getElementById("f-prestige-total");
  const noteEl = document.getElementById("f-prestige-note");
  const listEl = document.getElementById("prestige-log-list");
  if (!totalEl || !listEl) return;

  const d = batchmateData || {};
  const total = Number(d.prestigePoints) || 0;
  const badCount = Array.isArray(d.badBehaviorRecords) ? d.badBehaviorRecords.length : 0;
  totalEl.textContent = total.toLocaleString();

  const fundEl = document.getElementById("f-fund-donated-value");
  if (fundEl) {
    const donated = Number(d.fundDonated) || 0;
    fundEl.textContent = `Rs. ${donated.toLocaleString()}`;
  }

  if (noteEl) {
    if (badCount > 0) {
      const pct = Math.round(badBehaviorMultiplier(badCount) * 100);
      noteEl.textContent = `Earning speed reduced to ${pct}% by ${badCount} bad behavior record${badCount === 1 ? "" : "s"}.`;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }

  try {
    const q = query(
      collection(db, "prestigeLog"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(15)
    );
    const snap = await getDocs(q);
    listEl.innerHTML = "";

    if (snap.empty) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No prestige activity yet.</p>';
      return;
    }

    snap.forEach((docSnap) => {
      const e = docSnap.data();
      const row = document.createElement("div");
      row.className = "prestige-log-item";

      const left = document.createElement("div");
      left.className = "prestige-log-note";
      left.textContent = e.note || e.source || "Prestige update";

      const right = document.createElement("div");
      const amount = Number(e.finalAmount) || 0;
      right.className = "prestige-log-amount " + (amount < 0 ? "prestige-negative" : "prestige-positive");
      right.textContent = (amount > 0 ? "+" : "") + amount;

      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Could not load prestige history.</p>';
  }
}

// ── Prestige info modal (Dashboard) ──────────────────────────────
// Explains every way prestige points are earned and what slows down how
// fast they're earned. Built from the same constants the award functions
// actually use (TASK_DIFFICULTY_POINTS, OVERALL_RATING_POINTS_PER_STAR,
// etc. — defined further down this file, but already initialized by the
// time a batchmate can click the info button), so this can't drift out of
// sync with what actually gets awarded.
function buildPrestigeInfoBody() {
  const body = document.createElement("div");

  function section(heading, note) {
    const wrap = document.createElement("div");
    wrap.className = "prestige-info-section";
    const h = document.createElement("p");
    h.className = "prestige-info-heading";
    h.textContent = heading;
    wrap.appendChild(h);
    if (note) {
      const p = document.createElement("p");
      p.className = "fine-print";
      p.style.cssText = "text-align:left; margin:0 0 10px;";
      p.textContent = note;
      wrap.appendChild(p);
    }
    body.appendChild(wrap);
    return wrap;
  }

  function list(wrap, rows) {
    const ul = document.createElement("ul");
    ul.className = "prestige-info-list";
    rows.forEach(([label, points, negative]) => {
      const li = document.createElement("li");
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      const pointsSpan = document.createElement("span");
      pointsSpan.className = "prestige-info-points" + (negative ? " prestige-negative" : "");
      pointsSpan.textContent = points;
      li.appendChild(labelSpan);
      li.appendChild(pointsSpan);
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  // Tasks
  const taskWrap = section(
    "Tasks",
    "An admin assigns you a task with a difficulty. Finishing it by the due date earns the difficulty's base points; the admin's 1-10 rating on the task always adds points too, even if the deadline was missed."
  );
  list(taskWrap, [
    ["Easy task, finished on time", `+${TASK_DIFFICULTY_POINTS.easy}`],
    ["Medium task, finished on time", `+${TASK_DIFFICULTY_POINTS.medium}`],
    ["Hard task, finished on time", `+${TASK_DIFFICULTY_POINTS.hard}`],
    ["Nightmare task, finished on time", `+${TASK_DIFFICULTY_POINTS.nightmare}`],
    ["Admin's rating (1-10) on any task", `+${TASK_RATING_POINTS_PER_STAR} to +${10 * TASK_RATING_POINTS_PER_STAR}`]
  ]);

  // Group projects
  const projWrap = section(
    "Group Projects",
    "Two ways an admin can award a whole project or a single group, plus ratings batchmates give each other once everyone on a group has rated."
  );
  list(projWrap, [
    ["Admin's overall project rating (1-10) — paid to every group's members + leaders", `+${OVERALL_RATING_POINTS_PER_STAR} to +${10 * OVERALL_RATING_POINTS_PER_STAR}`],
    ["Admin's single-group rating (1-10) — paid to that group's members + leader", `+${GROUP_RATING_POINTS_PER_STAR} to +${10 * GROUP_RATING_POINTS_PER_STAR}`],
    [`Peer/leader ratings of you, averaged (your leader's rating counts ${LEADER_RATING_WEIGHT}× a peer's)`, `+${MEMBER_RATING_POINTS_PER_STAR} to +${10 * MEMBER_RATING_POINTS_PER_STAR}`],
    ["If you're a leader: your members' ratings of you, averaged", `+${LEADER_RATING_POINTS_PER_STAR} to +${10 * LEADER_RATING_POINTS_PER_STAR}`]
  ]);

  // Fund donations
  const fundWrap = section("Fund Donations");
  list(fundWrap, [
    [`Every Rs. ${FUND_LKR_PER_POINT} you personally donate to the batch fund`, "+1"]
  ]);

  // What slows earning down
  const floorRecords = Math.ceil((1 - BAD_BEHAVIOR_FLOOR) / BAD_BEHAVIOR_STEP);
  const badWrap = section(
    "What Slows You Down",
    `Each bad behavior record on file cuts how fast you earn every point above by ${Math.round(BAD_BEHAVIOR_STEP * 100)}%, down to a floor of ${Math.round(BAD_BEHAVIOR_FLOOR * 100)}% speed at ${floorRecords}+ records. It slows down future awards — it never removes points you've already earned.`
  );
  const exampleBase = TASK_DIFFICULTY_POINTS.hard;
  const exampleAwarded = Math.round(exampleBase * badBehaviorMultiplier(2));
  const example = document.createElement("p");
  example.className = "fine-print";
  example.style.cssText = "text-align:left; margin:0;";
  example.textContent = `Example: with 2 bad behavior records on file, a Hard task (normally ${exampleBase} points on time) only awards ${exampleAwarded} of those points.`;
  badWrap.appendChild(example);

  const closingNote = document.createElement("p");
  closingNote.className = "fine-print";
  closingNote.style.cssText = "text-align:left; margin:14px 0 0;";
  closingNote.textContent = "Every award — positive or negative — shows up in your prestige history below, with a note on what it was for.";
  body.appendChild(closingNote);

  return body;
}

function openPrestigeInfoModal() {
  const overlay = document.getElementById("prestige-info-modal-overlay");
  const container = document.getElementById("prestige-info-body");
  if (!overlay || !container) return;
  container.innerHTML = "";
  container.appendChild(buildPrestigeInfoBody());
  overlay.hidden = false;
}

function wirePrestigeInfoModal() {
  const overlay = document.getElementById("prestige-info-modal-overlay");
  const btn = document.getElementById("prestige-info-btn");
  if (!overlay || !btn) return;
  const closeBtn = document.getElementById("prestige-info-modal-close");

  function closeModal() { overlay.hidden = true; }

  btn.addEventListener("click", openPrestigeInfoModal);
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

async function initDashboardPage(user) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const recordSection = document.getElementById("record");

  try {
    // Each user's UID is the Firestore document ID under "batchmates".
    // Security rules ensure a user can only read the doc matching their own UID.
    const snap = await getDoc(doc(db, "batchmates", user.uid));

    if (!snap.exists()) {
      loadingState.hidden = true;
      errorState.hidden = false;
      errorState.textContent = "No record has been set up for your account yet. Contact your batch admin.";
      return;
    }

    renderRecord(snap.data());
    await loadAndRenderTasks(user.uid);
    await loadAndRenderPrestige(user.uid, snap.data());
    wireTaskModal();
    wirePrestigeInfoModal();
    loadingState.hidden = true;
    recordSection.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load your record. Please try again later.";
  }
}

function renderRecord(d) {
  const fullName = d.fullName || "—";
  document.getElementById("f-fullName").textContent = fullName;

  const avatarPhoto = document.getElementById("avatar-photo");
  const avatarInitial = document.getElementById("avatar-initial");
  const photoUrl = (d.photoUrl || "").trim();
  avatarInitial.textContent = fullName.charAt(0).toUpperCase();

  if (photoUrl) {
    avatarPhoto.onerror = () => {
      avatarPhoto.hidden = true;
      avatarInitial.style.display = "";
    };
    avatarPhoto.src = photoUrl;
    avatarPhoto.hidden = false;
    avatarInitial.style.display = "none";
  } else {
    avatarPhoto.hidden = true;
    avatarInitial.style.display = "";
  }
  document.getElementById("f-gender").textContent = d.gender || "—";
  document.getElementById("f-district").textContent = d.district || "—";

  fillGroup("grp-person", [
    ["Full Name", d.fullName],
    ["Gender", d.gender],
    ["Birthday", d.birthday],
    ["NIC Number", d.nicNumber],
    ["Address", d.address],
    ["District", d.district]
  ]);

  fillGroup("grp-campus", [
    ["Campus Index Number", d.campusIndexNumber],
    ["Campus Registration Number", d.campusRegNumber]
  ]);

  fillGroup("grp-contact", [
    ["Primary Mobile Number", d.primaryMobile],
    ["Alternative Numbers", Array.isArray(d.alternativeNumbers) ? d.alternativeNumbers.join(", ") : d.alternativeNumbers],
    ["University Email", d.universityEmail],
    ["Personal Email", d.personalEmail]
  ]);

  fillGroup("grp-residential", [
    ["Residential Status", d.residentialStatus],
    ["Residential Address", d.residentialAddress]
  ]);

  fillGroup("grp-medical", [
    ["Blood Group", d.bloodGroup],
    ["Dietary Option", d.dietaryOption],
    ["Severe Medical Conditions", d.severeMedicalConditions],
    ["Food Allergies", d.foodAllergies],
    ["Chemical Allergies", d.chemicalAllergies]
  ]);

  fillGroup("grp-emergency", [
    ["Emergency Contact Person Name", d.emergencyContactName],
    ["Emergency Contact Person Relationship", d.emergencyRelationship],
    ["Primary Emergency Number", d.primaryEmergencyNumber],
    ["Secondary Emergency Number", d.secondaryEmergencyNumber]
  ]);

  fillPills("f-sports", d.sports, "No sports recorded.");
  fillPills("f-clubs", d.clubs, "No clubs recorded.");
  fillPills("f-skills", d.skills, "No skills recorded.");

  fillPills("f-roles", d.roles, "No roles assigned yet.", colorForRole);
  fillLines("f-bad", d.badBehaviorRecords, "No records — clean sheet.");
}

// ── Fund page ─────────────────────────────────────────────────────
// Reads every document in the "fundTransactions" collection and
// calculates totals client-side. Each transaction doc looks like:
//   { type: "income" | "expense", amount: 1500, description: "...", date: "2026-09-01" }
// Firestore security rules: any signed-in batchmate can READ this
// collection (fund transparency), but never write to it directly.
async function initFundPage(user) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const fundContent = document.getElementById("fund-content");

  function formatCurrency(n) {
    return "Rs. " + n.toLocaleString("en-LK", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  try {
    const q = query(collection(db, "fundTransactions"), orderBy("date", "desc"));
    const snap = await getDocs(q);

    let totalIncome = 0;
    let totalExpense = 0;
    const rows = [];

    snap.forEach((docSnap) => {
      const tx = docSnap.data();
      const amount = Number(tx.amount) || 0;
      const type = (tx.type || "").toLowerCase();

      if (type === "income") totalIncome += amount;
      else if (type === "expense") totalExpense += amount;

      rows.push({
        description: tx.description || "Untitled transaction",
        date: tx.date || "",
        type,
        amount
      });
    });

    const balance = totalIncome - totalExpense;

    document.getElementById("f-total-income").textContent = formatCurrency(totalIncome);
    document.getElementById("f-total-expense").textContent = formatCurrency(totalExpense);
    document.getElementById("f-balance").textContent = formatCurrency(balance);

    const txList = document.getElementById("tx-list");
    txList.innerHTML = "";

    if (rows.length === 0) {
      const li = document.createElement("li");
      li.className = "tx-row";
      li.textContent = "No transactions recorded yet.";
      txList.appendChild(li);
    } else {
      rows.forEach((tx) => {
        const li = document.createElement("li");
        li.className = "tx-row";

        const left = document.createElement("div");
        const desc = document.createElement("span");
        desc.className = "tx-desc";
        desc.textContent = tx.description;
        const date = document.createElement("span");
        date.className = "tx-date";
        date.textContent = tx.date;
        left.appendChild(desc);
        left.appendChild(date);

        const amountEl = document.createElement("span");
        const isIncome = tx.type === "income";
        amountEl.className = "tx-amount " + (isIncome ? "income" : "expense");
        amountEl.textContent = (isIncome ? "+ " : "− ") + formatCurrency(tx.amount);

        li.appendChild(left);
        li.appendChild(amountEl);
        txList.appendChild(li);
      });
    }

    loadingState.hidden = true;
    fundContent.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load fund records. Please try again later.";
  }
}

// ── Settings page ─────────────────────────────────────────────────
function initSettingsPage(user) {
  initThemeControls();

  const form = document.getElementById("password-form");
  const errorEl = document.getElementById("password-error");
  const successEl = document.getElementById("password-success");
  const submitBtn = document.getElementById("password-btn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;

    if (newPassword !== confirmPassword) {
      errorEl.textContent = "New password and confirmation don't match.";
      errorEl.hidden = false;
      return;
    }
    if (newPassword.length < 6) {
      errorEl.textContent = "New password must be at least 6 characters.";
      errorEl.hidden = false;
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Updating…";

    try {
      // Firebase requires a recent sign-in before allowing a password change.
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      successEl.textContent = "Password updated successfully.";
      successEl.hidden = false;
      form.reset();
    } catch (err) {
      errorEl.textContent = "Could not update password — check your current password and try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Update password";
    }
  });

  // Push notifications toggle
  const pushBtn = document.getElementById("enable-push-btn");
  const pushStatus = document.getElementById("push-status");

  const PUSH_STATUS_MESSAGES = {
    subscribed: "Notifications are enabled on this device.",
    denied: "Notifications are blocked for this site — enable them in your browser's site settings, then tap the button again.",
    unsupported: "This browser doesn't support push notifications.",
    unconfigured: "Push notifications haven't been set up for this site yet.",
    "not-subscribed": "Not enabled on this device yet.",
    error: "Something went wrong setting up notifications. Please try again."
  };

  function renderPushStatus(result) {
    if (!pushStatus) return;
    pushStatus.textContent = PUSH_STATUS_MESSAGES[result] || "";
  }

  if (pushBtn) {
    // Reflect current status without prompting.
    ensurePushSubscription(user).then(renderPushStatus);

    pushBtn.addEventListener("click", async () => {
      pushBtn.disabled = true;
      pushBtn.textContent = "Enabling…";
      const result = await ensurePushSubscription(user, { requestPermission: true });
      pushBtn.disabled = false;
      pushBtn.textContent = "Enable notifications";
      renderPushStatus(result);
    });
  }

  // Directory Privacy toggle — writes the user's own doc in
  // /directoryPrivacy/{uid}: { hidden: true|false }. No doc, or
  // hidden === false, means visible (the default).
  initPrivacyToggle(user);

  // Request to Change Details — writes a doc to /changeRequests for an
  // admin to review; never writes to /batchmates directly.
  initChangeRequestSection(user);
}

async function initPrivacyToggle(user) {
  const toggle = document.getElementById("privacy-toggle");
  const statusEl = document.getElementById("privacy-status");
  if (!toggle) return;

  function refreshActiveState(isHidden) {
    toggle.querySelectorAll(".theme-mode-btn").forEach((btn) => {
      btn.classList.toggle("active", (btn.dataset.visibility === "hidden") === isHidden);
    });
    statusEl.textContent = isHidden
      ? "Your profile details are hidden from other batchmates in the directory."
      : "Your profile details are visible to other batchmates in the directory.";
  }

  let currentlyHidden = false;
  try {
    const snap = await getDoc(doc(db, "directoryPrivacy", user.uid));
    currentlyHidden = snap.exists() && snap.data().hidden === true;
  } catch (err) {
    // Fall back to "visible" if the read fails for any reason.
  }
  refreshActiveState(currentlyHidden);

  toggle.addEventListener("click", async (e) => {
    const btn = e.target.closest(".theme-mode-btn");
    if (!btn) return;
    const wantHidden = btn.dataset.visibility === "hidden";
    if (wantHidden === currentlyHidden) return;

    toggle.querySelectorAll(".theme-mode-btn").forEach((b) => (b.disabled = true));
    statusEl.textContent = "Saving…";
    try {
      await setDoc(doc(db, "directoryPrivacy", user.uid), { hidden: wantHidden }, { merge: true });
      currentlyHidden = wantHidden;
      refreshActiveState(currentlyHidden);
    } catch (err) {
      statusEl.textContent = "Could not update this setting — please try again.";
    } finally {
      toggle.querySelectorAll(".theme-mode-btn").forEach((b) => (b.disabled = false));
    }
  });
}

// ── Request to Change Details (Settings page) ─────────────────────
// A batchmate can ask to update their own /batchmates fields. Nothing
// is written to /batchmates directly — a doc is created in
// /changeRequests and an admin approves it from the Admin page, which
// is what actually writes the change (see admin section below).
//
// Fields left out here on purpose stay admin-only: campusIndexNumber /
// campusRegNumber (identity/record-keeping), universityEmail (this is
// the batchmate's login email — changing it here wouldn't change their
// actual sign-in), roles, tasks, badBehaviorRecords, photoUrl.
//
// "public: true" marks a field that also lives in the smaller
// "batchmatesPublic" mirror (see sync-batchmates-public.js) — an
// approved change to one of these must be written to BOTH collections.
const CHANGE_REQUEST_GROUPS = [
  {
    label: "Person Details",
    fields: [
      { key: "fullName", label: "Full Name", public: true },
      { key: "birthday", label: "Birthday", public: true },
      { key: "nicNumber", label: "NIC Number" },
      { key: "address", label: "Address" },
      { key: "district", label: "District" }
    ]
  },
  {
    label: "Contact Options",
    fields: [
      { key: "primaryMobile", label: "Primary Mobile Number", public: true },
      { key: "alternativeNumbers", label: "Alternative Numbers (comma-separated)", list: true },
      { key: "personalEmail", label: "Personal Email" }
    ]
  },
  {
    label: "Residential Details",
    fields: [
      { key: "residentialStatus", label: "Residential Status" },
      { key: "residentialAddress", label: "Residential Address" }
    ]
  },
  {
    label: "Medical Details",
    fields: [
      { key: "bloodGroup", label: "Blood Group" },
      { key: "dietaryOption", label: "Dietary Option" },
      { key: "severeMedicalConditions", label: "Severe Medical Conditions" },
      { key: "foodAllergies", label: "Food Allergies" },
      { key: "chemicalAllergies", label: "Chemical Allergies" }
    ]
  },
  {
    label: "Emergency Details",
    fields: [
      { key: "emergencyContactName", label: "Emergency Contact Person Name" },
      { key: "emergencyRelationship", label: "Emergency Contact Person Relationship" },
      { key: "primaryEmergencyNumber", label: "Primary Emergency Number" },
      { key: "secondaryEmergencyNumber", label: "Secondary Emergency Number" }
    ]
  },
  {
    label: "Extracurricular",
    fields: [
      { key: "sports", label: "Sports (comma-separated)", list: true, public: true },
      { key: "clubs", label: "Clubs (comma-separated)", list: true, public: true },
      { key: "skills", label: "Skills (comma-separated)", list: true, public: true }
    ]
  }
];

// Flat lookup ({ key: { label, list, public } }) built from the groups
// above — used by the Admin page's Detail Change Requests panel to show
// a friendly label for each changed field.
const CHANGE_REQUEST_FIELD_INFO = {};
CHANGE_REQUEST_GROUPS.forEach((group) => {
  group.fields.forEach((f) => { CHANGE_REQUEST_FIELD_INFO[f.key] = f; });
});

function crToInputValue(value, isList) {
  if (isList) return Array.isArray(value) ? value.join(", ") : (value || "");
  return value == null ? "" : String(value);
}
function crFromInputValue(raw, isList) {
  if (isList) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw.trim();
}
function crValuesEqual(a, b, isList) {
  if (isList) {
    const arrA = Array.isArray(a) ? a : [];
    const arrB = Array.isArray(b) ? b : [];
    return arrA.length === arrB.length && arrA.every((v, i) => v === arrB[i]);
  }
  return (a == null ? "" : String(a)) === (b == null ? "" : String(b));
}

function buildChangeRequestFields(container, baseData) {
  container.innerHTML = "";
  CHANGE_REQUEST_GROUPS.forEach((group) => {
    const heading = document.createElement("p");
    heading.className = "section-label";
    heading.style.cssText = "margin-top:14px;margin-bottom:6px;opacity:.7";
    heading.textContent = group.label;
    container.appendChild(heading);

    group.fields.forEach((f) => {
      const label = document.createElement("label");
      label.setAttribute("for", "cr-" + f.key);
      label.textContent = f.label;
      container.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.id = "cr-" + f.key;
      input.value = crToInputValue(baseData[f.key], !!f.list);
      container.appendChild(input);
    });
  });
}

async function initChangeRequestSection(user) {
  const openBtn = document.getElementById("open-change-request-btn");
  if (!openBtn) return;

  const statusEl = document.getElementById("change-request-status");
  const overlay = document.getElementById("change-request-modal-overlay");
  const closeBtn = document.getElementById("change-request-modal-close");
  const fieldsContainer = document.getElementById("change-request-fields");
  const form = document.getElementById("change-request-form");
  const submitBtn = document.getElementById("change-request-submit-btn");
  const errorEl = document.getElementById("change-request-error");

  let liveData = {};
  let pendingRequestId = null;
  let pendingChanges = {};

  async function refreshPendingStatus() {
    const q = query(
      collection(db, "changeRequests"),
      where("uid", "==", user.uid),
      where("status", "==", "pending")
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      pendingRequestId = d.id;
      pendingChanges = d.data().changes || {};
      statusEl.textContent = "You have a pending request awaiting admin review. Opening the form again will let you revise it.";
      openBtn.textContent = "Update Request";
    } else {
      pendingRequestId = null;
      pendingChanges = {};
      statusEl.textContent = "";
      openBtn.textContent = "Request Changes";
    }
  }

  await refreshPendingStatus();

  function closeModal() {
    overlay.hidden = true;
  }
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  openBtn.addEventListener("click", async () => {
    openBtn.disabled = true;
    try {
      const snap = await getDoc(doc(db, "batchmates", user.uid));
      liveData = snap.exists() ? snap.data() : {};
    } catch (err) {
      liveData = {};
    }
    // Prefill from the live profile, but let any still-pending proposed
    // edits take precedence so the user picks up where they left off.
    const displayData = { ...liveData, ...pendingChanges };
    buildChangeRequestFields(fieldsContainer, displayData);
    errorEl.hidden = true;
    overlay.hidden = false;
    openBtn.disabled = false;
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    const changes = {};
    const previousValues = {};
    CHANGE_REQUEST_GROUPS.forEach((group) => {
      group.fields.forEach((f) => {
        const input = document.getElementById("cr-" + f.key);
        const newVal = crFromInputValue(input.value, !!f.list);
        if (!crValuesEqual(liveData[f.key], newVal, !!f.list)) {
          changes[f.key] = newVal;
          previousValues[f.key] = liveData[f.key] ?? (f.list ? [] : "");
        }
      });
    });

    if (Object.keys(changes).length === 0) {
      errorEl.textContent = "No changes were made.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Save & Submit Request";
      return;
    }

    try {
      if (pendingRequestId) {
        await updateDoc(doc(db, "changeRequests", pendingRequestId), {
          changes,
          previousValues,
          submittedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, "changeRequests"), {
          uid: user.uid,
          requesterName: liveData.fullName || "",
          requesterIndex: liveData.campusIndexNumber || "",
          changes,
          previousValues,
          status: "pending",
          submittedAt: serverTimestamp()
        });
      }
      await refreshPendingStatus();
      closeModal();
    } catch (err) {
      errorEl.textContent = "Could not submit your request. Please try again later.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save & Submit Request";
    }
  });
}

// ── Home page ─────────────────────────────────────────────────────
// Pulls together: the signed-in user's own name (for the welcome message),
// and three shared, read-only collections: "announcements", "batchLeadership",
// and "groupProjects". All three are batch-wide — every signed-in batchmate
// sees the same content, nobody writes to them from the app itself.
async function initHomePage(user) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const homeContent = document.getElementById("home-content");

  try {
    await Promise.all([
      renderWelcome(user),
      renderAnnouncements(),
      renderEvents(),
      renderBatchmateDirectory(),
      renderLeadership(),
      renderProjects()
    ]);

    wireEventModal();
    wireBatchmateModal();
    wireLabelModal();
    wireGroupModal();
    wireRateModal();
    wireBadgeModal();

    loadingState.hidden = true;
    homeContent.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load the home page. Please try again later.";
  }
}

async function renderWelcome(user) {
  let displayName = user.email;
  try {
    const snap = await getDoc(doc(db, "batchmates", user.uid));
    if (snap.exists() && snap.data().fullName) {
      displayName = snap.data().fullName.split(" ")[0]; // first name
    }
  } catch (err) {
    // Fall back to email if the profile lookup fails for any reason.
  }
  document.getElementById("welcome-heading").textContent = `Welcome, ${displayName}`;
}

async function renderAnnouncements() {
  const list = document.getElementById("notice-list");
  list.innerHTML = "";

  let snap;
  try {
    snap = await getDocs(query(collection(db, "announcements"), orderBy("date", "desc")));
  } catch (err) {
    snap = await getDocs(collection(db, "announcements")); // fallback if "date" field is missing on some docs
  }

  if (snap.empty) {
    const li = document.createElement("li");
    li.className = "notice-item";
    li.textContent = "No announcements right now.";
    li.style.color = "var(--muted)";
    list.appendChild(li);
    return;
  }

  snap.forEach((docSnap) => {
    const a = docSnap.data();
    const li = document.createElement("li");
    li.className = "notice-item";

    const titleRow = document.createElement("div");
    const title = document.createElement("span");
    title.className = "notice-title";
    title.textContent = a.title || "Untitled announcement";
    titleRow.appendChild(title);
    if (a.date) {
      const date = document.createElement("span");
      date.className = "notice-date";
      date.textContent = a.date;
      titleRow.appendChild(date);
    }

    const message = document.createElement("p");
    message.className = "notice-message";
    message.textContent = a.message || "";

    li.appendChild(titleRow);
    li.appendChild(message);
    list.appendChild(li);
  });
}

async function renderLeadership() {
  const grid = document.getElementById("leader-grid");
  grid.innerHTML = "";

  const snap = await getDocs(collection(db, "batchLeadership"));

  if (snap.empty) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">Batch leadership hasn\'t been set up yet.</p>';
    return;
  }

  // Sorted client-side (not via Firestore orderBy) so a leader doc with no
  // "order" field still shows up — it just falls to the end — instead of
  // being silently excluded, which is what Firestore's orderBy would do.
  const leaders = [];
  snap.forEach((docSnap) => leaders.push(docSnap.data()));
  leaders.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  leaders.forEach((p) => {
    const card = document.createElement("div");
    card.className = "leader-card";

    const top = document.createElement("div");
    top.className = "leader-top";

    const avatarSlot = document.createElement("div");
    avatarSlot.className = "avatar-slot";
    const photoUrl = (p.photoUrl || "").trim();
    if (photoUrl) {
      const img = document.createElement("img");
      img.className = "avatar-photo";
      img.alt = "";
      img.src = photoUrl;
      img.onerror = () => { img.hidden = true; };
      avatarSlot.appendChild(img);
    } else {
      const initial = document.createElement("div");
      initial.className = "avatar";
      initial.textContent = (p.fullName || "?").charAt(0).toUpperCase();
      avatarSlot.appendChild(initial);
    }

    const nameBlock = document.createElement("div");
    const name = document.createElement("div");
    name.className = "leader-name";
    name.textContent = p.fullName || "Unnamed";
    const role = document.createElement("div");
    role.className = "leader-role";
    role.textContent = p.designation || "";
    nameBlock.appendChild(name);
    nameBlock.appendChild(role);

    top.appendChild(avatarSlot);
    top.appendChild(nameBlock);
    card.appendChild(top);

    if (p.title) {
      const company = document.createElement("div");
      company.className = "leader-company";
      company.textContent = p.title;
      card.appendChild(company);
    }

    if (p.responsibility) {
      const desc = document.createElement("p");
      desc.className = "leader-desc";
      desc.textContent = p.responsibility;
      card.appendChild(desc);
    }

    grid.appendChild(card);
  });
}

// Project-level status (Starting/Ongoing/Completed, set from the admin's
// Active Group Projects panel) — see PROJECT_STATUSES further down.
const PROJECT_STATUS_LABEL = {
  starting: "Starting",
  ongoing: "Ongoing",
  complete: "Completed"
};
const PROJECT_STATUS_CLASS = {
  starting: "status-starting",
  ongoing: "status-ongoing",
  complete: "status-complete"
};

function formatPlainDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

// Each project has one or more "groups" (each with its own leader, members,
// and due date — status now lives only at the project level, set from the
// admin's Active Group Projects panel). A project with exactly one group is
// treated as "the whole batch works on this together" — its group name is
// never shown, and its due date is shown directly on the project card. A
// project with 2+ groups shows each as a clickable box (name, leader,
// member count); due date only appears once you tap into a group.
async function renderProjects() {
  const grid = document.getElementById("project-grid");
  grid.innerHTML = "";

  const snap = await getDocs(collection(db, "groupProjects"));

  if (snap.empty) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No projects currently running.</p>';
    return;
  }

  const projects = [];
  // A project's top-level "status" (starting/ongoing/complete) is set from
  // the admin's Active Group Projects panel. Completed projects are pulled
  // from the site entirely — batchmates never see them here.
  snap.forEach((docSnap) => {
    const p = docSnap.data();
    if (p.status === "complete") return;
    projects.push({ id: docSnap.id, ...p });
  });

  if (projects.length === 0) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No projects currently running.</p>';
    return;
  }

  projects.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  projects.forEach((p) => {
    const card = document.createElement("div");
    card.className = "project-card";

    const title = document.createElement("h3");
    title.className = "project-title";
    title.textContent = p.title || "Untitled project";
    card.appendChild(title);

    const projStatus = p.status || "starting";
    const statusBadge = document.createElement("span");
    statusBadge.className = "status-badge " + (PROJECT_STATUS_CLASS[projStatus] || "status-starting");
    statusBadge.textContent = PROJECT_STATUS_LABEL[projStatus] || "Starting";
    card.appendChild(statusBadge);
    card.appendChild(document.createElement("br"));

    if (p.description) {
      const desc = document.createElement("p");
      desc.className = "project-abstract";
      desc.textContent = p.description;
      card.appendChild(desc);
    }

    const groups = Array.isArray(p.groups) ? p.groups : [];

    if (groups.length <= 1) {
      const g = groups[0] || {};
      if (g.dueDate) {
        const due = document.createElement("p");
        due.className = "project-meta-label";
        due.style.marginTop = "4px";
        due.textContent = "Due: " + formatPlainDate(g.dueDate);
        card.appendChild(due);
      }
      const ratingArea = document.createElement("div");
      ratingArea.className = "group-rating-area";
      ratingArea.style.marginTop = "10px";
      ratingArea._project = p;
      ratingArea._groupIndex = 0;
      ratingArea._group = g;
      card.appendChild(ratingArea);
      renderGroupRatingArea(ratingArea, p, 0, g);
    } else {
      const groupGrid = document.createElement("div");
      groupGrid.className = "group-box-grid";

      groups.forEach((g, index) => {
        const box = document.createElement("div");
        box.className = "group-box";

        const name = document.createElement("div");
        name.className = "group-box-name";
        name.textContent = g.groupName || "Unnamed Group";

        const leader = document.createElement("div");
        leader.className = "group-box-leader";
        leader.textContent = "Leader: " + (g.leader || "—");

        const count = document.createElement("div");
        count.className = "group-box-count";
        const memberCount = Array.isArray(g.members) ? g.members.length : 0;
        count.textContent = memberCount + (memberCount === 1 ? " student" : " students");

        box.appendChild(name);
        box.appendChild(leader);
        box.appendChild(count);
        box.addEventListener("click", () => openGroupModal(p, index));
        groupGrid.appendChild(box);
      });

      card.appendChild(groupGrid);
    }

    grid.appendChild(card);
  });
}

function openGroupModal(project, groupIndex) {
  const g = (project.groups || [])[groupIndex] || {};
  document.getElementById("group-modal-title").textContent = g.groupName || project.title;

  document.getElementById("group-modal-leader").textContent = g.leader || "—";
  document.getElementById("group-modal-due").textContent = g.dueDate ? formatPlainDate(g.dueDate) : "No due date set.";

  const membersList = document.getElementById("group-modal-members");
  membersList.innerHTML = "";
  const members = Array.isArray(g.members) ? g.members : [];
  if (members.length === 0) {
    emptyPill(membersList, "No members listed.");
  } else {
    members.forEach((m) => {
      const li = document.createElement("li");
      li.textContent = m;
      membersList.appendChild(li);
    });
  }

  const ratingArea = document.getElementById("group-modal-rating-area");
  ratingArea._project = project;
  ratingArea._groupIndex = groupIndex;
  ratingArea._group = g;
  renderGroupRatingArea(ratingArea, project, groupIndex, g);

  document.getElementById("group-modal-overlay").hidden = false;
}

function wireGroupModal() {
  const overlay = document.getElementById("group-modal-overlay");
  const closeBtn = document.getElementById("group-modal-close");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ── Group Project ratings & prestige ────────────────────────────
// Overall/group admin ratings and peer/leader ratings are two separate
// awarding paths that both feed the same awardPrestige() engine from
// the prestige-points feature.
const OVERALL_RATING_POINTS_PER_STAR = 2;  // admin's whole-project rating → every member of every group
const GROUP_RATING_POINTS_PER_STAR = 2;    // admin's single-group rating → that group's members + leader
const MEMBER_RATING_POINTS_PER_STAR = 2;   // peer + leader ratings, averaged → each member
const LEADER_RATING_POINTS_PER_STAR = 2;   // member-to-leader ratings, averaged → the leader
const LEADER_RATING_WEIGHT = 3;            // a leader's rating of a member counts this many times a peer's

// A group's full roster (leader included) as {uid, name, isLeader}.
// Projects created before the leader/member picker existed won't have
// leaderUid/memberUids yet — those groups just can't be rated until
// re-saved with the current Add Group Project form.
function getGroupRoster(g) {
  const roster = [];
  if (g.leaderUid) roster.push({ uid: g.leaderUid, name: g.leader || "Leader", isLeader: true });
  const memberUids = Array.isArray(g.memberUids) ? g.memberUids : [];
  const memberNames = Array.isArray(g.members) ? g.members : [];
  memberUids.forEach((uid, i) => roster.push({ uid, name: memberNames[i] || "Member", isLeader: false }));
  return roster;
}

function groupRatingDocId(projectId, groupIndex, raterUid) {
  return `${projectId}__g${groupIndex}__${raterUid}`;
}

async function getGroupRatingSubmissions(projectId, groupIndex) {
  const q = query(
    collection(db, "groupProjectRatings"),
    where("projectId", "==", projectId),
    where("groupIndex", "==", groupIndex)
  );
  const snap = await getDocs(q);
  const subs = [];
  snap.forEach((docSnap) => subs.push(docSnap.data()));
  return subs;
}

// Averages every submitted rating for a group into a final per-person
// score (a leader's rating of a member weighted higher than a peer's),
// awards prestige accordingly, and marks the group finalized so this
// can't run twice. Called by the group's leader once every roster
// member (leader included) has submitted their ratings.
async function finalizeGroupRatings(project, groupIndex, group) {
  const roster = getGroupRoster(group);
  const submissions = await getGroupRatingSubmissions(project.id, groupIndex);

  for (const person of roster) {
    if (person.isLeader) continue;
    let weightedSum = 0;
    let weightTotal = 0;
    submissions.forEach((sub) => {
      const value = sub.ratings ? sub.ratings[person.uid] : undefined;
      if (typeof value !== "number") return;
      const weight = sub.raterUid === group.leaderUid ? LEADER_RATING_WEIGHT : 1;
      weightedSum += value * weight;
      weightTotal += weight;
    });
    if (weightTotal === 0) continue;
    const avg = weightedSum / weightTotal;
    await awardPrestige({
      uid: person.uid,
      rawAmount: Math.round(avg * MEMBER_RATING_POINTS_PER_STAR),
      source: "member-rating",
      note: `Group project peer rating: ${project.title || "Untitled project"}`
    });
  }

  if (group.leaderUid) {
    let sum = 0, count = 0;
    submissions.forEach((sub) => {
      if (sub.raterUid === group.leaderUid) return; // leader doesn't rate themself
      const value = sub.ratings ? sub.ratings[group.leaderUid] : undefined;
      if (typeof value !== "number") return;
      sum += value; count++;
    });
    if (count > 0) {
      const avg = sum / count;
      await awardPrestige({
        uid: group.leaderUid,
        rawAmount: Math.round(avg * LEADER_RATING_POINTS_PER_STAR),
        source: "leader-rating",
        note: `Group project leadership rating: ${project.title || "Untitled project"}`
      });
    }
  }

  // Firestore has no per-element array update, so the whole array is
  // rewritten with just this one group's ratingsFinalized flag added.
  const groups = Array.isArray(project.groups) ? project.groups.slice() : [];
  groups[groupIndex] = { ...groups[groupIndex], ratingsFinalized: true };
  await updateDoc(doc(db, "groupProjects", project.id), { groups });

  // Mirror the flag onto the in-memory objects the caller is holding —
  // without this, a re-render right after this call (see the "Complete —
  // Finalize Ratings" click handler) would still see ratingsFinalized as
  // falsy on the stale `group`/`project` references and show the Finalize
  // button again, letting it be clicked repeatedly and re-award the same
  // prestige points each time.
  group.ratingsFinalized = true;
  if (Array.isArray(project.groups) && project.groups[groupIndex]) {
    project.groups[groupIndex].ratingsFinalized = true;
  }
}

// Renders the "Rate Group Members" / "Edit Ratings" button, progress
// note, and (leader-only, once the whole roster has rated) the
// Finalize button into whatever container is passed — reused by both
// the single-group project card and the multi-group group popup.
async function renderGroupRatingArea(container, project, groupIndex, group) {
  container.innerHTML = "";
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;

  const roster = getGroupRoster(group);
  if (roster.length === 0) {
    container.innerHTML = '<p class="fine-print" style="text-align:left;">This group has no leader/member picks yet — edit it in Admin to enable ratings.</p>';
    return;
  }
  const isOnRoster = roster.some((p) => p.uid === uid);
  if (!isOnRoster) return; // only roster members/leader can rate or finalize

  if (group.ratingsFinalized) {
    container.innerHTML = '<p class="fine-print" style="text-align:left; color:var(--accent);">Ratings finalized for this group — an admin can now mark the project complete.</p>';
    return;
  }

  const submissions = await getGroupRatingSubmissions(project.id, groupIndex);
  const submittedUids = new Set(submissions.map((s) => s.raterUid));
  const mySubmission = submissions.find((s) => s.raterUid === uid);

  const rateBtn = document.createElement("button");
  rateBtn.type = "button";
  rateBtn.className = "btn-primary";
  rateBtn.style.marginRight = "8px";
  rateBtn.textContent = mySubmission ? "Edit Ratings" : "Rate Group Members";
  rateBtn.addEventListener("click", () => openRateModal(project, groupIndex, group));
  container.appendChild(rateBtn);

  const progress = document.createElement("p");
  progress.className = "fine-print";
  progress.style.textAlign = "left";
  progress.style.margin = "10px 0 0";
  progress.textContent = `${submittedUids.size} of ${roster.length} have rated.`;
  container.appendChild(progress);

  const isLeader = group.leaderUid === uid;
  const everyoneRated = submittedUids.size >= roster.length && roster.every((p) => submittedUids.has(p.uid));
  if (isLeader && everyoneRated) {
    const finalizeBtn = document.createElement("button");
    finalizeBtn.type = "button";
    finalizeBtn.className = "btn-primary";
    finalizeBtn.style.marginTop = "10px";
    finalizeBtn.textContent = "Complete — Finalize Ratings";
    finalizeBtn.addEventListener("click", async () => {
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = "Finalizing…";
      try {
        await finalizeGroupRatings(project, groupIndex, group);
        await renderGroupRatingArea(container, project, groupIndex, group);
      } catch (err) {
        finalizeBtn.disabled = false;
        finalizeBtn.textContent = "Complete — Finalize Ratings";
        alert("Could not finalize ratings. Please try again.");
      }
    });
    container.appendChild(finalizeBtn);
  }
}

function openRateModal(project, groupIndex, group) {
  const overlay = document.getElementById("rate-modal-overlay");
  const titleEl = document.getElementById("rate-modal-title");
  const listEl = document.getElementById("rate-modal-list");
  const submitBtn = document.getElementById("rate-modal-submit-btn");
  const statusEl = document.getElementById("rate-modal-status");
  const uid = auth.currentUser.uid;

  titleEl.textContent = "Rate Group Members" + (group.groupName ? " — " + group.groupName : "");
  statusEl.textContent = "";
  listEl.innerHTML = "Loading…";
  submitBtn.hidden = true;

  const roster = getGroupRoster(group);
  const ratingDocId = groupRatingDocId(project.id, groupIndex, uid);

  getDoc(doc(db, "groupProjectRatings", ratingDocId)).then((snap) => {
    const existing = snap.exists() ? snap.data().ratings || {} : {};
    listEl.innerHTML = "";

    roster.forEach((person) => {
      const row = document.createElement("div");
      row.className = "rate-modal-row";
      const isSelf = person.uid === uid;

      const label = document.createElement("span");
      label.textContent = person.name + (person.isLeader ? " (Leader)" : "");
      row.appendChild(label);

      const select = document.createElement("select");
      select.className = "task-rating-select rate-modal-select";
      select.disabled = isSelf;
      const blankOpt = document.createElement("option");
      blankOpt.value = "";
      blankOpt.textContent = isSelf ? "—" : "Rate…";
      select.appendChild(blankOpt);
      for (let i = 1; i <= 10; i++) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = String(i);
        if (existing[person.uid] === i) opt.selected = true;
        select.appendChild(opt);
      }
      select.dataset.uid = person.uid;
      if (isSelf) row.classList.add("rate-modal-row-self");
      row.appendChild(select);
      listEl.appendChild(row);
    });

    function checkComplete() {
      const selects = Array.from(listEl.querySelectorAll(".rate-modal-select:not(:disabled)"));
      submitBtn.hidden = !selects.every((s) => s.value !== "");
    }
    listEl.addEventListener("change", checkComplete);
    checkComplete();
  });

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      const ratings = {};
      listEl.querySelectorAll(".rate-modal-select:not(:disabled)").forEach((s) => {
        if (s.value) ratings[s.dataset.uid] = Number(s.value);
      });
      await setDoc(doc(db, "groupProjectRatings", ratingDocId), {
        projectId: project.id,
        groupIndex,
        raterUid: uid,
        ratings,
        submittedAt: new Date().toISOString()
      });
      overlay.hidden = true;
      submitBtn.textContent = "Completed My Part";
      submitBtn.disabled = false;
      // Refresh whichever rating area is visible so the button label /
      // progress / finalize button reflect the new submission.
      const areas = document.querySelectorAll(".group-rating-area, #group-modal-rating-area");
      areas.forEach((area) => {
        if (area._project) renderGroupRatingArea(area, area._project, area._groupIndex, area._group);
      });
    } catch (err) {
      statusEl.textContent = "Could not save your ratings. Please try again.";
      submitBtn.disabled = false;
      submitBtn.textContent = "Completed My Part";
    }
  };

  overlay.hidden = false;
}

function wireRateModal() {
  const overlay = document.getElementById("rate-modal-overlay");
  const closeBtn = document.getElementById("rate-modal-close");
  function closeModal() { overlay.hidden = true; }
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ── Wall of Fame ──────────────────────────────────────────────────
// Reads the "wallOfFame" collection and shows newest-first, oldest-last.
// Each doc: { title, description, imageUrl, date: "YYYY-MM-DD" }
// Sorting is done client-side by date string (works fine for YYYY-MM-DD),
// and entries with no date land at the end rather than being excluded.
async function initWallPage() {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const wallContent = document.getElementById("wall-content");
  const grid = document.getElementById("wall-grid");

  try {
    const snap = await getDocs(collection(db, "wallOfFame"));

    if (snap.empty) {
      grid.innerHTML = '<p class="info-text" style="color:var(--muted)">Nothing here yet — batch memories will show up as they\'re added.</p>';
    } else {
      const entries = [];
      snap.forEach((docSnap) => entries.push(docSnap.data()));
      entries.sort((a, b) => (b.date || "").localeCompare(a.date || "")); // newest first

      entries.forEach((entry) => {
        const card = document.createElement("div");
        card.className = "wall-card";

        const imageUrl = (entry.imageUrl || "").trim();
        if (imageUrl) {
          const img = document.createElement("img");
          img.className = "wall-thumb";
          img.alt = "";
          img.src = imageUrl;
          img.onerror = () => {
            img.replaceWith(makeFallbackThumb(entry.title));
          };
          card.appendChild(img);
        } else {
          card.appendChild(makeFallbackThumb(entry.title));
        }

        const body = document.createElement("div");
        body.className = "wall-card-body";
        const title = document.createElement("p");
        title.className = "wall-card-title";
        title.textContent = entry.title || "Untitled";
        body.appendChild(title);
        if (entry.date) {
          const date = document.createElement("span");
          date.className = "wall-card-date";
          date.textContent = entry.date;
          body.appendChild(date);
        }
        card.appendChild(body);

        card.addEventListener("click", () => openWallModal(entry));
        grid.appendChild(card);
      });
    }

    loadingState.hidden = true;
    wallContent.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load the Wall of Fame. Please try again later.";
  }

  wireWallModal();
}

function makeFallbackThumb(title) {
  const fallback = document.createElement("div");
  fallback.className = "wall-thumb-fallback";
  fallback.textContent = title || "Batch Memory";
  return fallback;
}

function openWallModal(entry) {
  const overlay = document.getElementById("wall-modal-overlay");
  const img = document.getElementById("modal-image");
  const title = document.getElementById("modal-title");
  const desc = document.getElementById("modal-desc");

  const imageUrl = (entry.imageUrl || "").trim();
  if (imageUrl) {
    img.src = imageUrl;
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
  } else {
    img.hidden = true;
  }

  title.textContent = entry.title || "Untitled";
  desc.textContent = entry.description || "";

  overlay.hidden = false;
}

function wireWallModal() {
  const overlay = document.getElementById("wall-modal-overlay");
  const closeBtn = document.getElementById("modal-close");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(); // click outside the box
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ── Badges / Achievements ──────────────────────────────────────────
// "badges" collection: { name, imageUrl (PNG), description } — added
// manually in the Firestore Console (or by an admin later). Cached once
// per page load since the catalog rarely changes mid-session.
let badgesCache = null;
async function getBadgesMap() {
  if (badgesCache) return badgesCache;
  const snap = await getDocs(collection(db, "badges"));
  const map = {};
  snap.forEach((docSnap) => { map[docSnap.id] = { id: docSnap.id, ...docSnap.data() }; });
  badgesCache = map;
  return map;
}

// "badgeAssignments/{uid}": { badgeIds: [...] } — which badges that
// batchmate has earned. One doc lookup for "my badges" (Badges page),
// or the whole collection at once for "everyone's badges" (home directory).
async function getBadgeAssignment(uid) {
  const snap = await getDoc(doc(db, "badgeAssignments", uid));
  return snap.exists() ? (snap.data().badgeIds || []) : [];
}

async function getAllBadgeAssignments() {
  const snap = await getDocs(collection(db, "badgeAssignments"));
  const map = {};
  snap.forEach((docSnap) => { map[docSnap.id] = docSnap.data().badgeIds || []; });
  return map;
}

// kind "card" = full size grid tile (Badges page), "mini" = small round
// icon (home directory card).
function makeBadgeIcon(badge, kind) {
  const img = document.createElement("img");
  img.className = kind === "mini" ? "batchmate-badge-icon" : "badge-card-icon";
  img.src = badge.imageUrl || "";
  img.alt = badge.name || "";
  img.title = badge.name || "";
  return img;
}

// Shared popup — name on top, floating badge with a glow behind it in the
// middle, description below. Used from the Badges page and from the mini
// icons on the home directory (whichever page has the markup for it).
function openBadgeModal(badge) {
  const overlay = document.getElementById("badge-modal-overlay");
  if (!overlay) return;
  document.getElementById("badge-modal-title").textContent = badge.name || "Unnamed badge";
  document.getElementById("badge-modal-desc").textContent = badge.description || "";
  const img = document.getElementById("badge-modal-image");
  img.src = badge.imageUrl || "";
  img.alt = badge.name || "";
  overlay.hidden = false;
}

function wireBadgeModal() {
  const overlay = document.getElementById("badge-modal-overlay");
  if (!overlay) return;
  const closeBtn = document.getElementById("badge-modal-close");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ── Badges page — a batchmate's own earned badges, two per row ─────
async function initBadgesPage(user) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const content = document.getElementById("badges-content");
  const grid = document.getElementById("badge-grid");

  try {
    const [badgesMap, earnedIds] = await Promise.all([
      getBadgesMap(),
      getBadgeAssignment(user.uid)
    ]);

    grid.innerHTML = "";
    if (earnedIds.length === 0) {
      grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No badges earned yet — keep an eye out!</p>';
    } else {
      earnedIds.forEach((id) => {
        const badge = badgesMap[id];
        if (!badge) return;
        const card = document.createElement("div");
        card.className = "badge-card";
        card.appendChild(makeBadgeIcon(badge, "card"));
        const name = document.createElement("p");
        name.className = "badge-card-name";
        name.textContent = badge.name || "Unnamed badge";
        card.appendChild(name);
        card.addEventListener("click", () => openBadgeModal(badge));
        grid.appendChild(card);
      });
    }

    wireBadgeModal();
    loadingState.hidden = true;
    content.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load your badges. Please try again later.";
  }
}

// ── Admin page ────────────────────────────────────────────────────
// Gates the page content client-side (nice UX for non-admins who land
// here), but the real security is the Firestore write rule, which checks
// for a matching /admins/{uid} doc regardless of what this page shows.
// Wires every "admin-section-btn" to open its matching popup, and every
// popup to close via its ✕ button, clicking outside, or Escape. Submitting
// a form inside a popup does NOT close it (see wireForm) — only these
// three actions do, so an admin can add several records in a row without
// the popup snapping shut after each one.
function wireAdminModals() {
  document.querySelectorAll(".admin-section-btn[data-modal]").forEach((btn) => {
    const overlay = document.getElementById(btn.dataset.modal);
    if (!overlay) return;
    btn.addEventListener("click", () => { overlay.hidden = false; });
  });

  document.querySelectorAll(".modal-close[data-close-modal]").forEach((closeBtn) => {
    const overlay = document.getElementById(closeBtn.dataset.closeModal);
    if (!overlay) return;
    closeBtn.addEventListener("click", () => { overlay.hidden = true; });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.hidden = true; });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".admin-section-btn[data-modal]").forEach((btn) => {
      const overlay = document.getElementById(btn.dataset.modal);
      if (overlay && !overlay.hidden) overlay.hidden = true;
    });
  });
}

// Wires the sticky bottom tab bar (History / Active / Add / Danger).
// All four panels' content is rendered once, up front, same as before —
// this only toggles which panel is visible, so switching tabs is instant
// and no render function needs to know or care which tab is active.
function wireAdminTabBar() {
  const bar = document.getElementById("admin-content-tabbar");
  if (!bar) return;
  const panels = document.querySelectorAll(".admin-tab-panel");

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab-pill");
    if (!btn) return;
    const tab = btn.dataset.tab;
    bar.querySelectorAll(".admin-tab-pill").forEach((b) => b.classList.toggle("active", b === btn));
    panels.forEach((p) => { p.hidden = p.dataset.tabPanel !== tab; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// Splits "a|b|c" or newline-separated text into a clean array of strings.
// Top-level (not nested in initAdminPage) since both the in-page admin
// forms and wireEventEditModal()/initEventLeadershipPanel() — which are
// defined outside initAdminPage — need it.
function splitList(value, sep) {
  if (!value || !value.trim()) return [];
  return value.split(sep).map((s) => s.trim()).filter(Boolean);
}

async function initAdminPage(isAdmin) {
  const loadingState = document.getElementById("loading-state");
  const accessDenied = document.getElementById("access-denied");
  const adminContent = document.getElementById("admin-content");

  loadingState.hidden = true;

  if (!isAdmin) {
    accessDenied.hidden = false;
    return;
  }
  adminContent.hidden = false;
  document.getElementById("admin-content-tabbar").hidden = false;
  wireAdminModals();
  wireAdminTabBar();
  await populateEventLabelSelect();

  // Wires one form: on submit, builds the data object, writes it to
  // Firestore, shows feedback, and resets the form on success. If
  // pushInfo is given, it's called with the saved data to build a
  // {title, message, url} broadcast push notification sent to every
  // batchmate after the write succeeds.
  function wireForm(formId, collectionName, errorId, successId, buildData, pushInfo) {
    const form = document.getElementById(formId);
    const errorEl = document.getElementById(errorId);
    const successEl = document.getElementById(successId);
    const submitBtn = form.querySelector("button[type=submit]");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.hidden = true;
      successEl.hidden = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Adding…";

      try {
        const data = buildData();
        await addDoc(collection(db, collectionName), data);
        successEl.textContent = "Added successfully.";
        successEl.hidden = false;
        form.reset();

        if (pushInfo) {
          const info = pushInfo(data);
          sendPushNotification({
            type: collectionName,
            title: info.title,
            message: info.message,
            url: info.url
          });
        }
      } catch (err) {
        errorEl.textContent = "Could not add this record — check the fields and try again.";
        errorEl.hidden = false;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = form.dataset.originalLabel;
      }
    });
    submitBtn.dataset.originalLabel = submitBtn.textContent;
    form.dataset.originalLabel = submitBtn.textContent;
  }

  // Fund Transaction — has its own handler (initFundTransactionForm),
  // not the generic wireForm, since it needs the lump/per-student
  // breakdown toggle and the student checklist.

  // Wall of Fame — no push (per request)
  wireForm("form-wall", "wallOfFame", "wall-form-error", "wall-form-success", () => ({
    title: document.getElementById("wall-title").value.trim(),
    description: document.getElementById("wall-description").value.trim(),
    imageUrl: document.getElementById("wall-imageurl").value.trim(),
    date: document.getElementById("wall-date").value
  }));

  // Announcement
  wireForm(
    "form-announcement", "announcements", "ann-error", "ann-success",
    () => ({
      title: document.getElementById("ann-title").value.trim(),
      message: document.getElementById("ann-message").value.trim(),
      date: document.getElementById("ann-date").value
    }),
    (data) => ({
      title: data.title || "New announcement",
      message: data.message || "",
      url: "home.html"
    })
  );

  // Batch Leadership — no push
  wireForm("form-leader", "batchLeadership", "leader-error", "leader-success", () => {
    const data = {
      fullName: document.getElementById("leader-name").value.trim(),
      designation: document.getElementById("leader-designation").value.trim(),
      title: document.getElementById("leader-title").value.trim(),
      photoUrl: document.getElementById("leader-photo").value.trim(),
      responsibility: document.getElementById("leader-responsibility").value.trim()
    };
    const orderVal = document.getElementById("leader-order").value;
    if (orderVal !== "") data.order = Number(orderVal);
    return data;
  });

  // Group Project — dynamic groups with cross-group member exclusion
  await initProjectForm();
  await initFundTransactionForm();

  // Event Label — no push
  const eventLabelForm = document.getElementById("form-eventlabel");
  const eventLabelErrorEl = document.getElementById("eventlabel-error");
  const eventLabelSuccessEl = document.getElementById("eventlabel-success");
  const eventLabelBtn = eventLabelForm.querySelector("button[type=submit]");
  const eventLabelOriginalLabel = eventLabelBtn.textContent;

  eventLabelForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    eventLabelErrorEl.hidden = true;
    eventLabelSuccessEl.hidden = true;
    eventLabelBtn.disabled = true;
    eventLabelBtn.textContent = "Adding…";

    try {
      await addDoc(collection(db, "eventLabels"), {
        name: document.getElementById("eventlabel-name").value.trim(),
        description: document.getElementById("eventlabel-description").value.trim(),
        color: document.getElementById("eventlabel-color").value
      });
      eventLabelSuccessEl.textContent = "Label added.";
      eventLabelSuccessEl.hidden = false;
      eventLabelForm.reset();
      eventLabelsCache = null; // invalidate so the home page re-fetches fresh labels
      await populateEventLabelSelect(); // refresh the multi-select immediately
    } catch (err) {
      eventLabelErrorEl.textContent = "Could not add this label — check the fields and try again.";
      eventLabelErrorEl.hidden = false;
    } finally {
      eventLabelBtn.disabled = false;
      eventLabelBtn.textContent = eventLabelOriginalLabel;
    }
  });

  // Event
  wireForm(
    "form-event", "events", "event-error", "event-success",
    () => {
      const select = document.getElementById("event-labels-select");
      const selectedLabels = Array.from(select.selectedOptions).map((o) => o.value);
      return {
        name: document.getElementById("event-name").value.trim(),
        date: document.getElementById("event-datetime").value,
        description: document.getElementById("event-description").value.trim(),
        leaders: splitList(document.getElementById("event-leaders").value, "|"),
        labels: selectedLabels
      };
    },
    (data) => ({
      title: "New event: " + (data.name || "Untitled event"),
      message: data.description || "A new event was added.",
      url: "home.html"
    })
  );

  // Assign Task
  await populateBatchmateSelect();
  const taskForm = document.getElementById("form-task");
  const taskErrorEl = document.getElementById("task-error");
  const taskSuccessEl = document.getElementById("task-success");
  const taskBtn = taskForm.querySelector("button[type=submit]");
  const taskOriginalLabel = taskBtn.textContent;

  taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    taskErrorEl.hidden = true;
    taskSuccessEl.hidden = true;
    taskBtn.disabled = true;
    taskBtn.textContent = "Assigning…";

    try {
      const select = document.getElementById("task-batchmate");
      const selectedOption = select.options[select.selectedIndex];
      const taskName = document.getElementById("task-name").value.trim();
      const targetUid = select.value;

      await addDoc(collection(db, "tasks"), {
        assignedToUid: targetUid,
        assignedToName: selectedOption ? selectedOption.textContent : "",
        taskName,
        description: document.getElementById("task-description").value.trim(),
        difficulty: document.getElementById("task-difficulty").value,
        dueDate: document.getElementById("task-duedate").value,
        status: "ongoing"
      });
      taskSuccessEl.textContent = "Task assigned.";
      taskSuccessEl.hidden = false;
      taskForm.reset();
      await renderAdminActiveTasks();

      // Individual push — only the assigned batchmate gets this one.
      sendPushNotification({
        type: "task",
        title: "New task assigned to you",
        message: taskName,
        url: "dashboard.html",
        targetUid
      });
    } catch (err) {
      taskErrorEl.textContent = "Could not assign this task — check the fields and try again.";
      taskErrorEl.hidden = false;
    } finally {
      taskBtn.disabled = false;
      taskBtn.textContent = taskOriginalLabel;
    }
  });

  // Active Tasks panel
  await renderAdminActiveTasks();
  document.getElementById("refresh-active-tasks").addEventListener("click", () => renderAdminActiveTasks());
  document.getElementById("active-tasks-filter").addEventListener("change", (e) => renderActiveTasksList(e.target.value));

  // Completed Tasks panel
  await renderAdminCompletedTasks();
  document.getElementById("refresh-completed-tasks").addEventListener("click", renderAdminCompletedTasks);
  document.getElementById("completed-tasks-sort").addEventListener("change", () => renderCompletedTasksList());
  document.getElementById("completed-tasks-filter").addEventListener("change", () => renderCompletedTasksList());

  // Prestige Leaderboard panel
  await renderPrestigeLeaderboard();
  document.getElementById("refresh-leaderboard").addEventListener("click", renderPrestigeLeaderboard);

  // Fund Contribution Leaderboard panel
  await renderFundLeaderboard();
  document.getElementById("refresh-fund-leaderboard").addEventListener("click", renderFundLeaderboard);

  // Fund Transaction History panel
  await renderAdminFundTransactions();
  document.getElementById("refresh-fund-transactions").addEventListener("click", renderAdminFundTransactions);
  document.getElementById("fundtx-filter").addEventListener("change", () => renderFundTransactionsList());
  document.getElementById("fundtx-sort").addEventListener("change", () => renderFundTransactionsList());
  wireFundTransactionEditModal();

  // Active Group Projects panel
  await renderAdminActiveProjects();
  document.getElementById("refresh-active-projects").addEventListener("click", renderAdminActiveProjects);

  // Completed Group Projects panel
  await renderAdminCompletedProjects();
  document.getElementById("refresh-completed-projects").addEventListener("click", renderAdminCompletedProjects);
  document.getElementById("completed-projects-sort").addEventListener("change", (e) => renderCompletedProjectsList(e.target.value));

  // Active Events panel
  await renderAdminActiveEvents();
  document.getElementById("refresh-active-events").addEventListener("click", renderAdminActiveEvents);
  wireEventEditModal();

  // Detail Change Requests panel
  await renderAdminChangeRequests();
  document.getElementById("refresh-change-requests").addEventListener("click", renderAdminChangeRequests);

  // Add/Remove Field (All Batchmates)
  initBulkFieldForm();

  // Manage Student Badges
  await initBadgeAssignmentPanel();

  // Manage Bad Behavior Records
  await initBadBehaviorPanel();

  // Add Event Leadership
  await initEventLeadershipPanel();
}

// Manage Bad Behavior Records: pick a student, see their existing
// records (plain-text lines, same format the CSV import has always
// used) with a remove button each, and add new ones. Reads/writes
// batchmates/{uid} directly — the admin read bypass on that collection
// (firestore.rules) is what makes the "see existing records" half of
// this possible.
async function initBadBehaviorPanel() {
  const select = document.getElementById("badbehavior-student-select");
  const listEl = document.getElementById("badbehavior-list");
  const form = document.getElementById("form-badbehavior");
  const textInput = document.getElementById("badbehavior-text");
  const errorEl = document.getElementById("badbehavior-error");
  const successEl = document.getElementById("badbehavior-success");
  if (!select || !listEl || !form) return;

  const people = await getBatchmatesPublicList();
  select.innerHTML = "";
  if (people.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No batchmates found";
    select.appendChild(opt);
    return;
  }
  people.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.uid;
    opt.textContent = p.fullName;
    select.appendChild(opt);
  });

  async function renderListFor(uid) {
    listEl.innerHTML = "Loading…";
    const snap = await getDoc(doc(db, "batchmates", uid));
    const records = snap.exists() && Array.isArray(snap.data().badBehaviorRecords)
      ? snap.data().badBehaviorRecords
      : [];

    listEl.innerHTML = "";
    if (records.length === 0) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No records — clean sheet.</p>';
      return;
    }

    records.forEach((text, index) => {
      const row = document.createElement("div");
      row.className = "bad-behavior-row";

      const span = document.createElement("span");
      span.className = "bad-behavior-text";
      span.textContent = text;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "bad-behavior-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        removeBtn.disabled = true;
        try {
          const next = records.slice();
          next.splice(index, 1);
          await updateDoc(doc(db, "batchmates", uid), { badBehaviorRecords: next });
          await renderListFor(uid);
        } catch (err) {
          removeBtn.disabled = false;
          alert("Could not remove this record. Please try again.");
        }
      });

      row.appendChild(span);
      row.appendChild(removeBtn);
      listEl.appendChild(row);
    });
  }

  select.addEventListener("change", () => renderListFor(select.value));
  if (select.value) await renderListFor(select.value);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    const uid = select.value;
    const text = textInput.value.trim();
    if (!uid || !text) return;

    const submitBtn = form.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      await updateDoc(doc(db, "batchmates", uid), {
        badBehaviorRecords: arrayUnion(text)
      });
      textInput.value = "";
      successEl.textContent = "Record added.";
      successEl.hidden = false;
      await renderListFor(uid);
    } catch (err) {
      errorEl.textContent = "Could not add this record — check the field and try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// Manage Student Badges: pick a student, see every badge in the catalog
// with a checkbox — already-earned ones pre-checked. Each checkbox saves
// immediately (no submit button), so checking/unchecking is the whole
// interaction: check to award, uncheck to remove.
async function initBadgeAssignmentPanel() {
  const select = document.getElementById("badge-student-select");
  const checklist = document.getElementById("badge-checklist");
  const statusEl = document.getElementById("badge-assign-status");
  if (!select || !checklist) return;

  const [people, badgesMap] = await Promise.all([getBatchmatesPublicList(), getBadgesMap()]);
  const badgeList = Object.values(badgesMap).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  select.innerHTML = "";
  if (people.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No batchmates found";
    select.appendChild(opt);
    return;
  }
  people.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.uid;
    opt.textContent = p.fullName;
    select.appendChild(opt);
  });

  async function renderChecklistFor(uid) {
    checklist.innerHTML = "Loading…";
    statusEl.textContent = "";
    const earned = new Set(await getBadgeAssignment(uid));
    checklist.innerHTML = "";

    if (badgeList.length === 0) {
      checklist.innerHTML = '<p class="info-text" style="color:var(--muted)">No badges added yet — add some to the "badges" collection first.</p>';
      return;
    }

    badgeList.forEach((badge) => {
      const row = document.createElement("label");
      row.className = "member-check-row badge-check-row";

      const img = document.createElement("img");
      img.src = badge.imageUrl || "";
      img.alt = "";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "badge-checkbox";
      cb.checked = earned.has(badge.id);

      const label = document.createElement("span");
      label.textContent = badge.name || "Unnamed badge";

      cb.addEventListener("change", async () => {
        cb.disabled = true;
        statusEl.textContent = "Saving…";
        try {
          await setDoc(
            doc(db, "badgeAssignments", uid),
            { badgeIds: cb.checked ? arrayUnion(badge.id) : arrayRemove(badge.id) },
            { merge: true }
          );
          statusEl.textContent = "Saved.";
        } catch (err) {
          cb.checked = !cb.checked;
          statusEl.textContent = "Could not update — please try again.";
        } finally {
          cb.disabled = false;
        }
      });

      row.appendChild(img);
      row.appendChild(cb);
      row.appendChild(label);
      checklist.appendChild(row);
    });
  }

  await renderChecklistFor(select.value);
  select.addEventListener("change", () => renderChecklistFor(select.value));
}

// Cached list of { uid, fullName, campusIndexNumber } from batchmatesPublic —
// shared by the "Assign Task" dropdown and the group project member pickers,
// so it's only fetched once per admin page load.
let batchmatesPublicListCache = null;
async function getBatchmatesPublicList() {
  if (batchmatesPublicListCache) return batchmatesPublicListCache;
  const snap = await getDocs(collection(db, "batchmatesPublic"));
  const list = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    list.push({ uid: docSnap.id, fullName: d.fullName || "Unnamed", campusIndexNumber: d.campusIndexNumber || "" });
  });
  list.sort((a, b) => a.fullName.localeCompare(b.fullName));
  batchmatesPublicListCache = list;
  return list;
}

// Populates the "Assign Task" batchmate dropdown from batchmatesPublic
// (already readable by any signed-in user, including this admin).
// Sets up the "Add Group Project" form: one dynamic group block to start,
// a button to add more, and a submit handler that gathers every group's
// data (including selected member UIDs turned into display strings).
async function initProjectForm() {
  const groupsContainer = document.getElementById("groups-container");
  const addGroupBtn = document.getElementById("add-group-btn");
  const projectForm = document.getElementById("form-project");
  const errorEl = document.getElementById("proj-error");
  const successEl = document.getElementById("proj-success");
  const submitBtn = projectForm.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;

  await getBatchmatesPublicList(); // warm the cache before building the first block

  // Any member checkbox toggling, in any block, re-checks exclusions everywhere.
  groupsContainer.addEventListener("change", (e) => {
    if (e.target.classList.contains("member-checkbox")) refreshMemberExclusions();
  });

  addGroupBtn.addEventListener("click", () => createGroupBlock());

  groupsContainer.innerHTML = "";
  await createGroupBlock(); // start with exactly one empty group block

  projectForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";

    try {
      const groups = [];
      document.querySelectorAll(".group-block").forEach((block) => {
        const checked = Array.from(block.querySelectorAll(".member-checkbox:checked"));
        const leaderSelect = block.querySelector(".group-leader-select");
        const leaderOpt = leaderSelect.options[leaderSelect.selectedIndex];
        groups.push({
          groupName: block.querySelector(".group-name-input").value.trim(),
          leader: leaderSelect.value ? leaderOpt.textContent : "",
          leaderUid: leaderSelect.value || "",
          dueDate: block.querySelector(".group-duedate-input").value,
          members: checked.map((cb) => cb.dataset.displayName),
          memberUids: checked.map((cb) => cb.value)
        });
      });

      const data = {
        title: document.getElementById("proj-title").value.trim(),
        description: document.getElementById("proj-description").value.trim(),
        status: document.getElementById("proj-status").value || "starting",
        groups
      };
      const orderVal = document.getElementById("proj-order").value;
      if (orderVal !== "") data.order = Number(orderVal);

      await addDoc(collection(db, "groupProjects"), data);
      await renderAdminActiveProjects(); // new project should show up in the panel immediately

      successEl.textContent = "Added successfully.";
      successEl.hidden = false;
      projectForm.reset();
      groupsContainer.innerHTML = "";
      await createGroupBlock(); // reset back to one fresh empty group

      // Broadcast push — every batchmate gets notified about the new project.
      sendPushNotification({
        type: "groupProjects",
        title: "New group project",
        message: data.title || "A new group project was added.",
        url: "home.html"
      });
    } catch (err) {
      errorEl.textContent = "Could not add this project — check the fields and try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

// ── Fund Transaction form ────────────────────────────────────────
// "Lump" mode is the original single-value transaction (unchanged
// behavior). "Per student" mode ticks specific batchmates and records
// the same per-head amount against each of them — the total is just
// per-head × count. Income transactions in per-student mode also add
// to each ticked student's personal fundDonated total and award
// prestige (Rs. 100 donated = 1 point, via the shared awardPrestige()).
async function initFundTransactionForm() {
  const form = document.getElementById("form-fund");
  if (!form) return;
  const modeSelect = document.getElementById("fund-mode");
  const lumpSection = document.getElementById("fund-lump-section");
  const perStudentSection = document.getElementById("fund-perstudent-section");
  const perHeadInput = document.getElementById("fund-per-head");
  const checklist = document.getElementById("fund-student-checklist");
  const searchInput = document.getElementById("fund-student-search");
  const totalEl = document.getElementById("fund-computed-total");
  const errorEl = document.getElementById("fund-error");
  const successEl = document.getElementById("fund-success");
  const submitBtn = form.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;

  modeSelect.addEventListener("change", () => {
    const perStudent = modeSelect.value === "perStudent";
    lumpSection.hidden = perStudent;
    perStudentSection.hidden = !perStudent;
  });

  const people = await getBatchmatesPublicList();
  checklist.innerHTML = "";
  people.forEach((p) => {
    const row = document.createElement("label");
    row.className = "member-check-row";
    row.dataset.name = (p.fullName + " " + p.campusIndexNumber).toLowerCase();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "fund-student-checkbox";
    cb.value = p.uid;
    cb.dataset.displayName = p.fullName;

    const label = document.createElement("span");
    label.textContent = `${p.fullName} — ${p.campusIndexNumber}`;

    row.appendChild(cb);
    row.appendChild(label);
    checklist.appendChild(row);
  });

  function updateComputedTotal() {
    const perHead = Number(perHeadInput.value) || 0;
    const count = checklist.querySelectorAll(".fund-student-checkbox:checked").length;
    totalEl.textContent = `Total: Rs. ${(perHead * count).toLocaleString()} (${count} student${count === 1 ? "" : "s"})`;
  }
  perHeadInput.addEventListener("input", updateComputedTotal);
  checklist.addEventListener("change", updateComputedTotal);
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.trim().toLowerCase();
    checklist.querySelectorAll(".member-check-row").forEach((row) => {
      row.hidden = !!term && !row.dataset.name.includes(term);
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding…";

    try {
      const type = document.getElementById("fund-type").value;
      const mode = modeSelect.value;
      const description = document.getElementById("fund-description").value.trim();
      const date = document.getElementById("fund-date").value;

      let data;
      let checkedStudents = [];
      if (mode === "perStudent") {
        const perHead = Number(perHeadInput.value) || 0;
        checkedStudents = Array.from(checklist.querySelectorAll(".fund-student-checkbox:checked"))
          .map((cb) => ({ uid: cb.value, name: cb.dataset.displayName }));
        if (perHead <= 0 || checkedStudents.length === 0) {
          throw new Error("Pick an amount per student and tick at least one student.");
        }
        data = {
          type,
          mode: "perStudent",
          perStudentAmount: perHead,
          studentUids: checkedStudents.map((s) => s.uid),
          studentNames: checkedStudents.map((s) => s.name),
          amount: perHead * checkedStudents.length,
          description,
          date
        };
      } else {
        const amount = Number(document.getElementById("fund-amount").value) || 0;
        if (amount <= 0) throw new Error("Enter an amount.");
        data = { type, mode: "lump", amount, description, date };
      }

      await addDoc(collection(db, "fundTransactions"), data);

      // Only income adds to personal donation totals + prestige — an
      // expense broken down per student isn't a donation.
      if (type === "income" && mode === "perStudent") {
        for (const s of checkedStudents) {
          await updateDoc(doc(db, "batchmates", s.uid), {
            fundDonated: increment(data.perStudentAmount)
          });
          const points = Math.floor(data.perStudentAmount / FUND_LKR_PER_POINT);
          if (points > 0) {
            await awardPrestige({
              uid: s.uid,
              rawAmount: points,
              source: "fund-donation",
              note: `Fund donation: Rs. ${data.perStudentAmount} — ${description || "batch fund"}`
            });
          }
        }
      }

      successEl.textContent = "Added successfully.";
      successEl.hidden = false;
      form.reset();
      lumpSection.hidden = false;
      perStudentSection.hidden = true;
      checklist.querySelectorAll(".fund-student-checkbox:checked").forEach((cb) => (cb.checked = false));
      updateComputedTotal();

      sendPushNotification({
        type: "fundTransactions",
        title: type === "income" ? "New fund income" : "New fund expense",
        message: description || "The batch fund was updated.",
        url: "fund.html"
      });
    } catch (err) {
      errorEl.textContent = err.message || "Could not add this transaction — check the fields and try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

let groupBlockCounter = 0;

async function createGroupBlock() {
  groupBlockCounter++;
  const block = document.createElement("div");
  block.className = "group-block";
  block.dataset.blockId = "grp-" + groupBlockCounter;
  block.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <p class="section-label" style="margin:0;">Group</p>
      <button type="button" class="ghost-btn remove-group-btn" style="padding:4px 10px;font-size:11px;">Remove</button>
    </div>
    <label>Group Name <span style="color:var(--muted);font-weight:400;">(leave blank if this is the whole batch)</span></label>
    <input type="text" class="group-name-input">
    <label>Leader</label>
    <select class="group-leader-select"></select>
    <p class="fine-print" style="text-align:left; margin:-12px 0 14px;">Picking a leader here removes them from every other group's leader/member lists for this project, same as members below.</p>
    <label>Due Date</label>
    <input type="date" class="group-duedate-input">
    <label>Members</label>
    <input type="text" class="group-member-search" placeholder="Search students by name or index…">
    <div class="member-checklist"></div>
  `;

  document.getElementById("groups-container").appendChild(block);
  await buildMemberChecklist(block);
  await buildLeaderSelect(block);
  refreshMemberExclusions();

  block.querySelector(".remove-group-btn").addEventListener("click", () => {
    block.remove();
    refreshMemberExclusions();
    updateRemoveButtonsVisibility();
  });
  block.querySelector(".group-member-search").addEventListener("input", () => applyRowVisibility(block));

  updateRemoveButtonsVisibility();
}

async function buildMemberChecklist(block) {
  const people = await getBatchmatesPublicList();
  const container = block.querySelector(".member-checklist");
  container.innerHTML = "";

  people.forEach((p) => {
    const row = document.createElement("label");
    row.className = "member-check-row";
    row.dataset.uid = p.uid;
    row.dataset.name = (p.fullName + " " + p.campusIndexNumber).toLowerCase();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "member-checkbox";
    cb.value = p.uid;
    cb.dataset.displayName = `${p.fullName} (${p.campusIndexNumber})`;

    const label = document.createElement("span");
    label.textContent = `${p.fullName} — ${p.campusIndexNumber}`;

    row.appendChild(cb);
    row.appendChild(label);
    container.appendChild(row);
  });
}

// Leader picker for a group block — a <select>, not free text, so a
// leader can be targeted by UID for ratings/prestige. Participates in
// the same taken-by-another-group exclusion as member checkboxes.
async function buildLeaderSelect(block) {
  const people = await getBatchmatesPublicList();
  const select = block.querySelector(".group-leader-select");
  select.innerHTML = "";

  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "— Select leader —";
  select.appendChild(blankOpt);

  people.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.uid;
    opt.dataset.displayName = `${p.fullName} (${p.campusIndexNumber})`;
    opt.textContent = `${p.fullName} — ${p.campusIndexNumber}`;
    select.appendChild(opt);
  });

  select.addEventListener("change", refreshMemberExclusions);
}

function applyRowVisibility(block) {
  const term = block.querySelector(".group-member-search").value.trim().toLowerCase();
  block.querySelectorAll(".member-check-row").forEach((row) => {
    const excluded = row.dataset.excluded === "true";
    const matches = !term || row.dataset.name.includes(term);
    row.hidden = excluded || !matches;
  });
}

// Whenever a member checkbox or leader select changes anywhere, that
// student disappears from every OTHER group's member list and leader
// dropdown — a student can only be one leader or member, in one group,
// per project (leader and member are mutually exclusive roles too).
function refreshMemberExclusions() {
  const takenBy = {}; // uid -> the blockId that currently has them (member or leader)
  document.querySelectorAll(".group-block").forEach((block) => {
    block.querySelectorAll(".member-checkbox:checked").forEach((cb) => {
      takenBy[cb.value] = block.dataset.blockId;
    });
    const leaderSelect = block.querySelector(".group-leader-select");
    if (leaderSelect && leaderSelect.value) takenBy[leaderSelect.value] = block.dataset.blockId;
  });

  document.querySelectorAll(".group-block").forEach((block) => {
    block.querySelectorAll(".member-check-row").forEach((row) => {
      const owner = takenBy[row.dataset.uid];
      row.dataset.excluded = (owner && owner !== block.dataset.blockId) ? "true" : "false";
      // A member checkbox for someone who is THIS block's own leader is
      // also excluded — a leader can't also be a listed member.
      const leaderSelect = block.querySelector(".group-leader-select");
      if (leaderSelect && leaderSelect.value === row.dataset.uid) row.dataset.excluded = "true";
    });
    applyRowVisibility(block);

    const leaderSelect = block.querySelector(".group-leader-select");
    if (leaderSelect) {
      Array.from(leaderSelect.options).forEach((opt) => {
        if (!opt.value) return;
        const owner = takenBy[opt.value];
        opt.hidden = !!(owner && owner !== block.dataset.blockId && opt.value !== leaderSelect.value);
      });
    }
  });
}

function updateRemoveButtonsVisibility() {
  const blocks = document.querySelectorAll(".group-block");
  blocks.forEach((block) => {
    block.querySelector(".remove-group-btn").hidden = blocks.length <= 1;
  });
}

async function populateBatchmateSelect() {
  const select = document.getElementById("task-batchmate");
  if (!select) return;

  const people = await getBatchmatesPublicList();
  select.innerHTML = "";

  if (people.length === 0) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No batchmates found";
    select.appendChild(opt);
    return;
  }

  people.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.uid;
    opt.textContent = p.fullName;
    select.appendChild(opt);
  });
}

// Shows every task that isn't complete yet. A task the batchmate has
// marked "pending" gets a "Needs verification" badge and a Verify button;
// admins can also verify a still-"ongoing" task directly if they want to.
// Each box also has a 1-10 rating select — required before Verify is
// enabled, since the rating always contributes prestige points even
// when the difficulty-based points are lost to a missed deadline.
const TASK_DIFFICULTY_POINTS = { easy: 5, medium: 10, hard: 20, nightmare: 35 };
const TASK_RATING_POINTS_PER_STAR = 2;

let activeTasksCache = null;

async function renderAdminActiveTasks() {
  const container = document.getElementById("admin-active-tasks");
  const filterSelect = document.getElementById("active-tasks-filter");
  if (!container) return;
  container.innerHTML = "Loading…";

  const q = query(collection(db, "tasks"), where("status", "in", ["ongoing", "pending"]));
  const snap = await getDocs(q);
  activeTasksCache = [];
  snap.forEach((docSnap) => activeTasksCache.push({ id: docSnap.id, ...docSnap.data() }));

  if (filterSelect) {
    const currentVal = filterSelect.value;
    const byUid = new Map();
    activeTasksCache.forEach((t) => { if (t.assignedToUid) byUid.set(t.assignedToUid, t.assignedToName || "Unknown"); });
    const names = Array.from(byUid.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    filterSelect.innerHTML = '<option value="">All students</option>';
    names.forEach(([uid, name]) => {
      const opt = document.createElement("option");
      opt.value = uid;
      opt.textContent = name;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = names.some(([uid]) => uid === currentVal) ? currentVal : "";
  }

  renderActiveTasksList(filterSelect ? filterSelect.value : "");
}

function renderActiveTasksList(filterUid) {
  const container = document.getElementById("admin-active-tasks");
  if (!container || !activeTasksCache) return;

  const list = filterUid ? activeTasksCache.filter((t) => t.assignedToUid === filterUid) : activeTasksCache;

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active tasks right now.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((task) => {
    const docId = task.id;
    const isPending = task.status === "pending";

    const box = document.createElement("div");
    box.className = "admin-task-box" + (isPending ? " needs-verify" : "");

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "admin-task-name";
    name.textContent = task.taskName || "Untitled task";
    const assignee = document.createElement("div");
    assignee.className = "admin-task-assignee";
    assignee.textContent = task.assignedToName || "Unknown batchmate";
    left.appendChild(name);
    left.appendChild(assignee);
    if (isPending) {
      const badge = document.createElement("span");
      badge.className = "admin-task-badge";
      badge.textContent = "Needs verification";
      left.appendChild(document.createElement("br"));
      left.appendChild(badge);
    }

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    const ratingSelect = document.createElement("select");
    ratingSelect.className = "task-rating-select";
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "Rate…";
    ratingSelect.appendChild(blankOpt);
    for (let i = 1; i <= 10; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = String(i);
      ratingSelect.appendChild(opt);
    }

    const verifyBtn = document.createElement("button");
    verifyBtn.className = "admin-task-verify-btn";
    verifyBtn.textContent = "Verify";
    verifyBtn.addEventListener("click", async () => {
      const rating = Number(ratingSelect.value);
      if (!rating) {
        alert("Pick a rating (1-10) before verifying — it always contributes prestige points.");
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = "…";
      try {
        await adminVerifyTask(docId, task, rating);
        box.remove();
        if (!container.querySelector(".admin-task-box")) {
          container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active tasks right now.</p>';
        }
      } catch (err) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify";
        alert("Could not verify this task. Please try again.");
      }
    });

    right.appendChild(ratingSelect);
    right.appendChild(verifyBtn);
    box.appendChild(left);
    box.appendChild(right);
    container.appendChild(box);
  });
}

// Admin action: marks a task fully complete, awards its prestige points,
// and makes it disappear from the batchmate's Active Tasks card.
// Points = (difficulty base, only if finished on time) + (rating × 2).
// "On time" is judged against completionRequestedAt (when the batchmate
// hit "Notify me") if present, falling back to today for older tasks
// that predate that field.
async function adminVerifyTask(taskId, task, rating) {
  const dueDate = task.dueDate || "";
  const doneDate = task.completionRequestedAt || new Date().toISOString().slice(0, 10);
  const onTime = !dueDate || doneDate <= dueDate;

  const basePoints = onTime ? (TASK_DIFFICULTY_POINTS[task.difficulty] || 0) : 0;
  const ratingPoints = rating * TASK_RATING_POINTS_PER_STAR;
  const rawAmount = basePoints + ratingPoints;

  await updateDoc(doc(db, "tasks", taskId), {
    status: "complete",
    completedDate: new Date().toISOString().slice(0, 10),
    rating,
    onTime
  });

  if (task.assignedToUid && rawAmount > 0) {
    const missedNote = onTime ? "" : " (deadline missed — no difficulty points)";
    await awardPrestige({
      uid: task.assignedToUid,
      rawAmount,
      source: "task",
      note: `Task: ${task.taskName || "Untitled task"}${missedNote}`
    });
  }
}

// ── Admin: Completed Tasks (history) ────────────────────────────
let completedTasksCache = null;

async function renderAdminCompletedTasks() {
  const container = document.getElementById("admin-completed-tasks");
  const filterSelect = document.getElementById("completed-tasks-filter");
  if (!container) return;
  container.innerHTML = "Loading…";

  const q = query(collection(db, "tasks"), where("status", "==", "complete"));
  const snap = await getDocs(q);
  completedTasksCache = [];
  snap.forEach((docSnap) => completedTasksCache.push({ id: docSnap.id, ...docSnap.data() }));

  if (filterSelect) {
    const currentVal = filterSelect.value;
    const byUid = new Map();
    completedTasksCache.forEach((t) => { if (t.assignedToUid) byUid.set(t.assignedToUid, t.assignedToName || "Unknown"); });
    const names = Array.from(byUid.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    filterSelect.innerHTML = '<option value="">All students</option>';
    names.forEach(([uid, name]) => {
      const opt = document.createElement("option");
      opt.value = uid;
      opt.textContent = name;
      filterSelect.appendChild(opt);
    });
    filterSelect.value = names.some(([uid]) => uid === currentVal) ? currentVal : "";
  }

  renderCompletedTasksList();
}

function renderCompletedTasksList() {
  const container = document.getElementById("admin-completed-tasks");
  if (!container || !completedTasksCache) return;

  const sortSelect = document.getElementById("completed-tasks-sort");
  const filterSelect = document.getElementById("completed-tasks-filter");
  const sortMode = sortSelect ? sortSelect.value : "date-desc";
  const filterUid = filterSelect ? filterSelect.value : "";

  let list = completedTasksCache.slice();
  if (filterUid) list = list.filter((t) => t.assignedToUid === filterUid);
  if (sortMode === "date-asc") {
    list.sort((a, b) => (a.completedDate || "").localeCompare(b.completedDate || ""));
  } else if (sortMode === "batchmate") {
    list.sort((a, b) => (a.assignedToName || "").localeCompare(b.assignedToName || ""));
  } else {
    list.sort((a, b) => (b.completedDate || "").localeCompare(a.completedDate || ""));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No completed tasks yet.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((task) => {
    const box = document.createElement("div");
    box.className = "admin-task-box admin-click-box";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "admin-task-name";
    name.textContent = task.taskName || "Untitled task";
    const assignee = document.createElement("div");
    assignee.className = "admin-task-assignee";
    assignee.textContent = (task.assignedToName || "Unknown batchmate") +
      " · " + (task.completedDate || "—") +
      (task.rating ? " · rated " + task.rating + "/10" : "") +
      (task.onTime === false ? " · late" : "");
    left.appendChild(name);
    left.appendChild(assignee);

    box.appendChild(left);
    box.addEventListener("click", () => openTaskDetailModal(task));
    container.appendChild(box);
  });
}

// Simple label/value detail popup for a completed task — reuses
// #modal-task-detail (in admin.html) so the Completed Tasks history
// list itself can stay a compact single-line box.
function openTaskDetailModal(task) {
  const body = document.getElementById("task-detail-body");
  const overlay = document.getElementById("modal-task-detail");
  if (!body || !overlay) return;

  const rows = [
    ["Task", task.taskName || "Untitled task"],
    ["Assigned to", task.assignedToName || "Unknown batchmate"],
    ["Difficulty", task.difficulty || "—"],
    ["Due date", task.dueDate || "—"],
    ["Description", task.description || "—"],
    ["Status", task.status || "—"],
    ["Completed", task.completedDate || "—"],
    ["Rating", task.rating ? task.rating + "/10" : "—"],
    ["On time", task.onTime === false ? "No" : (task.status === "complete" ? "Yes" : "—")]
  ];
  body.innerHTML = "";
  rows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "admin-detail-row";
    row.innerHTML = `<span class="admin-detail-label">${label}</span><span class="admin-detail-value"></span>`;
    row.querySelector(".admin-detail-value").textContent = value;
    body.appendChild(row);
  });
  overlay.hidden = false;
}

// ── Admin: Prestige Leaderboard ─────────────────────────────────
// Reads /batchmates directly (via the admin-read bypass), NOT
// batchmatesPublic — prestige totals are deliberately not mirrored
// into the public collection, so a batchmate can see their own total
// on their Dashboard but never anyone else's. This panel is the only
// place the full ranking is visible, and only admins can open it.
async function renderPrestigeLeaderboard() {
  const container = document.getElementById("admin-leaderboard");
  if (!container) return;
  container.innerHTML = "Loading…";

  const snap = await getDocs(collection(db, "batchmates"));
  const list = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    list.push({ fullName: d.fullName || "Unnamed", points: Number(d.prestigePoints) || 0 });
  });
  list.sort((a, b) => b.points - a.points);

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No batchmates found.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((p, index) => {
    const row = document.createElement("div");
    row.className = "prestige-log-item";

    const left = document.createElement("div");
    left.className = "prestige-log-note";
    left.textContent = `${index + 1}. ${p.fullName}`;

    const right = document.createElement("div");
    right.className = "prestige-log-amount prestige-positive";
    right.textContent = p.points.toLocaleString();

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  });
}

// ── Admin: Fund Contribution Leaderboard ────────────────────────
// Same shape as the Prestige Leaderboard above, ranked by `fundDonated`
// instead. Reads the admin-only `batchmates` collection (not
// `batchmatesPublic`) for the same privacy reason prestige points were
// moved off `batchmatesPublic` — donation totals are admin-only too.
async function renderFundLeaderboard() {
  const container = document.getElementById("admin-fund-leaderboard");
  if (!container) return;
  container.innerHTML = "Loading…";

  const snap = await getDocs(collection(db, "batchmates"));
  const list = [];
  snap.forEach((docSnap) => {
    const d = docSnap.data();
    list.push({ fullName: d.fullName || "Unnamed", donated: Number(d.fundDonated) || 0 });
  });
  list.sort((a, b) => b.donated - a.donated);

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No batchmates found.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((p, index) => {
    const row = document.createElement("div");
    row.className = "prestige-log-item";

    const left = document.createElement("div");
    left.className = "prestige-log-note";
    left.textContent = `${index + 1}. ${p.fullName}`;

    const right = document.createElement("div");
    right.className = "prestige-log-amount prestige-positive";
    right.textContent = "Rs. " + p.donated.toLocaleString();

    row.appendChild(left);
    row.appendChild(right);
    container.appendChild(row);
  });
}

// ── Admin: Fund Transaction History ──────────────────────────────
// Every fundTransactions doc, editable/deletable after the fact — unlike
// the read-only history a batchmate sees on fund.html. Two shapes exist
// (see initFundTransactionForm): "lump" (a single amount, no side effects
// on any batchmate doc) and "perStudent" (amount = perStudentAmount ×
// studentUids.length; an *income* one also bumped each listed student's
// fundDonated and awarded prestige at creation time). Editing/deleting a
// lump transaction is a plain updateDoc/deleteDoc. Editing/deleting a
// perStudent *income* transaction has to mirror those side effects: apply
// the same delta (or full reversal, on delete) to fundDonated and log a
// matching prestige adjustment for every listed student, using the same
// Math.floor(amount / FUND_LKR_PER_POINT) rule the original award used so
// point totals stay exactly reversible. The type and student roster of a
// perStudent transaction are locked in the edit modal — changing either
// would mean retroactively applying or undoing donation/prestige effects
// that were never computed for the "other" combination, so instead the
// admin is asked to delete and re-add if that's genuinely what's needed.
let fundTransactionsCache = null;

async function renderAdminFundTransactions() {
  const container = document.getElementById("admin-fund-transactions");
  if (!container) return;
  container.innerHTML = "Loading…";

  const q = query(collection(db, "fundTransactions"), orderBy("date", "desc"));
  const snap = await getDocs(q);
  fundTransactionsCache = [];
  snap.forEach((docSnap) => fundTransactionsCache.push({ id: docSnap.id, ...docSnap.data() }));

  renderFundTransactionsList();
}

function renderFundTransactionsList() {
  const container = document.getElementById("admin-fund-transactions");
  if (!container || !fundTransactionsCache) return;

  const filterSelect = document.getElementById("fundtx-filter");
  const sortSelect = document.getElementById("fundtx-sort");
  const filterType = filterSelect ? filterSelect.value : "";
  const sortMode = sortSelect ? sortSelect.value : "date-desc";

  let list = fundTransactionsCache.slice();
  if (filterType) list = list.filter((tx) => (tx.type || "").toLowerCase() === filterType);

  if (sortMode === "date-asc") {
    list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  } else if (sortMode === "amount-desc") {
    list.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
  } else if (sortMode === "amount-asc") {
    list.sort((a, b) => (Number(a.amount) || 0) - (Number(b.amount) || 0));
  } else {
    list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No transactions recorded yet.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((tx) => {
    const box = document.createElement("div");
    box.className = "admin-task-box admin-click-box";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "admin-task-name";
    const amount = Number(tx.amount) || 0;
    const isExpense = (tx.type || "").toLowerCase() === "expense";
    name.textContent = `${isExpense ? "−" : "+"} Rs. ${amount.toLocaleString()} — ${tx.description || "Untitled transaction"}`;

    const meta = document.createElement("div");
    meta.className = "admin-task-assignee";
    const modeLabel = tx.mode === "perStudent"
      ? `Per student × ${(tx.studentUids || []).length}`
      : "Single value";
    meta.textContent = `${tx.date || "No date"} · ${isExpense ? "expense" : "income"} · ${modeLabel}`;

    left.appendChild(name);
    left.appendChild(meta);
    box.appendChild(left);
    box.addEventListener("click", () => openFundTransactionEditModal(tx));
    container.appendChild(box);
  });
}

function openFundTransactionEditModal(tx) {
  document.getElementById("fundtx-id").value = tx.id;
  document.getElementById("fundtx-mode").value = tx.mode || "lump";
  document.getElementById("fundtx-type").value = (tx.type || "income").toLowerCase();
  document.getElementById("fundtx-description").value = tx.description || "";
  document.getElementById("fundtx-date").value = tx.date || "";
  document.getElementById("fundtx-error").hidden = true;
  document.getElementById("fundtx-success").hidden = true;

  const typeSelect = document.getElementById("fundtx-type");
  const amountLabel = document.getElementById("fundtx-amount-label");
  const amountInput = document.getElementById("fundtx-amount");
  const totalNote = document.getElementById("fundtx-total-note");
  const studentsSection = document.getElementById("fundtx-students-section");
  const studentsList = document.getElementById("fundtx-students-list");
  const modeNote = document.getElementById("fundtx-mode-note");

  if (tx.mode === "perStudent") {
    const names = tx.studentNames || [];

    typeSelect.disabled = true;
    amountLabel.textContent = "Amount per student";
    amountInput.value = tx.perStudentAmount != null ? tx.perStudentAmount : "";
    totalNote.hidden = false;
    totalNote.textContent = `Total = amount per student × ${names.length} student${names.length === 1 ? "" : "s"}. Saving updates each listed student's fund total and prestige by the difference.`;
    modeNote.textContent = "Per-student transaction — the type and student list are locked here. Only the amount per student, description, and date can be changed. To change who's included, delete this and re-add it from the Add tab.";
    studentsSection.hidden = false;
    studentsList.innerHTML = "";
    names.forEach((n) => {
      const row = document.createElement("div");
      row.className = "member-check-row";
      row.style.cursor = "default";
      row.textContent = n;
      studentsList.appendChild(row);
    });
  } else {
    typeSelect.disabled = false;
    amountLabel.textContent = "Amount";
    amountInput.value = tx.amount != null ? tx.amount : "";
    totalNote.hidden = true;
    modeNote.textContent = "Single-value transaction — every field here can be edited freely.";
    studentsSection.hidden = true;
    studentsList.innerHTML = "";
  }

  document.getElementById("modal-fundtx-edit").hidden = false;
}

function wireFundTransactionEditModal() {
  const form = document.getElementById("form-fundtx-edit");
  const deleteBtn = document.getElementById("fundtx-delete-btn");
  if (!form || !deleteBtn) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("fundtx-id").value;
    const mode = document.getElementById("fundtx-mode").value;
    const errorEl = document.getElementById("fundtx-error");
    const successEl = document.getElementById("fundtx-success");
    errorEl.hidden = true;
    successEl.hidden = true;

    const tx = (fundTransactionsCache || []).find((t) => t.id === id);
    if (!tx) {
      errorEl.textContent = "Could not find this transaction — try refreshing.";
      errorEl.hidden = false;
      return;
    }

    const description = document.getElementById("fundtx-description").value.trim();
    const date = document.getElementById("fundtx-date").value;
    const newAmountInput = Number(document.getElementById("fundtx-amount").value) || 0;

    try {
      if (newAmountInput <= 0) throw new Error("Enter an amount.");

      if (mode === "perStudent") {
        const oldPerHead = Number(tx.perStudentAmount) || 0;
        const studentUids = tx.studentUids || [];

        await updateDoc(doc(db, "fundTransactions", id), {
          perStudentAmount: newAmountInput,
          amount: newAmountInput * studentUids.length,
          description,
          date
        });

        // Only "income" per-student transactions touched fundDonated/
        // prestige at creation (see initFundTransactionForm) — mirror
        // that here so an expense-mode per-student record is never
        // awarded. Comparing floor(old/100) to floor(new/100), rather
        // than flooring the raw delta, keeps this exactly reversible
        // against the whole-point amount the original award used.
        if ((tx.type || "").toLowerCase() === "income") {
          const oldPoints = Math.floor(oldPerHead / FUND_LKR_PER_POINT);
          const newPoints = Math.floor(newAmountInput / FUND_LKR_PER_POINT);
          const pointsDelta = newPoints - oldPoints;
          const amountDelta = newAmountInput - oldPerHead;

          for (const uid of studentUids) {
            if (amountDelta !== 0) {
              await updateDoc(doc(db, "batchmates", uid), { fundDonated: increment(amountDelta) });
            }
            if (pointsDelta !== 0) {
              await awardPrestige({
                uid,
                rawAmount: pointsDelta,
                source: "fund-donation-edit",
                note: `Fund donation edited: Rs. ${oldPerHead} → Rs. ${newAmountInput} — ${description || "batch fund"}`
              });
            }
          }
        }
      } else {
        const type = document.getElementById("fundtx-type").value;
        await updateDoc(doc(db, "fundTransactions", id), {
          type,
          amount: newAmountInput,
          description,
          date
        });
      }

      successEl.textContent = "Transaction updated.";
      successEl.hidden = false;
      await renderAdminFundTransactions();
      await renderFundLeaderboard();
      setTimeout(() => { document.getElementById("modal-fundtx-edit").hidden = true; }, 700);
    } catch (err) {
      errorEl.textContent = err.message || "Could not save changes. Please try again.";
      errorEl.hidden = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const id = document.getElementById("fundtx-id").value;
    const mode = document.getElementById("fundtx-mode").value;
    if (!id) return;
    if (!confirm("Delete this transaction? This can't be undone.")) return;

    const errorEl = document.getElementById("fundtx-error");
    errorEl.hidden = true;
    const tx = (fundTransactionsCache || []).find((t) => t.id === id);

    try {
      if (tx && mode === "perStudent" && (tx.type || "").toLowerCase() === "income") {
        const perHead = Number(tx.perStudentAmount) || 0;
        const points = Math.floor(perHead / FUND_LKR_PER_POINT);
        const studentUids = tx.studentUids || [];

        for (const uid of studentUids) {
          if (perHead) {
            await updateDoc(doc(db, "batchmates", uid), { fundDonated: increment(-perHead) });
          }
          if (points > 0) {
            await awardPrestige({
              uid,
              rawAmount: -points,
              source: "fund-donation-delete",
              note: `Fund donation removed: Rs. ${perHead} — ${tx.description || "batch fund"}`
            });
          }
        }
      }

      await deleteDoc(doc(db, "fundTransactions", id));
      document.getElementById("modal-fundtx-edit").hidden = true;
      await renderAdminFundTransactions();
      await renderFundLeaderboard();
    } catch (err) {
      errorEl.textContent = "Could not delete this transaction. Please try again.";
      errorEl.hidden = false;
    }
  });
}

// ── Admin: Active Events ─────────────────────────────────────────
// Every event, editable inline via a popup form (unlike the Home page's
// read-only upcoming-only view, this includes past events too, since an
// admin may still need to fix a typo or remove one after the fact).
let activeEventsCache = null;

async function renderAdminActiveEvents() {
  const container = document.getElementById("admin-active-events");
  if (!container) return;
  container.innerHTML = "Loading…";

  const snap = await getDocs(collection(db, "events"));
  activeEventsCache = [];
  snap.forEach((docSnap) => activeEventsCache.push({ id: docSnap.id, ...docSnap.data() }));
  activeEventsCache.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  if (activeEventsCache.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No events yet.</p>';
    return;
  }

  container.innerHTML = "";
  activeEventsCache.forEach((ev) => {
    const box = document.createElement("div");
    box.className = "admin-event-box";
    const name = document.createElement("div");
    name.className = "admin-event-name";
    name.textContent = ev.name || "Untitled event";
    const meta = document.createElement("div");
    meta.className = "admin-event-meta";
    meta.textContent = formatEventDate(ev.date) || "No date set";
    box.appendChild(name);
    box.appendChild(meta);
    box.addEventListener("click", () => openEventEditModal(ev));
    container.appendChild(box);
  });
}

async function openEventEditModal(ev) {
  document.getElementById("eventedit-id").value = ev.id;
  document.getElementById("eventedit-name").value = ev.name || "";
  document.getElementById("eventedit-datetime").value = ev.date || "";
  document.getElementById("eventedit-description").value = ev.description || "";
  document.getElementById("eventedit-leaders").value = Array.isArray(ev.leaders) ? ev.leaders.join("|") : "";
  document.getElementById("eventedit-error").hidden = true;
  document.getElementById("eventedit-success").hidden = true;

  await populateEventLabelSelect("eventedit-labels-select");
  const select = document.getElementById("eventedit-labels-select");
  const selectedLabels = new Set(Array.isArray(ev.labels) ? ev.labels : []);
  Array.from(select.options).forEach((opt) => { opt.selected = selectedLabels.has(opt.value); });

  document.getElementById("modal-event-edit").hidden = false;
}

function wireEventEditModal() {
  const form = document.getElementById("form-event-edit");
  const deleteBtn = document.getElementById("eventedit-delete-btn");
  if (!form || !deleteBtn) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("eventedit-id").value;
    const errorEl = document.getElementById("eventedit-error");
    const successEl = document.getElementById("eventedit-success");
    errorEl.hidden = true;
    successEl.hidden = true;

    const select = document.getElementById("eventedit-labels-select");
    const selectedLabels = Array.from(select.selectedOptions).map((o) => o.value);

    try {
      await updateDoc(doc(db, "events", id), {
        name: document.getElementById("eventedit-name").value.trim(),
        date: document.getElementById("eventedit-datetime").value,
        description: document.getElementById("eventedit-description").value.trim(),
        leaders: splitList(document.getElementById("eventedit-leaders").value, "|"),
        labels: selectedLabels
      });
      successEl.textContent = "Event updated.";
      successEl.hidden = false;
      await renderAdminActiveEvents();
      setTimeout(() => { document.getElementById("modal-event-edit").hidden = true; }, 700);
    } catch (err) {
      errorEl.textContent = "Could not save changes. Please try again.";
      errorEl.hidden = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const id = document.getElementById("eventedit-id").value;
    if (!id) return;
    if (!confirm("Delete this event? This can't be undone.")) return;
    try {
      await deleteDoc(doc(db, "events", id));
      document.getElementById("modal-event-edit").hidden = true;
      await renderAdminActiveEvents();
    } catch (err) {
      document.getElementById("eventedit-error").textContent = "Could not delete this event. Please try again.";
      document.getElementById("eventedit-error").hidden = false;
    }
  });
}

// ── Admin: Add Event Leadership (Danger tab) ─────────────────────
// Picks an existing event and edits its `leaders` array directly —
// same field the Add Event / Edit Event forms write as a pipe-separated
// list, just exposed here as individually add/removable entries.
async function initEventLeadershipPanel() {
  const select = document.getElementById("eventleadership-event-select");
  const form = document.getElementById("form-eventleadership");
  if (!select || !form) return;

  const snap = await getDocs(collection(db, "events"));
  const events = [];
  snap.forEach((docSnap) => events.push({ id: docSnap.id, ...docSnap.data() }));
  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  select.innerHTML = "";
  events.forEach((ev) => {
    const opt = document.createElement("option");
    opt.value = ev.id;
    opt.textContent = (ev.name || "Untitled event") + (ev.date ? " — " + formatEventDate(ev.date) : "");
    select.appendChild(opt);
  });

  function currentEvent() {
    return events.find((ev) => ev.id === select.value);
  }

  function renderLeaderList() {
    const list = document.getElementById("eventleadership-list");
    const ev = currentEvent();
    const leaders = ev && Array.isArray(ev.leaders) ? ev.leaders : [];
    list.innerHTML = "";
    if (leaders.length === 0) {
      list.innerHTML = '<p class="info-text" style="color:var(--muted)">No leaders added yet.</p>';
      return;
    }
    leaders.forEach((leaderName) => {
      const row = document.createElement("div");
      row.className = "admin-rating-row";
      const label = document.createElement("span");
      label.textContent = leaderName;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost-btn";
      removeBtn.style.cssText = "padding:5px 10px; font-size:12px;";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        removeBtn.disabled = true;
        try {
          await updateDoc(doc(db, "events", ev.id), { leaders: arrayRemove(leaderName) });
          ev.leaders = (ev.leaders || []).filter((n) => n !== leaderName);
          renderLeaderList();
        } catch (err) {
          removeBtn.disabled = false;
          alert("Could not remove this leader. Please try again.");
        }
      });
      row.appendChild(label);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }

  if (events.length > 0) renderLeaderList();
  else document.getElementById("eventleadership-list").innerHTML = '<p class="info-text" style="color:var(--muted)">No events exist yet — add one first.</p>';

  select.addEventListener("change", renderLeaderList);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const ev = currentEvent();
    const errorEl = document.getElementById("eventleadership-error");
    const successEl = document.getElementById("eventleadership-success");
    errorEl.hidden = true;
    successEl.hidden = true;
    if (!ev) return;

    const nameInput = document.getElementById("eventleadership-name");
    const name = nameInput.value.trim();
    if (!name) return;

    try {
      await updateDoc(doc(db, "events", ev.id), { leaders: arrayUnion(name) });
      ev.leaders = Array.isArray(ev.leaders) ? [...ev.leaders, name] : [name];
      renderLeaderList();
      nameInput.value = "";
      successEl.textContent = "Leader added.";
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = "Could not add this leader. Please try again.";
      errorEl.hidden = false;
    }
  });
}

// ── Admin: Active Group Projects ────────────────────────────────
// Lists every project that isn't complete yet, with three toggle buttons
// (Starting / Ongoing / Complete) to change its top-level status. Tapping
// "Complete" pulls it off the public home page immediately (renderProjects
// filters out status === "complete"); it also fades out of this panel since
// it's no longer "active".
const PROJECT_STATUSES = [
  { value: "starting", label: "Starting" },
  { value: "ongoing", label: "Ongoing" },
  { value: "complete", label: "Complete" }
];

async function renderAdminActiveProjects() {
  const container = document.getElementById("admin-active-projects");
  if (!container) return;
  container.innerHTML = "Loading…";

  const snap = await getDocs(collection(db, "groupProjects"));

  const projects = [];
  snap.forEach((docSnap) => {
    const p = docSnap.data();
    if (p.status === "complete") return; // already removed from the site — no need to manage it here
    projects.push({ id: docSnap.id, ...p });
  });

  if (projects.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active projects right now.</p>';
    return;
  }

  projects.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  container.innerHTML = "";
  projects.forEach((p) => {
    const box = document.createElement("div");
    box.className = "admin-project-box";

    const name = document.createElement("div");
    name.className = "admin-project-name";
    name.textContent = p.title || "Untitled project";
    box.appendChild(name);

    if (p.description) {
      const desc = document.createElement("div");
      desc.className = "admin-project-desc";
      desc.textContent = p.description;
      box.appendChild(desc);
    }

    const toggles = document.createElement("div");
    toggles.className = "project-status-toggles";

    const currentStatus = p.status || "starting";
    PROJECT_STATUSES.forEach(({ value, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "project-status-toggle" + (value === currentStatus ? " active" : "");
      btn.dataset.status = value;
      btn.textContent = label;

      btn.addEventListener("click", async () => {
        if (btn.classList.contains("active")) return;

        if (value === "complete") {
          const confirmed = confirm(`Mark "${p.title || "this project"}" as complete? It will be removed from the website.`);
          if (!confirmed) return;
        }

        toggles.querySelectorAll(".project-status-toggle").forEach((b) => (b.disabled = true));

        try {
          const updates = { status: value };
          if (value === "complete") updates.completedDate = new Date().toISOString().slice(0, 10);
          await updateDoc(doc(db, "groupProjects", p.id), updates);

          if (value === "complete") {
            box.classList.add("removing");
            setTimeout(() => {
              box.remove();
              if (!container.querySelector(".admin-project-box")) {
                container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active projects right now.</p>';
              }
            }, 250);
            renderAdminCompletedProjects();
          } else {
            toggles.querySelectorAll(".project-status-toggle").forEach((b) => {
              b.classList.toggle("active", b.dataset.status === value);
              b.disabled = false;
            });
          }
        } catch (err) {
          toggles.querySelectorAll(".project-status-toggle").forEach((b) => (b.disabled = false));
          alert("Could not update this project's status. Please try again.");
        }
      });

      toggles.appendChild(btn);
    });

    box.appendChild(toggles);

    const ratingSection = document.createElement("div");
    ratingSection.className = "admin-project-rating-section";
    box.appendChild(ratingSection);
    renderAdminProjectRatingControls(ratingSection, p);

    container.appendChild(box);
  });
}

// Admin's two rating tools for a project: one overall rating that pays
// every member of every group the same points, and one rating per group
// that only pays that group's members + leader. Each can only be
// awarded once per project/group (re-renders show "Awarded: X/10"
// instead of the controls once set) to avoid double-paying prestige.
function renderAdminProjectRatingControls(container, p) {
  container.innerHTML = "";

  const overallRow = document.createElement("div");
  overallRow.className = "admin-rating-row";
  const overallLabel = document.createElement("span");
  overallLabel.textContent = "Overall Project Rating";
  overallRow.appendChild(overallLabel);

  if (p.overallRating && typeof p.overallRating.value === "number") {
    const awarded = document.createElement("span");
    awarded.className = "admin-rating-awarded";
    awarded.textContent = `Awarded: ${p.overallRating.value}/10 to everyone`;
    overallRow.appendChild(awarded);
  } else {
    const select = buildRatingSelect();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-task-verify-btn";
    btn.textContent = "Award to All";
    btn.addEventListener("click", async () => {
      const value = Number(select.value);
      if (!value) { alert("Pick a rating (1-10) first."); return; }
      btn.disabled = true;
      try {
        await awardOverallProjectRating(p, value);
        renderAdminProjectRatingControls(container, p);
      } catch (err) {
        btn.disabled = false;
        alert("Could not award this rating. Please try again.");
      }
    });
    overallRow.appendChild(select);
    overallRow.appendChild(btn);
  }
  container.appendChild(overallRow);

  const groups = Array.isArray(p.groups) ? p.groups : [];
  groups.forEach((g, index) => {
    const row = document.createElement("div");
    row.className = "admin-rating-row";
    const label = document.createElement("span");
    label.textContent = "Group Rating — " + (g.groupName || "Whole Batch");
    row.appendChild(label);

    if (g.rating && typeof g.rating.value === "number") {
      const awarded = document.createElement("span");
      awarded.className = "admin-rating-awarded";
      awarded.textContent = `Awarded: ${g.rating.value}/10`;
      row.appendChild(awarded);
    } else {
      const select = buildRatingSelect();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-task-verify-btn";
      btn.textContent = "Award to Group";
      btn.addEventListener("click", async () => {
        const value = Number(select.value);
        if (!value) { alert("Pick a rating (1-10) first."); return; }
        btn.disabled = true;
        try {
          await awardGroupRating(p, index, value);
          renderAdminProjectRatingControls(container, p);
        } catch (err) {
          btn.disabled = false;
          alert("Could not award this rating. Please try again.");
        }
      });
      row.appendChild(select);
      row.appendChild(btn);
    }

    if (g.ratingsFinalized) {
      const badge = document.createElement("span");
      badge.className = "admin-rating-awarded";
      badge.textContent = "Peer ratings finalized ✓";
      row.appendChild(badge);
    }

    container.appendChild(row);
  });
}

function buildRatingSelect() {
  const select = document.createElement("select");
  select.className = "task-rating-select";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Rate…";
  select.appendChild(blank);
  for (let i = 1; i <= 10; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = String(i);
    select.appendChild(opt);
  }
  return select;
}

async function awardOverallProjectRating(p, value) {
  const groups = Array.isArray(p.groups) ? p.groups : [];
  for (const g of groups) {
    const roster = getGroupRoster(g);
    for (const person of roster) {
      await awardPrestige({
        uid: person.uid,
        rawAmount: value * OVERALL_RATING_POINTS_PER_STAR,
        source: "project-overall",
        note: `Project rating: ${p.title || "Untitled project"}`
      });
    }
  }
  const overallRating = { value, ratedAt: new Date().toISOString() };
  await updateDoc(doc(db, "groupProjects", p.id), { overallRating });

  // Mirror onto the in-memory project object — otherwise the re-render
  // right after this call (see the "Award to All" click handler) would
  // still see p.overallRating as unset and show the award controls again,
  // letting the button be clicked repeatedly and re-award every member.
  p.overallRating = overallRating;
}

async function awardGroupRating(p, groupIndex, value) {
  const groups = Array.isArray(p.groups) ? p.groups.slice() : [];
  const roster = getGroupRoster(groups[groupIndex] || {});
  for (const person of roster) {
    await awardPrestige({
      uid: person.uid,
      rawAmount: value * GROUP_RATING_POINTS_PER_STAR,
      source: "project-group",
      note: `Group rating: ${p.title || "Untitled project"} — ${groups[groupIndex].groupName || "Group"}`
    });
  }
  const rating = { value, ratedAt: new Date().toISOString() };
  groups[groupIndex] = { ...groups[groupIndex], rating };
  await updateDoc(doc(db, "groupProjects", p.id), { groups });

  // Mirror onto the in-memory project object — otherwise the re-render
  // right after this call (see the "Award to Group" click handler) would
  // still see this group's rating as unset and show the award controls
  // again, letting the button be clicked repeatedly and re-award the group.
  if (Array.isArray(p.groups) && p.groups[groupIndex]) {
    p.groups[groupIndex].rating = rating;
  }
}

// ── Admin: Completed Group Projects (history) ───────────────────
let completedProjectsCache = null;

async function renderAdminCompletedProjects() {
  const container = document.getElementById("admin-completed-projects");
  const sortSelect = document.getElementById("completed-projects-sort");
  if (!container) return;
  container.innerHTML = "Loading…";

  const snap = await getDocs(collection(db, "groupProjects"));
  completedProjectsCache = [];
  snap.forEach((docSnap) => {
    const p = docSnap.data();
    if (p.status === "complete") completedProjectsCache.push({ id: docSnap.id, ...p });
  });

  renderCompletedProjectsList(sortSelect ? sortSelect.value : "date-desc");
}

function renderCompletedProjectsList(sortMode) {
  const container = document.getElementById("admin-completed-projects");
  if (!container || !completedProjectsCache) return;

  const list = completedProjectsCache.slice();
  if (sortMode === "date-asc") {
    list.sort((a, b) => (a.completedDate || "").localeCompare(b.completedDate || ""));
  } else if (sortMode === "title") {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else {
    list.sort((a, b) => (b.completedDate || "").localeCompare(a.completedDate || ""));
  }

  if (list.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No completed projects yet.</p>';
    return;
  }

  container.innerHTML = "";
  list.forEach((p) => {
    const box = document.createElement("div");
    box.className = "admin-project-box admin-click-box";

    const name = document.createElement("div");
    name.className = "admin-project-name";
    name.textContent = p.title || "Untitled project";
    box.appendChild(name);

    box.addEventListener("click", () => openProjectDetailModal(p));
    container.appendChild(box);
  });
}

// Detail popup for a completed project — reuses #modal-project-detail.
// Shows the top-level project info plus a per-group breakdown (leader,
// members, and that group's individual rating if the admin ever set one).
function openProjectDetailModal(p) {
  const body = document.getElementById("project-detail-body");
  const overlay = document.getElementById("modal-project-detail");
  if (!body || !overlay) return;

  const groups = Array.isArray(p.groups) ? p.groups : [];
  const overall = p.overallRating && typeof p.overallRating.value === "number" ? p.overallRating.value + "/10" : "—";

  const topRows = [
    ["Project", p.title || "Untitled project"],
    ["Description", p.description || "—"],
    ["Status", p.status || "—"],
    ["Completed", p.completedDate || "—"],
    ["Overall rating", overall]
  ];
  body.innerHTML = "";
  topRows.forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "admin-detail-row";
    row.innerHTML = `<span class="admin-detail-label">${label}</span><span class="admin-detail-value"></span>`;
    row.querySelector(".admin-detail-value").textContent = value;
    body.appendChild(row);
  });

  if (groups.length === 0) {
    const none = document.createElement("p");
    none.className = "fine-print";
    none.style.textAlign = "left";
    none.textContent = "No groups were recorded for this project.";
    body.appendChild(none);
  } else {
    groups.forEach((g, i) => {
      const wrap = document.createElement("div");
      wrap.className = "admin-detail-group";
      const title = document.createElement("div");
      title.className = "admin-detail-group-title";
      title.textContent = g.groupName || `Group ${i + 1}`;
      const meta = document.createElement("div");
      meta.className = "admin-detail-group-meta";
      const members = Array.isArray(g.members) ? g.members.join(", ") : "—";
      const groupRating = g.rating && typeof g.rating.value === "number" ? ` · rated ${g.rating.value}/10` : "";
      meta.textContent = `Leader: ${g.leader || "—"} · Members: ${members || "—"}${groupRating}`;
      wrap.appendChild(title);
      wrap.appendChild(meta);
      body.appendChild(wrap);
    });
  }

  overlay.hidden = false;
}

// ── Admin: Detail Change Requests ───────────────────────────────
// Lists every pending /changeRequests doc — a batchmate's proposed edit
// to their own /batchmates fields (submitted from Settings → "Request to
// Change Details"). Approving writes the changed fields straight to
// /batchmates, and also to /batchmatesPublic for whichever of those
// fields are part of that smaller mirror (see CHANGE_REQUEST_FIELD_INFO's
// "public" flag) — keeping the two collections in sync the same way the
// user asked. Rejecting just marks the request rejected without saving
// anything.
async function renderAdminChangeRequests() {
  const container = document.getElementById("admin-change-requests");
  if (!container) return;
  container.innerHTML = "Loading…";

  const q = query(collection(db, "changeRequests"), where("status", "==", "pending"));
  const snap = await getDocs(q);

  if (snap.empty) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No pending change requests.</p>';
    return;
  }

  const requests = [];
  snap.forEach((docSnap) => requests.push({ id: docSnap.id, ...docSnap.data() }));
  requests.sort((a, b) => {
    const aTime = a.submittedAt?.toMillis ? a.submittedAt.toMillis() : 0;
    const bTime = b.submittedAt?.toMillis ? b.submittedAt.toMillis() : 0;
    return aTime - bTime; // oldest first
  });

  container.innerHTML = "";
  requests.forEach((req) => {
    const box = document.createElement("div");
    box.className = "change-request-box";

    const name = document.createElement("div");
    name.className = "change-request-name";
    name.textContent = req.requesterName || "Unknown batchmate";
    box.appendChild(name);

    const meta = document.createElement("div");
    meta.className = "change-request-meta";
    meta.textContent = req.requesterIndex || req.uid || "";
    box.appendChild(meta);

    const diff = document.createElement("div");
    diff.className = "change-request-diff";
    const changes = req.changes || {};
    const previousValues = req.previousValues || {};

    Object.keys(changes).forEach((key) => {
      const info = CHANGE_REQUEST_FIELD_INFO[key];
      const label = info ? info.label : key;
      const oldText = crToInputValue(previousValues[key], !!info?.list) || "—";
      const newText = crToInputValue(changes[key], !!info?.list) || "—";

      const row = document.createElement("div");
      row.className = "change-request-diff-row";
      row.innerHTML =
        `<span class="change-request-diff-label"></span><br>` +
        `<span class="change-request-diff-old"></span> → <span class="change-request-diff-new"></span>`;
      row.querySelector(".change-request-diff-label").textContent = label;
      row.querySelector(".change-request-diff-old").textContent = oldText;
      row.querySelector(".change-request-diff-new").textContent = newText;
      diff.appendChild(row);
    });
    box.appendChild(diff);

    const actions = document.createElement("div");
    actions.className = "change-request-actions";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "change-request-approve-btn";
    approveBtn.textContent = "Approve";

    const rejectBtn = document.createElement("button");
    rejectBtn.type = "button";
    rejectBtn.className = "change-request-reject-btn";
    rejectBtn.textContent = "Reject";

    function removeBox() {
      box.classList.add("removing");
      setTimeout(() => {
        box.remove();
        if (!container.querySelector(".change-request-box")) {
          container.innerHTML = '<p class="info-text" style="color:var(--muted)">No pending change requests.</p>';
        }
      }, 250);
    }

    approveBtn.addEventListener("click", async () => {
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      approveBtn.textContent = "Approving…";
      try {
        await approveChangeRequest(req);
        removeBox();
      } catch (err) {
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        approveBtn.textContent = "Approve";
        alert("Could not approve this request. Please try again.");
      }
    });

    rejectBtn.addEventListener("click", async () => {
      const confirmed = confirm(`Reject ${req.requesterName || "this batchmate"}'s requested changes? Nothing will be saved to their profile.`);
      if (!confirmed) return;
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      rejectBtn.textContent = "Rejecting…";
      try {
        await updateDoc(doc(db, "changeRequests", req.id), {
          status: "rejected",
          reviewedAt: serverTimestamp()
        });
        removeBox();
      } catch (err) {
        approveBtn.disabled = false;
        rejectBtn.disabled = false;
        rejectBtn.textContent = "Reject";
        alert("Could not reject this request. Please try again.");
      }
    });

    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    box.appendChild(actions);
    container.appendChild(box);
  });
}

// Writes an approved request's changed fields to /batchmates, mirrors
// whichever of those fields also live in /batchmatesPublic, then marks
// the request approved. batchmatesPublicListCache is invalidated so the
// directory, task-assignee dropdown, etc. pick up the change right away.
async function approveChangeRequest(req) {
  const changes = req.changes || {};
  if (Object.keys(changes).length === 0) {
    await updateDoc(doc(db, "changeRequests", req.id), { status: "approved", reviewedAt: serverTimestamp() });
    return;
  }

  await updateDoc(doc(db, "batchmates", req.uid), changes);

  const publicChanges = {};
  Object.keys(changes).forEach((key) => {
    if (CHANGE_REQUEST_FIELD_INFO[key]?.public) publicChanges[key] = changes[key];
  });
  if (Object.keys(publicChanges).length > 0) {
    await setDoc(doc(db, "batchmatesPublic", req.uid), publicChanges, { merge: true });
  }

  await updateDoc(doc(db, "changeRequests", req.id), { status: "approved", reviewedAt: serverTimestamp() });
  batchmatesPublicListCache = null;
}

// ── Admin: bulk add/remove a field across every batchmate ──────────
// Applies to the "batchmates" collection only (see the note in the
// popup) — deliberately not "batchmatesPublic", so this can't silently
// widen or corrupt that curated, directory-facing set of fields.
function initBulkFieldForm() {
  const form = document.getElementById("form-bulkfield");
  if (!form) return;
  const actionSelect = document.getElementById("bulkfield-action");
  const keyInput = document.getElementById("bulkfield-key");
  const valueRow = document.getElementById("bulkfield-value-row");
  const valueInput = document.getElementById("bulkfield-value");
  const errorEl = document.getElementById("bulkfield-error");
  const successEl = document.getElementById("bulkfield-success");
  const submitBtn = form.querySelector("button[type=submit]");
  const originalLabel = submitBtn.textContent;

  function syncValueRow() {
    valueRow.hidden = actionSelect.value !== "add";
  }
  actionSelect.addEventListener("change", syncValueRow);
  syncValueRow();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;

    const action = actionSelect.value;
    const key = keyInput.value.trim();

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      errorEl.textContent = "Field name must start with a letter and contain only letters, numbers and underscores.";
      errorEl.hidden = false;
      return;
    }

    const verb = action === "add" ? "add" : "remove";
    const confirmed = confirm(
      action === "add"
        ? `Add "${key}" to every batchmate's record (default value: "${valueInput.value.trim()}")? This cannot be undone from here.`
        : `Remove "${key}" from every batchmate's record? This cannot be undone from here.`
    );
    if (!confirmed) return;

    submitBtn.disabled = true;
    submitBtn.textContent = action === "add" ? "Adding…" : "Removing…";

    try {
      const snap = await getDocs(collection(db, "batchmates"));
      // 66 batchmates comfortably fits Firestore's 500-operation batch
      // limit; if the batch grows past ~450, split this into chunks.
      const batch = writeBatch(db);
      snap.forEach((docSnap) => {
        batch.update(docSnap.ref, { [key]: action === "add" ? valueInput.value.trim() : deleteField() });
      });
      await batch.commit();

      successEl.textContent = `Done — ${verb === "add" ? "added" : "removed"} "${key}" on ${snap.size} batchmate record(s).`;
      successEl.hidden = false;
      form.reset();
      syncValueRow();
    } catch (err) {
      errorEl.textContent = "Could not apply this change — please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

// Fills the "Labels" multi-select on the admin page from the eventLabels
// collection. Called on admin page load, and again right after a new
// label is added, so it's usable without reloading the page.
async function populateEventLabelSelect(targetId = "event-labels-select") {
  const select = document.getElementById(targetId);
  if (!select) return;

  const previouslySelected = new Set(Array.from(select.selectedOptions).map((o) => o.value));
  const snap = await getDocs(collection(db, "eventLabels"));

  select.innerHTML = "";
  if (snap.empty) {
    const opt = document.createElement("option");
    opt.disabled = true;
    opt.textContent = "No labels yet — add one above";
    select.appendChild(opt);
    return;
  }

  snap.forEach((docSnap) => {
    const l = docSnap.data();
    if (!l.name) return;
    const opt = document.createElement("option");
    opt.value = l.name;
    opt.textContent = l.name;
    if (previouslySelected.has(l.name)) opt.selected = true;
    select.appendChild(opt);
  });
}

// ── Upcoming Events ──────────────────────────────────────────────
// Reads "events" (each: { name, date: ISO datetime string, description,
// leaders: [strings], labels: [label name strings] }), shows only events
// whose date is still in the future, soonest first. Label descriptions
// come from a separate "eventLabels" collection, cached after first fetch.
let eventLabelsCache = null;
async function getEventLabelsMap() {
  if (eventLabelsCache) return eventLabelsCache;
  const snap = await getDocs(collection(db, "eventLabels"));
  const map = {};
  snap.forEach((docSnap) => {
    const l = docSnap.data();
    if (l.name) {
      map[l.name] = {
        description: l.description || "No description available.",
        color: l.color || "blue"
      };
    }
  });
  eventLabelsCache = map;
  return map;
}

function formatEventDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

async function renderEvents() {
  const grid = document.getElementById("events-grid");
  grid.innerHTML = "";

  const snap = await getDocs(collection(db, "events"));
  const now = new Date();
  const upcoming = [];

  snap.forEach((docSnap) => {
    const e = docSnap.data();
    const eventDate = e.date ? new Date(e.date) : null;
    if (eventDate && !isNaN(eventDate) && eventDate >= now) upcoming.push(e);
  });
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (upcoming.length === 0) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No upcoming events right now.</p>';
    return;
  }

  upcoming.forEach((e) => {
    const card = document.createElement("div");
    card.className = "event-card";

    const name = document.createElement("p");
    name.className = "event-card-name";
    name.textContent = e.name || "Untitled event";

    const meta = document.createElement("div");
    meta.className = "event-card-meta";
    const eventDateObj = e.date ? new Date(e.date) : null;
    const dateSpan = document.createElement("span");
    dateSpan.className = "event-card-date";
    const timeSpan = document.createElement("span");
    timeSpan.className = "event-card-time";
    if (eventDateObj && !isNaN(eventDateObj)) {
      dateSpan.textContent = eventDateObj.toLocaleDateString("en-US", { dateStyle: "medium" });
      timeSpan.textContent = eventDateObj.toLocaleTimeString("en-US", { timeStyle: "short" });
    } else {
      dateSpan.textContent = formatEventDate(e.date);
    }
    meta.appendChild(dateSpan);
    if (timeSpan.textContent) meta.appendChild(timeSpan);

    const desc = document.createElement("p");
    desc.className = "event-card-desc";
    desc.textContent = e.description || "";

    card.appendChild(name);
    card.appendChild(meta);
    card.appendChild(desc);
    // Clicking the card still opens the same event details popup as before.
    card.addEventListener("click", () => openEventModal(e));
    grid.appendChild(card);
  });
}

let countdownInterval = null;

function startCountdown(dateStr) {
  const el = document.getElementById("event-modal-countdown");
  clearInterval(countdownInterval);

  function tick() {
    const target = new Date(dateStr);
    const diff = target - new Date();
    if (diff <= 0) {
      el.textContent = "Happening now";
      clearInterval(countdownInterval);
      return;
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    el.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function emptyPill(list, text) {
  const li = document.createElement("li");
  li.textContent = text;
  li.style.background = "transparent";
  li.style.border = "none";
  li.style.color = "var(--muted)";
  li.style.padding = "0";
  list.appendChild(li);
}

async function openEventModal(e) {
  document.getElementById("event-modal-title").textContent = e.name || "Untitled event";
  document.getElementById("event-modal-date").textContent = formatEventDate(e.date);
  document.getElementById("event-modal-desc").textContent = e.description || "";

  const leadersList = document.getElementById("event-modal-leaders");
  leadersList.innerHTML = "";
  const leaders = Array.isArray(e.leaders) ? e.leaders : [];
  if (leaders.length === 0) {
    emptyPill(leadersList, "No leaders assigned.");
  } else {
    leaders.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      leadersList.appendChild(li);
    });
  }

  const labelsMap = await getEventLabelsMap();
  const labelsList = document.getElementById("event-modal-labels");
  labelsList.innerHTML = "";
  const labels = Array.isArray(e.labels) ? e.labels : [];
  if (labels.length === 0) {
    emptyPill(labelsList, "No labels.");
  } else {
    labels.forEach((labelName) => {
      const entry = labelsMap[labelName] || { description: "No description available.", color: "blue" };
      const c = colorForLabelKey(entry.color);
      const li = document.createElement("li");
      li.textContent = labelName;
      li.setAttribute("data-clickable", "true");
      li.style.background = c.bg;
      li.style.borderColor = c.border;
      li.style.color = c.text;
      li.addEventListener("click", () => openLabelModal(labelName, entry));
      labelsList.appendChild(li);
    });
  }

  startCountdown(e.date);
  document.getElementById("event-modal-overlay").hidden = false;
}

// Small popup shown when a label pill is tapped — replaces the browser's
// default alert() with something that matches the site's dark theme.
function openLabelModal(name, entry) {
  const c = colorForLabelKey(entry.color);
  document.getElementById("label-modal-title").textContent = name;
  document.getElementById("label-modal-desc").textContent = entry.description;
  document.getElementById("label-modal-colorbar").style.background = c.border;
  document.getElementById("label-modal-overlay").hidden = false;
}

function wireLabelModal() {
  const overlay = document.getElementById("label-modal-overlay");
  const closeBtn = document.getElementById("label-modal-close");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

function wireEventModal() {
  const overlay = document.getElementById("event-modal-overlay");
  const closeBtn = document.getElementById("event-modal-close");

  function closeModal() {
    overlay.hidden = true;
    clearInterval(countdownInterval);
  }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// ── Batchmate Directory ──────────────────────────────────────────
// Reads the "batchmatesPublic" collection — a deliberately smaller,
// non-sensitive mirror of each batchmate's record, kept in sync by
// sync-batchmates-public.js. The grid shows avatar/short name/index
// number; the popup shows birthday, contact number, gender, clubs,
// sports, and skills — all of which live in this collection, not the
// full (self-only) "batchmates" collection.
let allBatchmates = [];
let batchmateBadgeAssignments = {}; // uid -> badgeIds[], set by renderBatchmateDirectory(),
                                     // read by openBatchmateModal()'s badges section below
let batchmatePrivacyMap = {}; // uid -> true if that batchmate opted out of showing
                               // their profile details in the directory popup

// Reads /directoryPrivacy — one doc per uid, { hidden: true|false }, each
// batchmate manages their own from the Settings page. No doc = visible.
async function getAllPrivacyMap() {
  const snap = await getDocs(collection(db, "directoryPrivacy"));
  const map = {};
  snap.forEach((docSnap) => { map[docSnap.id] = docSnap.data().hidden === true; });
  return map;
}

async function renderBatchmateDirectory() {
  // Badge catalog + who-has-what, and who has opted out of showing their
  // profile, are fetched once here so the batchmate popup can read them
  // without a per-tap Firestore round trip.
  const [, assignmentsMap, privacyMap] = await Promise.all([
    getBadgesMap(),
    getAllBadgeAssignments(),
    getAllPrivacyMap()
  ]);
  batchmateBadgeAssignments = assignmentsMap;
  batchmatePrivacyMap = privacyMap;

  const snap = await getDocs(collection(db, "batchmatesPublic"));
  allBatchmates = [];
  snap.forEach((docSnap) => allBatchmates.push({ uid: docSnap.id, ...docSnap.data() }));

  // Sorted by campus index number, ascending (natural/numeric-aware so
  // e.g. "AS2025002" sorts before "AS2025010").
  allBatchmates.sort((a, b) =>
    (a.campusIndexNumber || "").localeCompare(b.campusIndexNumber || "", undefined, { numeric: true, sensitivity: "base" })
  );

  displayBatchmates(allBatchmates);

  const searchInput = document.getElementById("batchmate-search");
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) {
      displayBatchmates(allBatchmates);
      return;
    }
    const filtered = allBatchmates.filter((b) => {
      const name = (b.fullName || "").toLowerCase();
      const idx = (b.campusIndexNumber || "").toLowerCase();
      return name.includes(term) || idx.includes(term);
    });
    displayBatchmates(filtered);
  });
}

function buildAvatar(fullName, photoUrl) {
  const slot = document.createElement("div");
  slot.className = "avatar-slot";
  const url = (photoUrl || "").trim();
  if (url) {
    const img = document.createElement("img");
    img.className = "avatar-photo";
    img.alt = "";
    img.src = url;
    img.onerror = () => { img.hidden = true; };
    slot.appendChild(img);
  } else {
    const initial = document.createElement("div");
    initial.className = "avatar";
    initial.textContent = (fullName || "?").charAt(0).toUpperCase();
    slot.appendChild(initial);
  }
  return slot;
}

function displayBatchmates(list) {
  const grid = document.getElementById("batchmate-grid");
  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No matches found.</p>';
    return;
  }

  list.forEach((b) => {
    const card = document.createElement("div");
    card.className = "batchmate-card";

    card.appendChild(buildAvatar(b.fullName, b.photoUrl));

    const name = document.createElement("div");
    name.className = "batchmate-card-name";
    name.textContent = (b.fullName || "Unnamed").split(" ")[0];

    const index = document.createElement("div");
    index.className = "batchmate-card-index";
    index.textContent = b.campusIndexNumber || "—";

    card.appendChild(name);
    card.appendChild(index);

    const badgeIds = batchmateBadgeAssignments[b.uid] || [];
    const badgesMap = badgesCache || {};
    if (badgeIds.length > 0) {
      const row = document.createElement("div");
      row.className = "batchmate-badges-row";
      badgeIds.slice(0, 4).forEach((id) => {
        const badge = badgesMap[id];
        if (!badge) return;
        const icon = makeBadgeIcon(badge, "mini");
        icon.addEventListener("click", (e) => {
          e.stopPropagation();
          openBadgeModal(badge);
        });
        row.appendChild(icon);
      });
      if (badgeIds.length > 4) {
        const more = document.createElement("span");
        more.className = "batchmate-badge-more";
        more.textContent = "+" + (badgeIds.length - 4);
        row.appendChild(more);
      }
      card.appendChild(row);
    }

    card.addEventListener("click", () => openBatchmateModal(b));
    grid.appendChild(card);
  });
}

// "his"/"her"/"their" for the privacy-opt-out message, from the batchmate's
// own recorded gender field — never shown directly, only used for the pronoun.
function genderPronoun(gender) {
  const g = (gender || "").trim().toLowerCase();
  if (g === "male" || g === "m") return "his";
  if (g === "female" || g === "f") return "her";
  return "their";
}

function openBatchmateModal(b) {
  document.getElementById("bm-modal-name").textContent = b.fullName || "Unnamed";

  const avatarSlot = document.getElementById("bm-modal-avatar-slot");
  avatarSlot.innerHTML = "";
  avatarSlot.appendChild(buildAvatar(b.fullName, b.photoUrl).firstChild);

  fillGroup("bm-modal-fields", [
    ["Birthday", b.birthday],
    ["Contact Number", b.primaryMobile],
    ["Gender", b.gender]
  ]);

  fillPills("bm-modal-clubs", b.clubs, "No clubs recorded.");
  fillPills("bm-modal-sports", b.sports, "No sports recorded.");
  fillPills("bm-modal-skills", b.skills, "No skills recorded.");
  renderModalBadges(b);

  // A batchmate can opt out (Settings → Directory Privacy) of showing their
  // profile details to others. Their name + index number still show on the
  // directory box either way — only this popup's details get blurred, with
  // an explanatory message over top. Viewing your own profile never blurs.
  const contentEl = document.getElementById("bm-modal-body-content");
  const overlayEl = document.getElementById("bm-modal-privacy-overlay");
  const isSelf = auth.currentUser && b.uid === auth.currentUser.uid;
  const isHidden = !isSelf && batchmatePrivacyMap[b.uid] === true;

  contentEl.classList.toggle("bm-privacy-blur", isHidden);
  if (isHidden) {
    const firstName = (b.fullName || "This batchmate").split(" ")[0];
    overlayEl.textContent = `${firstName} decided not to show ${genderPronoun(b.gender)} profile to public.`;
    overlayEl.hidden = false;
  } else {
    overlayEl.hidden = true;
  }

  document.getElementById("batchmate-modal-overlay").hidden = false;
}

// Badges section inside the batchmate popup — icon + name pills, using the
// badge catalog (badgesCache, already warmed by renderBatchmateDirectory)
// and this batchmate's earned badge IDs. Tapping a pill opens the same
// badge popup used on the Badges page and the mini icons.
function renderModalBadges(b) {
  const el = document.getElementById("bm-modal-badges");
  if (!el) return;
  el.innerHTML = "";

  const badgeIds = batchmateBadgeAssignments[b.uid] || [];
  const badgesMap = badgesCache || {};

  if (badgeIds.length === 0) {
    emptyPill(el, "No badges earned yet.");
    return;
  }

  badgeIds.forEach((id) => {
    const badge = badgesMap[id];
    if (!badge) return;
    const li = document.createElement("li");
    li.className = "badge-pill";

    const img = document.createElement("img");
    img.className = "badge-pill-icon";
    img.src = badge.imageUrl || "";
    img.alt = "";

    const span = document.createElement("span");
    span.textContent = badge.name || "Unnamed badge";

    li.appendChild(img);
    li.appendChild(span);
    li.addEventListener("click", () => openBadgeModal(badge));
    el.appendChild(li);
  });
}

function wireBatchmateModal() {
  const overlay = document.getElementById("batchmate-modal-overlay");
  const closeBtn = document.getElementById("batchmate-modal-close");

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}
