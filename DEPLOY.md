# Production Deploy Guide — ERP «Академия Машрапова»

> Движок форкнут из Uniqum Sport ERP и адаптирован под Академию Машрапова.
> Бизнес-правила — [docs/ТЗ_Академия_Машрапова.md](docs/ТЗ_Академия_Машрапова.md),
> статус по разделам — [docs/План_адаптации_Машрапова.md](docs/План_адаптации_Машрапова.md).

## Архитектура прода

Фронтенд и бэкенд — два сервиса в одном проекте Railway, данные и вход — в Supabase.

```
┌─────────────── Railway · проект mashrapova-crm ───────────────┐
│                                                               │
│  frontend (статический SPA)        backend (Fastify)          │
│  frontend-production-3a9f     ──►  backend-production-5907c   │
│  .up.railway.app                   .up.railway.app            │
│  - PWA                             - service role key         │
│  - VITE_API_URL → backend          - идемпотентность, аудит   │
│                                    - планировщик (lifecycle)  │
└───────────┬───────────────────────────────────┬───────────────┘
            │ publishable (anon) key            │ service role key
            ▼                                   ▼
      ┌──────────────────────────────────────────────────┐
      │  Supabase Cloud — Postgres + RLS + Auth + Storage │
      └──────────────────────────────────────────────────┘
```

Фронтенд читает данные из Supabase напрямую под RLS, а в бэкенд ходит только за тем, чему
нельзя доверять клиенту: деньги, возвраты, зарплаты, сотрудники, рассылки (см. `CLAUDE.md`).

## Где что живёт

Railway: команда «mrevieweroff's Projects», проект `mashrapova-crm`, окружение `production`.

| Сервис | Адрес | Корневая папка | Сборка | Запуск |
|---|---|---|---|---|
| frontend | https://frontend-production-3a9f.up.railway.app | `/frontend` | Railpack: зависимости + `npm run build` | `npx --yes serve@14 -s dist -l $PORT` |
| backend | https://backend-production-5907c.up.railway.app | `/backend` | `backend/Dockerfile` (`node:22-alpine`) | `node dist/server.js`, healthcheck `/health` |

- `serve -s` отдаёт `index.html` на любой путь — без этого прямые ссылки вглубь SPA давали бы 404.
- `HEALTHCHECK` внутри `backend/Dockerfile` смотрит на порт 3001, а Railway поднимает сервис на
  своём `PORT`. Railway эту инструкцию не выполняет и проверяет здоровье сам по `/health`.
- `vercel.json` в корне — остаток прежней схемы с фронтендом на Vercel. Railway его не читает.

## Как выкатывается

**Push в `main` деплоит сам.** Оба сервиса подключены к `alikbek3002/Mashrapova-CRM`, ветка
`main`. У каждого свой `watchPatterns` (`/backend/**`, `/frontend/**`), поэтому пересобирается
только тот сервис, чья папка изменилась.

Изменения в `supabase/` и `docs/` ничего не деплоят: **миграции на боевую базу применяются
руками** (см. ниже).

Перед push:

```bash
cd frontend && npm run build          # tsc -b + сборка
cd backend  && npm run typecheck && npm run build
cd supabase/test && npm run migrate && npm run smoke   # если трогали миграции или деньги
```

Работа с проектом из терминала (один раз `railway link` и выбрать `mashrapova-crm`):

```bash
railway logs --service backend               # логи работы
railway logs --service frontend --build      # лог сборки
railway deployment list --service backend    # история деплоев
railway redeploy --service frontend -y       # пересобрать, например после смены VITE_*
```

## Переменные окружения

Секреты задавай через stdin, а не аргументом: так значение не попадёт в историю shell.

```bash
printf '%s' "$VALUE" | railway variable set SUPABASE_SERVICE_ROLE_KEY --stdin --service backend
```

### backend

| Переменная | Значение |
|---|---|
| `SUPABASE_URL` | URL проекта Supabase |
| `SUPABASE_ANON_KEY` | publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key — **только здесь, никогда во фронтенде** |
| `FRONTEND_ORIGINS` | `https://frontend-production-3a9f.up.railway.app`. Через запятую; каждая запись — точный origin или glob со `*` |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `SCHEDULER_ENABLED` | `true` — **только на этом инстансе**, см. «Планировщик» |
| `SMS_PROVIDER` | `noop`, пока нет договора с провайдером (`smskg` + `SMS_*` из `backend/.env.example`) |
| `KOMMO_BASE_URL`, `KOMMO_TOKEN` | Kommo CRM, см. «Kommo». Без них синхронизация выключена |
| `KOMMO_WEBHOOK_SECRET` | необязательная: секрет в адресе вебхука Kommo, от 16 символов |
| `SENTRY_DSN`, `MINIO_*` | необязательные |

