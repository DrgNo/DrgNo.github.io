// ── Forms feature (home cards, fill/edit, admin builder, responses) ──
// Supports multi-page forms (page breaks), an animated progress indicator, conditional questions and answer-based page jumps.
// Self-contained module: loaded on home.html and admin.html only.
// Also hosts the Idea Boards feature (see the IDEA BOARDS section near the bottom).
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, deleteField, writeBatch, collection, getDocs, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const cfg = {
  apiKey: "AIzaSyDfgcIpOgJJeObDrWm_Ce0MuWSI7ZU0lB0",
  authDomain: "drgno-fst.firebaseapp.com",
  projectId: "drgno-fst",
  storageBucket: "drgno-fst.firebasestorage.app",
  messagingSenderId: "91216205592",
  appId: "1:91216205592:web:616c05cd40727421a2b06d"
};
const app = getApps().length ? getApp() : initializeApp(cfg);
const auth = getAuth(app);
const db = getFirestore(app);
const PUSH_WORKER_URL = "https://batchportal-push.batchportal-push.workers.dev";

const TYPES = {
  short: "Short answer", long: "Long answer", link: "Link",
  date: "Date", number: "Number", prefixed: "Pre-filled (start / end text)",
  yesno: "Yes / No", toggle: "Toggle (On/Off)", select: "Select one option", multi: "Select multiple options",
  rating: "Rating scale", priority: "Priority choice (ranked options)", table: "Option table", batchmates: "Batchmate selection (groups)"
};
const isEmptyVal = (v) => v === "" || v == null || (Array.isArray(v) && !v.length);
// Human-readable text for any answer (response table + Excel/PDF export).
function fmtAnswer(fd, v) {
  if (isEmptyVal(v)) return "";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (Array.isArray(v) && fd?.type === "priority") return v.map((o, i) => `${i + 1}. ${o}`).join("; ");
  if (Array.isArray(v)) return fd?.type === "batchmates"
    ? v.map((m) => `${m.name}${m.index ? " (" + m.index + ")" : ""}`).join("; ")
    : v.join(", ");
  if (typeof v === "object") return Object.entries(v).map(([k, x]) => `${k}: ${Array.isArray(x) ? x.join(", ") : x}`).join("; ");
  return String(v);
}


// ── Pages + logic engine ─────────────────────────────────────────
// Shared by the fill form, the builder's save-check and the response viewer.
//   field.type "section"  = page break; it STARTS a page. { label, help, next, routes[] }
//       next   : "" (continue) | "submit" | <later section id>
//       routes : [{ match:"all"|"any", conds:[{src,op,val}], goto }]  → first matching rule wins
//   question.logic  = { match, conds[] }  → show the question only when true
//   question.branch = [{ o:"option text", to:"submit"|<later section id> }]  (select / yes-no)
const isQ = (x) => x.type !== "section";
const RATING_STYLES = { stars: "★ Stars", hearts: "♥ Hearts", numbers: "1 2 3 Numbers", emoji: "🙂 Emoji faces" };
const RATING_FACES = ["😡", "🙁", "😐", "🙂", "😍"];
const ratingMax = (f) => (f.style === "emoji" ? 5 : Math.min(10, Math.max(3, Number(f.max) || 5)));
const cleanList = (a) => (a || []).map((x) => String(x).trim()).filter(Boolean);
function splitPages(fields) {
  const pages = []; let cur = null;
  (fields || []).forEach((fd) => {
    if (fd.type === "section") { cur = { section: fd, fields: [] }; pages.push(cur); }
    else { if (!cur) { cur = { section: null, fields: [] }; pages.push(cur); } cur.fields.push(fd); }
  });
  return pages;
}
const OP_TEXT = { eq: "is", neq: "is not", has: "includes", nhas: "does not include", gt: "is greater than", lt: "is less than", filled: "is answered", empty: "is left blank" };
function opsFor(t) {
  if (t === "yesno" || t === "select") return ["eq", "neq", "filled", "empty"];
  if (t === "toggle") return ["eq"];
  if (t === "multi" || t === "priority") return ["has", "nhas", "filled", "empty"];
  if (t === "number" || t === "date" || t === "rating") return ["eq", "neq", "gt", "lt", "filled", "empty"];
  if (t === "table" || t === "batchmates") return ["filled", "empty"];
  return ["eq", "neq", "has", "nhas", "filled", "empty"];
}
function opLabel(t, op) {
  if (t === "date" && op === "gt") return "is after";
  if (t === "date" && op === "lt") return "is before";
  if (op === "has" && t !== "multi" && t !== "priority") return "contains";
  if (op === "nhas" && t !== "multi" && t !== "priority") return "does not contain";
  return OP_TEXT[op];
}
const opNeedsValue = (op) => op !== "filled" && op !== "empty";
function condChoices(q) {
  if (q.type === "yesno") return ["Yes", "No"];
  if (q.type === "toggle") return ["On", "Off"];
  if (q.type === "select" || q.type === "multi" || q.type === "priority") return cleanList(q.options);
  if (q.type === "rating") return Array.from({ length: ratingMax(q) }, (_, i) => String(i + 1));
  return null;
}
function evalCond(c, raw, t) {
  const norm = (x) => String(x ?? "").trim().toLowerCase();
  const v = norm(c.val);
  switch (c.op) {
    case "filled": return t === "toggle" ? raw === true : !isEmptyVal(raw);
    case "empty": return t === "toggle" ? raw !== true : isEmptyVal(raw);
    case "eq":
      if (t === "toggle") return (raw === true) === (v === "on");
      if (t === "number" || t === "rating") return !isEmptyVal(raw) && Number(raw) === Number(c.val);
      return !Array.isArray(raw) && norm(raw) === v;
    case "neq": return !evalCond({ ...c, op: "eq" }, raw, t);
    case "has": return Array.isArray(raw) ? raw.some((x) => norm(x) === v) : norm(raw).includes(v);
    case "nhas": return !evalCond({ ...c, op: "has" }, raw, t);
    case "gt": case "lt": {
      if (isEmptyVal(raw)) return false;
      if (t === "date") return c.op === "gt" ? String(raw) > String(c.val) : String(raw) < String(c.val);
      const a = Number(raw), b = Number(c.val);
      return isFinite(a) && isFinite(b) && (c.op === "gt" ? a > b : a < b);
    }
  }
  return false;
}
function evalSet(cs, rawOf, typeOf) {
  const conds = (cs?.conds || []).filter((c) => c.src);
  if (!conds.length) return true;
  const res = conds.map((c) => evalCond(c, rawOf(c.src), typeOf(c.src)));
  return cs.match === "any" ? res.some(Boolean) : res.every(Boolean);
}
// Is `t` a legal jump target from page k? ("submit" or a LATER page's section id — forward only, so no loops.)
const targetOk = (pg, k, t) => t === "submit" || (!!t && pg.findIndex((p, j) => j > k && p.section?.id === t) > -1);

// Works out which questions apply and which pages the person will see, given the current answers.
//   rawOf(id) → the raw answer for question id.  Returns { pages, path[], vis:Map(id→bool), next(pageIdx) }
function computeFlow(fields, rawOf) {
  const pages = splitPages(fields);
  const types = {}; (fields || []).forEach((x) => { types[x.id] = x.type; });
  const typeOf = (id) => types[id];
  const vis = new Map(), seen = new Set(), nexts = new Map();
  const val = (id) => (vis.get(id) === true ? rawOf(id) : "");
  const calc = (pi) => {
    if (seen.has(pi)) return; seen.add(pi);
    pages[pi].fields.forEach((fd) => vis.set(fd.id, evalSet(fd.logic, val, typeOf)));
  };
  const target = (pi, t) => {
    if (t === "submit") return -1;
    if (t) { const j = pages.findIndex((p, k) => k > pi && p.section?.id === t); if (j > -1) return j; }
    return pi + 1 >= pages.length ? -1 : pi + 1;
  };
  const isEmptyPage = (j) => pages[j].fields.length > 0 && !pages[j].fields.some((fd) => vis.get(fd.id));
  let route;
  const skip = (j) => { if (j === -1) return -1; calc(j); return isEmptyPage(j) ? route(j) : j; }; // pages whose questions are all hidden are skipped
  route = (pi) => {
    calc(pi);
    const p = pages[pi];
    for (const fd of p.fields) {                                   // 1) "go to page by answer" on a question
      if (!vis.get(fd.id) || !fd.branch?.length) continue;
      const hit = fd.branch.find((b) => b.o === val(fd.id));
      if (hit?.to) return skip(target(pi, hit.to));
    }
    for (const r of p.section?.routes || [])                       // 2) routing rules on the page
      if (r.conds?.length && evalSet(r, val, typeOf)) return skip(target(pi, r.goto));
    return skip(target(pi, p.section?.next || ""));                // 3) the page's default
  };
  const path = [];
  let i = pages.length ? skip(0) : -1;
  while (i !== -1 && !path.includes(i)) { path.push(i); const n = route(i); nexts.set(i, n); i = n; }
  pages.forEach((p, k) => { if (!path.includes(k)) p.fields.forEach((fd) => vis.set(fd.id, false)); });
  return { pages, path, vis, next: (pi) => nexts.get(pi) };
}

// ── Profile import (form answers → each person's PRIVATE profile) ────────────────
// A question can be mapped to a profile field: q.profile = { key, label, group, groupTitle? }.
// From the responses screen an admin imports the chosen fields: values are written to /batchmates/{uid}[key]
// and the field is added to the chosen section of /config/directoryFields (the Dashboard renders that schema).
// Imported fields are always private (public:false) — nothing goes to /batchmatesPublic.
const PROFILE_TYPES = new Set(["short", "long", "link", "date", "number", "prefixed", "yesno", "toggle", "select", "multi", "rating"]);
const PROFILE_RESERVED = new Set(["campusIndexNumber", "campusRegNumber", "universityEmail", "roles", "tasks", "photoUrl", "prestigePoints", "prestigeLevel",
  "fundDonated", "badBehaviorRecords", "sports", "clubs", "skills", "badges", "uid", "id"]);
// Mirror of DEFAULT_DIRECTORY_FIELD_GROUPS in app.js — only used when /config/directoryFields doesn't exist yet. Keep in sync.
const DEFAULT_PROFILE_GROUPS = [
  { id: "person", title: "Person Details", order: 0, fields: [
    { key: "shortName", label: "Short Name", order: 0, public: true }, { key: "gender", label: "Gender", order: 1, public: true },
    { key: "birthday", label: "Birthday", order: 2, public: true }, { key: "nicNumber", label: "NIC Number", order: 3, public: false },
    { key: "address", label: "Address", order: 4, public: false }, { key: "district", label: "District", order: 5, public: false }] },
  { id: "campus", title: "Campus Details", order: 1, fields: [
    { key: "campusIndexNumber", label: "Campus Index Number", order: 0, public: true }, { key: "campusRegNumber", label: "Campus Registration Number", order: 1, public: false }] },
  { id: "contact", title: "Contact Options", order: 2, fields: [
    { key: "primaryMobile", label: "Primary Mobile Number", order: 0, public: true }, { key: "alternativeNumbers", label: "Alternative Numbers", order: 1, public: false },
    { key: "universityEmail", label: "University Email", order: 2, public: false }, { key: "personalEmail", label: "Personal Email", order: 3, public: false }] },
  { id: "residential", title: "Residential Details", order: 3, fields: [
    { key: "residentialStatus", label: "Residential Status", order: 0, public: false }, { key: "residentialAddress", label: "Residential Address", order: 1, public: false }] },
  { id: "medical", title: "Medical Details", order: 4, fields: [
    { key: "bloodGroup", label: "Blood Group", order: 0, public: false }, { key: "dietaryOption", label: "Dietary Option", order: 1, public: false },
    { key: "severeMedicalConditions", label: "Severe Medical Conditions", order: 2, public: false }, { key: "foodAllergies", label: "Food Allergies", order: 3, public: false },
    { key: "chemicalAllergies", label: "Chemical Allergies", order: 4, public: false }] },
  { id: "emergency", title: "Emergency Details", order: 5, fields: [
    { key: "emergencyContactName", label: "Emergency Contact Person Name", order: 0, public: false }, { key: "emergencyRelationship", label: "Emergency Contact Person Relationship", order: 1, public: false },
    { key: "primaryEmergencyNumber", label: "Primary Emergency Number", order: 2, public: false }, { key: "secondaryEmergencyNumber", label: "Secondary Emergency Number", order: 3, public: false }] }
];
let PROFILE_GROUPS = null, PROFILE_DOC_EXISTS = false;
async function loadProfileGroups(force) {
  if (PROFILE_GROUPS && !force) return PROFILE_GROUPS;
  try {
    const snap = await getDoc(doc(db, "config", "directoryFields"));
    PROFILE_DOC_EXISTS = snap.exists() && Array.isArray(snap.data().groups) && snap.data().groups.length > 0;
    PROFILE_GROUPS = PROFILE_DOC_EXISTS ? snap.data().groups : DEFAULT_PROFILE_GROUPS;
  } catch (e) { PROFILE_GROUPS = PROFILE_GROUPS || DEFAULT_PROFILE_GROUPS; }
  return PROFILE_GROUPS;
}
const profileGroups = () => [...(PROFILE_GROUPS || DEFAULT_PROFILE_GROUPS)].sort((a, b) => (a.order || 0) - (b.order || 0));
const slugKey = (t) => {
  const w = String(t || "").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let k = w.map((x, i) => (i ? x[0].toUpperCase() + x.slice(1).toLowerCase() : x.toLowerCase())).join("");
  if (k && !/^[a-z]/.test(k)) k = "f" + k[0].toUpperCase() + k.slice(1);
  return k.slice(0, 40);
};
const slugId = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const profileMappings = (form) => (form.fields || []).filter((q) => isQ(q) && q.profile?.key && PROFILE_TYPES.has(q.type));
// Converts a raw form answer into what gets stored on the profile (undefined = nothing to import).
function profileValue(q, v) {
  if (isEmptyVal(v)) return undefined;
  if (q.type === "toggle") return v === true ? "On" : v === false ? "Off" : undefined;
  if (q.type === "multi") return Array.isArray(v) && v.length ? v.map(String) : undefined;
  if (q.type === "number" || q.type === "rating") { const n = Number(v); return isFinite(n) ? n : String(v); }
  const t = String(v).trim();
  return t || undefined;
}

// ── tiny helpers ─────────────────────────────────────────────────
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c != null && e.append(c));
  return e;
}

// Animated skeleton placeholders (styles in style.css) — used instead of "Loading…".
function skeletonHTML(kind = "list", n = 3) {
  const ln = (w) => `<span class="sk sk-line" style="width:${w}%"></span>`;
  let inner = "";
  if (kind === "lines") inner = ln(92) + ln(78) + ln(56);
  else for (let i = 0; i < n; i++) inner += `<div class="sk-row"><span class="sk sk-circle" style="width:36px;height:36px"></span><div class="sk-col">${ln(60 + ((i * 13) % 25))}${ln(34)}</div></div>`;
  return `<div class="sk-wrap" aria-busy="true" aria-label="Loading">${inner}</div>`;
}
function skelEl(cls, kind) { const d = el("div", { class: cls || "" }); d.innerHTML = skeletonHTML(kind); return d; }
const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const fmtDate = (d) => d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const pad = (n) => String(n).padStart(2, "0");
const toInputValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const newId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const newSection = () => ({ id: newId(), type: "section", label: "", help: "", next: "", routes: [] });
const formLink = (id) => new URL("home.html?form=" + encodeURIComponent(id), location.href).href;
const slug = (s) => String(s || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const isActive = (f) => { const d = toDate(f.dueAt); return d && d > new Date(); };

// Due-date colour: far away = green, closer = yellow/orange, near = red.
function dueInfo(d) {
  const ms = d - Date.now();
  const h = ms / 36e5;
  const hue = Math.max(0, Math.min(1, h / 168)) * 130; // 7+ days → green(130), 0 → red(0)
  let label;
  if (ms <= 0) label = "Ended";
  else if (h < 1) label = `${Math.max(1, Math.round(ms / 6e4))}m left`;
  else if (h < 24) label = `${Math.floor(h)}h left`;
  else label = `${Math.floor(h / 24)}d ${Math.floor(h % 24)}h left`;
  return { label, color: `hsl(${hue} 72% 46%)` };
}

function overlay(id, cls = "") {
  const ov = el("div", { class: "modal-overlay forms-modal " + cls, id, hidden: true });
  document.body.appendChild(ov);
  return ov;
}
function closeBtn(ov) { return el("button", { class: "modal-close", type: "button", "aria-label": "Close", text: "✕", onclick: () => { ov.hidden = true; } }); }

let adminInfo = null;
const hasPerm = (k) => !!adminInfo && (adminInfo.superAdmin === true || adminInfo.permissions?.[k] === true);
let banner;
function denied() {
  if (!banner) { banner = el("div", { class: "admin-perm-banner", id: "forms-perm-banner" }); document.body.appendChild(banner); }
  banner.textContent = "⚠ You don't have access to \"Forms\".";
  banner.classList.add("show");
  setTimeout(() => banner.classList.remove("show"), 3500);
}

async function push({ type, title, message, url, targetUid }) {
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch(PUSH_WORKER_URL + "/notify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken, type, title, message, url, targetUid })
    });
  } catch (e) { console.warn("Push failed:", e); }
}

