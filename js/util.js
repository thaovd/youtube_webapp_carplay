/* Tiện ích chung */
window.Util = (function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
    return n;
  }

  /* Đọc/ghi cài đặt */
  const SKEY = "cartube.settings";
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SKEY) || "{}"); } catch (_) {}
    return Object.assign({}, window.CARTUBE_DEFAULTS, saved);
  }
  function saveSettings(patch) {
    const cur = loadSettings();
    const next = Object.assign(cur, patch);
    localStorage.setItem(SKEY, JSON.stringify(next));
    return next;
  }

  /* ISO 8601 (PT1H2M3S) -> giây */
  function parseDuration(iso) {
    if (!iso) return 0;
    const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
    if (!m) return 0;
    return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  }
  function fmtCount(n) {
    n = +n || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + " T";
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + " Tr";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + " N";
    return String(n);
  }
  function fmtAgo(iso) {
    if (!iso) return "";
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    const units = [["năm", 31536000], ["tháng", 2592000], ["tuần", 604800], ["ngày", 86400], ["giờ", 3600], ["phút", 60]];
    for (const [name, s] of units) if (d >= s) return Math.floor(d / s) + " " + name + " trước";
    return "vừa xong";
  }

  function bestThumb(thumbs) {
    if (!thumbs) return "";
    return (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default || {}).url || "";
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  /* Nhật ký sự kiện (để chẩn đoán trên thiết bị không có console) */
  const LOG_MAX = 300, logBuf = [];
  const t0 = Date.now();
  function log(...args) {
    const line = ((Date.now() - t0) / 1000).toFixed(2).padStart(8) + "  " + args.map(a => typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })()).join(" ");
    logBuf.push(line); if (logBuf.length > LOG_MAX) logBuf.shift();
  }
  function getLog() { return logBuf.join("\n"); }
  window.addEventListener("error", (e) => log("JS ERROR:", e.message, e.filename ? e.filename.split("/").pop() + ":" + e.lineno : ""));
  window.addEventListener("unhandledrejection", (e) => log("PROMISE ERROR:", e.reason?.message || String(e.reason)));
  document.addEventListener("visibilitychange", () => log("visibility:", document.visibilityState));
  window.addEventListener("pagehide", () => log("pagehide")); window.addEventListener("pageshow", (e) => log("pageshow persisted=" + e.persisted));
  window.addEventListener("resize", () => log("resize", innerWidth + "x" + innerHeight));

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  /* Nguồn phát hiệu lực: "auto" -> stream trên iOS, embed nơi khác */
  function playerSource() { const v = loadSettings().playerSource; return v === "auto" || !v ? (isIOS ? "stream" : "embed") : v; }

  function decodeHtml(s) { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; }

  return { $, $$, el, loadSettings, saveSettings, parseDuration, fmtTime, fmtCount, fmtAgo, bestThumb, toast, decodeHtml, log, getLog, playerSource, isIOS };
})();
