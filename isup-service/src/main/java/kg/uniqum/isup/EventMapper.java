package kg.uniqum.isup;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import kg.uniqum.isup.sdk.IsupConstants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Преобразует сырое событие терминала (JSON ISAPI или XML) в AccessEvent.
 *
 * Ожидаемый JSON от face-терминала (ISAPI поверх ISUP):
 * {
 *   "ipAddress": "...", "dateTime": "2026-08-20T09:30:00+06:00",
 *   "eventType": "AccessControllerEvent", "deviceID": "...",
 *   "AccessControllerEvent": {
 *     "majorEventType": 5, "subEventType": 75,
 *     "employeeNoString": "1234", "serialNo": 118,
 *     "cardReaderNo": 1, "attendanceStatus": "checkIn", ...
 *   }
 * }
 */
public final class EventMapper {

    private static final Logger log = LoggerFactory.getLogger(EventMapper.class);

    private final ObjectMapper json;

    public EventMapper(ObjectMapper json) {
        this.json = json;
    }

    // DS-K1T670MX (прошивка V4.48.0) шлёт ISUP-события в XML PPVSPMessage:
    // <PPVSPMessage><Command>ACS</Command><Params><DeviceID>..</DeviceID>
    // <Time>2026-08-20 14:05:00</Time><MajorType>0x5</MajorType>
    // <MinorType>0x4b</MinorType><serialNo>3</serialNo>...</Params></PPVSPMessage>
    // Time — локальное время терминала без смещения.
    public static final String TZ_OFFSET = envOr("ISUP_TZ_OFFSET", "+06:00");

    /** @return событие или null, если это не событие прохода (heartbeat и т.п.). */
    public AccessEvent map(String deviceSerialFromMsg, String payload) {
        JsonNode root = tryParseJson(payload);
        if (root == null) {
            AccessEvent xml = tryParseXml(deviceSerialFromMsg, payload);
            if (xml == null && payload.contains("<PPVSPMessage>")) {
                log.debug("skip non-access PPVSP message");
            } else if (xml == null) {
                log.warn("unrecognized event payload skipped: {}",
                        payload.length() > 500 ? payload.substring(0, 500) + "…" : payload);
            }
            return xml;
        }

        String eventType = text(root, "eventType");
        if (eventType != null && !"AccessControllerEvent".equalsIgnoreCase(eventType)) {
            // видеоаналитика/heartbeat и прочее — не форвардим на этапе каркаса
            log.debug("skip non-ACS event: {}", eventType);
            return null;
        }

        JsonNode acs = root.path("AccessControllerEvent");
        String deviceSerial = firstNonEmpty(
                text(root, "deviceID"),
                text(root, "devIndex"),
                text(root, "deviceUUID"),
                deviceSerialFromMsg);

        int major = acs.path("majorEventType").asInt(-1);
        int sub = acs.path("subEventType").asInt(-1);

        String type = mapEventType(major, sub);
        String direction = mapDirection(acs);
        String personNo = firstNonEmpty(
                text(acs, "employeeNoString"),
                acs.hasNonNull("employeeNo") ? acs.get("employeeNo").asText() : null);

        String eventSerial = acs.hasNonNull("serialNo")
                ? acs.get("serialNo").asText()
                : sha1(payload);

        String occurredAt = firstNonEmpty(text(root, "dateTime"), OffsetDateTime.now().toString());

        return new AccessEvent(orUnknown(deviceSerial), personNo, eventSerial,
                type, direction, occurredAt, root);
    }

