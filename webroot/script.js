"use strict";

const MODDIR = "/data/adb/modules/vibratorcontroller";
const APPS_FILE = MODDIR + "/apps.txt";
const PKG_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;

const HAS_BRIDGE = !!(window.ksu && typeof window.ksu.exec === "function");
const HAS_INFO = !!(window.ksu && typeof window.ksu.getPackagesInfo === "function");

let installed = [];          // packages shown on the Apps tab
let muted = [];              // packages listed in apps.txt
let mutedSet = new Set();
let labels = {};             // pkg -> app label
let entries = new Map();     // pkg -> { pkg, name, fn, fp }
let rows = new Map();        // pkg -> cached row element
let tab = "apps";
let showSystem = false;
let query = "";
let chain = Promise.resolve();

const $ = (id) => document.getElementById(id);

/* ---------- shell ---------- */

function sh(cmd) {
  return new Promise((resolve) => {
    const cb = "cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e6);
    window[cb] = (errno, stdout, stderr) => { resolve({ errno, stdout: stdout || "", stderr: stderr || "" }); delete window[cb]; };
    if (HAS_BRIDGE) { try { ksu.exec(cmd, "{}", cb); } catch (e) { resolve({ errno: -1, stdout: "", stderr: String(e) }); delete window[cb]; } }
    else { resolve({ errno: -1, stdout: "", stderr: "ksu.exec bridge not available" }); delete window[cb]; }
  });
}

function toLines(text) {
  return (text || "").split("\n").map((l) => l.replace(/\r$/, "").trim()).filter((l) => l.length);
}

