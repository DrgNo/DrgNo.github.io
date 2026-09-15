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
  query,
  where,
  orderBy,
  arrayUnion
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
const PUSH_WORKER_URL = " https://batchportal-push.batchportal-push.workers.dev";
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

  function openMenu() { sidebar.classList.add("open"); overlay.classList.add("show"); }
  function closeMenu() { sidebar.classList.remove("open"); overlay.classList.remove("show"); }
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

// Interactive checklist for the top-of-dashboard "Active Tasks" card.
// Tapping the checkbox on an "ongoing" task marks it "pending" — awaiting
// the admin's verification — at which point it shows as waiting, disabled.
function renderActiveTasksCard(tasks) {
  const list = document.getElementById("active-tasks-list");
  list.innerHTML = "";

  const active = tasks.filter((t) => t.status !== "complete");
  if (active.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No active tasks right now.";
    li.style.color = "var(--muted)";
    li.style.fontSize = "13.5px";
    list.appendChild(li);
    return;
  }

  active.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-row";

    const checkbox = document.createElement("div");
    const isPending = task.status === "pending";
    checkbox.className = "task-checkbox" + (isPending ? " pending" : "");
    checkbox.textContent = isPending ? "…" : "";

    const body = document.createElement("div");
    body.className = "task-row-body";
    const name = document.createElement("span");
    name.className = "task-row-name";
    name.textContent = task.taskName || "Untitled task";
    body.appendChild(name);
    if (isPending) {
      const note = document.createElement("span");
      note.className = "task-row-note";
      note.textContent = "Marked done — waiting for admin to verify.";
      body.appendChild(note);
    }

    if (!isPending) {
      checkbox.addEventListener("click", async () => {
        checkbox.classList.add("pending");
        checkbox.textContent = "…";
        try {
          await markTaskDone(task.id);
          const note = document.createElement("span");
          note.className = "task-row-note";
          note.textContent = "Marked done — waiting for admin to verify.";
          body.appendChild(note);
        } catch (err) {
          checkbox.classList.remove("pending");
          checkbox.textContent = "";
          alert("Could not update this task. Please try again.");
        }
      });
    }

    li.appendChild(checkbox);
    li.appendChild(body);
    list.appendChild(li);
  });
}

// Flips a task from "ongoing" to "pending" — the only change a batchmate
// is allowed to make, enforced by the Firestore security rule.
async function markTaskDone(taskId) {
  await updateDoc(doc(db, "tasks", taskId), { status: "pending" });
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
    projects.push(p);
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
    } else {
      const groupGrid = document.createElement("div");
      groupGrid.className = "group-box-grid";

      groups.forEach((g) => {
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
        box.addEventListener("click", () => openGroupModal(p.title, g));
        groupGrid.appendChild(box);
      });

      card.appendChild(groupGrid);
    }

    grid.appendChild(card);
  });
}

