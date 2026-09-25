# CarTube – YouTube cho màn hình ô tô

Web app **tĩnh** (HTML + CSS + JavaScript thuần, không cần backend) mô phỏng ứng dụng YouTube mobile,
tối ưu cho màn hình nhỏ trên xe ô tô (Android head unit, CarPlay web browser, máy tính bảng gắn xe…).

- Nút thao tác lớn (≥ 60 px), giao diện tối, chữ to, có thể phóng giao diện 3 mức.
- Phát video bằng **YouTube IFrame Player** (embed), điều khiển tuỳ biến: Phát/Dừng, ±10 s, Trước/Sau, Tắt tiếng, Toàn màn hình, thanh tua lớn.
- **Dữ liệu thật** từ YouTube Data API v3: Thịnh hành theo quốc gia & thể loại, Tìm kiếm (gõ hoặc **giọng nói**), Kênh đăng ký (video mới nhất), Video đã thích, Playlist cá nhân.
- Đăng nhập Google (OAuth 2.0, quyền chỉ đọc `youtube.readonly`) – chạy hoàn toàn trên trình duyệt.
- Tự thích ứng nhiều tỉ lệ màn hình: **4:3, 16:9, 21:9** và cả màn dọc; màn 21:9 hiện danh sách phát cạnh video.
- Hỗ trợ phím media / Media Session (nút trên vô lăng, tai nghe Bluetooth), có thể cài như PWA.

## Cấu trúc

```
index.html            Giao diện chính
css/style.css         Giao diện tối, responsive theo tỉ lệ màn hình
js/config.js          Cấu hình mặc định (Client ID, API key, vùng, ngôn ngữ…)
js/util.js            Tiện ích (định dạng thời gian, lưu cài đặt…)
js/auth.js            Đăng nhập Google (Google Identity Services)
js/api.js             Gọi YouTube Data API v3
js/player.js          Trình phát IFrame + hàng đợi + điều khiển
js/app.js             Màn hình: Thịnh hành, Đăng ký, Tìm kiếm, Thư viện, Cài đặt
manifest.webmanifest  PWA
```

## Chạy thử

YouTube IFrame API và Google Sign-In **không chạy từ `file://`**, cần một web server (tĩnh) bất kỳ:

```bash
# Python
python3 -m http.server 8080
# hoặc Node
npx serve .
# hoặc PHP
php -S 0.0.0.0:8080
```

Mở `http://localhost:8080` (hoặc IP máy trong LAN từ đầu xe). Với tên miền thật nên dùng HTTPS.

## Triển khai lên GitHub Pages

Repo đã có workflow `.github/workflows/pages.yml`. Để có link công khai:

1. Repo phải **public** (GitHub Pages với repo private cần gói GitHub Pro/Team).
2. Vào **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Chạy lại workflow (Actions → Deploy to GitHub Pages → Run workflow) hoặc push một commit mới.
4. Link sẽ là `https://<user>.github.io/<repo>/`. Thêm link này vào *Authorized JavaScript origins* của OAuth Client ID.

Workflow gắn mã commit vào các file tài nguyên (`?v=abc1234`) và tạo `version.txt`; app kiểm tra file này khi mở
và tự tải lại nếu có bản mới, nên trình duyệt mobile không bị kẹt bản cũ. Trong Cài đặt có nút "Tải lại bản mới".

Khi chưa đăng nhập, app chạy ở **chế độ demo** với video mẫu để xem giao diện.
Nếu script YouTube IFrame API bị chặn, trình phát tự chuyển sang iframe nhúng thường.

## Đăng nhập Google

Client ID OAuth đã được cài sẵn trong `js/config.js` (giá trị này là công khai, được bảo vệ bằng danh sách
*Authorized JavaScript origins* trong Google Cloud Console). Người dùng chỉ cần bấm **Đăng nhập Google**;
không cần nhập API key. Chưa đăng nhập thì app chạy ở chế độ demo.

Nếu triển khai ở tên miền khác hoặc muốn dùng project Google Cloud riêng:

1. Vào <https://console.cloud.google.com>, tạo project, bật **YouTube Data API v3**.
2. **OAuth consent screen**: loại External, thêm scope `.../auth/youtube.readonly`, thêm email vào *Test users*
   (hoặc publish app nếu dùng lâu dài).
3. **Credentials → Create credentials → OAuth client ID → Web application**, thêm *Authorized JavaScript origins*
   đúng địa chỉ mở app (ví dụ `http://localhost:8080`, `https://yourdomain.com`) **và** *Authorized redirect URIs*
   đúng URL trang app (ví dụ `https://thaovd.github.io/youtube_webapp_carplay/`) để đăng nhập kiểu chuyển hướng
   hoạt động khi trình duyệt chặn popup (mobile, trình duyệt ô tô).
4. Dán Client ID vào `js/config.js`.
5. (Nâng cao, tuỳ chọn) `apiKey` trong `js/config.js` cho phép xem Xu hướng / Tìm kiếm thật khi chưa đăng nhập.

## Ghi chú kỹ thuật

- YouTube **không** cung cấp API cho feed "Đề xuất cho bạn" hay lịch sử xem, nên mục gợi ý cá nhân được xây từ
  **video mới nhất của các kênh bạn đăng ký**, video đã thích và playlist của bạn. Thịnh hành dùng chart `mostPopular` thật.
- Một số video chủ sở hữu chặn nhúng: app sẽ báo và tự chuyển video tiếp theo (có nút mở trên YouTube).
- Hạn mức API mặc định 10.000 đơn vị/ngày (tìm kiếm tốn 100 đơn vị/lần); app có cache ngắn hạn để tiết kiệm.
- Token OAuth chỉ lưu trong `sessionStorage` của phiên hiện tại; cài đặt lưu trong `localStorage`.

## Kích thước màn hình đã tính đến

| Tỉ lệ | Ví dụ độ phân giải | Bố cục |
|-------|--------------------|--------|
| 4:3   | 800×600, 1024×768  | Rail trái, lưới 2–3 cột, điều khiển gọn |
| 16:9  | 1280×720, 1920×1080, 1024×600 | Rail trái, lưới 3–4 cột |
| 21:9  | 1920×720, 2560×1080 | Lưới nhiều cột, trình phát có danh sách phát bên phải |
| Dọc   | điện thoại          | Thanh điều hướng dưới đáy, video 16:9 trên, hàng đợi dưới |

Vui lòng tuân thủ [Điều khoản dịch vụ YouTube API](https://developers.google.com/youtube/terms/api-services-terms-of-service).
