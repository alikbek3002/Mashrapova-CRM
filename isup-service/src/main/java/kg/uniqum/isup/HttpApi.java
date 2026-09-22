package kg.uniqum.isup;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/**
 * Локальный HTTP API (доступен только внутри docker-сети):
 *
 *   GET  /healthz            — статус сервиса и онлайн-устройства
 *   POST /enroll             — загрузка лица на терминал
 *        {"device_id": "...", "person_no": "...", "name": "...", "photo_base64": "..."}
 *        device_id можно опустить, если зарегистрирован ровно один терминал.
 *   POST /door               — удалённое управление дверью
 *        {"device_id": "...", "cmd": "open|alwaysOpen|alwaysClose|resume"}
 *        device_id — так же, как в /enroll.
 *   POST /valid              — срок действия персоны (окно доступа по расписанию)
 *        {"device_id"?, "person_no", "valid_from", "valid_until"}  (локальное время)
 */
public final class HttpApi {

    private static final Logger log = LoggerFactory.getLogger(HttpApi.class);

    /** Разрешённые команды двери (ISAPI RemoteControlDoor). */
    private static final java.util.Set<String> DOOR_CMDS =
            java.util.Set.of("open", "alwaysOpen", "alwaysClose", "resume");

    /** Обработчик загрузки лица (реализация — FaceEnrollment, поверх ISAPI-passthrough). */
    public interface EnrollHandler {
        /**
         * @param validBegin срок действия с (локальное время "2026-09-05T16:45:00"), null = бессрочно
         * @param validEnd   срок действия по, null = бессрочно
         * @return тело ответа терминала (JSON) при успехе; кидает исключение при ошибке.
         */
        String enroll(String deviceId, String personNo, String name, byte[] photoJpeg,
                      String validBegin, String validEnd) throws Exception;
    }

    /** Обработчик управления дверью (реализация — FaceEnrollment.controlDoor). */
    public interface DoorHandler {
        /** @return тело ответа терминала (XML) при успехе; кидает исключение при ошибке. */
        String controlDoor(String deviceId, String cmd) throws Exception;

        /** Сырой ISAPI-passthrough — диагностика/тонкие команды (см. /isapi). */
        String rawIsapi(String deviceId, String reqUrl, String body, int timeoutMs) throws Exception;

        /** Живой факт: есть ли лицо person_no на терминале. */
        boolean faceExists(String deviceId, String personNo) throws Exception;

        /** Удалить с терминала лицо и карточку человека. */
        void deleteFace(String deviceId, String personNo) throws Exception;

        /** Срок действия персоны (UserInfo.Valid), локальное время без смещения. */
        String setValid(String deviceId, String personNo, String beginLocal, String endLocal) throws Exception;
    }

    private final Config config;
    private final ObjectMapper mapper;
    private final DeviceRegistry registry;
    private final EventForwarder forwarder;
    private final EnrollHandler enrollHandler;
    private final DoorHandler doorHandler;
    private final PhotoStore photoStore;
    private HttpServer server;
    /** Параллельные обращения к разным терминалам (enroll/status). */
    private final java.util.concurrent.ExecutorService ioPool = Executors.newFixedThreadPool(4);

    public HttpApi(Config config, ObjectMapper mapper, DeviceRegistry registry,
                   EventForwarder forwarder, EnrollHandler enrollHandler,
                   DoorHandler doorHandler, PhotoStore photoStore) {
        this.config = config;
        this.mapper = mapper;
        this.registry = registry;
        this.forwarder = forwarder;
        this.enrollHandler = enrollHandler;
        this.doorHandler = doorHandler;
        this.photoStore = photoStore;
    }