let rosterCache = null;
async function getRoster() {
  if (rosterCache) return rosterCache;
  const snap = await getDocs(collection(db, "batchmatesPublic"));
  rosterCache = snap.docs.map((d) => ({ uid: d.id, name: d.data().shortName || "Unnamed", index: d.data().campusIndexNumber || "" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return rosterCache;
}

// Push toggle + Automatic/Manual delivery (same look as other admin forms).
function pushControls(defaultOn, label) {
  const cb = el("input", { type: "checkbox" }); cb.checked = defaultOn;
  const mode = el("select", {}, el("option", { value: "auto", text: "Automatic (entire batch)" }), el("option", { value: "manual", text: "Manual — choose recipients" }));
  const search = el("input", { type: "text", placeholder: "Search students by name or index…" });
  const list = el("div", { class: "member-checklist", style: "max-height:180px; overflow-y:auto;" });
  const manual = el("div", { hidden: true }, search, list);
  const opts = el("div", { class: "push-controls-options", hidden: !defaultOn }, el("label", { text: "Delivery" }), mode, manual);
  const root = el("div", { class: "push-controls" }, el("label", { class: "push-toggle-row" }, cb, el("span", { text: label })), opts);
  let loaded = false;
  cb.addEventListener("change", () => { opts.hidden = !cb.checked; });
  mode.addEventListener("change", async () => {
    manual.hidden = mode.value !== "manual";
    if (manual.hidden || loaded) return;
    loaded = true;
    (await getRoster()).forEach((b) => {
      const c = el("input", { type: "checkbox", value: b.uid });
      list.append(el("label", { class: "member-check-row", "data-name": (b.name + " " + b.index).toLowerCase() }, c, el("span", { text: `${b.name}${b.index ? " — " + b.index : ""}` })));
    });
  });
  search.addEventListener("input", () => {
    const t = search.value.trim().toLowerCase();
    list.querySelectorAll(".member-check-row").forEach((r) => { r.hidden = !!t && !r.dataset.name.includes(t); });
  });
  return {
    root,
    async send(info) {
      if (!cb.checked) return;
      if (mode.value === "manual") {
        list.querySelectorAll("input:checked").forEach((c) => push({ type: "task", targetUid: c.value, ...info }));
      } else push({ type: "announcements", ...info });
    },
    reset() { cb.checked = defaultOn; opts.hidden = !defaultOn; mode.value = "auto"; manual.hidden = true; list.querySelectorAll("input").forEach((c) => { c.checked = false; }); }
  };
}

async function fetchForms() {
  const snap = await getDocs(collection(db, "forms"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ═════════════════ USER SIDE (home.html) ═════════════════
let me = null;
async function getMe() {
  if (me) return me;
  let d = {};
  try { const s = await getDoc(doc(db, "batchmatesPublic", auth.currentUser.uid)); if (s.exists()) d = s.data(); } catch (e) {}
  me = { uid: auth.currentUser.uid, name: d.shortName || auth.currentUser.email, index: d.campusIndexNumber || "" };
  return me;
}

async function initHome() {
  const anchor = $("#notice-list")?.closest(".card");
  if (!anchor) return;
  const grid = el("div", { class: "event-grid forms-grid" });
  const card = el("div", { class: "card full-span", id: "forms-card", style: "margin-bottom:18px;", hidden: true }, el("p", { class: "section-label", text: "Forms" }), grid);
  anchor.after(card);

  async function load() {
    const forms = (await fetchForms()).filter(isActive).sort((a, b) => toDate(a.dueAt) - toDate(b.dueAt));
    const subs = await Promise.all(forms.map((f) => getDoc(doc(db, "forms", f.id, "responses", auth.currentUser.uid)).then((s) => s.exists()).catch(() => false)));
    grid.innerHTML = "";
    card.hidden = forms.length === 0;
    forms.forEach((f, i) => {
      const d = toDate(f.dueAt), info = dueInfo(d);
      const chips = el("div", { class: "fm-chips" });
      if (subs[i]) chips.append(el("span", { class: "fm-chip ok", text: "✓ Submitted" }));
      if (f.collecting === false) chips.append(el("span", { class: "fm-chip warn", text: "Paused" }));
      grid.append(el("div", { class: "fm-card", style: `--due:${info.color}`, onclick: () => openFill(f.id, load) },
        el("div", { class: "fm-card-name", text: f.title || "Untitled form" }),
        el("div", { class: "fm-due" }, el("span", { class: "fm-dot" }), el("b", { text: info.label })),
        el("div", { class: "fm-card-sub", text: "Due " + fmtDate(d) }),
        chips));
    });
  }
  await load();
  const id = new URLSearchParams(location.search).get("form");
  if (id) openFill(id, load);
}

function batchmatePicker(f, val, ctx) {
  const sel = new Map((Array.isArray(val) ? val : []).map((m) => [m.uid, m]));
  // Pool = everyone except me and anyone already in another group.
  const pool = ctx.roster.filter((b) => b.uid !== ctx.me.uid && (sel.has(b.uid) || !ctx.claims.has(b.uid)));
  const max = Number(f.max) || 0;
  const chips = el("ul", { class: "pill-list" });
  const count = el("small", { class: "fm-bm-count" });
  const search = el("input", { type: "text", placeholder: "Search batchmates by name or index…" });
  const list = el("div", { class: "member-checklist" });
  const rows = [];
  function sync() {
    chips.innerHTML = "";
    sel.forEach((m) => chips.append(el("li", {}, m.name, el("button", { type: "button", "aria-label": "Remove", text: "✕", onclick: () => { sel.delete(m.uid); sync(); } }))));
    count.textContent = `${sel.size} selected` + (max ? ` (max ${max})` : "") + (Number(f.min) ? ` · min ${f.min}` : "");
    rows.forEach(({ c, b }) => { c.checked = sel.has(b.uid); c.disabled = !!max && !c.checked && sel.size >= max; });
  }
  pool.forEach((b) => {
    const c = el("input", { type: "checkbox" });
    c.addEventListener("change", () => { if (c.checked) sel.set(b.uid, { uid: b.uid, name: b.name, index: b.index }); else sel.delete(b.uid); sync(); });
    rows.push({ c, b });
    list.append(el("label", { class: "member-check-row", "data-name": (b.name + " " + b.index).toLowerCase() }, c, el("span", { text: `${b.name}${b.index ? " — " + b.index : ""}` })));
  });
  if (!pool.length) list.append(el("p", { class: "fine-print", text: "No batchmates left to select." }));
  search.addEventListener("input", () => {
    const t = search.value.trim().toLowerCase();
    list.querySelectorAll(".member-check-row").forEach((r) => { r.hidden = !!t && !r.dataset.name.includes(t); });
  });
  sync();
  return {
    node: el("div", { class: "fm-bm" },
      el("div", { class: "fm-edit-note", text: `You (${ctx.me.name}) are the group leader and are added automatically. Batchmates already in another group aren't listed.` }),
      chips, count, search, list),
    get: () => (sel.size ? [...sel.values()] : "")
  };
}

function fieldInput(f, val, ctx) {
  const t = f.type, opts = f.options || [];
  if (t === "rating") {
    const max = ratingMax(f), style = RATING_STYLES[f.style] ? f.style : "stars";
    let cur = Number(val) >= 1 && Number(val) <= max ? Number(val) : 0;
    const iconOf = (i) => (style === "stars" ? "★" : style === "hearts" ? "♥" : style === "emoji" ? RATING_FACES[i - 1] : String(i));
    const fill = style === "stars" || style === "hearts"; // these light up cumulatively
    const row = el("div", { class: `fm-rate fm-rate-${style}`, role: "radiogroup", "aria-label": f.label || "Rating" });
    const readout = el("span", { class: "fm-rate-val" });
    const btns = [];
    const paint = (n) => btns.forEach((b, k) => {
      const i = k + 1;
      b.classList.toggle("on", fill ? i <= n : i === n);
      b.setAttribute("aria-checked", String(i === cur));
    });
    const settle = () => { paint(cur); readout.textContent = cur ? `${cur} / ${max}` : "Tap to rate"; readout.classList.toggle("set", !!cur); };
    for (let i = 1; i <= max; i++) {
      const b = el("button", { type: "button", class: "fm-rate-btn", role: "radio", "aria-label": `${i} out of ${max}`, "aria-checked": "false", text: iconOf(i) });
      b.addEventListener("click", () => {
        cur = cur === i ? 0 : i; settle();
        if (cur) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
      });
      b.addEventListener("mouseenter", () => paint(i));
      b.addEventListener("focus", () => paint(i));
      btns.push(b); row.append(b);
    }
    row.addEventListener("mouseleave", settle);
    row.addEventListener("focusout", settle);
    settle();
    const foot = el("div", { class: "fm-rate-foot" }, el("span", { text: f.lo || "" }), readout, el("span", { text: f.hi || "" }));
    return { node: el("div", { class: "fm-rate-wrap" }, row, foot), get: () => (cur ? cur : "") };
  }
  if (t === "yesno") {
    let cur = val === "Yes" || val === "No" ? val : "";
    const row = el("div", { class: "seg-toggle" });
    ["Yes", "No"].forEach((o) => {
      const id = `yn_${f.id}_${o}`;
      const r = el("input", { type: "radio", name: "yn_" + f.id, value: o, id }); r.checked = cur === o;
      r.addEventListener("change", () => { cur = o; });
      row.append(r, el("label", { for: id, text: o }));
    });
    return { node: row, get: () => cur };
  }
  if (t === "toggle") {
    const cb = el("input", { type: "checkbox" }); cb.checked = val === true;
    const lbl = el("span", { text: cb.checked ? "On" : "Off" });
    cb.addEventListener("change", () => { lbl.textContent = cb.checked ? "On" : "Off"; });
    return { node: el("label", { class: "fm-switch" }, cb, el("i"), lbl), get: () => cb.checked };
  }
  if (t === "select") {
    // Custom dropdown (no native popup) built from the portal's leader-picker list styles.
    let cur = opts.includes(val) ? val : "";
    const btn = el("button", { type: "button", class: "fm-dd-btn" });
    const label = el("span");
    btn.append(label, el("span", { class: "fm-dd-arrow", text: "▾" }));
    const list = el("div", { class: "leader-picker-list fm-dd-list", hidden: true });
    const rows = opts.map((o) => {
      const r = el("div", { class: "leader-picker-row", role: "option", text: o, onclick: () => { cur = o; paint(); list.hidden = true; btn.classList.remove("open"); } });
      list.append(r); return [o, r];
    });
    function paint() {
      label.textContent = cur || "Select…"; label.classList.toggle("fm-dd-ph", !cur);
      rows.forEach(([o, r]) => r.classList.toggle("selected", o === cur));
    }
    btn.addEventListener("click", () => { list.hidden = !list.hidden; btn.classList.toggle("open", !list.hidden); });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) { list.hidden = true; btn.classList.remove("open"); } });
    const wrap = el("div", { class: "fm-dd" }, btn, list);
    paint();
    return { node: wrap, get: () => cur };
  }
  if (t === "priority") {
    // Tap options in order of preference: the first tap is priority 1, the next is 2, and so on.
    // Tapping a chosen option removes it and the later ones move up. Stored as an ordered array.
    const order = (Array.isArray(val) ? val : []).filter((o, i, a) => opts.includes(o) && a.indexOf(o) === i);
    const max = Number(f.max) || 0;
    const box = el("div", { class: "fm-prio", role: "group", "aria-label": f.label || "Priority" });
    const hint = el("p", { class: "fm-prio-hint" });
    const rows = opts.map((o) => {
      const badge = el("span", { class: "fm-prio-badge", "aria-hidden": "true" });
      const r = el("button", { type: "button", class: "fm-prio-row", "aria-pressed": "false" }, badge, el("span", { class: "fm-prio-text", text: o }));
      r.addEventListener("click", () => {
        const at = order.indexOf(o);
        if (at >= 0) order.splice(at, 1);
        else if (!max || order.length < max) order.push(o);
        paint();
      });
      box.append(r);
      return [o, r, badge];
    });
    function paint() {
      rows.forEach(([o, r, badge]) => {
        const at = order.indexOf(o);
        badge.textContent = at >= 0 ? String(at + 1) : "";
        r.classList.toggle("on", at >= 0);
        r.setAttribute("aria-pressed", String(at >= 0));
        r.disabled = !!max && order.length >= max && at < 0;
      });
      const lim = max ? ` (up to ${max})` : "";
      hint.textContent = order.length ? `${order.length} chosen${lim} · tap a chosen option to remove it` : `Tap options in order of priority${lim} — first tap is priority 1`;
    }
    paint();
    return { node: el("div", { class: "fm-prio-wrap" }, box, hint), get: () => (order.length ? [...order] : "") };
  }
  if (t === "multi") {
    const cur = new Set(Array.isArray(val) ? val : []);
    const box = el("div", { class: "member-checklist" });
    opts.forEach((o) => {
      const c = el("input", { type: "checkbox" }); c.checked = cur.has(o);
      c.addEventListener("change", () => { if (c.checked) cur.add(o); else cur.delete(o); });
      box.append(el("label", { class: "member-check-row" }, c, el("span", { text: o })));
    });
    return { node: box, get: () => { const a = opts.filter((o) => cur.has(o)); return a.length ? a : ""; } };
  }
  if (t === "table") {
    // dir "row": one answer per row (choices across = horizontal); dir "col": one answer per column (choices down = vertical)
    const byRow = f.dir !== "col", rows = f.rows || [], cols = f.cols || [];
    const lines = byRow ? rows : cols;
    const cur = {};
    lines.forEach((l) => { const v = val && typeof val === "object" ? val[l] : null; cur[l] = new Set(Array.isArray(v) ? v : v ? [v] : []); });
    const tb = el("tbody");
    rows.forEach((r, ri) => {
      const tr = el("tr", {}, el("th", { class: "fm-rowh", text: r }));
      cols.forEach((c, ci) => {
        const k = byRow ? r : c, o = byRow ? c : r;
        const inp = el("input", { type: f.multi ? "checkbox" : "radio", name: `t_${f.id}_${byRow ? ri : ci}`, "aria-label": `${r} / ${c}` });
        inp.checked = cur[k].has(o);
        inp.addEventListener("change", () => { if (f.multi) { if (inp.checked) cur[k].add(o); else cur[k].delete(o); } else cur[k] = new Set(inp.checked ? [o] : []); });
        tr.append(el("td", {}, inp));
      });
      tb.append(tr);
    });
    const table = el("table", { class: "data-table" }, el("thead", {}, el("tr", {}, el("th"), ...cols.map((c) => el("th", { text: c })))), tb);
    return {
      node: el("div", { class: "datatable-wrap" }, table),
      get: () => { const out = {}; lines.forEach((l) => { const a = [...cur[l]]; if (a.length) out[l] = f.multi ? a : a[0]; }); return Object.keys(out).length ? out : ""; },
      incomplete: () => lines.some((l) => !cur[l].size)
    };
  }
  if (t === "batchmates") return batchmatePicker(f, val, ctx);

  let input, node;
  if (f.type === "long") input = el("textarea", { rows: 4 });
  else if (f.type === "date") input = el("input", { type: "date" });
  else if (f.type === "number") input = el("input", { type: "number", step: "any", inputmode: "decimal" });
  else if (f.type === "link") input = el("input", { type: "url", placeholder: "https://" });
  else input = el("input", { type: "text" });
  node = input;
  let v = val == null ? "" : String(val);
  const pre = f.prefix || "", suf = f.suffix || "";
  const strip = (t) => { // remove the fixed start/end text if it was typed or stored with it
    if (pre && t.toLowerCase().startsWith(pre.toLowerCase())) t = t.slice(pre.length);
    if (suf && t.toLowerCase().endsWith(suf.toLowerCase())) t = t.slice(0, t.length - suf.length);
    return t;
  };
  if (f.type === "prefixed") {
    v = strip(v);
    node = el("div", { class: "fm-prefix" }, pre ? el("span", { class: "fm-affix fm-affix-pre", text: pre }) : null, input, suf ? el("span", { class: "fm-affix fm-affix-suf", text: suf }) : null);
    input.placeholder = "2002547";
  }
  input.value = v;
  return {
    node,
    get() {
      const t = input.value.trim();
      if (!t) return "";
      if (f.type === "prefixed") { const core = strip(t); return core ? pre + core + suf : ""; }
      return t;
    }
  };
}

async function openFill(formId, onDone, skipDraft = false) {
  const ov = $("#fm-fill") || overlay("fm-fill");
  ov.hidden = false;
  ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  box.append(skelEl("fm-loading", "list"));
  let f, resp = null;
  try {
    const s = await getDoc(doc(db, "forms", formId));
    if (!s.exists()) { box.innerHTML = ""; box.append(closeBtn(ov), el("div", { class: "fm-msg" }, el("h3", { text: "Form not found" }), el("p", { text: "This form doesn't exist or was removed." }))); return; }
    f = { id: s.id, ...s.data() };
    const r = await getDoc(doc(db, "forms", formId, "responses", auth.currentUser.uid));
    if (r.exists()) resp = r.data();
  } catch (e) {
    box.innerHTML = ""; box.append(closeBtn(ov), el("div", { class: "fm-msg" }, el("h3", { text: "Couldn't load" }), el("p", { text: "Please try again." }))); return;
  }
  box.innerHTML = "";
  box.append(closeBtn(ov));
  const d = toDate(f.dueAt);
  const msg = (t, p) => box.append(el("div", { class: "fm-msg" }, el("h3", { text: t }), el("p", { text: p })));
  box.append(el("h2", { class: "fm-title", text: f.title || "Form" }));
  if (!isActive(f)) return msg("This form has closed", `It ended on ${fmtDate(d)}.`);
  if (f.collecting === false) return msg("Temporarily closed", "The admins have paused responses for now. Please check back later.");

  const hasBm = (f.fields || []).some((x) => x.type === "batchmates");
  const ctx = { me: null, roster: [], claims: new Map() };
  if (hasBm) {
    try {
      const [m, roster, cs] = await Promise.all([getMe(), getRoster(), getDocs(collection(db, "forms", f.id, "claims"))]);
      ctx.me = m; ctx.roster = roster; cs.docs.forEach((c) => ctx.claims.set(c.id, c.data()));
    } catch (e) { return msg("Couldn't load", "The batchmate list couldn't be loaded. Please try again."); }
    const taken = ctx.claims.get(ctx.me.uid);
    if (taken && taken.leaderUid !== ctx.me.uid) return msg("You're already in a group", `${taken.leaderName || "A group leader"} added you to their group, so only they can fill this form for it.`);
  }

  // ── Draft (auto-saved answers): this device instantly + the account (Firestore) so it follows the person around ──
  const dUid = auth.currentUser.uid, dKey = `fmDraft:${dUid}:${f.id}`, dRef = doc(db, "forms", f.id, "drafts", dUid);
  let draft = null, seed = resp?.answers || {};
  if (skipDraft) {
    try { localStorage.removeItem(dKey); } catch (e) {}
    deleteDoc(dRef).catch(() => {});
  } else {
    try { const l = JSON.parse(localStorage.getItem(dKey) || "null"); if (l?.data) draft = l; } catch (e) {}
    try { const r = await getDoc(dRef); if (r.exists() && r.data()?.data && (!draft || (r.data().savedAt || 0) > (draft.savedAt || 0))) draft = r.data(); } catch (e) {}
    if (draft) { try { seed = JSON.parse(draft.data) || {}; } catch (e) { draft = null; seed = resp?.answers || {}; } }
  }

  const info = dueInfo(d);
  box.append(el("div", { class: "fm-due fm-due-lg", style: `--due:${info.color}` }, el("span", { class: "fm-dot" }), el("b", { text: info.label }), el("span", { class: "fm-card-sub", text: " · Due " + fmtDate(d) })));
  if (f.description) box.append(el("p", { class: "fm-desc", text: f.description }));
  if (f.signup?.fee) box.append(el("div", { class: "fm-edit-note", text: `💰 Amount per student: ${f.signup.cur || "Rs."} ${fmtMoney(f.signup.fee)}` }));
  if (resp) box.append(el("div", { class: "fm-edit-note", text: "✎ You've already submitted — you can edit and save your answers." }));
  if (draft) box.append(el("div", { class: "fm-edit-note fm-draft-note" },
    el("span", { text: `↻ Your unsaved draft was restored (last saved ${fmtDate(new Date(draft.savedAt || Date.now()))}).` }),
    el("button", { type: "button", class: "fm-linkbtn", text: "Start over", onclick: () => { if (confirm("Discard this draft and start over?")) openFill(formId, onDone, true); } })));

  const form = el("form", { class: "fm-form", novalidate: true });
  const pages = splitPages(f.fields || []);
  const multi = pages.length > 1;
  const inputs = new Map(); // question id -> { fd, inp, wrap }
  const pageEls = pages.map((p, pi) => {
    const pg = el("section", { class: "fm-page", hidden: pi !== 0 });
    if (p.section && (p.section.label || p.section.help)) pg.append(el("div", { class: "fm-page-head" },
      p.section.label ? el("h3", { text: p.section.label }) : null, p.section.help ? el("p", { text: p.section.help }) : null));
    p.fields.forEach((fd) => {
      const inp = fieldInput(fd, seed[fd.id], ctx);
      const wrap = el("div", { class: "fm-field" },
        el("label", {}, fd.label, fd.required ? el("span", { class: "fm-req", text: " *" }) : null),
        fd.help ? el("small", { text: fd.help }) : null, inp.node);
      inputs.set(fd.id, { fd, inp, wrap });
      pg.append(wrap);
    });
    return pg;
  });

  // progress indicator (only for forms with more than one page)
  const progLabel = el("b"), progPct = el("span"), progFill = el("i"), stepsEl = el("div", { class: "fm-steps" });
  const progress = multi ? el("div", { class: "fm-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100" },
    el("div", { class: "fm-prog-top" }, progLabel, progPct), el("div", { class: "fm-prog-bar" }, progFill), stepsEl) : null;
  function renderSteps(total, pos) {
    const dots = total > 1 && total <= 8;
    stepsEl.hidden = !dots;
    if (!dots) return;
    if (stepsEl.children.length !== total * 2 - 1) {
      stepsEl.innerHTML = "";
      for (let k = 0; k < total; k++) { if (k) stepsEl.append(el("span", { class: "fm-step-line" })); stepsEl.append(el("span", { class: "fm-step" })); }
    }
    const nodes = [...stepsEl.children];
    for (let k = 0; k < total; k++) {
      const s = nodes[k * 2];
      s.className = "fm-step " + (k < pos ? "done" : k === pos ? "current" : "");
      s.textContent = k < pos ? "✓" : String(k + 1);
      if (k) nodes[k * 2 - 1].className = "fm-step-line" + (k <= pos ? " done" : "");
    }
  }

  const err = el("p", { class: "error-msg", hidden: true });
  let cur = 0, F = null;
  const rawOf = (id) => inputs.get(id)?.inp.get() ?? "";

  const check = (fd, inp) => {
    const v = inp.get();
    if (fd.required && fd.type !== "toggle" && (isEmptyVal(v) || inp.incomplete?.())) return `"${fd.label}" is required${fd.type === "table" ? " — answer every " + (fd.dir === "col" ? "column" : "row") : ""}.`;
    if (fd.type === "priority" && !isEmptyVal(v)) {
      if (Number(fd.min) && v.length < Number(fd.min)) return `"${fd.label}": choose at least ${fd.min} option(s).`;
      if (Number(fd.max) && v.length > Number(fd.max)) return `"${fd.label}": choose at most ${fd.max} option(s).`;
    }
    if (fd.type === "batchmates") {
      const n = isEmptyVal(v) ? 0 : v.length;
      if (Number(fd.min) && n < Number(fd.min)) return `"${fd.label}": select at least ${fd.min} batchmate(s).`;
      if (Number(fd.max) && n > Number(fd.max)) return `"${fd.label}": select at most ${fd.max} batchmate(s).`;
    }
    if (v && fd.type === "link" && !/^https?:\/\/\S+\.\S+/i.test(v)) return `"${fd.label}" needs a valid link starting with http(s)://`;
    if (v && fd.type === "number" && !isFinite(Number(v))) return `"${fd.label}" must be a number.`;
    return "";
  };
  const validatePage = (pi) => {
    for (const fd of pages[pi].fields) { if (!F.vis.get(fd.id)) continue; const m = check(fd, inputs.get(fd.id).inp); if (m) return { fd, msg: m }; }
    return null;
  };
  const showErr = (bad) => {
    err.textContent = bad.msg; err.hidden = false;
    const w = inputs.get(bad.fd.id).wrap;
    w.classList.remove("fm-shake"); void w.offsetWidth; w.classList.add("fm-shake");
    w.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const backBtn = el("button", { type: "button", class: "ghost-btn fm-back", text: "← Back", hidden: true, onclick: () => { refresh(); const pos = F.path.indexOf(cur); if (pos > 0) showPage(F.path[pos - 1], -1); } });
  const nextBtn = el("button", { type: "button", class: "btn-primary", text: "Next →", onclick: () => goNext() });
  const submitBtn = el("button", { type: "submit", class: "btn-primary", text: resp ? "Save changes" : "Submit" });
  const nav = el("div", { class: "fm-nav" }, backBtn, nextBtn, submitBtn);

  // Re-evaluates the logic: shows/hides questions, updates the route, progress and buttons.
  function refresh() {
    F = computeFlow(f.fields || [], rawOf);
    inputs.forEach(({ wrap }, id) => {
      const show = F.vis.get(id) === true;
      if (wrap.hidden === show) {
        wrap.hidden = !show;
        if (show) { wrap.classList.remove("fm-reveal"); void wrap.offsetWidth; wrap.classList.add("fm-reveal"); }
      }
    });
    if (!F.path.includes(cur)) { cur = F.path[F.path.length - 1] ?? 0; pageEls.forEach((p, k) => { p.hidden = k !== cur; }); }
    const pos = F.path.indexOf(cur), total = F.path.length, last = F.next(cur) === -1;
    if (multi) {
      const pct = Math.round(((pos + 1) / total) * 100);
      progLabel.textContent = `Page ${pos + 1} of ${total}`; progPct.textContent = pct + "%";
      progFill.style.width = pct + "%"; progress.setAttribute("aria-valuenow", String(pct));
      renderSteps(total, pos);
    }
    backBtn.hidden = pos <= 0; nextBtn.hidden = last; submitBtn.hidden = !last;
  }
  function showPage(pi, dir) {
    cur = pi;
    pageEls.forEach((p, k) => { p.hidden = k !== pi; });
    const pe = pageEls[pi];
    pe.classList.remove("fm-in-fwd", "fm-in-back");
    if (dir) { void pe.offsetWidth; pe.classList.add(dir > 0 ? "fm-in-fwd" : "fm-in-back"); }
    err.hidden = true;
    refresh(); queueDraft();
    $(".fm-title", box)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function goNext() {
    refresh();
    const bad = validatePage(cur);
    if (bad) return showErr(bad);
    const nx = F.next(cur);
    if (nx != null && nx !== -1) showPage(nx, 1);
  }

  // ── autosave ──
  const draftTag = el("span", { class: "fm-saved" });
  const snapAnswers = () => { const a = {}; inputs.forEach(({ inp }, id) => { a[id] = inp.get(); }); return a; };
  let lastSig = JSON.stringify(snapAnswers()) + "|" + cur, tLocal = null, tCloud = null, tTag = null, closed = false;
  const flashSaved = (t) => { draftTag.textContent = t; draftTag.classList.add("show"); clearTimeout(tTag); tTag = setTimeout(() => draftTag.classList.remove("show"), 2600); };
  function saveDraftLocal() {
    if (closed) return;
    const data = JSON.stringify(snapAnswers()), sig = data + "|" + cur;
    if (sig === lastSig) return;
    lastSig = sig;
    const dr = { savedAt: Date.now(), page: cur, data };
    try { localStorage.setItem(dKey, JSON.stringify(dr)); } catch (e) {}
    draftTag.textContent = "Saving draft…"; draftTag.classList.add("show");
    clearTimeout(tCloud);
    tCloud = setTimeout(async () => {
      if (closed) return;
      try { await setDoc(dRef, dr); flashSaved("✓ Draft saved"); } catch (e) { flashSaved("✓ Draft saved on this device"); }
    }, 1500);
  }
  function queueDraft() { clearTimeout(tLocal); tLocal = setTimeout(saveDraftLocal, 300); }
  const flushDraft = () => {
    if (!form.isConnected) { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", flushDraft); return; }
    clearTimeout(tLocal); saveDraftLocal();
  };
  const onVis = () => { if (document.visibilityState === "hidden") flushDraft(); };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("pagehide", flushDraft);

  let queued = false;
  const sched = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; refresh(); queueDraft(); }); };
  ["input", "change"].forEach((ev) => form.addEventListener(ev, sched));
  form.addEventListener("click", () => setTimeout(sched, 0)); // custom dropdowns, chips, etc.

  form.append(...pageEls, err, el("div", { class: "fm-draft-status" }, draftTag), nav);
  // reopen on the page the person left off (if it's still on their route)
  if (draft && Number.isInteger(draft.page) && draft.page > 0 && draft.page < pages.length) { cur = draft.page; pageEls.forEach((p, k) => { p.hidden = k !== cur; }); }
  refresh();
  lastSig = JSON.stringify(snapAnswers()) + "|" + cur;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    refresh();
    if (F.next(cur) !== -1) return goNext(); // Enter key on a middle page just moves on
    err.hidden = true;
    for (const pi of F.path) {
      const bad = validatePage(pi);
      if (bad) { if (pi !== cur) showPage(pi, -1); return showErr(bad); }
    }
    // Only questions that were actually shown are saved; hidden ones are stored empty.
    const answers = {};
    (f.fields || []).filter(isQ).forEach((fd) => { answers[fd.id] = F.vis.get(fd.id) === true ? inputs.get(fd.id).inp.get() : ""; });
    submitBtn.disabled = true; submitBtn.textContent = "Saving…";
    try {
      const m = await getMe();
      // One atomic batch: the response + the group "claims" that hide chosen students from other groups.
      const wb = writeBatch(db);
      wb.set(doc(db, "forms", f.id, "responses", m.uid), {
        uid: m.uid, name: m.name, index: m.index, answers,
        firstSubmittedAt: resp?.firstSubmittedAt || serverTimestamp(),
        respondedAt: serverTimestamp()
      });
      const bmField = (f.fields || []).find((x) => x.type === "batchmates");
      if (bmField) {
        const shown = F.vis.get(bmField.id) === true; // a hidden group field means no group is claimed
        const members = shown && Array.isArray(answers[bmField.id]) ? answers[bmField.id] : [];
        const keep = shown ? new Set([m.uid, ...members.map((x) => x.uid)]) : new Set();
        keep.forEach((uid) => wb.set(doc(db, "forms", f.id, "claims", uid), { leaderUid: m.uid, leaderName: m.name, fieldId: bmField.id }));
        ctx.claims.forEach((c, uid) => { if (c.leaderUid === m.uid && !keep.has(uid)) wb.delete(doc(db, "forms", f.id, "claims", uid)); });
      }
      await wb.commit();
      closed = true; clearTimeout(tLocal); clearTimeout(tCloud); // the draft has served its purpose
      try { localStorage.removeItem(dKey); } catch (e) {}
      deleteDoc(dRef).catch(() => {});
      box.innerHTML = "";
      box.append(closeBtn(ov), el("div", { class: "fm-msg ok" }, el("div", { class: "fm-tick", text: "✓" }), el("h3", { text: resp ? "Changes saved" : "Submitted!" }), el("p", { text: "You can reopen this form any time before the due date to edit your answers." }),
        el("button", { class: "btn-primary", type: "button", text: "Done", onclick: () => { ov.hidden = true; } })));
      if (onDone) onDone();
    } catch (x) {
      err.textContent = hasBm ? "Couldn't save — the form may have closed, or someone you picked was just added to another group. Close and reopen the form to refresh the list." : "Couldn't save — the form may have just closed. Please try again."; err.hidden = false;
      submitBtn.disabled = false; submitBtn.textContent = resp ? "Save changes" : "Submit";
    }
  });
  if (progress) box.append(progress);
  box.append(form);
}

// ═════════════════ ADMIN SIDE (admin.html) ═════════════════
let formsCache = [];

async function initAdmin() {
  const activeBox = $("#admin-forms-active"), histBox = $("#admin-forms-history"), newBtn = $("#new-form-btn");
  if (!activeBox || !histBox || !newBtn) return;
  buildBuilder();

  async function render() {
    if (!hasPerm("forms")) {
      const m = '<p class="info-text" style="color:var(--muted)">⚠ You don\'t have access to Forms.</p>';
      activeBox.innerHTML = histBox.innerHTML = m; return;
    }
    activeBox.innerHTML = histBox.innerHTML = skeletonHTML("list");
    formsCache = await fetchForms();
    const act = formsCache.filter(isActive).sort((a, b) => toDate(a.dueAt) - toDate(b.dueAt));
    const old = formsCache.filter((f) => !isActive(f)).sort((a, b) => toDate(b.dueAt) - toDate(a.dueAt));
    activeBox.innerHTML = histBox.innerHTML = "";
    if (!act.length) activeBox.innerHTML = '<p class="info-text" style="color:var(--muted)">No active forms.</p>';
    if (!old.length) histBox.innerHTML = '<p class="info-text" style="color:var(--muted)">No finished forms yet.</p>';
    act.forEach((f) => activeBox.append(adminCard(f, true)));
    old.forEach((f) => histBox.append(adminCard(f, false)));
  }
  function adminCard(f, active) {
    const d = toDate(f.dueAt), info = dueInfo(d);
    const linkBtn = el("button", { type: "button", class: "fm-linkbtn", text: "🔗 Copy link", onclick: async (e) => {
      try { await navigator.clipboard.writeText(formLink(f.id)); e.target.textContent = "✓ Copied"; setTimeout(() => { e.target.textContent = "🔗 Copy link"; }, 1500); } catch (x) { prompt("Copy this link:", formLink(f.id)); }
    } });
    const btns = el("div", { class: "fm-admin-btns" });
    if (active) {
      const sw = el("input", { type: "checkbox" }); sw.checked = f.collecting !== false;
      sw.addEventListener("change", async () => {
        try { await updateDoc(doc(db, "forms", f.id), { collecting: sw.checked }); f.collecting = sw.checked; }
        catch (e) { sw.checked = !sw.checked; alert("Couldn't update — please try again."); }
        lbl.textContent = sw.checked ? "Collecting" : "Paused";
      });
      const lbl = el("span", { text: sw.checked ? "Collecting" : "Paused" });
      btns.append(
        el("button", { type: "button", class: "ghost-btn", text: "Edit fields", onclick: () => openBuilder(f) }),
        el("button", { type: "button", class: "ghost-btn", text: "View responses", onclick: () => openResponses(f) }),
        el("label", { class: "fm-switch" }, sw, el("i"), lbl),
        el("button", { type: "button", class: "ghost-btn fm-del", text: "Delete", onclick: () => deleteFormAndData(f, render) }));
    } else {
      btns.append(
        el("button", { type: "button", class: "ghost-btn", text: "View responses", onclick: () => openResponses(f) }),
        el("button", { type: "button", class: "ghost-btn", text: "Publish again", onclick: () => openRepublish(f, render) }),
        el("button", { type: "button", class: "ghost-btn fm-del", text: "Delete", onclick: () => deleteFormAndData(f, render) }));
    }
    return el("div", { class: "fm-admin-card" },
      el("div", { class: "fm-admin-top" }, el("div", {}, el("div", { class: "fm-card-name", text: f.title || "Untitled form" }),
        active ? el("div", { class: "fm-due", style: `--due:${info.color}` }, el("span", { class: "fm-dot" }), el("b", { text: info.label }), el("span", { class: "fm-card-sub", text: " · Due " + fmtDate(d) }))
          : el("div", { class: "fm-card-sub", text: "Ended " + fmtDate(d) })), linkBtn),
      btns);
  }

  newBtn.addEventListener("click", () => { if (!hasPerm("forms")) return denied(); openBuilder(null); });
  $("#refresh-forms-active")?.addEventListener("click", render);
  $("#refresh-forms-history")?.addEventListener("click", render);
  window.__formsRefresh = render;
  await render();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".forms-modal:not([hidden])").forEach((o) => { if (o.id !== "fm-builder") o.hidden = true; }); });
}

