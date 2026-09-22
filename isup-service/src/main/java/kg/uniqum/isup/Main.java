/*
 * Инициализация SDK и listen-серверов адаптирована из
 * https://github.com/oldweipro/hik-isup (Apache-2.0),
 * классы ISUPServiceConfig / StartedUpRunner. См. NOTICE.md.
 */
package kg.uniqum.isup;

import com.fasterxml.jackson.databind.ObjectMapper;
import kg.uniqum.isup.sdk.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.CountDownLatch;

/**
 * ISUP 5.0 listen-сервис для face-терминалов Hikvision (DS-K1T670MX).
 *
 * Терминал за NAT сам подключается СЮДА:
 *  - CMS  (регистрация)  — порт ISUP_CMS_PORT (7660, tcp+udp);
 *  - Alarm (события)      — порт ISUP_ALARM_PORT (7332).
 * Каждый проход форвардится POST-ом на CLOUD_INGEST_URL.
 */
public final class Main {

    private static final Logger log = LoggerFactory.getLogger(Main.class);

    // JNA-callbacks должны жить всё время работы процесса (иначе соберёт GC)
    private static RegisterCallback registerCallback;
    private static AlarmCallback alarmCallback;

    public static void main(String[] args) throws Exception {
        Config config = Config.fromEnv();
        log.info("starting isup-service: {}", config.describe());
        if (config.deviceIds.isEmpty()) {
            log.warn("ISUP_DEVICE_IDS is empty — ANY registration will be rejected");
        }
        if (config.isupKey.isEmpty()) {
            log.warn("ISUP_KEY is empty — ISUP 5.0 auth will fail");
        }

        ObjectMapper json = new ObjectMapper();
        DeviceRegistry registry = new DeviceRegistry();
        EventForwarder forwarder = new EventForwarder(config, json);
        forwarder.start();

        // ---- нативный SDK ----
        HCISUPCMS cms = SdkLoader.loadCms(config.sdkDir);
        HCISUPAlarm alarm = SdkLoader.loadAlarm(config.sdkDir);

        // ---- alarm listen (события) — поднимаем ДО CMS, чтобы устройству
        //      сразу было куда слать события после регистрации ----
        alarmCallback = new AlarmCallback(new EventMapper(json), forwarder);
        NET_EHOME_ALARM_LISTEN_PARAM alarmParam = new NET_EHOME_ALARM_LISTEN_PARAM();
        alarmParam.struAddress.setIp("0.0.0.0");
        alarmParam.struAddress.wPort = (short) config.alarmPort;
        // тип 2 (MQTT, ISUP5.0) слушает TCP-порт; иначе — UDP (как в hik-isup)
        alarmParam.byProtocolType = (byte) (config.alarmServerType == 2 ? 2 : 1);
        alarmParam.byUseCmsPort = 0;
        alarmParam.fnMsgCb = alarmCallback;
        alarmParam.write();
        int alarmHandle = alarm.NET_EALARM_StartListen(alarmParam);
        if (alarmHandle < 0) {
            int err = alarm.NET_EALARM_GetLastError();
            alarm.NET_EALARM_Fini();
            throw new IllegalStateException("NET_EALARM_StartListen failed, error=" + err);
        }
        log.info("alarm listen started on 0.0.0.0:{} (protocol={})", config.alarmPort, alarmParam.byProtocolType);

        // ---- CMS listen (регистрация терминалов) ----
        registerCallback = new RegisterCallback(config, registry, cms, alarm);
        NET_EHOME_CMS_LISTEN_PARAM cmsParam = new NET_EHOME_CMS_LISTEN_PARAM();
        cmsParam.struAddress.setIp("0.0.0.0");
        cmsParam.struAddress.wPort = (short) config.cmsPort;
        cmsParam.fnCB = registerCallback;
        cmsParam.write();
        int cmsHandle = cms.NET_ECMS_StartListen(cmsParam);
        if (cmsHandle < 0) {
            int err = cms.NET_ECMS_GetLastError();
            cms.NET_ECMS_Fini();
            throw new IllegalStateException("NET_ECMS_StartListen failed, error=" + err);
        }
        log.info("CMS listen started on 0.0.0.0:{}", config.cmsPort);

        // ---- локальный HTTP API (/healthz, /enroll, /door, /photos) ----
        PhotoStore photoStore = new PhotoStore();
        FaceEnrollment enrollment = new FaceEnrollment(config, cms, registry, photoStore);
        HttpApi api = new HttpApi(config, json, registry, forwarder, enrollment, enrollment, photoStore);
        api.start();

        // ---- основной канал событий: опрос журнала AcsEvent по CMS-каналу ----
        // (alarm-канал MQTT у DS-K1T670MX нестабилен, см. AcsEventPoller)
        AcsEventPoller poller = new AcsEventPoller(config, registry, enrollment, forwarder, json);
        if (config.pollSeconds > 0) poller.start();
        else log.warn("AcsEvent poller disabled (ISUP_POLL_SECONDS=0)");

        // ---- heartbeat онлайн-терминалов в облако ----
        HeartbeatSender heartbeat = new HeartbeatSender(config, registry, json);
        heartbeat.start();

        // ---- часы терминалов = часы сервера (окна доступа считает терминал) ----
        long clockPeriod = Long.parseLong(System.getenv().getOrDefault("ISUP_CLOCK_SYNC_SECONDS", "1800"));
        ClockSync clockSync = new ClockSync(registry, enrollment, clockPeriod);
        clockSync.start();

        CountDownLatch shutdown = new CountDownLatch(1);
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("shutting down...");
            heartbeat.close();
            poller.close();
            api.stop();
            cms.NET_ECMS_StopListen(cmsHandle);
            alarm.NET_EALARM_StopListen(alarmHandle);
            cms.NET_ECMS_Fini();
            alarm.NET_EALARM_Fini();
            forwarder.close();
            shutdown.countDown();
        }, "shutdown"));

        log.info("isup-service is up (cms:{}, alarm:{}, http:{})",
                config.cmsPort, config.alarmPort, config.httpPort);
        shutdown.await(); // работаем до SIGTERM
    }
}
