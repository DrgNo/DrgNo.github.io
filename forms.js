// ── Forms feature (home cards, fill/edit, admin builder, responses) ──
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
  date: "Date", number: "Number", prefixed: "Pre-filled (e.g. AS…)"
};

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
const toDate = (v) => (v && v.toDate ? v.toDate() : v ? new Date(v) : null);
const fmtDate = (d) => d ? d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const pad = (n) => String(n).padStart(2, "0");
const toInputValue = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const newId = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  rosterCache = snap.docs.map((d) => ({ uid: d.id, name: d.data().fullName || "Unnamed", index: d.data().campusIndexNumber || "" }))
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
  me = { uid: auth.currentUser.uid, name: d.fullName || auth.currentUser.email, index: d.campusIndexNumber || "" };
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

function fieldInput(f, val) {
  let input, node;
  if (f.type === "long") input = el("textarea", { rows: 4 });
  else if (f.type === "date") input = el("input", { type: "date" });
  else if (f.type === "number") input = el("input", { type: "number", step: "any", inputmode: "decimal" });
  else if (f.type === "link") input = el("input", { type: "url", placeholder: "https://" });
  else input = el("input", { type: "text" });
  node = input;
  let v = val == null ? "" : String(val);
  if (f.type === "prefixed") {
    const p = f.prefix || "";
    if (p && v.toLowerCase().startsWith(p.toLowerCase())) v = v.slice(p.length);
    node = el("div", { class: "fm-prefix" }, el("span", { text: p }), input);
    input.placeholder = "2002547";
  }
  input.value = v;
  return {
    node,
    get() {
      const t = input.value.trim();
      if (!t) return "";
      if (f.type === "prefixed") { const p = f.prefix || ""; return t.toLowerCase().startsWith(p.toLowerCase()) ? t : p + t; }
      return t;
    }
  };
}

