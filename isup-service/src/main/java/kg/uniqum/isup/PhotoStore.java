package kg.uniqum.isup;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Временное in-memory хранилище фото для загрузки лиц.
 *
 * ISUP-загрузка лица работает только через faceURL: терминал сам скачивает
 * картинку по HTTP. Мы кладём фото сюда и отдаём его по одноразовому URL
 * GET /photos/{token} (см. HttpApi). TTL — 10 минут.
 */
public final class PhotoStore {

    private static final long TTL_MS = 10 * 60 * 1000;
    private static final SecureRandom RANDOM = new SecureRandom();

    private record Entry(byte[] data, long storedAt) {}

    private final Map<String, Entry> photos = new ConcurrentHashMap<>();

    /** Сохраняет фото, возвращает токен для URL. */
    public String store(byte[] jpeg) {
        return store(jpeg, "jpg");
    }

    /** Сохраняет произвольный файл (jpg/wav) для скачивания терминалом. */
    public String store(byte[] data, String ext) {
        cleanup();
        byte[] rnd = new byte[16];
        RANDOM.nextBytes(rnd);
        String token = HexFormat.of().formatHex(rnd) + "." + ext;
        photos.put(token, new Entry(data, System.currentTimeMillis()));
        return token;
    }

    /** @return фото или null (не найдено/просрочено). */
    public byte[] get(String token) {
        Entry e = photos.get(token);
        if (e == null) return null;
        if (System.currentTimeMillis() - e.storedAt() > TTL_MS) {
            photos.remove(token);
            return null;
        }
        return e.data();
    }

    private void cleanup() {
        long now = System.currentTimeMillis();
        photos.entrySet().removeIf(e -> now - e.getValue().storedAt() > TTL_MS);
    }

    @Override
    public String toString() {
        return "PhotoStore{" + photos.size() + " photos, ttlMs=" + TTL_MS + "}";
    }
}