// ── Builder (new form / edit fields) ──
let B = null; // builder state
function buildBuilder() {
  const ov = overlay("fm-builder", "fm-wide");
  B = { ov, editing: null, fields: [] };
  B.title = el("input", { type: "text", placeholder: "Form title", class: "fm-title-input" });
  B.desc = el("textarea", { rows: 2, placeholder: "Description (optional)" });
  B.due = el("input", { type: "datetime-local" });
  // Form type: a "sign-up list" (trip / event) can print a one-page tick-sheet PDF from its responses.
  B.kind = el("select", {}, el("option", { value: "standard", text: "Standard form" }), el("option", { value: "signup", text: "Sign-up list (trip / event) — printable PDF sheet" }));
  B.sFee = el("input", { type: "number", min: "0", step: "any", inputmode: "decimal", placeholder: "Amount per student (optional)" });
  B.sCur = el("input", { type: "text", maxlength: "8", placeholder: "Currency, e.g. Rs." });
  B.sNote = el("input", { type: "text", maxlength: "120", placeholder: "Line under the PDF title (optional), e.g. Trip fund collection" });
  B.signupPanel = el("div", { class: "fm-signup-panel", hidden: true },
    el("small", { text: "Students' names and index numbers come from their accounts. In the responses, “Trip sheet PDF” prints the form title, a tick box before each name, the amount per student, a blank date and two blank signature lines on one page." }),
    el("div", { class: "fm-brow" }, B.sFee, B.sCur), B.sNote);
  B.kind.addEventListener("change", () => {
    B.signupPanel.hidden = B.kind.value !== "signup";
    // untouched starter field → swap in a ready-made "Are you going?" question
    if (B.kind.value === "signup" && B.fields.length === 1 && B.fields[0].type === "short" && !(B.fields[0].label || "").trim()) {
      B.fields = [{ id: "_going", type: "yesno", label: "Are you going?", required: true, prefix: "", help: "" }]; renderFields();
    }
  });
  B.list = el("div", { class: "fm-builder-list" });
  B.push = pushControls(true, "Send push notification");
  B.err = el("p", { class: "error-msg", hidden: true });
  B.result = el("div", { class: "fm-msg ok", hidden: true });
  B.saveBtn = el("button", { type: "button", class: "btn-primary", onclick: saveForm });
  B.heading = el("p", { class: "section-label" });
  const chips = el("div", { class: "fm-addrow" }, el("span", { text: "Add field:" }),
    ...Object.entries(TYPES).map(([t, l]) => el("button", { type: "button", class: "fm-addchip", text: "+ " + l, onclick: () => {
      if (t === "batchmates" && B.fields.some((x) => x.type === "batchmates")) { B.err.textContent = "A form can have only one batchmate selection field."; B.err.hidden = false; return; }
      B.err.hidden = true;
      B.fields.push({ id: newId(), type: t, label: "", required: false, prefix: t === "prefixed" ? "AS" : "", help: "" }); renderFields(); } })),
    el("button", { type: "button", class: "fm-addchip fm-addpage", text: "＋ Page break", onclick: () => {
      B.err.hidden = true;
      if (!B.fields.length || B.fields[0].type !== "section") B.fields.unshift(newSection()); // page 1 gets its own header
      B.fields.push(newSection()); renderFields(); } }));
  B.body = el("div", { class: "admin-modal-body fm-builder-body" }, B.heading,
    el("label", { text: "Form title" }), B.title, el("label", { text: "Description" }), B.desc,
    el("label", { text: "Due date & time" }), B.due,
    el("label", { text: "Form type" }), B.kind, B.signupPanel,
    el("p", { class: "section-label", style: "margin-top:18px;", text: "Fields" }), B.list, chips,
    B.pushWrap = el("div", { style: "margin-top:18px;" }, B.push.root), B.err, B.saveBtn);
  B.box = el("div", { class: "modal-box" }, closeBtn(ov), B.body, B.result);
  ov.append(B.box);
}