    public void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(config.httpPort), 0);
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.createContext("/healthz", this::handleHealth);
        server.createContext("/enroll", this::handleEnroll);
        server.createContext("/door", this::handleDoor);
        server.createContext("/isapi", this::handleIsapi);
        server.createContext("/face-status", this::handleFaceStatus);
        server.createContext("/face-delete", this::handleFaceDelete);
        server.createContext("/valid", this::handleValid);
        server.createContext("/host", this::handleHost);
        server.createContext("/photos/", this::handlePhoto);
        server.start();
        log.info("HTTP API listening on :{}", config.httpPort);
    }

    /** Отдаёт фото терминалу для загрузки лица (faceURL). */
    private void handlePhoto(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        String token = path.substring("/photos/".length());
        byte[] photo = photoStore.get(token);
        if (photo == null) {
            respond(ex, 404, "{\"error\":\"photo not found or expired\"}");
            return;
        }
        ex.getResponseHeaders().set("Content-Type",
                path.endsWith(".wav") ? "audio/wav" : "image/jpeg");
        ex.sendResponseHeaders(200, photo.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(photo);
        }
    }

    /**
     * Временный хостинг файла для скачивания терминалом (кастомные аудио и т.п.):
     * POST /host {"data_base64":"...", "ext":"wav"} → {"url":"http://.../photos/<token>"}
     * TTL — как у фото (10 мин); терминал скачивает и хранит файл у себя.
     */
    private void handleHost(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String dataB64 = textOrNull(req, "data_base64");
            String extRaw = textOrNull(req, "ext");
            String ext = (extRaw == null ? "bin" : extRaw).replaceAll("[^a-z0-9]", "");
            if (dataB64 == null) {
                respond(ex, 400, "{\"error\":\"data_base64 required\"}");
                return;
            }
            byte[] data = java.util.Base64.getDecoder().decode(dataB64);
            String token = photoStore.store(data, ext);
            respond(ex, 200, "{\"url\":\"" + config.photoBaseUrl + "/photos/" + token + "\"}");
        } catch (Exception e) {
            respond(ex, 400, "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    private void handleHealth(HttpExchange ex) throws IOException {
        ObjectNode body = mapper.createObjectNode();
        body.put("status", "ok");
        body.put("queue_size", forwarder.queueSize());
        body.put("forwarded", forwarder.forwardedCount());
        body.put("dropped", forwarder.droppedCount());
        ObjectNode devices = body.putObject("devices_online");
        registry.snapshot().forEach((id, s) ->
                devices.put(id, s.registeredAt().toString()));
        respond(ex, 200, body.toString());
    }

    /**
     * Порт 8080 опубликован наружу (терминал качает фото по /photos/токен),
     * поэтому мутирующие ручки закрыты общим секретом.
     */
    private boolean checkInternalKey(HttpExchange ex) throws IOException {
        String secret = config.hikIngestSecret;
        if (secret == null || secret.isEmpty()) return true; // защита не настроена
        if (secret.equals(ex.getRequestHeaders().getFirst("X-Internal-Key"))) return true;
        respond(ex, 401, "{\"error\":\"unauthorized\"}");
        return false;
    }

    private void handleEnroll(HttpExchange ex) throws IOException {
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        if (!checkInternalKey(ex)) return;
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String personNo = textOrNull(req, "person_no");
            String name = textOrNull(req, "name");
            String photoB64 = textOrNull(req, "photo_base64");
            String deviceId = textOrNull(req, "device_id");
            // срок действия персоны (режим «по расписанию»); не задан — бессрочно
            String validBegin = textOrNull(req, "valid_from");
            String validEnd = textOrNull(req, "valid_until");

            if (personNo == null || name == null || photoB64 == null) {
                respond(ex, 400, "{\"error\":\"person_no, name and photo_base64 are required\"}");
                return;
            }
            // device_id не указан — лицо заводится на ВСЕ онлайн-терминалы
            // (ребёнок должен узнаваться и на входе, и на выходе)
            java.util.List<String> targets = targetDevices(ex, deviceId);
            if (targets == null) return;

            byte[] photo = java.util.Base64.getDecoder().decode(photoB64);
            ObjectNode results = mapper.createObjectNode();
            java.util.List<String> failures = new java.util.ArrayList<>();
            // терминалы — независимые сессии SDK: заливаем на все ПАРАЛЛЕЛЬНО,
            // иначе время растёт линейно с числом терминалов (каждый ~5-10 с по 4G)
            java.util.Map<String, java.util.concurrent.Future<String>> jobs = new java.util.LinkedHashMap<>();
            for (String dev : targets) {
                final String personNoF = personNo, nameF = name;
                jobs.put(dev, ioPool.submit(() -> enrollHandler.enroll(dev, personNoF, nameF, photo, validBegin, validEnd)));
            }
            for (var job : jobs.entrySet()) {
                try {
                    job.getValue().get();
                    results.put(job.getKey(), "ok");
                } catch (Exception e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    results.put(job.getKey(), String.valueOf(c.getMessage()));
                    failures.add(job.getKey());
                }
            }
            ObjectNode out = mapper.createObjectNode();
            out.put("status", failures.isEmpty() ? "ok" : "partial_failure");
            out.put("person_no", personNo);
            out.set("devices", results);
            if (failures.isEmpty()) {
                respond(ex, 200, out.toString());
            } else {
                log.warn("enroll failed on {}: {}", failures, out);
                respond(ex, 502, out.toString());
            }
        } catch (IllegalArgumentException e) {
            respond(ex, 400, "{\"error\":\"bad request: " + e.getMessage() + "\"}");
        } catch (Exception e) {
            log.error("enroll failed", e);
            respond(ex, 502, "{\"error\":\"enroll failed: "
                    + String.valueOf(e.getMessage()).replace('"', '\'') + "\"}");
        }
    }

    /**
     * Сырой ISAPI-запрос к терминалу (диагностика; закрыт X-Internal-Key):
     * POST /isapi {"device_id":"...", "req":"GET /ISAPI/...", "body":"...", "timeout_ms":10000}
     */
    private void handleIsapi(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String reqUrl = textOrNull(req, "req");
            if (reqUrl == null || !reqUrl.contains("/ISAPI/")) {
                respond(ex, 400, "{\"error\":\"req like 'GET /ISAPI/...' required\"}");
                return;
            }
            String deviceId = textOrNull(req, "device_id");
            if (deviceId == null) {
                var online = registry.snapshot();
                if (online.size() != 1) {
                    respond(ex, 400, "{\"error\":\"device_id required\"}");
                    return;
                }
                deviceId = online.keySet().iterator().next();
            }
            String body = textOrNull(req, "body");
            int timeout = req.path("timeout_ms").asInt(10_000);
            String resp = doorHandler.rawIsapi(deviceId, reqUrl, body == null ? "" : body, timeout);
            ObjectNode ok = mapper.createObjectNode();
            ok.put("status", "ok");
            ok.put("terminal_response", resp);
            respond(ex, 200, ok.toString());
        } catch (Exception e) {
            log.error("isapi passthrough failed", e);
            respond(ex, 502, "{\"error\":\"" + e.getMessage().replace("\"", "'") + "\"}");
        }
    }

    /** device_id из запроса, либо единственный онлайн-терминал; null = ошибка уже отправлена. */
    private String resolveDeviceId(HttpExchange ex, String requested) throws IOException {
        if (requested != null) {
            if (registry.byDeviceId(requested).isEmpty()) {
                respond(ex, 409, "{\"error\":\"device not online: " + requested + "\"}");
                return null;
            }
            return requested;
        }
        var online = registry.snapshot();
        if (online.size() != 1) {
            respond(ex, 400, "{\"error\":\"device_id required: " + online.size() + " devices online\"}");
            return null;
        }
        return online.keySet().iterator().next();
    }

    /** device_id из запроса (списком из одного) либо ВСЕ онлайн-терминалы; null = ошибка отправлена. */
    private java.util.List<String> targetDevices(HttpExchange ex, String requested) throws IOException {
        if (requested != null) {
            if (registry.byDeviceId(requested).isEmpty()) {
                respond(ex, 409, "{\"error\":\"device not online: " + requested + "\"}");
                return null;
            }
            return java.util.List.of(requested);
        }
        var online = registry.snapshot();
        if (online.isEmpty()) {
            respond(ex, 409, "{\"error\":\"no devices online\"}");
            return null;
        }
        return new java.util.ArrayList<>(online.keySet());
    }

    /** POST /face-status {"device_id"?, "person_no"} → {"enrolled": bool} — живой факт с терминала. */
    private void handleFaceStatus(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String personNo = textOrNull(req, "person_no");
            if (personNo == null) {
                respond(ex, 400, "{\"error\":\"person_no required\"}");
                return;
            }
            java.util.List<String> targets = targetDevices(ex, textOrNull(req, "device_id"));
            if (targets == null) return;
            // «заведено» = лицо есть на КАЖДОМ онлайн-терминале (вход и выход)
            java.util.List<java.util.concurrent.Future<Boolean>> checks = new java.util.ArrayList<>();
            for (String dev : targets) {
                final String personNoF = personNo;
                checks.add(ioPool.submit(() -> doorHandler.faceExists(dev, personNoF)));
            }
            boolean exists = true;
            for (var c : checks) exists &= c.get();
            respond(ex, 200, "{\"enrolled\":" + exists + "}");
        } catch (Exception e) {
            log.warn("face-status failed: {}", e.toString());
            respond(ex, 502, "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    /** POST /face-delete {"device_id"?, "person_no"} — удаляет лицо и карточку с терминала. */
    private void handleFaceDelete(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String personNo = textOrNull(req, "person_no");
            if (personNo == null) {
                respond(ex, 400, "{\"error\":\"person_no required\"}");
                return;
            }
            java.util.List<String> targets = targetDevices(ex, textOrNull(req, "device_id"));
            if (targets == null) return;
            java.util.List<String> failed = new java.util.ArrayList<>();
            for (String dev : targets) {
                try {
                    doorHandler.deleteFace(dev, personNo);
                } catch (Exception e) {
                    failed.add(dev + ": " + e.getMessage());
                }
            }
            if (failed.isEmpty()) respond(ex, 200, "{\"status\":\"ok\"}");
            else respond(ex, 502, "{\"error\":\"" + String.join("; ", failed).replace("\"", "'") + "\"}");
        } catch (Exception e) {
            log.warn("face-delete failed: {}", e.toString());
            respond(ex, 502, "{\"error\":\"" + String.valueOf(e.getMessage()).replace("\"", "'") + "\"}");
        }
    }

    /**
     * POST /valid {"device_id"?, "person_no", "valid_from", "valid_until"} — срок действия
     * персоны на терминале(ах), время локальное без смещения ("2026-09-05T16:45:00").
     * Ответ как у /enroll: {"status","devices":{id:"ok"|"person_not_found"|<ошибка>}}.
     * device_id не указан — на все онлайн-терминалы параллельно.
     */
    private void handleValid(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String personNo = textOrNull(req, "person_no");
            String begin = textOrNull(req, "valid_from");
            String end = textOrNull(req, "valid_until");
            if (personNo == null || begin == null || end == null) {
                respond(ex, 400, "{\"error\":\"person_no, valid_from and valid_until are required\"}");
                return;
            }
            java.util.List<String> targets = targetDevices(ex, textOrNull(req, "device_id"));
            if (targets == null) return;

            java.util.Map<String, java.util.concurrent.Future<String>> jobs = new java.util.LinkedHashMap<>();
            for (String dev : targets) {
                jobs.put(dev, ioPool.submit(() -> doorHandler.setValid(dev, personNo, begin, end)));
            }
            ObjectNode results = mapper.createObjectNode();
            boolean allOk = true;
            for (var job : jobs.entrySet()) {
                try {
                    job.getValue().get();
                    results.put(job.getKey(), "ok");
                } catch (Exception e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    allOk = false;
                    results.put(job.getKey(), c instanceof FaceEnrollment.PersonNotFoundException
                            ? "person_not_found" : String.valueOf(c.getMessage()));
                }
            }
            ObjectNode out = mapper.createObjectNode();
            out.put("status", allOk ? "ok" : "partial_failure");
            out.put("person_no", personNo);
            out.set("devices", results);
            respond(ex, allOk ? 200 : 502, out.toString());
        } catch (Exception e) {
            log.warn("valid failed: {}", e.toString());
            respond(ex, 502, "{\"error\":\"" + String.valueOf(e.getMessage()).replace('"', '\'') + "\"}");
        }
    }

    private void handleDoor(HttpExchange ex) throws IOException {
        if (!checkInternalKey(ex)) return;
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            respond(ex, 405, "{\"error\":\"method not allowed\"}");
            return;
        }
        try {
            JsonNode req = mapper.readTree(ex.getRequestBody());
            String cmd = textOrNull(req, "cmd");
            String deviceId = textOrNull(req, "device_id");

            if (cmd == null || !DOOR_CMDS.contains(cmd)) {
                respond(ex, 400, "{\"error\":\"cmd must be one of: open, alwaysOpen, alwaysClose, resume\"}");
                return;
            }
            if (deviceId == null) {
                var online = registry.snapshot();
                if (online.size() != 1) {
                    respond(ex, 400, "{\"error\":\"device_id required: " + online.size()
                            + " devices online\"}");
                    return;
                }
                deviceId = online.keySet().iterator().next();
            }
            if (registry.byDeviceId(deviceId).isEmpty()) {
                respond(ex, 409, "{\"error\":\"device not online: " + deviceId + "\"}");
                return;
            }

            String terminalResponse = doorHandler.controlDoor(deviceId, cmd);

            ObjectNode ok = mapper.createObjectNode();
            ok.put("status", "ok");
            ok.put("device_id", deviceId);
            ok.put("cmd", cmd);
            ok.put("terminal_response", terminalResponse); // XML ResponseStatus как есть
            respond(ex, 200, ok.toString());
        } catch (IllegalArgumentException e) {
            respond(ex, 400, "{\"error\":\"bad request: " + e.getMessage() + "\"}");
        } catch (Exception e) {
            log.error("door control failed", e);
            respond(ex, 502, "{\"error\":\"door control failed: "
                    + String.valueOf(e.getMessage()).replace('"', '\'') + "\"}");
        }
    }

    private static String textOrNull(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull() || v.asText().isBlank()) ? null : v.asText();
    }

    private void respond(HttpExchange ex, int code, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    public void stop() {
        if (server != null) server.stop(0);
    }
}
