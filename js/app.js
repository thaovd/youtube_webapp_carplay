/* =====================================================================
   Ứng dụng: điều hướng, các màn hình, cài đặt, tài khoản
   ===================================================================== */
(function () {
  const { $, $$, el, toast, fmtTime, fmtCount, fmtAgo } = Util;
  const app = $("#app"), view = $("#view"), title = $("#view-title"), tools = $("#topbar-tools"), chips = $("#chips");
  let currentView = null;
  let searchQuery = "";
  let subsCache = null;          // { subs, items }

  /* ---------- Helpers hiển thị ---------- */
  function setChrome(t, toolNodes = [], chipNodes = null) {
    title.textContent = t;
    tools.replaceChildren(...toolNodes);
    if (chipNodes) { chips.replaceChildren(...chipNodes); chips.hidden = false; } else { chips.hidden = true; chips.replaceChildren(); }
  }
  function loading() { view.replaceChildren(el("div", { class: "state" }, [el("div", { class: "spinner" })])); }
  function stateMsg(msg, actions = []) {
    view.replaceChildren(el("div", { class: "state" }, [el("p", { text: msg }), ...actions]));
  }
  function card(v, list, i) {
    const t = $("#tpl-card").content.firstElementChild.cloneNode(true);
    const img = t.querySelector("img"); img.src = v.thumb; img.alt = "";
    const th = t.querySelector(".thumb"); th.classList.toggle("live", !!v.live);
    t.querySelector(".dur").textContent = v.live ? "TRỰC TIẾP" : fmtTime(v.duration);
    t.querySelector(".card-title").textContent = v.title;
    const bits = [v.channel];
    if (v.views) bits.push(fmtCount(v.views) + " lượt xem");
    if (v.publishedAt) bits.push(fmtAgo(v.publishedAt));
    t.querySelector(".card-sub").textContent = bits.filter(Boolean).join(" · ");
    t.addEventListener("click", () => Player.playList(list, i));
    return t;
  }
  function grid(items, { emptyMsg = "Không có video." } = {}) {
    if (!items.length) return el("div", { class: "state" }, [el("p", { text: emptyMsg })]);
    return el("div", { class: "grid" }, items.map((v, i) => card(v, items, i)));
  }
  function moreButton(fn) {
    const b = el("button", { class: "btn", type: "button", text: "Tải thêm", style: "margin:var(--gap) auto;display:flex" });
    b.onclick = async () => { b.disabled = true; b.textContent = "Đang tải…"; try { await fn(); b.remove(); } catch (e) { showError(e); } };
    return b;
  }
  function showError(e) {
    if (e?.reason !== "login_required" && e?.reason !== "no_credentials") console.error(e);
    if (e?.reason === "login_required" || e?.reason === "no_credentials") {
      stateMsg("Bạn cần đăng nhập Google để xem nội dung này.",
        [el("button", { class: "btn primary", type: "button", text: "Đăng nhập Google", onclick: doSignIn })]);
    } else if (e?.reason === "quotaExceeded") {
      stateMsg("Hết hạn mức API YouTube trong ngày. Hãy thử lại sau hoặc dùng dự án Google Cloud khác.");
    } else {
      stateMsg("Lỗi: " + (e?.message || e), [el("button", { class: "btn", type: "button", text: "Thử lại", onclick: () => navigate(currentView, true) })]);
    }
  }

  /* ---------- Điều hướng ---------- */
  function navigate(name, force = false) {
    if (name === currentView && !force) { view.scrollTo({ top: 0, behavior: "smooth" }); return; }
    currentView = name; app.dataset.view = name;
    view.scrollTop = 0;
    ({ home: renderHome, subs: renderSubs, search: renderSearch, library: renderLibrary, settings: renderSettings }[name] || renderHome)();
  }
  $$(".rail-btn[data-nav]").forEach(b => b.addEventListener("click", () => { Player.collapse(); navigate(b.dataset.nav); }));

  /* ---------- Thịnh hành ---------- */
  let trendingCat = "";
  async function renderHome() {
    const s = Util.loadSettings();
    const REGIONS = [["VN", "Việt Nam"], ["US", "Hoa Kỳ"], ["GB", "Anh"], ["JP", "Nhật Bản"], ["KR", "Hàn Quốc"], ["TH", "Thái Lan"], ["IN", "Ấn Độ"], ["DE", "Đức"], ["FR", "Pháp"], ["BR", "Brazil"], ["AU", "Úc"], ["CA", "Canada"]];
    const regionName = (REGIONS.find(r => r[0] === s.region) || [s.region, s.region])[1];
    const regionBtn = el("button", { class: "chip", type: "button", "aria-label": "Quốc gia", text: "Vùng: " + regionName, onclick: () =>
      Player.openSheet("Quốc gia / khu vực", REGIONS.map(([v, t]) => ({ label: t, active: v === s.region, onclick: () => { Util.saveSettings({ region: v }); Api.clearCache(); renderHome(); } })))
    });
    setChrome("Xu hướng", [regionBtn]);
    loading();
    try {
      // Chip thể loại (một số thể loại không hỗ trợ mostPopular -> bỏ qua khi lỗi)
      const cats = [{ id: "", title: "Tất cả" }, { id: "10", title: "Âm nhạc" }, { id: "20", title: "Trò chơi" }, { id: "17", title: "Thể thao" }, { id: "24", title: "Giải trí" }, { id: "25", title: "Tin tức" }, { id: "28", title: "Khoa học & CN" }, { id: "1", title: "Phim & hoạt hình" }];
      chips.replaceChildren(...cats.map(c => el("button", { class: "chip" + (c.id === trendingCat ? " active" : ""), type: "button", text: c.title, onclick: () => { trendingCat = c.id; renderHome(); } })));
      chips.hidden = false;

      const demo = Demo.active();
      let page = demo ? Demo.trending() : await Api.trending({ categoryId: trendingCat });
      const items = page.items;
      const g = grid(items);
      view.replaceChildren(g);
      const addMore = () => { if (page.next) view.append(moreButton(async () => {
        page = await Api.trending({ categoryId: trendingCat, pageToken: page.next });
        const start = items.length; items.push(...page.items);
        page.items.forEach((v, i) => g.append(card(v, items, start + i)));
        addMore();
      })); };
      addMore();
    } catch (e) {
      if (e?.status === 400 && trendingCat) { toast("Thể loại này không có bảng thịnh hành"); trendingCat = ""; return renderHome(); }
      showError(e);
    }
  }

  /* ---------- Kênh đăng ký ---------- */
  let subsFilter = "";
  async function renderSubs() {
    setChrome("Kênh đăng ký", [el("button", { class: "chip", type: "button", text: "Làm mới", onclick: () => { subsCache = null; Api.clearCache(); renderSubs(); } })]);
    if (!Auth.getToken()) return showError({ reason: "login_required" });
    loading();
    try {
      if (!subsCache) subsCache = await Api.subscriptionFeed();
      const { subs, items } = subsCache;
      const row = el("div", { class: "row-list" }, [
        el("button", { class: "avatar-btn" + (subsFilter ? "" : " active"), type: "button", onclick: () => { subsFilter = ""; renderSubs(); } },
          [el("img", { src: "assets/icon.svg", alt: "" }), el("span", { text: "Tất cả" })]),
        ...subs.map(sub => el("button", { class: "avatar-btn" + (subsFilter === sub.channelId ? " active" : ""), type: "button", onclick: () => { subsFilter = sub.channelId; renderSubs(); } },
          [el("img", { src: sub.avatar, alt: "", loading: "lazy" }), el("span", { text: sub.title })]))
      ]);
      let list = items;
      if (subsFilter) {
        const ch = subs.find(s => s.channelId === subsFilter);
        setChrome(ch ? ch.title : "Kênh đăng ký", [el("button", { class: "chip", type: "button", text: "Tất cả kênh", onclick: () => { subsFilter = ""; renderSubs(); } })]);
        list = items.filter(v => v.channelId === subsFilter);
        if (list.length < 8) {
          // Lấy đầy đủ hơn cho kênh được chọn
          const d = await Api.get("channels", { part: "contentDetails", id: subsFilter });
          const pl = d.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
          if (pl) list = (await Api.playlistItems(pl, { max: 30 })).items;
        }
      }
      view.replaceChildren(row, el("div", { class: "section-title", text: "Mới nhất" }), grid(list, { emptyMsg: "Chưa có video nào từ kênh đăng ký." }));
    } catch (e) { showError(e); }
  }

  /* ---------- Tìm kiếm ---------- */
  const HISTORY_KEY = "cartube.history";
  const getHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch (_) { return []; } };
  const pushHistory = (q) => { const h = [q, ...getHistory().filter(x => x !== q)].slice(0, 12); localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); };

  function renderSearch() {
    setChrome("Tìm kiếm");
    const input = el("input", { type: "search", placeholder: "Tìm video, kênh, bài hát…", value: searchQuery, autocomplete: "off", enterkeyhint: "search" });
    const micBtn = el("button", { class: "ctl", type: "button", "aria-label": "Tìm bằng giọng nói", html: '<svg viewBox="0 0 24 24"><path d="M12 15a4 4 0 0 0 4-4V5a4 4 0 0 0-8 0v6a4 4 0 0 0 4 4zm6-4h2a8 8 0 0 1-7 7.9V22h-2v-3.1A8 8 0 0 1 4 11h2a6 6 0 0 0 12 0z"/></svg>' });
    const goBtn = el("button", { class: "ctl", type: "button", "aria-label": "Tìm", html: '<svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm7.3 11.9 4.4 4.4-1.4 1.4-4.4-4.4z"/></svg>' });
    const results = el("div");
    const bar = el("div", { class: "search-bar" }, [input, micBtn, goBtn]);
    view.replaceChildren(bar, results);

    const run = async (q) => {
      q = (q || "").trim(); if (!q) return;
      searchQuery = q; input.value = q; pushHistory(q);
      results.replaceChildren(el("div", { class: "state" }, [el("div", { class: "spinner" })]));
      try {
        const demo = Demo.active();
        let page = demo ? Demo.search(q) : await Api.search(q);
        const items = page.items;
        const g = grid(items, { emptyMsg: "Không tìm thấy kết quả." });
        results.replaceChildren(g);
        const addMore = () => { if (page.next) results.append(moreButton(async () => {
          page = await Api.search(q, { pageToken: page.next });
          const start = items.length; items.push(...page.items);
          page.items.forEach((v, i) => g.append(card(v, items, start + i)));
          addMore();
        })); };
        addMore();
      } catch (e) { results.replaceChildren(); showError(e); view.prepend(bar); }
    };
    goBtn.onclick = () => run(input.value);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { input.blur(); run(input.value); } });

    // Lịch sử tìm kiếm dạng nút lớn
    const showHistory = () => {
      const h = getHistory();
      results.replaceChildren(el("div", { class: "section-title", text: h.length ? "Tìm gần đây" : "Nhập từ khoá hoặc bấm micro để nói" }),
        el("div", { class: "suggest" }, h.map(q => el("button", { class: "chip", type: "button", text: q, onclick: () => run(q) }))));
    };
    if (searchQuery) run(searchQuery); else showHistory();

    // Giọng nói (Web Speech API)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) micBtn.hidden = true;
    else micBtn.onclick = () => {
      const rec = new SR();
      rec.lang = Util.loadSettings().speechLang; rec.interimResults = false; rec.maxAlternatives = 1;
      micBtn.classList.add("listening"); input.placeholder = "Đang nghe…";
      rec.onresult = (e) => run(e.results[0][0].transcript);
      rec.onerror = (e) => toast("Không nhận được giọng nói: " + e.error);
      rec.onend = () => { micBtn.classList.remove("listening"); input.placeholder = "Tìm video, kênh, bài hát…"; };
      rec.start();
    };
    if (!searchQuery) setTimeout(() => input.focus({ preventScroll: true }), 50);
  }

  /* ---------- Thư viện ---------- */
  async function renderLibrary() {
    setChrome("Thư viện");
    if (!Auth.getToken()) return showError({ reason: "login_required" });
    loading();
    try {
      const [liked, pls] = await Promise.all([Api.likedVideos(), Api.myPlaylists()]);
      const plRow = el("div", { class: "row-list" }, pls.map(p => el("button", { class: "avatar-btn", type: "button", onclick: () => openPlaylist(p) },
        [el("img", { src: p.thumb, alt: "", style: "border-radius:12px" }), el("span", { text: p.title })])));
      view.replaceChildren(
        el("div", { class: "section-title", text: "Danh sách phát của tôi" }),
        pls.length ? plRow : el("p", { class: "muted", text: "Chưa có danh sách phát." }),
        el("div", { class: "section-title", text: "Video đã thích" }),
        grid(liked.items, { emptyMsg: "Chưa có video đã thích." })
      );
    } catch (e) { showError(e); }
  }
  async function openPlaylist(p) {
    setChrome(p.title, [el("button", { class: "chip", type: "button", text: "← Thư viện", onclick: renderLibrary })]);
    loading();
    try {
      const page = await Api.playlistItems(p.id, { max: 50 });
      view.replaceChildren(
        el("div", { class: "btn-row", style: "margin-bottom:var(--gap)" }, [
          el("button", { class: "btn primary", type: "button", text: "▶ Phát tất cả", onclick: () => Player.playList(page.items, 0) }),
          el("button", { class: "btn", type: "button", text: "🔀 Trộn", onclick: () => Player.playList(page.items.slice().sort(() => Math.random() - .5), 0) })
        ]),
        grid(page.items)
      );
    } catch (e) { showError(e); }
  }

  /* ---------- Cài đặt ---------- */
  function renderSettings() {
    setChrome("Cài đặt");
    const s = Util.loadSettings();
    const st = Auth.getState();
    const field = (label, node, help) => el("div", { class: "field" }, [el("label", { text: label }), node, help ? el("small", { text: help }) : null]);
    const seg = (key, opts, after) => {
      const wrap = el("div", { class: "seg" });
      opts.forEach(([v, t]) => wrap.append(el("button", { type: "button", class: s[key] === v ? "active" : "", text: t, onclick: () => { Util.saveSettings({ [key]: v }); after?.(v); renderSettings(); } })));
      return wrap;
    };

    const account = el("div", { class: "btn-row" }, st.signedIn
      ? [el("span", { class: "btn", text: "Đã đăng nhập: " + (st.profile?.name || "Google") }), el("button", { class: "btn danger", type: "button", text: "Đăng xuất", onclick: () => { Auth.signOut(); subsCache = null; renderSettings(); } })]
      : [el("button", { class: "btn primary", type: "button", text: "Đăng nhập Google", onclick: doSignIn })]);

    view.replaceChildren(el("div", { class: "settings" }, [
      field("Tài khoản", account, "Đăng nhập để xem kênh đăng ký, video đã thích và playlist của bạn."),
      field("Cỡ giao diện", seg("uiScale", [["normal", "Thường"], ["large", "Lớn"], ["xlarge", "Rất lớn"]], applyScale)),
      field("Tự phát video tiếp theo", seg("autoplayNext", [[true, "Bật"], [false, "Tắt"]])),
      field("Ngôn ngữ giọng nói", seg("speechLang", [["vi-VN", "Tiếng Việt"], ["en-US", "English"], ["ja-JP", "日本語"], ["ko-KR", "한국어"]])),
      field("Phụ đề mặc định", seg("captions", [[true, "Bật"], [false, "Tắt"]]), "Có thể đổi nhanh bằng nút CC trong trình phát."),
      field("Ngôn ngữ phụ đề ưu tiên", seg("captionLang", [["vi", "Tiếng Việt"], ["en", "English"], ["ja", "日本語"], ["ko", "한국어"]])),
      field("Chất lượng video ưu tiên", seg("quality", [["auto", "Tự động"], ["hd1440", "1440p"], ["hd1080", "1080p"], ["hd720", "720p"], ["large", "480p"], ["medium", "360p"]], () => Player.applyRenderScale()),
        "Khung video được render ở đúng kích thước này (ví dụ 1920×1080) rồi thu/phóng cho vừa màn hình để YouTube ưu tiên chọn độ phân giải tương ứng. YouTube vẫn có thể hạ xuống nếu mạng yếu."),
      field("Khung ảo ép chất lượng", seg("virtualFrame", [[true, "Bật"], [false, "Tắt"]], () => Player.applyRenderScale()),
        "Cách app ép độ phân giải. Nếu trên thiết bị nào video bị lệch/cắt mép khi toàn màn hình, hãy tắt."),
      field("Trình phát", seg("playerMode", [["custom", "Nút lớn (tuỳ biến)"], ["native", "YouTube gốc"]], () => { Util.toast("Đang tải lại…"); setTimeout(() => location.reload(), 400); }),
        "YouTube gốc dùng bộ điều khiển của YouTube (có bánh răng chỉnh chất lượng, phụ đề) nhưng nút nhỏ hơn."),
      field("Phiên bản", el("div", { class: "btn-row" }, [
        el("span", { class: "btn", text: "Bản " + (window.CARTUBE_BUILD.startsWith("__") ? "cục bộ" : window.CARTUBE_BUILD) }),
        el("button", { class: "btn primary", type: "button", text: "Tải lại bản mới", onclick: async () => { const updated = await checkForUpdate(false); if (!updated) setTimeout(hardReload, 600); } })
      ]), "Nếu giao diện không cập nhật sau khi có thay đổi, bấm nút này để bỏ qua cache của trình duyệt."),
      el("small", { class: "muted", text: "Ứng dụng chạy hoàn toàn trên trình duyệt, chỉ xin quyền đọc YouTube; token chỉ lưu trong phiên hiện tại." })
    ]));
  }
  function applyScale(v) { document.documentElement.dataset.scale = v || Util.loadSettings().uiScale; }

  /* ---------- Tài khoản ---------- */
  async function doSignIn() {
    const s = Util.loadSettings();
    if (!s.clientId) { toast("Thiếu Client ID trong js/config.js"); return; }
    try {
      await Auth.signIn({ interactive: true });
      toast("Đăng nhập thành công");
      Api.clearCache(); subsCache = null;
      navigate(currentView === "settings" ? "subs" : currentView, true);
    } catch (e) {
      console.warn("Đăng nhập thất bại:", e.message);
      const code = e.message || "";
      if (code === "no_client") { toast("Chưa tải được thư viện Google, thử lại sau"); return; }
      if (code === "access_denied") { toast("Bạn đã từ chối cấp quyền"); return; }
      // Popup bị đóng / bị chặn (hay gặp trên mobile, trình duyệt ô tô): chuyển sang đăng nhập kiểu chuyển hướng
      if (/popup|closed|blocked|open/i.test(code)) {
        toast("Cửa sổ đăng nhập bị đóng, đang chuyển sang trang đăng nhập Google…", 2000);
        setTimeout(Auth.redirectSignIn, 900);
        return;
      }
      toast("Đăng nhập thất bại: " + code, 4000);
    }
  }
  // Kết quả khi quay về từ trang đăng nhập Google (kiểu chuyển hướng)
  if (Auth.redirectResult === "ok") { toast("Đăng nhập thành công"); }
  else if (Auth.redirectResult && Auth.redirectResult.startsWith("error:")) {
    const c = Auth.redirectResult.slice(6);
    toast(c === "access_denied" ? "Bạn đã từ chối cấp quyền" : c === "redirect_uri_mismatch" ? "Chưa thêm redirect URI " + Auth.redirectUri() + " trong Google Console" : "Đăng nhập thất bại: " + c, 5000);
  }
  $("#btn-account").addEventListener("click", () => { Player.collapse(); Auth.getState().signedIn ? navigate("settings") : doSignIn(); });
  Auth.onChange((st) => {
    const av = $("#account-avatar"), ic = $("#account-icon"), lb = $("#account-label");
    if (st.signedIn && st.profile?.avatar) { av.src = st.profile.avatar; av.hidden = false; ic.hidden = true; lb.textContent = st.profile.name.split(" ")[0]; }
    else { av.hidden = true; ic.hidden = false; lb.textContent = st.signedIn ? "Tài khoản" : "Đăng nhập"; }
  });

  /* ---------- Kiểm tra bản mới (chống cache trên mobile) ---------- */
  function hardReload() {
    // Tải lại kèm tham số ngẫu nhiên để trình duyệt bỏ qua cache của index.html
    const u = new URL(location.href); u.searchParams.set("r", Date.now().toString(36)); u.hash = "";
    location.replace(u.toString());
  }
  async function checkForUpdate(silent = true) {
    const build = window.CARTUBE_BUILD;
    if (!build || build.startsWith("__")) { if (!silent) toast("Bản chạy cục bộ, không có thông tin phiên bản"); return false; }
    try {
      const res = await fetch("version.txt?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) return false;
      const latest = (await res.text()).trim();
      if (latest && latest !== build) {
        // Chốt an toàn: nếu vừa tải lại vì lý do này trong 2 phút mà vẫn cũ thì không lặp nữa
        let last = 0; try { last = +sessionStorage.getItem("cartube.updReload") || 0; } catch (_) {}
        if (Date.now() - last < 120_000) { if (!silent) toast("Máy chủ vẫn trả bản cũ, thử lại sau ít phút"); return false; }
        try { sessionStorage.setItem("cartube.updReload", String(Date.now())); } catch (_) {}
        toast("Có bản mới (" + latest + "), đang tải lại…", 2500);
        setTimeout(hardReload, 1200);
        return true;
      }
      if (!silent) toast("Bạn đang dùng bản mới nhất (" + build + ")");
    } catch (_) { if (!silent) toast("Không kiểm tra được phiên bản"); }
    return false;
  }
  window.addEventListener("load", () => setTimeout(() => checkForUpdate(true), 1500));
  // Quay lại tab / mở lại app sau khi để nền: kiểm tra lại
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(true); });

  /* ---------- Khởi động ---------- */
  applyScale();
  // Thử làm mới token ngầm nếu có Client ID (không hiện popup)
  window.addEventListener("load", () => {
    const s = Util.loadSettings();
    if (s.clientId && !Auth.getToken() && localStorage.getItem("cartube.wasSignedIn") === "1") {
      setTimeout(() => Auth.signIn({ interactive: false }).then(() => { Api.clearCache(); navigate(currentView, true); }).catch(() => {}), 800);
    }
  });
  // Đổi hướng/tỉ lệ màn hình: vẽ lại để lưới cập nhật
  matchMedia("(orientation: portrait)").addEventListener?.("change", () => { if (!Player.isExpanded()) navigate(currentView, true); });
  navigate("home");

  window.App = { navigate };
})();
