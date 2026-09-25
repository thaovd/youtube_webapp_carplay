/* =====================================================================
   Chế độ DEMO: dùng khi chưa có Client ID / API key để xem giao diện.
   Video là các video công khai thật trên YouTube nên vẫn phát được.
   ===================================================================== */
window.Demo = (function () {
  const RAW = [
    ["dQw4w9WgXcQ", "Rick Astley - Never Gonna Give You Up (Official Video)", "Rick Astley", 213],
    ["9bZkp7q19f0", "PSY - GANGNAM STYLE(강남스타일) M/V", "officialpsy", 253],
    ["kJQP7kiw5Fk", "Luis Fonsi - Despacito ft. Daddy Yankee", "Luis Fonsi", 282],
    ["JGwWNGJdvx8", "Ed Sheeran - Shape of You (Official Music Video)", "Ed Sheeran", 264],
    ["RgKAFK5djSk", "Wiz Khalifa - See You Again ft. Charlie Puth", "Wiz Khalifa", 237],
    ["OPf0YbXqDm0", "Mark Ronson - Uptown Funk (Official Video) ft. Bruno Mars", "Mark Ronson", 271],
    ["fJ9rUzIMcZQ", "Queen – Bohemian Rhapsody (Official Video Remastered)", "Queen Official", 355],
    ["hT_nvWreIhg", "OneRepublic - Counting Stars (Official Music Video)", "OneRepublic", 263],
    ["CevxZvSJLk8", "Katy Perry - Roar (Official)", "Katy Perry", 269],
    ["YQHsXMglC9A", "Adele - Hello (Official Music Video)", "Adele", 366],
    ["60ItHLz5WEA", "Alan Walker - Faded", "Alan Walker", 213],
    ["2Vv-BfVoq4g", "Ed Sheeran - Perfect (Official Music Video)", "Ed Sheeran", 280],
    ["09R8_2nJtjg", "Maroon 5 - Sugar (Official Music Video)", "Maroon 5", 301],
    ["pRpeEdMmmQ0", "Shakira - Waka Waka (This Time for Africa)", "Shakira", 211],
    ["e-ORhEE9VVg", "Taylor Swift - Blank Space", "Taylor Swift", 272],
    ["nfWlot6h_JM", "Taylor Swift - Shake It Off", "Taylor Swift", 242],
    ["lp-EO5I60KA", "Ed Sheeran - Thinking Out Loud (Official Music Video)", "Ed Sheeran", 297],
    ["7wtfhZwyrcc", "Imagine Dragons - Believer (Official Music Video)", "ImagineDragons", 204],
    ["kXYiU_JCYtU", "Linkin Park - Numb (Official Music Video)", "Linkin Park", 187],
    ["YykjpeuMNEk", "Coldplay - Hymn For The Weekend (Official Video)", "Coldplay", 260]
  ];
  const items = RAW.map(([id, title, channel, duration], i) => ({
    id, title, channel, channelId: "demo-" + channel, duration,
    thumb: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg",
    publishedAt: new Date(Date.now() - (i + 1) * 86400e3 * 3).toISOString(),
    views: String(Math.round((20 - i) * 1.7e8)), live: false
  }));

  function active() {
    const s = Util.loadSettings();
    return !s.apiKey && !Auth.getToken();
  }
  function trending() { return { items: items.slice(), next: null }; }
  function search(q) {
    q = (q || "").toLowerCase();
    const hit = items.filter(v => (v.title + " " + v.channel).toLowerCase().includes(q));
    return { items: hit.length ? hit : items.slice().reverse(), next: null };
  }
  return { active, trending, search };
})();
