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
  increment
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

// ── Profile photo hosting (Cloudinary, free tier) ──────────────────
// Photos are uploaded straight from the browser to Cloudinary, not to
// Firestore/Storage — only the returned link (a short string) is saved on
// the user's own /batchmates doc as photoUrl, so this never grows database
// usage. To enable: create a free account at cloudinary.com, then under
// Settings → Upload → Upload presets, add a preset with Signing Mode set
// to "Unsigned" (required — it lets the browser upload without exposing a
// secret key), and fill in both values below.
const CLOUDINARY_CLOUD_NAME = "ptabi2yz";
const CLOUDINARY_UPLOAD_PRESET = "21st_FST_Profiles";

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
const THEME_DESIGN_KEY = "theme-design"; // "default" | "glass" — see the [data-design="glass"] block in style.css

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

function applyDesign(design) {
  document.documentElement.setAttribute("data-design", design);
  try {
    localStorage.setItem(THEME_DESIGN_KEY, design);
  } catch (err) {
    // localStorage unavailable — still applies for this page view.
  }
}

// Wires the Appearance section on the Settings page. No-ops on every
// other page since #theme-mode-toggle / #theme-palette-grid won't exist.
function initThemeControls() {
  const modeToggle = document.getElementById("theme-mode-toggle");
  const paletteGrid = document.getElementById("theme-palette-grid");
  const designToggle = document.getElementById("theme-design-toggle");
  if (!modeToggle || !paletteGrid) return;

  function currentMode() {
    try { return localStorage.getItem(THEME_MODE_KEY) || "dark"; }
    catch (err) { return "dark"; }
  }
  function currentPalette() {
    try { return localStorage.getItem(THEME_PALETTE_KEY) || "blue"; }
    catch (err) { return "blue"; }
  }
  function currentDesign() {
    try { return localStorage.getItem(THEME_DESIGN_KEY) || "default"; }
    catch (err) { return "default"; }
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

  if (designToggle) {
    function refreshDesignActiveState(design) {
      designToggle.querySelectorAll(".theme-mode-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.design === design);
      });
    }
    refreshDesignActiveState(currentDesign());
    designToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".theme-mode-btn");
      if (!btn) return;
      applyDesign(btn.dataset.design);
      refreshDesignActiveState(btn.dataset.design);
    });
  }
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

  // "More" submenu — collapsed by default, expands on click; auto-opens
  // on load if the current page's own nav link happens to be inside it
  // (so a visit to, say, Settings doesn't look like nothing is active).
  const moreToggle = document.getElementById("side-more-toggle");
  const submenu = document.getElementById("side-submenu");
  if (moreToggle && submenu) {
    function setSubmenuOpen(open) {
      submenu.classList.toggle("open", open);
      moreToggle.classList.toggle("open", open);
    }
    moreToggle.addEventListener("click", () => {
      setSubmenuOpen(!submenu.classList.contains("open"));
    });
  }

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

    // Sidebar nav indicators — don't block the current page's own load
    // on these; they just decorate the menu once they resolve.
    updateHomeNavIndicator(user.uid);
    updateDashboardNavBadge(user.uid);

    if (document.getElementById("home-content")) await initHomePage(user);
    if (document.getElementById("timetable-content")) await initTimetablePage(user);
    if (document.getElementById("requests-content")) await initRequestsPage(user, isAdmin);
    if (document.getElementById("wall-content")) await initWallPage();
    if (document.getElementById("badges-content")) await initBadgesPage(user);
    if (document.getElementById("record")) await initDashboardPage(user);
    if (document.getElementById("fund-page")) await initFundPage(user);
    if (document.getElementById("settings-page")) initSettingsPage(user);
    if (document.getElementById("admin-page")) await initAdminPage(isAdmin);
  });
}

// Checks whether the signed-in user has a document in /admins, and if so
// caches its contents in ADMIN_INFO (shape: { superAdmin: bool,
// permissions: { key: bool, ... } }) for hasAdminPerm() to read. Existence
// of the doc = "is an admin at all"; the permissions map controls which
// specific functions they can use. The real enforcement is in Firestore
// rules (hasPerm() there), not this check — this just controls what the
// UI shows and pre-empts doomed writes with a friendly message instead of
// a raw permission-denied error.
let ADMIN_INFO = null;
async function checkIsAdmin(uid) {
  try {
    const snap = await getDoc(doc(db, "admins", uid));
    if (!snap.exists()) { ADMIN_INFO = null; return false; }
    ADMIN_INFO = snap.data() || {};
    return true;
  } catch (err) {
    ADMIN_INFO = null;
    return false; // no admin doc, or read denied — treat as not-admin
  }
}

// True if the signed-in admin can use this specific function. A super
// admin passes every check. Everyone else needs permissions[key] === true.
function hasAdminPerm(key) {
  if (!ADMIN_INFO) return false;
  if (ADMIN_INFO.superAdmin === true) return true;
  return !!(ADMIN_INFO.permissions && ADMIN_INFO.permissions[key] === true);
}

// Convenience for gating a UI action: returns true and does nothing if the
// admin has `key`; otherwise shows the red "no access" banner naming
// `label` and returns false, so the caller can just `if (!guardPerm(...))
// return;`.
function guardPerm(key, label) {
  if (hasAdminPerm(key)) return true;
  showPermDenied(label);
  return false;
}

// Shows a brief red "you don't have access" banner. Reuses the page's own
// #admin-perm-banner element if it has one; otherwise creates a floating
// one on the fly, so this works on any page (admin.html, requests.html,
// etc.) without needing markup added everywhere.
let _permBannerTimer = null;
function showPermDenied(label) {
  let banner = document.getElementById("admin-perm-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "admin-perm-banner";
    banner.className = "admin-perm-banner";
    document.body.appendChild(banner);
  }
  banner.textContent = `⚠ You don't have access to ${label ? `"${label}"` : "this section"}.`;
  banner.classList.add("show");
  clearTimeout(_permBannerTimer);
  _permBannerTimer = setTimeout(() => banner.classList.remove("show"), 3500);
}

// Every individually-toggleable admin permission, in the order shown on
// the Manage Admin Access screen. Keys here must match hasPerm() calls
// throughout this file and the Firestore rules' permissions map exactly.
const ADMIN_PERMISSION_LIST = [
  ["fund", "Fund Transactions (add/edit)"],
  ["events", "Events & Event Labels (add/edit)"],
  ["tasks", "Tasks (assign/verify/edit)"],
  ["timetable", "Timetable (add/edit/override)"],
  ["projects", "Group Projects (add/edit)"],
  ["announcements", "Announcements (add)"],
  ["changeRequests", "Detail Change Requests (approve/reject)"],
  ["memberRequests", "Member Requests page (resolve)"],
  ["wallOfFame", "Wall of Fame"],
  ["badges", "Student Badges"],
  ["badBehavior", "Bad Behavior Records"],
  ["bulkField", "Add/Remove Field (All Batchmates)"],
  ["fieldManager", "Manage Profile Fields"],
  ["settingsFields", "Settings Change-Request Fields"],
  ["dbStorage", "Database Storage"],
  ["dataTable", "Data Table (full data)"]
];

// Manage Admin Access (Danger tab, super-admin only). Lists every existing
// /admins doc with a permission checklist + Save/Remove, and lets a super
// admin search a batchmate by name and add them as a new admin with a
// chosen set of permissions. Reading every admin doc, and writing any of
// them, only actually works for a super admin — the Firestore rules on
// /admins/{id} enforce that regardless of what this panel shows.
function initManageAdminsPanel() {
  const listEl = document.getElementById("manageadmins-list");
  const searchInput = document.getElementById("manageadmins-search");
  const resultsEl = document.getElementById("manageadmins-search-results");
  const selectedEl = document.getElementById("manageadmins-selected");
  const newPermsEl = document.getElementById("manageadmins-new-perms");
  const newSuperCb = document.getElementById("manageadmins-new-super");
  const addBtn = document.getElementById("manageadmins-add-btn");
  const errorEl = document.getElementById("manageadmins-error");
  const successEl = document.getElementById("manageadmins-success");
  if (!listEl || !searchInput || !addBtn) return;

  let selectedNewAdmin = null; // { uid, fullName }

  function buildPermChecklist(container, checkedKeys) {
    container.innerHTML = "";
    ADMIN_PERMISSION_LIST.forEach(([key, label]) => {
      const row = document.createElement("label");
      row.className = "member-check-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.permKey = key;
      cb.checked = !!(checkedKeys && checkedKeys[key]);
      const span = document.createElement("span");
      span.textContent = label;
      row.appendChild(cb);
      row.appendChild(span);
      container.appendChild(row);
    });
  }

  function readPermChecklist(container) {
    const out = {};
    container.querySelectorAll('input[type="checkbox"][data-perm-key]').forEach((cb) => {
      out[cb.dataset.permKey] = cb.checked;
    });
    return out;
  }

  async function renderExistingAdmins() {
    listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Loading…</p>';
    let snap;
    try {
      snap = await getDocs(collection(db, "admins"));
    } catch (err) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Could not load admins.</p>';
      return;
    }
    listEl.innerHTML = "";
    const docs = [];
    snap.forEach((docSnap) => docs.push({ uid: docSnap.id, ...docSnap.data() }));
    if (docs.length === 0) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No admins yet.</p>';
      return;
    }

    docs.forEach((a) => {
      const card = document.createElement("div");
      card.className = "leader-picker-selected";
      card.style.flexDirection = "column";
      card.style.alignItems = "stretch";
      card.style.gap = "10px";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.justifyContent = "space-between";
      header.style.alignItems = "center";
      const nameEl = document.createElement("div");
      nameEl.className = "leader-picker-selected-name";
      nameEl.textContent = a.name || a.uid;
      header.appendChild(nameEl);

      const superLabel = document.createElement("label");
      superLabel.style.display = "flex";
      superLabel.style.alignItems = "center";
      superLabel.style.gap = "6px";
      superLabel.style.fontSize = "12.5px";
      const superCb = document.createElement("input");
      superCb.type = "checkbox";
      superCb.checked = a.superAdmin === true;
      superLabel.appendChild(superCb);
      superLabel.append(" Super Admin");
      header.appendChild(superLabel);
      card.appendChild(header);

      const permsBox = document.createElement("div");
      permsBox.className = "member-checklist";
      buildPermChecklist(permsBox, a.permissions || {});
      card.appendChild(permsBox);

      const btnRow = document.createElement("div");
      btnRow.style.display = "flex";
      btnRow.style.gap = "10px";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "btn-primary";
      saveBtn.style.margin = "0";
      saveBtn.textContent = "Save Changes";
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        try {
          await setDoc(doc(db, "admins", a.uid), {
            name: a.name || a.uid,
            superAdmin: superCb.checked,
            permissions: readPermChecklist(permsBox)
          });
          if (a.uid === auth.currentUser?.uid) {
            // Refresh our own cached permissions if we just edited ourselves.
            await checkIsAdmin(a.uid);
          }
        } catch (err) {
          alert("Could not save — please try again.");
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Changes";
        }
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ghost-btn";
      removeBtn.style.margin = "0";
      removeBtn.textContent = "Remove Admin";
      removeBtn.addEventListener("click", async () => {
        if (!confirm(`Remove admin access for ${a.name || a.uid}? This deletes all their permissions.`)) return;
        removeBtn.disabled = true;
        try {
          await deleteDoc(doc(db, "admins", a.uid));
          card.remove();
        } catch (err) {
          alert("Could not remove — please try again.");
          removeBtn.disabled = false;
        }
      });

      btnRow.appendChild(saveBtn);
      btnRow.appendChild(removeBtn);
      card.appendChild(btnRow);

      listEl.appendChild(card);
    });
  }

  buildPermChecklist(newPermsEl, {});

  searchInput.addEventListener("input", async () => {
    const term = searchInput.value.trim().toLowerCase();
    resultsEl.innerHTML = "";
    if (!term) return;
    const people = await getBatchmatesPublicList();
    const matches = people.filter((p) => p.fullName.toLowerCase().includes(term)).slice(0, 15);
    matches.forEach((p) => {
      const row = document.createElement("div");
      row.className = "leader-picker-row";
      row.textContent = `${p.fullName}${p.campusIndexNumber ? " — " + p.campusIndexNumber : ""}`;
      row.style.cursor = "pointer";
      row.style.padding = "8px 10px";
      row.addEventListener("click", () => {
        selectedNewAdmin = p;
        selectedEl.textContent = `Selected: ${p.fullName}`;
        resultsEl.innerHTML = "";
        searchInput.value = "";
      });
      resultsEl.appendChild(row);
    });
  });

  addBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    successEl.hidden = true;
    if (!selectedNewAdmin) {
      errorEl.textContent = "Search for and select a batchmate first.";
      errorEl.hidden = false;
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";
    try {
      await setDoc(doc(db, "admins", selectedNewAdmin.uid), {
        name: selectedNewAdmin.fullName,
        superAdmin: newSuperCb.checked,
        permissions: readPermChecklist(newPermsEl)
      });
      successEl.textContent = `${selectedNewAdmin.fullName} is now an admin.`;
      successEl.hidden = false;
      selectedNewAdmin = null;
      selectedEl.textContent = "";
      newSuperCb.checked = false;
      buildPermChecklist(newPermsEl, {});
      await renderExistingAdmins();
    } catch (err) {
      errorEl.textContent = "Could not add this admin — please try again.";
      errorEl.hidden = false;
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = "Add as Admin";
    }
  });

  renderExistingAdmins();
}

// ── Sidebar nav indicators ───────────────────────────────────────
// Two small decorations on the sidebar, refreshed on every page load:
//  - a blinking dot on "Home" while the user is on the roster of an
//    ongoing project's group and hasn't submitted their own rating yet
//  - a count badge on "Dashboard" for tasks assigned since they last
//    actually opened that page
// Looked up by href rather than an id, so no per-page HTML edits are
// needed to wire this up.
function getNavLinkByHref(href) {
  return document.querySelector(`.side-link[href="${href}"]`);
}

function setNavDot(link, show) {
  if (!link) return;
  let dot = link.querySelector(".side-link-dot");
  if (show) {
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "status-dot side-link-dot";
      link.appendChild(dot);
    }
  } else if (dot) {
    dot.remove();
  }
}

function setNavCount(link, count) {
  if (!link) return;
  let badge = link.querySelector(".side-link-badge");
  if (count > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "side-link-badge";
      link.appendChild(badge);
    }
    badge.textContent = count > 99 ? "99+" : String(count);
  } else if (badge) {
    badge.remove();
  }
}

async function updateHomeNavIndicator(uid) {
  const link = getNavLinkByHref("home.html");
  if (!link) return;
  try {
    const snap = await getDocs(collection(db, "groupProjects"));
    let needsRating = false;
    outer:
    for (const docSnap of snap.docs) {
      const p = docSnap.data();
      if (p.status !== "ongoing") continue;
      const groups = Array.isArray(p.groups) ? p.groups : [];
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (g.ratingsFinalized) continue;
        const roster = getGroupRoster(g);
        if (!roster.some((person) => person.uid === uid)) continue;
        const subs = await getGroupRatingSubmissions(docSnap.id, i);
        if (!subs.some((s) => s.raterUid === uid)) { needsRating = true; break outer; }
      }
    }
    setNavDot(link, needsRating);
  } catch (err) { /* leave the nav as-is on failure */ }
}

// Last time this browser actually opened the Dashboard, per-account —
// there's no server-side "seen" flag for tasks, so this is tracked
// locally and reset every time initDashboardPage runs.
function tasksSeenStorageKey(uid) { return `tasksSeenAt:${uid}`; }
function getTasksSeenAt(uid) {
  try { return parseInt(localStorage.getItem(tasksSeenStorageKey(uid)) || "0", 10); } catch (err) { return 0; }
}
function markTasksSeenNow(uid) {
  try { localStorage.setItem(tasksSeenStorageKey(uid), String(Date.now())); } catch (err) { /* ignore */ }
}

async function updateDashboardNavBadge(uid) {
  const link = getNavLinkByHref("dashboard.html");
  if (!link) return;
  try {
    const seenAt = getTasksSeenAt(uid);
    const snap = await getDocs(query(collection(db, "tasks"), where("assignedToUid", "==", uid)));
    let count = 0;
    snap.forEach((d) => {
      const t = d.data();
      const ms = t.createdAt && t.createdAt.toMillis ? t.createdAt.toMillis() : 0;
      if (ms > seenAt) count++;
    });
    setNavCount(link, count);
  } catch (err) { /* leave the nav as-is on failure */ }
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

// ── Prestige levels ───────────────────────────────────────────────
// A coarse, public-facing stand-in for a batchmate's exact prestige
// total: every PRESTIGE_POINTS_PER_LEVEL points earned is 1 level.
// LEVEL_NAME is just the display word used in front of the number
// (Home directory popup shows "<LEVEL_NAME> • <n>") — rename it here
// if you want different wording; nothing else needs to change.
const PRESTIGE_POINTS_PER_LEVEL = 1000;
const LEVEL_NAME = "Prestige Rank";

function levelForPoints(points) {
  return Math.max(0, Math.floor((Number(points) || 0) / PRESTIGE_POINTS_PER_LEVEL));
}

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

  // The exact point total is still NOT mirrored to batchmatesPublic —
  // batchmates should be able to see their own total (Dashboard,
  // self-read on /batchmates) but not each other's exact score. The
  // Admin leaderboard reads /batchmates directly instead, using the
  // admin-read bypass added in the prestige engine's first pass.
  //
  // What DOES get mirrored is the much coarser derived level (every
  // PRESTIGE_POINTS_PER_LEVEL points = 1) — enough for the directory's
  // level badge/pill without exposing anyone's precise standing.
  try {
    const priorTotal = bmSnap.exists() ? (Number(bmSnap.data().prestigePoints) || 0) : 0;
    const newLevel = levelForPoints(priorTotal + finalAmount);
    await setDoc(doc(db, "batchmatesPublic", uid), { prestigeLevel: newLevel }, { merge: true });
  } catch (err) {
    // Non-fatal — the batchmate's own total/history is already saved;
    // the public level badge will catch up next time an admin taps
    // "Re-sync Directory Now" on the Admin page.
  }

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
    // uid equality + createdAt ordering on two different fields needs a
    // composite Firestore index, which isn't deployed for this project —
    // that made this query fail with "failed-precondition" and land in
    // the catch below. Filter by uid only (single-field index, always
    // auto-created) and sort/limit client-side instead.
    const q = query(collection(db, "prestigeLog"), where("uid", "==", uid));
    const snap = await getDocs(q);
    listEl.innerHTML = "";

    if (snap.empty) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No prestige activity yet.</p>';
      return;
    }

    const entries = snap.docs
      .map((docSnap) => docSnap.data())
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));

    entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "prestige-log-item";

      const left = document.createElement("div");
      left.className = "prestige-log-note";
      const noteText = e.note || e.source || "Prestige update";
      left.textContent = noteText;
      left.setAttribute("data-clickable", "true");

      const amount = Number(e.finalAmount) || 0;
      left.addEventListener("click", () => openPrestigeNoteModal(noteText, amount));

      const right = document.createElement("div");
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

