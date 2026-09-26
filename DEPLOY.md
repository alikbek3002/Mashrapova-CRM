# Production Deploy Guide — ERP «Академия Машрапова»

> Движок форкнут из Uniqum Sport ERP и адаптирован под Академию Машрапова.
> Имена репозиториев, проектов и бакетов ниже относятся к Машрапову.
> Бизнес-правила — [docs/ТЗ_Академия_Машрапова.md](docs/ТЗ_Академия_Машрапова.md),
> статус по разделам — [docs/План_адаптации_Машрапова.md](docs/План_адаптации_Машрапова.md).

## Архитектура прода

```
┌─────────────────────────────┐         ┌────────────────────────┐
│  https://*.vercel.app       │  HTTPS  │  https://*.railway.app │
│  Frontend (React + Vite)    │ ──────► │  Backend (Fastify)     │
│  - PWA installable          │         │  - Service role key    │
│  - VITE_API_URL → backend   │         │  - Idempotency + audit │
└─────────────────────────────┘         └───────────┬────────────┘
              │                                     │
              │  anon key                          │  service role key
              ▼                                     ▼
        ┌──────────────────────────────────────────────────┐
        │  Supabase Cloud (Sydney ap-southeast-2)          │
        │  - Postgres + RLS + Auth + Storage               │
        └──────────────────────────────────────────────────┘
```

---

## Шаг 1 — GitHub репозиторий

```bash
cd "<путь к репозиторию>"
git init
git add .
git commit -m "Initial import"
git branch -M main
# Репозиторий: https://github.com/alikbek3002/Mashrapova-CRM (private)
git remote add origin https://github.com/alikbek3002/Mashrapova-CRM.git
git push -u origin main
```

⚠️ Перед push проверь что `.env` не в коммите: `git status`. Должны быть **только**:
- `frontend/.env.example`
- `backend/.env.example`

Файлы `frontend/.env` и `backend/.env` блокируются `.gitignore`.

---

## Шаг 2 — Создать Supabase prod проект

Текущий `achvpwatdonjpqanzsgw` — это **dev**. Для прода создай **отдельный** проект:

1. https://app.supabase.com/projects → New project
2. Name: `mashrapova-prod`, Region: **Singapore** (`ap-southeast-1`) или **Frankfurt** (`eu-central-1`) — ближе к Бишкеку чем Sydney
3. Создай DB пароль и **сохрани в надёжном месте**
4. Дождись провижионинга (~2 мин)
5. Settings → API → скопируй:
   - Project URL → `SUPABASE_URL_PROD`
   - `anon` `public` → `SUPABASE_ANON_KEY_PROD`
   - `service_role` `secret` → `SUPABASE_SERVICE_ROLE_KEY_PROD`

### Применить миграции на prod

```bash
# Найди connection string: Project Settings → Database → Connection string → URI (Session pooler)
# Подставь свой пароль
export PROD_PG="host=aws-0-ap-southeast-1.pooler.supabase.com port=5432 user=postgres.<ref> dbname=postgres sslmode=require"
export PGPASSWORD='<твой_DB_пароль>'

cd "<путь к репозиторию>/supabase"
for f in migrations/*.sql; do
  echo "=== $f ==="
  psql "$PROD_PG" -v ON_ERROR_STOP=1 -f "$f"
done
```

### Создать первого admin-юзера на prod

Не используй seed-test-users.mjs (он создаст тестовые аккаунты, которые не нужны на проде). Вместо этого:

```bash
cd backend
# Положи временно SERVICE_ROLE_KEY от prod в env
SUPABASE_URL="<prod url>" SUPABASE_SERVICE_ROLE_KEY="<prod service key>" node -e '
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  // 1. Создать организацию
  const { data: org } = await sb.from("organizations").insert({
    name: "Академия Машрапова",
    timezone: "Asia/Bishkek"
  }).select().single();
  // 2. Создать admin auth-юзера
  const { data: u } = await sb.auth.admin.createUser({
    email: "<реальный email директора>",
    password: "<надёжный пароль>",
    email_confirm: true
  });
  // 3. Profile
  await sb.from("profiles").insert({
    id: u.user.id, organization_id: org.id, role: "admin",
    full_name: "<ФИО директора>", email: u.user.email, is_active: true
  });
  console.log("OK admin created. Login:", u.user.email);
})();
'
```

