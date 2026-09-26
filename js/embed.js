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
      this.ev = opts.events || {};
      this.state = -1; this.yt = null; this.ready = false; this.pending = null;
      const s = Util.loadSettings();
      ensureApi().then(ok => {
        if (!ok) { toast("Không tải được YouTube IFrame API"); this.ev.onError?.({ data: 5, message: "iframe_api" }); return; }
        this.yt = new YT.Player(holderId, {
          width: "100%", height: "100%",
          playerVars: {
            controls: 0, rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1,
            origin: location.origin, hl: s.lang, cc_lang_pref: s.captionLang, cc_load_policy: s.captions ? 1 : 0
          },
          events: {
            onReady: () => { this.ready = true; Util.log("embed ready"); this.ev.onReady?.(); if (this.pending) { const id = this.pending; this.pending = null; this.loadVideoById(id); } },
            onStateChange: (e) => { this.state = e.data; this.ev.onStateChange?.({ data: e.data }); },
            onError: (e) => { Util.log("embed error", e.data); this.ev.onError?.({ data: e.data, message: { 2: "tham số sai", 5: "lỗi HTML5", 100: "video không tồn tại/riêng tư", 101: "chủ sở hữu không cho nhúng", 150: "chủ sở hữu không cho nhúng" }[e.data] || String(e.data) }); }
          }
        });
      });
    }
    loadVideoById(id) { if (!this.ready) { this.pending = id; return; } this.yt.loadVideoById(id); }
    getDuration() { try { return this.yt?.getDuration() || 0; } catch (_) { return 0; } }
    getCurrentTime() { try { return this.yt?.getCurrentTime() || 0; } catch (_) { return 0; } }
    getPlayerState() { return this.state; }
    playVideo() { this.yt?.playVideo(); }
    pauseVideo() { this.yt?.pauseVideo(); }
    seekTo(t) { this.yt?.seekTo(Math.max(0, t), true); }
    isMuted() { try { return !!this.yt?.isMuted(); } catch (_) { return false; } }
    mute() { this.yt?.mute(); }
    unMute() { this.yt?.unMute(); }
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