// Dashboard: a batchmate's own fund donation history — same look/behavior
// as the prestige history list above (4 rows visible, scroll for more,
// tap a row to see the full record). Built from /fundTransactions rather
// than /prestigeLog so every donation shows up here even ones too small
// to have earned a prestige point (see FUND_LKR_PER_POINT / awardPrestige
// call in initFundTransactionForm).
async function loadAndRenderFundLog(uid) {
  const listEl = document.getElementById("fund-log-list");
  if (!listEl) return;

  try {
    // Single-field filter only (array-contains), same reasoning as the
    // prestige query above: avoids needing a composite index. Non-income
    // (expense) per-student transactions and the type filter are both
    // applied client-side after the fetch.
    const q = query(collection(db, "fundTransactions"), where("studentUids", "array-contains", uid));
    const snap = await getDocs(q);
    listEl.innerHTML = "";

    const entries = snap.docs
      .map((docSnap) => docSnap.data())
      .filter((tx) => (tx.type || "").toLowerCase() === "income")
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    if (entries.length === 0) {
      listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No fund donations yet.</p>';
      return;
    }

    entries.forEach((tx) => {
      const row = document.createElement("div");
      row.className = "prestige-log-item";

      const left = document.createElement("div");
      left.className = "prestige-log-note";
      const noteText = tx.description || "Batch fund donation";
      left.textContent = noteText;
      left.setAttribute("data-clickable", "true");

      const amount = Number(tx.perStudentAmount) || 0;
      left.addEventListener("click", () => openFundNoteModal(noteText, amount, tx.date));

      const right = document.createElement("div");
      right.className = "prestige-log-amount fund-log-amount";
      right.textContent = `Rs. ${amount.toLocaleString()}`;

      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Could not load fund donation history.</p>';
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
    "An admin assigns you a task with a difficulty. Finishing it by the due date earns the difficulty's base points. The admin will give 1-10 rating on the task which will always adds as points too, even if the deadline was missed."
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
    ["Admin's overall project rating (1-10) will be paid to every group's members + leaders", `+${OVERALL_RATING_POINTS_PER_STAR} to +${10 * OVERALL_RATING_POINTS_PER_STAR}`],
    ["Admin's single-group rating (1-10) wil be paid to that specific group's members + leader", `+${GROUP_RATING_POINTS_PER_STAR} to +${10 * GROUP_RATING_POINTS_PER_STAR}`],
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
    `Each bad behavior record on file cuts how fast you earn every point above by ${Math.round(BAD_BEHAVIOR_STEP * 100)}%, down to a floor of ${Math.round(BAD_BEHAVIOR_FLOOR * 100)}% speed at ${floorRecords}+ records. It slows down future awards. However it never remove points you've already earned.`
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
  closingNote.textContent = "Every award (positive or negative) shows up in your prestige history below, with a note on what it was for.";
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

// Small popup shown when a (possibly truncated) prestige note is tapped —
// same pattern as openLabelModal()/wireLabelModal() for event labels on
// the Home page: a modal-box with a color bar, title and full description.
function openPrestigeNoteModal(noteText, amount) {
  const overlay = document.getElementById("prestige-note-modal-overlay");
  if (!overlay) return;
  const positive = amount >= 0;
  document.getElementById("prestige-note-modal-title").textContent =
    (positive ? "+" : "") + amount + " Prestige";
  document.getElementById("prestige-note-modal-desc").textContent = noteText;
  // Color bar matches the site's theme accent (data-palette), rather than
  // a green/red positive-negative indicator.
  document.getElementById("prestige-note-modal-colorbar").style.background = "var(--blue)";
  overlay.hidden = false;
}

function wirePrestigeNoteModal() {
  const overlay = document.getElementById("prestige-note-modal-overlay");
  const closeBtn = document.getElementById("prestige-note-modal-close");
  if (!overlay || !closeBtn) return;

  function closeModal() { overlay.hidden = true; }

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.hidden) closeModal();
  });
}

// Small popup shown when a (possibly truncated) fund donation note is
// tapped — same pattern as openPrestigeNoteModal() above.
function openFundNoteModal(noteText, amount, date) {
  const overlay = document.getElementById("fund-note-modal-overlay");
  if (!overlay) return;
  document.getElementById("fund-note-modal-title").textContent =
    `Rs. ${(Number(amount) || 0).toLocaleString()}` + (date ? ` — ${date}` : "");
  document.getElementById("fund-note-modal-desc").textContent = noteText;
  document.getElementById("fund-note-modal-colorbar").style.background = "var(--blue)";
  overlay.hidden = false;
}

function wireFundNoteModal() {
  const overlay = document.getElementById("fund-note-modal-overlay");
  const closeBtn = document.getElementById("fund-note-modal-close");
  if (!overlay || !closeBtn) return;

  function closeModal() { overlay.hidden = true; }

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

    const fieldSchema = await getDirectoryFieldSchema();
    renderRecord(snap.data(), fieldSchema);
    await loadAndRenderTasks(user.uid);
    markTasksSeenNow(user.uid);
    setNavCount(getNavLinkByHref("dashboard.html"), 0);
    await loadAndRenderPrestige(user.uid, snap.data());
    await loadAndRenderFundLog(user.uid);
    wireTaskModal();
    wirePrestigeInfoModal();
    wirePrestigeNoteModal();
    wireFundNoteModal();
    loadingState.hidden = true;
    recordSection.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load your record. Please try again later.";
  }
}

