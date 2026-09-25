/* =====================================================================
   Trình phát: bọc YouTube IFrame Player API + hàng đợi + điều khiển lớn
   ===================================================================== */
window.Player = (function () {
  const { $, el, fmtTime, toast } = Util;
  let yt = null;                 // YT.Player (hình; trong chế độ bù trễ thì tắt tiếng)
  let ya = null;                 // YT.Player thứ hai chỉ phát tiếng (chế độ bù trễ), null nếu tắt
  let dual = false;              // đang dùng 2 trình phát để bù trễ tiếng
  let avOffset = 0;              // giây: dương = tiếng chậm hơn hình, âm = tiếng sớm hơn
  let lastSync = 0;              // thời điểm lần chỉnh đồng bộ gần nhất
  let apiReady = false;
  let queue = [];                // danh sách video (đã chuẩn hoá)
  let index = -1;
  let ticker = null;
  let seeking = false;
  let pendingLoad = null;        // video muốn phát trước khi API sẵn sàng
  let expanded = false;
  let prefsApplied = false;      // đã áp dụng phụ đề/chất lượng cho video hiện tại chưa
  let fallback = false;          // true khi IFrame API không tải được -> dùng iframe nhúng thường
  let fallbackTimer = null;

  /* Nếu script IFrame API không tải được (bị chặn, offline...) sau vài giây thì chuyển sang iframe thường */
  function armFallback() {
    if (apiReady || fallback || fallbackTimer) return;
    fallbackTimer = setTimeout(() => { if (!apiReady) enableFallback(); }, 4000);
  }
  function enableFallback() {
    fallback = true;
    ui.root.classList.add("fallback");
    toast("Không tải được trình phát tuỳ biến, dùng trình phát YouTube mặc định");
    if (pendingLoad !== null) { const p = pendingLoad; pendingLoad = null; loadIndex(p); }
  }
  function fallbackLoad(v) {
    const holder = $("#yt-player");
    const st = Util.loadSettings();
    const src = "https://www.youtube.com/embed/" + encodeURIComponent(v.id) + "?autoplay=1&playsinline=1&rel=0&controls=1&hl=" + encodeURIComponent(st.lang)
      + "&cc_lang_pref=" + encodeURIComponent(st.captionLang) + "&cc_load_policy=" + (st.captions ? 1 : 0);
    holder.replaceChildren(el("iframe", { src, allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true, title: v.title, style: "border:0;width:100%;height:100%" }));
  }

  const ui = {};
  function bindUi() {
    Object.assign(ui, {
      root: $("#player"), stage: $("#player-stage"), err: $("#player-error"), errLink: $("#player-error-link"),
      title: $("#player-title"), channel: $("#player-channel"), seek: $("#seek"), cur: $("#time-cur"), dur: $("#time-dur"),
      play: $("#btn-play"), prev: $("#btn-prev"), next: $("#btn-next"), rew: $("#btn-rew"), fwd: $("#btn-fwd"),
      mute: $("#btn-mute"), fs: $("#btn-fullscreen"), close: $("#btn-close-player"), qToggle: $("#btn-queue-toggle"),
      queueList: $("#queue-list"), gesture: $("#gesture-layer"), main: $("#player-main"),
      cc: $("#btn-cc"), quality: $("#btn-quality"),
      cover: $("#pause-cover"), coverImg: $("#cover-img"), coverActions: $("#cover-actions"), sheet: $("#sheet"), sheetTitle: $("#sheet-title"), sheetList: $("#sheet-list"),
      mini: $("#minibar"), miniThumb: $("#mini-thumb"), miniTitle: $("#mini-title"), miniChannel: $("#mini-channel"),
      miniPlay: $("#mini-play"), miniNext: $("#mini-next"), miniExpand: $("#mini-expand")
    });

    ui.play.onclick = toggle;   ui.miniPlay.onclick = toggle;
    ui.next.onclick = next;     ui.miniNext.onclick = next;   $("#player-error-next").onclick = next;
    ui.prev.onclick = prev;
    ui.rew.onclick = () => seekBy(-10);
    ui.fwd.onclick = () => seekBy(10);
    ui.mute.onclick = toggleMute;
    ui.cc.onclick = openCaptionSheet;
    $("#cover-replay").onclick = () => { if (yt?.seekTo) { seekBoth(0); yt.playVideo(); if (dual) ya?.playVideo?.(); } };
    $("#cover-next").onclick = next;
    ui.quality.onclick = openQualitySheet;
    $("#sheet-close").onclick = closeSheet;
    ui.sheet.querySelector(".sheet-backdrop").onclick = closeSheet;
    // Chế độ "trình phát YouTube gốc": dùng thẳng iframe thường (có menu phụ đề/chất lượng của YouTube)
    if (Util.loadSettings().playerMode === "native") { fallback = true; ui.root.classList.add("fallback"); }
    ui.fs.onclick = toggleFullscreen;
    ui.close.onclick = collapse;
    ui.miniExpand.onclick = expand;
    // Bấm bất kỳ chỗ nào trên minibar (trừ các nút điều khiển) đều mở trình phát
    ui.mini.addEventListener("click", (e) => { if (!e.target.closest(".ctl")) expand(); });
    ui.qToggle.onclick = () => {
      // Màn 21:9 và màn dọc: hàng đợi mặc định hiện (dùng lớp hide-queue); còn lại mặc định ẩn (show-queue)
      const shownByDefault = matchMedia("(min-aspect-ratio: 2/1)").matches || matchMedia("(orientation: portrait)").matches;
      ui.root.classList.toggle(shownByDefault ? "hide-queue" : "show-queue");
    };
    ui.seek.addEventListener("input", () => { seeking = true; updateSeekStyle(); ui.cur.textContent = fmtTime(seekTarget()); });
    ui.seek.addEventListener("change", () => { seeking = false; if (yt?.seekTo) seekBoth(seekTarget()); });

    // Phím tắt (nút vô lăng / bàn phím media thường map sang các phím này)
    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input,textarea,select")) return;
      switch (e.key) {
        case " ": case "k": case "MediaPlayPause": e.preventDefault(); toggle(); break;
        case "ArrowRight": case "l": seekBy(10); break;
        case "ArrowLeft": case "j": seekBy(-10); break;
        case "MediaTrackNext": case "N": next(); break;
        case "MediaTrackPrevious": case "P": prev(); break;
        case "m": toggleMute(); break;
        case "f": toggleFullscreen(); break;
        case "c": openCaptionSheet(); break;
        case "Escape": if (expanded) collapse(); break;
      }
    });
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => { yt?.playVideo(); if (dual) ya?.playVideo?.(); });
      ms.setActionHandler("pause", () => { yt?.pauseVideo(); if (dual) ya?.pauseVideo?.(); });
      ms.setActionHandler("nexttrack", next);
      ms.setActionHandler("previoustrack", prev);
      ms.setActionHandler("seekbackward", () => seekBy(-10));
      ms.setActionHandler("seekforward", () => seekBy(10));
    }
  }

  function seekTarget() { return (ui.seek.value / 1000) * (yt?.getDuration?.() || 0); }
  function updateSeekStyle() { ui.seek.style.setProperty("--pct", (ui.seek.value / 10) + "%"); }

  /* Được gọi bởi IFrame API khi tải xong */
  window.onYouTubeIframeAPIReady = function () {
    if (fallback) return;
    apiReady = true;
    clearTimeout(fallbackTimer);
    const s = Util.loadSettings();
    avOffset = (+s.avOffsetMs || 0) / 1000;
    dual = avOffset !== 0;
    const base = { controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, origin: location.origin, hl: s.lang };
    yt = new YT.Player("yt-player", {
      width: "100%", height: "100%",
      playerVars: Object.assign({}, base, { cc_lang_pref: s.captionLang, cc_load_policy: s.captions ? 1 : 0, mute: dual ? 1 : 0 }),
      events: { onReady, onStateChange, onError }
    });
    if (dual) {
      // Trình phát tiếng: khung 160×90 khuất sau hình (YouTube chọn 144p), không phụ đề
      ya = new YT.Player("yt-audio", {
        width: "160", height: "90",
        playerVars: Object.assign({}, base, { cc_load_policy: 0 }),
        events: { onReady: () => { audioReady = true; if (pendingLoad !== null) onReady(); }, onStateChange: onAudioState }
      });
    }
  };
  let audioReady = false;
  function bothReady() { return !!yt?.loadVideoById && (!dual || (audioReady && !!ya?.loadVideoById)); }

  /* ---- Đồng bộ trình phát tiếng theo hình: tiếng = hình − offset ----
     Thời gian do IFrame API báo về chỉ cập nhật ~4 lần/giây nên hai trình phát luôn "lệch giả" vài trăm ms.
     Vì vậy: chỉ ép tua ở các mốc rõ ràng (bắt đầu phát, sau khi tua, sau khi dừng), còn lúc đang phát thì
     gom nhiều mẫu, lấy trung vị, và chỉ chỉnh khi lệch thật > 300 ms, cách nhau tối thiểu 3 giây. */
  let driftSamples = [];
  let videoBufferingSince = 0;
  function forceSync() {
    if (!dual || !ya?.seekTo || !yt?.getCurrentTime) return;
    ya.seekTo(Math.max(0, yt.getCurrentTime() - avOffset), true);
    lastSync = Date.now(); driftSamples = [];
  }
  /* Hai trình phát trên cùng thiết bị chạy cùng tốc độ nên gần như không trôi. Chỉ can thiệp khi lệch THẬT
     (một bên bị khựng/tải lại): trung vị của 20 mẫu (~10 giây) vượt 1 giây, và cách lần trước ≥ 10 giây. */
  function sampleDrift() {
    if (!dual || !ya?.getCurrentTime || !yt?.getCurrentTime) return;
    if (ya.getPlayerState?.() !== YT.PlayerState.PLAYING || yt.getPlayerState?.() !== YT.PlayerState.PLAYING) { driftSamples = []; return; }
    const now = Date.now();
    if (now - lastSync < 10000) return;
    driftSamples.push(ya.getCurrentTime() - (yt.getCurrentTime() - avOffset));
    if (driftSamples.length < 20) return;
    const sorted = driftSamples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    driftSamples = [];
    if (Math.abs(median) > 1.0) { ya.seekTo(Math.max(0, ya.getCurrentTime() - median), true); lastSync = now; }
  }
  function onAudioState(e) {
    const S = YT.PlayerState;
    // Không tua ở đây (tránh vòng lặp tua -> buffering -> playing -> tua); chỉ giữ trạng thái dừng khớp với hình
    if (e.data === S.PLAYING && yt?.getPlayerState?.() !== S.PLAYING) ya.pauseVideo();
  }

  function onReady() {
    applyRenderScale();
    if (!bothReady()) return;
    if (pendingLoad !== null) { const p = pendingLoad; pendingLoad = null; loadIndex(p); }
  }
  /* Hiện màn che của app khi YouTube đang ở trạng thái có giao diện riêng (tạm dừng, kết thúc, chưa phát) */
  function setCover(state) {
    const S = YT.PlayerState;
    const ended = state === S.ENDED;
    const show = !fallback && (state === S.PAUSED || ended || state === S.CUED || state === S.UNSTARTED);
    ui.cover.hidden = !show;
    ui.coverActions.hidden = !ended;
    ui.cover.querySelector(".cover-play").toggleAttribute("hidden", ended);
    ui.root.classList.toggle("ended", ended);
  }
  function onStateChange(e) {
    const S = YT.PlayerState;
    const playing = e.data === S.PLAYING;
    setCover(e.data);
    ui.play.classList.toggle("is-playing", playing);
    ui.miniPlay.classList.toggle("is-playing", playing);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (playing) { ui.dur.textContent = fmtTime(yt.getDuration()); startTicker(); if (!prefsApplied) { prefsApplied = true; setTimeout(applyPrefs, 600); } } else stopTicker();
    if (dual && ya?.playVideo) {
      if (playing) {
        // Tải đệm ngắn (< 1,5 s) của hình: không đụng vào tiếng để tránh khựng; dài hơn thì canh lại một lần
        const shortRebuffer = videoBufferingSince && Date.now() - videoBufferingSince < 1500 && ya.getPlayerState?.() === S.PLAYING;
        videoBufferingSince = 0;
        if (!shortRebuffer) { forceSync(); ya.playVideo(); }
      } else if (e.data === S.BUFFERING) {
        videoBufferingSince = Date.now();
        setTimeout(() => { if (videoBufferingSince && yt.getPlayerState?.() === S.BUFFERING) ya.pauseVideo(); }, 1500);
      } else if (e.data === S.PAUSED || e.data === S.ENDED) { videoBufferingSince = 0; ya.pauseVideo(); }
    }
    if (e.data === S.ENDED) { if (Util.loadSettings().autoplayNext) next(); }
  }
  function onError(e) {
    // 101/150: chủ sở hữu không cho phép nhúng; 100: video bị xoá/riêng tư; 2/5: lỗi tham số/HTML5
    const v = queue[index];
    ui.err.hidden = false;
    ui.errLink.href = v ? "https://www.youtube.com/watch?v=" + v.id : "https://www.youtube.com";
    if (Util.loadSettings().autoplayNext && [100, 101, 150].includes(e.data)) {
      toast("Video không phát được, chuyển video tiếp theo…");
      setTimeout(() => { if (!ui.err.hidden) next(); }, 2500);
    }
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (!yt?.getCurrentTime || seeking) return;
      const cur = yt.getCurrentTime(), dur = yt.getDuration() || 0;
      ui.cur.textContent = fmtTime(cur);
      if (dur) { ui.seek.value = Math.round((cur / dur) * 1000); updateSeekStyle(); }
      sampleDrift();
    }, 500);
  }
  function stopTicker() { clearInterval(ticker); ticker = null; }

  /* ---- API công khai ---- */
  function playList(list, startIndex = 0) {
    queue = list.slice();
    index = -1;
    renderQueue();
    expand();
    loadIndex(startIndex);
  }
  function loadIndex(i) {
    if (i < 0 || i >= queue.length) return;
    const v = queue[i];
    // Cập nhật thông tin hiển thị ngay, kể cả khi API chưa sẵn sàng
    ui.err.hidden = true;
    ui.seek.value = 0; updateSeekStyle(); ui.cur.textContent = "0:00"; ui.dur.textContent = fmtTime(v.duration);
    ui.title.textContent = v.title; ui.channel.textContent = v.channel;
    ui.miniTitle.textContent = v.title; ui.miniChannel.textContent = v.channel; ui.miniThumb.src = v.thumb;
    ui.coverImg.src = v.thumb;
    if (!fallback) { ui.cover.hidden = false; ui.coverActions.hidden = true; ui.cover.querySelector(".cover-play").toggleAttribute("hidden", true); ui.root.classList.remove("ended"); }
    ui.mini.hidden = false;
    index = i;
    renderQueue();
    if (!fallback && (!apiReady || !bothReady())) { pendingLoad = i; armFallback(); return; }
    prefsApplied = false;
    if (fallback) fallbackLoad(v);
    else {
      yt.loadVideoById(v.id);
      if (dual) { ya.loadVideoById(v.id); lastSync = 0; }   // tải cùng lúc trong cùng cử chỉ để không bị chặn tự phát
    }
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: v.title, artist: v.channel, artwork: [{ src: v.thumb }] });
    renderQueue();
    document.dispatchEvent(new CustomEvent("player:track", { detail: v }));
  }
  function next() { if (index + 1 < queue.length) loadIndex(index + 1); else toast("Đã hết danh sách"); }
  function seekBoth(t) {
    yt.seekTo(t, true);
    if (dual && ya?.seekTo) { ya.seekTo(Math.max(0, t - avOffset), true); lastSync = Date.now(); }
  }
  function prev() {
    if (yt?.getCurrentTime && yt.getCurrentTime() > 5) { seekBoth(0); return; }
    if (index > 0) loadIndex(index - 1);
  }
  function toggle() {
    if (!yt?.getPlayerState) return;
    if (yt.getPlayerState() === YT.PlayerState.PLAYING) { yt.pauseVideo(); if (dual) ya?.pauseVideo?.(); }
    else { yt.playVideo(); if (dual) ya?.playVideo?.(); }
  }
  function seekBy(d) {
    if (!yt?.getCurrentTime) return;
    seekBoth(Math.max(0, Math.min(yt.getDuration() || Infinity, yt.getCurrentTime() + d)));
  }
  function toggleMute() {
    const p = dual ? ya : yt;          // chế độ bù trễ: tiếng nằm ở trình phát thứ hai
    if (!p?.isMuted) return;
    const m = !p.isMuted();
    m ? p.mute() : p.unMute();
    ui.mute.classList.toggle("is-muted", m);
  }
  /* Đổi mức bù trễ khi đang phát (ms). Bật/tắt hoàn toàn (0 <-> khác 0) cần tải lại trang để tạo/huỷ trình phát thứ hai */
  function setAvOffset(ms) {
    const wasDual = dual, nextDual = ms !== 0;
    Util.saveSettings({ avOffsetMs: ms });
    if (wasDual === nextDual) { avOffset = ms / 1000; if (dual) forceSync(); return false; }
    return true;   // cần reload
  }
  /* ---- Ép độ phân giải gián tiếp: render iframe ở kích thước ảo rồi scale bằng CSS ----
     YouTube chọn chất lượng theo kích thước khung player (viewport bên trong iframe không bị ảnh hưởng bởi transform
     của trang cha), nên khung 1920×1080 thu nhỏ vẫn được YouTube coi là player 1080p. */
  let virtualBroken = false;   // trình duyệt vẽ sai khung ảo -> tắt tự động
  let lastExpect = null, checkPending = false;
  const VIRTUAL = { hd2160: [3840, 2160], hd1440: [2560, 1440], hd1080: [1920, 1080], hd720: [1280, 720], large: [854, 480], medium: [640, 360], small: [426, 240] };
  function applyRenderScale() {
    const frame = document.getElementById("yt-player");
    if (!frame || !ui.stage) return;
    const s = Util.loadSettings();
    const v = (fallback || s.virtualFrame === false) ? null : VIRTUAL[s.quality];
    // Kích thước thật của vùng video; khi toàn màn hình lấy theo viewport (tránh giá trị cũ lúc đang chuyển trạng thái)
    const r = ui.stage.getBoundingClientRect();
    let sw = r.width, sh = r.height;
    if (isVideoFull()) { const vv = window.visualViewport; sw = vv ? vv.width : window.innerWidth; sh = vv ? vv.height : window.innerHeight; }
    if (!v || !sw || !sh) { frame.style.cssText = ""; return; }
    const [W, H] = v;
    const sc = Math.min(sw / W, sh / H);
    const w = W * sc, h = H * sc;
    if (virtualBroken) { frame.style.cssText = ""; return; }
    const left = Math.round((sw - w) / 2), top = Math.round((sh - h) / 2);
    frame.style.cssText = "border:0;position:absolute;left:" + left + "px;top:" + top + "px;right:auto;bottom:auto;width:" + W + "px;height:" + H + "px;max-width:none;max-height:none;transform:scale(" + sc + ");transform-origin:0 0;";
    // Tự kiểm tra (so với LẦN ÁP DỤNG MỚI NHẤT, vì hàm này được gọi dồn nhiều lần khi bố cục đổi):
    // nếu trình duyệt vẽ khung không đúng vị trí/kích thước dự kiến (một số WebView) -> bỏ khung ảo trong phiên này
    lastExpect = { w, h, left, top, sw, sh };
    if (!checkPending) {
      checkPending = true;
      setTimeout(() => {
        checkPending = false;
        const ex = lastExpect; if (!ex || virtualBroken) return;
        const fr = frame.getBoundingClientRect(), sr = ui.stage.getBoundingClientRect();
        if (Math.abs(sr.width - ex.sw) > 2 || Math.abs(sr.height - ex.sh) > 2) return;   // bố cục lại đổi tiếp, bỏ qua lần đo này
        const bad = Math.abs(fr.width - ex.w) > 6 || Math.abs(fr.height - ex.h) > 6 || Math.abs((fr.left - sr.left) - ex.left) > 6 || Math.abs((fr.top - sr.top) - ex.top) > 6;
        if (bad) { virtualBroken = true; console.warn("Khung ảo hiển thị sai, tắt trong phiên này", fr, ex); frame.style.cssText = ""; }
      }, 250);
    }
  }
  /* Tính lại vài lần sau khi bố cục đổi (animation, fullscreen, xoay màn) */
  function rescaleSoon() {
    applyRenderScale();
    requestAnimationFrame(applyRenderScale);
    [120, 400, 800].forEach(ms => setTimeout(applyRenderScale, ms));
  }

  /* ---- Phụ đề & chất lượng (YouTube IFrame API) ---- */
  const QUALITY_LABEL = { auto: "Tự động", highres: "4K+", hd2160: "2160p (4K)", hd1440: "1440p", hd1080: "1080p", hd720: "720p", large: "480p", medium: "360p", small: "240p", tiny: "144p", default: "Tự động" };
  function ccTracks() { try { return yt.getOption("captions", "tracklist") || []; } catch (_) { return []; } }
  function ccCurrent() { try { const t = yt.getOption("captions", "track"); return t && t.languageCode ? t : null; } catch (_) { return null; } }
  function ccOn() { return !!ccCurrent(); }
  function setCaptions(track) {           // track = null để tắt
    if (!yt?.setOption) return;
    try {
      if (track) { yt.loadModule("captions"); yt.setOption("captions", "track", { languageCode: track.languageCode, kind: track.kind }); }
      else yt.setOption("captions", "track", {});
    } catch (_) {}
    setTimeout(() => ui.cc.classList.toggle("on", ccOn()), 300);
  }
  function applyPrefs() {
    const s = Util.loadSettings();
    if (fallback || !yt?.setOption) return;
    try { yt.loadModule("captions"); } catch (_) {}   // tải danh sách phụ đề để nút CC có dữ liệu
    setTimeout(() => {
      if (s.captions) {
        const tracks = ccTracks();
        const pick = tracks.find(t => t.languageCode === s.captionLang && t.kind !== "asr") || tracks.find(t => t.languageCode === s.captionLang) || tracks[0];
        if (pick) setCaptions(pick); else setCaptions(null);
      } else setCaptions(null);
      if (s.quality && s.quality !== "auto") requestQuality(s.quality, true);
    }, 400);
  }
  function requestQuality(q, silent) {
    if (!yt) return;
    if (!silent) { Util.saveSettings({ quality: q }); applyRenderScale(); }
    try {
      if (q === "auto") { yt.setPlaybackQualityRange?.("tiny", "highres"); yt.setPlaybackQuality?.("default"); }
      else { yt.setPlaybackQualityRange?.(q, q); yt.setPlaybackQuality?.(q); }
    } catch (_) {}
    if (!silent) {
      toast("Đã yêu cầu " + (QUALITY_LABEL[q] || q) + ". YouTube có thể tự điều chỉnh theo mạng.");
      setTimeout(() => { try { const cur = yt.getPlaybackQuality(); if (cur && cur !== "unknown") toast("Đang phát: " + (QUALITY_LABEL[cur] || cur)); } catch (_) {} }, 3000);
    }
  }

  /* Bảng chọn dùng chung */
  function openSheet(title, items) {      // items: [{label, active, onclick}]
    ui.sheetTitle.textContent = title;
    ui.sheetList.replaceChildren(...items.map(it => el("button", { class: "btn" + (it.active ? " active" : ""), type: "button", text: it.label, onclick: () => { closeSheet(); it.onclick(); } })));
    ui.sheet.hidden = false;
  }
  function closeSheet() { ui.sheet.hidden = true; }
  function openCaptionSheet() {
    if (fallback || !yt?.getOption) { toast("Dùng nút CC / bánh răng trong trình phát YouTube"); return; }
    try { yt.loadModule("captions"); } catch (_) {}
    const tracks = ccTracks(), cur = ccCurrent();
    if (!tracks.length) { toast("Video này không có phụ đề"); return; }
    const items = [{ label: "Tắt phụ đề", active: !cur, onclick: () => { setCaptions(null); toast("Đã tắt phụ đề"); } }];
    for (const t of tracks) {
      const base = t.displayName || t.languageName || t.languageCode;
      const name = base + (t.kind === "asr" && !/auto|tự động/i.test(base) ? " (tự động)" : "");
      items.push({ label: name, active: !!cur && cur.languageCode === t.languageCode && (cur.kind || "") === (t.kind || ""), onclick: () => { setCaptions(t); toast("Phụ đề: " + name); } });
    }
    openSheet("Phụ đề", items);
  }
  function openQualitySheet() {
    if (fallback || !yt?.getAvailableQualityLevels) { toast("Dùng bánh răng trong trình phát YouTube"); return; }
    let levels = [];
    try { levels = yt.getAvailableQualityLevels() || []; } catch (_) {}
    levels = levels.filter(q => q !== "auto" && q !== "default");
    let cur = "auto"; try { cur = yt.getPlaybackQuality() || "auto"; } catch (_) {}
    const items = [{ label: "Tự động", active: false, onclick: () => requestQuality("auto") }];
    for (const q of levels) items.push({ label: QUALITY_LABEL[q] || q, active: q === cur, onclick: () => requestQuality(q) });
    openSheet("Chất lượng video (đang phát: " + (QUALITY_LABEL[cur] || cur) + ")", items);
  }

  /* Hiệu ứng "−10s / +10s"; chạm liên tiếp cộng dồn số giây hiển thị */
  let hintTimer = null, hintSum = 0, hintSide = "";
  function showSeekHint(side) {
    const el = $("#seek-hint");
    if (side !== hintSide) hintSum = 0;
    hintSide = side; hintSum += 10;
    el.className = side + " show";
    el.querySelector("span").textContent = (side === "left" ? "−" : "+") + hintSum + "s";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { el.classList.remove("show"); hintSum = 0; hintSide = ""; }, 650);
  }

  /* ---- Toàn màn hình chỉ vùng video ---- */
  function isVideoFull() { return ui.root.classList.contains("video-full"); }
  function nativeFull() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  /* iOS/iPadOS (kể cả WebView trong CarPlay): Fullscreen API đưa phần tử lên cửa sổ của điện thoại, kích thước khác màn xe
     -> chỉ dùng CSS phủ toàn màn hình, không gọi requestFullscreen */
  let cssOnlyFull = false;   // true khi app tự huỷ fullscreen thật vì kích thước lệch
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function enterVideoFull() {
    if (isVideoFull()) return;
    ui.root.classList.add("video-full"); ui.fs.classList.add("is-full");
    if (!IS_IOS && Util.loadSettings().nativeFullscreen !== false) {
      // Thử fullscreen thật của trình duyệt cho riêng khung video; sau đó kiểm tra khung có phủ đúng viewport không
      const st = ui.stage, req = st.requestFullscreen || st.webkitRequestFullscreen;
      if (req) { try { const p = req.call(st, { navigationUI: "hide" }); p?.catch?.(() => {}); } catch (_) {} }
      setTimeout(() => {
        if (nativeFull() !== ui.stage) return;
        const r = ui.stage.getBoundingClientRect();
        const ok = Math.abs(r.width - window.innerWidth) < 4 && Math.abs(r.height - window.innerHeight) < 4 && Math.abs(r.left) < 2 && Math.abs(r.top) < 2;
        if (!ok) { cssOnlyFull = true; console.warn("Fullscreen API cho kích thước lệch, chuyển sang CSS", r); try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); } catch (_) {} }
      }, 350);
    }
    rescaleSoon();
    toast("Chạm 2 lần hoặc vuốt xuống để thoát toàn màn hình", 2200);
  }
  function exitVideoFull() {
    if (!isVideoFull()) return;
    ui.root.classList.remove("video-full"); ui.fs.classList.remove("is-full");
    if (nativeFull() === ui.stage) { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); } catch (_) {} }
    rescaleSoon();
  }
  function toggleFullscreen() { isVideoFull() ? exitVideoFull() : enterVideoFull(); }
  // Người dùng thoát fullscreen bằng phím Esc / nút hệ thống -> đồng bộ lại trạng thái
  for (const evName of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(evName, () => {
      // Người dùng thoát fullscreen thật (Esc) -> thoát luôn chế độ video-full; trừ khi chính app vừa huỷ fullscreen để dùng CSS
      if (!nativeFull() && isVideoFull() && !cssOnlyFull) { ui.root.classList.remove("video-full"); ui.fs.classList.remove("is-full"); }
      cssOnlyFull = false;
      rescaleSoon();
    });
  }

  /* ---- Cử chỉ: chạm 2 lần = toàn màn hình, vuốt xuống = thoát toàn màn hình / thu nhỏ trình phát ---- */
  function onSwipeDown() { if (isVideoFull()) exitVideoFull(); else collapse(); }
  function bindGestures() {
    let start = null, lastTap = 0, tapTimer = null;
    const SWIPE = 70, TAP = 15, DOUBLE_MS = 320;
    ui.main.addEventListener("pointerdown", (e) => {
      if (e.target.closest("input,button,a")) { start = null; return; }
      start = { x: e.clientX, y: e.clientY, t: Date.now(), onVideo: e.target === ui.gesture };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}   // nhận pointerup kể cả khi ngón tay rời khỏi vùng
    });
    ui.main.addEventListener("pointercancel", () => { start = null; });
    ui.main.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = Date.now() - start.t, onVideo = start.onVideo;
      start = null;
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
      if (dt < 800 && vertical && dy > SWIPE) { onSwipeDown(); return; }
      if (dt < 800 && vertical && dy < -SWIPE && onVideo) { enterVideoFull(); return; }   // vuốt lên trên video = toàn màn hình
      if (onVideo && Math.hypot(dx, dy) < TAP) {
        const now = Date.now();
        if (now - lastTap < DOUBLE_MS) {
          clearTimeout(tapTimer); lastTap = 0;
          // Chạm 2 lần: 1/3 trái = lùi 10s, 1/3 phải = tiến 10s, ở giữa = toàn màn hình
          const gr = ui.gesture.getBoundingClientRect();
          const fx = (e.clientX - gr.left) / gr.width;
          if (fx < 1 / 3) { seekBy(-10); showSeekHint("left"); }
          else if (fx > 2 / 3) { seekBy(10); showSeekHint("right"); }
          else toggleFullscreen();
        }
        else { lastTap = now; tapTimer = setTimeout(() => { if (!fallback) toggle(); }, DOUBLE_MS); }  // chạm 1 lần = phát/dừng
      }
    });
    ui.gesture.addEventListener("dblclick", (e) => e.preventDefault());
    if (window.ResizeObserver) new ResizeObserver(() => applyRenderScale()).observe(ui.stage);
    window.addEventListener("resize", rescaleSoon);
    window.addEventListener("orientationchange", rescaleSoon);
    window.visualViewport?.addEventListener("resize", rescaleSoon);
    ui.root.addEventListener("transitionend", (e) => { if (e.target === ui.root) rescaleSoon(); });
  }

  function expand() { expanded = true; ui.root.classList.add("open"); document.body.classList.add("player-open"); }
  function collapse() { exitVideoFull(); expanded = false; ui.root.classList.remove("open"); document.body.classList.remove("player-open"); }
  function isExpanded() { return expanded; }

  function renderQueue() {
    ui.queueList.replaceChildren(...queue.map((v, i) => {
      const b = el("button", { class: "q-item" + (i === index ? " active" : ""), type: "button", onclick: () => loadIndex(i) }, [
        el("img", { src: v.thumb, alt: "", loading: "lazy" }),
        el("div", { class: "q-text" }, [
          el("div", { class: "q-title", text: v.title }),
          el("div", { class: "q-sub muted ellipsis", text: v.channel + (v.duration ? " · " + fmtTime(v.duration) : "") })
        ])
      ]);
      return b;
    }));
    const active = ui.queueList.querySelector(".active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("DOMContentLoaded", () => { bindUi(); bindGestures(); });
  return { playList, next, prev, toggle, expand, collapse, isExpanded, getQueue: () => queue, getIndex: () => index, setCaptions, requestQuality, applyRenderScale, openSheet, setAvOffset, isDual: () => dual };
})();