function queue(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

/* ---------- data ---------- */

async function readMuted() {
  const r = await sh("cat '" + APPS_FILE + "' 2>/dev/null");
  return Array.from(new Set(toLines(r.stdout).filter((p) => PKG_RE.test(p)))).sort();
}

function writeMuted(list) {
  const txt = list.length ? list.join("\n") + "\n" : "";
  const payload = btoa(txt);
  const tmp = APPS_FILE + ".tmp";
  return sh("printf '%s' '" + payload + "' | base64 -d > '" + tmp + "' && mv -f '" + tmp + "' '" + APPS_FILE + "'");
}

async function listInstalled() {
  const r = await sh("pm list packages " + (showSystem ? "" : "-3 ") + "2>/dev/null | sed 's/^package://' | sort -u");
  return toLines(r.stdout).filter((p) => PKG_RE.test(p));
}

function guessName(pkg) {
  const skip = ["android", "app", "apps", "mobile", "free", "lite"];
  const parts = pkg.split(".");
  let last = parts[parts.length - 1];
  for (let i = parts.length - 1; i > 0 && skip.indexOf(last) !== -1; i--) last = parts[i - 1];
  last = last.replace(/[_-]+/g, " ");
  return last.charAt(0).toUpperCase() + last.slice(1);
}

async function loadLabels(pkgs) {
  const need = pkgs.filter((p) => !(p in labels));
  if (!need.length) return;
  if (HAS_INFO) {
    for (let i = 0; i < need.length; i += 100) {
      try {
        const arr = JSON.parse(ksu.getPackagesInfo(JSON.stringify(need.slice(i, i + 100))));
        (arr || []).forEach((it) => {
          if (it && it.packageName && typeof it.appLabel === "string" && it.appLabel.trim()) labels[it.packageName] = it.appLabel.trim();
        });
      } catch (e) { /* fall back to guessed names */ }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  need.forEach((p) => { if (!labels[p]) labels[p] = guessName(p); });
}

async function loadData() {
  $("appList").innerHTML = '<div class="state-view"><div class="spinner"></div><div class="title">Loading</div></div>';
  if (!HAS_BRIDGE) {
    $("listTitle").textContent = "";
    $("appList").innerHTML = '<div class="state-view"><div class="title">Bridge not found</div><div class="subtitle">Open this page from the KernelSU / Magisk manager app</div></div>';
    return;
  }
  const res = await Promise.all([listInstalled(), readMuted()]);
  installed = res[0];
  muted = res[1];
  mutedSet = new Set(muted);
  await loadLabels(installed.concat(muted));
  render();
}

/* ---------- search ---------- */

function foldUnit(c) {
  if (c === "\u0111" || c === "\u0110") return "d";
  const f = c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return f.length === 1 ? f : c;
}

function fold(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) out += foldUnit(s.charAt(i));
  return out;
}

function tokens(q) {
  return fold(q.normalize("NFC")).split(/\s+/).filter(Boolean);
}

function esc(text) {
  const d = document.createElement("div");
  d.textContent = text == null ? "" : String(text);
  return d.innerHTML;
}

// Wraps every matched part of `text` in <b>. `folded` has the same length as `text`.
function hl(text, folded, toks) {
  if (!toks.length) return esc(text);
  const mark = new Uint8Array(text.length);
  let any = false;
  toks.forEach((t) => {
    let i = folded.indexOf(t);
    while (i !== -1) { mark.fill(1, i, i + t.length); any = true; i = folded.indexOf(t, i + 1); }
  });
  if (!any) return esc(text);
  let out = "", run = "", on = false;
  for (let i = 0; i < text.length; i++) {
    const m = mark[i] === 1;
    if (m !== on) { out += on ? "<b>" + esc(run) + "</b>" : esc(run); run = ""; on = m; }
    run += text.charAt(i);
  }
  return out + (on ? "<b>" + esc(run) + "</b>" : esc(run));
}

function getEntry(pkg) {
  let e = entries.get(pkg);
  if (!e) {
    const name = (labels[pkg] || guessName(pkg)).normalize("NFC");
    e = { pkg: pkg, name: name, fn: fold(name), fp: fold(pkg) };
    entries.set(pkg, e);
  }
  return e;
}

// Every word must match the app name OR the package name.
function matches(e, toks) {
  return toks.every((t) => e.fn.indexOf(t) !== -1 || e.fp.indexOf(t) !== -1);
}
function nameMatches(e, toks) {
  return toks.every((t) => e.fn.indexOf(t) !== -1);
}

/* ---------- render ---------- */

function getRow(e) {
  let row = rows.get(e.pkg);
  if (row) return row;
  row = document.createElement("div");
  row.className = "tweak-row app-row";
  row.setAttribute("data-pkg", e.pkg);
  row.innerHTML =
    '<div class="app-icon"><span class="app-icon-fb"></span></div>' +
    '<div class="tweak-info"><span class="tweak-name"></span><div class="tweak-desc"></div></div>' +
    '<div class="switch" role="switch"><div class="thumb"></div></div>';
  row.querySelector(".app-icon-fb").textContent = e.name.charAt(0);
  if (HAS_BRIDGE) {
    const img = document.createElement("img");
    img.alt = ""; img.decoding = "async"; img.loading = "lazy";
    img.addEventListener("load", () => img.classList.add("ok"));
    img.addEventListener("error", () => img.remove());
    img.src = "ksu://icon/" + e.pkg;
    row.querySelector(".app-icon").appendChild(img);
  }
  row._name = row.querySelector(".tweak-name");
  row._desc = row.querySelector(".tweak-desc");
  row._sw = row.querySelector(".switch");
  rows.set(e.pkg, row);
  return row;
}

function render() {
  const list = $("appList");
  const toks = tokens(query);
  const isApps = tab === "apps";
  const source = isApps ? installed : muted;

  const found = [];
  source.forEach((pkg) => { const e = getEntry(pkg); if (matches(e, toks)) found.push(e); });
  found.sort((a, b) => {
    const ra = nameMatches(a, toks) ? 0 : 1, rb = nameMatches(b, toks) ? 0 : 1;
    return (ra - rb) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  $("listTitle").textContent = (isApps ? "Installed apps" : "Muted apps") + " \u00b7 " + found.length;

  if (!found.length) {
    const t = toks.length ? "No matching apps" : (isApps ? "No apps found" : "No muted apps");
    const s = toks.length ? "Try a different search term" : (isApps ? "" : "Turn on an app in the Apps tab");
    list.innerHTML = '<div class="state-view"><div class="title">' + t + "</div>" + (s ? '<div class="subtitle">' + s + "</div>" : "") + "</div>";
    return;
  }

  const frag = document.createDocumentFragment();
  found.forEach((e) => {
    const row = getRow(e);
    const nameHtml = hl(e.name, e.fn, toks), descHtml = hl(e.pkg, e.fp, toks);
    if (row._nameHtml !== nameHtml) { row._name.innerHTML = nameHtml; row._nameHtml = nameHtml; }
    if (row._descHtml !== descHtml) { row._desc.innerHTML = descHtml; row._descHtml = descHtml; }
    const on = mutedSet.has(e.pkg);
    row._sw.classList.toggle("on", on);
    row._sw.setAttribute("aria-checked", on ? "true" : "false");
    frag.appendChild(row);
  });
  list.textContent = "";
  list.appendChild(frag);
}

function showSnackbar(text) {
  const old = document.querySelector(".snackbar");
  if (old) old.remove();
  const el = document.createElement("div");
  el.className = "snackbar"; el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

/* ---------- actions ---------- */

function toggle(pkg) {
  const e = getEntry(pkg);
  const mute = !mutedSet.has(pkg);
  if (mute) { muted.push(pkg); muted.sort(); mutedSet.add(pkg); }
  else { muted = muted.filter((p) => p !== pkg); mutedSet.delete(pkg); }
  render();

  queue(async () => {
    const w = await writeMuted(muted);
    if (w.errno !== 0) throw new Error(w.stderr || "could not save list");
    const r = await sh("cmd appops set '" + pkg + "' VIBRATE " + (mute ? "ignore" : "allow"));
    if (r.errno !== 0) throw new Error(r.stderr || "appops failed");
    showSnackbar((mute ? "Muted " : "Unmuted ") + e.name);
  }).catch((err) => {
    showSnackbar("Error: " + err.message);
    return loadData();
  });
}

$("appList").addEventListener("click", (ev) => {
  const row = ev.target.closest(".app-row");
  if (row) toggle(row.getAttribute("data-pkg"));
});

$("rowSystem").addEventListener("click", () => {
  showSystem = !showSystem;
  $("systemSwitch").classList.toggle("on", showSystem);
  loadData();
});

/* ---------- search bar ---------- */

$("searchInput").addEventListener("input", (e) => {
  query = e.target.value;
  $("searchBar").classList.toggle("has-text", query.length > 0);
  $("searchBarWrap").classList.remove("collapsed");
  render();
  $("panel").scrollTop = 0;
});
$("searchClear").addEventListener("click", () => {
  const input = $("searchInput");
  input.value = ""; query = "";
  $("searchBar").classList.remove("has-text");
  render();
  input.focus();
});

function wireScrollCollapse() {
  const panel = $("panel");
  const wrap = $("searchBarWrap");
  let lastY = 0;
  panel.addEventListener("scroll", () => {
    const y = panel.scrollTop;
    if (y > lastY && y > 40) wrap.classList.add("collapsed");
    else wrap.classList.remove("collapsed");
    lastY = y;
  }, { passive: true });
}

/* ---------- nav bar ---------- */

function wireNavBar() {
  const navTabs = Array.from(document.querySelectorAll(".nav-tab"));
  const indicator = $("nav-indicator");

  function reposition(t) {
    indicator.style.left = t.offsetLeft + "px";
    indicator.style.width = t.offsetWidth + "px";
  }

  function switchTab(name) {
    const t = navTabs.find((x) => x.getAttribute("data-panel") === name);
    if (!t || name === tab) return;
    tab = name;
    navTabs.forEach((x) => x.classList.toggle("nav-tab--active", x === t));
    reposition(t);
    $("optBox").classList.toggle("hidden", tab !== "apps");
    $("searchBarWrap").classList.remove("collapsed");
    render();
    $("panel").scrollTop = 0;
  }

  navTabs.forEach((t) => t.addEventListener("click", () => switchTab(t.getAttribute("data-panel"))));
  window.addEventListener("resize", () => {
    const active = document.querySelector(".nav-tab--active");
    if (active) reposition(active);
  });
  requestAnimationFrame(() => {
    const active = document.querySelector(".nav-tab--active");
    if (active) reposition(active);
  });
}

wireNavBar();
wireScrollCollapse();
loadData();