// Builds the Dashboard's Person/Campus/Contact/Residential/Medical/
// Emergency cards (plus any admin-added sections) from the field
// schema instead of a fixed list — see the "Directory & Dashboard
// field schema" block above. Re-run on every renderRecord() call, so
// it first clears out whatever it inserted last time.
function renderDynamicFieldGroups(d, groups) {
  const anchor = document.getElementById("dynamic-field-groups-anchor");
  if (!anchor) return;
  anchor.parentElement.querySelectorAll(".dyn-field-card").forEach((el) => el.remove());

  const sortedGroups = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0));
  let lastInserted = anchor;

  sortedGroups.forEach((g) => {
    const card = document.createElement("div");
    card.className = "card dyn-field-card";

    const label = document.createElement("p");
    label.className = "section-label";
    label.textContent = g.title || "Details";
    card.appendChild(label);

    const rowsWrap = document.createElement("div");
    const fields = [...(g.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    fields.forEach((f) => {
      const raw = d[f.key];
      const value = Array.isArray(raw) ? raw.join(", ") : raw;
      rowsWrap.appendChild(fieldRow(f.label || f.key, value));
    });
    card.appendChild(rowsWrap);

    lastInserted.after(card);
    lastInserted = card;
  });
}

function renderRecord(d, fieldSchema) {
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

  renderDynamicFieldGroups(d, fieldSchema || DEFAULT_DIRECTORY_FIELD_GROUPS);

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

  // Profile Photo — uploads to Cloudinary (free image host), then writes
  // only the resulting link to the user's own /batchmates doc.
  initProfilePhotoSection(user);

  // Directory Privacy toggle — writes the user's own doc in
  // /directoryPrivacy/{uid}: { hidden: true|false }. No doc, or
  // hidden === false, means visible (the default).
  initPrivacyToggle(user);

  // Request to Change Details — writes a doc to /changeRequests for an
  // admin to review; never writes to /batchmates directly.
  initChangeRequestSection(user);
}

// Resizes/compresses an image file in-browser (max 512px on the long edge,
// JPEG @ 0.82 quality) before it's uploaded, so photos stay small and fast
// to upload/display regardless of what the user picked. Returns a Blob.
function downscaleImageForUpload(file, maxDim = 512, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process image"))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

// Uploads a blob to Cloudinary's unsigned upload endpoint and resolves with
// its permanent, direct HTTPS link (secure_url). Nothing but this link is
// ever sent to Firestore. Each upload gets its own unique public_id
// (uid + timestamp) rather than trying to reuse/overwrite one shared ID —
// overwrite-on-same-public-id turned out to be unreliable with unsigned
// uploads on this account (Cloudinary was returning success without
// actually replacing the asset). A fresh ID every time guarantees a
// genuinely new asset/URL, so the new photo always shows correctly; it
// just means the old (orphaned) photo is left behind in Cloudinary rather
// than being deleted automatically. At ~50-80KB per compressed photo and
// occasional re-uploads, that's a negligible amount of storage even after
// many changes — if it's ever worth tidying up, the "profile-photos"
// folder in the Cloudinary Media Library can be filtered/bulk-deleted by
// hand.
async function uploadPhotoToCloudinary(blob, uid) {
  const formData = new FormData();
  formData.append("file", blob);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", "profile-photos");
  formData.append("public_id", `${uid}-${Date.now()}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData
  });
  if (!res.ok) {
    // Surface Cloudinary's own error text (e.g. a misconfigured preset) in
    // the console to make this easier to diagnose than a bare "failed".
    try { console.error("Cloudinary upload error:", await res.json()); } catch (err) { /* ignore */ }
    throw new Error("Upload failed");
  }
  const data = await res.json();
  if (!data.secure_url) throw new Error("Upload failed");
  // Cloudinary embeds a version number (v12345...) in the URL that should
  // change on every overwrite — but browsers can still cache the bare
  // pathname aggressively, so a cache-busting param forces a fresh fetch
  // instead of a stale copy of the old photo.
  return `${data.secure_url}?v=${Date.now()}`;
}

async function initProfilePhotoSection(user) {
  const avatarSlot = document.getElementById("photo-current-avatar");
  const fileInput = document.getElementById("photo-file-input");
  const uploadBtn = document.getElementById("photo-upload-btn");
  const statusEl = document.getElementById("photo-status");
  if (!avatarSlot || !fileInput || !uploadBtn) return;

  let fullName = "", photoUrl = "";
  try {
    const snap = await getDoc(doc(db, "batchmates", user.uid));
    if (snap.exists()) {
      fullName = snap.data().fullName || "";
      photoUrl = snap.data().photoUrl || "";
    }
  } catch (err) { /* leave blank, still lets the user try uploading */ }

  function renderAvatar() {
    avatarSlot.innerHTML = "";
    avatarSlot.appendChild(buildAvatar(fullName, photoUrl).firstChild);
  }
  renderAvatar();

  const configured = CLOUDINARY_CLOUD_NAME !== "YOUR_CLOUD_NAME" && CLOUDINARY_UPLOAD_PRESET !== "YOUR_UNSIGNED_UPLOAD_PRESET";
  if (!configured) {
    uploadBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Photo uploads aren't set up yet — see the CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET comment near the top of app.js.";
  }

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      if (statusEl) statusEl.textContent = "Please choose an image file.";
      return;
    }

    uploadBtn.disabled = true;
    uploadBtn.textContent = "Uploading…";
    if (statusEl) statusEl.textContent = "";

    try {
      const blob = await downscaleImageForUpload(file);
      const url = await uploadPhotoToCloudinary(blob, user.uid);
      // Firestore rules allow a batchmate to self-write ONLY photoUrl, and
      // only on their own doc, on both collections — see firestore.txt.
      await updateDoc(doc(db, "batchmates", user.uid), { photoUrl: url });
      try {
        await updateDoc(doc(db, "batchmatesPublic", user.uid), { photoUrl: url });
      } catch (err) { /* directory copy may not exist yet for a brand-new batchmate; ignore */ }
      photoUrl = url;
      renderAvatar();
      if (statusEl) statusEl.textContent = "Photo updated.";
    } catch (err) {
      if (statusEl) statusEl.textContent = "Couldn't update your photo — check your connection and try again.";
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = "Change Photo";
    }
  });
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

// ── Directory & Dashboard field schema ────────────────────────────
// Drives two things, both admin-editable from Admin → Danger → "Manage
// Profile Fields": (1) the plain key/value detail cards on the
// Dashboard (Person, Campus, Contact, etc.) — their titles, field
// labels, and order; (2) which of those fields are ALSO mirrored into
// "batchmatesPublic" (and so shown to other batchmates in the Home
// directory popup). Lives at /config/directoryFields as one doc,
// { groups: [...] }. Falls back to this default shape — which matches
// the site's original hardcoded groups — if that doc doesn't exist yet.
// Sports/Clubs/Skills/Badges are NOT part of this: they're pill lists
// with their own fixed sections on both pages, not simple fields.
const DIRECTORY_FIELDS_DOC_PATH = ["config", "directoryFields"];
const DEFAULT_DIRECTORY_FIELD_GROUPS = [
  { id: "person", title: "Person Details", order: 0, fields: [
      { key: "fullName", label: "Full Name", order: 0, public: true },
      { key: "gender", label: "Gender", order: 1, public: true },
      { key: "birthday", label: "Birthday", order: 2, public: true },
      { key: "nicNumber", label: "NIC Number", order: 3, public: false },
      { key: "address", label: "Address", order: 4, public: false },
      { key: "district", label: "District", order: 5, public: false }
  ]},
  { id: "campus", title: "Campus Details", order: 1, fields: [
      { key: "campusIndexNumber", label: "Campus Index Number", order: 0, public: true },
      { key: "campusRegNumber", label: "Campus Registration Number", order: 1, public: false }
  ]},
  { id: "contact", title: "Contact Options", order: 2, fields: [
      { key: "primaryMobile", label: "Primary Mobile Number", order: 0, public: true },
      { key: "alternativeNumbers", label: "Alternative Numbers", order: 1, public: false },
      { key: "universityEmail", label: "University Email", order: 2, public: false },
      { key: "personalEmail", label: "Personal Email", order: 3, public: false }
  ]},
  { id: "residential", title: "Residential Details", order: 3, fields: [
      { key: "residentialStatus", label: "Residential Status", order: 0, public: false },
      { key: "residentialAddress", label: "Residential Address", order: 1, public: false }
  ]},
  { id: "medical", title: "Medical Details", order: 4, fields: [
      { key: "bloodGroup", label: "Blood Group", order: 0, public: false },
      { key: "dietaryOption", label: "Dietary Option", order: 1, public: false },
      { key: "severeMedicalConditions", label: "Severe Medical Conditions", order: 2, public: false },
      { key: "foodAllergies", label: "Food Allergies", order: 3, public: false },
      { key: "chemicalAllergies", label: "Chemical Allergies", order: 4, public: false }
  ]},
  { id: "emergency", title: "Emergency Details", order: 5, fields: [
      { key: "emergencyContactName", label: "Emergency Contact Person Name", order: 0, public: false },
      { key: "emergencyRelationship", label: "Emergency Contact Person Relationship", order: 1, public: false },
      { key: "primaryEmergencyNumber", label: "Primary Emergency Number", order: 2, public: false },
      { key: "secondaryEmergencyNumber", label: "Secondary Emergency Number", order: 3, public: false }
  ]}
];

// Deep-clones so callers can freely mutate what they get back without
// corrupting the cache.
function cloneFieldGroups(groups) {
  return groups.map((g) => ({ ...g, fields: g.fields.map((f) => ({ ...f })) }));
}

let directoryFieldSchemaCache = null;
async function getDirectoryFieldSchema(forceRefresh) {
  if (directoryFieldSchemaCache && !forceRefresh) return directoryFieldSchemaCache;
  try {
    const snap = await getDoc(doc(db, ...DIRECTORY_FIELDS_DOC_PATH));
    if (snap.exists() && Array.isArray(snap.data().groups) && snap.data().groups.length > 0) {
      directoryFieldSchemaCache = snap.data().groups;
    } else {
      directoryFieldSchemaCache = DEFAULT_DIRECTORY_FIELD_GROUPS;
    }
  } catch (err) {
    directoryFieldSchemaCache = DEFAULT_DIRECTORY_FIELD_GROUPS;
  }
  return directoryFieldSchemaCache;
}

// Returns every field across every group, sorted the same way the
// Dashboard renders them (group order, then field order within it).
function flattenFieldGroups(groups) {
  const sortedGroups = [...groups].sort((a, b) => (a.order || 0) - (b.order || 0));
  const out = [];
  sortedGroups.forEach((g) => {
    const fields = [...(g.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    fields.forEach((f) => out.push(f));
  });
  return out;
}

// Re-applies the given schema's "public" fields (plus each batchmate's
// derived prestige level) to every /batchmates doc's mirror in
// batchmatesPublic. Called by the Admin page whenever the schema is
// saved, and on demand via "Re-sync Directory Now". extraRemoveKeys
// lets a save also strip fields that existed in a PREVIOUS version of
// the schema but were deleted from this one — otherwise a deleted
// field's last value would just sit in batchmatesPublic forever.
// Requires admin privileges (Firestore rules gate both the read-all on
// /batchmates and the write to /batchmatesPublic to admins only).
async function syncDirectoryPublicFields(groups, extraRemoveKeys) {
  const allFields = flattenFieldGroups(groups);
  const removeKeys = new Set(extraRemoveKeys || []);
  allFields.forEach((f) => { if (!f.public) removeKeys.add(f.key); });
  allFields.forEach((f) => { if (f.public) removeKeys.delete(f.key); });

  const snap = await getDocs(collection(db, "batchmates"));
  const docs = [];
  snap.forEach((docSnap) => docs.push(docSnap));

  // Chunked into batches of 400 writes — Firestore caps a single
  // writeBatch at 500, and a batch/cohort site is very unlikely to
  // ever have that many students, but this keeps it safe either way.
  const CHUNK_SIZE = 400;
  for (let i = 0; i < docs.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK_SIZE).forEach((docSnap) => {
      const d = docSnap.data();
      const publicChanges = {};
      allFields.forEach((f) => {
        if (f.public) publicChanges[f.key] = d[f.key] === undefined ? null : d[f.key];
      });
      removeKeys.forEach((key) => { publicChanges[key] = deleteField(); });
      publicChanges.prestigeLevel = levelForPoints(d.prestigePoints);
      batch.set(doc(db, "batchmatesPublic", docSnap.id), publicChanges, { merge: true });
    });
    await batch.commit();
  }

  batchmatesPublicListCache = null;
  return docs.length;
}

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

// Admin-configurable subset of CHANGE_REQUEST_GROUPS' fields that the
// Settings page's "Request to Change Details" form actually shows —
// see Admin → Danger → "Settings Change-Request Fields". Stored as
// { enabledKeys: [...] } at /config/settingsFields; defaults to every
// field (today's behavior) if that doc doesn't exist yet.
const SETTINGS_FIELDS_DOC_PATH = ["config", "settingsFields"];
let settingsEnabledKeysCache = null;
async function getSettingsEnabledKeys(forceRefresh) {
  if (settingsEnabledKeysCache && !forceRefresh) return settingsEnabledKeysCache;
  const allKeys = [];
  CHANGE_REQUEST_GROUPS.forEach((g) => g.fields.forEach((f) => allKeys.push(f.key)));
  try {
    const snap = await getDoc(doc(db, ...SETTINGS_FIELDS_DOC_PATH));
    if (snap.exists() && Array.isArray(snap.data().enabledKeys)) {
      settingsEnabledKeysCache = new Set(snap.data().enabledKeys);
    } else {
      settingsEnabledKeysCache = new Set(allKeys);
    }
  } catch (err) {
    settingsEnabledKeysCache = new Set(allKeys);
  }
  return settingsEnabledKeysCache;
}

function buildChangeRequestFields(container, baseData, enabledKeys) {
  container.innerHTML = "";
  CHANGE_REQUEST_GROUPS.forEach((group) => {
    const visibleFields = group.fields.filter((f) => !enabledKeys || enabledKeys.has(f.key));
    if (visibleFields.length === 0) return;

    const heading = document.createElement("p");
    heading.className = "section-label";
    heading.style.cssText = "margin-top:14px;margin-bottom:6px;opacity:.7";
    heading.textContent = group.label;
    container.appendChild(heading);

    visibleFields.forEach((f) => {
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
  const enabledKeys = await getSettingsEnabledKeys();

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
    buildChangeRequestFields(fieldsContainer, displayData, enabledKeys);
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
        if (!enabledKeys.has(f.key)) return; // not offered on the form — nothing to read
        const input = document.getElementById("cr-" + f.key);
        if (!input) return;
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
// and shared, read-only collections: "announcements" and "groupProjects".
// Both are batch-wide — every signed-in batchmate sees the same content,
// nobody writes to them from the app itself.
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
        // Total headcount includes the leader, not just the members array.
        const memberCount = (Array.isArray(g.members) ? g.members.length : 0) + (g.leader ? 1 : 0);
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
  progress.textContent = `${submittedUids.size} of ${roster.length} have rated. `;

  const whoToggle = document.createElement("button");
  whoToggle.type = "button";
  whoToggle.className = "rating-roster-toggle";
  whoToggle.textContent = "Who?";
  progress.appendChild(whoToggle);
  container.appendChild(progress);

  // Small, collapsed-by-default chip list — who's rated vs. still pending —
  // so it doesn't take up space until someone actually taps to check.
  const rosterMini = document.createElement("div");
  rosterMini.className = "rating-roster-mini";
  rosterMini.hidden = true;
  roster.forEach((person) => {
    const rated = submittedUids.has(person.uid);
    const chip = document.createElement("span");
    chip.className = "rating-roster-chip " + (rated ? "rated" : "pending");
    chip.textContent = (rated ? "✓ " : "… ") + person.name;
    rosterMini.appendChild(chip);
  });
  container.appendChild(rosterMini);
  whoToggle.addEventListener("click", () => {
    rosterMini.hidden = !rosterMini.hidden;
    whoToggle.textContent = rosterMini.hidden ? "Who?" : "Hide";
  });

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
  const isLeaderRating = group.leaderUid === uid;

  titleEl.textContent = "Rate Group Members" + (group.groupName ? " — " + group.groupName : "");
  statusEl.textContent = "";
  listEl.innerHTML = "Loading…";
  submitBtn.hidden = true;

  const roster = getGroupRoster(group);
  const ratingDocId = groupRatingDocId(project.id, groupIndex, uid);

  function checkComplete() {
    const rows = Array.from(listEl.querySelectorAll(".rate-modal-row:not(.rate-modal-row-self)"));
    submitBtn.hidden = !rows.every((row) => !!row.dataset.value);
  }

  getDoc(doc(db, "groupProjectRatings", ratingDocId)).then((snap) => {
    const existingData = snap.exists() ? snap.data() : {};
    const existingRatings = existingData.ratings || {};
    const existingNotes = existingData.notes || {};
    listEl.innerHTML = "";

    roster.forEach((person) => {
      const isSelf = person.uid === uid;
      // A note field shows on this row when it's meaningful in ONE of two
      // directions: the leader leaving a note for a member (only when
      // the current rater IS the leader, on every non-leader row), or
      // any member leaving a note about the leader (on the leader's own
      // row, for every rater who isn't the leader themself).
      const showNote = isSelf ? false : (isLeaderRating ? !person.isLeader : person.isLeader);
      const notePlaceholder = person.isLeader
        ? "Add a note about the leader (optional)…"
        : "Add a note for this member (optional)…";

      const row = document.createElement("div");
      row.className = "rate-modal-row" + (isSelf ? " rate-modal-row-self" : "");
      row.dataset.uid = person.uid;
      row.dataset.value = existingRatings[person.uid] ? String(existingRatings[person.uid]) : "";

      const label = document.createElement("div");
      label.className = "rate-modal-name";
      label.textContent = person.name + (person.isLeader ? " (Leader)" : "");
      row.appendChild(label);

      const picker = document.createElement("div");
      picker.className = "rate-star-picker";
      for (let i = 1; i <= 10; i++) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "rate-star-btn";
        btn.textContent = String(i);
        btn.disabled = isSelf;
        if (existingRatings[person.uid] === i) btn.classList.add("selected");
        btn.addEventListener("click", () => {
          row.dataset.value = String(i);
          picker.querySelectorAll(".rate-star-btn").forEach((b) => b.classList.toggle("selected", b === btn));
          checkComplete();
        });
        picker.appendChild(btn);
      }
      row.appendChild(picker);

      if (showNote) {
        const noteLabel = document.createElement("p");
        noteLabel.className = "rate-modal-note-label";
        noteLabel.textContent = person.isLeader ? "Note about the leader" : "Note for " + person.name;
        row.appendChild(noteLabel);

        const note = document.createElement("textarea");
        note.className = "rate-modal-note";
        note.placeholder = notePlaceholder;
        note.value = existingNotes[person.uid] || "";
        row.appendChild(note);
      }

      listEl.appendChild(row);
    });

    listEl.addEventListener("input", checkComplete);
    checkComplete();
  });

  submitBtn.onclick = async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";
    try {
      const ratings = {};
      const notes = {};
      listEl.querySelectorAll(".rate-modal-row:not(.rate-modal-row-self)").forEach((row) => {
        if (row.dataset.value) ratings[row.dataset.uid] = Number(row.dataset.value);
        const noteEl = row.querySelector(".rate-modal-note");
        if (noteEl && noteEl.value.trim()) notes[row.dataset.uid] = noteEl.value.trim();
      });
      await setDoc(doc(db, "groupProjectRatings", ratingDocId), {
        projectId: project.id,
        groupIndex,
        raterUid: uid,
        ratings,
        notes,
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
    btn.addEventListener("click", () => {
      const perm = btn.dataset.perm;
      if (perm && !guardPerm(perm, btn.textContent.trim())) return;
      overlay.hidden = false;
    });
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
    const perm = btn.dataset.perm;
    if (perm && !guardPerm(perm, btn.textContent.trim())) return;
    const tab = btn.dataset.tab;
    bar.querySelectorAll(".admin-tab-pill").forEach((b) => b.classList.toggle("active", b === btn));
    panels.forEach((p) => { p.hidden = p.dataset.tabPanel !== tab; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

// Splits "a|b|c" or newline-separated text into a clean array of strings.
// Top-level (not nested in initAdminPage) since both the in-page admin
// forms and wireEventEditModal() — which is defined outside
// initAdminPage — need it.
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
  function wireForm(formId, collectionName, errorId, successId, buildData, pushInfo, permKey) {
    const form = document.getElementById(formId);
    const errorEl = document.getElementById(errorId);
    const successEl = document.getElementById(successId);
    const submitBtn = form.querySelector("button[type=submit]");
    const perm = permKey || collectionName;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!guardPerm(perm, form.dataset.originalLabel || submitBtn.textContent)) return;
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

  // Group Project — dynamic groups with cross-group member exclusion
  await initProjectForm();
  initProjectEditForm();
  await initFundTransactionForm();

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
  await populateTaskBatchmateChecklist();
  const taskForm = document.getElementById("form-task");
  const taskErrorEl = document.getElementById("task-error");
  const taskSuccessEl = document.getElementById("task-success");
  const taskBtn = taskForm.querySelector("button[type=submit]");
  const taskOriginalLabel = taskBtn.textContent;

  taskForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!guardPerm('tasks', 'Assign Task')) return;
    taskErrorEl.hidden = true;
    taskSuccessEl.hidden = true;

    const checked = Array.from(document.querySelectorAll("#task-batchmate-checklist .task-member-checkbox:checked"));
    if (checked.length === 0) {
      taskErrorEl.textContent = "Pick at least one student to assign this task to.";
      taskErrorEl.hidden = false;
      return;
    }

    taskBtn.disabled = true;
    taskBtn.textContent = "Assigning…";

    try {
      const taskName = document.getElementById("task-name").value.trim();
      const baseData = {
        taskName,
        description: document.getElementById("task-description").value.trim(),
        difficulty: document.getElementById("task-difficulty").value,
        dueDate: document.getElementById("task-duedate").value,
        status: "ongoing",
        createdAt: serverTimestamp()
      };

      // More than one person picked → the same task for a group. Each
      // person still gets their OWN task doc (so the existing per-doc
      // security rules, dashboard query, and verify/rate flow all just
      // work unchanged) but they share a groupTaskId so the admin panel
      // can display them together. A member's doc leaving "ongoing" once
      // verified is exactly what takes them out of the shared pool —
      // no extra bookkeeping needed for that.
      const isGroup = checked.length > 1;
      const groupTaskId = isGroup ? doc(collection(db, "tasks")).id : null;

      const batch = writeBatch(db);
      checked.forEach((cb) => {
        const taskRef = doc(collection(db, "tasks"));
        const data = { ...baseData, assignedToUid: cb.value, assignedToName: cb.dataset.displayName };
        if (isGroup) {
          data.groupTaskId = groupTaskId;
          data.groupSize = checked.length;
        }
        batch.set(taskRef, data);
      });
      await batch.commit();

      taskSuccessEl.textContent = isGroup ? `Task assigned to ${checked.length} students.` : "Task assigned.";
      taskSuccessEl.hidden = false;
      taskForm.reset();
      // form.reset() clears the search box's value but doesn't re-run its
      // input filter, so any rows it had hidden would otherwise stay
      // hidden — un-hide everything to match the now-empty search box.
      document.querySelectorAll("#task-batchmate-checklist .member-check-row").forEach((row) => { row.hidden = false; });
      await renderAdminActiveTasks();

      // Individual push — every assigned batchmate gets their own notice.
      checked.forEach((cb) => {
        sendPushNotification({
          type: "task",
          title: "New task assigned to you",
          message: taskName,
          url: "dashboard.html",
          targetUid: cb.value
        });
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
  wireTaskEditModal();

  // Completed Tasks panel
  await renderAdminCompletedTasks();
  document.getElementById("refresh-completed-tasks").addEventListener("click", renderAdminCompletedTasks);
  document.getElementById("completed-tasks-sort").addEventListener("change", () => renderCompletedTasksList());
  document.getElementById("completed-tasks-filter").addEventListener("change", () => renderCompletedTasksList());

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

  // Manage Profile Fields (Dashboard sections + directory "public" flags)
  initFieldManagerPanel();

  // Settings Change-Request Fields (tick list)
  initSettingsFieldsPanel();

  // Manage Student Badges
  await initBadgeAssignmentPanel();

  // Manage Bad Behavior Records
  await initBadBehaviorPanel();

  // Timetable — Add Slot form, Active Timetable panel, Edit + Override modals
  initTimetableForm();
  await renderAdminTimetable();
  document.getElementById("refresh-timetable").addEventListener("click", renderAdminTimetable);
  wireTimetableEditModal();
  wireTimetableOverrideModal();

  // Database Storage (estimate)
  initDbStoragePanel();

  // Data Table (Data tab) — pick-your-columns view over /batchmates
  await initDataTablePanel();

  // Manage Admin Access (Danger tab, super admin only)
  if (ADMIN_INFO && ADMIN_INFO.superAdmin === true) {
    const manageBtn = document.getElementById("manage-admins-btn");
    if (manageBtn) manageBtn.hidden = false;
    initManageAdminsPanel();
  }

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
    if (!guardPerm('badBehavior', 'Bad Behavior Record')) return;
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
        if (!guardPerm('badges', 'Manage Student Badges')) { cb.checked = !cb.checked; return; }
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
    list.push({ uid: docSnap.id, fullName: d.fullName || "Unnamed", campusIndexNumber: d.campusIndexNumber || "", photoUrl: d.photoUrl || "" });
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
    if (!guardPerm('projects', 'Add Group Project')) return;
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
    if (!guardPerm('fund', 'Add Fund Transaction')) return;
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

async function createGroupBlock(containerId = "groups-container") {
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

  document.getElementById(containerId).appendChild(block);
  await buildMemberChecklist(block);
  await buildLeaderSelect(block, containerId);
  refreshMemberExclusions(containerId);

  block.querySelector(".remove-group-btn").addEventListener("click", () => {
    block.remove();
    refreshMemberExclusions(containerId);
    updateRemoveButtonsVisibility(containerId);
  });
  block.querySelector(".group-member-search").addEventListener("input", () => applyRowVisibility(block));

  updateRemoveButtonsVisibility(containerId);
  return block;
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
async function buildLeaderSelect(block, containerId = "groups-container") {
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

  select.addEventListener("change", () => refreshMemberExclusions(containerId));
}

function applyRowVisibility(block) {
  const term = block.querySelector(".group-member-search").value.trim().toLowerCase();
  block.querySelectorAll(".member-check-row").forEach((row) => {
    const excluded = row.dataset.excluded === "true";
    const matches = !term || row.dataset.name.includes(term);
    row.hidden = excluded || !matches;
  });
}

// Whenever a member checkbox or leader select changes anywhere WITHIN
// THE SAME group-block container, that student disappears from every
// OTHER group's member list and leader dropdown in that container — a
// student can only be one leader or member, in one group, per project
// (leader and member are mutually exclusive roles too). Scoped to a
// single container so the "Add Group Project" form and the "Edit Group
// Project" modal — both built from the same group-block markup, and
// both present in the DOM at once — never cross-exclude each other.
function refreshMemberExclusions(containerId = "groups-container") {
  const root = document.getElementById(containerId);
  if (!root) return;
  const takenBy = {}; // uid -> the blockId that currently has them (member or leader)
  root.querySelectorAll(".group-block").forEach((block) => {
    block.querySelectorAll(".member-checkbox:checked").forEach((cb) => {
      takenBy[cb.value] = block.dataset.blockId;
    });
    const leaderSelect = block.querySelector(".group-leader-select");
    if (leaderSelect && leaderSelect.value) takenBy[leaderSelect.value] = block.dataset.blockId;
  });

  root.querySelectorAll(".group-block").forEach((block) => {
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

function updateRemoveButtonsVisibility(containerId = "groups-container") {
  const root = document.getElementById(containerId);
  if (!root) return;
  const blocks = root.querySelectorAll(".group-block");
  blocks.forEach((block) => {
    block.querySelector(".remove-group-btn").hidden = blocks.length <= 1;
  });
}

// Populates the "Assign Task" checklist (search + one row per batchmate,
// same member-check-row pattern group projects use). Multiple boxes can
// be ticked — the submit handler below creates one task doc per person
// picked, linked by a shared groupTaskId when there's more than one.
async function populateTaskBatchmateChecklist() {
  const container = document.getElementById("task-batchmate-checklist");
  const searchInput = document.getElementById("task-batchmate-search");
  if (!container) return;

  const people = await getBatchmatesPublicList();
  container.innerHTML = "";

  if (people.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No batchmates found.</p>';
    return;
  }

  people.forEach((p) => {
    const row = document.createElement("label");
    row.className = "member-check-row";
    row.dataset.name = (p.fullName + " " + p.campusIndexNumber).toLowerCase();

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "task-member-checkbox";
    cb.value = p.uid;
    cb.dataset.displayName = `${p.fullName} (${p.campusIndexNumber})`;

    const label = document.createElement("span");
    label.textContent = `${p.fullName} — ${p.campusIndexNumber}`;

    row.appendChild(cb);
    row.appendChild(label);
    container.appendChild(row);
  });

  if (searchInput && !searchInput.dataset.wired) {
    searchInput.dataset.wired = "true";
    searchInput.addEventListener("input", () => {
      const term = searchInput.value.trim().toLowerCase();
      container.querySelectorAll(".member-check-row").forEach((row) => {
        row.hidden = !!term && !row.dataset.name.includes(term);
      });
    });
  }
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

  // Tasks sharing a groupTaskId (assigned to several students at once,
  // via the checklist in "Assign Task") render together under one
  // header, each member as their own rate/verify row — solo tasks keep
  // the original flat single-box layout.
  const solo = [];
  const groups = new Map(); // groupTaskId -> tasks[]
  list.forEach((t) => {
    if (t.groupTaskId) {
      if (!groups.has(t.groupTaskId)) groups.set(t.groupTaskId, []);
      groups.get(t.groupTaskId).push(t);
    } else {
      solo.push(t);
    }
  });

  container.innerHTML = "";

  // One member's rate-select + Verify button — shared shape between a
  // group's member rows. onVerified is called after a successful verify
  // so the caller can remove the row and update its own surrounding UI.
  function buildMemberRow(task, onVerified) {
    const docId = task.id;
    const isPending = task.status === "pending";

    const row = document.createElement("div");
    row.className = "admin-task-member-row" + (isPending ? " needs-verify" : "");

    const left = document.createElement("div");
    left.className = "admin-task-member-left";
    const assignee = document.createElement("span");
    assignee.className = "admin-task-assignee";
    assignee.textContent = task.assignedToName || "Unknown batchmate";
    left.appendChild(assignee);
    if (isPending) {
      const badge = document.createElement("span");
      badge.className = "admin-task-badge";
      badge.textContent = "Needs verification";
      left.appendChild(badge);
    }

    const right = document.createElement("div");
    right.className = "admin-task-member-right";

    const ratingPicker = buildRatingBoxPicker();

    const verifyBtn = document.createElement("button");
    verifyBtn.className = "admin-task-verify-btn";
    verifyBtn.textContent = "Verify";
    verifyBtn.addEventListener("click", async () => {
      const rating = Number(ratingPicker.dataset.value);
      if (!rating) {
        alert("Pick a rating (1-10) before verifying — it always contributes prestige points.");
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = "…";
      try {
        await adminVerifyTask(docId, task, rating);
        onVerified();
      } catch (err) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify";
        if (!err || err.message !== "no-permission") alert("Could not verify this task. Please try again.");
      }
    });

    right.appendChild(ratingPicker);
    right.appendChild(verifyBtn);
    row.appendChild(left);
    row.appendChild(right);
    return row;
  }

  function showEmptyStateIfNothingLeft() {
    if (!container.querySelector(".admin-task-box")) {
      container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active tasks right now.</p>';
    }
  }

  // Group boxes first — surfaces sets of people needing attention
  // together, ahead of one-off solo tasks.
  groups.forEach((members, groupTaskId) => {
    const first = members[0];
    const box = document.createElement("div");
    box.className = "admin-task-box admin-task-group-box";

    const header = document.createElement("div");
    header.className = "admin-task-group-header";
    const name = document.createElement("div");
    name.className = "admin-task-name";
    name.textContent = first.taskName || "Untitled task";
    header.appendChild(name);
    const progress = document.createElement("div");
    progress.className = "admin-task-group-progress";
    progress.textContent = `${members.length} of ${first.groupSize || members.length} still active`;
    header.appendChild(progress);
    const groupEditBtn = document.createElement("button");
    groupEditBtn.type = "button";
    groupEditBtn.className = "ghost-btn admin-task-edit-btn";
    groupEditBtn.textContent = "Edit";
    groupEditBtn.addEventListener("click", () => openTaskEditModal(first, true));
    header.appendChild(groupEditBtn);
    box.appendChild(header);

    if (first.description) {
      const desc = document.createElement("div");
      desc.className = "admin-project-desc";
      desc.textContent = first.description;
      box.appendChild(desc);
    }

    const rowsWrap = document.createElement("div");
    rowsWrap.className = "admin-task-group-members";
    members.forEach((task) => {
      const row = buildMemberRow(task, () => {
        row.remove();
        const remaining = rowsWrap.querySelectorAll(".admin-task-member-row").length;
        if (remaining === 0) {
          box.remove();
          showEmptyStateIfNothingLeft();
        } else {
          progress.textContent = `${remaining} of ${first.groupSize || members.length} still active`;
        }
      });
      rowsWrap.appendChild(row);
    });
    box.appendChild(rowsWrap);

    container.appendChild(box);
  });

  // Solo tasks — unchanged single-assignee layout.
  solo.forEach((task) => {
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
    right.style.flexWrap = "wrap";

    const ratingPicker = buildRatingBoxPicker();

    const verifyBtn = document.createElement("button");
    verifyBtn.className = "admin-task-verify-btn";
    verifyBtn.textContent = "Verify";
    verifyBtn.addEventListener("click", async () => {
      const rating = Number(ratingPicker.dataset.value);
      if (!rating) {
        alert("Pick a rating (1-10) before verifying — it always contributes prestige points.");
        return;
      }
      verifyBtn.disabled = true;
      verifyBtn.textContent = "…";
      try {
        await adminVerifyTask(docId, task, rating);
        box.remove();
        showEmptyStateIfNothingLeft();
      } catch (err) {
        verifyBtn.disabled = false;
        verifyBtn.textContent = "Verify";
        if (!err || err.message !== "no-permission") alert("Could not verify this task. Please try again.");
      }
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ghost-btn admin-task-edit-btn";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openTaskEditModal(task, false));

    right.appendChild(editBtn);
    right.appendChild(ratingPicker);
    right.appendChild(verifyBtn);
    box.appendChild(left);
    box.appendChild(right);
    container.appendChild(box);
  });
}

// ── Admin: Edit Active Task ─────────────────────────────────────
// A solo task edits just its own doc (taskedit-id). A group task (one
// created for several assignees at once, sharing a groupTaskId) edits
// the shared fields — name/description/difficulty/dueDate — across
// every still-active doc in that group in one go, since those fields
// are duplicated per-assignee rather than stored once.
function openTaskEditModal(task, isGroupEdit) {
  if (!guardPerm('tasks', 'Edit Task')) return;
  const overlay = document.getElementById("modal-task-edit");
  const errorEl = document.getElementById("taskedit-error");
  const successEl = document.getElementById("taskedit-success");
  const noteEl = document.getElementById("taskedit-scope-note");
  if (!overlay) return;
  errorEl.hidden = true;
  successEl.hidden = true;

  document.getElementById("taskedit-id").value = isGroupEdit ? "" : task.id;
  document.getElementById("taskedit-groupid").value = isGroupEdit ? task.groupTaskId : "";
  document.getElementById("taskedit-name").value = task.taskName || "";
  document.getElementById("taskedit-description").value = task.description || "";
  document.getElementById("taskedit-difficulty").value = task.difficulty || "medium";
  document.getElementById("taskedit-duedate").value = task.dueDate || "";
  noteEl.textContent = isGroupEdit
    ? "This task was assigned to several people at once — saving will update it for everyone still active on it."
    : `Assigned to: ${task.assignedToName || "Unknown batchmate"}`;

  overlay.hidden = false;
}

function wireTaskEditModal() {
  const form = document.getElementById("form-task-edit");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('tasks', 'Edit Task')) return;
    e.preventDefault();
    const errorEl = document.getElementById("taskedit-error");
    const successEl = document.getElementById("taskedit-success");
    errorEl.hidden = true;
    successEl.hidden = true;

    const soloId = document.getElementById("taskedit-id").value;
    const groupTaskId = document.getElementById("taskedit-groupid").value;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    const updates = {
      taskName: document.getElementById("taskedit-name").value.trim(),
      description: document.getElementById("taskedit-description").value.trim(),
      difficulty: document.getElementById("taskedit-difficulty").value,
      dueDate: document.getElementById("taskedit-duedate").value
    };

    try {
      if (soloId) {
        await updateDoc(doc(db, "tasks", soloId), updates);
      } else if (groupTaskId) {
        const q = query(
          collection(db, "tasks"),
          where("groupTaskId", "==", groupTaskId),
          where("status", "in", ["ongoing", "pending"])
        );
        const snap = await getDocs(q);
        const writes = [];
        snap.forEach((docSnap) => writes.push(updateDoc(doc(db, "tasks", docSnap.id), updates)));
        await Promise.all(writes);
      }
      successEl.textContent = "Task updated.";
      successEl.hidden = false;
      await renderAdminActiveTasks();
      setTimeout(() => { document.getElementById("modal-task-edit").hidden = true; }, 700);
    } catch (err) {
      errorEl.textContent = "Could not save changes. Please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

// Admin action: marks a task fully complete, awards its prestige points,
// and makes it disappear from the batchmate's Active Tasks card.
// Points = (difficulty base, only if finished on time) + (rating × 2).
// "On time" is judged against completionRequestedAt (when the batchmate
// hit "Notify me") if present, falling back to today for older tasks
// that predate that field.
async function adminVerifyTask(taskId, task, rating) {
  if (!guardPerm('tasks', 'Verify Task')) throw new Error("no-permission");
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
  if (!guardPerm('fund', 'Edit Fund Transaction')) return;
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
    if (!guardPerm('fund', 'Edit Fund Transaction')) return;
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
  if (!guardPerm('events', 'Edit Event')) return;
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
    if (!guardPerm('events', 'Edit Event')) return;
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

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ghost-btn";
    editBtn.style.cssText = "margin:10px 0 0; padding:6px 14px; font-size:12px;";
    editBtn.textContent = "Edit Project";
    editBtn.addEventListener("click", () => openProjectEditModal(p));
    box.appendChild(editBtn);

    const ratingSection = document.createElement("div");
    ratingSection.className = "admin-project-rating-section";
    box.appendChild(ratingSection);
    renderAdminProjectRatingControls(ratingSection, p);

    container.appendChild(box);
  });
}

// ── Admin: Edit Group Project ───────────────────────────────────────
// Opened by the "Edit Project" button above. Reuses the exact same
// group-block builder as "Add Group Project" (createGroupBlock() etc.),
// just pointed at this modal's own #projectedit-groups-container and
// pre-filled with the project's current title/description/status/order
// and each group's name/leader/due date/members.
async function openProjectEditModal(p) {
  if (!guardPerm('projects', 'Edit Group Project')) return;
  const overlay = document.getElementById("modal-project-edit");
  const errorEl = document.getElementById("projectedit-error");
  const successEl = document.getElementById("projectedit-success");
  if (!overlay) return;
  errorEl.hidden = true;
  successEl.hidden = true;

  document.getElementById("projectedit-title").value = p.title || "";
  document.getElementById("projectedit-description").value = p.description || "";
  document.getElementById("projectedit-status").value = p.status || "starting";
  document.getElementById("projectedit-order").value = (p.order === undefined || p.order === null) ? "" : p.order;

  const container = document.getElementById("projectedit-groups-container");
  container.innerHTML = "";
  await getBatchmatesPublicList(); // warm the cache before building blocks

  const groups = Array.isArray(p.groups) && p.groups.length > 0 ? p.groups : [{}];
  for (const g of groups) {
    const block = await createGroupBlock("projectedit-groups-container");
    block.querySelector(".group-name-input").value = g.groupName || "";
    block.querySelector(".group-duedate-input").value = g.dueDate || "";
    const leaderSelect = block.querySelector(".group-leader-select");
    if (g.leaderUid) leaderSelect.value = g.leaderUid;
    const memberUids = new Set(Array.isArray(g.memberUids) ? g.memberUids : []);
    block.querySelectorAll(".member-checkbox").forEach((cb) => {
      cb.checked = memberUids.has(cb.value);
    });
  }
  refreshMemberExclusions("projectedit-groups-container");
  updateRemoveButtonsVisibility("projectedit-groups-container");

  overlay.dataset.projectId = p.id;
  overlay.hidden = false;
}

function initProjectEditForm() {
  const overlay = document.getElementById("modal-project-edit");
  const addGroupBtn = document.getElementById("projectedit-add-group-btn");
  const form = document.getElementById("form-projectedit");
  const errorEl = document.getElementById("projectedit-error");
  const successEl = document.getElementById("projectedit-success");
  if (!overlay || !addGroupBtn || !form) return;

  const groupsContainer = document.getElementById("projectedit-groups-container");
  groupsContainer.addEventListener("change", (e) => {
    if (e.target.classList.contains("member-checkbox")) refreshMemberExclusions("projectedit-groups-container");
  });

  addGroupBtn.addEventListener("click", () => createGroupBlock("projectedit-groups-container"));

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('projects', 'Edit Group Project')) return;
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      const groups = [];
      groupsContainer.querySelectorAll(".group-block").forEach((block) => {
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

      const updates = {
        title: document.getElementById("projectedit-title").value.trim(),
        description: document.getElementById("projectedit-description").value.trim(),
        status: document.getElementById("projectedit-status").value || "starting",
        groups
      };
      const orderVal = document.getElementById("projectedit-order").value;
      updates.order = orderVal === "" ? deleteField() : Number(orderVal);

      await updateDoc(doc(db, "groupProjects", overlay.dataset.projectId), updates);
      successEl.textContent = "Saved.";
      successEl.hidden = false;
      await renderAdminActiveProjects();
      setTimeout(() => { overlay.hidden = true; }, 700);
    } catch (err) {
      errorEl.textContent = "Could not save these changes — please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
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
    const picker = buildRatingBoxPicker();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "admin-task-verify-btn";
    btn.textContent = "Award to All";
    btn.addEventListener("click", async () => {
      const value = Number(picker.dataset.value);
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
    overallRow.appendChild(picker);
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
      const picker = buildRatingBoxPicker();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-task-verify-btn";
      btn.textContent = "Award to Group";
      btn.addEventListener("click", async () => {
        const value = Number(picker.dataset.value);
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
      row.appendChild(picker);
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

// Box-type 1-10 picker for the admin's Overall/Group rating rows — same
// visual design as the home page's group-project peer rating picker
// (.rate-star-picker / .rate-star-btn), used here instead of a native
// <select> so the admin taps a number box rather than opening the
// browser's default dropdown. The chosen value is read from
// picker.dataset.value (set on click), same contract buildRatingSelect's
// callers used to read from select.value.
function buildRatingBoxPicker() {
  const picker = document.createElement("div");
  picker.className = "rate-star-picker admin-rating-picker";
  picker.dataset.value = "";
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rate-star-btn";
    btn.textContent = String(i);
    btn.addEventListener("click", () => {
      picker.dataset.value = String(i);
      picker.querySelectorAll(".rate-star-btn").forEach((b) => b.classList.toggle("selected", b === btn));
    });
    picker.appendChild(btn);
  }
  return picker;
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
// members, that group's individual rating if the admin ever set one,
// and — since this is history, only ever seen for finished projects —
// each member's peer/leader rating average plus any notes left about
// them, pulled from groupProjectRatings the same way finalizeGroupRatings()
// scores a group, just displayed instead of paid out.
async function openProjectDetailModal(p) {
  const body = document.getElementById("project-detail-body");
  const overlay = document.getElementById("modal-project-detail");
  if (!body || !overlay) return;
  overlay.hidden = false;
  body.innerHTML = "Loading…";

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
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
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

      const roster = getGroupRoster(g);
      if (roster.length > 0) {
        const submissions = await getGroupRatingSubmissions(p.id, i);
        const ratingsWrap = document.createElement("div");
        ratingsWrap.className = "admin-member-ratings";

        roster.forEach((person) => {
          let weightedSum = 0;
          let weightTotal = 0;
          const notes = [];

          submissions.forEach((sub) => {
            if (sub.raterUid === person.uid) return; // no self-ratings
            const value = sub.ratings ? sub.ratings[person.uid] : undefined;
            if (typeof value === "number") {
              const weight = (!person.isLeader && sub.raterUid === g.leaderUid) ? LEADER_RATING_WEIGHT : 1;
              weightedSum += value * weight;
              weightTotal += weight;
            }
            const noteText = sub.notes ? sub.notes[person.uid] : undefined;
            if (noteText) {
              const rater = roster.find((r) => r.uid === sub.raterUid);
              notes.push({ from: rater ? rater.name : "Unknown", text: noteText });
            }
          });

          const row = document.createElement("div");
          row.className = "admin-member-rating-row";
          const nameEl = document.createElement("span");
          nameEl.className = "admin-member-rating-name";
          nameEl.textContent = person.name + (person.isLeader ? " (Leader)" : "");
          const scoreEl = document.createElement("span");
          scoreEl.className = "admin-member-rating-score";
          scoreEl.textContent = weightTotal > 0 ? `Avg: ${(weightedSum / weightTotal).toFixed(1)}/10` : "Not rated";
          row.appendChild(nameEl);
          row.appendChild(scoreEl);
          ratingsWrap.appendChild(row);

          notes.forEach((n) => {
            const noteEl = document.createElement("div");
            noteEl.className = "admin-member-rating-note";
            noteEl.textContent = `${n.from}: "${n.text}"`;
            ratingsWrap.appendChild(noteEl);
          });
        });

        wrap.appendChild(ratingsWrap);
      }

      body.appendChild(wrap);
    }
  }
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
        if (!err || err.message !== "no-permission") alert("Could not approve this request. Please try again.");
      }
    });

    rejectBtn.addEventListener("click", async () => {
      if (!guardPerm('changeRequests', 'Reject Change Request')) return;
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
  if (!guardPerm('changeRequests', 'Approve Change Request')) throw new Error("no-permission");
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
    if (!guardPerm('bulkField', 'Bulk Field Edit')) return;
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

// ── Admin: Manage Profile Fields (Danger tab) ───────────────────────
// Lets an admin edit the schema at /config/directoryFields — the same
// schema renderDynamicFieldGroups() (Dashboard) and openBatchmateModal()
// (Home directory popup) read. Edits happen on an in-memory copy
// (fieldMgrState) and are only committed to Firestore — and pushed out
// to every batchmate's batchmatesPublic doc via syncDirectoryPublicFields
// — when "Save Changes" is tapped. Closing the popup without saving
// discards them; reopening it always reloads the last-saved copy.
let fieldMgrState = null;
let fieldMgrRemovedKeys = [];
let fieldMgrNextTempId = 1;

function initFieldManagerPanel() {
  const openBtn = document.querySelector('.admin-section-btn[data-modal="modal-fieldmanager"]');
  const sectionsEl = document.getElementById("fieldmgr-sections");
  const addSectionBtn = document.getElementById("fieldmgr-add-section-btn");
  const saveBtn = document.getElementById("fieldmgr-save-btn");
  const resyncBtn = document.getElementById("fieldmgr-resync-btn");
  const errorEl = document.getElementById("fieldmgr-error");
  const successEl = document.getElementById("fieldmgr-success");
  if (!openBtn || !sectionsEl || !addSectionBtn || !saveBtn || !resyncBtn || !errorEl || !successEl) return;

  const FIELD_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  openBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    successEl.hidden = true;
    sectionsEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Loading…</p>';
    const groups = await getDirectoryFieldSchema(true); // always start from the last saved copy
    fieldMgrState = cloneFieldGroups(groups);
    fieldMgrRemovedKeys = [];
    renderSections();
  });

  function renderSections() {
    sectionsEl.innerHTML = "";
    const sortedGroups = [...fieldMgrState].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedGroups.forEach((g, gIndex) => {
      const box = document.createElement("div");
      box.className = "fieldmgr-section";

      const head = document.createElement("div");
      head.className = "fieldmgr-section-head";

      const upBtn = document.createElement("button");
      upBtn.type = "button";
      upBtn.className = "fieldmgr-reorder-btn";
      upBtn.textContent = "▲";
      upBtn.title = "Move section up";
      upBtn.disabled = gIndex === 0;
      upBtn.addEventListener("click", () => moveGroup(g.id, -1));

      const downBtn = document.createElement("button");
      downBtn.type = "button";
      downBtn.className = "fieldmgr-reorder-btn";
      downBtn.textContent = "▼";
      downBtn.title = "Move section down";
      downBtn.disabled = gIndex === sortedGroups.length - 1;
      downBtn.addEventListener("click", () => moveGroup(g.id, 1));

      const titleInput = document.createElement("input");
      titleInput.type = "text";
      titleInput.value = g.title || "";
      titleInput.placeholder = "Section title";
      titleInput.addEventListener("input", () => { g.title = titleInput.value; });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "fieldmgr-del-btn";
      delBtn.textContent = "✕";
      delBtn.title = "Delete section";
      delBtn.addEventListener("click", () => {
        const fieldCount = (g.fields || []).length;
        if (!confirm(`Delete the "${g.title || "Untitled"}" section${fieldCount ? ` and its ${fieldCount} field(s)` : ""}? This only takes effect once you tap Save Changes.`)) return;
        (g.fields || []).forEach((f) => fieldMgrRemovedKeys.push(f.key));
        fieldMgrState = fieldMgrState.filter((x) => x.id !== g.id);
        renderSections();
      });

      head.appendChild(upBtn);
      head.appendChild(downBtn);
      head.appendChild(titleInput);
      head.appendChild(delBtn);
      box.appendChild(head);

      const sortedFields = [...(g.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      sortedFields.forEach((f, fIndex) => {
        const row = document.createElement("div");
        row.className = "fieldmgr-field-row";

        const fUp = document.createElement("button");
        fUp.type = "button";
        fUp.className = "fieldmgr-reorder-btn";
        fUp.textContent = "▲";
        fUp.title = "Move field up";
        fUp.disabled = fIndex === 0;
        fUp.addEventListener("click", () => moveField(g.id, f, -1));

        const fDown = document.createElement("button");
        fDown.type = "button";
        fDown.className = "fieldmgr-reorder-btn";
        fDown.textContent = "▼";
        fDown.title = "Move field down";
        fDown.disabled = fIndex === sortedFields.length - 1;
        fDown.addEventListener("click", () => moveField(g.id, f, 1));

        const keyInput = document.createElement("input");
        keyInput.type = "text";
        keyInput.className = "fieldmgr-key-input";
        keyInput.value = f.key || "";
        keyInput.placeholder = "fieldKey";
        keyInput.title = "Matches the property name on the batchmate's record (e.g. bloodGroup). Change with care — see the Add/Remove Field tool to create the matching data.";
        keyInput.addEventListener("change", () => {
          const newKey = keyInput.value.trim();
          if (!FIELD_KEY_RE.test(newKey)) {
            alert("Field name must start with a letter and contain only letters, numbers and underscores.");
            keyInput.value = f.key;
            return;
          }
          if (newKey !== f.key) {
            fieldMgrRemovedKeys.push(f.key); // old key's mirrored copy (if any) gets cleaned up on save
            f.key = newKey;
          }
        });

        const labelInput = document.createElement("input");
        labelInput.type = "text";
        labelInput.className = "fieldmgr-label-input";
        labelInput.value = f.label || "";
        labelInput.placeholder = "Display label";
        labelInput.addEventListener("input", () => { f.label = labelInput.value; });

        const publicLabel = document.createElement("label");
        publicLabel.className = "fieldmgr-public-toggle";
        const publicCheckbox = document.createElement("input");
        publicCheckbox.type = "checkbox";
        publicCheckbox.checked = !!f.public;
        publicCheckbox.addEventListener("change", () => { f.public = publicCheckbox.checked; });
        publicLabel.appendChild(publicCheckbox);
        publicLabel.appendChild(document.createTextNode("Public"));

        const fDel = document.createElement("button");
        fDel.type = "button";
        fDel.className = "fieldmgr-del-btn";
        fDel.textContent = "✕";
        fDel.title = "Delete field";
        fDel.addEventListener("click", () => {
          fieldMgrRemovedKeys.push(f.key);
          g.fields = g.fields.filter((x) => x !== f);
          renderSections();
        });

        row.appendChild(fUp);
        row.appendChild(fDown);
        row.appendChild(keyInput);
        row.appendChild(labelInput);
        row.appendChild(publicLabel);
        row.appendChild(fDel);
        box.appendChild(row);
      });

      const addFieldBtn = document.createElement("button");
      addFieldBtn.type = "button";
      addFieldBtn.className = "fieldmgr-add-field-btn";
      addFieldBtn.textContent = "+ Add Field";
      addFieldBtn.addEventListener("click", () => {
        const maxOrder = g.fields.reduce((m, x) => Math.max(m, x.order || 0), -1);
        g.fields.push({ key: `newField${fieldMgrNextTempId++}`, label: "New Field", order: maxOrder + 1, public: false });
        renderSections();
      });
      box.appendChild(addFieldBtn);

      sectionsEl.appendChild(box);
    });
  }

  function moveGroup(groupId, dir) {
    const sorted = [...fieldMgrState].sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = sorted.findIndex((g) => g.id === groupId);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmp;
    renderSections();
  }

  function moveField(groupId, field, dir) {
    const g = fieldMgrState.find((x) => x.id === groupId);
    if (!g) return;
    const sorted = [...g.fields].sort((a, b) => (a.order || 0) - (b.order || 0));
    const idx = sorted.indexOf(field);
    const swapIdx = idx + dir;
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return;
    const tmp = sorted[idx].order;
    sorted[idx].order = sorted[swapIdx].order;
    sorted[swapIdx].order = tmp;
    renderSections();
  }

  addSectionBtn.addEventListener("click", () => {
    const maxOrder = fieldMgrState.reduce((m, g) => Math.max(m, g.order || 0), -1);
    fieldMgrState.push({ id: `section${fieldMgrNextTempId++}`, title: "New Section", order: maxOrder + 1, fields: [] });
    renderSections();
  });

  saveBtn.addEventListener("click", async () => {
    if (!guardPerm('fieldManager', 'Manage Profile Fields')) return;
    errorEl.hidden = true;
    successEl.hidden = true;

    const sortedGroups = [...fieldMgrState].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const g of sortedGroups) {
      for (const f of g.fields) {
        if (!FIELD_KEY_RE.test(f.key || "")) {
          errorEl.textContent = `"${f.label || f.key}" has an invalid field name — letters, numbers and underscores only, starting with a letter.`;
          errorEl.hidden = false;
          return;
        }
      }
    }
    // Re-number order sequentially so future inserts/reorders never collide.
    sortedGroups.forEach((g, gi) => {
      g.order = gi;
      const sortedFields = [...g.fields].sort((a, b) => (a.order || 0) - (b.order || 0));
      sortedFields.forEach((f, fi) => { f.order = fi; });
      g.fields = sortedFields;
    });
    fieldMgrState = sortedGroups;

    saveBtn.disabled = true;
    resyncBtn.disabled = true;
    const originalSaveLabel = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      await setDoc(doc(db, ...DIRECTORY_FIELDS_DOC_PATH), { groups: fieldMgrState, updatedAt: serverTimestamp() });
      directoryFieldSchemaCache = fieldMgrState;
      const count = await syncDirectoryPublicFields(fieldMgrState, fieldMgrRemovedKeys);
      fieldMgrRemovedKeys = [];
      successEl.textContent = `Saved — directory re-synced for ${count} batchmate(s).`;
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = "Could not save these changes — please try again.";
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      resyncBtn.disabled = false;
      saveBtn.textContent = originalSaveLabel;
    }
  });

  resyncBtn.addEventListener("click", async () => {
    if (!guardPerm('fieldManager', 'Manage Profile Fields')) return;
    errorEl.hidden = true;
    successEl.hidden = true;
    resyncBtn.disabled = true;
    saveBtn.disabled = true;
    const originalResyncLabel = resyncBtn.textContent;
    resyncBtn.textContent = "Re-syncing…";
    try {
      const savedGroups = await getDirectoryFieldSchema(true);
      const count = await syncDirectoryPublicFields(savedGroups, []);
      successEl.textContent = `Re-synced ${count} batchmate(s) against the last saved settings.`;
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = "Could not re-sync the directory — please try again.";
      errorEl.hidden = false;
    } finally {
      resyncBtn.disabled = false;
      saveBtn.disabled = false;
      resyncBtn.textContent = originalResyncLabel;
    }
  });
}

// ── Admin: Batchmate Directory (Danger tab) ─────────────────────────
// Every batchmate's complete /batchmates record, for admins only —
// unlike the Home directory (batchmatesPublic), this reads the full
// doc via the admin read-bypass, so private fields (medical, NIC,
// emergency contacts, exact prestige total, etc.) are all visible here.
function humanizeKey(key) {
  const spaced = String(key || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatAdminDirValue(v) {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v && typeof v === "object" && typeof v.toDate === "function") {
    try { return v.toDate().toLocaleString(); } catch (err) { return String(v); }
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Renders every field on a batchmate's record into #admindir-detail-fields,
// grouped by the same schema the Dashboard/directory use for the fields
// it covers, plus fixed groups for extracurricular/prestige/records, plus
// a catch-all "Other" group for anything left over (custom fields added
// via "Add/Remove Field", or anything not in the schema).
async function renderAdminDirectoryDetail(d) {
  const container = document.getElementById("admindir-detail-fields");
  container.innerHTML = "";

  const schema = await getDirectoryFieldSchema();
  const knownKeys = new Set(["fullName", "photoUrl"]);

  const sortedGroups = [...schema].sort((a, b) => (a.order || 0) - (b.order || 0));
  sortedGroups.forEach((g) => {
    const box = document.createElement("div");
    box.className = "admindir-detail-group";
    const title = document.createElement("p");
    title.className = "admindir-detail-group-title";
    title.textContent = g.title || "Details";
    box.appendChild(title);
    const fields = [...(g.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
    fields.forEach((f) => {
      knownKeys.add(f.key);
      box.appendChild(fieldRow(f.label || f.key, formatAdminDirValue(d[f.key])));
    });
    container.appendChild(box);
  });

  const extraGroup = document.createElement("div");
  extraGroup.className = "admindir-detail-group";
  const extraTitle = document.createElement("p");
  extraTitle.className = "admindir-detail-group-title";
  extraTitle.textContent = "Extracurricular, Roles & Records";
  extraGroup.appendChild(extraTitle);
  ["roles", "sports", "clubs", "skills"].forEach((key) => {
    knownKeys.add(key);
    extraGroup.appendChild(fieldRow(humanizeKey(key), formatAdminDirValue(d[key])));
  });
  knownKeys.add("prestigePoints");
  extraGroup.appendChild(fieldRow("Prestige Points (exact)", formatAdminDirValue(d.prestigePoints)));
  knownKeys.add("badBehaviorRecords");
  extraGroup.appendChild(fieldRow("Bad Behavior Records", formatAdminDirValue(d.badBehaviorRecords)));
  container.appendChild(extraGroup);

  const otherKeys = Object.keys(d).filter((k) => !knownKeys.has(k)).sort();
  if (otherKeys.length > 0) {
    const otherGroup = document.createElement("div");
    otherGroup.className = "admindir-detail-group";
    const otherTitle = document.createElement("p");
    otherTitle.className = "admindir-detail-group-title";
    otherTitle.textContent = "Other";
    otherGroup.appendChild(otherTitle);
    otherKeys.forEach((key) => {
      otherGroup.appendChild(fieldRow(humanizeKey(key), formatAdminDirValue(d[key])));
    });
    container.appendChild(otherGroup);
  }
}

// ── Admin: Data Table (Data tab) ─────────────────────────────────────
// A pick-your-columns table over the full /batchmates collection —
// admin-only, includes every private field (NIC, medical, etc.), reusing
// the same admin read-bypass the removed Batchmate Directory panel used to.
// Column choice is remembered per-browser (localStorage) — it's a view
// preference, not shared batch data, so it isn't written to Firestore.
// Tapping a column header sorts the rows alphabetically (numeric-aware,
// so index numbers sort sensibly) by that column, ascending then descending.
const DATATABLE_COLUMNS_KEY = "adminDataTableColumns";
let dataTableRows = [];       // every batchmate doc, full record
let dataTableFieldKeys = [];  // every known field key across all docs
let dataTableColumns = [];    // currently selected column keys, in order
let dataTableSort = { key: null, dir: "asc" };
let dataTableFilter = { key: "", values: [] }; // field key + set of values to filter rows by (row matches if its value is ANY of these); "" key or empty values = no filter
let dataTableFilterValueOptions = []; // every distinct value the current filter field actually has, for the values picker

function loadDataTableColumns() {
  try {
    const raw = localStorage.getItem(DATATABLE_COLUMNS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) && parsed.length ? parsed : ["fullName", "campusIndexNumber"];
  } catch (err) {
    return ["fullName", "campusIndexNumber"];
  }
}
function saveDataTableColumns() {
  try { localStorage.setItem(DATATABLE_COLUMNS_KEY, JSON.stringify(dataTableColumns)); } catch (err) { /* ignore */ }
}

// Returns dataTableRows narrowed to the active field/values filter (if any).
// A row matches if its value is ANY of the ticked values (e.g. Blood Type:
// A+ or B-). Matching is on the same formatted display string shown in the
// table, so "Female" matches however gender is actually stored (string, etc.).
function getFilteredDataTableRows() {
  if (!dataTableFilter.key || dataTableFilter.values.length === 0) return dataTableRows;
  const key = dataTableFilter.key;
  const wanted = new Set(dataTableFilter.values);
  return dataTableRows.filter((r) => wanted.has(formatAdminDirValue(r[key])));
}

// Fills the "Filter" field dropdown with every known field key (same list
// the Columns picker uses), independent of which columns are shown.
function populateDataTableFilterField() {
  const sel = document.getElementById("datatable-filter-field");
  if (!sel) return;
  const current = dataTableFilter.key;
  sel.innerHTML = '<option value="">Filter: All records</option>';
  dataTableFieldKeys.forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = humanizeKey(key);
    sel.appendChild(opt);
  });
  if (current && dataTableFieldKeys.includes(current)) {
    sel.value = current;
  } else {
    dataTableFilter = { key: "", values: [] };
    sel.value = "";
  }
}

// Recomputes every distinct value the current filter field actually has
// across all batchmates (blank/"—" entries excluded), drops any previously
// ticked values that no longer exist, and updates the "values" button's
// label/visibility to reflect the current selection.
function refreshDataTableFilterValues() {
  const btn = document.getElementById("datatable-filter-values-btn");
  if (!btn) return;
  if (!dataTableFilter.key) {
    btn.hidden = true;
    dataTableFilterValueOptions = [];
    dataTableFilter.values = [];
    return;
  }
  const key = dataTableFilter.key;
  dataTableFilterValueOptions = Array.from(new Set(
    dataTableRows.map((r) => formatAdminDirValue(r[key])).filter((v) => v !== "—")
  )).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  dataTableFilter.values = dataTableFilter.values.filter((v) => dataTableFilterValueOptions.includes(v));
  btn.hidden = false;
  btn.textContent = dataTableFilter.values.length === 0
    ? "Any value"
    : dataTableFilter.values.length === 1
      ? dataTableFilter.values[0]
      : `${dataTableFilter.values.length} values`;
}

// Fills the filter-values modal with one checkbox per distinct value for
// the currently chosen field, ticking whichever are already selected.
function renderDataTableFilterValuePicker() {
  const list = document.getElementById("datatable-filter-values-list");
  const title = document.getElementById("datatable-filter-values-title");
  if (!list) return;
  if (title) title.textContent = dataTableFilter.key ? `Filter: ${humanizeKey(dataTableFilter.key)}` : "Filter Values";
  list.innerHTML = "";
  if (dataTableFilterValueOptions.length === 0) {
    list.innerHTML = '<p class="leader-picker-empty">No values found.</p>';
    return;
  }
  dataTableFilterValueOptions.forEach((v) => {
    const row = document.createElement("label");
    row.className = "member-check-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = v;
    cb.checked = dataTableFilter.values.includes(v);
    const span = document.createElement("span");
    span.textContent = v;
    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  });
}

function renderDataTable() {
  const head = document.getElementById("datatable-head");
  const body = document.getElementById("datatable-body");
  const empty = document.getElementById("datatable-empty");
  const wrap = document.getElementById("datatable-wrap");
  if (!head || !body) return;
  head.innerHTML = "";
  body.innerHTML = "";

  if (dataTableColumns.length === 0) {
    wrap.hidden = true;
    empty.hidden = false;
    return;
  }
  wrap.hidden = false;
  empty.hidden = true;

  dataTableColumns.forEach((key) => {
    const th = document.createElement("th");
    th.textContent = humanizeKey(key);
    if (dataTableSort.key === key) {
      th.classList.add("sorted");
      const arrow = document.createElement("span");
      arrow.className = "sort-arrow";
      arrow.textContent = dataTableSort.dir === "asc" ? "↑" : "↓";
      th.appendChild(arrow);
    }
    th.addEventListener("click", () => {
      if (dataTableSort.key === key) {
        dataTableSort.dir = dataTableSort.dir === "asc" ? "desc" : "asc";
      } else {
        dataTableSort = { key, dir: "asc" };
      }
      renderDataTable();
    });
    head.appendChild(th);
  });

  let rows = getFilteredDataTableRows();
  if (dataTableSort.key) {
    const sortKey = dataTableSort.key;
    rows = [...rows].sort((a, b) => {
      const av = formatAdminDirValue(a[sortKey]);
      const bv = formatAdminDirValue(b[sortKey]);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return dataTableSort.dir === "asc" ? cmp : -cmp;
    });
  }

  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = dataTableColumns.length;
    td.textContent = "No records match this filter.";
    td.style.textAlign = "center";
    td.style.color = "var(--muted)";
    td.style.padding = "20px 10px";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const tr = document.createElement("tr");
    tr.classList.add("data-table-row");
    dataTableColumns.forEach((key) => {
      const td = document.createElement("td");
      const val = formatAdminDirValue(r[key]);
      td.textContent = val;
      td.title = val;
      tr.appendChild(td);
    });
    tr.addEventListener("click", async () => {
      const avatarEl = document.getElementById("admindir-detail-avatar");
      avatarEl.innerHTML = "";
      avatarEl.appendChild(buildAvatar(r.fullName, r.photoUrl).firstChild);
      document.getElementById("admindir-detail-name").textContent = r.fullName || "Unnamed";
      document.getElementById("admindir-detail-index").textContent = r.campusIndexNumber || "—";
      await renderAdminDirectoryDetail(r);
      document.getElementById("modal-admindirectory-detail").hidden = false;
    });
    body.appendChild(tr);
  });
}

// Exports exactly what the Data tab table is currently showing — the
// selected columns, in their current order, for whatever rows survive the
// active filter, in the current sort order — as a downloadable PDF. Uses
// jsPDF + its autoTable plugin (loaded via <script> tags in admin.html);
// bails out with a message if those scripts failed to load (e.g. offline).
function renderDataTablePdf() {
  if (dataTableColumns.length === 0) {
    alert("Pick at least one column first.");
    return;
  }
  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert("PDF export isn't available right now — check your connection and try again.");
    return;
  }

  let rows = getFilteredDataTableRows();
  if (dataTableSort.key) {
    const sortKey = dataTableSort.key;
    rows = [...rows].sort((a, b) => {
      const av = formatAdminDirValue(a[sortKey]);
      const bv = formatAdminDirValue(b[sortKey]);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return dataTableSort.dir === "asc" ? cmp : -cmp;
    });
  }

  const head = [dataTableColumns.map((key) => humanizeKey(key))];
  const body = rows.map((r) => dataTableColumns.map((key) => formatAdminDirValue(r[key])));

  const { jsPDF } = window.jspdf;
  const wide = dataTableColumns.length > 5;
  const docPdf = new jsPDF({ orientation: wide ? "landscape" : "portrait" });

  docPdf.setFontSize(13);
  docPdf.text("Batchmate Data", 14, 15);
  docPdf.setFontSize(9);
  const filterNote = dataTableFilter.key && dataTableFilter.values.length
    ? `Filtered: ${humanizeKey(dataTableFilter.key)} = ${dataTableFilter.values.join(" or ")}`
    : "All records";
  docPdf.text(`${filterNote} · ${rows.length} row(s) · ${new Date().toLocaleDateString()}`, 14, 21);

  docPdf.autoTable({
    head,
    body,
    startY: 26,
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [76, 141, 255] },
    margin: { left: 10, right: 10 }
  });

  docPdf.save(`batchmate-data-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// Exports exactly what the Data tab table is currently showing — same
// columns/filter/sort as renderDataTablePdf above — as a downloadable
// .xlsx file. Uses SheetJS (loaded via <script> tag in admin.html), a free
// client-side library — no server, account or API key involved. The .xlsx
// file opens directly in Excel and can also be dropped straight into
// Google Sheets (File → Import), so this one export covers both.
function renderDataTableExcel() {
  if (dataTableColumns.length === 0) {
    alert("Pick at least one column first.");
    return;
  }
  if (!window.XLSX) {
    alert("Excel export isn't available right now — check your connection and try again.");
    return;
  }

  let rows = getFilteredDataTableRows();
  if (dataTableSort.key) {
    const sortKey = dataTableSort.key;
    rows = [...rows].sort((a, b) => {
      const av = formatAdminDirValue(a[sortKey]);
      const bv = formatAdminDirValue(b[sortKey]);
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      return dataTableSort.dir === "asc" ? cmp : -cmp;
    });
  }

  const header = dataTableColumns.map((key) => humanizeKey(key));
  const body = rows.map((r) => dataTableColumns.map((key) => formatAdminDirValue(r[key])));
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = dataTableColumns.map((key) => ({ wch: Math.max(humanizeKey(key).length + 2, 12) }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Batchmate Data");
  XLSX.writeFile(workbook, `batchmate-data-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function renderDataTableColumnPicker(filterTerm) {
  const list = document.getElementById("datatable-columns-list");
  list.innerHTML = "";
  const term = (filterTerm || "").trim().toLowerCase();
  const keys = dataTableFieldKeys.filter((key) =>
    !term || key.toLowerCase().includes(term) || humanizeKey(key).toLowerCase().includes(term)
  );

  if (keys.length === 0) {
    list.innerHTML = '<p class="leader-picker-empty">No matching fields.</p>';
    return;
  }

  keys.forEach((key) => {
    const row = document.createElement("label");
    row.className = "member-check-row";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = key;
    cb.checked = dataTableColumns.includes(key);
    const span = document.createElement("span");
    span.textContent = humanizeKey(key);
    row.appendChild(cb);
    row.appendChild(span);
    list.appendChild(row);
  });
}

async function initDataTablePanel() {
  const columnsBtn = document.getElementById("datatable-columns-btn");
  const refreshBtn = document.getElementById("datatable-refresh-btn");
  const columnsModal = document.getElementById("modal-datatable-columns");
  const columnsSearch = document.getElementById("datatable-columns-search");
  const applyBtn = document.getElementById("datatable-columns-apply-btn");
  const filterFieldSel = document.getElementById("datatable-filter-field");
  const filterValuesBtn = document.getElementById("datatable-filter-values-btn");
  const filterValuesModal = document.getElementById("modal-datatable-filter-values");
  const filterValuesApplyBtn = document.getElementById("datatable-filter-values-apply-btn");
  const pdfBtn = document.getElementById("datatable-pdf-btn");
  const excelBtn = document.getElementById("datatable-excel-btn");
  if (!columnsBtn || !refreshBtn || !columnsModal) return;

  dataTableColumns = loadDataTableColumns();

  async function loadData() {
    const body = document.getElementById("datatable-body");
    if (!hasAdminPerm('dataTable')) {
      if (body) body.innerHTML = "";
      const empty = document.getElementById("datatable-empty");
      if (empty) { empty.hidden = false; empty.textContent = "⚠ You don't have access to this section."; }
      return;
    }
    if (body) body.innerHTML = "";
    const snap = await getDocs(collection(db, "batchmates"));
    dataTableRows = [];
    const keySet = new Set(["fullName", "campusIndexNumber", "photoUrl"]);
    snap.forEach((docSnap) => {
      const d = { uid: docSnap.id, ...docSnap.data() };
      dataTableRows.push(d);
      Object.keys(d).forEach((k) => { if (k !== "uid") keySet.add(k); });
    });
    // Drop any previously-picked column that no longer exists on any doc.
    dataTableColumns = dataTableColumns.filter((k) => keySet.has(k));
    if (dataTableSort.key && !keySet.has(dataTableSort.key)) dataTableSort = { key: null, dir: "asc" };

    dataTableFieldKeys = Array.from(keySet).sort((a, b) => humanizeKey(a).localeCompare(humanizeKey(b)));
    dataTableRows.sort((a, b) =>
      (a.fullName || "").localeCompare(b.fullName || "", undefined, { numeric: true, sensitivity: "base" })
    );
    populateDataTableFilterField();
    refreshDataTableFilterValues();
    renderDataTable();
  }

  columnsBtn.addEventListener("click", () => {
    columnsSearch.value = "";
    renderDataTableColumnPicker("");
    columnsModal.hidden = false;
  });
  columnsSearch.addEventListener("input", () => renderDataTableColumnPicker(columnsSearch.value));
  applyBtn.addEventListener("click", () => {
    const checked = Array.from(document.querySelectorAll("#datatable-columns-list input[type=checkbox]:checked")).map((cb) => cb.value);
    // Keep existing order for columns still checked, append newly-checked ones after.
    const kept = dataTableColumns.filter((k) => checked.includes(k));
    const added = checked.filter((k) => !kept.includes(k));
    dataTableColumns = [...kept, ...added];
    saveDataTableColumns();
    if (dataTableSort.key && !dataTableColumns.includes(dataTableSort.key)) dataTableSort = { key: null, dir: "asc" };
    columnsModal.hidden = true;
    renderDataTable();
  });
  refreshBtn.addEventListener("click", loadData);
  if (pdfBtn) pdfBtn.addEventListener("click", renderDataTablePdf);
  if (excelBtn) excelBtn.addEventListener("click", renderDataTableExcel);

  if (filterFieldSel) {
    filterFieldSel.addEventListener("change", () => {
      dataTableFilter = { key: filterFieldSel.value, values: [] };
      refreshDataTableFilterValues();
      renderDataTable();
    });
  }
  if (filterValuesBtn && filterValuesModal) {
    filterValuesBtn.addEventListener("click", () => {
      renderDataTableFilterValuePicker();
      filterValuesModal.hidden = false;
    });
  }
  if (filterValuesApplyBtn && filterValuesModal) {
    filterValuesApplyBtn.addEventListener("click", () => {
      const checked = Array.from(document.querySelectorAll("#datatable-filter-values-list input[type=checkbox]:checked")).map((cb) => cb.value);
      dataTableFilter.values = checked;
      refreshDataTableFilterValues();
      filterValuesModal.hidden = true;
      renderDataTable();
    });
  }

  await loadData();
}

// ── Admin: Settings Change-Request Fields (Danger tab) ──────────────
// A tick list of every field CHANGE_REQUEST_GROUPS knows about — which
// of them the Settings page's "Request to Change Details" form actually
// offers. Saves to /config/settingsFields as { enabledKeys: [...] };
// initChangeRequestSection() (Settings page) reads it via
// getSettingsEnabledKeys() and hides anything unticked here.
function initSettingsFieldsPanel() {
  const openBtn = document.querySelector('.admin-section-btn[data-modal="modal-settingsfields"]');
  const sectionsEl = document.getElementById("settingsfields-sections");
  const saveBtn = document.getElementById("settingsfields-save-btn");
  const errorEl = document.getElementById("settingsfields-error");
  const successEl = document.getElementById("settingsfields-success");
  if (!openBtn || !sectionsEl || !saveBtn || !errorEl || !successEl) return;

  openBtn.addEventListener("click", async () => {
    errorEl.hidden = true;
    successEl.hidden = true;
    sectionsEl.innerHTML = '<p class="info-text" style="color:var(--muted)">Loading…</p>';
    const enabledKeys = await getSettingsEnabledKeys(true);
    sectionsEl.innerHTML = "";
    CHANGE_REQUEST_GROUPS.forEach((group) => {
      const box = document.createElement("div");
      box.className = "fieldmgr-section";
      const title = document.createElement("p");
      title.className = "section-label";
      title.style.cssText = "margin:0 0 10px;";
      title.textContent = group.label;
      box.appendChild(title);
      group.fields.forEach((f) => {
        const row = document.createElement("label");
        row.className = "member-check-row";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = enabledKeys.has(f.key);
        checkbox.dataset.key = f.key;
        row.appendChild(checkbox);
        row.appendChild(document.createTextNode(f.label));
        box.appendChild(row);
      });
      sectionsEl.appendChild(box);
    });
  });

  saveBtn.addEventListener("click", async () => {
    if (!guardPerm('settingsFields', 'Settings Change-Request Fields')) return;
    errorEl.hidden = true;
    successEl.hidden = true;
    const checked = Array.from(sectionsEl.querySelectorAll('input[type="checkbox"]'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.dataset.key);

    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = "Saving…";
    try {
      await setDoc(doc(db, ...SETTINGS_FIELDS_DOC_PATH), { enabledKeys: checked, updatedAt: serverTimestamp() });
      settingsEnabledKeysCache = new Set(checked);
      successEl.textContent = "Saved.";
      successEl.hidden = false;
    } catch (err) {
      errorEl.textContent = "Could not save these changes — please try again.";
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
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
    getAllPrivacyMap(),
    getDirectoryFieldSchema() // warms directoryFieldSchemaCache for openBatchmateModal()
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

    const avatarSlot = buildAvatar(b.fullName, b.photoUrl);
    if (typeof b.prestigeLevel === "number") {
      const levelBadge = document.createElement("span");
      levelBadge.className = "level-badge";
      levelBadge.textContent = b.prestigeLevel;
      levelBadge.title = `${LEVEL_NAME} ${b.prestigeLevel}`;
      avatarSlot.appendChild(levelBadge);
    }
    card.appendChild(avatarSlot);

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

  const publicFields = flattenFieldGroups(directoryFieldSchemaCache || DEFAULT_DIRECTORY_FIELD_GROUPS)
    .filter((f) => f.public && f.key !== "fullName");
  fillGroup("bm-modal-fields", publicFields.map((f) => {
    const raw = b[f.key];
    return [f.label || f.key, Array.isArray(raw) ? raw.join(", ") : raw];
  }));

  const levelPill = document.getElementById("bm-modal-level-pill");
  if (levelPill) {
    if (typeof b.prestigeLevel === "number") {
      levelPill.textContent = `${LEVEL_NAME} • ${b.prestigeLevel}`;
      levelPill.hidden = false;
    } else {
      levelPill.hidden = true;
    }
  }

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

// ══ Timetable + Attendance ═══════════════════════════════════════
// Two collections: timetableSlots (the recurring weekly schedule —
// module, dayOfWeek 0-6, startTime/endTime "HH:MM", lecturer, venue,
// color, startDate) and timetableOverrides (a one-off change to a
// single occurrence, keyed by slotId + that occurrence's original
// date — can override any field, move the occurrence to a different
// date, or cancel it outright, without touching the recurring slot).
// attendance holds one doc per student per occurrence
// (`${uid}_${slotId}_${date}`); its mere existence means "present".

const TT_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ttPad(n) { return String(n).padStart(2, "0"); }

// Local (not UTC) YYYY-MM-DD for a Date object — avoids the timezone
// day-shift that toISOString() would introduce.
function ttDateStr(d) {
  return `${d.getFullYear()}-${ttPad(d.getMonth() + 1)}-${ttPad(d.getDate())}`;
}
function ttToday() { return ttDateStr(new Date()); }
function ttAddDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return ttDateStr(dt);
}
function ttDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
function ttFormatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function ttFormatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "short" });
}

let ttSlotsCache = null;
let ttOverridesCache = null;
async function fetchTimetableData(forceRefresh) {
  if (ttSlotsCache && ttOverridesCache && !forceRefresh) {
    return { slots: ttSlotsCache, overrides: ttOverridesCache };
  }
  const [slotsSnap, overridesSnap] = await Promise.all([
    getDocs(collection(db, "timetableSlots")),
    getDocs(collection(db, "timetableOverrides"))
  ]);
  ttSlotsCache = [];
  slotsSnap.forEach((d) => ttSlotsCache.push({ id: d.id, ...d.data() }));
  ttOverridesCache = [];
  overridesSnap.forEach((d) => ttOverridesCache.push({ id: d.id, ...d.data() }));
  return { slots: ttSlotsCache, overrides: ttOverridesCache };
}

// Builds every class occurrence falling between startDateStr and
// endDateStr (inclusive), applying overrides (field changes, moves,
// cancellations). Returns a flat array sorted by date then startTime,
// each item: {date, slotId, module, startTime, endTime, lecturer,
// venue, color, cancelled, moved, note}.
function ttBuildOccurrences(slots, overrides, startDateStr, endDateStr) {
  const overrideByKey = new Map();
  overrides.forEach((o) => overrideByKey.set(`${o.slotId}_${o.date}`, o));

  const occurrences = [];

  // Natural weekly occurrences, minus ones cancelled or moved away.
  let cursor = startDateStr;
  while (cursor <= endDateStr) {
    const dow = ttDayOfWeek(cursor);
    slots.forEach((slot) => {
      if (Number(slot.dayOfWeek) !== dow) return;
      if (slot.startDate && cursor < slot.startDate) return;
      const ov = overrideByKey.get(`${slot.id}_${cursor}`);
      if (ov && ov.newDate && ov.newDate !== cursor) return; // moved away — added below instead
      if (ov && ov.cancelled) {
        occurrences.push({
          date: cursor, slotId: slot.id,
          module: slot.module, startTime: slot.startTime, endTime: slot.endTime,
          lecturer: slot.lecturer, venue: slot.venue, color: slot.color,
          cancelled: true, moved: false, note: ov.note || ""
        });
        return;
      }
      occurrences.push({
        date: cursor, slotId: slot.id,
        module: (ov && ov.module) || slot.module,
        startTime: (ov && ov.startTime) || slot.startTime,
        endTime: (ov && ov.endTime) || slot.endTime,
        lecturer: (ov && ov.lecturer) || slot.lecturer,
        venue: (ov && ov.venue) || slot.venue,
        color: slot.color,
        cancelled: false, moved: false,
        note: (ov && ov.note) || ""
      });
    });
    cursor = ttAddDays(cursor, 1);
  }

  // Occurrences moved INTO this range from a different original date.
  overrides.forEach((ov) => {
    if (!ov.newDate || ov.newDate < startDateStr || ov.newDate > endDateStr) return;
    const slot = slots.find((s) => s.id === ov.slotId);
    if (!slot) return;
    occurrences.push({
      date: ov.newDate, slotId: slot.id,
      module: ov.module || slot.module,
      startTime: ov.startTime || slot.startTime,
      endTime: ov.endTime || slot.endTime,
      lecturer: ov.lecturer || slot.lecturer,
      venue: ov.venue || slot.venue,
      color: slot.color,
      cancelled: false, moved: true,
      note: ov.note || `Moved from ${ttFormatDateLabel(ov.date)}`
    });
  });

  occurrences.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  return occurrences;
}

// Same generation logic, but bounded to [slot.startDate, today] and
// used only to compute "how many times was this slot legitimately
// scheduled so far" for the attendance percentage.
function ttOccurrencesToDate(slot, overrides) {
  const today = ttToday();
  const from = slot.startDate && slot.startDate > "2000-01-01" ? slot.startDate : today;
  if (from > today) return [];
  return ttBuildOccurrences([slot], overrides, from, today).filter((o) => !o.cancelled);
}

async function initTimetablePage(user) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const content = document.getElementById("timetable-content");

  try {
    const { slots, overrides } = await fetchTimetableData();

    const today = ttToday();
    const thisWeekStart = today;
    const thisWeekEnd = ttAddDays(today, 6);
    const nextWeekStart = ttAddDays(today, 7);
    const nextWeekEnd = ttAddDays(today, 13);

    // Which attendance docs already exist for this user, for the dates
    // we're about to render (this week only — attendance can only be
    // marked for today anyway, but we still need to know today's state).
    const attendSnap = await getDocs(query(collection(db, "attendance"), where("uid", "==", user.uid)));
    const myAttendance = new Set();
    attendSnap.forEach((d) => myAttendance.add(`${d.data().slotId}_${d.data().date}`));

    renderTtWeek("tt-week-days", ttBuildOccurrences(slots, overrides, thisWeekStart, thisWeekEnd), today, myAttendance, user.uid);
    renderTtWeek("tt-next-days", ttBuildOccurrences(slots, overrides, nextWeekStart, nextWeekEnd), today, myAttendance, user.uid);
    renderMyAttendance(slots, overrides, myAttendance);

    wireTtTabs();

    loadingState.hidden = true;
    content.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load the timetable. Please try again later.";
  }
}

function wireTtTabs() {
  const tabs = document.getElementById("tt-tabs");
  if (!tabs || tabs.dataset.wired) return;
  tabs.dataset.wired = "1";
  const views = {
    week: document.getElementById("tt-view-week"),
    next: document.getElementById("tt-view-next"),
    attendance: document.getElementById("tt-view-attendance")
  };
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tt-tab-pill");
    if (!btn) return;
    tabs.querySelectorAll(".tt-tab-pill").forEach((b) => b.classList.toggle("active", b === btn));
    Object.entries(views).forEach(([key, el]) => { el.hidden = key !== btn.dataset.ttView; });
  });
}

// Groups a flat occurrence list by date and renders one day-block per
// date in range, oldest first, each with its own card list. Days with
// nothing scheduled still get a heading + an empty-state line, so the
// week reads as complete rather than looking broken.
function renderTtWeek(containerId, occurrences, today, myAttendance, uid) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const byDate = new Map();
  occurrences.forEach((o) => {
    if (!byDate.has(o.date)) byDate.set(o.date, []);
    byDate.get(o.date).push(o);
  });

  const dates = Array.from(byDate.keys()).sort();
  if (dates.length === 0 && occurrences.length === 0) {
    // Still show 7 empty day headings so the week isn't just blank —
    // fall through to the loop below with whatever dates exist.
  }

  // Ensure every date in the visible span shows up even with 0 classes.
  // The caller already generated only in-range dates for occurrences,
  // so we reconstruct the span from the first/last occurrence date if
  // present, otherwise just render nothing extra.
  const allDates = dates.length ? dates : [];

  const block = document.createElement("div");
  allDates.forEach((dateStr) => {
    const dayBlock = document.createElement("div");
    dayBlock.className = "tt-day-block";

    const heading = document.createElement("p");
    const isToday = dateStr === today;
    heading.className = "tt-day-heading" + (isToday ? " tt-day-today" : "");
    const label = isToday ? "Today" : (dateStr === ttAddDays(today, 1) ? "Tomorrow" : TT_DAY_NAMES[ttDayOfWeek(dateStr)]);
    heading.innerHTML = `${label} <span class="tt-day-date">${ttFormatDateLabel(dateStr)}</span>`;
    dayBlock.appendChild(heading);

    const list = document.createElement("div");
    list.className = "tt-card-list";
    const dayItems = byDate.get(dateStr) || [];

    if (dayItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "tt-empty-day";
      empty.textContent = "No classes scheduled.";
      list.appendChild(empty);
    } else {
      dayItems.forEach((o) => list.appendChild(buildTtCard(o, isToday, myAttendance, uid)));
    }

    dayBlock.appendChild(list);
    block.appendChild(dayBlock);
  });

  if (allDates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "tt-empty-state";
    empty.textContent = "No classes scheduled for this period.";
    block.appendChild(empty);
  }

  container.appendChild(block);
}

function buildTtCard(o, isToday, myAttendance, uid) {
  const card = document.createElement("div");
  card.className = "tt-card" + (o.cancelled ? " tt-cancelled" : "");
  card.style.setProperty("--tt-color", o.color || "#4C8DFF");

  const timeCol = document.createElement("div");
  timeCol.className = "tt-card-time-col";
  timeCol.innerHTML = `<span class="tt-card-time">${ttFormatTime(o.startTime)}</span><span class="tt-card-time-end">${ttFormatTime(o.endTime)}</span>`;

  const body = document.createElement("div");
  body.className = "tt-card-body";

  const topRow = document.createElement("div");
  topRow.className = "tt-card-top-row";
  const moduleEl = document.createElement("p");
  moduleEl.className = "tt-card-module";
  moduleEl.textContent = o.module || "Untitled module";
  topRow.appendChild(moduleEl);
  if (o.cancelled) {
    const badge = document.createElement("span");
    badge.className = "tt-card-badge";
    badge.textContent = "Cancelled";
    topRow.appendChild(badge);
  } else if (o.moved) {
    const badge = document.createElement("span");
    badge.className = "tt-card-badge";
    badge.textContent = "Rescheduled";
    topRow.appendChild(badge);
  }
  body.appendChild(topRow);

  const meta = document.createElement("p");
  meta.className = "tt-card-meta";
  const lecturerEl = document.createElement("span");
  lecturerEl.textContent = `👤 ${o.lecturer || "TBA"}`;
  const venueEl = document.createElement("span");
  venueEl.textContent = `📍 ${o.venue || "TBA"}`;
  meta.appendChild(lecturerEl);
  meta.appendChild(venueEl);
  body.appendChild(meta);

  if (o.note) {
    const note = document.createElement("p");
    note.className = "tt-card-note";
    note.textContent = o.note;
    body.appendChild(note);
  }

  if (isToday && !o.cancelled) {
    const key = `${o.slotId}_${o.date}`;
    const attendBtn = document.createElement("button");
    attendBtn.type = "button";
    attendBtn.className = "tt-attend-btn" + (myAttendance.has(key) ? " marked" : "");
    attendBtn.textContent = myAttendance.has(key) ? "✓ Attended" : "Mark Attendance";
    attendBtn.addEventListener("click", async () => {
      attendBtn.disabled = true;
      try {
        if (myAttendance.has(key)) {
          await deleteDoc(doc(db, "attendance", `${uid}_${key}`));
          myAttendance.delete(key);
          attendBtn.classList.remove("marked");
          attendBtn.textContent = "Mark Attendance";
        } else {
          await setDoc(doc(db, "attendance", `${uid}_${key}`), {
            uid, slotId: o.slotId, date: o.date, module: o.module || "",
            markedAt: serverTimestamp()
          });
          myAttendance.add(key);
          attendBtn.classList.add("marked");
          attendBtn.textContent = "✓ Attended";
        }
      } catch (err) {
        // leave state as-is; button re-enables below so they can retry
      } finally {
        attendBtn.disabled = false;
      }
    });
    body.appendChild(attendBtn);
  }

  card.appendChild(timeCol);
  card.appendChild(body);
  return card;
}

// Aggregates attendance by module name (a module can have more than
// one weekly slot — e.g. lecture + lab — and both should count toward
// the same module's percentage).
function renderMyAttendance(slots, overrides, myAttendance) {
  const overallEl = document.getElementById("attend-overall-pct");
  const overallSubEl = document.getElementById("attend-overall-sub");
  const listEl = document.getElementById("attend-module-list");
  if (!listEl) return;

  const byModule = new Map(); // module -> {attended, total, color}
  slots.forEach((slot) => {
    const occ = ttOccurrencesToDate(slot, overrides);
    const key = slot.module || "Untitled module";
    if (!byModule.has(key)) byModule.set(key, { attended: 0, total: 0, color: slot.color || "#4C8DFF" });
    const entry = byModule.get(key);
    entry.total += occ.length;
    occ.forEach((o) => { if (myAttendance.has(`${o.slotId}_${o.date}`)) entry.attended += 1; });
  });

  let grandAttended = 0, grandTotal = 0;
  byModule.forEach((v) => { grandAttended += v.attended; grandTotal += v.total; });

  if (grandTotal === 0) {
    overallEl.textContent = "—";
    overallSubEl.textContent = "No classes have happened yet.";
  } else {
    const pct = Math.round((grandAttended / grandTotal) * 100);
    overallEl.textContent = `${pct}%`;
    overallSubEl.textContent = `${grandAttended} of ${grandTotal} classes attended`;
  }

  listEl.innerHTML = "";
  if (byModule.size === 0) {
    listEl.innerHTML = '<p class="info-text" style="color:var(--muted)">No timetable set up yet.</p>';
    return;
  }

  Array.from(byModule.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([module, v]) => {
      const pct = v.total > 0 ? Math.round((v.attended / v.total) * 100) : 0;
      const card = document.createElement("div");
      card.className = "attend-stat-card";
      card.style.setProperty("--tt-color", v.color);
      card.innerHTML = `
        <div class="attend-stat-top">
          <span class="attend-stat-module">${module}</span>
          <span class="attend-stat-pct">${v.total > 0 ? pct + "%" : "—"}</span>
        </div>
        <div class="attend-bar-track"><div class="attend-bar-fill" style="width:${pct}%"></div></div>
        <div class="attend-stat-fraction">${v.attended} of ${v.total} classes</div>
      `;
      listEl.appendChild(card);
    });
}

// ── Admin: Timetable management ─────────────────────────────────
function initTimetableForm() {
  const form = document.getElementById("form-timetable");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";
  const errorEl = document.getElementById("tt-error");
  const successEl = document.getElementById("tt-success");
  const btn = form.querySelector("button[type=submit]");
  const originalLabel = btn.textContent;
  document.getElementById("tt-startdate").value = ttToday();

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('timetable', 'Add Timetable Slot')) return;
    e.preventDefault();
    errorEl.hidden = true;
    successEl.hidden = true;
    btn.disabled = true;
    btn.textContent = "Adding…";
    try {
      await addDoc(collection(db, "timetableSlots"), {
        module: document.getElementById("tt-module").value.trim(),
        dayOfWeek: Number(document.getElementById("tt-day").value),
        startTime: document.getElementById("tt-start").value,
        endTime: document.getElementById("tt-end").value,
        lecturer: document.getElementById("tt-lecturer").value.trim(),
        venue: document.getElementById("tt-venue").value.trim(),
        color: document.getElementById("tt-color").value,
        startDate: document.getElementById("tt-startdate").value
      });
      successEl.textContent = "Timetable slot added.";
      successEl.hidden = false;
      form.reset();
      document.getElementById("tt-startdate").value = ttToday();
      ttSlotsCache = null;
      await renderAdminTimetable();
    } catch (err) {
      errorEl.textContent = "Could not add this slot — check the fields and try again.";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  });
}

async function renderAdminTimetable() {
  const container = document.getElementById("admin-timetable-list");
  if (!container) return;
  container.innerHTML = "Loading…";

  const { slots } = await fetchTimetableData(true);

  if (slots.length === 0) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No timetable slots yet.</p>';
    return;
  }

  slots.sort((a, b) => (Number(a.dayOfWeek) - Number(b.dayOfWeek)) || (a.startTime || "").localeCompare(b.startTime || ""));

  container.innerHTML = "";
  slots.forEach((slot) => {
    const box = document.createElement("div");
    box.className = "admin-tt-box";
    box.style.setProperty("--tt-color", slot.color || "#4C8DFF");
    box.innerHTML = `
      <div class="admin-tt-top">
        <span class="admin-tt-name"><span class="tt-color-dot" style="background:${slot.color || "#4C8DFF"}"></span>${slot.module || "Untitled module"}</span>
      </div>
      <div class="admin-tt-meta">${TT_DAY_NAMES[Number(slot.dayOfWeek)] || ""} · ${ttFormatTime(slot.startTime)}–${ttFormatTime(slot.endTime)} · ${slot.lecturer || "TBA"} · ${slot.venue || "TBA"}</div>
    `;
    const actions = document.createElement("div");
    actions.className = "admin-tt-actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => openTimetableEditModal(slot));
    const overrideBtn = document.createElement("button");
    overrideBtn.type = "button";
    overrideBtn.textContent = "Override a Date";
    overrideBtn.addEventListener("click", () => openTimetableOverrideModal(slot));
    actions.appendChild(editBtn);
    actions.appendChild(overrideBtn);
    box.appendChild(actions);
    container.appendChild(box);
  });
}

function openTimetableEditModal(slot) {
  if (!guardPerm('timetable', 'Edit Timetable')) return;
  document.getElementById("ttedit-id").value = slot.id;
  document.getElementById("ttedit-module").value = slot.module || "";
  document.getElementById("ttedit-day").value = String(slot.dayOfWeek);
  document.getElementById("ttedit-start").value = slot.startTime || "";
  document.getElementById("ttedit-end").value = slot.endTime || "";
  document.getElementById("ttedit-lecturer").value = slot.lecturer || "";
  document.getElementById("ttedit-venue").value = slot.venue || "";
  document.getElementById("ttedit-color").value = slot.color || "#4C8DFF";
  document.getElementById("ttedit-startdate").value = slot.startDate || ttToday();
  document.getElementById("ttedit-error").hidden = true;
  document.getElementById("ttedit-success").hidden = true;
  document.getElementById("modal-timetable-edit").hidden = false;
}

function wireTimetableEditModal() {
  const form = document.getElementById("form-timetable-edit");
  const deleteBtn = document.getElementById("ttedit-delete-btn");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('timetable', 'Edit Timetable')) return;
    e.preventDefault();
    const id = document.getElementById("ttedit-id").value;
    const errorEl = document.getElementById("ttedit-error");
    const successEl = document.getElementById("ttedit-success");
    errorEl.hidden = true;
    successEl.hidden = true;
    try {
      await updateDoc(doc(db, "timetableSlots", id), {
        module: document.getElementById("ttedit-module").value.trim(),
        dayOfWeek: Number(document.getElementById("ttedit-day").value),
        startTime: document.getElementById("ttedit-start").value,
        endTime: document.getElementById("ttedit-end").value,
        lecturer: document.getElementById("ttedit-lecturer").value.trim(),
        venue: document.getElementById("ttedit-venue").value.trim(),
        color: document.getElementById("ttedit-color").value,
        startDate: document.getElementById("ttedit-startdate").value
      });
      successEl.textContent = "Slot updated.";
      successEl.hidden = false;
      ttSlotsCache = null;
      await renderAdminTimetable();
      setTimeout(() => { document.getElementById("modal-timetable-edit").hidden = true; }, 700);
    } catch (err) {
      errorEl.textContent = "Could not save changes. Please try again.";
      errorEl.hidden = false;
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const id = document.getElementById("ttedit-id").value;
    if (!id) return;
    if (!confirm("Delete this timetable slot? This can't be undone. Any overrides tied to it will be orphaned but harmless.")) return;
    try {
      await deleteDoc(doc(db, "timetableSlots", id));
      document.getElementById("modal-timetable-edit").hidden = true;
      ttSlotsCache = null;
      await renderAdminTimetable();
    } catch (err) {
      document.getElementById("ttedit-error").textContent = "Could not delete this slot. Please try again.";
      document.getElementById("ttedit-error").hidden = false;
    }
  });
}

function openTimetableOverrideModal(slot) {
  document.getElementById("ttoverride-slotid").value = slot.id;
  document.getElementById("ttoverride-slot-label").textContent =
    `${slot.module || "Untitled module"} — every ${TT_DAY_NAMES[Number(slot.dayOfWeek)]}, ${ttFormatTime(slot.startTime)}–${ttFormatTime(slot.endTime)}`;
  document.getElementById("form-timetable-override").reset();
  document.getElementById("ttoverride-date").value = ttToday();
  document.getElementById("ttoverride-error").hidden = true;
  document.getElementById("ttoverride-success").hidden = true;
  renderExistingOverrides(slot.id);
  document.getElementById("modal-timetable-override").hidden = false;
}

function renderExistingOverrides(slotId) {
  const listEl = document.getElementById("ttoverride-existing-list");
  const existing = (ttOverridesCache || []).filter((o) => o.slotId === slotId);
  if (existing.length === 0) {
    listEl.innerHTML = '<p class="info-text" style="color:var(--muted); font-size:12px;">None yet.</p>';
    return;
  }
  existing.sort((a, b) => a.date.localeCompare(b.date));
  listEl.innerHTML = "";
  existing.forEach((o) => {
    const row = document.createElement("div");
    row.className = "admin-tt-override-item";
    const desc = o.cancelled ? "Cancelled" : (o.newDate ? `Moved to ${ttFormatDateLabel(o.newDate)}` : "Changed details");
    row.innerHTML = `<span>${ttFormatDateLabel(o.date)} — ${desc}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.className = "ghost-btn";
    removeBtn.style.cssText = "padding:4px 10px; font-size:11px;";
    removeBtn.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "timetableOverrides", o.id));
        ttOverridesCache = null;
        await fetchTimetableData(true);
        renderExistingOverrides(slotId);
      } catch (err) { /* leave the row as-is on failure */ }
    });
    row.appendChild(removeBtn);
    listEl.appendChild(row);
  });
}

