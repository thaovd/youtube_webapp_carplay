/* =====================================================================
   Trình phát: giao diện điều khiển lớn + hàng đợi, chạy trên Stream.HtmlPlayer (js/stream.js)
   ===================================================================== */
window.Player = (function () {
  const { $, el, fmtTime, toast } = Util;
  const S = Stream.STATE;
  let yt = null;                 // HtmlPlayer (giữ tên biến cũ cho gọn)
  let queue = [];                // danh sách video (đã chuẩn hoá)
  let index = -1;
  let ticker = null;
  let seeking = false;
  let pendingLoad = null;        // video muốn phát trước khi trình phát sẵn sàng
  let expanded = false;
  let prefsApplied = false;      // đã áp dụng phụ đề/chất lượng cho video hiện tại chưa
  let lastStall = 0;             // thời điểm khựng/tải đệm gần nhất
  let lastPlayStart = 0, wasPlaying = false;   // mốc bắt đầu/tiếp tục phát gần nhất

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
    $("#cover-replay").onclick = () => { if (yt) { yt.seekTo(0); yt.playVideo(); } };
    $("#cover-next").onclick = next;
    ui.quality.onclick = openQualitySheet;
    $("#sheet-close").onclick = closeSheet;
    ui.sheet.querySelector(".sheet-backdrop").onclick = closeSheet;
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
    ui.seek.addEventListener("change", () => { seeking = false; if (yt) yt.seekTo(seekTarget()); });

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
      if (Util.loadSettings().mediaKeys !== false) {
        ms.setActionHandler("play", () => { Util.log("mediaSession play"); yt?.playVideo(); });
        ms.setActionHandler("pause", () => {
          // CarPlay/APTV gửi một lệnh pause "giả" khoảng 3-4 giây sau mỗi lần bắt đầu phát (thấy trong nhật ký thiết bị),
          // và đầu xe cũng hay gửi pause để "đồng bộ" ngay sau khi khựng mạng -> bỏ qua các lệnh trong hai cửa sổ đó.
          const sincePlay = Date.now() - lastPlayStart, sinceStall = Date.now() - lastStall;
          if (sincePlay < 6000) { Util.log("mediaSession pause (bỏ qua: mới phát " + (sincePlay / 1000).toFixed(1) + "s)"); return; }
          if (sinceStall < 3000) { Util.log("mediaSession pause (bỏ qua: vừa khựng " + (sinceStall / 1000).toFixed(1) + "s trước)"); return; }
          Util.log("mediaSession pause"); yt?.pauseVideo();
        });
      } else {
        // Ghi đè xử lý mặc định để hệ thống không tự dừng video
        ms.setActionHandler("play", () => Util.log("mediaSession play (bỏ qua)"));
        ms.setActionHandler("pause", () => Util.log("mediaSession pause (bỏ qua)"));
      }
      ms.setActionHandler("nexttrack", next);
      ms.setActionHandler("previoustrack", prev);
      ms.setActionHandler("seekbackward", () => seekBy(-10));
      ms.setActionHandler("seekforward", () => seekBy(10));
    }

    // Tạo trình phát theo nguồn phát đã chọn
    if (Util.playerSource() === "embed") {
      yt = new Embed.EmbedPlayer("yt-player", { events: { onReady, onStateChange, onError } });
      ui.root.classList.add("embed");
      Util.log("player: embed");
    } else {
      yt = new Stream.HtmlPlayer("yt-player", { events: { onReady, onStateChange, onError } });
      ui.root.classList.add("stream");
    }
  }

  function seekTarget() { return (ui.seek.value / 1000) * (yt?.getDuration?.() || 0); }
  function updateSeekStyle() { ui.seek.style.setProperty("--pct", (ui.seek.value / 10) + "%"); }

  function onReady() {
    if (pendingLoad !== null) { const p = pendingLoad; pendingLoad = null; loadIndex(p); }
  }
  /* Màn che của app khi tạm dừng / kết thúc / chưa phát */
  function setCover(state) {
    const ended = state === S.ENDED;
    // Embed chờ người dùng bấm play của YouTube: nhường chỗ (không màn che, không lớp bắt cử chỉ) tới khi phát
    const waiting = !!(yt?.isEmbed && yt.waitUser && (state === S.UNSTARTED || state === S.CUED));
    ui.root.classList.toggle("embed-wait", waiting);
    const show = !waiting && (state === S.PAUSED || ended || state === S.CUED || state === S.UNSTARTED);
    ui.cover.hidden = !show;
    ui.coverActions.hidden = !ended;
    ui.cover.querySelector(".cover-play").toggleAttribute("hidden", ended);
    ui.root.classList.toggle("ended", ended);
  }
  function onStateChange(e) {
    const playing = e.data === S.PLAYING;
    Util.log("state", { "-1": "UNSTARTED", "0": "ENDED", "1": "PLAYING", "2": "PAUSED", "3": "BUFFERING", "5": "CUED" }[e.data] || e.data);
    setCover(e.data);
    // Đang tải đệm: giữ biểu tượng "đang phát" + vòng xoay, tránh trông như bị tạm dừng
    const buffering = e.data === S.BUFFERING;
    ui.root.classList.toggle("buffering", buffering);
    ui.play.classList.toggle("is-playing", playing || buffering);
    ui.miniPlay.classList.toggle("is-playing", playing || buffering);
    // Báo cho hệ thống: đang tải đệm vẫn là "playing" (nếu báo "paused", CarPlay/đầu xe sẽ gửi lệnh pause để đồng bộ -> dừng thật)
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = (playing || buffering) ? "playing" : "paused";
    if (buffering) lastStall = Date.now();
    if (playing && !wasPlaying) lastPlayStart = Date.now();
    wasPlaying = playing || buffering;
    if (playing) { retryCount = 0; ui.dur.textContent = fmtTime(yt.getDuration()); startTicker(); if (!prefsApplied) { prefsApplied = true; setTimeout(applyPrefs, 600); } } else stopTicker();
    if (e.data === S.ENDED) { if (Util.loadSettings().autoplayNext) next(); }
  }
  let retryCount = 0, retryTimer = null;
  function onError(e) {
    Util.log("player error", e?.data, e?.message || "");
    const v = queue[index];
    // Nguồn Stream: link luồng có thể vừa hết hạn hoặc IP nhà vừa đổi (link ký theo IP) -> nạp lại video tối đa 2 lần
    if (!yt?.isEmbed && v && retryCount < 2) {
      retryCount++;
      const at = yt?.getCurrentTime?.() || 0;
      toast("Luồng bị ngắt, đang thử lại (" + retryCount + "/2)…", 3000);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { if (queue[index] === v) { yt.loadVideoById(v.id); if (at > 5) setTimeout(() => yt.seekTo(at), 1500); } }, 4000);
      return;
    }
    ui.err.hidden = false;
    ui.err.querySelector("p").textContent = (yt?.isEmbed ? "Không phát được video này" : "Máy chủ stream không phát được video này") + (e?.message ? ": " + e.message : "");
    ui.errLink.href = v ? "https://www.youtube.com/watch?v=" + v.id : "https://www.youtube.com";
    if (Util.loadSettings().autoplayNext && [100, 101, 150].includes(e?.data)) {
      toast("Video không phát được, chuyển video tiếp theo…");
      setTimeout(() => { if (!ui.err.hidden) next(); }, 2500);
    }
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      if (!yt || seeking) return;
      const cur = yt.getCurrentTime(), dur = yt.getDuration() || 0;
      ui.cur.textContent = fmtTime(cur);
      if (dur) { ui.seek.value = Math.round((cur / dur) * 1000); updateSeekStyle(); }
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
    ui.err.hidden = true;
    ui.seek.value = 0; updateSeekStyle(); ui.cur.textContent = "0:00"; ui.dur.textContent = fmtTime(v.duration);
    ui.title.textContent = v.title; ui.channel.textContent = v.channel;
    ui.miniTitle.textContent = v.title; ui.miniChannel.textContent = v.channel; ui.miniThumb.src = v.thumb;
    ui.coverImg.src = v.thumb;
    ui.cover.hidden = !!(yt?.isEmbed && yt.waitUser); ui.coverActions.hidden = true; ui.cover.querySelector(".cover-play").toggleAttribute("hidden", true); ui.root.classList.remove("ended");
    ui.mini.hidden = false;
    index = i;
    renderQueue();
    if (!yt) { pendingLoad = i; return; }
    prefsApplied = false; retryCount = 0; clearTimeout(retryTimer);
    yt.loadVideoById(v.id);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: v.title, artist: v.channel, artwork: [{ src: v.thumb }] });
    document.dispatchEvent(new CustomEvent("player:track", { detail: v }));
  }
  function next() { if (index + 1 < queue.length) loadIndex(index + 1); else toast("Đã hết danh sách"); }
  function prev() {
    if (yt && yt.getCurrentTime() > 5) { yt.seekTo(0); return; }
    if (index > 0) loadIndex(index - 1);
  }
  function toggle() {
    Util.log("ui toggle");
    if (!yt) return;
    yt.getPlayerState() === S.PLAYING ? yt.pauseVideo() : yt.playVideo();
  }
  function seekBy(d) {
    if (!yt) return;
    yt.seekTo(Math.max(0, Math.min(yt.getDuration() || Infinity, yt.getCurrentTime() + d)));
  }
  function toggleMute() {
    if (!yt) return;
    const m = !yt.isMuted();
    m ? yt.mute() : yt.unMute();
    ui.mute.classList.toggle("is-muted", m);
  }

  /* ---- Phụ đề & chất lượng ---- */
  const QUALITY_LABEL = { auto: "Tự động", highres: "4K+", hd2160: "2160p (4K)", hd1440: "1440p", hd1080: "1080p", hd720: "720p", large: "480p", medium: "360p", small: "240p", tiny: "144p", default: "Tự động" };
  function ccTracks() { try { return yt.getOption("captions", "tracklist") || []; } catch (_) { return []; } }
  function ccCurrent() { try { const t = yt.getOption("captions", "track"); return t && t.languageCode ? t : null; } catch (_) { return null; } }
  function setCaptions(track) {           // track = null để tắt
    if (!yt) return;
    yt.setOption("captions", "track", track ? { languageCode: track.languageCode, kind: track.kind } : {});
    ui.cc.classList.toggle("on", !!ccCurrent());
  }
  function applyPrefs() {
    const s = Util.loadSettings();
    if (!yt) return;
    if (s.captions) {
      const tracks = ccTracks();
      const pick = tracks.find(t => t.languageCode === s.captionLang && t.kind !== "asr") || tracks.find(t => t.languageCode === s.captionLang) || tracks[0];
      setCaptions(pick || null);
    } else setCaptions(null);
    if (s.quality && s.quality !== "auto") requestQuality(s.quality, true);
  }
  function requestQuality(q, silent) {
    if (!yt) return;
    if (!silent) Util.saveSettings({ quality: q });
    yt.setPlaybackQuality(q === "auto" ? "default" : q);
    if (!silent) toast(yt?.isEmbed ? "Đã yêu cầu " + (QUALITY_LABEL[q] || q) + " (YouTube có thể tự điều chỉnh)" : "Chất lượng: " + (QUALITY_LABEL[q] || q));
  }

  /* Bảng chọn dùng chung */
  function openSheet(title, items) {      // items: [{label, active, onclick}]
    ui.sheetTitle.textContent = title;
    ui.sheetList.replaceChildren(...items.map(it => el("button", { class: "btn" + (it.active ? " active" : ""), type: "button", text: it.label, onclick: () => { closeSheet(); it.onclick(); } })));
    ui.sheet.hidden = false;
  }
  function closeSheet() { ui.sheet.hidden = true; }
  function openCaptionSheet() {
    if (!yt) return;
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
    if (!yt) return;
    const levels = yt.getAvailableQualityLevels() || [];
    const cur = yt.getPlaybackQuality() || "auto";
    const items = [{ label: "Tự động", active: false, onclick: () => requestQuality("auto") }];
    for (const q of levels) items.push({ label: QUALITY_LABEL[q] || q, active: q === cur, onclick: () => requestQuality(q) });
    openSheet("Chất lượng video (đang phát: " + (QUALITY_LABEL[cur] || cur) + ")", items);
  }

  /* Hiệu ứng "−10s / +10s"; chạm liên tiếp cộng dồn số giây hiển thị */
  let hintTimer = null, hintSum = 0, hintSide = "";
  function showSeekHint(side) {
    const h = $("#seek-hint");
    if (side !== hintSide) hintSum = 0;
    hintSide = side; hintSum += 10;
    h.className = side + " show";
    h.querySelector("span").textContent = (side === "left" ? "−" : "+") + hintSum + "s";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { h.classList.remove("show"); hintSum = 0; hintSide = ""; }, 650);
  }

  /* ---- Toàn màn hình chỉ vùng video ---- */
  function isVideoFull() { return ui.root.classList.contains("video-full"); }
  function nativeFull() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  /* iOS/iPadOS (kể cả WebView trong CarPlay): Fullscreen API đưa phần tử lên cửa sổ của điện thoại, kích thước khác màn xe
     -> chỉ dùng CSS phủ toàn màn hình, không gọi requestFullscreen */
  let cssOnlyFull = false;
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  function enterVideoFull() {
    if (isVideoFull()) return;
    ui.root.classList.add("video-full"); ui.fs.classList.add("is-full");
    if (!IS_IOS && Util.loadSettings().nativeFullscreen !== false) {
      const st = ui.stage, req = st.requestFullscreen || st.webkitRequestFullscreen;
      if (req) { try { const p = req.call(st, { navigationUI: "hide" }); p?.catch?.(() => {}); } catch (_) {} }
      setTimeout(() => {
        if (nativeFull() !== ui.stage) return;
        const r = ui.stage.getBoundingClientRect();
        const ok = Math.abs(r.width - window.innerWidth) < 4 && Math.abs(r.height - window.innerHeight) < 4 && Math.abs(r.left) < 2 && Math.abs(r.top) < 2;
        if (!ok) { cssOnlyFull = true; try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); } catch (_) {} }
      }, 350);
    }
    toast("Chạm 2 lần hoặc vuốt xuống để thoát toàn màn hình", 2200);
  }
  function exitVideoFull() {
    if (!isVideoFull()) return;
    ui.root.classList.remove("video-full"); ui.fs.classList.remove("is-full");
    if (nativeFull() === ui.stage) { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}); } catch (_) {} }
  }
  function toggleFullscreen() { isVideoFull() ? exitVideoFull() : enterVideoFull(); }
  for (const evName of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(evName, () => {
      if (!nativeFull() && isVideoFull() && !cssOnlyFull) { ui.root.classList.remove("video-full"); ui.fs.classList.remove("is-full"); }
      cssOnlyFull = false;
    });
  }

  /* ---- Cử chỉ: chạm 2 lần trái/phải = tua ±10s, giữa = toàn màn hình; vuốt xuống = thoát toàn màn hình / thu nhỏ ---- */
  function onSwipeDown() { if (isVideoFull()) exitVideoFull(); else collapse(); }
  function bindGestures() {
    let start = null, lastTap = 0, tapTimer = null;
    const SWIPE = 70, TAP = 15, DOUBLE_MS = 320;
    ui.main.addEventListener("pointerdown", (e) => {
      if (e.target.closest("input,button,a")) { start = null; return; }
      start = { x: e.clientX, y: e.clientY, t: Date.now(), onVideo: e.target === ui.gesture };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    });
    ui.main.addEventListener("pointercancel", () => { start = null; });
    ui.main.addEventListener("pointerup", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y, dt = Date.now() - start.t, onVideo = start.onVideo;
      start = null;
      const vertical = Math.abs(dy) > Math.abs(dx) * 1.5;
      if (dt < 800 && vertical && dy > SWIPE) { Util.log("gesture swipe down"); onSwipeDown(); return; }
      if (dt < 800 && vertical && dy < -SWIPE && onVideo) { enterVideoFull(); return; }
      if (onVideo && Math.hypot(dx, dy) < TAP) {
        const now = Date.now();
        if (now - lastTap < DOUBLE_MS) {
          clearTimeout(tapTimer); lastTap = 0;
          const gr = ui.gesture.getBoundingClientRect();
          const fx = (e.clientX - gr.left) / gr.width;
          if (fx < 1 / 3) { seekBy(-10); showSeekHint("left"); }
          else if (fx > 2 / 3) { seekBy(10); showSeekHint("right"); }
          else toggleFullscreen();
        }
        else { lastTap = now; tapTimer = setTimeout(() => { Util.log("gesture single tap"); toggle(); }, DOUBLE_MS); }
      }
    });
    ui.gesture.addEventListener("dblclick", (e) => e.preventDefault());
  }

  function expand() { expanded = true; ui.root.classList.add("open"); document.body.classList.add("player-open"); }
  function collapse() { exitVideoFull(); expanded = false; ui.root.classList.remove("open"); document.body.classList.remove("player-open"); }
  function isExpanded() { return expanded; }

  function renderQueue() {
    ui.queueList.replaceChildren(...queue.map((v, i) => {
      return el("button", { class: "q-item" + (i === index ? " active" : ""), type: "button", onclick: () => loadIndex(i) }, [
        el("img", { src: v.thumb, alt: "", loading: "lazy" }),
        el("div", { class: "q-text" }, [
          el("div", { class: "q-title", text: v.title }),
          el("div", { class: "q-sub muted ellipsis", text: v.channel + (v.duration ? " · " + fmtTime(v.duration) : "") })
        ])
      ]);
    }));
    const active = ui.queueList.querySelector(".active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("DOMContentLoaded", () => { bindUi(); bindGestures(); });
  return { playList, next, prev, toggle, expand, collapse, isExpanded, getQueue: () => queue, getIndex: () => index, setCaptions, requestQuality, openSheet };
})();