function renderFields() {
  B.list.innerHTML = "";
  if (!B.fields.length) B.list.append(el("p", { class: "fine-print", style: "text-align:left", text: "No fields yet — add one below." }));
  const pg = splitPages(B.fields), pageOf = new Map();
  pg.forEach((p, k) => { if (p.section) pageOf.set(p.section.id, k); p.fields.forEach((q) => pageOf.set(q.id, k)); });
  const pageName = (k) => `Page ${k + 1}${pg[k].section?.label?.trim() ? " — " + pg[k].section.label.trim() : ""}`;
  const targetsAfter = (k) => [{ v: "", t: "Continue to next page" }, { v: "submit", t: "Submit form" },
    ...pg.flatMap((p, j) => (j > k && p.section ? [{ v: p.section.id, t: "Go to " + pageName(j) }] : []))];
  const targetSelect = (val, k, set) => {
    const list = targetsAfter(k);
    const s = el("select", {}, ...list.map((o) => el("option", { value: o.v, text: o.t })));
    s.value = list.some((o) => o.v === val) ? val : "";
    s.addEventListener("change", () => set(s.value));
    return s;
  };

  // IF-conditions editor (used by question visibility and page routing rules)
  const condEditor = (cs, cands) => {
    cs.conds ||= [];
    const box = el("div", { class: "fm-cond" });
    if (cs.conds.length > 1) {
      const m = el("select", {}, el("option", { value: "all", text: "Match ALL conditions" }), el("option", { value: "any", text: "Match ANY condition" }));
      m.value = cs.match === "any" ? "any" : "all"; m.addEventListener("change", () => { cs.match = m.value; });
      box.append(m);
    }
    cs.conds.forEach((c, ci) => {
      const q = cands.find((x) => x.id === c.src), t = q?.type, ops = t ? opsFor(t) : [];
      if (t && !ops.includes(c.op)) c.op = ops[0];
      const src = el("select", {}, el("option", { value: "", text: "Question…" }), ...cands.map((x) => el("option", { value: x.id, text: (x.label || "").trim() || "(untitled question)" })));
      src.value = q ? q.id : "";
      src.addEventListener("change", () => { c.src = src.value; const nt = cands.find((x) => x.id === c.src)?.type; c.op = nt ? opsFor(nt)[0] : "eq"; c.val = ""; renderFields(); });
      const row = el("div", { class: "fm-cond-row" }, src);
      if (q) {
        const op = el("select", {}, ...ops.map((o) => el("option", { value: o, text: opLabel(t, o) })));
        op.value = c.op; op.addEventListener("change", () => { c.op = op.value; renderFields(); });
        row.append(op);
        if (opNeedsValue(c.op)) {
          const ch = condChoices(q);
          let vi;
          if (ch) {
            vi = el("select", {}, el("option", { value: "", text: "Answer…" }), ...ch.map((o) => el("option", { value: o, text: o })));
            vi.value = ch.includes(c.val) ? c.val : ""; vi.addEventListener("change", () => { c.val = vi.value; });
          } else {
            vi = el("input", { type: t === "number" ? "number" : t === "date" ? "date" : "text", placeholder: "Value" });
            vi.value = c.val ?? ""; vi.addEventListener("input", () => { c.val = vi.value; });
          }
          row.append(vi);
        }
      }
      row.append(el("button", { type: "button", class: "ghost-btn fm-del fm-x", text: "✕", "aria-label": "Remove condition", onclick: () => { cs.conds.splice(ci, 1); renderFields(); } }));
      box.append(row);
    });
    box.append(el("button", { type: "button", class: "fm-addchip", text: "＋ Add condition", onclick: () => { cs.conds.push({ src: "", op: "eq", val: "" }); renderFields(); } }));
    return box;
  };

  // "Show this question only if…"
  const logicPanel = (f, i) => {
    const cands = B.fields.slice(0, i).filter(isQ);
    const n = f.logic?.conds?.length || 0;
    const det = el("details", { class: "fm-logic", open: !!f._uiL || n > 0 });
    det.addEventListener("toggle", () => { f._uiL = det.open; });
    det.append(el("summary", { text: n ? `⚡ Show only if… (${n} condition${n > 1 ? "s" : ""})` : "⚡ Show only if… (conditional question)" }));
    if (!cands.length) { det.append(el("small", { text: "Add a question above this one to use its answer as a condition." })); return det; }
    if (!f.logic) f.logic = { match: "all", conds: [] };
    det.append(el("small", { text: "This question only appears when the conditions below are met. Hidden questions are never required." }), condEditor(f.logic, cands));
    return det;
  };

  // "Go to page based on the answer" (select / yes-no)
  const branchPanel = (f) => {
    if (f.type !== "select" && f.type !== "yesno") return null;
    const opts = f.type === "yesno" ? ["Yes", "No"] : cleanList(f.options);
    if (!opts.length) return null;
    const k = pageOf.get(f.id);
    f.branch ||= [];
    const det = el("details", { class: "fm-logic", open: !!f._uiB || f.branch.length > 0 });
    det.addEventListener("toggle", () => { f._uiB = det.open; });
    det.append(el("summary", { text: f.branch.length ? `↪ Go to page by answer (${f.branch.length} set)` : "↪ Go to a different page based on the answer" }),
      el("small", { text: "Choose where the form jumps after this page for each answer. If several questions on a page jump somewhere, the first one wins." }));
    opts.forEach((o) => {
      const curTo = f.branch.find((b) => b.o === o)?.to || "";
      det.append(el("div", { class: "fm-cond-row" }, el("span", { class: "fm-branch-opt", text: o }),
        targetSelect(curTo, k, (v) => { f.branch = f.branch.filter((b) => b.o !== o); if (v) f.branch.push({ o, to: v }); })));
    });
    return det;
  };

  // "Save this answer to the profile"
  const profilePanel = (f) => {
    if (!PROFILE_TYPES.has(f.type)) return null;
    const p = f.profile, groups = profileGroups();
    const gName = p?.on ? (p.group === "__new" ? (p.groupTitle || "new section") : groups.find((g) => g.id === p.group)?.title || "—") : "";
    const det = el("details", { class: "fm-logic", open: !!f._uiP || !!p?.on });
    det.addEventListener("toggle", () => { f._uiP = det.open; });
    det.append(el("summary", { text: p?.on ? `👤 Saved to profile → ${gName}` : "👤 Save this answer to the profile (optional)" }));
    const chk = el("input", { type: "checkbox" }); chk.checked = !!p?.on;
    chk.addEventListener("change", () => {
      f.profile = f.profile || {}; f.profile.on = chk.checked; f._uiP = true;
      if (chk.checked) { f.profile.label ||= (f.label || "").trim(); f.profile.key ||= slugKey(f.label); f.profile.group ||= groups[0]?.id || "__new"; }
      renderFields();
    });
    det.append(el("label", { class: "fm-check" }, chk, el("span", { text: "Add this answer to each person's private profile" })));
    if (p?.on) {
      const lab = el("input", { type: "text", placeholder: "Field name shown on the profile" }); lab.value = p.label || "";
      const key = el("input", { type: "text", placeholder: "key, e.g. favouriteSport", maxlength: "40" }); key.value = p.key || "";
      lab.addEventListener("input", () => { p.label = lab.value; if (!p._k) { p.key = slugKey(lab.value); key.value = p.key; } });
      key.addEventListener("input", () => { p._k = true; p.key = key.value.trim(); });
      const sec = el("select", {}, ...groups.map((g) => el("option", { value: g.id, text: g.title || g.id })), el("option", { value: "__new", text: "＋ New section…" }));
      sec.value = groups.some((g) => g.id === p.group) || p.group === "__new" ? p.group : groups[0]?.id;
      if (!p.group || (p.group !== "__new" && !groups.some((g) => g.id === p.group))) p.group = sec.value;
      sec.addEventListener("change", () => { p.group = sec.value; renderFields(); });
      det.append(el("div", { class: "fm-cond-row" }, el("span", { class: "fm-branch-opt", text: "Section" }), sec),
        el("div", { class: "fm-cond-row" }, el("span", { class: "fm-branch-opt", text: "Field name" }), lab),
        el("div", { class: "fm-cond-row" }, el("span", { class: "fm-branch-opt", text: "Key" }), key));
      if (p.group === "__new") {
        const gt = el("input", { type: "text", placeholder: "New section title, e.g. Hobbies" }); gt.value = p.groupTitle || "";
        gt.addEventListener("input", () => { p.groupTitle = gt.value; });
        det.append(el("div", { class: "fm-cond-row" }, el("span", { class: "fm-branch-opt", text: "Title" }), gt));
      }
      det.append(el("small", { text: `Stored as batchmates.${p.key || "key"} — private, never shown in the directory. An admin imports it from the form's Responses screen.` }));
    }
    return det;
  };

  // Page break card
  const sectionCard = (f, i) => {
    const k = pageOf.get(f.id);
    const nextSec = B.fields.findIndex((x, n) => n > i && x.type === "section");
    const end = nextSec < 0 ? B.fields.length : nextSec;
    const cands = B.fields.slice(0, end).filter(isQ); // a page's rules may use any answer up to the end of that page
    const title = el("input", { type: "text", placeholder: "Page title (optional)" }); title.value = f.label || "";
    title.addEventListener("input", () => { f.label = title.value; });
    const help = el("input", { type: "text", placeholder: "Page description (optional)" }); help.value = f.help || "";
    help.addEventListener("input", () => { f.help = help.value; });
    f.routes ||= [];
    const routeEls = f.routes.map((r, ri) => {
      r.conds ||= [];
      return el("div", { class: "fm-route" },
        el("div", { class: "fm-chain", text: "IF" }), condEditor(r, cands),
        el("div", { class: "fm-brow" }, el("span", { class: "fm-chain", text: "THEN" }), targetSelect(r.goto || "", k, (v) => { r.goto = v; }),
          el("button", { type: "button", class: "ghost-btn fm-del fm-x", text: "✕", "aria-label": "Remove rule", onclick: () => { f.routes.splice(ri, 1); renderFields(); } })));
    });
    const addQ = el("select", { class: "fm-addq" }, el("option", { value: "", text: "＋ Add a question to this page…" }), ...Object.entries(TYPES).map(([t, l]) => el("option", { value: t, text: l })));
    addQ.addEventListener("change", () => {
      const t = addQ.value; if (!t) return;
      if (t === "batchmates" && B.fields.some((x) => x.type === "batchmates")) { addQ.value = ""; B.err.textContent = "A form can have only one batchmate selection field."; B.err.hidden = false; return; }
      B.err.hidden = true;
      B.fields.splice(end, 0, { id: newId(), type: t, label: "", required: false, prefix: t === "prefixed" ? "AS" : "", help: "" });
      renderFields();
    });
    const movePage = (dir) => () => {
      const bounds = [...(B.fields[0]?.type === "section" ? [] : [0]), ...B.fields.map((x, n) => (x.type === "section" ? n : -1)).filter((n) => n >= 0)];
      const blocks = bounds.map((b, n) => B.fields.slice(b, bounds[n + 1] ?? B.fields.length));
      const bi = bounds.indexOf(i), tj = bi + dir;
      if (tj < 0 || tj >= blocks.length || blocks[tj][0].type !== "section") return;
      [blocks[bi], blocks[tj]] = [blocks[tj], blocks[bi]];
      B.fields = blocks.flat(); renderFields();
    };
    return el("div", { class: "fm-bfield fm-bsection" },
      el("div", { class: "fm-brow" }, el("span", { class: "fm-pagebadge", text: `PAGE ${k + 1} OF ${pg.length}` })),
      title, help,
      el("label", { class: "fm-sublabel", text: "After this page" }), targetSelect(f.next || "", k, (v) => { f.next = v; }),
      ...routeEls,
      el("div", { class: "fm-brow" }, el("button", { type: "button", class: "fm-addchip", text: "＋ Add routing rule (if … then go to page …)", onclick: () => { f.routes.push({ match: "all", conds: [{ src: "", op: "eq", val: "" }], goto: "" }); renderFields(); } })),
      addQ,
      el("div", { class: "fm-brow fm-bactions" }, el("small", { text: "Rules are checked top to bottom; the first match wins." }), el("span", { class: "fm-spacer" }),
        el("button", { type: "button", class: "ghost-btn", text: "↑ Page", onclick: movePage(-1) }),
        el("button", { type: "button", class: "ghost-btn", text: "↓ Page", onclick: movePage(1) }),
        el("button", { type: "button", class: "ghost-btn fm-del", text: "Remove page break", onclick: () => { B.fields.splice(i, 1); renderFields(); } })));
  };

  B.fields.forEach((f, i) => {
    if (f.type === "section") { B.list.append(sectionCard(f, i)); return; }
    const type = el("select", {}, ...Object.entries(TYPES).map(([t, l]) => el("option", { value: t, text: l })));
    type.value = f.type;
    type.addEventListener("change", () => {
      if (type.value === "batchmates" && B.fields.some((x) => x !== f && x.type === "batchmates")) { type.value = f.type; B.err.textContent = "A form can have only one batchmate selection field."; B.err.hidden = false; return; }
      B.err.hidden = true; f.type = type.value; if (f.type === "prefixed" && !f.prefix) f.prefix = "AS"; renderFields(); });
    const lines = (key, ph, rows = 3) => { const ta = el("textarea", { rows, placeholder: ph }); ta.value = (f[key] || []).join("\n"); ta.addEventListener("input", () => { f[key] = ta.value.split("\n"); }); return ta; };
    const num = (key, ph) => { const n = el("input", { type: "number", min: "0", placeholder: ph }); n.value = f[key] || ""; n.addEventListener("input", () => { f[key] = n.value; }); return n; };
    let extra = null;
    if (f.type === "select" || f.type === "multi") extra = el("div", { class: "fm-brow fm-bcol" }, lines("options", "Options — one per line"));
    else if (f.type === "priority") extra = el("div", { class: "fm-bcol" }, el("div", { class: "fm-brow fm-bcol" }, lines("options", "Options — one per line")),
      el("div", { class: "fm-brow" }, num("min", "Min choices (optional)"), num("max", "Max choices (optional)")),
      el("small", { text: "Students tap options in order; each chosen option shows its priority number. Responses list them from priority 1 downwards." }));
    else if (f.type === "table") {
      const dir = el("select", {}, el("option", { value: "row", text: "One answer per row (choices across ↔ horizontal)" }), el("option", { value: "col", text: "One answer per column (choices down ↕ vertical)" }));
      dir.value = f.dir === "col" ? "col" : "row"; dir.addEventListener("change", () => { f.dir = dir.value; });
      const multi = el("input", { type: "checkbox" }); multi.checked = !!f.multi; multi.addEventListener("change", () => { f.multi = multi.checked; });
      extra = el("div", { class: "fm-bcol" }, el("div", { class: "fm-brow" }, lines("rows", "Rows — one per line"), lines("cols", "Columns — one per line")),
        el("div", { class: "fm-brow" }, dir), el("label", { class: "fm-req-toggle" }, multi, el("span", { text: "Allow multiple answers per row/column" })));
    } else if (f.type === "rating") {
      f.style = RATING_STYLES[f.style] ? f.style : "stars"; f.max = ratingMax(f);
      const style = el("select", {}, ...Object.entries(RATING_STYLES).map(([k, l]) => el("option", { value: k, text: l })));
      style.value = f.style; style.addEventListener("change", () => { f.style = style.value; renderFields(); });
      const max = el("select", {}, ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => el("option", { value: n, text: n + " levels" })));
      max.value = String(f.max); max.disabled = f.style === "emoji"; max.addEventListener("change", () => { f.max = Number(max.value); });
      const lbl = (key, ph) => { const i2 = el("input", { type: "text", placeholder: ph, maxlength: "24" }); i2.value = f[key] || ""; i2.addEventListener("input", () => { f[key] = i2.value; }); return i2; };
      extra = el("div", { class: "fm-bcol" }, el("div", { class: "fm-brow" }, style, max),
        el("div", { class: "fm-brow" }, lbl("lo", "Low label, e.g. Poor"), lbl("hi", "High label, e.g. Excellent")),
        el("small", { text: "Emoji faces always use 5 levels. Users can tap the same rating again to clear it." }));
    } else if (f.type === "batchmates") extra = el("div", { class: "fm-bcol" }, el("div", { class: "fm-brow" }, num("min", "Min members (optional)"), num("max", "Max members (optional)")),
      el("small", { text: "Whoever fills the form becomes the group leader. Picked students (and the leader) disappear from other groups' lists." }));
    const label = el("input", { type: "text", placeholder: "Question / field name" }); label.value = f.label;
    label.addEventListener("input", () => { f.label = label.value; });
    const help = el("input", { type: "text", placeholder: "Helper text (optional)" }); help.value = f.help || "";
    help.addEventListener("input", () => { f.help = help.value; });
    const req = el("input", { type: "checkbox" }); req.checked = !!f.required;
    req.addEventListener("change", () => { f.required = req.checked; });
    const hint = el("small");
    const showHint = () => { hint.textContent = "Users type only the middle part, e.g. 2002547 → " + (f.prefix || "") + "2002547" + (f.suffix || ""); };
    const prefix = el("input", { type: "text", placeholder: "Starting text, e.g. AS", class: "fm-prefix-input", hidden: f.type !== "prefixed" }); prefix.value = f.prefix || "";
    prefix.addEventListener("input", () => { f.prefix = prefix.value.trim(); showHint(); });
    const suffix = el("input", { type: "text", placeholder: "Ending text, e.g. @uni.lk", class: "fm-prefix-input", hidden: f.type !== "prefixed" }); suffix.value = f.suffix || "";
    suffix.addEventListener("input", () => { f.suffix = suffix.value.trim(); showHint(); });
    showHint();
    const mv = (dir) => () => { const j = i + dir; if (j < 0 || j >= B.fields.length) return; [B.fields[i], B.fields[j]] = [B.fields[j], B.fields[i]]; renderFields(); };
    B.list.append(el("div", { class: "fm-bfield" },
      el("div", { class: "fm-brow" }, label, type),
      f.type === "prefixed" ? el("div", { class: "fm-brow fm-affixrow" }, prefix, suffix, hint) : null,
      extra,
      el("div", { class: "fm-brow" }, help),
      logicPanel(f, i), branchPanel(f), profilePanel(f),
      el("div", { class: "fm-brow fm-bactions" },
        f.type === "toggle" ? null : el("label", { class: "fm-req-toggle" }, req, el("span", { text: "Required" })),
        el("span", { class: "fm-spacer" }),
        el("button", { type: "button", class: "ghost-btn", text: "↑", onclick: mv(-1) }),
        el("button", { type: "button", class: "ghost-btn", text: "↓", onclick: mv(1) }),
        el("button", { type: "button", class: "ghost-btn fm-del", text: "Delete", onclick: () => { B.fields.splice(i, 1); renderFields(); } }))));
  });
}

