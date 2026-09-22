package kg.uniqum.isup;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Опрос журнала проходов терминала через ISAPI-passthrough по CMS-каналу
 * (POST /ISAPI/AccessControl/AcsEvent). Это ОСНОВНОЙ канал доставки событий:
 * alarm-канал (MQTT, порт 7332) у DS-K1T670MX ведёт себя нестабильно после
 * рестартов (EHOME50_ERROR при возобновлении сессии), а CMS-канал держится
 * железно. Дубли отсекаются идемпотентностью бэкенда (device_serial+serialNo),
 * поэтому пересечение окон опроса и параллельная доставка через alarm безопасны.
 */
public final class AcsEventPoller implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(AcsEventPoller.class);

    private static final DateTimeFormatter ISAPI_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");
    private static final int MAX_RESULTS = 30;   // как в официальном ACS-демо
    private static final int MAX_PAGES = 100;    // предохранитель
    private static final long OVERLAP_SECONDS = 120; // перекрытие окон против гонок часов

    private final Config config;
    private final DeviceRegistry registry;
    private final FaceEnrollment passthrough;
    private final EventForwarder forwarder;
    private final ObjectMapper json;
    private final ZoneOffset tz;

    private final Map<String, Instant> lastPolledOk = new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "acs-event-poller");
                t.setDaemon(true);
                return t;
            });

    public AcsEventPoller(Config config, DeviceRegistry registry, FaceEnrollment passthrough,
                          EventForwarder forwarder, ObjectMapper json) {
        this.config = config;
        this.registry = registry;
        this.passthrough = passthrough;
        this.forwarder = forwarder;
        this.json = json;
        this.tz = ZoneOffset.of(EventMapper.TZ_OFFSET);
    }

    public void start() {
        scheduler.scheduleWithFixedDelay(this::pollAll,
                config.pollSeconds, config.pollSeconds, TimeUnit.SECONDS);
        log.info("AcsEvent poller started: every {}s, initial lookback {}min",
                config.pollSeconds, config.pollLookbackMinutes);
    }

    private void pollAll() {
        for (DeviceRegistry.Session session : registry.snapshot().values()) {
            try {
                pollDevice(session);
            } catch (Exception e) {
                // не роняем цикл: терминал мог отвалиться между snapshot и запросом
                log.warn("AcsEvent poll failed for device {}: {}", session.deviceId(), e.toString());
            }
        }
    }

    private void pollDevice(DeviceRegistry.Session session) throws Exception {
        String deviceId = session.deviceId();
        Instant now = Instant.now();
        Instant from = lastPolledOk
                .getOrDefault(deviceId, now.minus(config.pollLookbackMinutes, java.time.temporal.ChronoUnit.MINUTES))
                .minusSeconds(OVERLAP_SECONDS);

        String startTime = OffsetDateTime.ofInstant(from, tz).format(ISAPI_TIME);
        String endTime = OffsetDateTime.ofInstant(now.plusSeconds(OVERLAP_SECONDS), tz).format(ISAPI_TIME);
        String searchId = UUID.randomUUID().toString().substring(0, 32);

        int position = 0;
        int forwarded = 0;
        for (int page = 0; page < MAX_PAGES; page++) {
            String body = template(Map.of(
                    "searchID", searchId,
                    "searchResultPosition", String.valueOf(position),
                    "maxResults", String.valueOf(MAX_RESULTS),
                    "major", "5",
                    "startTime", startTime,
                    "endTime", endTime));
            String resp = passthrough.passThrough(session.loginId(),
                    "POST /ISAPI/AccessControl/AcsEvent?format=json", body);
            JsonNode acs = json.readTree(resp).path("AcsEvent");
            if (acs.isMissingNode()) {
                log.warn("AcsEvent search: unexpected response from {}: {}",
                        deviceId, abbreviate(resp));
                return; // не двигаем lastPolledOk — попробуем то же окно снова
            }

            for (JsonNode item : acs.path("InfoList")) {
                AccessEvent ev = mapItem(deviceId, item);
                if (ev != null) {
                    forwarder.submit(ev);
                    forwarded++;
                }
            }

            String status = acs.path("responseStatusStrg").asText("");
            int matches = acs.path("numOfMatches").asInt(0);
            position += matches;
            if (!"MORE".equalsIgnoreCase(status) || matches == 0) break;
        }

        lastPolledOk.put(deviceId, now);
        if (forwarded > 0) log.info("AcsEvent poll {}: forwarded {} event(s)", deviceId, forwarded);
    }

    /** Элемент InfoList (JSON, major/minor десятичные) → AccessEvent или null. */
    private AccessEvent mapItem(String deviceId, JsonNode item) {
        int major = item.path("major").asInt(-1);
        int minor = item.path("minor").asInt(-1);
        String type = EventMapper.eventTypeFor(major, minor);
        // из поллера шлём только реальные проходы — открытия двери и прочую
        // технику (minor 0x16/0x1b и т.п.) в журнал не тащим
        if (!type.equals("face_ok") && !type.equals("face_fail") && !type.equals("card_ok")) {
            return null;
        }

        long serialNo = item.path("serialNo").asLong(-1);
        if (serialNo < 0) return null;

        String personNo = firstNonEmpty(
                item.path("employeeNoString").asText(null),
                item.hasNonNull("employeeNo") ? item.get("employeeNo").asText() : null,
                item.path("cardNo").asText(null));

        String att = item.path("attendanceStatus").asText("");
        String direction;
        if ("checkIn".equalsIgnoreCase(att)) direction = "in";
        else if ("checkOut".equalsIgnoreCase(att)) direction = "out";
        else {
            int reader = item.path("cardReaderNo").asInt(-1);
            direction = reader == 1 ? "in" : reader == 2 ? "out" : "unknown";
        }

        String time = item.path("time").asText(null);
        String occurredAt;
        if (time == null || time.isBlank()) {
            occurredAt = OffsetDateTime.now(tz).toString();
        } else if (time.contains("+") || time.endsWith("Z")) {
            occurredAt = time.trim().replace(' ', 'T');
        } else {
            occurredAt = time.trim().replace(' ', 'T') + EventMapper.TZ_OFFSET;
        }

        ObjectNode raw = json.createObjectNode();
        raw.put("source", "acs_poll");
        raw.set("item", item);

        return new AccessEvent(deviceId, personNo, String.valueOf(serialNo),
                type, direction, occurredAt, raw);
    }

    private String template(Map<String, String> vars) throws Exception {
        try (InputStream in = getClass().getClassLoader()
                .getResourceAsStream("conf/acs/SearchAcsEventInfo.json")) {
            if (in == null) throw new IllegalStateException("SearchAcsEventInfo.json not found");
            String s = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            for (Map.Entry<String, String> e : vars.entrySet()) {
                s = s.replace("${" + e.getKey() + "}", e.getValue());
            }
            return s;
        }
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private static String abbreviate(String s) {
        return s.length() > 300 ? s.substring(0, 300) + "…" : s;
    }

    @Override
    public void close() {
        scheduler.shutdownNow();
    }
}
