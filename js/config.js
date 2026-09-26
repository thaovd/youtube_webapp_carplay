/* =====================================================================
   Cấu hình mặc định. Có thể ghi đè trong trang Cài đặt (lưu localStorage)
   hoặc sửa trực tiếp tại đây trước khi triển khai.
   ===================================================================== */
window.CARTUBE_DEFAULTS = {
  // OAuth 2.0 Client ID (Web application) từ Google Cloud Console.
  // Đây là giá trị công khai; bảo vệ bằng "Authorized JavaScript origins" trong Console.
  clientId: "141361788875-f0g3hn492mnki5kvihbv656bf77epe8r.apps.googleusercontent.com",

  // API key (nâng cao, tuỳ chọn): chỉ cần nếu muốn xem Xu hướng / Tìm kiếm thật khi CHƯA đăng nhập.
  // Đã đăng nhập thì mọi yêu cầu dùng token OAuth, không cần key.
  apiKey: "",

  // Mã vùng cho bảng xếp hạng thịnh hành (VN, US, JP, KR, ...)
  region: "VN",

  // Ngôn ngữ giao diện / kết quả + nhận dạng giọng nói
  lang: "vi",
  speechLang: "vi-VN",

  // Cỡ giao diện: normal | large | xlarge
  uiScale: "normal",

  // Tự phát video tiếp theo trong danh sách
  autoplayNext: true,

  // Phụ đề: bật mặc định? và ngôn ngữ ưu tiên (vi, en, ja, ko...)
  captions: false,
  captionLang: "vi",

  // Chất lượng ưu tiên: auto | hd1080 | hd720 | large(480p) | medium(360p)
  quality: "auto",
  // Ép chất lượng bằng "khung ảo" (render iframe ở đúng kích thước rồi thu nhỏ). Tắt nếu thiết bị hiển thị video lệch.
  virtualFrame: true,

  // Bù trễ tiếng (ms). 0 = tắt. Dương = tiếng phát chậm lại (khi hình trên xe chậm hơn tiếng), âm = tiếng sớm hơn.
  // Khác 0 sẽ chạy 2 trình phát song song (một hình, một tiếng) - thử nghiệm.
  avOffsetMs: 0,

  // Trình phát: custom (nút lớn, tuỳ biến) | native (embed với điều khiển của YouTube)
  //             | youtube (mở thẳng youtube.com ở tầng trên cùng: dùng phiên đăng nhập/Premium của trình duyệt, không quảng cáo)
  //             | stream (máy chủ Invidious riêng, xem server/README.md: không quảng cáo, chọn chất lượng thật, bù trễ chính xác)
  playerMode: "custom",

  // Địa chỉ máy chủ stream (https://...), dùng cho chế độ stream
  streamServer: "",
  // Nhận lệnh play/pause từ hệ thống (nút vô lăng, Now Playing, tai nghe): "auto" = tắt trên iOS ở chế độ stream
  // vì iOS/CarPlay hay gửi lệnh pause giả khi phiên âm thanh bị ngắt quãng; true/false = ép bật/tắt
  mediaKeys: "auto",
  // Chế độ stream: dùng DASH (720p/1080p, cần MediaSource) hay chỉ mp4 progressive (360p, ổn định nhất)
  streamDash: true,

  // Số video tối đa mỗi trang
  pageSize: 24
};

// Mã bản dựng: workflow GitHub Pages thay __BUILD__ bằng mã commit khi deploy (dùng để chống cache)
window.CARTUBE_BUILD = "__BUILD__";

window.CARTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