function openBuilder(form) {
  B.editing = form;
  B.err.hidden = true; B.result.hidden = true; B.body.hidden = false;
  B.heading.textContent = form ? "Edit Form Fields" : "New Form";
  B.saveBtn.textContent = form ? "Save changes" : "Create & publish form";
  B.saveBtn.disabled = false;
  B.title.value = form?.title || "";
  B.desc.value = form?.description || "";
  B.due.value = form ? toInputValue(toDate(form.dueAt)) : "";
  B.kind.value = form?.signup ? "signup" : "standard";
  B.sFee.value = form?.signup?.fee ? String(form.signup.fee) : "";
  B.sCur.value = form?.signup?.cur || "";
  B.sNote.value = form?.signup?.note || "";
  B.signupPanel.hidden = B.kind.value !== "signup";
  B.fields = form ? JSON.parse(JSON.stringify(form.fields || [])) : [{ id: newId(), type: "short", label: "", required: true, prefix: "", help: "" }];
  B.fields.forEach((f) => { if (f.profile) f.profile.on = true; });
  loadProfileGroups().then(() => { if (!B.ov.hidden) renderFields(); });
  B.push = B.push; B.push.reset();
  // edit mode: notification is opt-in
  const cb = B.push.root.querySelector("input[type=checkbox]"); cb.checked = !form; cb.dispatchEvent(new Event("change"));
  B.push.root.querySelector(".push-toggle-row span").textContent = form ? "Notify batch that this form was updated" : "Send push notification";
  renderFields();
  B.ov.hidden = false;
}

// Checks pages / conditions / jumps before saving. Returns an error message or "".
function validateFlow() {
  const F = B.fields, pg = splitPages(F), idx = new Map(F.map((x, n) => [x.id, n]));
  const qn = (x) => `"${(x.label || "").trim() || "Untitled question"}"`;
  const conds = (cs, limit, who) => {
    for (const c of cs?.conds || []) {
      const n = idx.get(c.src), q = F[n];
      if (!c.src || n === undefined || !isQ(q)) return `${who}: a condition has no question picked (or its question was deleted).`;
      if (n >= limit) return `${who}: a condition uses ${qn(q)}, which comes later. Conditions can only use earlier questions.`;
      if (!opsFor(q.type).includes(c.op)) return `${who}: pick how ${qn(q)} should be compared.`;
      if (opNeedsValue(c.op)) { const ch = condChoices(q); if (ch ? !ch.includes(c.val) : !String(c.val ?? "").trim()) return `${who}: choose the answer to compare ${qn(q)} with.`; }
    }
    return "";
  };
  for (let i = 0; i < F.length; i++) {
    const x = F[i];
    if (x.type === "section") {
      const k = pg.findIndex((p) => p.section === x), name = `Page ${k + 1}`;
      const nextSec = F.findIndex((y, n) => n > i && y.type === "section"), end = nextSec < 0 ? F.length : nextSec;
      if (!pg[k].fields.length && !(x.help || "").trim()) return `${name} is empty — add a question or remove the page break.`;
      if (x.next && !targetOk(pg, k, x.next)) return `${name}: "After this page" points to a page that no longer exists.`;
      for (const r of x.routes || []) {
        if (!r.conds?.length) return `${name}: a routing rule has no condition.`;
        const e = conds(r, end, name); if (e) return e;
        if (!r.goto) return `${name}: choose where each routing rule should go.`;
        if (!targetOk(pg, k, r.goto)) return `${name}: a routing rule jumps to a page that no longer exists.`;
      }
    } else {
      const k = pg.findIndex((p) => p.fields.includes(x));
      if (x.logic?.conds?.length) { const e = conds(x.logic, i, qn(x)); if (e) return e; }
      for (const b of x.branch || []) if (!targetOk(pg, k, b.to)) return `${qn(x)}: an answer jumps to a page that no longer exists (or is not after this question's page).`;
    }
  }
  return "";
}

function validateProfile() {
  const seen = new Set(), existing = profileGroups().flatMap((g) => g.fields || []);
  for (const f of B.fields) {
    if (f.type === "section" || !f.profile?.on || !PROFILE_TYPES.has(f.type)) continue;
    const p = f.profile, nm = `"${(f.label || "").trim() || "Untitled question"}"`;
    if (!(p.label || "").trim()) return `${nm}: give the profile field a name.`;
    if (!/^[a-z][a-zA-Z0-9]{1,39}$/.test(p.key || "")) return `${nm}: the profile key must be letters/numbers only and start with a lowercase letter (e.g. favouriteSport).`;
    if (PROFILE_RESERVED.has(p.key)) return `${nm}: "${p.key}" is reserved — choose another key.`;
    const ex = existing.find((x) => x.key === p.key);
    if (ex && !ex.fromForm) return `${nm}: "${p.key}" is already a built-in profile field — choose a new key.`;
    if (seen.has(p.key)) return `Two questions use the same profile key "${p.key}".`;
    seen.add(p.key);
    if (p.group === "__new" ? !(p.groupTitle || "").trim() : !p.group) return `${nm}: choose the profile section it belongs to.`;
  }
  return "";
}

async function saveForm() {
  const fail = (t) => { B.err.textContent = t; B.err.hidden = false; };
  B.err.hidden = true;
  const title = B.title.value.trim();
  if (!title) return fail("Give the form a title.");
  if (!B.due.value) return fail("Pick a due date & time.");
  const due = new Date(B.due.value);
  if (isNaN(due) || due <= new Date()) return fail("Due date must be in the future.");
  if (!B.fields.some(isQ)) return fail("Add at least one field.");
  for (const f of B.fields) {
    if (f.type === "section") continue;
    if (!f.label.trim()) return fail("Every field needs a label.");
    if (f.type === "prefixed" && !f.prefix && !f.suffix) return fail(`"${f.label}" needs starting text, ending text, or both (e.g. AS).`);
    const clean = (a) => (a || []).map((x) => x.trim()).filter(Boolean);
    const uniq = (a) => new Set(a.map((x) => x.toLowerCase())).size === a.length;
    if (f.type === "select" || f.type === "multi") { const o = clean(f.options); if (o.length < 2) return fail(`"${f.label}" needs at least 2 options.`); if (!uniq(o)) return fail(`"${f.label}" has duplicate options.`); }
    if (f.type === "priority") {
      const o = clean(f.options); if (o.length < 2) return fail(`"${f.label}" needs at least 2 options.`); if (!uniq(o)) return fail(`"${f.label}" has duplicate options.`);
      const mn = Number(f.min) || 0, mx = Number(f.max) || 0;
      if (mx && mx > o.length) return fail(`"${f.label}": max choices can't be more than the number of options.`);
      if (mn && mx && mn > mx) return fail(`"${f.label}": min choices can't be more than max choices.`);
      if (mn > o.length) return fail(`"${f.label}": min choices can't be more than the number of options.`);
    }
    if (f.type === "table") { const r = clean(f.rows), c = clean(f.cols); if (!r.length || !c.length) return fail(`"${f.label}" needs at least 1 row and 1 column.`); if (!uniq(r) || !uniq(c)) return fail(`"${f.label}" has duplicate rows or columns.`); }
    if (f.type === "batchmates" && Number(f.min) && Number(f.max) && Number(f.min) > Number(f.max)) return fail(`"${f.label}": min can't be more than max.`);
  }
  const flowErr = validateFlow() || validateProfile();
  if (flowErr) return fail(flowErr);
  const clean = (a) => (a || []).map((x) => x.trim()).filter(Boolean);
  const cleanConds = (cs) => ({ match: cs.match === "any" ? "any" : "all", conds: cs.conds.map((c) => ({ src: c.src, op: c.op, val: opNeedsValue(c.op) ? String(c.val ?? "").trim() : "" })) });
  const fields = B.fields.map((f) => {
    if (f.type === "section") {
      const routes = (f.routes || []).map((r) => ({ ...cleanConds(r), goto: r.goto }));
      return { id: f.id, type: "section", label: (f.label || "").trim(), help: (f.help || "").trim(), required: false, ...(f.next ? { next: f.next } : {}), ...(routes.length ? { routes } : {}) };
    }
    const branch = (f.branch || []).map((b) => ({ o: b.o, to: b.to })).filter((b) => (f.type === "yesno" ? ["Yes", "No"] : clean(f.options)).includes(b.o));
    return {
      id: f.id, type: f.type, label: f.label.trim(), required: f.type === "toggle" ? false : !!f.required, help: (f.help || "").trim(),
      ...(f.type === "prefixed" ? { prefix: f.prefix || "", suffix: f.suffix || "" } : {}),
      ...(f.type === "select" || f.type === "multi" || f.type === "priority" ? { options: clean(f.options) } : {}),
      ...(f.type === "priority" ? { min: Number(f.min) || 0, max: Number(f.max) || 0 } : {}),
      ...(f.type === "table" ? { rows: clean(f.rows), cols: clean(f.cols), dir: f.dir === "col" ? "col" : "row", multi: !!f.multi } : {}),
      ...(f.type === "batchmates" ? { min: Number(f.min) || 0, max: Number(f.max) || 0 } : {}),
      ...(f.profile?.on && PROFILE_TYPES.has(f.type) ? { profile: { key: f.profile.key, label: (f.profile.label || "").trim(), group: f.profile.group, ...(f.profile.group === "__new" ? { groupTitle: (f.profile.groupTitle || "").trim() } : {}) } } : {}),
      ...(f.type === "rating" ? { style: RATING_STYLES[f.style] ? f.style : "stars", max: ratingMax(f), lo: (f.lo || "").trim(), hi: (f.hi || "").trim() } : {}),
      ...(f.logic?.conds?.length ? { logic: cleanConds(f.logic) } : {}),
      ...(branch.length ? { branch } : {})
    };
  });
  const isSignup = B.kind.value === "signup";
  const fee = Number(B.sFee.value);
  if (isSignup && B.sFee.value && !(isFinite(fee) && fee >= 0)) return fail("Amount per student must be a number.");
  const signup = isSignup ? { fee: B.sFee.value ? fee : 0, cur: B.sCur.value.trim() || "Rs.", note: B.sNote.value.trim(), goingId: B.fields.some((x) => x.id === "_going") ? "_going" : "" } : null;
  const data = { title, description: B.desc.value.trim(), fields, dueAt: due, signup };
  B.saveBtn.disabled = true; B.saveBtn.textContent = "Saving…";
  try {
    let id;
    if (B.editing) { id = B.editing.id; await updateDoc(doc(db, "forms", id), data); }
    else { const r = await addDoc(collection(db, "forms"), { ...data, collecting: true, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid }); id = r.id; }
    await B.push.send({ title: B.editing ? `Form updated: ${title}` : `New form: ${title}`, message: `Due ${fmtDate(due)} — tap to fill`, url: `home.html?form=${id}` });
    const link = formLink(id);
    B.body.hidden = true; B.result.hidden = false; B.result.innerHTML = "";
    B.result.append(el("div", { class: "fm-tick", text: "✓" }), el("h3", { text: B.editing ? "Form updated" : "Form published" }),
      el("p", { text: "Deep link to this form:" }),
      el("input", { type: "text", readonly: true, value: link, class: "fm-linkbox", onclick: (e) => e.target.select() }),
      el("button", { class: "btn-primary", type: "button", text: "Copy link", onclick: async (e) => { try { await navigator.clipboard.writeText(link); e.target.textContent = "✓ Copied"; } catch (x) { $(".fm-linkbox", B.result).select(); } } }),
      el("button", { class: "ghost-btn", type: "button", text: "Close", onclick: () => { B.ov.hidden = true; } }));
    if (window.__formsRefresh) window.__formsRefresh();
  } catch (e) {
    console.warn(e); fail("Couldn't save the form. Check your permission and try again.");
    B.saveBtn.disabled = false; B.saveBtn.textContent = B.editing ? "Save changes" : "Create & publish form";
  }
}