`PORT` не задавай: Railway назначает его сам.

### frontend

| Переменная | Значение |
|---|---|
| `VITE_SUPABASE_URL` | URL проекта Supabase |
| `VITE_SUPABASE_ANON_KEY` | publishable / anon key |
| `VITE_API_URL` | `https://backend-production-5907c.up.railway.app` |
| `VITE_SENTRY_DSN` | необязательная |

- `VITE_*` вшиваются в бандл при сборке. После изменения нужен `railway redeploy --service frontend`,
  перезапуска мало.
- ⚠️ **`VITE_DEMO_AUTH` на проде не задавать никогда.** Флаг включает вход по роли без пароля —
  на боевой базе это доступ к данным клуба без авторизации.

## Планировщик

Бэкенд раз в интервал вызывает `refresh_lifecycle`, напоминания ПТ и продление расписания
(`ensureLessonHorizon`). **Он должен работать ровно на одном инстансе:** второй разошлёт клиентам
дубли. Поэтому `SCHEDULER_ENABLED=true` стоит только на Railway, а локальный бэкенд и любая другая
копия, которая смотрит в боевую базу, запускаются с `SCHEDULER_ENABLED=false`.

Если увеличиваешь число реплик бэкенда в Railway — планировщик надо вынести, иначе реплики
продублируют друг друга.

## Kommo

Сделки, переписка и этапы живут в Kommo (`https://managermmaosh.kommo.com`), ERP забирает их
раз в `KOMMO_SYNC_INTERVAL_MIN` минут (по умолчанию 5): сделки и «Неразобранное», изменённые
с прошлого прогона, события (смены этапов, время сообщений — без текста) и поля ученика из
контакта. Синхронизация односторонняя: в Kommo ERP ничего не пишет. Работает в том же
планировщике, поэтому тоже только на инстансе с `SCHEDULER_ENABLED=true`.

Включить:

1. Накатить `20261001000001_kommo_integration.sql` (см. «Миграции»).
2. Задать `KOMMO_BASE_URL` и `KOMMO_TOKEN` (токен — из приватной интеграции «ERP Машрапова»,
   Kommo → Настройки → Интеграции). Через минуту после старта бэкенд загрузит всю историю —
   около 5 минут: 2 тыс. сделок и 18 тыс. событий, Kommo медленно отдаёт события. Сделки
   старше часа загружаются как история: уведомлений SLA по ним нет.
3. Проверить: Отчёты → вкладка Kommo, строка «Синхронизировано».
4. Необязательно — вебхук (нужен тариф Advanced или выше): задать `KOMMO_WEBHOOK_SECRET`, в Kommo
   Настройки → Интеграции → Web hooks указать
   `https://backend-production-5907c.up.railway.app/v1/webhooks/kommo/<секрет>` и события сделок
   и контактов. Вебхук только запускает синхронизацию раньше срока, без него всё работает.

Этапы Kommo сопоставлены с этапами ERP в таблице `kommo_statuses` (колонка `stage`). Новый этап
в Kommo появится там сам со значением по названию; поправленное вручную синхронизация не
перетирает. Менеджер берётся из тега сделки («Марлен», «Уулкан») по совпадению с именем в
профиле сотрудника; если имя не уникально — прописать тег в `profiles.kommo_tag`.

Токен истекает 30.11.2027 (виден в Kommo → интеграция → «Ключи и доступы»). После выпуска
нового — заменить `KOMMO_TOKEN`.

## Supabase

### Миграции

Railway их не применяет. Новые файлы из `supabase/migrations/` накатывай по одному, по порядку —
через SQL Editor в панели Supabase или `psql`:

```bash
# Project Settings → Database → Connection string → URI (Session pooler)
psql "<connection string>" -v ON_ERROR_STOP=1 -f supabase/migrations/<новая_миграция>.sql
```

