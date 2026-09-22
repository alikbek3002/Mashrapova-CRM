/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * class com.oldwei.isup.sdk.service.impl.FRegisterCallBack. See NOTICE.md.
 */
package kg.uniqum.isup;

import com.sun.jna.Pointer;
import kg.uniqum.isup.sdk.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * Callback регистрации терминала (ISUP 5.0):
 *  - AUTH: отдаём ISUP_KEY (SDK сам сверяет ключ с терминалом);
 *  - ON:   проверяем Device ID по allowlist, сообщаем адрес alarm-сервера;
 *  - SESSIONKEY: прокидываем ключ сессии в CMS и Alarm SDK;
 *  - OFF:  убираем устройство из реестра.
 */
public final class RegisterCallback implements DEVICE_REGISTER_CB {

    private static final Logger log = LoggerFactory.getLogger(RegisterCallback.class);

    private final Config config;
    private final DeviceRegistry registry;
    private final HCISUPCMS cms;
    private final HCISUPAlarm alarm;

    public RegisterCallback(Config config, DeviceRegistry registry, HCISUPCMS cms, HCISUPAlarm alarm) {
        this.config = config;
        this.registry = registry;
        this.cms = cms;
        this.alarm = alarm;
    }

    @Override
    public boolean invoke(int lUserID, int dwDataType, Pointer pOutBuffer, int dwOutLen,
                          Pointer pInBuffer, int dwInLen, Pointer pUser) {
        try {
            switch (dwDataType) {
                case IsupConstants.ENUM_DEV_ON:
                    return onDeviceOnline(lUserID, pOutBuffer, pInBuffer);
                case IsupConstants.ENUM_DEV_OFF:
                    registry.unregisterByLoginId(lUserID);
                    return true;
                case IsupConstants.ENUM_DEV_AUTH:
                    return onAuth(pOutBuffer, pInBuffer);
                case IsupConstants.ENUM_DEV_SESSIONKEY:
                    return onSessionKey(pOutBuffer);
                case IsupConstants.ENUM_DEV_DAS_REQ:
                    return onDasRequest(pInBuffer);
                case IsupConstants.ENUM_DEV_DAS_EHOMEKEY_ERROR:
                    log.warn("device sent WRONG ISUP key (check ISUP_KEY on terminal), loginId={}", lUserID);
                    return true;
                case IsupConstants.ENUM_DEV_SESSIONKEY_ERROR:
                    log.warn("session key exchange error, loginId={}", lUserID);
                    return true;
                default:
                    log.debug("register callback: unhandled dwDataType={} loginId={}", dwDataType, lUserID);
                    return true;
            }
        } catch (Exception e) {
            // из JNA-callback исключение выпускать нельзя
            log.error("register callback failed, dwDataType=" + dwDataType, e);
            return false;
        }
    }

    private boolean onDeviceOnline(int lUserID, Pointer pOutBuffer, Pointer pInBuffer) {
        NET_EHOME_DEV_REG_INFO_V12 reg = new NET_EHOME_DEV_REG_INFO_V12();
        readStruct(pOutBuffer, reg);
        String deviceId = trimmed(reg.struRegInfo.byDeviceID);
        String serial = trimmed(reg.byDeviceFullSerial);
        if (serial.isEmpty()) serial = trimmed(reg.struRegInfo.sDeviceSerial);

        if (!config.isDeviceAllowed(deviceId)) {
            log.warn("REJECT unknown device: id='{}' serial='{}' (allowlist: {})",
                    deviceId, serial, config.deviceIds);
            return false;
        }

        // Сообщаем устройству, куда слать события (alarm-сервер).
        NET_EHOME_SERVER_INFO_V50 info = new NET_EHOME_SERVER_INFO_V50();
        info.read();
        info.struTCPAlarmSever.setIp(config.publicIp);
        info.struTCPAlarmSever.wPort = (short) config.alarmPort;
        info.struUDPAlarmSever.setIp(config.publicIp);
        info.struUDPAlarmSever.wPort = (short) config.alarmPort;
        info.dwAlarmServerType = config.alarmServerType;
        info.write();
        int len = info.size();
        pInBuffer.write(0, info.getPointer().getByteArray(0, len), 0, len);

        registry.register(deviceId, lUserID, serial.isEmpty() ? deviceId : serial);
        return true;
    }

    private boolean onAuth(Pointer pOutBuffer, Pointer pInBuffer) {
        NET_EHOME_DEV_REG_INFO_V12 reg = new NET_EHOME_DEV_REG_INFO_V12();
        readStruct(pOutBuffer, reg);
        String deviceId = trimmed(reg.struRegInfo.byDeviceID);
        if (!config.isDeviceAllowed(deviceId)) {
            log.warn("AUTH rejected, unknown device id: '{}'", deviceId);
            return false;
        }
        byte[] key = config.keyFor(deviceId).getBytes(StandardCharsets.US_ASCII);
        pInBuffer.write(0, key, 0, key.length);
        log.info("AUTH request from device '{}' -> ISUP key provided", deviceId);
        return true;
    }

    private boolean onSessionKey(Pointer pOutBuffer) {
        NET_EHOME_DEV_REG_INFO_V12 reg = new NET_EHOME_DEV_REG_INFO_V12();
        readStruct(pOutBuffer, reg);
        NET_EHOME_DEV_SESSIONKEY sessionKey = new NET_EHOME_DEV_SESSIONKEY();
        System.arraycopy(reg.struRegInfo.byDeviceID, 0, sessionKey.sDeviceID, 0,
                reg.struRegInfo.byDeviceID.length);
        System.arraycopy(reg.struRegInfo.bySessionKey, 0, sessionKey.sSessionKey, 0,
                reg.struRegInfo.bySessionKey.length);
        sessionKey.write();
        Pointer p = sessionKey.getPointer();
        boolean cmsOk = cms.NET_ECMS_SetDeviceSessionKey(p);
        boolean alarmOk = alarm.NET_EALARM_SetDeviceSessionKey(p);
        log.info("session key set for device '{}' (cms={}, alarm={})",
                trimmed(reg.struRegInfo.byDeviceID), cmsOk, alarmOk);
        return true;
    }

    private boolean onDasRequest(Pointer pInBuffer) {
        // Терминал спрашивает, куда регистрироваться (DAS = сам этот CMS).
        String dasInfo = "{\n" +
                "  \"Type\":\"DAS\",\n" +
                "  \"DasInfo\": {\n" +
                "    \"Address\":\"" + config.publicIp + "\",\n" +
                "    \"Domain\":\"\",\n" +
                "    \"ServerID\":\"\",\n" +
                "    \"Port\":" + config.cmsPort + ",\n" +
                "    \"UdpPort\":" + config.cmsPort + "\n" +
                "  }\n" +
                "}";
        byte[] bytes = dasInfo.getBytes(StandardCharsets.US_ASCII);
        pInBuffer.write(0, bytes, 0, bytes.length);
        log.info("DAS request -> {}:{}", config.publicIp, config.cmsPort);
        return true;
    }

    /** Копирует память по указателю в JNA-структуру (паттерн из hik-isup). */
    private static void readStruct(Pointer src, HIKSDKStructure dst) {
        dst.write();
        dst.getPointer().write(0, src.getByteArray(0, dst.size()), 0, dst.size());
        dst.read();
    }

    private static String trimmed(byte[] cstr) {
        int end = 0;
        while (end < cstr.length && cstr[end] != 0) end++;
        return new String(cstr, 0, end, StandardCharsets.US_ASCII).trim();
    }
}