function wireTimetableOverrideModal() {
  const form = document.getElementById("form-timetable-override");
  const cancelCheckbox = document.getElementById("ttoverride-cancel");
  const fieldsWrap = document.getElementById("ttoverride-fields");
  if (!form || form.dataset.wired) return;
  form.dataset.wired = "1";

  cancelCheckbox.addEventListener("change", () => {
    fieldsWrap.style.display = cancelCheckbox.checked ? "none" : "";
  });

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('timetable', 'Timetable Override')) return;
    e.preventDefault();
    const slotId = document.getElementById("ttoverride-slotid").value;
    const date = document.getElementById("ttoverride-date").value;
    const errorEl = document.getElementById("ttoverride-error");
    const successEl = document.getElementById("ttoverride-success");
    errorEl.hidden = true;
    successEl.hidden = true;
    if (!slotId || !date) return;

    const data = {
      slotId, date,
      cancelled: cancelCheckbox.checked,
      module: document.getElementById("ttoverride-module").value.trim(),
      startTime: document.getElementById("ttoverride-start").value,
      endTime: document.getElementById("ttoverride-end").value,
      lecturer: document.getElementById("ttoverride-lecturer").value.trim(),
      venue: document.getElementById("ttoverride-venue").value.trim(),
      newDate: document.getElementById("ttoverride-newdate").value || null,
      note: document.getElementById("ttoverride-note").value.trim()
    };

    try {
      await setDoc(doc(db, "timetableOverrides", `${slotId}_${date}`), data);
      successEl.textContent = "Override saved.";
      successEl.hidden = false;
      ttOverridesCache = null;
      await fetchTimetableData(true);
      renderExistingOverrides(slotId);
    } catch (err) {
      errorEl.textContent = "Could not save this override — check the fields and try again.";
      errorEl.hidden = false;
    }
  });
}

