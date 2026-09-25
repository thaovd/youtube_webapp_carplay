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
      stateMsg(e.reason === "login_required" ? "Bạn cần đăng nhập để xem nội dung này." : "Chưa cấu hình. Vào Cài đặt để nhập Client ID (và API key nếu muốn xem không cần đăng nhập).",
        [el("button", { class: "btn primary", type: "button", text: e.reason === "login_required" ? "Đăng nhập Google" : "Mở Cài đặt", onclick: () => e.reason === "login_required" ? doSignIn() : navigate("settings") })]);
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
    const regionSel = el("select", { class: "chip", "aria-label": "Quốc gia", onchange: (e) => { Util.saveSettings({ region: e.target.value }); Api.clearCache(); renderHome(); } },
      [["VN", "🇻🇳 VN"], ["US", "🇺🇸 US"], ["GB", "🇬🇧 UK"], ["JP", "🇯🇵 JP"], ["KR", "🇰🇷 KR"], ["TH", "🇹🇭 TH"], ["IN", "🇮🇳 IN"], ["DE", "🇩🇪 DE"], ["FR", "🇫🇷 FR"], ["BR", "🇧🇷 BR"]]
        .map(([v, t]) => el("option", { value: v, text: t, selected: v === s.region })));
    setChrome("Xu hướng", [regionSel]);
    loading();
    try {
      // Chip thể loại (một số thể loại không hỗ trợ mostPopular -> bỏ qua khi lỗi)
      const cats = [{ id: "", title: "Tất cả" }, { id: "10", title: "Âm nhạc" }, { id: "20", title: "Trò chơi" }, { id: "17", title: "Thể thao" }, { id: "24", title: "Giải trí" }, { id: "25", title: "Tin tức" }, { id: "28", title: "Khoa học & CN" }, { id: "1", title: "Phim & hoạt hình" }];
      chips.replaceChildren(...cats.map(c => el("button", { class: "chip" + (c.id === trendingCat ? " active" : ""), type: "button", text: c.title, onclick: () => { trendingCat = c.id; renderHome(); } })));
      chips.hidden = false;

      let page = await Api.trending({ categoryId: trendingCat });
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
        let page = await Api.search(q);
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
    const clientId = el("input", { type: "text", value: s.clientId, placeholder: "xxxxx.apps.googleusercontent.com", spellcheck: "false" });
    const apiKey = el("input", { type: "text", value: s.apiKey, placeholder: "AIza…", spellcheck: "false" });
    const saveBtn = el("button", { class: "btn primary", type: "button", text: "Lưu thông tin API", onclick: () => {
      Util.saveSettings({ clientId: clientId.value.trim(), apiKey: apiKey.value.trim() });
      Api.clearCache(); Auth.reconfigure(); toast("Đã lưu"); renderSettings();
    } });

    const account = el("div", { class: "btn-row" }, st.signedIn
      ? [el("span", { class: "btn", text: "Đã đăng nhập: " + (st.profile?.name || "Google") }), el("button", { class: "btn danger", type: "button", text: "Đăng xuất", onclick: () => { Auth.signOut(); subsCache = null; renderSettings(); } })]
      : [el("button", { class: "btn primary", type: "button", text: "Đăng nhập Google", onclick: doSignIn })]);

    view.replaceChildren(el("div", { class: "settings" }, [
      field("Tài khoản", account, "Đăng nhập để xem kênh đăng ký, video đã thích và playlist của bạn."),
      field("Cỡ giao diện", seg("uiScale", [["normal", "Thường"], ["large", "Lớn"], ["xlarge", "Rất lớn"]], applyScale)),
      field("Tự phát video tiếp theo", seg("autoplayNext", [[true, "Bật"], [false, "Tắt"]])),
      field("Ngôn ngữ giọng nói", seg("speechLang", [["vi-VN", "Tiếng Việt"], ["en-US", "English"], ["ja-JP", "日本語"], ["ko-KR", "한국어"]])),
      field("Google OAuth Client ID", clientId, "Bắt buộc để đăng nhập. Tạo tại Google Cloud Console → APIs & Services → Credentials."),
      field("YouTube API key (tuỳ chọn)", apiKey, "Cho phép xem Thịnh hành / Tìm kiếm mà không cần đăng nhập."),
      saveBtn,
      el("div", { class: "help" }, [
        el("b", { text: "Hướng dẫn nhanh lấy Client ID" }),
        el("ol", {}, [
          el("li", { html: "Vào <code>console.cloud.google.com</code>, tạo project, bật <b>YouTube Data API v3</b>." }),
          el("li", { html: "OAuth consent screen: chọn External, thêm scope <code>youtube.readonly</code>, thêm email của bạn vào Test users." }),
          el("li", { html: "Credentials → Create → OAuth client ID → Web application. Thêm <b>Authorized JavaScript origins</b>: <code>" + location.origin + "</code>." }),
          el("li", { text: "Dán Client ID vào ô trên và bấm Lưu, sau đó Đăng nhập Google." })
        ]),
        el("small", { class: "muted", text: "Ứng dụng chạy hoàn toàn trên trình duyệt; token chỉ lưu trong phiên hiện tại." })
      ])
    ]));
  }
  function applyScale(v) { document.documentElement.dataset.scale = v || Util.loadSettings().uiScale; }

  /* ---------- Tài khoản ---------- */
  async function doSignIn() {
    const s = Util.loadSettings();
    if (!s.clientId) { toast("Hãy nhập Client ID trong Cài đặt trước"); navigate("settings"); return; }
    try {
      await Auth.signIn({ interactive: true });
      toast("Đăng nhập thành công");
      Api.clearCache(); subsCache = null;
      navigate(currentView === "settings" ? "subs" : currentView, true);
    } catch (e) {
      if (e.message === "no_client") toast("Chưa tải được thư viện Google, thử lại sau");
      else toast("Đăng nhập thất bại: " + e.message);
    }
  }
  $("#btn-account").addEventListener("click", () => { Player.collapse(); Auth.getState().signedIn ? navigate("settings") : doSignIn(); });
  Auth.onChange((st) => {
    const av = $("#account-avatar"), ic = $("#account-icon"), lb = $("#account-label");
    if (st.signedIn && st.profile?.avatar) { av.src = st.profile.avatar; av.hidden = false; ic.hidden = true; lb.textContent = st.profile.name.split(" ")[0]; }
    else { av.hidden = true; ic.hidden = false; lb.textContent = st.signedIn ? "Tài khoản" : "Đăng nhập"; }
  });

  /* ---------- Khởi động ---------- */
  applyScale();
  // Thử làm mới token ngầm nếu có Client ID (không hiện popup)
  window.addEventListener("load", () => {
    const s = Util.loadSettings();
    if (s.clientId && !Auth.getToken()) {
      setTimeout(() => Auth.signIn({ interactive: false }).then(() => { Api.clearCache(); navigate(currentView, true); }).catch(() => {}), 800);
    }
  });
  // Đổi hướng/tỉ lệ màn hình: vẽ lại để lưới cập nhật
  matchMedia("(orientation: portrait)").addEventListener?.("change", () => { if (!Player.isExpanded()) navigate(currentView, true); });
  navigate("home");

  window.App = { navigate };
})();