Сначала прогони её на стенде (`supabase/test`, `npm run migrate && npm run smoke`). Одна версия —
один файл: две миграции с одинаковым номером Supabase не примет.

На проде **намеренно не применена** `20260926000017_mfa_optional.sql` (решение владельца,
28.09.2026) — см. «Двухфакторный вход».

### Auth

- **Вход по телефону.** Логин — псевдо-email `996XXXXXXXXX@staff.mashrapov.local`
  (`backend/src/lib/phone.ts`, `frontend/src/shared/auth/normalizePhone.ts`). Регистрации нет:
  новых сотрудников заводит директор в разделе «Сотрудники».
- **URL Configuration** (Authentication → URL Configuration): Site URL и Redirect URLs должны
  указывать на `https://frontend-production-3a9f.up.railway.app`, иначе письма «Забыли пароль?»
  поведут не туда. Вход по паролю от этого не зависит.

### Двухфакторный вход (ТЗ §12.3)

`profiles.mfa_required` выставляет триггер `sync_mfa_required` по роли — директору и
управляющему `true`. Срабатывает он **только при создании профиля или смене роли**.

На проде требование снято вручную (`mfa_required = false`) с демо-учёток директора и
управляющего. Оно вернётся, если им поменять роль, и будет стоять у каждого нового директора или
управляющего. Сделать 2FA настройкой клуба, а не правилом роли, — это миграция
`20260926000017_mfa_optional.sql`.

## Учётки на проде

Для показа клиенту заведено по учётке на каждую роль:

| Роль | Телефон |
|---|---|
| Директор | +996 700 000 000 |
| Тренер | +996 700 000 001 |
| Родитель | +996 700 000 002 |
| Старший менеджер | +996 700 000 003 |
| Менеджер | +996 700 000 004 |
| Управляющий | +996 700 000 005 |
| Ресепшен | +996 700 000 006 |

Пароль общий, он у владельца и в репозитории не хранится. **После показа смени его.**

Если директора в базе нет вовсе — завести его можно только сервисным ключом:

```bash
cd backend
SUPABASE_URL="<url>" SUPABASE_SERVICE_ROLE_KEY="<service key>" node -e '
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const phone = "+996XXXXXXXXX";
  const { data, error } = await sb.auth.admin.createUser({
    email: `${phone.slice(1)}@staff.mashrapov.local`,
    password: "<надёжный пароль>",
    email_confirm: true,
  });
  if (error) throw error;
  const { error: pErr } = await sb.from("profiles").insert({
    id: data.user.id, organization_id: "00000000-0000-0000-0000-000000000001",
    role: "director", full_name: "<ФИО>", email: data.user.email, phone, is_active: true,
  });
  if (pErr) throw pErr;
  console.log("OK, вход по телефону", phone);
})();
'
```

`backend/scripts/seed-test-users.mjs` на проде **не запускать**: кроме учёток он создаёт тестовых
детей, группу, абонемент и платёж.

## Развернуть с нуля

Так проект поднимался 28.09.2026. Понадобится, если проект Railway потерян или переезжает.

```bash
railway login
railway init -n mashrapova-crm -w "<команда Railway>"
railway add --service backend
railway add --service frontend
railway service list                       # ID сервисов
railway status --json                      # ID окружения production
```

Настройки сервисов задаются через API: в CLI 5.52 `railway environment edit --service-config`
отвечает «No changes to apply» и ничего не сохраняет.

```bash
Q='mutation($s:String!,$e:String,$i:ServiceInstanceUpdateInput!){serviceInstanceUpdate(serviceId:$s,environmentId:$e,input:$i)}'
railway api "$Q" --raw-var s=<backend-id> --raw-var e=<env-id> \
  --var 'i={"rootDirectory":"/backend","healthcheckPath":"/health","watchPatterns":["/backend/**"]}'
railway api "$Q" --raw-var s=<frontend-id> --raw-var e=<env-id> \
  --var 'i={"rootDirectory":"/frontend","startCommand":"npx --yes serve@14 -s dist -l $PORT","watchPatterns":["/frontend/**"]}'
railway environment config                 # проверить, что настройки на месте
```

Дальше:

1. `railway domain --service backend` и `railway domain --service frontend` — публичные адреса.
2. Переменные обоих сервисов (таблицы выше) с флагом `--skip-deploys`. `FRONTEND_ORIGINS` и
   `VITE_API_URL` — это адреса из шага 1.
