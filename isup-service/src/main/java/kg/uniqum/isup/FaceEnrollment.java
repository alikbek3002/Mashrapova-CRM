/*
 * Adapted from the official Hikvision ISUP ACS demo
 * https://github.com/3395207/ISUPSDK_JAVA_DEMO_ACS
 * (AcsUserManagement.addUserInfo, AcsFaceManagement.addFacePicInfo)
 * and from hik-isup CmsUtil.passThrough (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup;

import kg.uniqum.isup.sdk.BYTE_ARRAY;
import kg.uniqum.isup.sdk.HCISUPCMS;
import kg.uniqum.isup.sdk.NET_EHOME_PTXML_PARAM;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Загрузка лица на терминал через ISAPI-passthrough (ISUP 5.0).
 *
 * Порядок (модель «человек в центре», как в демо Hikvision):
 *  1. POST /ISAPI/AccessControl/UserInfo/Record  — создать person (employeeNo);
 *  2. POST /ISAPI/Intelligent/FDLib/FaceDataRecord — привязать фото по faceURL.
 *
 * ВНИМАНИЕ: не тестировалось с живым терминалом.
 * TODO(live-терминал): проверить, что DS-K1T670MX скачивает faceURL по
 *   ISUP_PHOTO_BASE_URL (порт HTTP-API должен быть доступен терминалу, см. README);
 *   штатная альтернатива — ISUP Storage-сервис (libHCISUPSS), в каркасе не поднят.
 * TODO(live-терминал): уточнить коды ответов терминала при повторном создании
 *   person (сейчас "already exist" считается успехом по подстроке).
 */
public final class FaceEnrollment implements HttpApi.EnrollHandler, HttpApi.DoorHandler {

    private static final Logger log = LoggerFactory.getLogger(FaceEnrollment.class);

    private static final int OUT_BUFFER_SIZE = 2 * 1024 * 1024; // как в ACS-демо
    private static final int RECV_TIMEOUT_MS = 5000;

    private final Config config;
    private final HCISUPCMS cms;
    private final DeviceRegistry registry;
    private final PhotoStore photoStore;

    public FaceEnrollment(Config config, HCISUPCMS cms, DeviceRegistry registry, PhotoStore photoStore) {
        this.config = config;
        this.cms = cms;
        this.registry = registry;
        this.photoStore = photoStore;
    }

    /** Бессрочный срок действия (режим «по расписанию» выключен / сотрудники). */
    public static final String VALID_FOREVER_BEGIN = "2023-01-01T00:00:00";
    public static final String VALID_FOREVER_END = "2033-12-30T23:59:59";