// ══ Admin: Database Storage estimate ═════════════════════════════
// The Firestore client SDK has no API for actual billed storage —
// that number only lives in the Firebase Console / Cloud Monitoring,
// reachable via the Admin SDK or gcloud, not from a signed-in user's
// browser. This instead reads every collection the site uses and
// sizes each document the same way Firestore's own storage-size
// formula works (documented under "Understanding Cloud Firestore
// billing"): a fixed per-document overhead, plus each field's name
// and value encoded by type. It deliberately excludes index storage
// (Firestore automatically indexes most fields, and that costs extra
// space on top of the raw data) — so it undercounts the real billed
// total, but tracks it closely enough to spot growth over time or
// see which collection is the heaviest.
//
// Note: /admins is left out of the scan on purpose. Its Firestore
// rule only lets an admin read their OWN doc there (self-uid only,
// not "any admin"), so a collection-wide query against it would
// silently return just 1 document regardless of how many admins
// actually exist — including it would make the total look right but
// be quietly wrong. Every other collection's rules give an admin a
// full-collection read, so those are all measured completely.
const DB_STORAGE_COLLECTIONS = [
  "batchmates", "batchmatesPublic", "changeRequests", "fundTransactions",
  "announcements", "groupProjects", "wallOfFame",
  "events", "eventLabels", "badges", "badgeAssignments", "tasks",
  "directoryPrivacy", "pushSubscriptions", "prestigeLog", "groupProjectRatings",
  "config", "timetableSlots", "timetableOverrides", "attendance"
];

