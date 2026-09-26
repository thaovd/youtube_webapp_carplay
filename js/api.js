/* =====================================================================
   YouTube Data API v3 – bọc fetch + các hàm nghiệp vụ.
   Dùng OAuth token khi đã đăng nhập, ngược lại dùng API key (nếu có).
   ===================================================================== */
window.Api = (function () {
  const BASE = "https://www.googleapis.com/youtube/v3/";
  const cache = new Map();          // cache ngắn hạn theo URL

  class ApiError extends Error {
    constructor(msg, status, reason) { super(msg); this.status = status; this.reason = reason; }
  }

  async function get(endpoint, params = {}, { ttl = 120_000, auth = "auto" } = {}) {
    const s = Util.loadSettings();
    const token = auth === "none" ? null : Auth.getToken();
    if (auth === "required" && !token) throw new ApiError("Cần đăng nhập", 401, "login_required");

    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, v);
    if (!token) throw new ApiError("Cần đăng nhập", 401, "login_required");
    const url = BASE + endpoint + "?" + q.toString();
    const ck = (token ? "T:" : "K:") + url;
    const hit = cache.get(ck);
    if (hit && hit.exp > Date.now()) return hit.data;

    const res = await fetch(url, { headers: token ? { Authorization: "Bearer " + token } : {} });
    if (!res.ok) {
      let body = {};
      try { body = await res.json(); } catch (_) {}
      const reason = body.error?.errors?.[0]?.reason || body.error?.status || String(res.status);
      const msg = body.error?.message || res.statusText;
      if (res.status === 401) { Auth.signOut(); }
      throw new ApiError(msg, res.status, reason);
    }
    const data = await res.json();
    if (ttl > 0) cache.set(ck, { data, exp: Date.now() + ttl });
    return data;
  }

  /* Chuẩn hoá một video về dạng dùng trong UI */
  function normVideo(v) {
    const sn = v.snippet || {};
    const isLive = sn.liveBroadcastContent === "live";
    return {
      id: v.id?.videoId || v.contentDetails?.videoId || v.snippet?.resourceId?.videoId || v.id,
      title: Util.decodeHtml(sn.title),
      channel: Util.decodeHtml(sn.videoOwnerChannelTitle || sn.channelTitle),
      channelId: sn.videoOwnerChannelId || sn.channelId,
      thumb: Util.bestThumb(sn.thumbnails),
      publishedAt: sn.publishedAt,
      duration: Util.parseDuration(v.contentDetails?.duration),
      views: v.statistics?.viewCount,
      live: isLive
    };
  }

  /* Lấy chi tiết (thời lượng, lượt xem) cho danh sách id – tối đa 50 mỗi lần */
  async function videoDetails(ids) {
    ids = [...new Set(ids.filter(Boolean))];
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const d = await get("videos", { part: "snippet,contentDetails,statistics", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
      out.push(...(d.items || []).map(normVideo));
    }
    return out;
  }

  /* ---- Thịnh hành ---- */
  async function trending({ region, categoryId, pageToken } = {}) {
    const s = Util.loadSettings();
    const d = await get("videos", {
      part: "snippet,contentDetails,statistics", chart: "mostPopular",
      regionCode: region || s.region, videoCategoryId: categoryId, maxResults: s.pageSize, pageToken,
      hl: s.lang
    });
    return { items: (d.items || []).map(normVideo), next: d.nextPageToken };
  }

  async function categories(region) {
    const s = Util.loadSettings();
    const d = await get("videoCategories", { part: "snippet", regionCode: region || s.region, hl: s.lang }, { ttl: 3600_000 });
    return (d.items || []).filter(c => c.snippet.assignable).map(c => ({ id: c.id, title: c.snippet.title }));
  }

  /* ---- Tìm kiếm ---- */
  async function search(q, { pageToken } = {}) {
    const s = Util.loadSettings();
    const d = await get("search", {
      part: "snippet", q, type: "video", maxResults: s.pageSize, pageToken, safeSearch: "moderate",
      regionCode: s.region, relevanceLanguage: s.lang
    });
    const ids = (d.items || []).map(i => i.id.videoId);
    const items = await videoDetails(ids);
    return { items, next: d.nextPageToken };
  }

  /* ---- Cá nhân (cần đăng nhập) ---- */
  async function subscriptions() {
    const items = [];
    let pageToken;
    do {
      const d = await get("subscriptions", { part: "snippet", mine: "true", maxResults: 50, order: "relevance", pageToken }, { auth: "required" });
      items.push(...(d.items || []));
      pageToken = d.nextPageToken;
    } while (pageToken && items.length < 200);
    return items.map(sub => ({
      channelId: sub.snippet.resourceId.channelId,
      title: Util.decodeHtml(sub.snippet.title),
      avatar: Util.bestThumb(sub.snippet.thumbnails)
    }));
  }

  /* Playlist "uploads" của các kênh */
  async function uploadsPlaylists(channelIds) {
    const map = {};
    for (let i = 0; i < channelIds.length; i += 50) {
      const d = await get("channels", { part: "contentDetails", id: channelIds.slice(i, i + 50).join(","), maxResults: 50 }, { ttl: 3600_000 });
      for (const c of d.items || []) map[c.id] = c.contentDetails?.relatedPlaylists?.uploads;
    }
    return map;
  }

  async function playlistItems(playlistId, { max = 50, pageToken } = {}) {
    const d = await get("playlistItems", { part: "snippet,contentDetails", playlistId, maxResults: Math.min(50, max), pageToken });
    const ids = (d.items || []).map(i => i.contentDetails?.videoId).filter(Boolean);
    const details = await videoDetails(ids);
    const byId = Object.fromEntries(details.map(v => [v.id, v]));
    return { items: ids.map(id => byId[id]).filter(Boolean), next: d.nextPageToken };
  }

  /* Bảng tin từ kênh đăng ký: video mới nhất của N kênh đầu, trộn và sắp theo ngày */
  async function subscriptionFeed({ channelLimit = 25, perChannel = 4 } = {}) {
    const subs = await subscriptions();
    const pick = subs.slice(0, channelLimit);
    const uploads = await uploadsPlaylists(pick.map(s => s.channelId));
    const lists = await Promise.allSettled(pick.map(async s => {
      const pl = uploads[s.channelId];
      if (!pl) return [];
      const d = await get("playlistItems", { part: "contentDetails", playlistId: pl, maxResults: perChannel });
      return (d.items || []).map(i => i.contentDetails.videoId);
    }));
    const ids = lists.flatMap(r => (r.status === "fulfilled" ? r.value : []));
    const vids = await videoDetails(ids);
    vids.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return { subs, items: vids };
  }

  async function likedVideos({ pageToken } = {}) {
    const s = Util.loadSettings();
    const d = await get("videos", { part: "snippet,contentDetails,statistics", myRating: "like", maxResults: s.pageSize, pageToken }, { auth: "required" });
    return { items: (d.items || []).map(normVideo), next: d.nextPageToken };
  }

  async function myPlaylists() {
    const d = await get("playlists", { part: "snippet,contentDetails", mine: "true", maxResults: 50 }, { auth: "required" });
    return (d.items || []).map(p => ({
      id: p.id, title: Util.decodeHtml(p.snippet.title), thumb: Util.bestThumb(p.snippet.thumbnails), count: p.contentDetails?.itemCount
    }));
  }

  function clearCache() { cache.clear(); }

  return { get, ApiError, trending, categories, search, subscriptions, subscriptionFeed, playlistItems, likedVideos, myPlaylists, videoDetails, clearCache };
})();
