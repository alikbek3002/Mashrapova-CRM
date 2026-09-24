# Академия Машрапова — Backend (Fastify + TS)

Тонкий API на Railway. Закрывает финансовые и деструктивные операции, которые нельзя безопасно выполнить через RLS из фронта.

## Запуск локально

```bash
cd backend
cp .env.example .env
# заполнить .env реальными ключами Supabase dev-проекта
npm install
npm run dev
```

API поднимается на `http://localhost:3001`.

## Эндпоинты

| Метод | Путь | Кто |
|---|---|---|
| GET | `/health` | публичный (для Railway healthcheck) |
| POST | `/v1/cards/sell` | admin, manager, cashier |
| POST | `/v1/payments` | admin, manager, cashier |
| POST | `/v1/freezes` | coach, manager, admin |
| POST | `/v1/freezes/:id/approve` | manager, admin |
| POST | `/v1/freezes/:id/reject` | manager, admin |
| POST | `/v1/lessons/:id/cancel` | manager, admin |
| GET | `/v1/notifications` | любой авторизованный |
| POST | `/v1/notifications/:id/read` | владелец |

Все мутации **обязательно** требуют JWT в `Authorization: Bearer <token>` и `Idempotency-Key: <uuid>` (для платежей и продажи карт).

## Безопасность

- `SUPABASE_SERVICE_ROLE_KEY` — только в env Railway, никогда в репо.
- CORS — whitelist из `FRONTEND_ORIGINS` (CSV).
- helmet — security headers; rate-limit — 100 req/min на IP.
- Все запросы валидируются через `zod`.
- Идемпотентность: ключи хранятся в `idempotency_keys` 24 часа.

## Деплой на Railway

1. Создать сервис из этого подкаталога.
2. Установить переменные окружения из `.env.example`.
3. `nixpacks.toml` управляет билдом и стартом.
4. Healthcheck path: `/health`.