// ── Delete form + all responses ──
async function deleteFormAndData(f, done) {
  if (!hasPerm("forms")) return denied();
  let snap;
  let claims = [];
  try { snap = await getDocs(collection(db, "forms", f.id, "responses")); claims = (await getDocs(collection(db, "forms", f.id, "claims"))).docs; }
  catch (e) { return alert("Couldn't read the responses — please try again."); }
  if (!confirm(`Permanently delete "${f.title}" and its ${snap.size} response(s)? This cannot be undone.`)) return;
  try {
    // Also remove every student's auto-saved draft for this form. Admins can't read drafts, but can delete
    // them by id (deleting a draft that doesn't exist is harmless), so we target each student in the roster.
    let roster = [];
    try { roster = await getRoster(); } catch (e) {}
    const draftUids = new Set([...roster.map((b) => b.uid), ...snap.docs.map((d) => d.id), ...claims.map((d) => d.id)]);
    const drafts = [...draftUids].map((uid) => ({ ref: doc(db, "forms", f.id, "drafts", uid) }));
    const all = [...snap.docs, ...claims, ...drafts];
    for (let i = 0; i < all.length; i += 400) {
      const b = writeBatch(db);
      all.slice(i, i + 400).forEach((d) => b.delete(d.ref));
      await b.commit();
    }
    await deleteDoc(doc(db, "forms", f.id));
    done();
  } catch (e) { console.warn(e); alert("Couldn't delete everything — please try again."); }
}

// ── Publish again ──
function openRepublish(f, done) {
  const ov = $("#fm-repub") || overlay("fm-repub");
  ov.innerHTML = "";
  const due = el("input", { type: "datetime-local" });
  const pc = pushControls(true, "Notify batch that the form is open again");
  const err = el("p", { class: "error-msg", hidden: true });
  const btn = el("button", { class: "btn-primary", type: "button", text: "Publish again", onclick: async () => {
    const d = new Date(due.value);
    if (!due.value || isNaN(d) || d <= new Date()) { err.textContent = "Pick a future due date & time."; err.hidden = false; return; }
    btn.disabled = true;
    try {
      await updateDoc(doc(db, "forms", f.id), { dueAt: d, collecting: true });
      await pc.send({ title: `Form open again: ${f.title}`, message: `New due date ${fmtDate(d)} — tap to fill`, url: `home.html?form=${f.id}` });
      ov.hidden = true; done();
    } catch (e) { err.textContent = "Couldn't publish — please try again."; err.hidden = false; btn.disabled = false; }
  } });
  ov.append(el("div", { class: "modal-box" }, closeBtn(ov), el("div", { class: "admin-modal-body" },
    el("p", { class: "section-label", text: "Publish again" }),
    el("p", { class: "fine-print", style: "text-align:left", text: `"${f.title}" returns to the home page with its existing responses kept. Pick a new due date.` }),
    el("label", { text: "New due date & time" }), due, pc.root, err, btn)));
  ov.hidden = false;
}

// ── Responses viewer (table like the Data tab) ──
let R = null;
const rvCols = () => R.mode === "pending"
  ? [{ k: "_name", l: "Name" }, { k: "_index", l: "Index No" }, ...(R.pcols || []).map((p) => ({ k: "_p:" + p.key, l: p.label }))]
  : [{ k: "_name", l: "Name" }, { k: "_index", l: "Index No" },
     ...(R.form.fields || []).filter(isQ).flatMap((f) => f.type === "batchmates" ? [{ k: "_leader", l: "Leader" }, { k: f.id, l: f.label }] : [{ k: f.id, l: f.label }]),
     { k: "_at", l: "Responded At" },
     ...(R.pcols || []).map((p) => ({ k: "_p:" + p.key, l: p.label }))];
function rvVal(r, k) {
  if (k.startsWith("_p:")) return fmtProfileVal(PROFILE_ROWS?.get(r.uid)?.[k.slice(3)]); // profile column
  if (k === "_name") return r.name || "";
  if (k === "_index") return r.index || "";
  if (k === "_leader") return r.name || ""; // the person who filled the form is the group leader
  if (k === "_at") return r.respondedAt ? fmtDate(toDate(r.respondedAt)) : "";
  return fmtAnswer((R.form.fields || []).find((f) => f.id === k), r.answers?.[k]);
}
function rvRows() {
  let rows = R.mode === "pending" ? R.pending : R.responses;
  const t = R.filterText.trim().toLowerCase();
  if (t) rows = rows.filter((r) => (R.filterKey ? [R.filterKey] : rvCols().map((c) => c.k)).some((k) => String(rvVal(r, k)).toLowerCase().includes(t)));
  if (R.sort.key) {
    const k = R.sort.key;
    rows = [...rows].sort((a, b) => {
      const c = k === "_at" ? (toDate(a.respondedAt) || 0) - (toDate(b.respondedAt) || 0)
        : String(rvVal(a, k)).localeCompare(String(rvVal(b, k)), undefined, { numeric: true, sensitivity: "base" });
      return R.sort.dir === "asc" ? c : -c;
    });
  }
  return rows;
}

async function openResponses(form) {
  const ov = $("#fm-resp") || overlay("fm-resp", "fm-wide fm-xwide");
  ov.hidden = false; ov.innerHTML = "";
  const box = el("div", { class: "modal-box" }, closeBtn(ov), el("div", { class: "admin-modal-body", id: "fm-resp-body" }, skelEl("", "lines")));
  ov.append(box);
  let saved = []; try { saved = JSON.parse(localStorage.getItem(`fmProfCols:${form.id}`) || "[]"); } catch (e) {}
  R = { form, mode: "responses", sort: { key: null, dir: "asc" }, filterKey: "", filterText: "", responses: [], pending: [],
        pcols: Array.isArray(saved) ? saved.filter((p) => p && p.key && p.label) : [], pcolErr: "" };
  try {
    const [rs, roster] = await Promise.all([getDocs(collection(db, "forms", form.id, "responses")), getRoster()]);
    R.responses = rs.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const done = new Set(R.responses.map((r) => r.uid));
    R.pending = roster.filter((b) => !done.has(b.uid));
  } catch (e) { $("#fm-resp-body").innerHTML = '<p class="error-msg">Could not load responses (permission?).</p>'; return; }
  if (R.pcols.length) {
    try { await loadProfileRows(true); }
    catch (e) { R.pcols = []; R.pcolErr = "Profile columns couldn't be loaded (check the Forms permission and that the updated Firestore rules are published)."; }
  }
  renderResponses();
}

