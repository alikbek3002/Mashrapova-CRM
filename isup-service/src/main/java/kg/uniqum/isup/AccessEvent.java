package kg.uniqum.isup;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

/**
 * Нормализованное событие СКУД, которое форвардится на бэкенд.
 *
 * JSON-форма:
 * {
 *   "device_serial": "...", "person_no": "...", "event_serial": "...",
 *   "event_type": "face_ok"|"face_fail"|"card_ok"|"other",
 *   "direction": "in"|"out"|"unknown",
 *   "occurred_at": "2026-08-20T09:30:00+06:00",
 *   "raw": { ...исходное событие терминала... }
 * }
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AccessEvent(
        @JsonProperty("device_serial") String deviceSerial,
        @JsonProperty("person_no") String personNo,
        @JsonProperty("event_serial") String eventSerial,
        @JsonProperty("event_type") String eventType,
        @JsonProperty("direction") String direction,
        @JsonProperty("occurred_at") String occurredAt,
        @JsonProperty("raw") JsonNode raw
) {
    public String idempotencyKey() {
        return deviceSerial + ":" + eventSerial;
    }
}
