/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * class com.oldwei.isup.sdk.service.HCISUPCMS (trimmed to what this
 * service uses: listen + ISAPI passthrough). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Library;
import com.sun.jna.Pointer;

/** JNA-биндинг libHCISUPCMS.so — регистрация устройств и ISAPI-passthrough. */
public interface HCISUPCMS extends Library {

    boolean NET_ECMS_Init();

    boolean NET_ECMS_Fini();

    /** enumType: 0 - путь к libcrypto.so, 1 - путь к libssl.so. */
    boolean NET_ECMS_SetSDKInitCfg(int enumType, Pointer lpInBuff);

    /** enumType: 5 - путь к каталогу HCAapSDKCom. */
    boolean NET_ECMS_SetSDKLocalCfg(int enumType, Pointer lpInBuff);

    boolean NET_ECMS_SetLogToFile(int iLogLevel, String strLogDir, boolean bAutoDel);

    boolean NET_ECMS_SetDeviceSessionKey(Pointer pDeviceKey);

    /** Запуск listen-сервера регистрации; возвращает handle или -1. */
    int NET_ECMS_StartListen(NET_EHOME_CMS_LISTEN_PARAM lpCMSListenPara);

    boolean NET_ECMS_StopListen(int iListenHandle);

    /** ISAPI-passthrough к устройству по login-handle из callback регистрации. */
    boolean NET_ECMS_ISAPIPassThrough(int lUserID, NET_EHOME_PTXML_PARAM lpParam);

    int NET_ECMS_GetLastError();
}