const dbTextEncoder = new TextEncoder();
function dbUtf8Len(str) { return dbTextEncoder.encode(String(str)).length; }

function dbValueSize(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === "boolean") return 1;
  if (typeof value === "number") return 8; // Firestore treats both integer and double as 8 bytes
  if (typeof value === "string") return dbUtf8Len(value) + 1;
  if (typeof value.toDate === "function" || (typeof value.seconds === "number" && typeof value.nanoseconds === "number")) {
    return 8; // Firestore Timestamp (serverTimestamp() results land here)
  }
  if (Array.isArray(value)) return value.reduce((sum, v) => sum + dbValueSize(v), 0);
  if (typeof value === "object") {
    // Map value: same per-field accounting as a document, plus a
    // smaller fixed overhead than a top-level document gets.
    return 16 + Object.entries(value).reduce((sum, [k, v]) => sum + dbFieldSize(k, v), 0);
  }
  return 8; // fallback for anything unrecognized
}
function dbFieldSize(name, value) { return 1 + dbUtf8Len(name) + dbValueSize(value); }
function dbDocSize(path, data) {
  let size = 32 + dbUtf8Len(path); // fixed per-document overhead + resource path
  Object.entries(data || {}).forEach(([k, v]) => { size += dbFieldSize(k, v); });
  return size;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function initDbStoragePanel() {
  const scanBtn = document.getElementById("dbstorage-scan-btn");
  if (!scanBtn || scanBtn.dataset.wired) return;
  scanBtn.dataset.wired = "1";
  scanBtn.addEventListener("click", runDbStorageScan);
}

async function runDbStorageScan() {
  if (!guardPerm('dbStorage', 'Database Storage')) return;
  const scanBtn = document.getElementById("dbstorage-scan-btn");
  const statusEl = document.getElementById("dbstorage-status");
  const resultsEl = document.getElementById("dbstorage-results");
  const totalEl = document.getElementById("dbstorage-total");
  const barFill = document.getElementById("dbstorage-bar-fill");
  const barLabel = document.getElementById("dbstorage-bar-label");

  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";
  statusEl.hidden = true;
  resultsEl.innerHTML = "";

  try {
    const rows = [];
    let grandTotal = 0;

    for (const colName of DB_STORAGE_COLLECTIONS) {
      const snap = await getDocs(collection(db, colName));
      let colBytes = 0;
      snap.forEach((d) => { colBytes += dbDocSize(`${colName}/${d.id}`, d.data()); });
      rows.push({ name: colName, count: snap.size, bytes: colBytes });
      grandTotal += colBytes;
    }

    rows.sort((a, b) => b.bytes - a.bytes);
    resultsEl.innerHTML = "";
    rows.forEach((r) => {
      const row = document.createElement("div");
      row.className = "admin-detail-row";
      row.innerHTML = `<span class="admin-detail-label">${r.name} <span style="color:var(--muted);">(${r.count} doc${r.count === 1 ? "" : "s"})</span></span><span class="admin-detail-value">${formatBytes(r.bytes)}</span>`;
      resultsEl.appendChild(row);
    });

    totalEl.textContent = formatBytes(grandTotal);
    const FREE_TIER_BYTES = 1024 * 1024 * 1024; // Firestore Spark plan: 1 GiB stored
    const pctOfFree = (grandTotal / FREE_TIER_BYTES) * 100;
    barFill.style.width = `${Math.min(100, pctOfFree)}%`;
    barLabel.textContent = `${pctOfFree < 0.01 ? "<0.01" : pctOfFree.toFixed(2)}% of Firestore's 1 GiB free-tier storage (data only, not counting indexes)`;
  } catch (err) {
    statusEl.textContent = "Could not complete the scan — a collection may have failed to read. Try again.";
    statusEl.hidden = false;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "Scan Now";
  }
}

// ══ Requests (batchmates ↔ admins) ═══════════════════════════════
// memberRequests/{id}: a formal message from a batchmate to admins
// (requesterUid, requesterName, anonymous, visibility "public"/
// "private", subject, message, status "pending"/"completed"/
// "rejected"/"dropped", createdAt, resolvedAt, resolvedNote,
// agreeCount, disagreeCount). Security rules already filter list
// queries down to what each viewer is allowed to see (public, their
// own, or — for an admin — everything), so a plain getDocs() over
// the whole collection returns exactly the right set.
// memberRequests/{id}/votes/{uid}: one doc per voter, {choice,
// votedAt} — its mere existence + choice is the vote; agreeCount/
// disagreeCount on the parent are the denormalized totals, kept in
// sync via writeBatch() + increment() so any signed-in batchmate can
// update just those two fields without touching anything else.

let reqCurrentUser = null;
let reqIsAdmin = false;
let reqMyFullName = "";

async function initRequestsPage(user, isAdmin) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const content = document.getElementById("requests-content");
  reqCurrentUser = user;
  reqIsAdmin = isAdmin;

  try {
    const bmSnap = await getDoc(doc(db, "batchmates", user.uid));
    reqMyFullName = bmSnap.exists() ? (bmSnap.data().fullName || "") : "";

    wireNewRequestModal();
    wireResolveModal();
    await renderRequestsList();

    loadingState.hidden = true;
    content.hidden = false;
  } catch (err) {
    loadingState.hidden = true;
    errorState.hidden = false;
    errorState.textContent = "Could not load requests. Please try again later.";
  }
}

