# Máy chủ stream cho CarTube

Gồm **Invidious** (lấy luồng video/âm thanh, phụ đề, tìm kiếm, xu hướng từ YouTube, tự proxy luồng),
**Invidious companion** (xử lý chống bot của YouTube) và **Caddy nội bộ** (CORS + lọc Referer) nghe HTTP ở
cổng `STREAM_PORT` (mặc định 8090). TLS do reverse proxy sẵn có của bạn (nginx) đảm nhiệm.
App phát bằng thẻ `<video>` riêng nên không quảng cáo, chọn được độ phân giải, bù trễ tiếng chính xác,
không cần đăng nhập Google để phát.

## Yêu cầu
- Máy Linux có Docker (script tự cài nếu thiếu), 1 GB RAM trở lên.
- Tên miền trỏ về máy (DDNS được) và nginx (hoặc proxy khác) đã có HTTPS, proxy về `http://127.0.0.1:8090`
  (mẫu: `nginx.example.conf`). App chạy trên HTTPS nên máy chủ stream bắt buộc phải là HTTPS.
- Băng thông: luồng video đi qua máy chủ, ~1–3 GB/giờ xem tuỳ chất lượng.

## Cài đặt
```bash
git clone https://github.com/thaovd/youtube_webapp_carplay.git
cd youtube_webapp_carplay/server
DOMAIN=ddns.vuthao.id.vn ./install.sh
```
Rồi thêm server block nginx theo `nginx.example.conf` (đổi tên miền, đường dẫn chứng chỉ), `sudo nginx -t && sudo systemctl reload nginx`.
Kiểm tra: `curl http://127.0.0.1:8090/api/v1/stats` trên máy, rồi mở `https://<tên miền>/api/v1/stats` từ điện thoại thấy JSON là xong.
Trong app: **Cài đặt → Trình phát → Stream (máy chủ riêng)** → nhập `https://<tên miền>` → Lưu.

## Bảo vệ
Caddy chỉ nhận yêu cầu có `Origin`/`Referer` khớp `ALLOWED_REFERER` trong `.env`
(mặc định `https://thaovd\.github\.io/`). Đổi tên miền app thì sửa giá trị này rồi `docker compose up -d`.
Đặt `ALLOWED_REFERER=.*` nếu muốn mở cho mọi nguồn (không khuyến nghị).

## Vận hành
```bash
docker compose ps                 # trạng thái
docker compose logs -f invidious  # log
docker compose pull && docker compose up -d   # cập nhật (nên làm định kỳ, YouTube đổi API thường xuyên)
```
Nếu video không phát ("Sign in to confirm you're not a bot"): cập nhật image companion; máy ở nhà ít gặp hơn VPS.

Lưu ý: cách này vi phạm Điều khoản dịch vụ YouTube, chỉ nên dùng cá nhân.