    /** XML PPVSPMessage/ACS → AccessEvent; null для не-проходных сообщений. */
    private AccessEvent tryParseXml(String deviceSerialFromMsg, String payload) {
        if (!payload.contains("<PPVSPMessage>")) return null;
        if (!"ACS".equalsIgnoreCase(xmlTag(payload, "Command"))) return null;

        int major = decodeInt(xmlTag(payload, "MajorType"));
        int minor = decodeInt(xmlTag(payload, "MinorType"));
        // не-проходные события (исключения 0x2, операции 0x3 и т.п.) в журнал не шлём
        if (major != IsupConstants.ACS_MAJOR_EVENT) {
            log.info("skip non-access XML event major={} minor={}", major, minor);
            return null;
        }

        String deviceSerial = firstNonEmpty(xmlTag(payload, "DeviceID"), deviceSerialFromMsg);
        String personNo = firstNonEmpty(
                xmlTag(payload, "EmployeeNoString"), xmlTag(payload, "employeeNoString"),
                xmlTag(payload, "EmployeeNo"), xmlTag(payload, "employeeNo"),
                xmlTag(payload, "CardNo"), xmlTag(payload, "cardNo"));

        String att = xmlTag(payload, "attendanceStatus");
        String direction = "unknown";
        if ("checkIn".equalsIgnoreCase(att)) direction = "in";
        else if ("checkOut".equalsIgnoreCase(att)) direction = "out";
        else {
            String reader = firstNonEmpty(xmlTag(payload, "cardReaderNo"), xmlTag(payload, "CardReaderNo"));
            if ("1".equals(reader)) direction = "in";
            else if ("2".equals(reader)) direction = "out";
        }

        String serialNo = xmlTag(payload, "serialNo");
        String eventSerial = (serialNo != null && !serialNo.isBlank()) ? serialNo : sha1(payload);

        String time = xmlTag(payload, "Time"); // "2026-08-20 14:05:00" (локальное) либо ISO
        String occurredAt;
        if (time == null || time.isBlank()) {
            occurredAt = OffsetDateTime.now().toString();
        } else if (time.contains("+") || time.endsWith("Z")) {
            occurredAt = time.replace(' ', 'T');
        } else {
            occurredAt = time.trim().replace(' ', 'T') + TZ_OFFSET;
        }

        ObjectNode raw = json.createObjectNode();
        raw.put("format", "ppvsp_xml");
        raw.put("major", major);
        raw.put("minor", minor);
        raw.put("raw_text", payload);

        return new AccessEvent(orUnknown(deviceSerial), personNo, eventSerial,
                mapEventType(major, minor), direction, occurredAt, raw);
    }

    private static String xmlTag(String xml, String tag) {
        Matcher m = Pattern.compile("<" + Pattern.quote(tag) + ">(.*?)</" + Pattern.quote(tag) + ">",
                Pattern.DOTALL).matcher(xml);
        if (!m.find()) return null;
        String v = m.group(1).trim();
        return (v.isEmpty() || "undefined".equalsIgnoreCase(v) || "unknown".equalsIgnoreCase(v)) ? null : v;
    }

    /** "0x5" | "5" → 5; -1 если не число. */
    private static int decodeInt(String s) {
        if (s == null || s.isBlank()) return -1;
        try {
            return Integer.decode(s.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String envOr(String name, String def) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? def : v.trim();
    }

    /** Общий маппинг кодов ACS (major/minor десятичные) — используется и поллером. */
    public static String eventTypeFor(int major, int sub) {
        if (major == IsupConstants.ACS_MAJOR_EVENT) {
            if (sub == IsupConstants.ACS_SUB_FACE_VERIFY_PASS) return "face_ok";
            if (sub == IsupConstants.ACS_SUB_FACE_VERIFY_FAIL) return "face_fail";
            if (sub == IsupConstants.ACS_SUB_LEGAL_CARD_PASS) return "card_ok";
        }
        return "other";
    }

    private static String mapEventType(int major, int sub) {
        return eventTypeFor(major, sub);
    }

    private static String mapDirection(JsonNode acs) {
        String attendance = text(acs, "attendanceStatus");
        if (attendance != null) {
            if (attendance.equalsIgnoreCase("checkIn")) return "in";
            if (attendance.equalsIgnoreCase("checkOut")) return "out";
        }
        // соглашение Hikvision по умолчанию: считыватель 1 — вход, 2 — выход
        int reader = acs.path("cardReaderNo").asInt(-1);
        if (reader == 1) return "in";
        if (reader == 2) return "out";
        return "unknown";
    }

    private JsonNode tryParseJson(String payload) {
        String s = payload.trim();
        if (!s.startsWith("{") && !s.startsWith("[")) return null;
        try {
            return json.readTree(s);
        } catch (Exception e) {
            return null;
        }
    }

    private static String text(JsonNode node, String field) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? null : v.asText();
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }

    private static String orUnknown(String s) {
        return (s == null || s.isBlank()) ? "unknown" : s;
    }

    private static String sha1(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            return HexFormat.of().formatHex(md.digest(s.getBytes())).substring(0, 20);
        } catch (Exception e) {
            return Integer.toHexString(s.hashCode());
        }
    }
}
