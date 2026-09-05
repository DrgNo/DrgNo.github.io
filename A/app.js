
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

  function renderRecord(data) {
    const name = data.name || "—";
    document.getElementById("f-name").textContent = name;
    document.getElementById("avatar-initial").textContent = name.charAt(0).toUpperCase();
    document.getElementById("f-gender").textContent = data.gender || "—";
    document.getElementById("f-age").textContent = data.age ?? "—";
    document.getElementById("f-points").textContent = data.totalPoints ?? 0;
    document.getElementById("f-info").textContent = data.additionalInfo || "No additional info on file.";

    fillList("f-roles", data.rolesAssigned, "pill", "No roles assigned yet.");
    fillList("f-tasks", data.tasks, "line", "No tasks recorded.");
    fillList("f-bad", data.badRecords, "line", "No records — clean sheet.");
  }

  function fillList(elId, items, kind, emptyText) {
    const el = document.getElementById(elId);
    el.innerHTML = "";
    const list = Array.isArray(items) ? items : (items ? [items] : []);
    if (list.length === 0) {
      const li = document.createElement("li");
      li.textContent = emptyText;
      if (kind === "line") li.classList.add("muted-list");
      el.appendChild(li);
      return;
    }
    list.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      el.appendChild(li);
    });
  }
}