async function openFill(formId, onDone) {
  const ov = $("#fm-fill") || overlay("fm-fill");
  ov.hidden = false;
  ov.innerHTML = "";
  const box = el("div", { class: "modal-box fm-box" }, closeBtn(ov));
  ov.append(box);
  box.append(el("p", { class: "fm-loading", text: "Loading…" }));
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

  const info = dueInfo(d);
  box.append(el("div", { class: "fm-due fm-due-lg", style: `--due:${info.color}` }, el("span", { class: "fm-dot" }), el("b", { text: info.label }), el("span", { class: "fm-card-sub", text: " · Due " + fmtDate(d) })));
  if (f.description) box.append(el("p", { class: "fm-desc", text: f.description }));
  if (resp) box.append(el("div", { class: "fm-edit-note", text: "✎ You've already submitted — you can edit and save your answers." }));

  const form = el("form", { class: "fm-form", novalidate: true });
  const inputs = [];
  (f.fields || []).forEach((fd) => {
    const inp = fieldInput(fd, resp?.answers?.[fd.id]);
    inputs.push([fd, inp]);
    form.append(el("div", { class: "fm-field" },
      el("label", {}, fd.label, fd.required ? el("span", { class: "fm-req", text: " *" }) : null),
      fd.help ? el("small", { text: fd.help }) : null, inp.node));
  });
  const err = el("p", { class: "error-msg", hidden: true });
  const btn = el("button", { type: "submit", class: "btn-primary", text: resp ? "Save changes" : "Submit" });
  form.append(err, btn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    const answers = {};
    for (const [fd, inp] of inputs) {
      const v = inp.get();
      if (fd.required && !v) { err.textContent = `"${fd.label}" is required.`; err.hidden = false; return; }
      if (v && fd.type === "link" && !/^https?:\/\/\S+\.\S+/i.test(v)) { err.textContent = `"${fd.label}" needs a valid link starting with http(s)://`; err.hidden = false; return; }
      if (v && fd.type === "number" && !isFinite(Number(v))) { err.textContent = `"${fd.label}" must be a number.`; err.hidden = false; return; }
      answers[fd.id] = v;
    }
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const m = await getMe();
      await setDoc(doc(db, "forms", f.id, "responses", m.uid), {
        uid: m.uid, name: m.name, index: m.index, answers,
        firstSubmittedAt: resp?.firstSubmittedAt || serverTimestamp(),
        respondedAt: serverTimestamp()
      });
      box.innerHTML = "";
      box.append(closeBtn(ov), el("div", { class: "fm-msg ok" }, el("div", { class: "fm-tick", text: "✓" }), el("h3", { text: resp ? "Changes saved" : "Submitted!" }), el("p", { text: "You can reopen this form any time before the due date to edit your answers." }),
        el("button", { class: "btn-primary", type: "button", text: "Done", onclick: () => { ov.hidden = true; } })));
      if (onDone) onDone();
    } catch (x) {
      err.textContent = "Couldn't save — the form may have just closed. Please try again."; err.hidden = false;
      btn.disabled = false; btn.textContent = resp ? "Save changes" : "Submit";
    }
  });
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
    activeBox.innerHTML = histBox.innerHTML = '<p class="info-text" style="color:var(--muted)">Loading…</p>';
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
  B.list = el("div", { class: "fm-builder-list" });
  B.push = pushControls(true, "Send push notification");
  B.err = el("p", { class: "error-msg", hidden: true });
  B.result = el("div", { class: "fm-msg ok", hidden: true });
  B.saveBtn = el("button", { type: "button", class: "btn-primary", onclick: saveForm });
  B.heading = el("p", { class: "section-label" });
  const chips = el("div", { class: "fm-addrow" }, el("span", { text: "Add field:" }),
    ...Object.entries(TYPES).map(([t, l]) => el("button", { type: "button", class: "fm-addchip", text: "+ " + l, onclick: () => { B.fields.push({ id: newId(), type: t, label: "", required: false, prefix: t === "prefixed" ? "AS" : "", help: "" }); renderFields(); } })));
  B.body = el("div", { class: "admin-modal-body fm-builder-body" }, B.heading,
    el("label", { text: "Form title" }), B.title, el("label", { text: "Description" }), B.desc,
    el("label", { text: "Due date & time" }), B.due,
    el("p", { class: "section-label", style: "margin-top:18px;", text: "Fields" }), B.list, chips,
    B.pushWrap = el("div", { style: "margin-top:18px;" }, B.push.root), B.err, B.saveBtn);
  B.box = el("div", { class: "modal-box" }, closeBtn(ov), B.body, B.result);
  ov.append(B.box);
}

