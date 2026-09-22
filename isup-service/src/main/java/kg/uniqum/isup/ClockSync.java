package kg.uniqum.isup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Синхронизация часов терминалов с сервером.
 *
 * Терминалы работают в режиме timeMode=manual без NTP и уплывают на минуты
 * (05.09.2026: «uniqum» отставал на 6,5 мин). Окна доступа по расписанию
 * (UserInfo.Valid) считаются по часам ТЕРМИНАЛА, поэтому раз в
 * {@code ISUP_CLOCK_SYNC_SECONDS} сверяем GET /ISAPI/System/time и при
 * расхождении больше порога выставляем время сервера через PUT /ISAPI/System/time,
 * сохраняя часовой пояс, заданный на терминале.
 */
public final class ClockSync implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(ClockSync.class);

    private static final long DRIFT_THRESHOLD_SECONDS = 20;
    // Hikvision: "CST-6:00:00" означает UTC+6 (знак инвертирован относительно ISO)
    private static final Pattern TZ = Pattern.compile("<timeZone>\\s*[A-Za-z]*([+-])(\\d{1,2}):(\\d{2}):(\\d{2})");
    private static final Pattern LOCAL_TIME = Pattern.compile("<localTime>\\s*([^<\\s]+)\\s*</localTime>");
    private static final Pattern TZ_TAG = Pattern.compile("<timeZone>[^<]*</timeZone>");
    private static final DateTimeFormatter LOCAL_TIME_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX");

    private final DeviceRegistry registry;
    private final FaceEnrollment passthrough;
    private final long periodSeconds;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "clock-sync");
                t.setDaemon(true);
                return t;
            });

    public ClockSync(DeviceRegistry registry, FaceEnrollment passthrough, long periodSeconds) {
        this.registry = registry;
        this.passthrough = passthrough;
        this.periodSeconds = periodSeconds;
    }

    public void start() {
        if (periodSeconds <= 0) {
            log.warn("ClockSync disabled (ISUP_CLOCK_SYNC_SECONDS=0)");
            return;
        }
        scheduler.scheduleWithFixedDelay(this::syncAll, 90, periodSeconds, TimeUnit.SECONDS);
        log.info("ClockSync started: every {}s, threshold {}s", periodSeconds, DRIFT_THRESHOLD_SECONDS);
    }

    private void syncAll() {
        for (DeviceRegistry.Session session : registry.snapshot().values()) {
            try {
                syncOne(session);
            } catch (Exception e) {
                log.warn("clock sync failed for {}: {}", session.deviceId(), e.toString());
            }
        }
    }

    /** Возвращает расхождение (сек, терминал − сервер) до коррекции; 0 если читать не удалось. */
    long syncOne(DeviceRegistry.Session session) throws Exception {
        String resp = passthrough.passThrough(session.loginId(), "GET /ISAPI/System/time", "", 8_000);
        Matcher lt = LOCAL_TIME.matcher(resp);
        if (!lt.find()) {
            log.debug("clock sync {}: no localTime in response: {}", session.deviceId(), resp);
            return 0;
        }
        ZoneOffset zone = parseZone(resp);
        OffsetDateTime deviceNow;
        try {
            deviceNow = OffsetDateTime.parse(lt.group(1));
        } catch (Exception e) {
            // без смещения — трактуем в поясе терминала
            deviceNow = java.time.LocalDateTime.parse(lt.group(1)).atOffset(zone);
        }
        OffsetDateTime serverNow = OffsetDateTime.now(zone);
        long drift = Duration.between(serverNow, deviceNow).getSeconds();
        if (Math.abs(drift) < DRIFT_THRESHOLD_SECONDS) {
            log.debug("clock {} ok, drift {}s", session.deviceId(), drift);
            return drift;
        }

        Matcher tz = TZ_TAG.matcher(resp);
        String tzTag = tz.find() ? tz.group() : "<timeZone>CST-6:00:00</timeZone>";
        String body = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
                + "<Time version=\"2.0\" xmlns=\"http://www.isapi.org/ver20/XMLSchema\">"
                + "<timeMode>manual</timeMode>"
                // строго без долей секунды: с ними прошивка отвечает 6 "Invalid Content"
                + "<localTime>" + OffsetDateTime.now(zone).format(LOCAL_TIME_FMT) + "</localTime>"
                + tzTag
                + "</Time>";
        String put = passthrough.passThrough(session.loginId(), "PUT /ISAPI/System/time", body, 8_000);
        if (put.toLowerCase().contains("<statuscode>1</statuscode>") || put.toLowerCase().contains("\"statuscode\":1")) {
            log.info("clock {} corrected: drift was {}s", session.deviceId(), drift);
        } else {
            log.warn("clock {} PUT rejected (drift {}s): {}", session.deviceId(), drift,
                    put.length() > 400 ? put.substring(0, 400) : put);
        }
        return drift;
    }

    static ZoneOffset parseZone(String timeXml) {
        Matcher m = TZ.matcher(timeXml);
        if (!m.find()) return ZoneOffset.ofHours(6); // Бишкек
        int sign = m.group(1).equals("-") ? 1 : -1; // инверсия Hikvision
        int h = Integer.parseInt(m.group(2));
        int min = Integer.parseInt(m.group(3));
        try {
            return ZoneOffset.ofHoursMinutes(sign * h, sign * min);
        } catch (Exception e) {
            return ZoneOffset.ofHours(6);
        }
    }

    @Override
    public void close() {
        scheduler.shutdownNow();
    }
}