function wireNewRequestModal() {
  const openBtn = document.getElementById("req-open-new");
  const overlay = document.getElementById("modal-request");
  const closeBtn = document.getElementById("req-modal-close");
  const form = document.getElementById("form-request");
  const errorEl = document.getElementById("req-error");
  if (openBtn.dataset.wired) return;
  openBtn.dataset.wired = "1";

  function closeModal() { overlay.hidden = true; }
  openBtn.addEventListener("click", () => {
    form.reset();
    errorEl.hidden = true;
    overlay.hidden = false;
  });
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const submitBtn = form.querySelector("button[type=submit]");
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    try {
      const visibility = document.querySelector('input[name="req-visibility"]:checked').value;
      const anonymous = document.querySelector('input[name="req-identity"]:checked').value === "anonymous";
      await addDoc(collection(db, "memberRequests"), {
        requesterUid: reqCurrentUser.uid,
        requesterName: reqMyFullName || "",
        anonymous,
        visibility,
        subject: document.getElementById("req-subject").value.trim(),
        message: document.getElementById("req-message").value.trim(),
        status: "pending",
        createdAt: serverTimestamp(),
        resolvedAt: null,
        resolvedNote: "",
        notifiedAt: null,
        agreeCount: 0,
        disagreeCount: 0
      });
      closeModal();
      await renderRequestsList();
    } catch (err) {
      errorEl.textContent = "Could not send your request. Please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

async function renderRequestsList() {
  const pendingList = document.getElementById("req-pending-list");
  const resolvedList = document.getElementById("req-resolved-list");
  pendingList.innerHTML = "Loading…";
  resolvedList.innerHTML = "";

  // An admin's Firestore rule allows a plain read of the whole
  // collection, but a normal batchmate's rule is per-document
  // (visibility == "public" OR they're the requester) — Firestore
  // rejects an unfiltered collection query for them outright, since it
  // can't prove every possible result satisfies the rule, which is what
  // was keeping this page from ever loading for non-admins. So a
  // non-admin instead runs two scoped queries — public requests, and
  // their own regardless of visibility — and the results are merged.
  const all = [];
  if (reqIsAdmin) {
    const snap = await getDocs(collection(db, "memberRequests"));
    snap.forEach((d) => all.push({ id: d.id, ...d.data() }));
  } else {
    const publicQ = query(collection(db, "memberRequests"), where("visibility", "==", "public"));
    const mineQ = query(collection(db, "memberRequests"), where("requesterUid", "==", reqCurrentUser.uid));
    const [publicSnap, mineSnap] = await Promise.all([getDocs(publicQ), getDocs(mineQ)]);
    const seen = new Set();
    publicSnap.forEach((d) => { seen.add(d.id); all.push({ id: d.id, ...d.data() }); });
    mineSnap.forEach((d) => { if (!seen.has(d.id)) all.push({ id: d.id, ...d.data() }); });
  }
  all.sort((a, b) => {
    const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });

  const pending = all.filter((r) => r.status === "pending");
  const resolved = all.filter((r) => r.status !== "pending");

  // My own vote choice per pending request — bounded to what's
  // actually being rendered, not the whole history.
  const myVotes = new Map();
  await Promise.all(pending.map(async (r) => {
    try {
      const voteSnap = await getDoc(doc(db, "memberRequests", r.id, "votes", reqCurrentUser.uid));
      if (voteSnap.exists()) myVotes.set(r.id, voteSnap.data().choice);
    } catch (err) { /* no vote yet — leave unset */ }
  }));

  pendingList.innerHTML = "";
  if (pending.length === 0) {
    pendingList.innerHTML = '<p class="req-empty">No pending requests right now.</p>';
  } else {
    pending.forEach((r) => pendingList.appendChild(buildRequestCard(r, myVotes.get(r.id))));
  }

  resolvedList.innerHTML = "";
  if (resolved.length === 0) {
    resolvedList.innerHTML = '<p class="req-empty">Nothing resolved yet.</p>';
  } else {
    resolved.forEach((r) => resolvedList.appendChild(buildRequestCard(r, null)));
  }
}

function buildRequestCard(r, myVote) {
  const card = document.createElement("div");
  card.className = "req-card" + (r.status !== "pending" ? " req-resolved" : "");

  const badges = document.createElement("div");
  badges.className = "req-badges";
  if (r.visibility === "private") {
    const b = document.createElement("span");
    b.className = "req-badge private";
    b.textContent = "🔒 Admins Only";
    badges.appendChild(b);
  }
  if (r.status !== "pending") {
    const b = document.createElement("span");
    b.className = `req-badge status-${r.status}`;
    b.textContent = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    badges.appendChild(b);
  }
  if (badges.children.length) card.appendChild(badges);

  const subject = document.createElement("p");
  subject.className = "req-subject";
  subject.textContent = r.subject || "Untitled request";
  card.appendChild(subject);

  const meta = document.createElement("p");
  meta.className = "req-meta";
  const when = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString("en-US", { dateStyle: "medium" }) : "";
  if (r.anonymous && reqIsAdmin) {
    // Anonymous to other batchmates, but an admin still needs to know
    // who to actually help — shown only to them, never in the public list.
    meta.textContent = `by Anonymous${when ? " · " + when : ""} — `;
    const hint = document.createElement("span");
    hint.className = "req-meta-admin-hint";
    hint.textContent = `really ${r.requesterName || "unknown"} (visible to admins only)`;
    meta.appendChild(hint);
  } else {
    const who = r.anonymous ? "Anonymous" : (r.requesterName || "A batchmate");
    meta.textContent = `by ${who}${when ? " · " + when : ""}`;
  }
  card.appendChild(meta);

  const message = document.createElement("p");
  message.className = "req-message";
  message.textContent = r.message || "";
  card.appendChild(message);

  if (r.status !== "pending" && r.resolvedNote) {
    const note = document.createElement("p");
    note.className = "req-resolved-note";
    note.textContent = `Admin note: ${r.resolvedNote}`;
    card.appendChild(note);
  }

  const voteRow = document.createElement("div");
  voteRow.className = "req-vote-row";
  const agreeBtn = document.createElement("button");
  agreeBtn.type = "button";
  agreeBtn.className = "req-vote-btn agree" + (myVote === "agree" ? " mine" : "");
  agreeBtn.textContent = `👍 Agree (${r.agreeCount || 0})`;
  const disagreeBtn = document.createElement("button");
  disagreeBtn.type = "button";
  disagreeBtn.className = "req-vote-btn disagree" + (myVote === "disagree" ? " mine" : "");
  disagreeBtn.textContent = `👎 Disagree (${r.disagreeCount || 0})`;

  if (r.status !== "pending") {
    agreeBtn.disabled = true;
    disagreeBtn.disabled = true;
  } else {
    agreeBtn.addEventListener("click", () => castRequestVote(r.id, "agree", agreeBtn, disagreeBtn));
    disagreeBtn.addEventListener("click", () => castRequestVote(r.id, "disagree", agreeBtn, disagreeBtn));
  }
  voteRow.appendChild(agreeBtn);
  voteRow.appendChild(disagreeBtn);
  card.appendChild(voteRow);

  if (r.requesterUid === reqCurrentUser.uid) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "req-delete-btn";
    delBtn.textContent = "Delete this request";
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this request? This can't be undone.")) return;
      try {
        await deleteDoc(doc(db, "memberRequests", r.id));
        await renderRequestsList();
      } catch (err) { /* leave card as-is on failure */ }
    });
    card.appendChild(delBtn);
  }

  // Notifying the whole batch is an admin-only action, and only makes
  // sense for a public request (a private one is admins-only anyway).
  // Batchmates themselves have no way to broadcast to everyone — this
  // button is the only path, and it's deliberately manual, not automatic
  // on submit, so admins decide which requests are worth the ping.
  if (reqIsAdmin && r.visibility === "public" && r.status === "pending") {
    const notifyRow = document.createElement("div");
    notifyRow.className = "req-notify-row";
    const notifyBtn = document.createElement("button");
    notifyBtn.type = "button";
    notifyBtn.className = "req-notify-btn";
    const notifiedWhen = r.notifiedAt && r.notifiedAt.toDate
      ? r.notifiedAt.toDate().toLocaleDateString("en-US", { dateStyle: "medium" })
      : null;
    notifyBtn.textContent = notifiedWhen ? "🔔 Notify Again" : "🔔 Notify Everyone";
    notifyBtn.addEventListener("click", () => notifyAboutRequest(r.id, r.subject, notifyBtn));
    notifyRow.appendChild(notifyBtn);
    if (notifiedWhen) {
      const notifiedNote = document.createElement("span");
      notifiedNote.className = "req-notified-note";
      notifiedNote.textContent = `Last notified ${notifiedWhen}`;
      notifyRow.appendChild(notifiedNote);
    }
    card.appendChild(notifyRow);
  }

  if (reqIsAdmin && r.status === "pending") {
    const actions = document.createElement("div");
    actions.className = "req-admin-actions";
    [["Mark Completed", "completed", ""], ["Reject", "rejected", "req-reject-btn"], ["Drop", "dropped", "req-drop-btn"]]
      .forEach(([label, status, cls]) => {
        const btn = document.createElement("button");
        btn.type = "button";
        if (cls) btn.className = cls;
        btn.textContent = label;
        btn.addEventListener("click", () => openResolveModal(r.id, status, r.subject));
        actions.appendChild(btn);
      });
    card.appendChild(actions);
  }

  return card;
}

