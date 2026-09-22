/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0), class
 * com.oldwei.isup.sdk.service.impl.AlarmMsgCallBack, and from the official
 * Hikvision ACS demo (AlarmEventHandle). See NOTICE.md.
 */
package kg.uniqum.isup;

import com.sun.jna.Pointer;
import kg.uniqum.isup.sdk.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;

/**
 * Callback alarm-сервера: вытаскивает текстовое тело события
 * (JSON/XML) и отдаёт его в EventMapper -> EventForwarder.
 *
 * Для face-терминалов события проходов приходят как:
 *  - EHOME_ISAPI_ALARM (13): NET_EHOME_ALARM_ISAPI_INFO с JSON
 *    {"eventType":"AccessControllerEvent", "AccessControllerEvent":{...}}
 *  - EHOME_ALARM_ACS (11): сырой XML/JSON в pAlarmInfo
 */
public final class AlarmCallback implements EHomeMsgCallBack {

    private static final Logger log = LoggerFactory.getLogger(AlarmCallback.class);

    private final EventMapper mapper;
    private final EventForwarder forwarder;

    public AlarmCallback(EventMapper mapper, EventForwarder forwarder) {
        this.mapper = mapper;
        this.forwarder = forwarder;
    }

    @Override
    public boolean invoke(int iHandle, NET_EHOME_ALARM_MSG pAlarmMsg, Pointer pUser) {
        try {
            String deviceSerial = trimmed(pAlarmMsg.sSerialNumber);
            String payload = extractPayload(pAlarmMsg);
            if (payload == null || payload.isBlank()) {
                log.debug("alarm type {} without textual payload, skipped", pAlarmMsg.dwAlarmType);
                return true;
            }
            log.debug("alarm type={} serial={} payload={}", pAlarmMsg.dwAlarmType, deviceSerial, payload);
            AccessEvent event = mapper.map(deviceSerial, payload);
            if (event != null) {
                forwarder.submit(event);
            }
        } catch (Exception e) {
            // из JNA-callback исключение выпускать нельзя
            log.error("alarm callback failed", e);
        }
        return true;
    }

    private String extractPayload(NET_EHOME_ALARM_MSG msg) {
        // XML-вариант (часть прошивок шлёт события целиком в pXmlBuf)
        if (msg.dwXmlBufLen > 0 && msg.pXmlBuf != null) {
            return readString(msg.pXmlBuf, msg.dwXmlBufLen);
        }
        if (msg.pAlarmInfo == null || msg.dwAlarmInfoLen <= 0) {
            return null;
        }
        switch (msg.dwAlarmType) {
            case IsupConstants.EHOME_ISAPI_ALARM: {
                NET_EHOME_ALARM_ISAPI_INFO isapi = new NET_EHOME_ALARM_ISAPI_INFO();
                isapi.write();
                isapi.getPointer().write(0, msg.pAlarmInfo.getByteArray(0, isapi.size()), 0, isapi.size());
                isapi.read();
                if (isapi.pAlarmData == null || isapi.dwAlarmDataLen <= 0 || isapi.byDataType == 0) {
                    return null;
                }
                return readString(isapi.pAlarmData, isapi.dwAlarmDataLen);
            }
            case IsupConstants.EHOME_ALARM_ACS:
                // тело события — сырой XML/JSON, читаем как текст (как в ACS-демо)
                return readString(msg.pAlarmInfo, msg.dwAlarmInfoLen);
            default:
                log.debug("unhandled alarm type {}", msg.dwAlarmType);
                return null;
        }
    }

    private static String readString(Pointer p, int len) {
        byte[] bytes = p.getByteArray(0, len);
        return new String(bytes, StandardCharsets.UTF_8).trim();
    }

    private static String trimmed(byte[] cstr) {
        int end = 0;
        while (end < cstr.length && cstr[end] != 0) end++;
        return new String(cstr, 0, end, StandardCharsets.US_ASCII).trim();
    }
}
