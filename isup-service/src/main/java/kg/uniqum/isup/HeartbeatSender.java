package kg.uniqum.isup;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Heartbeat в облако: раз в минуту для каждого онлайн-терминала из
 * DeviceRegistry шлёт POST {"device_serial": "&lt;deviceId&gt;"} на
 * CLOUD_HEARTBEAT_URL (дефолт — ingest-URL с хвостом /heartbeat).
 * Ошибки доставки не критичны (облако лишь отмечает «терминал жив»),
 * поэтому только log.warn, без ретраев — следующий beat через минуту.
 */
public final class HeartbeatSender implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(HeartbeatSender.class);

    private static final long PERIOD_SECONDS = 60;
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final Config config;
    private final DeviceRegistry registry;
    private final ObjectMapper json;
    private final HttpClient http;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "heartbeat-sender");
                t.setDaemon(true);
                return t;
            });

    public HeartbeatSender(Config config, DeviceRegistry registry, ObjectMapper json) {
        this.config = config;
        this.registry = registry;
        this.json = json;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public void start() {
        scheduler.scheduleWithFixedDelay(this::sendAll,
                PERIOD_SECONDS, PERIOD_SECONDS, TimeUnit.SECONDS);
        log.info("HeartbeatSender started: every {}s, target={}", PERIOD_SECONDS, config.cloudHeartbeatUrl);
    }

    private void sendAll() {
        for (DeviceRegistry.Session session : registry.snapshot().values()) {
            try {
                sendOne(session.deviceId());
            } catch (Exception e) {
                // не роняем цикл и не ретраим — следующий beat через минуту
                log.warn("heartbeat failed for device {}: {}", session.deviceId(), e.toString());
            }
        }
    }

    private void sendOne(String deviceId) throws Exception {
        ObjectNode body = json.createObjectNode();
        body.put("device_serial", deviceId);
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.cloudHeartbeatUrl))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + config.hikIngestSecret)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        HttpResponse<String> resp = http.send(request, HttpResponse.BodyHandlers.ofString());
        int code = resp.statusCode();
        if (code < 200 || code >= 300) {
            log.warn("heartbeat for {} returned {}: {}", deviceId, code, resp.body());
        }
    }

    @Override
    public void close() {
        scheduler.shutdownNow();
    }
}
