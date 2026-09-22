#!/usr/bin/env bash
# Деплой Uniqum Sport на Hetzner. Собирает фронт локально, рендерит backend.env,
# синхронизирует код на сервер и поднимает docker compose.
#
# Использование:  deploy/hetzner/deploy.sh
# Требует:        deploy/hetzner/secrets.env (см. secrets.env.example)
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

HOST="${HETZNER_HOST:-uniqumcrm@78.47.93.22}"
REMOTE_DIR="${REMOTE_DIR:-/home/uniqumcrm/uniqum}"
SECRETS_FILE="${SECRETS_FILE:-deploy/hetzner/secrets.env}"

[ -f "$SECRETS_FILE" ] || { echo "Нет $SECRETS_FILE (скопируй secrets.env.example)"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$SECRETS_FILE"; set +a

: "${FRONTEND_DOMAIN:=crm.uniqumsport.kg}"
: "${VITE_API_URL:=https://${FRONTEND_DOMAIN}}"
: "${SCHEDULER_ENABLED:=false}"   # true только когда Railway погашен (см. README)

echo "==> 1/4 Сборка фронта (VITE_API_URL=$VITE_API_URL)"
( cd frontend
  VITE_API_URL="$VITE_API_URL" \
  VITE_SUPABASE_URL="$SUPABASE_URL" \
  VITE_SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  VITE_SENTRY_DSN="${VITE_SENTRY_DSN:-}" \
  npm run build )

echo "==> 2/4 Рендер backend.env"
cat > deploy/hetzner/backend.env <<EOF
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
SCHEDULER_ENABLED=${SCHEDULER_ENABLED}
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
FRONTEND_ORIGINS=http://localhost:5173,https://${FRONTEND_DOMAIN}
SENTRY_DSN=${SENTRY_DSN:-}
MINIO_ENDPOINT=${MINIO_ENDPOINT}
MINIO_BUCKET=${MINIO_BUCKET}
MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
MINIO_REGION=${MINIO_REGION:-auto}
MINIO_PUBLIC_URL=${MINIO_PUBLIC_URL:-$MINIO_ENDPOINT}
HIK_INGEST_SECRET=${HIK_INGEST_SECRET:-}
EOF

echo "==> 2b/4 Рендер isup.env (ISUP-сервис турникетов)"
cat > deploy/hetzner/isup.env <<EOF
ISUP_DEVICE_IDS=${ISUP_DEVICE_IDS:-uniqum-t1}
ISUP_KEY=${ISUP_KEY:-}
ISUP_PUBLIC_IP=78.47.93.22
ISUP_PHOTO_BASE_URL=http://78.47.93.22:8090
ISUP_KEYS=${ISUP_KEYS:-}
CLOUD_INGEST_URL=http://backend:3001/v1/hik/events
HIK_INGEST_SECRET=${HIK_INGEST_SECRET:-}
EOF

echo "==> 3/4 Синхронизация на $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR/backend' '$REMOTE_DIR/frontend-dist'"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude backups --exclude scripts --exclude '.env' \
  backend/ "$HOST:$REMOTE_DIR/backend/"
rsync -az --delete frontend/dist/ "$HOST:$REMOTE_DIR/frontend-dist/"
rsync -az --delete --exclude target \
  isup-service/ "$HOST:$REMOTE_DIR/isup-service/"
rsync -az \
  deploy/hetzner/docker-compose.yml \
  deploy/hetzner/web.nginx.conf \
  deploy/hetzner/backend.env \
  deploy/hetzner/isup.env \
  "$HOST:$REMOTE_DIR/"

echo "==> 4/4 Сборка и запуск на сервере"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose up -d --build && sleep 4 && docker compose ps"

echo "==> Проверка бэкенда изнутри стека"
ssh "$HOST" "cd '$REMOTE_DIR' && docker compose exec -T web wget -qO- http://backend:3001/health && echo && docker compose exec -T web wget -qS -O /dev/null http://127.0.0.1/ 2>&1 | grep -m1 HTTP"
echo "Готово. Хостовый nginx для $FRONTEND_DOMAIN — отдельным шагом (см. README.md)."
