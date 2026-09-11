// ── Firebase setup ──────────────────────────────────────────────
// Replace with the config from your Firebase project settings.
// This is safe to expose publicly — it is not a secret key.
// Real access control happens in Firestore Security Rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
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
      window.location.href = "dashboard.html";
    } catch (err) {
      errorMsg.textContent = "Sign-in failed. Check your email and password.";
      errorMsg.hidden = false;
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  });

  // If already signed in, skip straight to the dashboard.
  onAuthStateChanged(auth, (user) => {
    if (user) window.location.href = "dashboard.html";
  });
}

// ── Dashboard page logic ────────────────────────────────────────
const recordSection = document.getElementById("record");
if (recordSection) {
  const loadingState = document.getElementById("loading-state");
  const errorState = document.getElementById("error-state");
  const userEmailEl = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");

  logoutBtn.addEventListener("click", () => signOut(auth));

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }
    userEmailEl.textContent = user.email;

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
  });

  // ── Field helpers ───────────────────────────────────────────
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

  // ── Main render ──────────────────────────────────────────────
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
      ["Full Name", d.longName],
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
    fillTasks("f-tasks", d.tasksAssigned);
    fillLines("f-bad", d.badBehaviorRecords, "No records — clean sheet.");
  }
}
