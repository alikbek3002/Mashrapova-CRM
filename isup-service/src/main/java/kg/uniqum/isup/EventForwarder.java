package kg.uniqum.isup;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Форвардер событий на бэкенд: in-memory очередь + один воркер,
 * ретраи с экспоненциальным бэкоффом. При переполнении очереди или
 * исчерпании ретраев событие дропается с логом (терминал хранит
 * события локально, их можно дочитать позже через поиск событий).
 */
public final class EventForwarder implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(EventForwarder.class);

    private static final int QUEUE_CAPACITY = 10_000;
    private static final int MAX_ATTEMPTS = 8;               // ~ 2+4+8+...+256 сек суммарно
    private static final Duration BASE_BACKOFF = Duration.ofSeconds(2);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final Config config;
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final BlockingQueue<AccessEvent> queue = new LinkedBlockingQueue<>(QUEUE_CAPACITY);
    private final Thread worker;
    private volatile boolean running = true;

    private final AtomicLong forwarded = new AtomicLong();
    private final AtomicLong dropped = new AtomicLong();

    public EventForwarder(Config config, ObjectMapper mapper) {
        this.config = config;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
        this.worker = new Thread(this::runLoop, "event-forwarder");
        this.worker.setDaemon(true);
    }

    public void start() {
        worker.start();
        log.info("EventForwarder started, target={}", config.cloudIngestUrl);
    }

    /** Кладёт событие в очередь; при переполнении дропает с логом. */
    public void submit(AccessEvent event) {
        if (!queue.offer(event)) {
            dropped.incrementAndGet();
            log.error("DROP (queue full, {} events): {}", QUEUE_CAPACITY, event.idempotencyKey());
        }
    }

    public long forwardedCount() { return forwarded.get(); }
    public long droppedCount() { return dropped.get(); }
    public int queueSize() { return queue.size(); }

    private void runLoop() {
        while (running) {
            AccessEvent event;
            try {
                event = queue.take();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            deliverWithRetry(event);
        }
    }

    private void deliverWithRetry(AccessEvent event) {
        for (int attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                if (deliverOnce(event)) {
                    forwarded.incrementAndGet();
                    return;
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                log.warn("forward attempt {}/{} failed for {}: {}",
                        attempt, MAX_ATTEMPTS, event.idempotencyKey(), e.toString());
            }
            if (attempt < MAX_ATTEMPTS) {
                long sleepMs = BASE_BACKOFF.toMillis() * (1L << (attempt - 1));
                try {
                    Thread.sleep(Math.min(sleepMs, 300_000));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        dropped.incrementAndGet();
        log.error("DROP (retries exhausted) event {}: {}", event.idempotencyKey(), safeJson(event));
    }

    /** true = доставлено (2xx) или дубликат/невалидное на стороне бэка (4xx кроме 401/403/429). */
    private boolean deliverOnce(AccessEvent event) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(config.cloudIngestUrl))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + config.hikIngestSecret)
                .header("Idempotency-Key", event.idempotencyKey())
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(event)))
                .build();
        HttpResponse<String> resp = http.send(request, HttpResponse.BodyHandlers.ofString());
        int code = resp.statusCode();
        if (code >= 200 && code < 300) {
            log.info("forwarded {} -> {}", event.idempotencyKey(), code);
            return true;
        }
        // 401/403 — неправильный секрет, 429 — перегруз: ретраим.
        // Остальные 4xx — бэкенд событие не примет никогда, ретраить бессмысленно.
        if (code >= 400 && code < 500 && code != 401 && code != 403 && code != 429) {
            log.error("backend rejected {} with {}: {}", event.idempotencyKey(), code, resp.body());
            return true;
        }
        log.warn("backend returned {} for {}", code, event.idempotencyKey());
        return false;
    }

    private String safeJson(AccessEvent event) {
        try {
            return mapper.writeValueAsString(event);
        } catch (Exception e) {
            return String.valueOf(event);
        }
    }

    @Override
    public void close() {
        running = false;
        worker.interrupt();
    }
}