    @Override
    public String enroll(String deviceId, String personNo, String name, byte[] photoJpeg,
                         String validBegin, String validEnd) throws Exception {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        int loginId = session.loginId();
        String begin = validBegin == null ? VALID_FOREVER_BEGIN : validBegin;
        String end = validEnd == null ? VALID_FOREVER_END : validEnd;

        // 1. Создаём/обновляем человека (без него лицо не привязать).
        String userBody = template("conf/acs/AddUserInfoParam.json", Map.of(
                "employeeNo", jsonEscape(personNo),
                "name", jsonEscape(name),
                "enable", "true",
                "beginTime", jsonEscape(begin),
                "endTime", jsonEscape(end),
                "doorNo", "1"));
        String userResp = passThrough(loginId, "POST /ISAPI/AccessControl/UserInfo/Record?format=json", userBody);
        log.info("UserInfo/Record for {} -> {}", personNo, userResp);
        boolean existed = userResp.contains("employeeNoAlreadyExist") || userResp.contains("deviceUserAlreadyExist");
        if (!looksOk(userResp) && !existed) {
            throw new IllegalStateException("terminal rejected UserInfo/Record: " + userResp);
        }
        // Персона уже была: Record её не трогает — срок действия приводим отдельно,
        // иначе перезаливка лица при режиме «по расписанию» оставит старое окно.
        if (existed && (validBegin != null || validEnd != null)) {
            setValid(deviceId, personNo, begin, end);
        }

        // 2. Публикуем фото по временному URL и отдаём терминалу faceURL.
        String token = photoStore.store(photoJpeg);
        String faceUrl = config.photoBaseUrl + "/photos/" + token;
        String faceBody = template("conf/acs/AddFaceInfoParam.json", Map.of(
                "employeeNo", jsonEscape(personNo),
                "faceURL", jsonEscape(faceUrl)));
        // терминал сам скачивает фото по faceURL и прогоняет детект лица —
        // это дольше обычного ISAPI-запроса, стандартных 5с не хватает
        String faceResp;
        try {
            faceResp = passThrough(loginId, "POST /ISAPI/Intelligent/FDLib/FaceDataRecord?format=json", faceBody, 25_000);
            log.info("FaceDataRecord for {} -> {}", personNo, faceResp);
            if (!looksOk(faceResp)) {
                throw new IllegalStateException("terminal rejected FaceDataRecord: " + faceResp);
            }
        } catch (Exception first) {
            // Терминал нередко ЗАВЕРШАЕТ операцию, но отвечает позже таймаута.
            // Прежде чем объявлять ошибку — проверяем фактическое наличие лица.
            try { Thread.sleep(3_000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
            if (faceExists(deviceId, personNo)) {
                log.info("FaceDataRecord for {}: ответ не дождались, но лицо НА терминале — успех", personNo);
                faceResp = "{\"statusCode\":1,\"note\":\"verified via FDSearch after slow response\"}";
            } else {
                throw first;
            }
        }
        return faceResp;
    }

    /**
     * Удалённое управление дверью (по образцу AcsParamCfg.remoteControDoor из ACS-демо):
     * PUT /ISAPI/AccessControl/RemoteControl/door/1 с XML-телом &lt;RemoteControlDoor&gt;.
     *
     * @param deviceId ISUP Device ID терминала (должен быть онлайн)
     * @param cmd      open | alwaysOpen | alwaysClose | resume (валидируется в HttpApi)
     * @return тело ответа терминала (XML ResponseStatus)
     */
    // ---- «Свободный проход» на тумбах в импульсном режиме -----------------
    // Терминал честно держит реле (alwaysOpen подтверждён, doorStatus=2), но
    // контроллер турникета расцепляет штангу после каждого прохода. Обход:
    // пока включён свободный проход, повторяем "open" каждые 4с — окна
    // разблокировки (openDuration=5с) перекрываются, проход непрерывный.
    // Аппаратное решение — перевести вход тумбы в потенциальный режим.
    private final ConcurrentHashMap<String, ScheduledFuture<?>> freePulse = new ConcurrentHashMap<>();
    private final ScheduledExecutorService pulseExec =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "free-pass-pulse");
                t.setDaemon(true);
                return t;
            });

    private void setFreePulse(String deviceId, boolean on) {
        ScheduledFuture<?> cur = freePulse.remove(deviceId);
        if (cur != null) cur.cancel(false);
        if (!on) return;
        freePulse.put(deviceId, pulseExec.scheduleWithFixedDelay(() -> {
            try {
                DeviceRegistry.Session s = registry.byDeviceId(deviceId).orElse(null);
                if (s == null) return; // терминал офлайн — тихо ждём
                String body = template("conf/acs/AcsRemoteControlDoor.xml", Map.of("cmd", "open"));
                passThrough(s.loginId(), "PUT /ISAPI/AccessControl/RemoteControl/door/1", body, 4_000);
            } catch (Exception e) {
                log.debug("free-pass pulse failed for {}: {}", deviceId, e.toString());
            }
        }, 4, 4, TimeUnit.SECONDS));
        log.info("free-pass pulse ON for {}", deviceId);
    }

    @Override
    public String controlDoor(String deviceId, String cmd) throws Exception {
        String resp = doControlDoor(deviceId, cmd);
        if (cmd.equals("alwaysOpen")) setFreePulse(deviceId, true);
        else if (!cmd.equals("open")) setFreePulse(deviceId, false);
        return resp;
    }

    private String doControlDoor(String deviceId, String cmd) throws Exception {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        int loginId = session.loginId();

        // Прошивки различаются: V4.48 на DS-K1T670MX отвергает XML-вариант из
        // демо (badParameters). Пробуем диалекты по очереди; "resume" на части
        // прошивок отсутствует — эквивалент возврата в обычный режим — "close".
        String[] cmds = cmd.equals("resume") ? new String[]{"resume", "close"} : new String[]{cmd};
        String lastResp = "";
        for (String c : cmds) {
            // 1) JSON-диалект (новые прошивки MinMoe)
            String jsonResp = tryDoor(loginId,
                    "PUT /ISAPI/AccessControl/RemoteControl/door/1?format=json",
                    "{\"RemoteControlDoor\":{\"cmd\":\"" + c + "\"}}");
            if (jsonResp != null) {
                log.info("RemoteControl/door {} cmd={} (json) -> OK", deviceId, c);
                return jsonResp;
            }
            // 2) XML-диалект (как в официальном ACS-демо)
            String body = template("conf/acs/AcsRemoteControlDoor.xml", Map.of("cmd", c));
            String xmlResp = passThrough(loginId, "PUT /ISAPI/AccessControl/RemoteControl/door/1", body);
            if (looksOk(xmlResp)) {
                log.info("RemoteControl/door {} cmd={} (xml) -> OK", deviceId, c);
                return xmlResp;
            }
            lastResp = xmlResp;
            log.warn("RemoteControl/door {} cmd={} rejected: {}", deviceId, c, xmlResp);
        }
        throw new IllegalStateException("terminal rejected RemoteControl/door: " + lastResp);
    }

    /**
     * Срок действия персоны на терминале (UserInfo.Valid, время локальное,
     * "2026-09-05T16:45:00"). Терминал сам отказывает вне интервала — так
     * backend реализует «пускать за 15 мин до занятия» без участия в проходе.
     * Прошивка V4.48 поддерживает put (Modify) и setUp — пробуем по очереди.
     *
     * @throws PersonNotFoundException персоны нет на терминале — нужна заливка лица
     */
    @Override
    public String setValid(String deviceId, String personNo, String beginLocal, String endLocal) throws Exception {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        int loginId = session.loginId();
        String body = template("conf/acs/ModifyUserValidParam.json", Map.of(
                "employeeNo", jsonEscape(personNo),
                "beginTime", jsonEscape(beginLocal),
                "endTime", jsonEscape(endLocal)));
        String resp = passThrough(loginId, "PUT /ISAPI/AccessControl/UserInfo/Modify?format=json", body, 8_000);
        if (looksOk(resp)) return resp;
        String r = resp.toLowerCase();
        if (r.contains("notexist") || r.contains("not exist") || r.contains("nomatch") || r.contains("employeenonotexist")) {
            throw new PersonNotFoundException(personNo);
        }
        // диалект SetUp (add-or-update) — на части прошивок Modify отсутствует
        String resp2 = passThrough(loginId, "PUT /ISAPI/AccessControl/UserInfo/SetUp?format=json", body, 8_000);
        if (looksOk(resp2)) return resp2;
        log.warn("UserInfo/Modify {} on {} rejected: {} / {}", personNo, deviceId, abbreviate(resp), abbreviate(resp2));
        throw new IllegalStateException("terminal rejected UserInfo/Modify: " + abbreviate(resp));
    }

    /** Персоны с таким employeeNo на терминале нет (лицо не заведено). */
    public static final class PersonNotFoundException extends Exception {
        public PersonNotFoundException(String personNo) { super("person_not_found: " + personNo); }
    }

    /** Есть ли лицо этого person_no на терминале (живой факт, не кэш). */
    @Override
    public boolean faceExists(String deviceId, String personNo) throws Exception {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        String body = template("conf/acs/SearchFaceInfoParam.json", Map.of("employeeNo", jsonEscape(personNo)));
        String resp = passThrough(session.loginId(), "POST /ISAPI/Intelligent/FDLib/FDSearch?format=json", body, 10_000);
        // ответ вида {"totalMatches":1,"numOfMatches":1,...} — ищем счётчик
        var m = java.util.regex.Pattern.compile("\"(?:totalMatches|numOfMatches)\"\\s*:\\s*(\\d+)").matcher(resp);
        return m.find() && Integer.parseInt(m.group(1)) > 0;
    }

    /** Удаляет с терминала лицо и карточку человека (по образцу ACS-демо). */
    @Override
    public void deleteFace(String deviceId, String personNo) throws Exception {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        int loginId = session.loginId();
        String faceBody = template("conf/acs/DeleteFaceInfoParam.json", Map.of("employeeNo", jsonEscape(personNo)));
        String faceResp = passThrough(loginId,
                "PUT /ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&FDID=1&faceLibType=blackFD",
                faceBody, 10_000);
        log.info("FDSearch/Delete {} -> {}", personNo, abbreviate(faceResp));
        String userBody = template("conf/acs/DeleteUserInfoParam.json",
                Map.of("mode", "byEmployeeNo", "employeeNo", jsonEscape(personNo)));
        String userResp = passThrough(loginId,
                "PUT /ISAPI/AccessControl/UserInfoDetail/Delete?format=json", userBody, 10_000);
        log.info("UserInfoDetail/Delete {} -> {}", personNo, abbreviate(userResp));
        // удаление персон на прошивках асинхронное («processing») — это тоже успех
        if (!looksOk(faceResp) && !looksOk(userResp)
                && !faceResp.contains("processing") && !userResp.contains("processing")) {
            throw new IllegalStateException("terminal rejected delete: " + abbreviate(userResp));
        }
    }

    private static String abbreviate(String s) {
        return s != null && s.length() > 200 ? s.substring(0, 200) + "…" : s;
    }

    @Override
    public String rawIsapi(String deviceId, String reqUrl, String body, int timeoutMs) {
        DeviceRegistry.Session session = registry.byDeviceId(deviceId)
                .orElseThrow(() -> new IllegalStateException("device not online: " + deviceId));
        return passThrough(session.loginId(), reqUrl, body, timeoutMs);
    }

    /** Вариант команды двери; null — если терминал отверг (для перебора диалектов). */
    private String tryDoor(int loginId, String reqUrl, String body) {
        try {
            String resp = passThrough(loginId, reqUrl, body);
            return looksOk(resp) ? resp : null;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * ISAPI-passthrough (по образцу CmsUtil.passThrough / AcsFaceManagement).
     *
     * @param loginId handle из callback регистрации
     * @param reqUrl  вида "POST /ISAPI/..."
     * @param reqBody тело запроса (JSON/XML) или пустая строка
     */
    public String passThrough(int loginId, String reqUrl, String reqBody) {
        return passThrough(loginId, reqUrl, reqBody, RECV_TIMEOUT_MS);
    }

    public String passThrough(int loginId, String reqUrl, String reqBody, int timeoutMs) {
        NET_EHOME_PTXML_PARAM param = new NET_EHOME_PTXML_PARAM();
        param.read();

        byte[] urlBytes = reqUrl.getBytes(StandardCharsets.UTF_8);
        BYTE_ARRAY urlBuf = new BYTE_ARRAY(urlBytes.length + 1);
        System.arraycopy(urlBytes, 0, urlBuf.byValue, 0, urlBytes.length);
        urlBuf.write();
        param.pRequestUrl = urlBuf.getPointer();
        param.dwRequestUrlLen = urlBytes.length;

        BYTE_ARRAY inBuf = null;
        if (reqBody != null && !reqBody.isBlank()) {
            byte[] bodyBytes = reqBody.getBytes(StandardCharsets.UTF_8);
            inBuf = new BYTE_ARRAY(bodyBytes.length);
            System.arraycopy(bodyBytes, 0, inBuf.byValue, 0, bodyBytes.length);
            inBuf.write();
            param.pInBuffer = inBuf.getPointer();
            param.dwInSize = bodyBytes.length;
        }

        BYTE_ARRAY outBuf = new BYTE_ARRAY(OUT_BUFFER_SIZE);
        param.pOutBuffer = outBuf.getPointer();
        param.dwOutSize = OUT_BUFFER_SIZE;
        param.dwRecvTimeOut = timeoutMs;
        param.write();

        if (!cms.NET_ECMS_ISAPIPassThrough(loginId, param)) {
            throw new IllegalStateException("NET_ECMS_ISAPIPassThrough failed, url=" + reqUrl
                    + " error=" + cms.NET_ECMS_GetLastError());
        }
        param.read();
        outBuf.read();
        int len = Math.max(0, Math.min(param.dwReturnedXMLLen, OUT_BUFFER_SIZE));
        String out = len > 0
                ? new String(outBuf.byValue, 0, len, StandardCharsets.UTF_8).trim()
                : new String(outBuf.byValue, StandardCharsets.UTF_8).trim();
        return out;
    }

    /** ISAPI ResponseStatus: statusCode 1 / statusString OK / subStatusCode ok. */
    private static boolean looksOk(String response) {
        if (response == null || response.isBlank()) return false;
        // прошивки форматируют JSON по-разному (пробелы/табы) — сравниваем без пробелов
        String r = response.toLowerCase().replaceAll("\\s+", "");
        return r.matches("(?s).*\"statuscode\":1(?!\\d).*")
                || r.contains("<statuscode>1</statuscode>")
                || r.contains("\"substatuscode\":\"ok\"");
    }

    private static String template(String resourcePath, Map<String, String> params) throws Exception {
        try (InputStream in = FaceEnrollment.class.getClassLoader().getResourceAsStream(resourcePath)) {
            if (in == null) throw new IllegalStateException("template not found on classpath: " + resourcePath);
            String content = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            for (Map.Entry<String, String> e : params.entrySet()) {
                content = content.replace("${" + e.getKey() + "}", e.getValue());
            }
            return content;
        }
    }

    private static String jsonEscape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
