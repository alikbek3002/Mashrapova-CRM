package kg.uniqum.isup;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Конфигурация сервиса из переменных окружения.
 */
public final class Config {

    /** ISUP Device ID терминалов, которым разрешена регистрация (через запятую). */
    public final Set<String> deviceIds;
    /** Ключ ISUP (тот же, что введён на терминале в Platform Access). */
    public final String isupKey;
    /**
     * Персональные ключи терминалов: ISUP_KEYS="uniqum:KEY1,uniqumt2:KEY2".
     * Два устройства с ОДИНАКОВЫМ ключом из-под одного публичного IP ломают
     * друг другу сессию в SDK (обмен master key не проходит), поэтому у
     * каждого терминала должен быть свой ключ. Фолбэк — общий ISUP_KEY.
     */
    public final Map<String, String> isupKeys;
    /** Порт CMS listen-сервера (регистрация терминалов). */
    public final int cmsPort;
    /** Порт Alarm listen-сервера (приём событий). */
    public final int alarmPort;
    /** Порт локального HTTP API (/healthz, /enroll, /door). */
    public final int httpPort;
    /** Куда форвардить события. */
    public final String cloudIngestUrl;
    /** Куда слать heartbeat онлайн-устройств (по умолчанию — рядом с ingest). */
    public final String cloudHeartbeatUrl;
    /** Bearer-токен для CLOUD_INGEST_URL. */
    public final String hikIngestSecret;
    /** Публичный IP этого сервера — сообщается терминалу как адрес alarm-сервера. */
    public final String publicIp;
    /**
     * Тип alarm-сервера, который сообщаем терминалу:
     * 0 - только UDP, 1 - UDP+TCP (ISUP4.0), 2 - MQTT (ISUP5.0, порт TCP).
     */
    public final int alarmServerType;
    /**
     * База URL, по которой ТЕРМИНАЛ сможет скачать фото для загрузки лица
     * (ISUP-загрузка лица работает только через faceURL).
     */
    public final String photoBaseUrl;
    /** Каталог с нативными библиотеками SDK. */
    public final String sdkDir;
    /** Период опроса журнала AcsEvent по CMS-каналу, сек (0 = выключить). */
    public final int pollSeconds;
    /** Стартовое окно опроса при первом запуске, мин. */
    public final int pollLookbackMinutes;

    private Config(Set<String> deviceIds, String isupKey, Map<String,String> isupKeys, int cmsPort, int alarmPort,
                   int httpPort, String cloudIngestUrl, String cloudHeartbeatUrl,
                   String hikIngestSecret,
                   String publicIp, int alarmServerType, String photoBaseUrl, String sdkDir,
                   int pollSeconds, int pollLookbackMinutes) {
        this.deviceIds = deviceIds;
        this.isupKey = isupKey;
        this.isupKeys = isupKeys;
        this.cmsPort = cmsPort;
        this.alarmPort = alarmPort;
        this.httpPort = httpPort;
        this.cloudIngestUrl = cloudIngestUrl;
        this.cloudHeartbeatUrl = cloudHeartbeatUrl;
        this.hikIngestSecret = hikIngestSecret;
        this.publicIp = publicIp;
        this.alarmServerType = alarmServerType;
        this.photoBaseUrl = photoBaseUrl;
        this.sdkDir = sdkDir;
        this.pollSeconds = pollSeconds;
        this.pollLookbackMinutes = pollLookbackMinutes;
    }

    public static Config fromEnv() {
        String ids = env("ISUP_DEVICE_IDS", "");
        Set<String> deviceIds = Arrays.stream(ids.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        String publicIp = env("ISUP_PUBLIC_IP", "78.47.93.22");
        int httpPort = envInt("HTTP_PORT", 8080);
        String ingestUrl = env("CLOUD_INGEST_URL", "http://backend:8080/v1/hik/events");
        return new Config(
                deviceIds,
                env("ISUP_KEY", ""),
                parseKeys(env("ISUP_KEYS", "")),
                envInt("ISUP_CMS_PORT", 7660),
                envInt("ISUP_ALARM_PORT", 7332),
                httpPort,
                ingestUrl,
                env("CLOUD_HEARTBEAT_URL", defaultHeartbeatUrl(ingestUrl)),
                env("HIK_INGEST_SECRET", ""),
                publicIp,
                envInt("ISUP_ALARM_TYPE", 2),
                env("ISUP_PHOTO_BASE_URL", "http://" + publicIp + ":" + httpPort),
                env("ISUP_SDK_DIR", System.getProperty("user.dir") + "/sdk/linux"),
                envInt("ISUP_POLL_SECONDS", 30),
                envInt("ISUP_POLL_LOOKBACK_MIN", 360)
        );
    }

    /** Ключ ISUP конкретного терминала (персональный, иначе общий). */
    public String keyFor(String deviceId) {
        return isupKeys.getOrDefault(deviceId, isupKey);
    }

    /** "id1:key1,id2:key2" -> карта. */
    private static Map<String, String> parseKeys(String raw) {
        Map<String, String> out = new HashMap<>();
        for (String pair : raw.split(",")) {
            int i = pair.indexOf(':');
            if (i > 0) out.put(pair.substring(0, i).trim(), pair.substring(i + 1).trim());
        }
        return Map.copyOf(out);
    }

    public boolean isDeviceAllowed(String deviceId) {
        return deviceIds.contains(deviceId);
    }

    /** Дефолт для heartbeat: хвост /events ingest-URL заменяется на /heartbeat. */
    private static String defaultHeartbeatUrl(String ingestUrl) {
        return ingestUrl.endsWith("/events")
                ? ingestUrl.substring(0, ingestUrl.length() - "/events".length()) + "/heartbeat"
                : ingestUrl + "/heartbeat";
    }

    private static String env(String name, String def) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? def : v.trim();
    }

    private static int envInt(String name, int def) {
        String v = System.getenv(name);
        if (v == null || v.isBlank()) return def;
        try {
            return Integer.parseInt(v.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " must be an integer, got: " + v);
        }
    }

    /** Описание конфигурации без секретов — для лога при старте. */
    public String describe() {
        return "deviceIds=" + deviceIds
                + " cmsPort=" + cmsPort
                + " alarmPort=" + alarmPort
                + " alarmType=" + alarmServerType
                + " httpPort=" + httpPort
                + " publicIp=" + publicIp
                + " ingestUrl=" + cloudIngestUrl
                + " heartbeatUrl=" + cloudHeartbeatUrl
                + " photoBaseUrl=" + photoBaseUrl
                + " sdkDir=" + sdkDir
                + " isupKey=" + mask(isupKey) + " perDeviceKeys=" + isupKeys.keySet()
                + " ingestSecret=" + mask(hikIngestSecret);
    }

    private static String mask(String s) {
        if (s == null || s.isEmpty()) return "(empty!)";
        return s.length() <= 4 ? "***" : s.substring(0, 2) + "***" + s.substring(s.length() - 2);
    }
}
