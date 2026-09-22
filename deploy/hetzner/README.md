# Деплой Uniqum Sport на Hetzner

Прод переезжает с Railway на Hetzner (**78.47.93.22**, Ubuntu 24.04, Docker).
Supabase (БД/Auth) и Tigris (файлы) — внешние, **не мигрируют**: бэкенд просто
получает те же env. Переезжают только **frontend** и **backend**.

Публичный URL: **https://78-47-93-22.sslip.io** (sslip.io резолвит имя в IP, DNS
заводить не нужно; Cloudflare не задействован).

## Архитектура

```
https://78-47-93-22.sslip.io
        │  :443 (Let's Encrypt)
        ▼
Хостовый nginx (root)  ──►  127.0.0.1:8081
                            │  контейнер web (nginx)
                            ├─ /            статика PWA (frontend-dist)
                            └─ /v1, /health ─► backend:3001 (Fastify)
                                                  │
                              Supabase Cloud + Tigris (S3) ◄──┘
```

Один origin на UI и API — без CORS. На том же сервере/хостовом nginx уже работает
**чужой прод** — `pay.uniqumsport.kg` (integrator). Его конфиг `integrator.conf`
**не трогаем**, добавлен только отдельный `uniqum-crm.conf`.

## Особенность сервера: у `uniqumcrm` НЕТ sudo

Аккаунт в группе `docker`, но не в sudoers. Всё, что требует root (хостовый nginx,
certbot), делается через docker-эскалацию (add-only, integrator не трогаем):

```bash
hroot() { docker run --rm --privileged --pid=host -v /:/host alpine:3.20 \
  nsenter -t 1 -m -u -n -i -- "$@"; }
# пример: hroot nginx -t && hroot systemctl reload nginx
```

## Что уже сделано

- `~/uniqum` на сервере: `docker compose` со службами `backend` (сборка из исходников)
  и `web` (nginx: статика + прокси). `web` слушает только `127.0.0.1:8081`.
- Хостовый nginx: `uniqum-crm.conf` (server_name 78-47-93-22.sslip.io → 127.0.0.1:8081),
  сертификат Let's Encrypt выписан (`certbot --nginx`), авто-renew включён.
- Бэкенд поднят c `SCHEDULER_ENABLED=false` — фоновые задачи (refresh_lifecycle,
  pt_send_reminders) пока крутит Railway, чтобы клиентам не уходили дубли.

Итог: **новый прод полностью живой и работает параллельно с Railway** (общая БД).

## Повторный деплой (после изменений кода)

```bash
# из корня репо; нужен deploy/hetzner/secrets.env (см. secrets.env.example)
deploy/hetzner/deploy.sh
```

Собирает фронт → rsync на сервер → `docker compose up -d --build` → health-check.
`web` раздаёт статику из смонтированного `frontend-dist`, поэтому новый бандл
подхватывается без рестарта.

## Финальный cutover (когда пользователям объявлен новый URL)

Планировщик должен работать РОВНО на одном инстансе. Порядок — сначала гасим
Railway-бэкенд, потом включаем планировщик на Hetzner (короткий разрыв не страшен,
задачи идемпотентны и почасовые):

```bash
# 1. остановить бэкенд Railway (через дашборд Railway: Remove/Stop сервиса backend)
#    frontend Railway можно оставить как холодный резерв или тоже погасить.

# 2. включить планировщик на Hetzner
ssh uniqumcrm@78.47.93.22
cd ~/uniqum
sed -i 's/^SCHEDULER_ENABLED=.*/SCHEDULER_ENABLED=true/' backend.env
docker compose up -d
docker compose logs --since=1m backend | grep -i schedul   # убедиться, что запустился
```

Supabase Auth: если используются магик-линки/сброс пароля — добавить
`https://78-47-93-22.sslip.io` в Authentication → URL Configuration.

## Откат

Railway держим как горячий резерв ~сутки. Откат = снова запустить Railway-бэкенд
и вернуть на него планировщик (`SCHEDULER_ENABLED=false` на Hetzner). Обе среды
работают с одной БД, так что переключение мгновенное.

## Полезное

```bash
ssh uniqumcrm@78.47.93.22
cd ~/uniqum
docker compose ps
docker compose logs -f backend
curl -s https://78-47-93-22.sslip.io/health
# правка хостового nginx (нет sudo):
hroot() { docker run --rm --privileged --pid=host -v /:/host alpine:3.20 nsenter -t 1 -m -u -n -i -- "$@"; }
hroot nginx -t && hroot systemctl reload nginx
```

> Внимание: боевой vhost — `/etc/nginx/sites-available/uniqum-crm.conf` (его правил
> certbot, там блок :443). НЕ перезаписывать его из `~/uniqum/host-crm.conf` — там
> только стартовый :80-вариант без сертификата.
