# Máy chủ stream cho CarTube

Gồm **Invidious** (lấy luồng video/âm thanh, phụ đề, tìm kiếm, xu hướng từ YouTube, tự proxy luồng),
**Invidious companion** (xử lý chống bot của YouTube) và **Caddy** (HTTPS tự động + CORS).
App phát bằng thẻ `<video>` riêng nên không quảng cáo, chọn được độ phân giải, bù trễ tiếng chính xác,
không cần đăng nhập Google để phát.

## Yêu cầu
- Máy Linux có Docker (script tự cài nếu thiếu), 1 GB RAM trở lên.
- Tên miền trỏ về máy (DDNS được) và **cổng 80, 443 mở từ Internet** (Let's Encrypt cần cổng 80 để cấp chứng chỉ).
  Nếu máy ở nhà sau router: mở port-forward 80 và 443 về máy.
- Băng thông: luồng video đi qua máy chủ, ~1–3 GB/giờ xem tuỳ chất lượng.

## Cài đặt
```bash
git clone https://github.com/thaovd/youtube_webapp_carplay.git
cd youtube_webapp_carplay/server
DOMAIN=ddns.vuthao.id.vn ./install.sh
```
Kiểm tra: mở `https://<tên miền>/api/v1/stats` thấy JSON là xong.
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
