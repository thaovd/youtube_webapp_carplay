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
     Kiến trúc: tiếng luôn phát qua thẻ <audio> riêng (luồng audio/mp4), hình qua <video> tắt tiếng.
     - iOS dừng <video> khi trang vào nền nhưng cho <audio> chạy tiếp -> nhạc không bị ngắt khi chuyển tab/app.
     - Bù trễ tiếng chỉ là dịch mốc đồng bộ, chỉnh bằng tốc độ phát, không tua.
     Nếu video không có luồng audio riêng -> phát tiếng trực tiếp từ <video>. */
  class HtmlPlayer {
    constructor(holderId, opts) {
      this.isHtml = true;
      this.ev = opts.events || {};
      this.state = STATE.UNSTARTED;
      this.info = null; this.dash = null; this.levels = []; this.quality = "auto"; this.progressive = false;
      this.captionTracks = []; this.curCaption = null;
      this.avOffset = 0; this.hasAudio = false; this.wantPlaying = false; this.syncTimer = null; this.token = 0;
      const holder = document.getElementById(holderId);
      const v = document.createElement("video");
      v.id = holderId; v.playsInline = true; v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
      v.preload = "auto"; v.crossOrigin = "anonymous"; v.disableRemotePlayback = true;
      holder.replaceWith(v);
      this.video = v;
      const a = document.createElement("audio");
      a.id = "yt-audio"; a.preload = "auto"; a.crossOrigin = "anonymous";
      v.parentNode.appendChild(a);
      this.audio = a;

      const st = (s) => { this.state = s; this.ev.onStateChange?.({ data: s }); };
      v.addEventListener("playing", () => { st(STATE.PLAYING); if (this.hasAudio) { if (this.audio.paused) { this._audioAlign(); this._audioPlay(); } } });
      v.addEventListener("pause", () => {
        if (v.ended) return;
        // Trang vào nền: hệ điều hành dừng video nhưng ta giữ tiếng chạy tiếp
        if (document.hidden && this.hasAudio && this.wantPlaying) return;
        st(STATE.PAUSED); if (this.hasAudio) a.pause();
      });
      v.addEventListener("waiting", () => { st(STATE.BUFFERING); if (this.hasAudio && !document.hidden) a.pause(); });
      v.addEventListener("ended", () => { this.wantPlaying = false; st(STATE.ENDED); a.pause(); });
      v.addEventListener("seeking", () => { if (this._progSeek) { this._progSeek = false; return; } if (this.hasAudio) this._audioAlign(); });
      v.addEventListener("error", () => { if (this.video.src || this.dash) { console.warn("video error", v.error); this.ev.onError?.({ data: 5, message: v.error?.message }); } });
      a.addEventListener("ended", () => { if (document.hidden && this.hasAudio) { this.wantPlaying = false; st(STATE.ENDED); } });
      a.addEventListener("error", () => { console.warn("audio error", a.error); });
      // Quay lại từ nền: hình nhảy tới vị trí của tiếng và phát tiếp
      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !this.hasAudio || !this.wantPlaying) return;
        if (v.paused) { this._progSeek = true; v.currentTime = Math.max(0, a.currentTime + this.avOffset); this._play(); }
      });
      // "Mở khoá" tự phát trên iOS: gọi play() cho cả hai thẻ trong cử chỉ đầu tiên của người dùng
      const unlock = () => { for (const m of [v, a]) { try { const p = m.play(); p?.catch?.(() => {}); m.pause(); } catch (_) {} } document.removeEventListener("pointerdown", unlock, true); };
      document.addEventListener("pointerdown", unlock, true);
      this.syncTimer = setInterval(() => this._audioSync(), 250);
      setTimeout(() => this.ev.onReady?.(), 0);
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
      // Luồng tiếng riêng (audio/mp4 tốt nhất)
      const af = (info.adaptiveFormats || []).filter(f => /^audio\/mp4/.test(f.type || "")).sort((a, b) => (+b.bitrate || 0) - (+a.bitrate || 0))[0];
      this.hasAudio = !!af && !info.liveNow;
      if (this.hasAudio) { this.audio.src = abs(af.url); this.video.muted = true; } else { this.audio.removeAttribute("src"); this.video.muted = false; }
      // Nguồn hình: DASH (chọn chất lượng thật) -> progressive (mp4 có sẵn tiếng)
      const pref = Util.loadSettings().quality || "auto";
      const useDash = !info.liveNow && info.dashUrl && await ensureDash();
      if (token !== this.token) return;
      if (useDash) this._playDash(abs(info.dashUrl) + (info.dashUrl.includes("?") ? "&" : "?") + "local=true", pref);
      else if (info.hlsUrl && info.liveNow) { this.video.src = abs(info.hlsUrl) + "?local=true"; this.levels = []; this._play(); }
      else { if (info.dashUrl) toast("Không dùng được DASH (" + (dashReason || "lỗi") + "), phát mp4 " + (this._bestProgressiveHeight() || 360) + "p", 3500); this._playProgressive(pref); }
      // Đang ở nền (ví dụ tự chuyển bài khi tắt màn hình): chỉ phát tiếng
      if (document.hidden && this.hasAudio) { this.audio.currentTime = 0; this._audioPlay(); }
    }
    _bestProgressiveHeight() { return Math.max(0, ...(this.info?.formatStreams || []).map(f => +(f.resolution || "").replace(/p.*/, "") || 0)); }
    _teardown() {
      if (this.dash) { try { this.dash.reset(); } catch (_) {} this.dash = null; }
      this.video.removeAttribute("src"); try { this.video.load(); } catch (_) {}
      this.audio.pause(); this.audio.playbackRate = 1;
      this.levels = []; this.progressive = false;
    }
    _play() { const p = this.video.play(); if (p?.catch) p.catch(e => console.warn("play()", e.message)); }
    _audioPlay() { if (!this.hasAudio) return; const p = this.audio.play(); if (p?.catch) p.catch(e => console.warn("audio.play()", e.message)); }
    _playDash(url, pref) {
      const d = window.dashjs.MediaPlayer().create();
      this.dash = d;
      try { d.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: pref === "auto", audio: true } }, buffer: { fastSwitchEnabled: true } } }); } catch (_) {}
      d.on("error", (e) => { console.warn("dash error", e); if (this.dash === d) { try { d.reset(); } catch (_) {} this.dash = null; dashReason = "lỗi DASH"; toast("DASH lỗi, chuyển sang mp4", 2500); this._playProgressive(pref); } });
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
    getCurrentTime() { return (document.hidden && this.hasAudio && this.video.paused) ? this.audio.currentTime + this.avOffset : (this.video.currentTime || 0); }
    getPlayerState() { return this.state; }
    playVideo() { this.wantPlaying = true; if (document.hidden && this.hasAudio) this._audioPlay(); else this._play(); }
    pauseVideo() { this.wantPlaying = false; this.video.pause(); this.audio.pause(); if (document.hidden) { this.state = STATE.PAUSED; this.ev.onStateChange?.({ data: STATE.PAUSED }); } }
    seekTo(t) { this.video.currentTime = Math.max(0, t); if (document.hidden && this.hasAudio) { this.audio.currentTime = Math.max(0, t - this.avOffset); } }
    isMuted() { return this.hasAudio ? this.audio.muted : this.video.muted; }
    mute() { if (this.hasAudio) this.audio.muted = true; else this.video.muted = true; }
    unMute() { if (this.hasAudio) this.audio.muted = false; else this.video.muted = false; }
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

    /* --- Đồng bộ: tiếng là "đồng hồ chủ", không bao giờ bị tua/đổi tốc độ khi đang phát (tránh khựng).
       Hình chạy theo tiếng: lệch nhỏ -> chỉnh tốc độ hình (mắt không nhận ra), lệch lớn -> tua hình.
       Tiếng chỉ được căn lại ở mốc rõ ràng: bắt đầu bài, người dùng tua, đổi mức bù trễ. --- */
    setAvOffset(sec) { this.avOffset = sec || 0; if (this.hasAudio) this._audioAlign(); }
    _audioTarget() { return Math.max(0, this.video.currentTime - this.avOffset); }
    _audioAlign() { if (!this.hasAudio) return; this.audio.currentTime = this._audioTarget(); this.audio.playbackRate = 1; this.video.playbackRate = 1; }
    _audioSync() {
      if (!this.hasAudio) return;
      if (this.video.paused || this.audio.paused) { if (this.video.playbackRate !== 1) this.video.playbackRate = 1; return; }
      const diff = this.audio.currentTime - this._audioTarget();     // >0: tiếng đang chạy trước hình
      if (Math.abs(diff) > 0.8) { this._progSeek = true; this.video.currentTime = Math.max(0, this.audio.currentTime + this.avOffset); this.video.playbackRate = 1; return; }
      // Hình đuổi theo tiếng bằng tốc độ phát (tối đa ±8%), hội tụ trong ~1-3 giây
      const rate = Math.abs(diff) < 0.015 ? 1 : 1 + Math.max(-0.08, Math.min(0.08, diff));
      if (Math.abs(this.video.playbackRate - rate) > 0.002) this.video.playbackRate = rate;
    }
    destroy() { clearInterval(this.syncTimer); this._teardown(); }
  }

  return { active, server, trending, search, stats, HtmlPlayer, STATE, norm };
})();