function openGroupModal(projectTitle, g) {
  document.getElementById("group-modal-title").textContent = g.groupName || projectTitle;

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
  wireAdminModals();
  await populateEventLabelSelect();

  // Splits "a|b|c" or newline-separated text into a clean array of strings.
  function splitList(value, sep) {
    if (!value || !value.trim()) return [];
    return value.split(sep).map((s) => s.trim()).filter(Boolean);
  }

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

  // Fund Transaction
  wireForm(
    "form-fund", "fundTransactions", "fund-error", "fund-success",
    () => ({
      type: document.getElementById("fund-type").value,
      amount: Number(document.getElementById("fund-amount").value) || 0,
      description: document.getElementById("fund-description").value.trim(),
      date: document.getElementById("fund-date").value
    }),
    (data) => ({
      title: data.type === "income" ? "New fund income" : "New fund expense",
      message: data.description || "The batch fund was updated.",
      url: "fund.html"
    })
  );

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
  document.getElementById("refresh-active-tasks").addEventListener("click", renderAdminActiveTasks);

  // Active Group Projects panel
  await renderAdminActiveProjects();
  document.getElementById("refresh-active-projects").addEventListener("click", renderAdminActiveProjects);
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
        groups.push({
          groupName: block.querySelector(".group-name-input").value.trim(),
          leader: block.querySelector(".group-leader-input").value.trim(),
          dueDate: block.querySelector(".group-duedate-input").value,
          members: checked.map((cb) => cb.dataset.displayName)
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
    <input type="text" class="group-leader-input">
    <label>Due Date</label>
    <input type="date" class="group-duedate-input">
    <label>Members</label>
    <input type="text" class="group-member-search" placeholder="Search students by name or index…">
    <div class="member-checklist"></div>
  `;

  document.getElementById("groups-container").appendChild(block);
  await buildMemberChecklist(block);
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

function applyRowVisibility(block) {
  const term = block.querySelector(".group-member-search").value.trim().toLowerCase();
  block.querySelectorAll(".member-check-row").forEach((row) => {
    const excluded = row.dataset.excluded === "true";
    const matches = !term || row.dataset.name.includes(term);
    row.hidden = excluded || !matches;
  });
}

// Whenever a member checkbox changes anywhere, that student disappears from
// every OTHER group's list — a student can only belong to one group per project.
function refreshMemberExclusions() {
  const takenBy = {}; // uid -> the blockId that currently has them checked
  document.querySelectorAll(".group-block").forEach((block) => {
    block.querySelectorAll(".member-checkbox:checked").forEach((cb) => {
      takenBy[cb.value] = block.dataset.blockId;
    });
  });

  document.querySelectorAll(".group-block").forEach((block) => {
    block.querySelectorAll(".member-check-row").forEach((row) => {
      const owner = takenBy[row.dataset.uid];
      row.dataset.excluded = (owner && owner !== block.dataset.blockId) ? "true" : "false";
    });
    applyRowVisibility(block);
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
async function renderAdminActiveTasks() {
  const container = document.getElementById("admin-active-tasks");
  if (!container) return;
  container.innerHTML = "Loading…";

  const q = query(collection(db, "tasks"), where("status", "in", ["ongoing", "pending"]));
  const snap = await getDocs(q);

  if (snap.empty) {
    container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active tasks right now.</p>';
    return;
  }

  container.innerHTML = "";
  snap.forEach((docSnap) => {
    const task = docSnap.data();
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

    const verifyBtn = document.createElement("button");
    verifyBtn.className = "admin-task-verify-btn";
    verifyBtn.textContent = "Verify";
    verifyBtn.addEventListener("click", async () => {
      verifyBtn.disabled = true;
      verifyBtn.textContent = "…";
      try {
        await adminVerifyTask(docSnap.id);
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

    box.appendChild(left);
    box.appendChild(verifyBtn);
    container.appendChild(box);
  });
}

// Admin action: marks a task fully complete. This is what makes it
// disappear from the batchmate's Active Tasks card.
async function adminVerifyTask(taskId) {
  await updateDoc(doc(db, "tasks", taskId), {
    status: "complete",
    completedDate: new Date().toISOString().slice(0, 10)
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
          await updateDoc(doc(db, "groupProjects", p.id), { status: value });

          if (value === "complete") {
            box.classList.add("removing");
            setTimeout(() => {
              box.remove();
              if (!container.querySelector(".admin-project-box")) {
                container.innerHTML = '<p class="info-text" style="color:var(--muted)">No active projects right now.</p>';
              }
            }, 250);
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
    container.appendChild(box);
  });
}

// Fills the "Labels" multi-select on the admin page from the eventLabels
// collection. Called on admin page load, and again right after a new
// label is added, so it's usable without reloading the page.
async function populateEventLabelSelect() {
  const select = document.getElementById("event-labels-select");
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
    name.className = "event-name";
    name.textContent = e.name || "Untitled event";

    const date = document.createElement("span");
    date.className = "event-date";
    date.textContent = formatEventDate(e.date);

    card.appendChild(name);
    card.appendChild(date);
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

async function renderBatchmateDirectory() {
  const snap = await getDocs(collection(db, "batchmatesPublic"));
  allBatchmates = [];
  snap.forEach((docSnap) => allBatchmates.push(docSnap.data()));
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
    card.addEventListener("click", () => openBatchmateModal(b));
    grid.appendChild(card);
  });
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

  document.getElementById("batchmate-modal-overlay").hidden = false;
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
