# isup-service — приём событий с face-терминала Hikvision (ISUP 5.0)

Сервис-мост между терминалом **Hikvision DS-K1T670MX** (стоит в спорткомплексе
за NAT) и нашим бэкендом. Терминал **сам** подключается к серверу по протоколу
ISUP 5.0 (бывш. EHome), поэтому белый IP нужен только серверу:

```
терминал (NAT, спортзал)  ──ISUP──▶  78.47.93.22:7660  (CMS: регистрация)
                          ──ISUP──▶  78.47.93.22:7332  (Alarm: события проходов)
isup-service  ──POST──▶  backend  /v1/hik/events  (внутри docker-сети)
```

Основано на open-source проекте [oldweipro/hik-isup](https://github.com/oldweipro/hik-isup)
(Apache-2.0) и официальном ACS-демо Hikvision
([ISUPSDK_JAVA_DEMO_ACS](https://github.com/3395207/ISUPSDK_JAVA_DEMO_ACS)).
Происхождение кода и нативных библиотек — в [NOTICE.md](NOTICE.md).

## Статус: каркас — НЕ тестировался с живым терминалом

| Часть | Состояние |
|---|---|
| Инициализация SDK, listen-серверы CMS/Alarm | код по образцу hik-isup, **не проверялся на живом железе** |
| Регистрация терминала (Device ID + ключ ISUP) | каркас, не проверялся |
| Приём AccessControllerEvent и маппинг в JSON | каркас, не проверялся |
| Форвардинг на бэкенд (ретраи, idempotency-key) | локальная логика, юнит-тестов нет |
| Загрузка лица `/enroll` | best-effort по демо Hikvision, **есть TODO**, требуется живой терминал |
| Сборка (`mvn package`) | см. раздел «Сборка» ниже |

## Настройка терминала (веб-интерфейс DS-K1T670MX)

1. Зайти в веб-интерфейс терминала (IP в локальной сети спортзала).
2. **Configuration → Network → Advanced / Platform Access → ISUP** (на части
   прошивок: «EHome»). Выбрать версию протокола **ISUP 5.0**.
3. Заполнить:
   - **Server Address (адрес сервера):** `78.47.93.22`
   - **Port (порт):** `7660`
   - **Device ID:** уникальный идентификатор терминала, например
     `uniqum-door-1`. Этот же ID добавить в `ISUP_DEVICE_IDS` на сервере.
   - **Key (ключ / EHome Key):** значение `ISUP_KEY` с сервера
     (придумать общий секрет, минимум 8 символов).
4. Сохранить; терминал должен показать статус Online/Registered.
   На сервере в логах контейнера появится `device ONLINE: id=...`.

## Переменные окружения

| Переменная | Обязательна | По умолчанию | Что это |
|---|---|---|---|
| `ISUP_DEVICE_IDS` | да | — (пусто = все отклоняются) | Разрешённые Device ID через запятую: `uniqum-door-1,uniqum-door-2` |
| `ISUP_KEY` | да | — | Ключ ISUP 5.0, тот же, что вбит на терминале |
| `ISUP_CMS_PORT` | нет | `7660` | Порт регистрации (CMS listen) |
| `ISUP_ALARM_PORT` | нет | `7332` | Порт приёма событий (Alarm listen) |
| `ISUP_ALARM_TYPE` | нет | `2` | Тип alarm-канала: 0 — UDP, 1 — UDP+TCP (ISUP4.0), 2 — MQTT (ISUP5.0) |
| `ISUP_PUBLIC_IP` | нет | `78.47.93.22` | Публичный IP сервера — сообщается терминалу как адрес alarm-сервера |
| `CLOUD_INGEST_URL` | нет | `http://backend:8080/v1/hik/events` | Куда форвардить события (в hetzner-стеке backend слушает **3001**) |
| `HIK_INGEST_SECRET` | да | — | Bearer-токен для `CLOUD_INGEST_URL` |
| `HTTP_PORT` | нет | `8080` | Локальный HTTP API (`/healthz`, `/enroll`, `/photos/*`) |
| `ISUP_PHOTO_BASE_URL` | нет | `http://<ISUP_PUBLIC_IP>:<HTTP_PORT>` | База URL, по которой **терминал** скачает фото при загрузке лица |
| `ISUP_SDK_DIR` | нет | `<cwd>/sdk/linux` | Каталог с `.so` (в Docker уже настроен) |

## Формат события, отправляемого на бэкенд

`POST ${CLOUD_INGEST_URL}` с заголовками
`Authorization: Bearer ${HIK_INGEST_SECRET}` и
`Idempotency-Key: ${device_serial}:${event_serial}`:

```json
{
  "device_serial": "uniqum-door-1",
  "person_no": "1234",
  "event_serial": "118",
  "event_type": "face_ok",      // face_ok | face_fail | card_ok | other
  "direction": "in",            // in | out | unknown
  "occurred_at": "2026-08-20T09:30:00+06:00",
  "raw": { "...исходное ISAPI-событие терминала..." }
}
```

`face_ok` = majorEventType 5 / subEventType 75, `face_fail` = 5/76,
`card_ok` = 5/1, остальное — `other`. При недоставке — ретраи с
экспоненциальным бэкоффом (до ~8 попыток), затем событие дропается с логом
(историю можно дочитать с терминала через ISAPI `AcsEvent`, шаблон запроса
лежит в `src/main/resources/conf/acs/SearchAcsEventInfo.json`).

## Загрузка лица (каркас)

```
POST http://isup:8080/enroll
{ "person_no": "1234", "name": "Иванов Иван", "photo_base64": "<jpeg>",
  "device_id": "uniqum-door-1" }   // device_id можно опустить, если терминал один
```

Под капотом: `UserInfo/Record` + `FDLib/FaceDataRecord` через
ISAPI-passthrough (как в официальном демо). **Важно:** ISUP принимает лицо
только по `faceURL` — терминал сам скачивает фото по HTTP, значит порт
`HTTP_PORT` (или прокси на него) должен быть доступен терминалу извне, и
`ISUP_PHOTO_BASE_URL` должен на него указывать. Не тестировалось с живым
терминалом — см. TODO в `FaceEnrollment.java`.

## Срок действия персоны (`/valid`) — проходная по расписанию

Терминал сам отказывает вне срока действия персоны (`UserInfo.Valid`,
точность до секунды, время локальное). Backend раз в минуту выставляет
детям окно занятия (см. `backend/src/lib/hik-access-windows.ts`):

```
POST http://isup:8080/valid          (X-Internal-Key)
{ "device_id": "uniqum",             // можно опустить = все онлайн-терминалы
  "person_no": "10042",
  "valid_from":  "2026-09-05T16:45:00",
  "valid_until": "2026-09-05T18:15:00" }
→ { "status": "ok"|"partial_failure", "devices": { "uniqum": "ok"|"person_not_found"|"<ошибка>" } }
```

Под капотом `PUT /ISAPI/AccessControl/UserInfo/Modify?format=json`
(fallback — `UserInfo/SetUp`). `/enroll` принимает те же `valid_from`/`valid_until`,
иначе персона заводится бессрочно (2023–2033). «Нет доступа» = окно в прошлом
(`2000-01-01T00:00:00 … 00:00:01`); `Valid.enable=false` у Hikvision означает
«без ограничений», поэтому не используется.

**Часы терминалов.** Окна считает терминал по своим часам, а они в режиме
`manual` без NTP уплывают на минуты. `ClockSync` раз в `ISUP_CLOCK_SYNC_SECONDS`
(по умолчанию 1800, 0 = выкл) сверяет `GET /ISAPI/System/time` и при
расхождении > 20 с ставит время сервера (`PUT /ISAPI/System/time`), сохраняя
пояс терминала.

## Деплой (Hetzner, docker compose)

Добавить блок из [docker-compose.snippet.yml](docker-compose.snippet.yml)
в `deploy/hetzner/docker-compose.yml` (в `services:`):

```yaml
  isup:
    build:
      context: ../../isup-service
      dockerfile: Dockerfile
    platform: linux/amd64        # нативные библиотеки Hikvision — только amd64
    restart: always
    ports:
      - "7660:7660/tcp"          # ISUP CMS: регистрация терминала
      - "7660:7660/udp"
      - "7332:7332/tcp"          # ISUP Alarm: события (MQTT/TCP)
      - "7332:7332/udp"
    environment:
      ISUP_DEVICE_IDS: "${ISUP_DEVICE_IDS}"
      ISUP_KEY: "${ISUP_KEY}"
      ISUP_CMS_PORT: "7660"
      ISUP_ALARM_PORT: "7332"
      CLOUD_INGEST_URL: "http://backend:3001/v1/hik/events"
      HIK_INGEST_SECRET: "${HIK_INGEST_SECRET}"
      HTTP_PORT: "8080"
```

Секреты (`ISUP_DEVICE_IDS`, `ISUP_KEY`, `HIK_INGEST_SECRET`) — в
`deploy/hetzner/secrets.env`. Не забыть открыть 7660 (tcp+udp) и 7332
в файрволе Hetzner, если он включён.

## Сборка

```bash
cd isup-service
mvn -q package -DskipTests          # -> target/isup-service.jar (fat jar)
# или сразу образ:
docker build --platform linux/amd64 -t uniqum/isup-service .
```

Запуск вне Docker: нужен Linux x86_64, `LD_LIBRARY_PATH=./sdk/linux java -jar target/isup-service.jar`.

## Что осталось до продакшена (честный список)

- [ ] Проверить регистрацию живого DS-K1T670MX (AUTH/SESSIONKEY-цепочку ISUP 5.0).
- [ ] Проверить, каким типом (`EHOME_ISAPI_ALARM` vs `EHOME_ALARM_ACS`) и в каком
      формате терминал реально шлёт события, поправить `EventMapper`.
- [ ] Реализовать endpoint `/v1/hik/events` на бэкенде.
- [ ] Дочитывание пропущенных событий с терминала (ISAPI `AcsEvent`) после даунтайма.
- [ ] Загрузка лица: живой тест faceURL, обработка ошибок качества фото.
- [ ] Заменить `.so` на официальную поставку Hikvision ISUP SDK (см. NOTICE.md).