3. Подключить репозиторий — это и запустит первую сборку:
   ```bash
   railway service source connect --repo alikbek3002/Mashrapova-CRM --branch main --service backend
   railway service source connect --repo alikbek3002/Mashrapova-CRM --branch main --service frontend
   ```
4. Проверить: `/health` бэкенда отвечает `{"status":"ok","supabase":"connected"}`, фронтенд
   открывает экран входа, а CORS бэкенда пускает адрес фронтенда и не пускает чужие.

## Sentry (опционально)

1. https://sentry.io → free tier, два проекта: `mashrapova-frontend` (React) и `mashrapova-backend` (Node.js).
2. `SENTRY_DSN` — в сервис backend, `VITE_SENTRY_DSN` — в сервис frontend.
3. Frontend пересобрать (`railway redeploy --service frontend`), backend подхватит после перезапуска.

## Бэкапы

`.github/workflows/backup.yml` — ночной дамп базы в Backblaze B2. Нужны секреты репозитория
(Settings → Secrets and variables → Actions):

| Name | Value |
|---|---|
| `SUPABASE_DB_HOST` | `aws-0-<region>.pooler.supabase.com` (из Connection string) |
| `SUPABASE_DB_USER` | `postgres.<project-ref>` |
| `SUPABASE_DB_PASSWORD` | пароль базы |
| `B2_KEY_ID` | Backblaze App Key ID |
| `B2_APP_KEY` | Backblaze App Key (bucket `mashrapova-backups`, права read/write на него) |
| `B2_BUCKET` | `mashrapova-backups` |

После добавления: Actions → «Nightly Supabase backup» → Run workflow → убедиться, что файл
появился в bucket.

## Smoke test на проде

1. ✅ Открывается https://frontend-production-3a9f.up.railway.app, экран входа, демо-аккаунтов на нём нет
2. ✅ Вход по телефону и паролю → дашборд
3. ✅ Создание секции (Настройки → Секции → Новая)
4. ✅ Создание тренера через «Сотрудники»
5. ✅ Создание группы → расписание на 8 недель
6. ✅ Ребёнок + продажа карты второму ребёнку семьи → авто-скидка 500 сом (ТЗ §3.3)
7. ✅ Вход тренером с телефона → отметка посещения
8. ✅ Вход родителем → ребёнок, баланс, заметки, кнопка WhatsApp
9. ✅ Chrome на телефоне → «Добавить на главный экран» → запускается standalone
10. ✅ Продажа карты через UI пишет запись в `audit_log`

## Откат

- **Сервис**: Railway → сервис → Deployments → у предыдущего успешного деплоя «Rollback».
  Либо `git revert` проблемного коммита и push в `main` — это выкатится само.
- **База**: восстановить из ночного бэкапа B2:
  ```bash
  aws --endpoint-url=https://s3.us-west-002.backblazeb2.com s3 cp s3://mashrapova-backups/<файл>.sql.gz .
  gunzip <файл>.sql.gz
  PGPASSWORD=<пароль> psql "<connection string>" -f <файл>.sql
  ```

## Передача заказчику

1. Loom-видео на 5 минут: прохождение smoke test
2. PDF-инструкция «Как добавить тренера / семью / продать карту» (1 страница)
3. Адрес фронтенда + учётки (через надёжный канал, не email), пароли сменить после показа
4. Контакт для багов: GitHub issues (private repo)

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
✅ Kommo CRM: сделки, «Неразобранное» и история событий синхронизируются каждые 5 минут,
   отчёт по скорости ответа, каналам, менеджерам и секциям (§13, см. «Kommo»)
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
❌ Онлайн-оплата MBank (§13) — версия 2.0. Обратная запись в Kommo (пробное, оплата) пока не
   сделана — синхронизация только Kommo → ERP
❌ Свой домен — подключается в Railway (сервис → Settings → Networking → Custom Domain), когда
   Академия определится; после этого обновить `FRONTEND_ORIGINS`, `VITE_API_URL`, URL в Supabase Auth
   и адрес вебхука в Kommo

Пропускной системы, турникетов и Face ID в продукте нет и не планируется: в ТЗ Академии их нет ни в
§13, ни в плане версий §15. Код проходной удалён миграцией `20260924000001_drop_access_control.sql`.
