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
  collection,
  getDocs,
  addDoc,
  query,
  orderBy
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

// Deterministic color per role name, so the same role always looks the same.
const ROLE_PALETTE = [
  { bg: "#1E3A6E", border: "#2A5AD6", text: "#BFD3FF" }, // blue
  { bg: "#3A1E5E", border: "#7C4DFF", text: "#D9C8FF" }, // violet
  { bg: "#0F4A3E", border: "#1FAE87", text: "#B6F2E1" }, // teal
  { bg: "#5E3A12", border: "#D6942A", text: "#FFE1B0" }, // amber
  { bg: "#5E1E2E", border: "#D6426E", text: "#FFC2D4" }, // rose
  { bg: "#1E4A5E", border: "#2AACD6", text: "#BDEFFF" }, // cyan
  { bg: "#3E5E1E", border: "#8FD62A", text: "#E4FFB0" }  // lime
];
function colorForRole(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return ROLE_PALETTE[hash % ROLE_PALETTE.length];
}

function fillTasks(elId, tasks) {
  const el = document.getElementById(elId);
  el.innerHTML = "";
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No tasks recorded.";
    li.classList.add("muted-list");
    el.appendChild(li);
    return;
  }
  list.forEach((task) => {
    // Supports either a string ("Task name") or an object ({ name, status }).
    const name = typeof task === "string" ? task : (task.name || "Untitled task");
    const status = typeof task === "string" ? "ongoing" : (task.status || "ongoing").toLowerCase();
    const isDone = status === "complete" || status === "completed" || status === "done";

    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.alignItems = "center";
    li.style.justifyContent = "space-between";
    li.style.gap = "10px";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;

    const badge = document.createElement("span");
    badge.textContent = isDone ? "Complete" : "Ongoing";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "600";
    badge.style.padding = "3px 10px";
    badge.style.borderRadius = "999px";
    badge.style.flexShrink = "0";
    if (isDone) {
      badge.style.background = "#0F4A3E";
      badge.style.color = "#7CE8C6";
      badge.style.border = "1px solid #1FAE87";
    } else {
      badge.style.background = "#5E3A12";
      badge.style.color = "#FFC97A";
      badge.style.border = "1px solid #D6942A";
    }

    li.appendChild(nameSpan);
    li.appendChild(badge);
    el.appendChild(li);
  });
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
  fillTasks("f-tasks", d.tasksAssigned);
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

