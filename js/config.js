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

  // Trình phát: custom (nút lớn, tuỳ biến) | native (trình phát YouTube gốc, có menu chất lượng/phụ đề của YouTube)
  playerMode: "custom",

  // Số video tối đa mỗi trang
  pageSize: 24
};

window.CARTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