function renderResponses() {
  const body = $("#fm-resp-body");
  body.innerHTML = "";
  const cols = rvCols();
  const tab = (mode, text) => el("button", { type: "button", class: "fm-tab" + (R.mode === mode ? " active" : ""), text, onclick: () => { R.mode = mode; R.sort = { key: null, dir: "asc" }; R.filterKey = ""; R.filterText = ""; renderResponses(); } });
  const sel = el("select", {}, el("option", { value: "", text: "All columns" }), ...cols.map((c) => el("option", { value: c.k, text: c.l })));
  sel.value = R.filterKey;
  sel.addEventListener("change", () => { R.filterKey = sel.value; renderTable(); });
  const txt = el("input", { type: "text", placeholder: "Filter: contains…", value: R.filterText });
  txt.addEventListener("input", () => { R.filterText = txt.value; renderTable(); });
  const small = "padding:6px 12px; font-size:12px;";
  body.append(
    el("p", { class: "section-label", text: R.form.title || "Responses" }),
    el("div", { class: "fm-tabs" }, tab("responses", `Responses (${R.responses.length})`), tab("pending", `Not submitted (${R.pending.length})`)),
    el("div", { class: "admin-list-controls", style: "margin:12px 0;" }, sel, txt,
      profileMappings(R.form).length ? el("button", { type: "button", class: "ghost-btn", style: small + "border-color:#8b5cf6;color:#8b5cf6;", text: "👤 Import to profiles", onclick: openProfileImport }) : null,
      el("button", { type: "button", class: "ghost-btn", style: small, text: `➕ Profile columns${R.pcols.length ? " (" + R.pcols.length + ")" : ""}`, onclick: openProfileColumns }),
      R.form.signup ? el("button", { type: "button", class: "ghost-btn", style: small + "border-color:#16a34a;color:#16a34a;", text: "🧾 Trip sheet PDF", onclick: openSignupSheet }) : null,
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Download Excel", onclick: exportXlsx }),
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Download PDF", onclick: exportPdf }),
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Refresh", onclick: () => openResponses(R.form) })),
    R.pcolErr ? el("p", { class: "error-msg", text: R.pcolErr }) : null,
    el("p", { class: "fine-print", id: "fm-count", style: "text-align:left; margin:0 0 10px;" }),
    el("div", { class: "datatable-wrap" }, el("table", { class: "data-table" }, el("thead", {}, el("tr", { id: "fm-head" })), el("tbody", { id: "fm-tbody" }))));
  renderTable();
}

function renderTable() {
  const cols = rvCols(), rows = rvRows();
  const head = $("#fm-head"), tb = $("#fm-tbody");
  head.innerHTML = ""; tb.innerHTML = "";
  cols.forEach((c) => {
    const th = el("th", { text: c.l });
    if (R.sort.key === c.k) { th.classList.add("sorted"); th.append(el("span", { class: "sort-arrow", text: R.sort.dir === "asc" ? "↑" : "↓" })); }
    th.addEventListener("click", () => { R.sort = R.sort.key === c.k ? { key: c.k, dir: R.sort.dir === "asc" ? "desc" : "asc" } : { key: c.k, dir: "asc" }; renderTable(); });
    head.append(th);
  });
  $("#fm-count").textContent = `${rows.length} row(s)`;
  if (!rows.length) { tb.append(el("tr", {}, el("td", { colspan: cols.length, text: R.mode === "pending" ? "Everyone has submitted 🎉" : "No responses yet.", style: "text-align:center;color:var(--muted);padding:20px 10px;" }))); return; }
  rows.forEach((r) => {
    const tr = el("tr", {}, ...cols.map((c) => { const v = String(rvVal(r, c.k)); return el("td", { text: v || "—", title: v }); }));
    if (R.mode === "responses") { tr.classList.add("fm-row-click"); tr.title = "Click to view this response"; tr.addEventListener("click", () => openResponseView(r)); }
    tb.append(tr);
  });
}

// Read-only popup: the form's own layout filled with one person's answers.
function openResponseView(r) {
  const f = R.form;
  const ov = $("#fm-resp-view") || overlay("fm-resp-view");
  ov.hidden = false; ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  box.append(el("h2", { class: "fm-title", text: f.title || "Form" }),
    el("div", { class: "fm-edit-note", text: `Response by ${r.name || "—"}${r.index ? " (" + r.index + ")" : ""}${r.respondedAt ? " · " + fmtDate(toDate(r.respondedAt)) : ""} — view only` }));
  if (f.description) box.append(el("p", { class: "fm-desc", text: f.description }));
  const form = el("div", { class: "fm-form fm-readonly" });
  const flow = computeFlow(f.fields || [], (id) => r.answers?.[id]); // only the pages / questions this person actually saw
  flow.pages.forEach((pgx, pi) => {
    if (!flow.path.includes(pi)) return;
    if (pgx.section && (pgx.section.label || pgx.section.help || flow.pages.length > 1)) form.append(el("div", { class: "fm-page-head" },
      el("h3", { text: pgx.section.label || `Page ${pi + 1}` }), pgx.section.help ? el("p", { text: pgx.section.help }) : null));
    pgx.fields.forEach((fd) => {
      if (!flow.vis.get(fd.id)) return;
      const v = r.answers?.[fd.id];
      let node;
      if (fd.type === "batchmates") {
        const ms = Array.isArray(v) ? v : [];
        node = el("div", { class: "fm-bm" },
          el("p", { class: "fine-print", style: "text-align:left;margin:0;", text: `Leader: ${r.name || "—"}${r.index ? " (" + r.index + ")" : ""}` }),
          ms.length ? el("ul", { class: "pill-list" }, ...ms.map((m) => el("li", { text: m.name + (m.index ? " — " + m.index : "") }))) : el("p", { class: "fine-print", style: "text-align:left;", text: "No members selected." }));
      } else if (!["yesno", "toggle", "select", "multi", "priority", "table", "rating"].includes(fd.type)) {
        // Text-like answers: plain wrapped text so long answers show in full.
        const txt = fmtAnswer(fd, v);
        node = fd.type === "link" && txt ? el("a", { class: "fm-ans", href: txt, target: "_blank", rel: "noopener", text: txt }) : el("div", { class: "fm-ans" + (txt ? "" : " empty"), text: txt || "—" });
      } else {
        node = fieldInput(fd, v, { me: null, roster: [], claims: new Map() }).node;
        node.setAttribute("inert", "");
      }
      form.append(el("div", { class: "fm-field" }, el("label", {}, fd.label, fd.required ? el("span", { class: "fm-req", text: " *" }) : null), fd.help ? el("small", { text: fd.help }) : null, node));
    });
  });
  box.append(form, el("button", { type: "button", class: "ghost-btn", text: "Close", onclick: () => { ov.hidden = true; } }));
}

// Admin: choose which mapped answers to write into private profiles.
async function openProfileImport() {
  const form = R.form, maps = profileMappings(form);
  const ov = $("#fm-pimp") || overlay("fm-pimp");
  ov.hidden = false; ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  box.append(el("h2", { class: "fm-title", text: "Import to private profiles" }),
    el("p", { class: "fm-desc", text: "Tick the answers to write into each person's private profile (their batchmate record). Blank answers are skipped and never overwrite existing data. Imported fields are never shown in the public directory." }));
  const status = skelEl("", "lines");
  box.append(status);
  let groups;
  try { groups = JSON.parse(JSON.stringify(await loadProfileGroups(true))); } catch (e) { status.textContent = "Could not load the profile sections."; return; }
  // Work out what each mapped question would import.
  const flows = new Map(R.responses.map((r) => [r.uid, computeFlow(form.fields || [], (id) => r.answers?.[id])]));
  const items = maps.map((q) => {
    const vals = [];
    R.responses.forEach((r) => { if (!flows.get(r.uid).vis.get(q.id)) return; const v = profileValue(q, r.answers?.[q.id]); if (v !== undefined) vals.push({ uid: r.uid, name: r.name, v }); });
    return { q, vals, on: vals.length > 0 };
  });
  status.remove();
  const sectionName = (p) => (p.group === "__new" ? `${p.groupTitle || "New section"} (new)` : groups.find((g) => g.id === p.group)?.title || "⚠ section missing");
  const preview = (v) => (Array.isArray(v) ? v.join(", ") : String(v)).slice(0, 40);
  const list = el("div", { class: "fm-pi-list" });
  items.forEach((it) => {
    const c = el("input", { type: "checkbox" }); c.checked = it.on; c.disabled = !it.vals.length;
    c.addEventListener("change", () => { it.on = c.checked; });
    list.append(el("label", { class: "fm-pi-row" + (it.vals.length ? "" : " off") }, c, el("div", {},
      el("b", { text: it.q.label }),
      el("div", { class: "fm-pi-meta", text: `→ ${sectionName(it.q.profile)} · “${it.q.profile.label}” · key ${it.q.profile.key}` }),
      el("div", { class: "fm-pi-meta", text: it.vals.length ? `${it.vals.length} answer(s) · e.g. ${it.vals.slice(0, 2).map((x) => `${x.name || "?"}: ${preview(x.v)}`).join("  |  ")}` : "No answers to import" }))));
  });
  const err = el("p", { class: "error-msg", hidden: true });
  const go = el("button", { type: "button", class: "btn-primary", text: "Import selected fields" });
  box.append(list, err, go, el("button", { type: "button", class: "ghost-btn", text: "Cancel", onclick: () => { ov.hidden = true; } }));

  go.addEventListener("click", async () => {
    const chosen = items.filter((it) => it.on && it.vals.length);
    err.hidden = true;
    if (!chosen.length) { err.textContent = "Tick at least one field."; err.hidden = false; return; }
    // guard the keys
    const existing = groups.flatMap((g) => g.fields || []), seen = new Set();
    for (const it of chosen) {
      const p = it.q.profile, ex = existing.find((x) => x.key === p.key);
      const bad = PROFILE_RESERVED.has(p.key) ? `"${p.key}" is a reserved key.` : ex && !ex.fromForm ? `"${p.key}" is already a built-in profile field.` : seen.has(p.key) ? `Two fields use the key "${p.key}".` : p.group !== "__new" && !groups.some((g) => g.id === p.group) ? `The section for "${p.label}" no longer exists — edit the form and pick another.` : "";
      if (bad) { err.textContent = `${it.q.label}: ${bad}`; err.hidden = false; return; }
      seen.add(p.key);
    }
    go.disabled = true; go.textContent = "Importing…";
    try {
      // 1) add the fields to their sections (the Dashboard renders sections from this schema)
      const nextOrder = (g) => Math.max(-1, ...(g.fields || []).map((x) => x.order || 0)) + 1;
      chosen.forEach((it) => {
        const p = it.q.profile;
        let g = groups.find((x) => x.id === p.group);
        if (p.group === "__new") {
          const id = slugId(p.groupTitle) || "custom";
          g = groups.find((x) => x.id === id);
          if (!g) { g = { id, title: p.groupTitle, order: Math.max(-1, ...groups.map((x) => x.order || 0)) + 1, fields: [] }; groups.push(g); }
        }
        g.fields = g.fields || [];
        const old = groups.flatMap((x) => x.fields || []).find((x) => x.key === p.key);
        if (old) { old.label = p.label; if (!g.fields.includes(old)) { groups.forEach((x) => { x.fields = (x.fields || []).filter((y) => y !== old); }); old.order = nextOrder(g); g.fields.push(old); } }
        else g.fields.push({ key: p.key, label: p.label, order: nextOrder(g), public: false, fromForm: form.id });
      });
      await setDoc(doc(db, "config", "directoryFields"), { groups }, { merge: true });
      PROFILE_GROUPS = groups; PROFILE_DOC_EXISTS = true;
      // 2) write the values into each person's /batchmates record
      const byUid = new Map();
      chosen.forEach((it) => it.vals.forEach((x) => { byUid.set(x.uid, { ...(byUid.get(x.uid) || {}), [it.q.profile.key]: x.v }); }));
      const entries = [...byUid]; let ok = 0, fail = 0;
      for (let i = 0; i < entries.length; i += 400) {
        const chunk = entries.slice(i, i + 400);
        try { const wb = writeBatch(db); chunk.forEach(([uid, obj]) => wb.update(doc(db, "batchmates", uid), obj)); await wb.commit(); ok += chunk.length; }
        catch (e) { for (const [uid, obj] of chunk) { try { await updateDoc(doc(db, "batchmates", uid), obj); ok++; } catch (x) { fail++; } } } // one bad record shouldn't sink the rest
      }
      box.innerHTML = "";
      box.append(closeBtn(ov), el("div", { class: "fm-msg ok" }, el("div", { class: "fm-tick", text: "✓" }), el("h3", { text: "Imported to profiles" }),
        el("p", { text: `${chosen.length} field(s) added to ${new Set(chosen.map((it) => sectionName(it.q.profile))).size} section(s). ${ok} profile(s) updated${fail ? `, ${fail} failed (record missing or no permission)` : ""}. People see it on their Dashboard after a refresh.` }),
        el("button", { class: "btn-primary", type: "button", text: "Done", onclick: () => { ov.hidden = true; } })));
    } catch (e) {
      err.textContent = "Import failed — check that your admin account has the Forms permission and the updated Firestore rules are published."; err.hidden = false;
      go.disabled = false; go.textContent = "Import selected fields";
    }
  });
}

// ── Profile columns in the response table ───────────────────────
// Admin can add any field from the batchmates' profiles (email, phone, …) as extra
// columns next to the answers. They appear in the table, filter, sort and in the
// Excel / PDF downloads. Read from /batchmates/{uid}; the choice is remembered per form.
let PROFILE_ROWS = null;
async function loadProfileRows(force) {
  if (PROFILE_ROWS && !force) return PROFILE_ROWS;
  const snap = await getDocs(collection(db, "batchmates"));
  PROFILE_ROWS = new Map(snap.docs.map((d) => [d.id, d.data()]));
  return PROFILE_ROWS;
}
function fmtProfileVal(v) {
  if (isEmptyVal(v)) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? Object.values(x).join(" ") : String(x))).join(", ");
  if (v && typeof v === "object") {
    if (typeof v.toDate === "function") return fmtDate(v.toDate());
    return Object.entries(v).map(([k, x]) => `${k}: ${x}`).join("; ");
  }
  return String(v);
}
async function openProfileColumns() {
  const ov = $("#fm-pcols") || overlay("fm-pcols");
  ov.hidden = false; ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  box.append(el("h2", { class: "fm-title", text: "Add profile columns" }),
    el("p", { class: "fm-desc", text: "Tick profile details to show as extra columns for everyone in this table (e.g. email, phone). They are included in the Excel and PDF downloads. Fields marked private are not visible to other students, so handle downloaded files carefully." }));
  const status = skelEl("", "lines");
  box.append(status);
  let groups;
  try { groups = await loadProfileGroups(true); } catch (e) { status.textContent = "Could not load the profile fields."; return; }
  status.remove();

  const chosen = new Map((R.pcols || []).map((p) => [p.key, p.label]));
  const checks = [], blocks = [];
  const search = el("input", { type: "text", placeholder: "Search profile fields…" });
  const list = el("div", { class: "fm-pc-list" });
  [...groups].sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((g) => {
    const head = el("p", { class: "fm-pc-group", text: g.title || "Section" });
    const grp = el("div", {}, head);
    const items = [...(g.fields || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((f) => {
      const c = el("input", { type: "checkbox" }); c.checked = chosen.has(f.key);
      c.addEventListener("change", () => { if (c.checked) chosen.set(f.key, f.label); else chosen.delete(f.key); count.textContent = `${chosen.size} selected`; });
      checks.push([c, f]);
      const row = el("label", { class: "member-check-row" }, c, el("span", { text: f.label }), f.public === false ? el("small", { class: "fm-pc-priv", text: "private" }) : null);
      grp.append(row);
      return [row, f.label];
    });
    blocks.push([grp, items]);
    list.append(grp);
  });
  search.addEventListener("input", () => {
    const t = search.value.trim().toLowerCase();
    blocks.forEach(([grp, items]) => {
      let any = false;
      items.forEach(([row, label]) => { const show = !t || label.toLowerCase().includes(t); row.hidden = !show; if (show) any = true; });
      grp.hidden = !any;
    });
  });
  const count = el("span", { class: "fine-print", text: `${chosen.size} selected` });
  const err = el("p", { class: "error-msg", hidden: true });
  const apply = el("button", { type: "button", class: "btn-primary", text: "Apply columns" });
  const clear = el("button", { type: "button", class: "ghost-btn", text: "Clear all", onclick: () => { chosen.clear(); checks.forEach(([c]) => { c.checked = false; }); count.textContent = "0 selected"; } });
  apply.addEventListener("click", async () => {
    err.hidden = true; apply.disabled = true; apply.textContent = "Loading…";
    const next = [...chosen].map(([key, label]) => ({ key, label }));
    try {
      if (next.length) await loadProfileRows(true);
      R.pcols = next; R.pcolErr = "";
      if (R.filterKey.startsWith("_p:") && !next.some((p) => "_p:" + p.key === R.filterKey)) R.filterKey = "";
      if (R.sort.key?.startsWith("_p:") && !next.some((p) => "_p:" + p.key === R.sort.key)) R.sort = { key: null, dir: "asc" };
      try { localStorage.setItem(`fmProfCols:${R.form.id}`, JSON.stringify(next)); } catch (e) {}
      ov.hidden = true; renderResponses();
    } catch (e) {
      err.textContent = "Couldn't read the profiles — check that your admin account has the Forms permission and the updated Firestore rules are published.";
      err.hidden = false; apply.disabled = false; apply.textContent = "Apply columns";
    }
  });
  box.append(search, list, el("div", { class: "fm-pc-foot" }, count, clear), err, apply);
}

// ── Sign-up sheet PDF (trips / events) ──────────────────────────
// One A4 page: form title as the header, "Students going", amount per student, a blank
// date, a tick box before every name (+ index), and two blank signature lines.
// The list shrinks / splits into columns automatically so it always stays on one page.
const fmtMoney = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
function sheetPeople(sort) {
  const gid = R.form.signup?.goingId;
  const rows = R.responses.filter((r) => !gid || r.answers?.[gid] !== "No").map((r) => ({ name: (r.name || "Unnamed").trim(), index: (r.index || "").trim(), at: toDate(r.respondedAt) || 0 }));
  const cmp = { name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }), index: (a, b) => (a.index || "~").localeCompare(b.index || "~", undefined, { numeric: true }), time: (a, b) => a.at - b.at }[sort] || 0;
  return cmp ? rows.sort(cmp) : rows;
}
function openSignupSheet() {
  const sg = R.form.signup || {};
  const ov = $("#fm-sheet") || overlay("fm-sheet");
  ov.hidden = false; ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  const inp = (v, ph, type = "text") => { const i = el("input", { type, placeholder: ph }); i.value = v ?? ""; return i; };
  const title = inp(R.form.title, "Sheet heading"), fee = inp(sg.fee || "", "Amount per student (blank = fill by hand)", "number"), cur = inp(sg.cur || "Rs.", "Currency");
  const note = inp(sg.note || "", "Line under the heading (optional)"), s1 = inp("Collected by", "Signature 1 label"), s2 = inp("Received by", "Signature 2 label");
  fee.min = "0"; fee.step = "any";
  const sort = el("select", {}, el("option", { value: "name", text: "Name (A–Z)" }), el("option", { value: "index", text: "Index number" }), el("option", { value: "time", text: "Order of sign-up" }));
  const info = el("p", { class: "fine-print", style: "text-align:left;" });
  const upd = () => { info.textContent = `${sheetPeople("name").length} student(s) will be listed.`; };
  upd();
  const go = el("button", { type: "button", class: "btn-primary", text: "Download PDF", onclick: () => {
    if (!window.jspdf || !window.jspdf.jsPDF) return alert("PDF export isn't available right now — check your connection.");
    const people = sheetPeople(sort.value);
    if (!people.length) return alert("No students have signed up yet.");
    makeSignupPdf(people, { title: title.value.trim() || "Sign-up sheet", fee: fee.value === "" ? null : Number(fee.value), cur: cur.value.trim(), note: note.value.trim(), s1: s1.value.trim(), s2: s2.value.trim() });
  } });
  box.append(el("h2", { class: "fm-title", text: "Trip sheet PDF" }),
    el("p", { class: "fm-desc", text: "A one-page sheet of the students who are going, with a tick box before each name." }),
    el("label", { text: "Heading" }), title, el("label", { text: "Line under heading" }), note,
    el("label", { text: "Amount per student" }), el("div", { class: "fm-brow" }, cur, fee),
    el("label", { text: "Sort names by" }), sort,
    el("label", { text: "Signature lines (left / right)" }), el("div", { class: "fm-brow" }, s1, s2), info, go);
}
function makeSignupPdf(people, o) {
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 14, n = people.length, money = (v) => `${o.cur ? o.cur + " " : ""}${fmtMoney(v)}`;
  const hasFee = o.fee != null && isFinite(o.fee);
  // header: the form title
  let y = 20;
  pdf.setFont("helvetica", "bold"); pdf.setTextColor(20);
  let size = 22, lines;
  do { pdf.setFontSize(size); lines = pdf.splitTextToSize(o.title, W - 2 * M); size -= 2; } while (lines.length > 2 && size >= 12);
  pdf.text(lines.slice(0, 2), W / 2, y, { align: "center" });
  y += (Math.min(lines.length, 2) - 1) * (size + 2) * 0.42 + 6;
  if (o.note) { pdf.setFont("helvetica", "normal"); pdf.setFontSize(11); pdf.setTextColor(90); pdf.text(pdf.splitTextToSize(o.note, W - 2 * M).slice(0, 1), W / 2, y, { align: "center" }); y += 6; }
  pdf.setDrawColor(76, 141, 255); pdf.setLineWidth(0.8); pdf.line(M, y, W - M, y); y += 9;
  // info band: amount + date, students + total
  pdf.setTextColor(30); pdf.setFontSize(11);
  const label = (txt, x, yy, align) => { pdf.setFont("helvetica", "normal"); pdf.text(txt, x, yy, { align }); };
  const val = (txt, x, yy) => { pdf.setFont("helvetica", "bold"); pdf.text(txt, x, yy); };
  label("Amount per student:", M, y); val(hasFee ? money(o.fee) : "", M + 40, y);
  if (!hasFee) { pdf.setDrawColor(120); pdf.setLineWidth(0.3); pdf.line(M + 40, y + 0.6, M + 85, y + 0.6); }
  label("Date:", W - M - 62, y); pdf.setDrawColor(120); pdf.setLineWidth(0.3); pdf.line(W - M - 52, y + 0.6, W - M, y + 0.6);
  y += 7;
  label("Students going:", M, y); val(String(n), M + 40, y);
  if (hasFee) { label("Total expected:", W - M - 62, y); val(money(o.fee * n), W - M - 36, y); }
  y += 6;
  // list area: one page, columns + font scale with the head-count
  const top = y + 2, bottom = 258, H = bottom - top, gap = 6;
  let cols = 1; while (Math.ceil(n / cols) * 5.8 > H && cols < 5) cols++; // 66 students → 2 columns of 33 rows
  const per = Math.ceil(n / cols), rowH = Math.min(8, H / per), fs = Math.max(7, Math.min(11, rowH * 1.5));
  const cw = (W - 2 * M - gap * (cols - 1)) / cols, bx = Math.min(4.2, rowH * 0.6);
  const fit = (txt, maxW) => { let t = txt; while (t.length > 1 && pdf.getTextWidth(t) > maxW) t = t.slice(0, -1); return t === txt ? t : t.replace(/\s+$/, "") + "…"; };
  pdf.setFontSize(fs);
  people.forEach((p, i) => {
    const c = Math.floor(i / per), r = i % per, x = M + c * (cw + gap), yy = top + r * rowH, base = yy + rowH / 2 + fs * 0.12;
    pdf.setDrawColor(40); pdf.setLineWidth(0.3); pdf.rect(x + 0.5, yy + (rowH - bx) / 2, bx, bx);
    pdf.setFont("helvetica", "normal"); pdf.setTextColor(120);
    const idxW = p.index ? pdf.getTextWidth(p.index) + 3 : 0;
    if (p.index) pdf.text(p.index, x + cw, base, { align: "right" });
    pdf.setTextColor(20); pdf.text(fit(p.name, cw - bx - 4 - idxW), x + bx + 3.5, base);
    pdf.setDrawColor(225); pdf.setLineWidth(0.15); pdf.line(x, yy + rowH, x + cw, yy + rowH);
  });
  // two blank signature lines
  const sy = 281, sw = 70;
  pdf.setDrawColor(40); pdf.setLineWidth(0.3); pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(70);
  pdf.line(M, sy, M + sw, sy); pdf.text(`${o.s1 || "Signature"} (signature)`, M, sy + 4.5);
  pdf.line(W - M - sw, sy, W - M, sy); pdf.text(`${o.s2 || "Signature"} (signature)`, W - M - sw, sy + 4.5);
  pdf.save(`${slug(o.title)}-sheet-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function exportData() {
  const cols = rvCols();
  return { head: cols.map((c) => c.l), body: rvRows().map((r) => cols.map((c) => String(rvVal(r, c.k)))) };
}
function exportXlsx() {
  if (!window.XLSX) return alert("Excel export isn't available right now — check your connection.");
  const { head, body } = exportData();
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  ws["!cols"] = head.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, R.mode === "pending" ? "Not submitted" : "Responses");
  XLSX.writeFile(wb, `${slug(R.form.title)}-${R.mode}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
function exportPdf() {
  if (!window.jspdf || !window.jspdf.jsPDF) return alert("PDF export isn't available right now — check your connection.");
  const { head, body } = exportData();
  const pdf = new window.jspdf.jsPDF({ orientation: head.length > 5 ? "landscape" : "portrait" });
  pdf.setFontSize(13); pdf.text(`${R.form.title} — ${R.mode === "pending" ? "Not submitted" : "Responses"}`, 14, 15);
  pdf.setFontSize(9); pdf.text(`${body.length} row(s) · ${new Date().toLocaleDateString()}`, 14, 21);
  pdf.autoTable({ head: [head], body, startY: 26, styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [76, 141, 255] }, margin: { left: 10, right: 10 } });
  pdf.save(`${slug(R.form.title)}-${R.mode}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ═════════════════ IDEA BOARDS ═════════════════
// Home: scrollable board cards -> popup with public notes (add / edit / delete own,
// admins pin + delete). Admin -> Add tab: "Create Idea Board".
//   /ideaBoards/{boardId}            { title, description, createdAt, createdBy }
//   /ideaBoards/{boardId}/notes/{id} { topic, description, authorUid, authorName, pinned,
//                                      pinnedAt?, createdAt, updatedAt?, edited }
// Keep these in sync with the limits in firestore rules.
const LIM = { topic: 100, desc: 1000, boardTitle: 80, boardDesc: 300 };
const PERM = "ideaBoards";

// Deep link to one board: home.html?board=<id> (opens its popup on load).
const boardLink = (id) => new URL("home.html?board=" + encodeURIComponent(id), location.href).href;
async function copyBoardLink(id, btn, label) {
  const link = boardLink(id);
  try { await navigator.clipboard.writeText(link); btn.textContent = "✓ Copied"; setTimeout(() => { btn.textContent = label; }, 1500); }
  catch (e) { prompt("Copy this link:", link); }
}
const tsMs = (v) => { const d = toDate(v); return d ? d.getTime() : 0; };

// Small red banner at the bottom of the screen (same look as the app's
// "you don't have access" banner).
let ideaBannerEl, ideaBannerTimer;
function ideaFlash(msg) {
  if (!ideaBannerEl) { ideaBannerEl = el("div", { class: "admin-perm-banner", id: "ideas-banner" }); document.body.appendChild(ideaBannerEl); }
  ideaBannerEl.textContent = msg;
  ideaBannerEl.classList.add("show");
  clearTimeout(ideaBannerTimer);
  ideaBannerTimer = setTimeout(() => ideaBannerEl.classList.remove("show"), 3500);
}

function ideaOverlay(id) {
  const ov = el("div", { class: "modal-overlay ideas-modal", id, hidden: true });
  document.body.appendChild(ov);
  return ov;
}

// Re-renders the card row on Home (set by initHome).
let refreshBoards = null;

// ═════════════════ USER SIDE (home.html) ═════════════════

async function initIdeasHome() {
  const card = $("#ideas-card"), grid = $("#ideas-grid");
  if (!card || !grid || card.dataset.ready) return;
  card.dataset.ready = "1";
  await getMe();

  async function load() {
    let snap;
    try { snap = await getDocs(collection(db, "ideaBoards")); }
    catch (e) { console.warn("Idea boards failed to load:", e); card.hidden = true; return; }
    const boards = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    grid.innerHTML = "";
    card.hidden = boards.length === 0;
    boards.forEach((b) => {
      const open = () => openBoard(b);
      grid.append(el("div", {
        class: "idea-card", role: "button", tabindex: "0", onclick: open,
        onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }
      },
        el("div", { class: "idea-card-icon", text: "💡" }),
        el("div", { class: "idea-card-name", text: b.title || "Untitled board" }),
        b.description ? el("div", { class: "idea-card-desc", text: b.description }) : null,
        el("div", { class: "idea-card-cta", text: "Open board →" })));
    });
  }
  refreshBoards = load;
  await load();

  // Deep link: home.html?board=<id> opens that board straight away.
  const linked = new URLSearchParams(location.search).get("board");
  if (linked) {
    try {
      const s = await getDoc(doc(db, "ideaBoards", linked));
      if (s.exists()) openBoard({ id: s.id, ...s.data() });
      else ideaFlash("⚠ That idea board no longer exists.");
    } catch (e) { console.warn(e); ideaFlash("⚠ Couldn't open that idea board."); }
  }
}

// ── Board popup ──
let M = null; // modal state

function buildModal() {
  const ov = ideaOverlay("idea-board-modal");
  M = { ov, board: null, unsub: null, notes: [], editingId: null, dirty: false };

  M.title = el("h2", { class: "ib-title" });
  M.desc = el("p", { class: "ib-desc", hidden: true });
  M.delBoard = el("button", { type: "button", class: "ghost-btn ib-btn ib-danger", text: "Delete board", hidden: true, onclick: deleteBoard });
  M.copy = el("button", { type: "button", class: "ghost-btn ib-btn", text: "🔗 Copy link", onclick: (e) => copyBoardLink(M.board.id, e.target, "🔗 Copy link") });

  M.addToggle = el("button", { type: "button", class: "ib-add-toggle", text: "＋ Add a note", onclick: () => setCompose(M.compose.hidden) });
  M.topic = el("input", { type: "text", maxlength: LIM.topic, placeholder: "Topic", autocomplete: "off" });
  M.text = el("textarea", { rows: 4, maxlength: LIM.desc, placeholder: "Describe your idea…" });
  M.count = el("small", { class: "ib-count", text: `0/${LIM.desc}` });
  M.text.addEventListener("input", () => { M.count.textContent = `${M.text.value.length}/${LIM.desc}`; });
  M.err = el("p", { class: "error-msg", hidden: true });
  M.post = el("button", { type: "button", class: "btn-primary", text: "Publish note", onclick: postNote });
  M.compose = el("div", { class: "ib-compose", hidden: true },
    el("label", { text: "Topic" }), M.topic,
    el("label", { text: "Description" }), M.text, M.count,
    M.err, M.post,
    el("p", { class: "fine-print ib-public", text: "Notes are public — everyone in the batch can read them. You can edit or delete yours later." }));

  M.listLabel = el("p", { class: "section-label ib-list-label" });
  M.list = el("div", { class: "ib-list" });

  const close = el("button", { class: "modal-close", type: "button", "aria-label": "Close", text: "✕", onclick: closeModal });
  M.box = el("div", { class: "modal-box ib-box" }, close,
    el("div", { class: "ib-head" }, M.title, M.desc, el("div", { class: "ib-head-actions" }, M.copy, M.delBoard)),
    M.addToggle, M.compose, M.listLabel, M.list);
  ov.append(M.box);

  // Backdrop click closes — unless the person is half-way through a note.
  ov.addEventListener("click", (e) => {
    if (e.target !== ov) return;
    if (M.topic.value.trim() || M.text.value.trim() || M.editingId) return;
    closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !M.ov.hidden) closeModal();
  });
}

function setCompose(show) {
  M.compose.hidden = !show;
  M.addToggle.textContent = show ? "✕ Cancel" : "＋ Add a note";
  M.addToggle.classList.toggle("open", show);
  M.err.hidden = true;
  if (show) M.topic.focus();
}

function resetCompose() {
  M.topic.value = ""; M.text.value = ""; M.count.textContent = `0/${LIM.desc}`;
  M.post.disabled = false; M.post.textContent = "Publish note";
  setCompose(false);
}

function openBoard(b) {
  if (!M) buildModal();
  if (M.unsub) { M.unsub(); M.unsub = null; }
  M.board = b; M.editingId = null; M.dirty = false; M.notes = [];
  M.title.textContent = b.title || "Idea board";
  M.desc.textContent = b.description || "";
  M.desc.hidden = !b.description;
  M.delBoard.hidden = !hasPerm(PERM);
  resetCompose();
  M.listLabel.textContent = "Notes";
  M.list.innerHTML = "";
  M.list.append(skelEl("", "list"));
  M.ov.hidden = false;
  M.box.scrollTop = 0;

  // Live updates while the popup is open (stopped again on close).
  M.unsub = onSnapshot(
    collection(db, "ideaBoards", b.id, "notes"),
    (snap) => {
      M.notes = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      // Don't rebuild the list under someone who is typing an edit.
      if (M.editingId) M.dirty = true; else renderNotes();
    },
    (err) => {
      console.warn("Notes listener failed:", err);
      M.list.innerHTML = "";
      M.list.append(el("p", { class: "ib-empty", text: "Couldn't load notes. Please close and try again." }));
    });
}

function closeModal() {
  if (M.unsub) { M.unsub(); M.unsub = null; }
  M.ov.hidden = true;
  M.editingId = null;
}

// Pinned notes first (most recently pinned on top), then newest first.
function sortNotes(list) {
  return list.slice().sort((a, b) => {
    const pa = a.pinned === true, pb = b.pinned === true;
    if (pa !== pb) return pa ? -1 : 1;
    return pa ? tsMs(b.pinnedAt) - tsMs(a.pinnedAt) : tsMs(b.createdAt) - tsMs(a.createdAt);
  });
}

function renderNotes() {
  M.dirty = false;
  const notes = sortNotes(M.notes);
  M.listLabel.textContent = `Notes (${notes.length})`;
  M.list.innerHTML = "";
  if (!notes.length) {
    M.list.append(el("p", { class: "ib-empty", text: "No notes yet — be the first to add one." }));
    return;
  }
  notes.forEach((n) => M.list.append(M.editingId === n.id ? editEl(n) : noteEl(n)));
}

function actionBtn(label, onclick, extra = "") {
  return el("button", { type: "button", class: "ghost-btn ib-btn " + extra, text: label, onclick });
}

function noteEl(n) {
  const mine = n.authorUid === auth.currentUser?.uid;
  const admin = hasPerm(PERM);
  const acts = el("div", { class: "ib-actions" });
  if (admin) acts.append(actionBtn(n.pinned ? "Unpin" : "📌 Pin", () => togglePin(n)));
  if (mine) acts.append(actionBtn("Edit", () => { M.editingId = n.id; renderNotes(); }));
  if (mine || admin) acts.append(actionBtn("Delete", () => deleteNote(n, mine), "ib-danger"));

  return el("article", { class: "ib-note" + (n.pinned ? " pinned" : "") },
    n.pinned ? el("span", { class: "ib-pin", text: "📌 Pinned" }) : null,
    el("h4", { class: "ib-note-topic", text: n.topic || "" }),
    el("p", { class: "ib-note-desc", text: n.description || "" }),
    el("div", { class: "ib-meta" },
      el("span", { text: (n.authorName || "Batchmate") + (mine ? " (you)" : "") }),
      el("span", { text: "· " + fmtDate(toDate(n.createdAt)) }),
      n.edited ? el("span", { class: "ib-edited", text: "· edited" }) : null),
    acts.children.length ? acts : null);
}

function editEl(n) {
  const topic = el("input", { type: "text", maxlength: LIM.topic, value: n.topic || "" });
  const text = el("textarea", { rows: 4, maxlength: LIM.desc });
  text.value = n.description || "";
  const err = el("p", { class: "error-msg", hidden: true });
  const save = el("button", { type: "button", class: "btn-primary ib-save", text: "Save changes" });

  const finish = () => { M.editingId = null; renderNotes(); };
  save.addEventListener("click", async () => {
    const t = topic.value.trim(), d = text.value.trim();
    err.hidden = true;
    if (!t || !d) { err.textContent = "Topic and description can't be empty."; err.hidden = false; return; }
    if (t === n.topic && d === n.description) return finish(); // nothing changed
    save.disabled = true; save.textContent = "Saving…";
    try {
      await updateDoc(doc(db, "ideaBoards", M.board.id, "notes", n.id),
        { topic: t, description: d, updatedAt: serverTimestamp(), edited: true });
      finish();
    } catch (e) {
      console.warn(e);
      err.textContent = "Couldn't save — the note may have been removed. Please try again.";
      err.hidden = false; save.disabled = false; save.textContent = "Save changes";
    }
  });

  return el("article", { class: "ib-note editing" },
    el("label", { text: "Topic" }), topic,
    el("label", { text: "Description" }), text,
    err,
    el("div", { class: "ib-actions" }, save, actionBtn("Cancel", finish)));
}

async function postNote() {
  const t = M.topic.value.trim(), d = M.text.value.trim();
  M.err.hidden = true;
  if (!t) { M.err.textContent = "Add a topic for your note."; M.err.hidden = false; return; }
  if (!d) { M.err.textContent = "Add a description for your note."; M.err.hidden = false; return; }
  M.post.disabled = true; M.post.textContent = "Publishing…";
  try {
    const who = await getMe();
    await addDoc(collection(db, "ideaBoards", M.board.id, "notes"), {
      topic: t, description: d, authorUid: who.uid, authorName: who.name,
      pinned: false, edited: false, createdAt: serverTimestamp()
    });
    resetCompose();
  } catch (e) {
    console.warn(e);
    M.err.textContent = "Couldn't publish your note. Please try again.";
    M.err.hidden = false; M.post.disabled = false; M.post.textContent = "Publish note";
  }
}

async function togglePin(n) {
  if (!hasPerm(PERM)) return ideaFlash('⚠ You don\'t have access to "Idea Boards".');
  try {
    await updateDoc(doc(db, "ideaBoards", M.board.id, "notes", n.id),
      n.pinned ? { pinned: false, pinnedAt: deleteField() } : { pinned: true, pinnedAt: serverTimestamp() });
  } catch (e) { console.warn(e); ideaFlash("⚠ Couldn't update the pin. Please try again."); }
}

async function deleteNote(n, mine) {
  const msg = mine ? "Delete your note? This can't be undone."
    : `Delete this note by ${n.authorName || "this batchmate"}? This can't be undone.`;
  if (!confirm(msg)) return;
  try { await deleteDoc(doc(db, "ideaBoards", M.board.id, "notes", n.id)); }
  catch (e) { console.warn(e); ideaFlash("⚠ Couldn't delete the note. Please try again."); }
}

async function deleteBoard() {
  if (!hasPerm(PERM)) return ideaFlash('⚠ You don\'t have access to "Idea Boards".');
  if (!confirm(`Delete the board "${M.board.title}" and ALL of its notes? This can't be undone.`)) return;
  M.delBoard.disabled = true;
  try {
    const snap = await getDocs(collection(db, "ideaBoards", M.board.id, "notes"));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, "ideaBoards", M.board.id));
    closeModal();
    if (refreshBoards) refreshBoards();
  } catch (e) { console.warn(e); ideaFlash("⚠ Couldn't delete the board. Please try again."); }
  M.delBoard.disabled = false;
}