---

## Шаг 3 — Railway (бэкенд)

1. https://railway.com → New Project → Deploy from GitHub repo
2. Выбери репо `Mashrapova-CRM`, root directory = `/backend`
3. Settings → Networking → Generate Domain (получишь `https://mashrapova-crm-production.up.railway.app`)
4. Settings → Healthcheck → Path `/health`
5. **Variables** (Settings → Variables):
   ```
   SUPABASE_URL=<prod url>
   SUPABASE_SERVICE_ROLE_KEY=<prod service key>
   SUPABASE_ANON_KEY=<prod anon key>
   FRONTEND_ORIGINS=https://mashrapova-crm.vercel.app
   PORT=8080
   NODE_ENV=production
   LOG_LEVEL=info
   SENTRY_DSN=<пока пусто, добавишь после Sentry setup>
   ```
6. Deploy → дождись green tick → проверь `https://<railway-url>/health` → должен вернуть `{"status":"ok","supabase":"connected"}`

---

## Шаг 4 — Vercel (фронт)

1. https://vercel.com/new → импорт `Mashrapova-CRM`
2. Framework: Vite, Root: `frontend`
3. **Environment Variables**:
   ```
   VITE_SUPABASE_URL=<prod url>
   VITE_SUPABASE_ANON_KEY=<prod anon key>
   VITE_API_URL=https://mashrapova-crm-production.up.railway.app
   VITE_SENTRY_DSN=<позже>
   ```
4. Deploy → дождись green → URL `https://mashrapova-crm.vercel.app`
5. После первого деплоя обнови `FRONTEND_ORIGINS` на Railway, добавив `https://*-mashrapova-crm-<account>.vercel.app` для preview-деплоев.

---

## Шаг 5 — Sentry (опционально, рекомендуется)

1. https://sentry.io/signup → free tier (5k events/мес)
2. Create org → 2 проекта:
   - `mashrapova-frontend` (platform: React)
   - `mashrapova-backend` (platform: Node.js)
3. Скопируй DSN из каждого
4. Обнови env vars на Vercel (`VITE_SENTRY_DSN`) и Railway (`SENTRY_DSN`)
5. Redeploy оба сервиса (push в main или Settings → Redeploy)

---

## Шаг 6 — GitHub Actions secrets (для backup)

Settings → Secrets and variables → Actions → New repository secret:

| Name | Value |
|---|---|
| `SUPABASE_DB_HOST` | `aws-0-<region>.pooler.supabase.com` (из Connection string) |
| `SUPABASE_DB_USER` | `postgres.<your-ref>` |
| `SUPABASE_DB_PASSWORD` | DB пароль prod-проекта |
| `B2_KEY_ID` | Backblaze App Key ID |
| `B2_APP_KEY` | Backblaze App Key (создай в B2: bucket `mashrapova-backups`, key с правами read/write на этот bucket) |
| `B2_BUCKET` | `mashrapova-backups` |

После добавления → запусти вручную: Actions → "Nightly Supabase backup" → Run workflow → проверь что файл появился в B2 bucket.

---

## Шаг 7 — Smoke test на проде

После деплоя залогинься admin-аккаунтом и проверь:

1. ✅ Открывается https://mashrapova-crm.vercel.app, экран логина
2. ✅ Логин email/пароль → попадаешь на дашборд
3. ✅ Создание секции работает (Settings → Секции → Новая)
4. ✅ Создание тренера через UI работает (Coaches → Добавить тренера) — проверь что присылается email юзеру (Supabase Auth настроен на confirm)
5. ✅ Создание группы → авто-генерация расписания на 8 недель (Schedule → выбор группы из dropdown)
6. ✅ Создание ребёнка + продажа карты второму ребёнку семьи → авто-скидка 500 сом (ТЗ §3.3)
7. ✅ Логин тренером (тестового либо реального) на телефоне → отметка посещения
8. ✅ Логин родителем → видит ребёнка, баланс, заметки, кнопка WhatsApp
9. ✅ В Chrome на телефоне → «Добавить на главный экран» → запускается standalone
10. ✅ Backend `/v1/cards/sell` через UI пишет в `audit_log` запись

