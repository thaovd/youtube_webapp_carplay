#!/usr/bin/env bash
# Cài đặt máy chủ stream cho CarTube (Invidious + companion + Caddy) bằng một lệnh.
# Dùng:  DOMAIN=ddns.vuthao.id.vn ./install.sh
#        (tuỳ chọn) ALLOWED_REFERER='https://thaovd\.github\.io/'   -- regex, mặc định như vậy; đặt '.*' để mở
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${DOMAIN:-}"
if [ -z "$DOMAIN" ]; then read -rp "Tên miền trỏ về máy này (ví dụ ddns.vuthao.id.vn): " DOMAIN; fi
ALLOWED_REFERER="${ALLOWED_REFERER:-https://thaovd\\.github\\.io/}"

# 1) Docker
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Cài Docker..."
  curl -fsSL https://get.docker.com | sh
fi
# Không có quyền vào docker.sock (chưa thuộc nhóm docker) -> dùng sudo
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null || sudo -v; then DOCKER="sudo docker"; echo ">> Dùng sudo cho Docker (thêm quyền lâu dài: sudo usermod -aG docker \$USER rồi đăng nhập lại)"; fi
fi
if ! $DOCKER compose version >/dev/null 2>&1; then
  echo "!! Cần Docker Compose v2 (lệnh 'docker compose'). Cài theo https://docs.docker.com/compose/install/linux/"; exit 1
fi

# 2) Mã nguồn Invidious (chỉ để lấy file SQL khởi tạo DB)
if [ ! -d invidious ]; then
  echo ">> Tải file khởi tạo DB của Invidious..."
  git clone --depth 1 https://github.com/iv-org/invidious.git
fi

# 3) Khoá bí mật (giữ nguyên nếu đã có)
if [ ! -f .env ]; then
  gen() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
  cat > .env <<ENV
DOMAIN=$DOMAIN
ALLOWED_REFERER=$ALLOWED_REFERER
HMAC_KEY=$(gen 32)
COMPANION_KEY=$(gen 16)
ENV
  echo ">> Đã tạo .env"
else
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|; s|^ALLOWED_REFERER=.*|ALLOWED_REFERER=$ALLOWED_REFERER|" .env
fi

# 4) Chạy
echo ">> Khởi động..."
$DOCKER compose pull
$DOCKER compose up -d
echo
echo ">> Đang chờ Invidious sẵn sàng (có thể mất 1-2 phút lần đầu)..."
for i in $(seq 1 60); do
  if $DOCKER compose exec -T invidious wget -qO- http://127.0.0.1:3000/api/v1/stats >/dev/null 2>&1; then echo "   OK"; break; fi
  sleep 3
done
echo
echo "==> Kiểm tra từ máy khác:  https://$DOMAIN/api/v1/stats"
echo "==> Trong app: Cài đặt -> Trình phát: Stream -> Máy chủ: https://$DOMAIN"
echo "    Cập nhật sau này:  cd $(pwd) && $DOCKER compose pull && $DOCKER compose up -d"
