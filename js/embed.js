/* =====================================================================
   Nguồn phát EMBED: bọc YouTube IFrame Player API theo đúng giao diện của Stream.HtmlPlayer,
   để player.js dùng chung điều khiển/cử chỉ/hàng đợi. Cấu hình iframe chuẩn (không mẹo),
   phiên đăng nhập phụ thuộc cookie youtube.com của trình duyệt (cookie bên thứ ba).
   ===================================================================== */
window.Embed = (function () {
  const { toast } = Util;
  let apiPromise = null;
  function ensureApi() {
    if (window.YT?.Player) return Promise.resolve(true);
    if (!apiPromise) apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(true); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.YT?.Player), 8000);
    });
    return apiPromise;
  }

  class EmbedPlayer {
    constructor(holderId, opts) {
      this.isEmbed = true;
      this.holderId = holderId;
      this.ev = opts.events || {};
      this.state = -1; this.yt = null; this.ready = false; this.pending = null; this.gen = 0;
      ensureApi().then(ok => {
        if (!ok) { toast("Không tải được YouTube IFrame API"); this.ev.onError?.({ data: 5, message: "iframe_api" }); return; }
        this.ready = true; Util.log("embed api ready");
        this.ev.onReady?.();
        if (this.pending) { const id = this.pending; this.pending = null; this.loadVideoById(id); }
      });
    }
    /* Mỗi video tạo lại iframe với mã video ngay trong URL embed (giống iframe thuần) thay vì loadVideoById vào iframe rỗng:
       YouTube chỉ ghi lịch sử xem / tính lượt xem đầy đủ cho video nằm trong URL của iframe. */
    loadVideoById(id) {
      if (!this.ready) { this.pending = id; return; }
      const gen = ++this.gen;
      const s = Util.loadSettings();
      if (this.yt) { try { this.yt.destroy(); } catch (_) {} this.yt = null; }
      // destroy() thay iframe bằng div gốc; đảm bảo còn holder để tạo lại
      if (!document.getElementById(this.holderId)) {
        const stage = document.getElementById("player-stage");
        const d = document.createElement("div"); d.id = this.holderId; stage.insertBefore(d, stage.firstChild);
      }
      this.state = -1; this.ev.onStateChange?.({ data: -1 });
      this.yt = new YT.Player(this.holderId, {
        width: "100%", height: "100%", videoId: id,
        playerVars: {
          autoplay: 1, controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
          origin: location.origin, hl: s.lang, cc_lang_pref: s.captionLang, cc_load_policy: s.captions ? 1 : 0
        },
        events: {
          onReady: (e) => { if (gen !== this.gen) return; Util.log("embed player ready", id); try { e.target.playVideo(); } catch (_) {} },
          onStateChange: (e) => { if (gen !== this.gen) return; this.state = e.data; this.ev.onStateChange?.({ data: e.data }); },
          onError: (e) => { if (gen !== this.gen) return; Util.log("embed error", e.data); this.ev.onError?.({ data: e.data, message: { 2: "tham số sai", 5: "lỗi HTML5", 100: "video không tồn tại/riêng tư", 101: "chủ sở hữu không cho nhúng", 150: "chủ sở hữu không cho nhúng" }[e.data] || String(e.data) }); }
        }
      });
    }
    getDuration() { try { return this.yt?.getDuration() || 0; } catch (_) { return 0; } }
    getCurrentTime() { try { return this.yt?.getCurrentTime() || 0; } catch (_) { return 0; } }
    getPlayerState() { return this.state; }
    playVideo() { try { this.yt?.playVideo(); } catch (_) {} }
    pauseVideo() { try { this.yt?.pauseVideo(); } catch (_) {} }
    seekTo(t) { try { this.yt?.seekTo(Math.max(0, t), true); } catch (_) {} }
    isMuted() { try { return !!this.yt?.isMuted(); } catch (_) { return false; } }
    mute() { try { this.yt?.mute(); } catch (_) {} }
    unMute() { try { this.yt?.unMute(); } catch (_) {} }
    getOption(mod, key) { try { if (key === "tracklist") this.yt.loadModule("captions"); return this.yt.getOption(mod, key); } catch (_) { return key === "tracklist" ? [] : null; } }
    setOption(mod, key, val) { try { if (val && val.languageCode) this.yt.loadModule("captions"); this.yt.setOption(mod, key, val || {}); } catch (_) {} }
    getAvailableQualityLevels() { try { return (this.yt.getAvailableQualityLevels() || []).filter(q => q !== "auto" && q !== "default"); } catch (_) { return []; } }
    getPlaybackQuality() { try { return this.yt.getPlaybackQuality() || "auto"; } catch (_) { return "auto"; } }
    setPlaybackQualityRange(a, b) { try { this.yt.setPlaybackQualityRange?.(a, b); } catch (_) {} }
    setPlaybackQuality(q) {
      try {
        if (q === "default" || q === "auto") { this.yt.setPlaybackQualityRange?.("tiny", "highres"); this.yt.setPlaybackQuality?.("default"); }
        else { this.yt.setPlaybackQualityRange?.(q, q); this.yt.setPlaybackQuality?.(q); }
      } catch (_) {}
    }
    destroy() { try { this.yt?.destroy(); } catch (_) {} }
  }

  return { EmbedPlayer };
})();
