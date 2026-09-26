/* =====================================================================
   Cấu hình mặc định. Có thể ghi đè trong trang Cài đặt (lưu localStorage)
   hoặc sửa trực tiếp tại đây trước khi triển khai.
   ===================================================================== */
window.CARTUBE_DEFAULTS = {
  // OAuth 2.0 Client ID (Web application) từ Google Cloud Console.
  // Đây là giá trị công khai; bảo vệ bằng "Authorized JavaScript origins" trong Console.
  clientId: "141361788875-f0g3hn492mnki5kvihbv656bf77epe8r.apps.googleusercontent.com",

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

  // Chất lượng ưu tiên: auto | hd1440 | hd1080 | hd720 | large(480p) | medium(360p)
  quality: "auto",

  // Máy chủ stream (Invidious tự host, xem server/README.md). Cố định, không đổi trong app.
  streamServer: "https://api-ytdlp.vuth.vn",
  // Nhận lệnh play/pause từ hệ thống (nút vô lăng, Now Playing, tai nghe): true | false
  mediaKeys: true,
  // Chế độ stream: tiếp tục phát tiếng bằng thẻ <audio> khi trang vào nền. "auto" = tắt trên iOS (thẻ audio thứ hai
  // có thể khiến iOS gửi lệnh pause giả), bật nơi khác; true/false = ép bật/tắt
  bgAudio: "auto",
  // Chế độ stream: dùng DASH (720p/1080p, cần MediaSource) hay chỉ mp4 progressive (360p, ổn định nhất)
  streamDash: true,

  // Số video tối đa mỗi trang
  pageSize: 24
};

// Mã bản dựng: workflow GitHub Pages thay __BUILD__ bằng mã commit khi deploy (dùng để chống cache)
window.CARTUBE_BUILD = "__BUILD__";

window.CARTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
