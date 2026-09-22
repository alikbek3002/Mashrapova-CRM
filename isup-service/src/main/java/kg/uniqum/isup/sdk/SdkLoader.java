/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * class com.oldwei.isup.config.ISUPServiceConfig (linux-only, trimmed). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Native;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Загрузка и инициализация нативных библиотек ISUP SDK (только linux x86_64).
 * Порядок важен: сначала SetSDKInitCfg (пути к libcrypto/libssl), затем *_Init().
 */
public final class SdkLoader {

    private static final Logger log = LoggerFactory.getLogger(SdkLoader.class);

    private SdkLoader() {}

    public static HCISUPCMS loadCms(String sdkDir) {
        String path = sdkDir + "/libHCISUPCMS.so";
        HCISUPCMS cms = Native.load(path, HCISUPCMS.class);
        log.info("loaded {}", path);

        setInitCfg(p -> cms.NET_ECMS_SetSDKInitCfg(0, p), sdkDir + "/libcrypto.so");
        setInitCfg(p -> cms.NET_ECMS_SetSDKInitCfg(1, p), sdkDir + "/libssl.so");

        if (!cms.NET_ECMS_Init()) {
            throw new IllegalStateException("NET_ECMS_Init failed, error=" + cms.NET_ECMS_GetLastError());
        }
        setInitCfg(p -> cms.NET_ECMS_SetSDKLocalCfg(5, p), sdkDir + "/HCAapSDKCom/");
        cms.NET_ECMS_SetLogToFile(3, "/tmp/EHomeSDKLog", true);
        log.info("HCISUPCMS initialized");
        return cms;
    }

    public static HCISUPAlarm loadAlarm(String sdkDir) {
        String path = sdkDir + "/libHCISUPAlarm.so";
        HCISUPAlarm alarm = Native.load(path, HCISUPAlarm.class);
        log.info("loaded {}", path);

        setInitCfg(p -> alarm.NET_EALARM_SetSDKInitCfg(0, p), sdkDir + "/libcrypto.so");
        setInitCfg(p -> alarm.NET_EALARM_SetSDKInitCfg(1, p), sdkDir + "/libssl.so");

        if (!alarm.NET_EALARM_Init()) {
            throw new IllegalStateException("NET_EALARM_Init failed, error=" + alarm.NET_EALARM_GetLastError());
        }
        setInitCfg(p -> alarm.NET_EALARM_SetSDKLocalCfg(5, p), sdkDir + "/HCAapSDKCom/");
        alarm.NET_EALARM_SetLogToFile(3, "/tmp/EHomeSDKLog", true);
        log.info("HCISUPAlarm initialized");
        return alarm;
    }

    /** SDK принимает путь как буфер фиксированного размера 256 байт. */
    private interface CfgCall {
        boolean apply(com.sun.jna.Pointer p);
    }

    private static void setInitCfg(CfgCall call, String pathValue) {
        BYTE_ARRAY buf = new BYTE_ARRAY(256);
        byte[] bytes = pathValue.getBytes();
        System.arraycopy(bytes, 0, buf.byValue, 0, Math.min(bytes.length, 255));
        buf.write();
        if (!call.apply(buf.getPointer())) {
            log.warn("SDK init cfg call failed for path {}", pathValue);
        }
    }
}