function renderFields() {
  B.list.innerHTML = "";
  if (!B.fields.length) B.list.append(el("p", { class: "fine-print", style: "text-align:left", text: "No fields yet — add one below." }));
  B.fields.forEach((f, i) => {
    const type = el("select", {}, ...Object.entries(TYPES).map(([t, l]) => el("option", { value: t, text: l })));
    type.value = f.type;
    type.addEventListener("change", () => { f.type = type.value; if (f.type === "prefixed" && !f.prefix) f.prefix = "AS"; renderFields(); });
    const label = el("input", { type: "text", placeholder: "Question / field name" }); label.value = f.label;
    label.addEventListener("input", () => { f.label = label.value; });
    const help = el("input", { type: "text", placeholder: "Helper text (optional)" }); help.value = f.help || "";
    help.addEventListener("input", () => { f.help = help.value; });
    const req = el("input", { type: "checkbox" }); req.checked = !!f.required;
    req.addEventListener("change", () => { f.required = req.checked; });
    const prefix = el("input", { type: "text", placeholder: "Prefix, e.g. AS", class: "fm-prefix-input", hidden: f.type !== "prefixed" }); prefix.value = f.prefix || "";
    prefix.addEventListener("input", () => { f.prefix = prefix.value.trim(); });
    const mv = (dir) => () => { const j = i + dir; if (j < 0 || j >= B.fields.length) return; [B.fields[i], B.fields[j]] = [B.fields[j], B.fields[i]]; renderFields(); };
    B.list.append(el("div", { class: "fm-bfield" },
      el("div", { class: "fm-brow" }, label, type),
      f.type === "prefixed" ? el("div", { class: "fm-brow" }, prefix, el("small", { text: "Users type only the rest, e.g. 2002547 → " + (f.prefix || "AS") + "2002547" })) : null,
      el("div", { class: "fm-brow" }, help),
      el("div", { class: "fm-brow fm-bactions" },
        el("label", { class: "fm-req-toggle" }, req, el("span", { text: "Required" })),
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
  B.fields = form ? JSON.parse(JSON.stringify(form.fields || [])) : [{ id: newId(), type: "short", label: "", required: true, prefix: "", help: "" }];
  B.push = B.push; B.push.reset();
  // edit mode: notification is opt-in
  const cb = B.push.root.querySelector("input[type=checkbox]"); cb.checked = !form; cb.dispatchEvent(new Event("change"));
  B.push.root.querySelector(".push-toggle-row span").textContent = form ? "Notify batch that this form was updated" : "Send push notification";
  renderFields();
  B.ov.hidden = false;
}

async function saveForm() {
  const fail = (t) => { B.err.textContent = t; B.err.hidden = false; };
  B.err.hidden = true;
  const title = B.title.value.trim();
  if (!title) return fail("Give the form a title.");
  if (!B.due.value) return fail("Pick a due date & time.");
  const due = new Date(B.due.value);
  if (isNaN(due) || due <= new Date()) return fail("Due date must be in the future.");
  if (!B.fields.length) return fail("Add at least one field.");
  for (const f of B.fields) {
    if (!f.label.trim()) return fail("Every field needs a label.");
    if (f.type === "prefixed" && !f.prefix) return fail(`"${f.label}" needs a prefix (e.g. AS).`);
  }
  const fields = B.fields.map((f) => ({ id: f.id, type: f.type, label: f.label.trim(), required: !!f.required, help: (f.help || "").trim(), ...(f.type === "prefixed" ? { prefix: f.prefix } : {}) }));
  const data = { title, description: B.desc.value.trim(), fields, dueAt: due };
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
  try { snap = await getDocs(collection(db, "forms", f.id, "responses")); }
  catch (e) { return alert("Couldn't read the responses — please try again."); }
  if (!confirm(`Permanently delete "${f.title}" and its ${snap.size} response(s)? This cannot be undone.`)) return;
  try {
    for (let i = 0; i < snap.docs.length; i += 400) {
      const b = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
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
  ? [{ k: "_name", l: "Name" }, { k: "_index", l: "Index No" }]
  : [{ k: "_name", l: "Name" }, { k: "_index", l: "Index No" }, ...(R.form.fields || []).map((f) => ({ k: f.id, l: f.label })), { k: "_at", l: "Responded At" }];
function rvVal(r, k) {
  if (k === "_name") return r.name || "";
  if (k === "_index") return r.index || "";
  if (k === "_at") return r.respondedAt ? fmtDate(toDate(r.respondedAt)) : "";
  return r.answers?.[k] ?? "";
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
  const box = el("div", { class: "modal-box" }, closeBtn(ov), el("div", { class: "admin-modal-body", id: "fm-resp-body" }, el("p", { class: "info-text", text: "Loading…" })));
  ov.append(box);
  R = { form, mode: "responses", sort: { key: null, dir: "asc" }, filterKey: "", filterText: "", responses: [], pending: [] };
  try {
    const [rs, roster] = await Promise.all([getDocs(collection(db, "forms", form.id, "responses")), getRoster()]);
    R.responses = rs.docs.map((d) => ({ uid: d.id, ...d.data() }));
    const done = new Set(R.responses.map((r) => r.uid));
    R.pending = roster.filter((b) => !done.has(b.uid));
  } catch (e) { $("#fm-resp-body").innerHTML = '<p class="error-msg">Could not load responses (permission?).</p>'; return; }
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
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Download Excel", onclick: exportXlsx }),
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Download PDF", onclick: exportPdf }),
      el("button", { type: "button", class: "ghost-btn", style: small, text: "Refresh", onclick: () => openResponses(R.form) })),
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
  rows.forEach((r) => tb.append(el("tr", {}, ...cols.map((c) => { const v = String(rvVal(r, c.k)); return el("td", { text: v || "—", title: v }); }))));
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
  M.list.append(el("p", { class: "ib-empty", text: "Loading…" }));
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