async function renderProjects() {
  const grid = document.getElementById("project-grid");
  grid.innerHTML = "";

  const snap = await getDocs(collection(db, "groupProjects"));

  if (snap.empty) {
    grid.innerHTML = '<p class="info-text" style="color:var(--muted)">No projects currently running.</p>';
    return;
  }

  const STATUS_CLASS = {
    "ideation": "status-ideation",
    "in progress": "status-in-progress",
    "final review": "status-final-review"
  };

  const projects = [];
  snap.forEach((docSnap) => projects.push(docSnap.data()));
  projects.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  projects.forEach((p) => {
    const card = document.createElement("div");
    card.className = "project-card";

    if (p.subject) {
      const subject = document.createElement("div");
      subject.className = "project-subject";
      subject.textContent = p.subject;
      card.appendChild(subject);
    }

    const title = document.createElement("h3");
    title.className = "project-title";
    title.textContent = p.title || "Untitled project";
    card.appendChild(title);

    if (p.status) {
      const statusKey = p.status.toLowerCase();
      const badge = document.createElement("span");
      badge.className = "status-badge " + (STATUS_CLASS[statusKey] || "status-ideation");
      badge.textContent = p.status;
      card.appendChild(badge);
      card.appendChild(document.createElement("br"));
    }

    if (p.abstract) {
      const abstract = document.createElement("p");
      abstract.className = "project-abstract";
      abstract.textContent = p.abstract;
      card.appendChild(abstract);
    }

    const metaRow = document.createElement("div");
    metaRow.className = "project-meta-row";

    if (p.groupName) {
      const groupBlock = document.createElement("div");
      const label = document.createElement("span");
      label.className = "project-meta-label";
      label.textContent = "Group";
      const value = document.createElement("span");
      value.textContent = p.groupName;
      if (p.groupLeader) {
        const tag = document.createElement("span");
        tag.className = "leader-tag";
        tag.textContent = "Lead: " + p.groupLeader;
        groupBlock.appendChild(label);
        groupBlock.appendChild(value);
        groupBlock.appendChild(tag);
      } else {
        groupBlock.appendChild(label);
        groupBlock.appendChild(value);
      }
      metaRow.appendChild(groupBlock);
    }

    if (Array.isArray(p.members) && p.members.length > 0) {
      const memberBlock = document.createElement("div");
      const label = document.createElement("span");
      label.className = "project-meta-label";
      label.textContent = "Members";
      const memberList = document.createElement("ul");
      memberList.className = "pill-list";
      p.members.forEach((m) => {
        const li = document.createElement("li");
        li.textContent = m;
        memberList.appendChild(li);
      });
      memberBlock.appendChild(label);
      memberBlock.appendChild(memberList);
      metaRow.appendChild(memberBlock);
    }

    card.appendChild(metaRow);

    if (Array.isArray(p.milestones) && p.milestones.length > 0) {
      const milestoneLabel = document.createElement("span");
      milestoneLabel.className = "project-meta-label";
      milestoneLabel.textContent = "Deliverables & Milestones";
      const milestoneList = document.createElement("ul");
      milestoneList.className = "milestone-list";
      p.milestones.forEach((m) => {
        const li = document.createElement("li");
        li.className = "milestone-item";
        li.textContent = m;
        milestoneList.appendChild(li);
      });
      card.appendChild(milestoneLabel);
      card.appendChild(milestoneList);
    }

    grid.appendChild(card);
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
  await populateEventLabelSelect();

  // Splits "a|b|c" or newline-separated text into a clean array of strings.
  function splitList(value, sep) {
    if (!value || !value.trim()) return [];
    return value.split(sep).map((s) => s.trim()).filter(Boolean);
  }

  // Wires one form: on submit, builds the data object, writes it to
  // Firestore, shows feedback, and resets the form on success.
  function wireForm(formId, collectionName, errorId, successId, buildData) {
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
        await addDoc(collection(db, collectionName), buildData());
        successEl.textContent = "Added successfully.";
        successEl.hidden = false;
        form.reset();
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
  wireForm("form-fund", "fundTransactions", "fund-error", "fund-success", () => ({
    type: document.getElementById("fund-type").value,
    amount: Number(document.getElementById("fund-amount").value) || 0,
    description: document.getElementById("fund-description").value.trim(),
    date: document.getElementById("fund-date").value
  }));

  // Wall of Fame
  wireForm("form-wall", "wallOfFame", "wall-form-error", "wall-form-success", () => ({
    title: document.getElementById("wall-title").value.trim(),
    description: document.getElementById("wall-description").value.trim(),
    imageUrl: document.getElementById("wall-imageurl").value.trim(),
    date: document.getElementById("wall-date").value
  }));

  // Announcement
  wireForm("form-announcement", "announcements", "ann-error", "ann-success", () => ({
    title: document.getElementById("ann-title").value.trim(),
    message: document.getElementById("ann-message").value.trim(),
    date: document.getElementById("ann-date").value
  }));

  // Batch Leadership
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

  // Group Project
  wireForm("form-project", "groupProjects", "proj-error", "proj-success", () => {
    const data = {
      subject: document.getElementById("proj-subject").value.trim(),
      title: document.getElementById("proj-title").value.trim(),
      abstract: document.getElementById("proj-abstract").value.trim(),
      status: document.getElementById("proj-status").value,
      groupName: document.getElementById("proj-group").value.trim(),
      groupLeader: document.getElementById("proj-leader").value.trim(),
      members: splitList(document.getElementById("proj-members").value, "|"),
      milestones: splitList(document.getElementById("proj-milestones").value, "\n")
    };
    const orderVal = document.getElementById("proj-order").value;
    if (orderVal !== "") data.order = Number(orderVal);
    return data;
  });

  // Event Label
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
        description: document.getElementById("eventlabel-description").value.trim()
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
  wireForm("form-event", "events", "event-error", "event-success", () => {
    const select = document.getElementById("event-labels-select");
    const selectedLabels = Array.from(select.selectedOptions).map((o) => o.value);
    return {
      name: document.getElementById("event-name").value.trim(),
      date: document.getElementById("event-datetime").value,
      description: document.getElementById("event-description").value.trim(),
      leaders: splitList(document.getElementById("event-leaders").value, "|"),
      labels: selectedLabels
    };
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
    if (l.name) map[l.name] = l.description || "No description available.";
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
      const li = document.createElement("li");
      li.textContent = labelName;
      li.setAttribute("data-clickable", "true");
      li.addEventListener("click", () => {
        alert(labelName + ": " + (labelsMap[labelName] || "No description available."));
      });
      labelsList.appendChild(li);
    });
  }

  startCountdown(e.date);
  document.getElementById("event-modal-overlay").hidden = false;
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
