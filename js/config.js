/* =====================================================================
   Cấu hình mặc định. Có thể ghi đè trong trang Cài đặt (lưu localStorage)
   hoặc sửa trực tiếp tại đây trước khi triển khai.
   ===================================================================== */
window.CARTUBE_DEFAULTS = {
  // OAuth 2.0 Client ID (Web application) từ Google Cloud Console.
  // Bắt buộc để đăng nhập và lấy dữ liệu cá nhân (kênh đăng ký, video đã thích, playlist).
  clientId: "",

  // API key (tuỳ chọn). Dùng để xem "Thịnh hành" và tìm kiếm khi CHƯA đăng nhập.
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

  // Số video tối đa mỗi trang
  pageSize: 24
};

window.CARTUBE_SCOPES = "https://www.googleapis.com/auth/youtube.readonly";
