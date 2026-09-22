package kg.uniqum.isup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Реестр зарегистрированных (онлайн) терминалов.
 * Ключ — ISUP Device ID, который терминал передаёт при регистрации.
 */
public final class DeviceRegistry {

    private static final Logger log = LoggerFactory.getLogger(DeviceRegistry.class);

    /** Сессия зарегистрированного устройства. */
    public record Session(String deviceId, int loginId, String deviceSerial, Instant registeredAt) {}

    private final Map<String, Session> byDeviceId = new ConcurrentHashMap<>();
    private final Map<Integer, Session> byLoginId = new ConcurrentHashMap<>();

    public void register(String deviceId, int loginId, String deviceSerial) {
        Session s = new Session(deviceId, loginId, deviceSerial, Instant.now());
        byDeviceId.put(deviceId, s);
        byLoginId.put(loginId, s);
        log.info("device ONLINE: id={} loginId={} serial={}", deviceId, loginId, deviceSerial);
    }

    public void unregisterByLoginId(int loginId) {
        Session s = byLoginId.remove(loginId);
        if (s != null) {
            byDeviceId.remove(s.deviceId(), s);
            log.info("device OFFLINE: id={} loginId={}", s.deviceId(), loginId);
        }
    }

    public Optional<Session> byDeviceId(String deviceId) {
        return Optional.ofNullable(byDeviceId.get(deviceId));
    }

    public Optional<Session> byLoginId(int loginId) {
        return Optional.ofNullable(byLoginId.get(loginId));
    }

    public Map<String, Session> snapshot() {
        return Map.copyOf(byDeviceId);
    }
}
