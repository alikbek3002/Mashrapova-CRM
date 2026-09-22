/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * class com.oldwei.isup.sdk.service.IHikISUPAlarm. See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Library;
import com.sun.jna.Pointer;

/** JNA-биндинг libHCISUPAlarm.so — приём событий/тревог от устройств. */
public interface HCISUPAlarm extends Library {

    boolean NET_EALARM_Init();

    boolean NET_EALARM_Fini();

    /** enumType: 0 - путь к libcrypto.so, 1 - путь к libssl.so. */
    boolean NET_EALARM_SetSDKInitCfg(int enumType, Pointer lpInBuff);

    /** enumType: 5 - путь к каталогу HCAapSDKCom. */
    boolean NET_EALARM_SetSDKLocalCfg(int enumType, Pointer lpInbuffer);

    /** Запуск alarm listen-сервера; возвращает handle или -1. */
    int NET_EALARM_StartListen(NET_EHOME_ALARM_LISTEN_PARAM pAlarmListenParam);

    boolean NET_EALARM_StopListen(int iListenHandle);

    boolean NET_EALARM_SetDeviceSessionKey(Pointer pDeviceKey);

    boolean NET_EALARM_SetLogToFile(int iLogLevel, String strLogDir, boolean bAutoDel);

    int NET_EALARM_GetLastError();
}
