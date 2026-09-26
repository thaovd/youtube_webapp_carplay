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

## Dùng Nginx Proxy Manager ở máy khác (VPS)

1. Trên máy stream: `STREAM_BIND=0.0.0.0 DOMAIN=<tên miền app> ./install.sh`, mở cổng 8090 trên firewall
   (`sudo ufw allow 8090/tcp`) và port-forward 8090 trên router về máy này.
2. DNS: tên miền app (ví dụ `yt.vuthao.id.vn`) trỏ về IP của VPS chạy NPM.
3. NPM → Proxy Hosts → Add:
   - Domain: `yt.vuthao.id.vn`; Scheme `http`; Forward Host: tên DDNS/IP của máy stream; Port `8090`.
   - Bật Websockets Support; **tắt** Block Common Exploits và Cache Assets (dễ chặn nhầm URL luồng video).
   - SSL: Request a new certificate (Let's Encrypt), Force SSL, HTTP/2.
   - Advanced → Custom Nginx Configuration:
     ```
     proxy_buffering off;
     proxy_request_buffering off;
     proxy_read_timeout 300s;
     client_max_body_size 0;
     proxy_set_header Range $http_range;
     proxy_set_header If-Range $http_if_range;
     ```
4. Kiểm tra `https://yt.vuthao.id.vn/api/v1/stats`, rồi nhập địa chỉ này vào app.

## Phục vụ app tại https://vuth.vn/yt/

Caddy trong cụm phục vụ luôn mã nguồn app (thư mục repo mount vào container) tại đường `/yt/`.
Cập nhật app trên laptop chỉ cần `git pull` trong thư mục repo.

1. Trên laptop: `git pull` rồi `sudo docker compose up -d` (Caddy nhận cấu hình mới). Kiểm tra `curl -I http://127.0.0.1:8090/yt/`.
2. NPM: Proxy Host `vuth.vn` (tạo mới hoặc mở host sẵn có) → tab **Custom locations** → Add:
   - location: `/yt/` ; Scheme `http` ; Forward Host: `ddns.vuthao.id.vn` ; Port `8090`
   - (bánh răng của location) Custom config:
     ```
     proxy_set_header X-Forwarded-Proto https;
     ```
   Với host này cũng bật SSL (Let's Encrypt), Force SSL.
3. Google Cloud Console → OAuth client: thêm **Authorized JavaScript origins** `https://vuth.vn`
   và **Authorized redirect URIs** `https://vuth.vn/yt/` (để đăng nhập Google hoạt động ở tên miền mới).
4. Mở `https://vuth.vn/yt/`. Bộ lọc Referer của máy chủ đã chấp nhận `vuth.vn` (mặc định mới của `install.sh`;
   nếu `.env` cũ, chạy lại `./install.sh` để cập nhật `ALLOWED_REFERER`).

Lưu ý: bản phục vụ từ Caddy không có mã bản dựng (không tự kiểm tra cập nhật) nhưng Caddy gửi `Cache-Control: no-cache`
nên trình duyệt luôn hỏi lại máy chủ, `git pull` xong là thấy bản mới.

## Bảo vệ
Caddy chỉ nhận yêu cầu có `Origin`/`Referer` khớp `ALLOWED_REFERER` trong `.env`
(mặc định `https://thaovd\.github\.io(/|$)`). Đổi tên miền app thì sửa giá trị này rồi `docker compose up -d`.
Đặt `ALLOWED_REFERER=.*` nếu muốn mở cho mọi nguồn (không khuyến nghị).

## Tự cập nhật

Container `watchtower` trong compose kiểm tra image mới mỗi đêm 04:00 (giờ Việt Nam) cho invidious, companion và
caddy, tự kéo về, khởi động lại và dọn image cũ. Postgres không tự cập nhật. Kiểm tra: `docker compose logs watchtower`.
Muốn cập nhật ngay: `docker compose pull && docker compose up -d`.

## Vận hành
```bash
docker compose ps                 # trạng thái
docker compose logs -f invidious  # log
docker compose pull && docker compose up -d   # cập nhật (nên làm định kỳ, YouTube đổi API thường xuyên)
```
Nếu video không phát ("Sign in to confirm you're not a bot"): cập nhật image companion; máy ở nhà ít gặp hơn VPS.

Lưu ý: cách này vi phạm Điều khoản dịch vụ YouTube, chỉ nên dùng cá nhân.
