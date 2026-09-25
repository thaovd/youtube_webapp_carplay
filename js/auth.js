/* =====================================================================
   Đăng nhập Google bằng Google Identity Services (OAuth 2.0 token flow).
   Token truy cập được lưu tạm trong sessionStorage cùng thời điểm hết hạn.
   ===================================================================== */
window.Auth = (function () {
  const TKEY = "cartube.token";
  let tokenClient = null;
  let gisReady = false;
  let pending = null;           // { resolve, reject } của lần yêu cầu token đang chờ
  let profile = null;           // { name, avatar, channelId }
  const listeners = new Set();

  function emit() { listeners.forEach(fn => fn(getState())); }
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function readToken() {
    try {
      const t = JSON.parse(sessionStorage.getItem(TKEY) || "null");
      if (t && t.access_token && t.expires_at > Date.now() + 30_000) return t;
    } catch (_) {}
    return null;
  }
  function writeToken(resp) {
    const t = { access_token: resp.access_token, expires_at: Date.now() + (+resp.expires_in || 3600) * 1000 };
    sessionStorage.setItem(TKEY, JSON.stringify(t));
    return t;
  }

  function getState() {
    return { signedIn: !!readToken(), profile, ready: gisReady && !!Util.loadSettings().clientId };
  }
  function getToken() { const t = readToken(); return t ? t.access_token : null; }

  function initClient() {
    const { clientId } = Util.loadSettings();
    if (!gisReady || !clientId || !window.google?.accounts?.oauth2) return null;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: window.CARTUBE_SCOPES,
      callback: (resp) => {
        if (resp.error) {
          pending?.reject(new Error(resp.error_description || resp.error));
        } else {
          writeToken(resp);
          try { localStorage.setItem("cartube.wasSignedIn", "1"); } catch (_) {}
          pending?.resolve(resp.access_token);
          loadProfile().finally(emit);
        }
        pending = null;
      },
      error_callback: (err) => { pending?.reject(new Error(err?.type || "popup_failed")); pending = null; }
    });
    return tokenClient;
  }

  function onGisLoaded() { gisReady = true; initClient(); emit(); if (readToken()) loadProfile().finally(emit); }

  /* Yêu cầu token. interactive=false thử làm mới ngầm (không hiện popup) */
  function signIn({ interactive = true } = {}) {
    return new Promise((resolve, reject) => {
      const cached = readToken();
      if (cached) return resolve(cached.access_token);
      if (!tokenClient && !initClient()) return reject(new Error("no_client"));
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
    });
  }

  function signOut() {
    const t = readToken();
    sessionStorage.removeItem(TKEY);
    try { localStorage.removeItem("cartube.wasSignedIn"); } catch (_) {}
    profile = null;
    if (t && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(t.access_token, () => {});
    emit();
  }

  async function loadProfile() {
    try {
      const data = await Api.get("channels", { part: "snippet", mine: "true" });
      const ch = data.items?.[0];
      if (ch) profile = { channelId: ch.id, name: ch.snippet.title, avatar: Util.bestThumb(ch.snippet.thumbnails) };
    } catch (_) { profile = null; }
  }

  /* Gọi lại khi người dùng đổi Client ID trong Cài đặt */
  function reconfigure() { tokenClient = null; initClient(); emit(); }

  /* ---- Đăng nhập kiểu chuyển hướng (không cần popup) – dùng khi popup bị chặn/đóng, phổ biến trên mobile & trình duyệt ô tô ----
     Google chuyển về đúng URL của app kèm #access_token=... ; URL này phải nằm trong "Authorized redirect URIs" của Client ID. */
  const SKEY = "cartube.oauth_state";
  function redirectUri() { return location.origin + location.pathname; }
  function redirectSignIn() {
    const { clientId } = Util.loadSettings();
    if (!clientId) return;
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { sessionStorage.setItem(SKEY, state); } catch (_) {}
    const q = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri(), response_type: "token", scope: window.CARTUBE_SCOPES,
      include_granted_scopes: "true", state, prompt: "select_account"
    });
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + q.toString());
  }
  /* Đọc token từ URL sau khi Google chuyển hướng về. Trả về: "ok" | "error:<mã>" | null (không phải lượt quay về) */
  function consumeRedirect() {
    const h = location.hash || "";
    if (!/access_token=|error=/.test(h)) return null;
    const p = new URLSearchParams(h.slice(1));
    let expected = null; try { expected = sessionStorage.getItem(SKEY); sessionStorage.removeItem(SKEY); } catch (_) {}
    history.replaceState(null, "", location.pathname + location.search);   // xoá token khỏi thanh địa chỉ / lịch sử
    if (p.get("error")) return "error:" + p.get("error");
    if (!p.get("access_token") || (expected && p.get("state") !== expected)) return "error:state_mismatch";
    writeToken({ access_token: p.get("access_token"), expires_in: p.get("expires_in") });
    try { localStorage.setItem("cartube.wasSignedIn", "1"); } catch (_) {}
    return "ok";
  }
  const redirectResult = consumeRedirect();

  return { onGisLoaded, signIn, signOut, getToken, getState, onChange, reconfigure, redirectSignIn, redirectUri, redirectResult };
})();
