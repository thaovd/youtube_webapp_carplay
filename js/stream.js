/* =====================================================================
   Chế độ STREAM: phát bằng thẻ <video> của app, luồng lấy từ máy chủ Invidious riêng (server/).
   HtmlPlayer giả lập đúng các phương thức của YT.Player mà player.js dùng, nên toàn bộ điều khiển,
   cử chỉ, hàng đợi, màn che... dùng chung. Thêm: chọn chất lượng thật (dash.js), phụ đề WebVTT,
   bù trễ tiếng chính xác bằng thẻ <audio> riêng (chỉnh tốc độ phát, không tua -> không khựng).
   ===================================================================== */
window.Stream = (function () {
  const { toast } = Util;
  const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  const HEIGHT_TO_Q = [[2160, "hd2160"], [1440, "hd1440"], [1080, "hd1080"], [720, "hd720"], [480, "large"], [360, "medium"], [240, "small"], [144, "tiny"]];
  const Q_TO_HEIGHT = Object.fromEntries(HEIGHT_TO_Q.map(([h, q]) => [q, h]));
  const qOfHeight = (h) => (HEIGHT_TO_Q.find(([hh]) => h >= hh) || [0, "tiny"])[1];

  function server() { return (Util.loadSettings().streamServer || "").replace(/\/+$/, ""); }
  function active() { return Util.loadSettings().playerMode === "stream" && !!server(); }
  /* URL từ Invidious: tương đối -> ghép máy chủ; tuyệt đối nhưng trỏ tên miền khác (DOMAIN cấu hình lệch) -> đổi về máy chủ đã nhập */
  function abs(u) {
    if (!u) return u;
    if (!/^https?:/i.test(u)) return server() + u;
    try {
      const x = new URL(u), sv = new URL(server());
      if (x.host !== sv.host && /^\/(videoplayback|api\/|vi\/|ggpht|latest_version)/.test(x.pathname)) { x.protocol = sv.protocol; x.host = sv.host; return x.toString(); }
    } catch (_) {}
    return u;
  }

  /* ---- Dữ liệu từ Invidious (dùng cho xu hướng / tìm kiếm khi không đăng nhập Google) ---- */
  function norm(v) {
    const th = (v.videoThumbnails || []).find(t => t.quality === "medium") || (v.videoThumbnails || [])[0];
    return {
      id: v.videoId, title: v.title, channel: v.author, channelId: v.authorId,
      thumb: th ? abs(th.url) : "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg",
      publishedAt: v.published ? new Date(v.published * 1000).toISOString() : null,
      duration: v.lengthSeconds || 0, views: v.viewCount, live: !!v.liveNow
    };
  }
  async function api(path, params = {}) {
    const q = new URLSearchParams(params);
    const res = await fetch(server() + path + (q.toString() ? "?" + q : ""), { cache: "no-store" });
    if (!res.ok) throw new Error("Máy chủ stream trả lỗi " + res.status);
    return res.json();
  }
  async function trending({ region, categoryId } = {}) {
    const type = { "10": "music", "20": "gaming", "1": "movies" }[categoryId];
    const items = await api("/api/v1/trending", { region: region || Util.loadSettings().region, type });
    return { items: items.filter(v => v.videoId).map(norm), next: null };
  }
  async function search(q, { page = 1 } = {}) {
    const items = await api("/api/v1/search", { q, type: "video", page, region: Util.loadSettings().region });
    return { items: items.filter(v => v.type === "video").map(norm), next: items.length ? String(page + 1) : null };
  }
  async function stats() { return api("/api/v1/stats"); }

  /* ---- dash.js nạp khi cần (v5 hỗ trợ ManagedMediaSource của iOS 17.1+; dự phòng v4) ---- */
  let dashPromise = null, dashReason = "";
  function loadScript(src) { return new Promise((res) => { const s = document.createElement("script"); s.src = src; s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); }); }
  function ensureDash() {
    if (window.dashjs) return Promise.resolve(true);
    if (!(window.ManagedMediaSource || window.MediaSource)) { dashReason = "trình duyệt không có MediaSource"; return Promise.resolve(false); }
    if (!dashPromise) dashPromise = (async () => {
      const urls = ["https://cdn.jsdelivr.net/npm/dashjs@5/dist/modern/umd/dash.all.min.js", "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js"];
      for (const u of urls) { if (await loadScript(u) && window.dashjs) return true; }
      dashReason = "không tải được dash.js"; return false;
    })();
    return dashPromise;
  }
  /* Lớp tương thích dash.js v4/v5 */
  const DJ = {
    levels(d) {
      if (d.getRepresentationsByType) return (d.getRepresentationsByType("video") || []).map((r, i) => ({ i: r.absoluteIndex ?? i, id: r.id, height: r.height || 0 }));
      return (d.getBitrateInfoListFor("video") || []).map((b, i) => ({ i: b.qualityIndex ?? i, height: b.height || 0 }));
    },
    current(d) {
      if (d.getCurrentRepresentationForType) { const r = d.getCurrentRepresentationForType("video"); return r ? { i: r.absoluteIndex, id: r.id, height: r.height } : null; }
      const i = d.getQualityFor("video"); return { i };
    },
    set(d, lv) {
      if (d.setRepresentationForTypeById && lv.id != null) return d.setRepresentationForTypeById("video", lv.id, true);
      if (d.setRepresentationForTypeByIndex) return d.setRepresentationForTypeByIndex("video", lv.i, true);
      return d.setQualityFor("video", lv.i, true);
    }
  };

  /* ---- Trình phát HTML với giao diện giống YT.Player ----
     Hình + tiếng phát từ một thẻ <video> (ổn định nhất trên iOS). Thẻ <audio> chỉ dùng để tiếp tục nhạc
     khi trang vào nền (iOS dừng <video> nhưng cho <audio> chạy), quay lại thì trả về <video>. */
  class HtmlPlayer {
    constructor(holderId, opts) {
      this.isHtml = true;
      this.ev = opts.events || {};
      this.state = STATE.UNSTARTED;
      this.info = null; this.dash = null; this.levels = []; this.quality = "auto"; this.progressive = false;
      this.captionTracks = []; this.curCaption = null;
      this.audioUrl = null; this.bg = false; this.wantPlaying = false; this.token = 0;
      const holder = document.getElementById(holderId);
      const v = document.createElement("video");
      v.id = holderId; v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
      v.preload = "auto"; v.crossOrigin = "anonymous"; v.disableRemotePlayback = true;
      holder.replaceWith(v);
      this.video = v;
      const a = document.createElement("audio");
      a.id = "yt-audio"; a.preload = "none"; a.crossOrigin = "anonymous";
      v.parentNode.appendChild(a);
      this.audio = a;

      const st = (s) => { this.state = s; this.ev.onStateChange?.({ data: s }); };
      for (const evn of ["loadstart", "loadedmetadata", "canplay", "play", "playing", "pause", "waiting", "stalled", "seeking", "seeked", "ended", "error", "emptied", "abort", "suspend", "ratechange"]) {
        v.addEventListener(evn, () => Util.log("video:" + evn, "t=" + v.currentTime.toFixed(2), "rs=" + v.readyState, "net=" + v.networkState, v.paused ? "paused" : "", evn === "error" ? (v.error?.code + " " + v.error?.message) : ""));
      }
      for (const evn of ["play", "playing", "pause", "waiting", "ended", "error"]) a.addEventListener(evn, () => Util.log("audio:" + evn, "t=" + a.currentTime.toFixed(2)));
      v.addEventListener("playing", () => { st(STATE.PLAYING); });
      v.addEventListener("pause", () => {
        if (v.ended) return;
        // Trang vào nền: hệ điều hành dừng video -> chuyển sang phát tiếng bằng <audio>
        if (document.hidden && this.wantPlaying && this.audioUrl) { this._bgStart(); return; }
        st(STATE.PAUSED);
      });
      v.addEventListener("waiting", () => st(STATE.BUFFERING));
      v.addEventListener("ended", () => { this.wantPlaying = false; st(STATE.ENDED); });
      v.addEventListener("error", () => { if (this.video.src || this.dash) { console.warn("video error", v.error); this.ev.onError?.({ data: 5, message: v.error?.message }); } });
      a.addEventListener("ended", () => { if (this.bg) { this.bg = false; this.wantPlaying = false; st(STATE.ENDED); } });
      a.addEventListener("error", () => { console.warn("audio error", a.error); });
      // Quay lại từ nền: hình nhảy tới vị trí của tiếng, phát tiếp bằng <video>
      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !this.bg) return;
        this._bgStop(true);
      });
      // "Mở khoá" tự phát trên iOS: gọi play() cho cả hai thẻ trong cử chỉ đầu tiên của người dùng
      const unlock = () => { for (const m of [v, a]) { try { const p = m.play(); p?.catch?.(() => {}); m.pause(); } catch (_) {} } document.removeEventListener("pointerdown", unlock, true); };
      document.addEventListener("pointerdown", unlock, true);
      setTimeout(() => this.ev.onReady?.(), 0);
    }

    /* --- Nền: tiếng qua <audio> --- */
    _bgStart() {
      if (this.bg || !this.audioUrl) return;
      Util.log("bg start");
      this.bg = true;
      if (this.audio.src !== this.audioUrl) this.audio.src = this.audioUrl;
      this.audio.currentTime = this.video.currentTime || 0;
      const p = this.audio.play(); if (p?.catch) p.catch(e => { console.warn("bg audio", e.message); this.bg = false; this.ev.onStateChange?.({ data: STATE.PAUSED }); });
    }
    _bgStop(resumeVideo) {
      if (!this.bg) return;
      Util.log("bg stop");
      this.bg = false;
      const t = this.audio.currentTime;
      this.audio.pause();
      if (resumeVideo && this.wantPlaying) { this.video.currentTime = t; this._play(); }
    }

    /* --- Tải video --- */
    async loadVideoById(id) {
      const token = ++this.token;
      this._teardown();
      this.wantPlaying = true;
      this.state = STATE.UNSTARTED; this.ev.onStateChange?.({ data: STATE.UNSTARTED });
      let info;
      try { info = await api("/api/v1/videos/" + encodeURIComponent(id), { local: "true" }); }
      catch (e) { console.warn(e); if (token === this.token) this.ev.onError?.({ data: 100, message: e.message }); return; }
      if (token !== this.token) return;
      this.info = info;
      // Phụ đề
      this.captionTracks = (info.captions || []).map(c => ({ languageCode: c.language_code, displayName: c.label, kind: /auto|tự động/i.test(c.label) ? "asr" : "", url: abs(c.url) }));
      for (const t of this.video.querySelectorAll("track")) t.remove();
      for (const c of this.captionTracks) { const tr = document.createElement("track"); tr.kind = "subtitles"; tr.label = c.displayName; tr.srclang = c.languageCode; tr.src = c.url; this.video.appendChild(tr); }
      this.curCaption = null;
      // Luồng tiếng riêng, chỉ dùng khi vào nền
      const af = (info.adaptiveFormats || []).filter(f => /^audio\/mp4/.test(f.type || "")).sort((a, b) => (+b.bitrate || 0) - (+a.bitrate || 0))[0];
      this.audioUrl = af && !info.liveNow ? abs(af.url) : null;
      // Nguồn: DASH (chọn chất lượng thật) -> progressive (mp4 có sẵn tiếng)
      const s = Util.loadSettings();
      const pref = s.quality || "auto";
      const useDash = s.streamDash !== false && !info.liveNow && info.dashUrl && await ensureDash();
      if (token !== this.token) return;
      Util.log("load", id, "dash=" + !!useDash, "audioUrl=" + !!this.audioUrl, "hidden=" + document.hidden, "formats=" + (info.formatStreams || []).map(f => f.resolution).join(","));
      if (useDash) this._playDash(abs(info.dashUrl) + (info.dashUrl.includes("?") ? "&" : "?") + "local=true", pref);
      else if (info.hlsUrl && info.liveNow) { this.video.src = abs(info.hlsUrl) + "?local=true"; this.levels = []; this._play(); }
      else { if (info.dashUrl && s.streamDash !== false) toast("Không dùng được DASH (" + (dashReason || "lỗi") + "), phát mp4 " + (this._bestProgressiveHeight() || 360) + "p", 3500); this._playProgressive(pref); }
      // Đang ở nền (tự chuyển bài khi tắt màn hình): phát tiếng luôn
      if (document.hidden && this.audioUrl) { this.video.pause(); this._bgStart(); }
    }
    _bestProgressiveHeight() { return Math.max(0, ...(this.info?.formatStreams || []).map(f => +(f.resolution || "").replace(/p.*/, "") || 0)); }
    _teardown() {
      if (this.dash) { try { this.dash.reset(); } catch (_) {} this.dash = null; }
      this.video.removeAttribute("src"); try { this.video.load(); } catch (_) {}
      this.bg = false; this.audio.pause(); this.audio.removeAttribute("src");
      this.levels = []; this.progressive = false; this.audioUrl = null;
    }
    _play() { const p = this.video.play(); if (p?.catch) p.catch(e => console.warn("play()", e.message)); }
    _playDash(url, pref) {
      const d = window.dashjs.MediaPlayer().create();
      this.dash = d;
      try { d.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: pref === "auto", audio: true } }, buffer: { fastSwitchEnabled: true } } }); } catch (_) {}
      d.on("error", (e) => { console.warn("dash error", e); Util.log("dash error", e?.error?.code || e?.error, e?.error?.message || ""); if (this.dash === d) { try { d.reset(); } catch (_) {} this.dash = null; dashReason = "lỗi DASH"; toast("DASH lỗi, chuyển sang mp4", 2500); this._playProgressive(pref); } });
      d.on("streamInitialized", () => {
        try { this.levels = DJ.levels(d).map(l => Object.assign(l, { q: qOfHeight(l.height) })); } catch (e) { console.warn(e); this.levels = []; }
        if (pref !== "auto") this.setPlaybackQuality(pref);
      });
      d.initialize(this.video, url, true);
    }
    _playProgressive(pref) {
      const fs = (this.info?.formatStreams || []).map(f => ({ url: abs(f.url), height: +(f.resolution || "").replace(/p.*/, "") || +(f.size || "").split("x")[1] || 360, type: f.type || "" }))
        .filter(f => /mp4/.test(f.type)).sort((a, b) => b.height - a.height);
      if (!fs.length) { this.ev.onError?.({ data: 100, message: "Không có luồng phát" }); return; }
      const want = Q_TO_HEIGHT[pref] || Infinity;
      const pick = fs.find(f => f.height <= want) || fs[fs.length - 1];
      this.levels = fs.map((f, i) => ({ i, height: f.height, q: qOfHeight(f.height), url: f.url }));
      this.progressive = true;
      this.video.src = pick.url; this._play();
    }

    /* --- YT.Player API --- */
    getDuration() { return this.video.duration && isFinite(this.video.duration) ? this.video.duration : (this.info?.lengthSeconds || 0); }
    getCurrentTime() { return this.bg ? this.audio.currentTime : (this.video.currentTime || 0); }
    getPlayerState() { return this.state; }
    playVideo() { Util.log("api playVideo"); this.wantPlaying = true; if (document.hidden && this.audioUrl) { if (this.bg) { const p = this.audio.play(); p?.catch?.(() => {}); } else this._bgStart(); this.state = STATE.PLAYING; this.ev.onStateChange?.({ data: STATE.PLAYING }); } else this._play(); }
    pauseVideo() { Util.log("api pauseVideo"); this.wantPlaying = false; if (this.bg) { this.audio.pause(); this.state = STATE.PAUSED; this.ev.onStateChange?.({ data: STATE.PAUSED }); } else this.video.pause(); }
    seekTo(t) { Util.log("api seekTo", t.toFixed(1)); if (this.bg) this.audio.currentTime = Math.max(0, t); else this.video.currentTime = Math.max(0, t); }
    isMuted() { return this.video.muted; }
    mute() { this.video.muted = true; this.audio.muted = true; }
    unMute() { this.video.muted = false; this.audio.muted = false; }
    loadModule() {} unloadModule() {}
    getOption(mod, key) {
      if (mod !== "captions") return null;
      if (key === "tracklist") return this.captionTracks.map(({ languageCode, displayName, kind }) => ({ languageCode, displayName, kind }));
      if (key === "track") return this.curCaption ? { languageCode: this.curCaption.languageCode, kind: this.curCaption.kind } : {};
      return null;
    }
    setOption(mod, key, val) {
      if (mod !== "captions" || key !== "track") return;
      const tracks = this.video.textTracks;
      this.curCaption = null;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i], meta = this.captionTracks[i];
        const on = !!(val && val.languageCode && meta && meta.languageCode === val.languageCode && (meta.kind || "") === (val.kind || ""));
        t.mode = on ? "showing" : "disabled";
        if (on) this.curCaption = meta;
      }
    }
    getAvailableQualityLevels() { return [...new Set(this.levels.slice().sort((a, b) => b.height - a.height).map(l => l.q))]; }
    getPlaybackQuality() {
      if (this.dash) { try { const c = DJ.current(this.dash); const l = c && this.levels.find(x => (c.id != null && x.id === c.id) || x.i === c.i); return l ? l.q : "auto"; } catch (_) { return "auto"; } }
      const h = this.video.videoHeight; return h ? qOfHeight(h) : "auto";
    }
    setPlaybackQualityRange(a, b) { this.setPlaybackQuality(a === "tiny" && b === "highres" ? "default" : b); }
    setPlaybackQuality(q) {
      if (q === "default" || q === "auto") { this.quality = "auto"; if (this.dash) { try { this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } }); } catch (_) {} } return; }
      const want = Q_TO_HEIGHT[q]; if (!want) return;
      this.quality = q;
      const pick = this.levels.filter(l => l.height <= want).sort((a, b) => b.height - a.height)[0] || this.levels.slice().sort((a, b) => a.height - b.height)[0];
      if (!pick) return;
      if (this.dash) {
        try { this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } }); DJ.set(this.dash, pick); } catch (e) { console.warn(e); }
      } else if (this.progressive && pick.url && pick.url !== this.video.currentSrc) {
        const t = this.video.currentTime, playing = !this.video.paused; this.video.src = pick.url; this.video.currentTime = t; if (playing) this._play();
      }
    }
    setAvOffset() {}   // không hỗ trợ ở chế độ Stream
    destroy() { this._teardown(); }
  }

  return { active, server, trending, search, stats, HtmlPlayer, STATE, norm };
})();
