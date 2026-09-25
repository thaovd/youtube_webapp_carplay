/* =====================================================================
   Trình phát: bọc YouTube IFrame Player API + hàng đợi + điều khiển lớn
   ===================================================================== */
window.Player = (function () {
  const { $, el, fmtTime, toast } = Util;
  let yt = null;                 // YT.Player
  let apiReady = false;
  let queue = [];                // danh sách video (đã chuẩn hoá)
  let index = -1;
  let ticker = null;
  let seeking = false;
  let pendingLoad = null;        // video muốn phát trước khi API sẵn sàng
  let expanded = false;

  const ui = {};
  function bindUi() {
    Object.assign(ui, {
      root: $("#player"), stage: $("#player-stage"), err: $("#player-error"), errLink: $("#player-error-link"),
      title: $("#player-title"), channel: $("#player-channel"), seek: $("#seek"), cur: $("#time-cur"), dur: $("#time-dur"),
      play: $("#btn-play"), prev: $("#btn-prev"), next: $("#btn-next"), rew: $("#btn-rew"), fwd: $("#btn-fwd"),
      mute: $("#btn-mute"), fs: $("#btn-fullscreen"), close: $("#btn-close-player"), qToggle: $("#btn-queue-toggle"),
      queueList: $("#queue-list"),
      mini: $("#minibar"), miniThumb: $("#mini-thumb"), miniTitle: $("#mini-title"), miniChannel: $("#mini-channel"),
      miniPlay: $("#mini-play"), miniNext: $("#mini-next"), miniExpand: $("#mini-expand")
    });

    ui.play.onclick = toggle;   ui.miniPlay.onclick = toggle;
    ui.next.onclick = next;     ui.miniNext.onclick = next;   $("#player-error-next").onclick = next;
    ui.prev.onclick = prev;
    ui.rew.onclick = () => seekBy(-10);
    ui.fwd.onclick = () => seekBy(10);
    ui.mute.onclick = toggleMute;
    ui.fs.onclick = toggleFullscreen;
    ui.close.onclick = collapse;
    ui.miniExpand.onclick = expand;
    ui.qToggle.onclick = () => {
      // Màn 21:9 và màn dọc: hàng đợi mặc định hiện (dùng lớp hide-queue); còn lại mặc định ẩn (show-queue)
      const shownByDefault = matchMedia("(min-aspect-ratio: 2/1)").matches || matchMedia("(orientation: portrait)").matches;
      ui.root.classList.toggle(shownByDefault ? "hide-queue" : "show-queue");
    };
    ui.seek.addEventListener("input", () => { seeking = true; updateSeekStyle(); ui.cur.textContent = fmtTime(seekTarget()); });
    ui.seek.addEventListener("change", () => { seeking = false; if (yt?.seekTo) yt.seekTo(seekTarget(), true); });

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
        case "Escape": if (expanded) collapse(); break;
      }
    });
    if ("mediaSession" in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler("play", () => yt?.playVideo());
      ms.setActionHandler("pause", () => yt?.pauseVideo());
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
    apiReady = true;
    yt = new YT.Player("yt-player", {
      width: "100%", height: "100%",
      playerVars: {
        controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
        origin: location.origin, hl: Util.loadSettings().lang
      },
      events: { onReady, onStateChange, onError }
    });
  };

  function onReady() {
    if (pendingLoad) { const p = pendingLoad; pendingLoad = null; loadIndex(p); }
  }
  function onStateChange(e) {
    const S = YT.PlayerState;
    const playing = e.data === S.PLAYING;
    ui.play.classList.toggle("is-playing", playing);
    ui.miniPlay.classList.toggle("is-playing", playing);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    if (playing) { ui.dur.textContent = fmtTime(yt.getDuration()); startTicker(); } else stopTicker();
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
    if (!apiReady || !yt?.loadVideoById) { pendingLoad = i; return; }
    index = i;
    const v = queue[i];
    ui.err.hidden = true;
    ui.seek.value = 0; updateSeekStyle(); ui.cur.textContent = "0:00"; ui.dur.textContent = fmtTime(v.duration);
    ui.title.textContent = v.title; ui.channel.textContent = v.channel;
    ui.miniTitle.textContent = v.title; ui.miniChannel.textContent = v.channel; ui.miniThumb.src = v.thumb;
    ui.mini.hidden = false;
    yt.loadVideoById(v.id);
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: v.title, artist: v.channel, artwork: [{ src: v.thumb }] });
    renderQueue();
    document.dispatchEvent(new CustomEvent("player:track", { detail: v }));
  }
  function next() { if (index + 1 < queue.length) loadIndex(index + 1); else toast("Đã hết danh sách"); }
  function prev() {
    if (yt?.getCurrentTime && yt.getCurrentTime() > 5) { yt.seekTo(0, true); return; }
    if (index > 0) loadIndex(index - 1);
  }
  function toggle() {
    if (!yt?.getPlayerState) return;
    yt.getPlayerState() === YT.PlayerState.PLAYING ? yt.pauseVideo() : yt.playVideo();
  }
  function seekBy(d) {
    if (!yt?.getCurrentTime) return;
    yt.seekTo(Math.max(0, Math.min(yt.getDuration() || Infinity, yt.getCurrentTime() + d)), true);
  }
  function toggleMute() {
    if (!yt?.isMuted) return;
    const m = !yt.isMuted();
    m ? yt.mute() : yt.unMute();
    ui.mute.classList.toggle("is-muted", m);
  }
  function toggleFullscreen() {
    const docEl = document.documentElement;
    if (!document.fullscreenElement) (docEl.requestFullscreen || docEl.webkitRequestFullscreen)?.call(docEl);
    else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
  }
  function expand() { expanded = true; ui.root.hidden = false; document.body.classList.add("player-open"); }
  function collapse() { expanded = false; ui.root.hidden = true; document.body.classList.remove("player-open"); }
  function isExpanded() { return expanded; }

  function renderQueue() {
    ui.queueList.replaceChildren(...queue.map((v, i) => {
      const b = el("button", { class: "q-item" + (i === index ? " active" : ""), type: "button", onclick: () => loadIndex(i) }, [
        el("img", { src: v.thumb, alt: "", loading: "lazy" }),
        el("div", { class: "q-text" }, [
          el("div", { class: "q-title", text: v.title }),
          el("div", { class: "muted ellipsis", text: v.channel + (v.duration ? " · " + fmtTime(v.duration) : "") })
        ])
      ]);
      return b;
    }));
    const active = ui.queueList.querySelector(".active");
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  document.addEventListener("DOMContentLoaded", bindUi);
  return { playList, next, prev, toggle, expand, collapse, isExpanded, getQueue: () => queue, getIndex: () => index };
})();