// ═════════════════ ADMIN SIDE (admin.html → Add tab) ═════════════════

function initIdeasAdmin() {
  const btn = $("#new-idea-board-btn");
  if (!btn || btn.dataset.ready) return;
  btn.dataset.ready = "1";
  let C = null;

  function build() {
    const ov = ideaOverlay("idea-create-modal");
    C = { ov };
    C.title = el("input", { type: "text", maxlength: LIM.boardTitle, placeholder: "e.g. Farewell party ideas", autocomplete: "off" });
    C.desc = el("textarea", { rows: 3, maxlength: LIM.boardDesc, placeholder: "What should people share here? (optional)" });
    C.err = el("p", { class: "error-msg", hidden: true });
    C.ok = el("p", { class: "ib-ok", hidden: true, text: "✓ Board created — it's now live on the Home page. Share its link:" });
    C.link = el("input", { type: "text", readonly: true, class: "ib-linkbox", onclick: (e) => e.target.select() });
    C.copy = el("button", { type: "button", class: "ghost-btn ib-btn", text: "🔗 Copy link" });
    C.linkRow = el("div", { class: "ib-linkrow", hidden: true }, C.link, C.copy);
    C.copy.addEventListener("click", () => { if (C.newId) copyBoardLink(C.newId, C.copy, "🔗 Copy link"); });
    C.btn = el("button", { type: "button", class: "btn-primary", text: "Create board", onclick: create });
    const close = el("button", { class: "modal-close", type: "button", "aria-label": "Close", text: "✕", onclick: () => { ov.hidden = true; } });
    ov.append(el("div", { class: "modal-box" }, close,
      el("div", { class: "admin-modal-body" },
        el("p", { class: "section-label", text: "Create Idea Board" }),
        el("label", { text: "Board title" }), C.title,
        el("label", { text: "Description" }), C.desc,
        C.err, C.ok, C.linkRow, C.btn)));
    ov.addEventListener("click", (e) => { if (e.target === ov) ov.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") ov.hidden = true; });
    C.title.addEventListener("input", () => { C.ok.hidden = true; C.linkRow.hidden = true; });
  }

  async function create() {
    C.err.hidden = true; C.ok.hidden = true; C.linkRow.hidden = true;
    const title = C.title.value.trim();
    if (!title) { C.err.textContent = "Give the board a title."; C.err.hidden = false; return; }
    C.btn.disabled = true; C.btn.textContent = "Creating…";
    try {
      const ref = await addDoc(collection(db, "ideaBoards"), {
        title, description: C.desc.value.trim(),
        createdAt: serverTimestamp(), createdBy: auth.currentUser.uid
      });
      C.title.value = ""; C.desc.value = ""; C.ok.hidden = false; // stays open so several can be added in a row
      C.newId = ref.id; C.link.value = boardLink(ref.id); C.linkRow.hidden = false;
    } catch (e) {
      console.warn(e);
      C.err.textContent = "Couldn't create the board. Check your permission and try again.";
      C.err.hidden = false;
    }
    C.btn.disabled = false; C.btn.textContent = "Create board";
  }

  btn.addEventListener("click", () => {
    if (!hasPerm(PERM)) return ideaFlash('⚠ You don\'t have access to "Idea Boards".');
    if (!C) build();
    C.err.hidden = true; C.ok.hidden = true; C.linkRow.hidden = true;
    C.ov.hidden = false;
    C.title.focus();
  });
}

// ── boot ──
onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  if ($("#home-content")) initHome().catch((e) => console.warn("Forms init failed:", e));
  // Admin status is needed on both pages: Admin (forms + create idea board) and
  // Home (idea-board pin/delete controls).
  if ($("#admin-page") || $("#ideas-card")) {
    try { const s = await getDoc(doc(db, "admins", user.uid)); adminInfo = s.exists() ? s.data() : null; } catch (e) { adminInfo = null; }
  }
  if ($("#admin-page") && adminInfo) initAdmin().catch((e) => console.warn("Forms admin failed:", e));
  if ($("#ideas-card")) initIdeasHome().catch((e) => console.warn("Idea boards init failed:", e));
  if ($("#new-idea-board-btn")) initIdeasAdmin();
});
