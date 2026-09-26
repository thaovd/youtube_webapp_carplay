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

  /* ---- dash.js nạp khi cần ---- */
  let dashPromise = null;
  function ensureDash() {
    if (window.dashjs) return Promise.resolve(true);
    if (!(window.ManagedMediaSource || window.MediaSource)) return Promise.resolve(false);
    if (!dashPromise) dashPromise = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js";
      s.onload = () => resolve(!!window.dashjs); s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
    return dashPromise;
  }

  /* ---- Trình phát HTML với giao diện giống YT.Player ---- */
  class HtmlPlayer {
    constructor(holderId, opts) {
      this.isHtml = true;
      this.ev = opts.events || {};
      this.state = STATE.UNSTARTED;
      this.info = null; this.dash = null; this.levels = []; this.quality = "auto";
      this.captionTracks = []; this.curCaption = null;
      this.avOffset = 0; this.audio = null; this.syncTimer = null;
      const holder = document.getElementById(holderId);
      const v = document.createElement("video");
      v.id = holderId; v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
      v.preload = "auto"; v.crossOrigin = "anonymous"; v.disableRemotePlayback = true;
      holder.replaceWith(v);
      this.video = v;
      const st = (s) => { this.state = s; this.ev.onStateChange?.({ data: s }); };
      v.addEventListener("playing", () => { st(STATE.PLAYING); this._audioFollow(); });
      v.addEventListener("pause", () => { if (!v.ended) st(STATE.PAUSED); this._audioFollow(); });
      v.addEventListener("waiting", () => st(STATE.BUFFERING));
      v.addEventListener("ended", () => { st(STATE.ENDED); this._audioFollow(); });
      v.addEventListener("seeking", () => this._audioSeek());
      v.addEventListener("error", () => { if (this.video.src || this.dash) { console.warn("video error", v.error); this.ev.onError?.({ data: 5, message: v.error?.message }); } });
      // "Mở khoá" tự phát trên iOS: gọi play() trong cử chỉ đầu tiên của người dùng
      const unlock = () => { try { v.play().catch(() => {}); v.pause(); } catch (_) {} if (this.audio) { try { this.audio.play().catch(() => {}); this.audio.pause(); } catch (_) {} } document.removeEventListener("pointerdown", unlock, true); };
      document.addEventListener("pointerdown", unlock, true);
      setTimeout(() => this.ev.onReady?.(), 0);
    }

    /* --- Tải video --- */
    async loadVideoById(id) {
      this.token = (this.token || 0) + 1; const token = this.token;
      this._teardown();
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
      // Nguồn: DASH (chọn chất lượng thật) -> progressive (mp4 có sẵn tiếng)
      const pref = Util.loadSettings().quality || "auto";
      const useDash = !info.liveNow && info.dashUrl && await ensureDash();
      if (token !== this.token) return;
      if (useDash) this._playDash(abs(info.dashUrl) + (info.dashUrl.includes("?") ? "&" : "?") + "local=true", pref);
      else if (info.hlsUrl && info.liveNow) { this.video.src = abs(info.hlsUrl) + "?local=true"; this.levels = []; this._play(); }
      else this._playProgressive(pref);
      this._audioSetup();
    }
    _teardown() {
      clearInterval(this.syncTimer); this.syncTimer = null;
      if (this.dash) { try { this.dash.reset(); } catch (_) {} this.dash = null; }
      this.video.removeAttribute("src"); try { this.video.load(); } catch (_) {}
      if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); }
      this.levels = [];
    }
    _play() { const p = this.video.play(); if (p?.catch) p.catch(e => console.warn("play()", e.message)); }
    _playDash(url, pref) {
      const d = window.dashjs.MediaPlayer().create();
      this.dash = d;
      d.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: pref === "auto", audio: true } }, buffer: { fastSwitchEnabled: true } } });
      d.on("error", (e) => { console.warn("dash error", e); if (this.dash === d) { d.reset(); this.dash = null; this._playProgressive(pref); } });
      d.on("streamInitialized", () => {
        this.levels = (d.getBitrateInfoListFor("video") || []).map((b, i) => ({ i, height: b.height, q: qOfHeight(b.height) }));
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
    getCurrentTime() { return this.video.currentTime || 0; }
    getPlayerState() { return this.state; }
    playVideo() { this._play(); }
    pauseVideo() { this.video.pause(); }
    seekTo(t) { this.video.currentTime = Math.max(0, t); this._audioSeek(); }
    isMuted() { return this.avOffset ? !!this.audio?.muted : this.video.muted; }
    mute() { if (this.avOffset && this.audio) this.audio.muted = true; else this.video.muted = true; }
    unMute() { if (this.avOffset && this.audio) this.audio.muted = false; else this.video.muted = false; }
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
    getAvailableQualityLevels() { return [...new Set(this.levels.map(l => l.q))]; }
    getPlaybackQuality() {
      if (this.dash) { try { const i = this.dash.getQualityFor("video"); const l = this.levels.find(x => x.i === i); return l ? l.q : "auto"; } catch (_) { return "auto"; } }
      const h = this.video.videoHeight; return h ? qOfHeight(h) : "auto";
    }
    setPlaybackQualityRange(a, b) { this.setPlaybackQuality(a === "tiny" && b === "highres" ? "default" : b); }
    setPlaybackQuality(q) {
      if (q === "default" || q === "auto") { this.quality = "auto"; if (this.dash) this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } }); return; }
      const want = Q_TO_HEIGHT[q]; if (!want) return;
      this.quality = q;
      if (this.dash) {
        const cands = this.levels.filter(l => l.height <= want).sort((a, b) => b.height - a.height);
        const pick = cands[0] || this.levels.slice().sort((a, b) => a.height - b.height)[0];
        if (!pick) return;
        this.dash.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
        this.dash.setQualityFor("video", pick.i, true);
      } else if (this.progressive && this.levels.length) {
        const pick = this.levels.filter(l => l.height <= want).sort((a, b) => b.height - a.height)[0] || this.levels[this.levels.length - 1];
        if (pick && pick.url !== this.video.currentSrc) { const t = this.video.currentTime, playing = !this.video.paused; this.video.src = pick.url; this.video.currentTime = t; if (playing) this._play(); }
      }
    }

    /* --- Bù trễ tiếng: thẻ <audio> riêng phát luồng âm thanh, giữ lệch offset so với hình --- */
    setAvOffset(sec) {
      this.avOffset = sec || 0;
      this._audioSetup();
    }
    _audioSetup() {
      if (!this.avOffset || !this.info) {          // tắt: hình phát tiếng như thường
        if (this.audio) { this.audio.pause(); this.audio.removeAttribute("src"); }
        clearInterval(this.syncTimer); this.syncTimer = null;
        this.video.muted = false;
        return;
      }
      const af = (this.info.adaptiveFormats || []).filter(f => /^audio\/mp4/.test(f.type || "")).sort((a, b) => (+b.bitrate || 0) - (+a.bitrate || 0))[0];
      if (!af) { toast("Video này không tách được luồng tiếng, bù trễ tạm tắt"); this.video.muted = false; return; }
      if (!this.audio) { this.audio = document.createElement("audio"); this.audio.preload = "auto"; this.audio.crossOrigin = "anonymous"; this.audio.id = "yt-audio"; this.video.parentNode.appendChild(this.audio); }
      const src = abs(af.url);
      if (this.audio.dataset.src !== src) { this.audio.dataset.src = src; this.audio.src = src; }
      this.video.muted = true;
      this._audioSeek();
      this._audioFollow();
      clearInterval(this.syncTimer);
      this.syncTimer = setInterval(() => this._audioSync(), 250);
    }
    _audioTarget() { return Math.max(0, this.video.currentTime - this.avOffset); }
    _audioSeek() { if (this.avOffset && this.audio) { this.audio.currentTime = this._audioTarget(); this.audio.playbackRate = 1; } }
    _audioFollow() {
      if (!this.avOffset || !this.audio) return;
      if (this.state === STATE.PLAYING) { this._audioSeek(); const p = this.audio.play(); p?.catch?.(() => {}); }
      else this.audio.pause();
    }
    _audioSync() {
      if (!this.avOffset || !this.audio || this.video.paused || this.audio.paused) return;
      const diff = this.audio.currentTime - this._audioTarget();     // >0: tiếng đang chạy trước mức mong muốn
      if (Math.abs(diff) > 0.8) { this.audio.currentTime = this._audioTarget(); this.audio.playbackRate = 1; return; }
      // Chỉnh bằng tốc độ phát (±5% tối đa), không tua -> không khựng, hội tụ trong ~1-2 giây
      const rate = Math.abs(diff) < 0.015 ? 1 : 1 - Math.max(-0.05, Math.min(0.05, diff));
      if (Math.abs(this.audio.playbackRate - rate) > 0.002) this.audio.playbackRate = rate;
    }
    destroy() { this._teardown(); }
  }

  return { active, server, trending, search, stats, HtmlPlayer, STATE, norm };
})();
