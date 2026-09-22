/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Pointer;

public class NET_EHOME_ALARM_LISTEN_PARAM extends HIKSDKStructure {
    public NET_EHOME_IPADDRESS struAddress = new NET_EHOME_IPADDRESS();
    /** Callback событий/тревог. */
    public EHomeMsgCallBack fnMsgCb;
    public Pointer pUserData;
    /** Протокол: 0 - TCP, 1 - UDP, 2 - MQTT. */
    public byte byProtocolType;
    /** Переиспользовать порт CMS: 0 - нет, иначе - да. */
    public byte byUseCmsPort;
    /** 0 - использовать пул потоков при callback, 1 - не использовать. */
    public byte byUseThreadPool;
    public byte[] byRes = new byte[29];
}