---

## Шаг 8 — Передача заказчику

1. Loom-видео 5 минут с прохождением 10 пунктов smoke test
2. PDF-инструкция «Как добавить тренера / семью / продать карту» (1 страница)
3. URL прод-фронта + первичные admin-креды (передать через надёжный канал, не email)
4. Контакт для багов: ссылка на GitHub issues (private repo)

---

## Откат / Rollback

- **Frontend**: Vercel → Deployments → Rollback к предыдущему успешному
- **Backend**: Railway → Deployments → Promote previous
- **DB**: восстановить из nightly B2 backup:
  ```bash
  # Скачать
  aws --endpoint-url=https://s3.us-west-002.backblazeb2.com s3 cp s3://mashrapova-backups/mashrapova-prod-2026-05-06.sql.gz .
  # Применить
  gunzip mashrapova-prod-2026-05-06.sql.gz
  PGPASSWORD=<prod_pwd> psql "$PROD_PG" -f mashrapova-prod-2026-05-06.sql
  ```

---

## Что работает

Актуальный статус по разделам ТЗ ведётся в [docs/План_адаптации_Машрапова.md](docs/План_адаптации_Машрапова.md)
— здесь только крупными мазками.

✅ Вход по телефону/email с паролем, 7 ролей (§2.1), матрица прав (§2.2) и 2FA (TOTP) для директора
   и управляющего (§12.3)
✅ Секции с ценами, группы с расписанием и авто-генерацией занятий, лимит группы с ручным
   превышением (§5)
✅ Семьи и ученики, источник клиента, ответственный менеджер, посещения по каждому абонементу (§3)
✅ Продажа абонементов: скидка 2-му ребёнку, бонус «Приведи друга», обязательная причина ручной
   скидки, цены по секциям (§3.3, §4.1, §5.1)
✅ Приём платежей наличными / терминалом с идемпотентностью, депозит ученика, должники (§7.2)
✅ Возврат с удержанием 30% и без него для старшего менеджера, с пределом «не больше уплаченного» (§7.3)
✅ Отмена занятия с причиной и виной; форс-мажор → +1 занятие ученикам, уведомление всем родителям
   группы (§4.4, §5.3)
✅ Заморозка менеджером и тренером, лимит по типу абонемента, продление срока (§4.3)
✅ Контроль срока абонемента: 7/3/0 дней, win-back, риск оттока, закрытие по последней тренировке (§4.5)
✅ Зарплаты тренеров: 40% выручки занятия, оклад, аванс 20-го, утверждение управляющим (§6, §10)
✅ Воронка лидов с нормативами SLA и KPI менеджеров — все шесть метрик (§7.4, §8)
✅ Дашборд директора и отчёты по продажам, посещаемости и зарплатам с выгрузкой CSV (§11)
✅ Уведомления: матрица каналов, шаблоны, очередь исходящих, массовая рассылка по фильтрам (§9)
✅ Офлайн: просмотр, отметка посещаемости и продажа за наличные с синхронизацией (§12.4)
✅ Журнал посещений тренером, заметки о прогрессе, приложение родителя, audit log, PWA-установка

## Ещё не сделано

❌ Реальная отправка SMS клиенту (§9, §13) — нет договора с провайдером, открытый вопрос 1.
   Всё остальное готово: `SMS_PROVIDER=smskg` плюс четыре переменные в `backend/.env.example`
❌ WhatsApp (§13) — не выбрано, официальный Business API или обходной путь, открытый вопрос 2
❌ Настоящий Web Push при закрытом приложении — нужны service worker, VAPID, подписки.
   Уведомление внутри приложения родителя работает
❌ Мультифилиальность (§12.2) — по ТЗ не срочно, филиал один
❌ AmoCRM и онлайн-оплата MBank (§13) — версия 2.0
❌ Свой домен — добавится по DNS-config, когда Академия определится

Пропускной системы, турникетов и Face ID в продукте нет и не планируется: в ТЗ Академии их нет ни в
§13, ни в плане версий §15. Код проходной удалён миграцией `20260924000001_drop_access_control.sql`.