async function notifyAboutRequest(reqId, subject, btn) {
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Sending…";
  try {
    await sendPushNotification({
      type: "memberRequests",
      title: "New batch request",
      message: subject || "A batchmate posted a new request — check it out.",
      url: "requests.html"
    });
    await updateDoc(doc(db, "memberRequests", reqId), { notifiedAt: serverTimestamp() });
    await renderRequestsList();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function castRequestVote(reqId, choice, agreeBtn, disagreeBtn) {
  agreeBtn.disabled = true;
  disagreeBtn.disabled = true;
  const voteRef = doc(db, "memberRequests", reqId, "votes", reqCurrentUser.uid);
  const reqRef = doc(db, "memberRequests", reqId);
  try {
    const existing = await getDoc(voteRef);
    const prevChoice = existing.exists() ? existing.data().choice : null;
    const batch = writeBatch(db);

    if (prevChoice === choice) {
      batch.delete(voteRef);
      batch.update(reqRef, { [`${choice}Count`]: increment(-1) });
    } else if (prevChoice) {
      batch.set(voteRef, { choice, votedAt: serverTimestamp() });
      batch.update(reqRef, {
        [`${prevChoice}Count`]: increment(-1),
        [`${choice}Count`]: increment(1)
      });
    } else {
      batch.set(voteRef, { choice, votedAt: serverTimestamp() });
      batch.update(reqRef, { [`${choice}Count`]: increment(1) });
    }
    await batch.commit();
    await renderRequestsList();
  } catch (err) {
    agreeBtn.disabled = false;
    disagreeBtn.disabled = false;
  }
}

const REQ_RESOLVE_LABELS = { completed: "Mark Completed", rejected: "Reject Request", dropped: "Drop Request" };

function openResolveModal(reqId, status, subject) {
  if (!guardPerm('memberRequests', 'Resolve Member Request')) return;
  document.getElementById("req-resolve-id").value = reqId;
  document.getElementById("req-resolve-status").value = status;
  document.getElementById("req-resolve-note").value = "";
  document.getElementById("req-resolve-error").hidden = true;
  document.getElementById("req-resolve-title").textContent = REQ_RESOLVE_LABELS[status] || "Resolve Request";
  document.getElementById("req-resolve-subject").textContent = subject || "";
  document.getElementById("req-resolve-submit-btn").textContent = REQ_RESOLVE_LABELS[status] || "Confirm";
  document.getElementById("modal-request-resolve").hidden = false;
}

function wireResolveModal() {
  const overlay = document.getElementById("modal-request-resolve");
  const closeBtn = document.getElementById("req-resolve-modal-close");
  const form = document.getElementById("form-request-resolve");
  const errorEl = document.getElementById("req-resolve-error");
  if (form.dataset.wired) return;
  form.dataset.wired = "1";

  function closeModal() { overlay.hidden = true; }
  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  form.addEventListener("submit", async (e) => {
    if (!guardPerm('memberRequests', 'Resolve Member Request')) return;
    e.preventDefault();
    errorEl.hidden = true;
    const reqId = document.getElementById("req-resolve-id").value;
    const status = document.getElementById("req-resolve-status").value;
    const note = document.getElementById("req-resolve-note").value.trim();
    const submitBtn = document.getElementById("req-resolve-submit-btn");
    submitBtn.disabled = true;
    try {
      await updateDoc(doc(db, "memberRequests", reqId), {
        status,
        resolvedAt: serverTimestamp(),
        resolvedNote: note
      });
      closeModal();
      await renderRequestsList();
    } catch (err) {
      errorEl.textContent = "Could not resolve this request. Please try again.";
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
