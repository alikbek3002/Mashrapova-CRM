/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

/**
 * Информация о серверах, которую CMS отдаёт устройству при регистрации
 * (куда слать события, NTP, картинки и т.д.).
 */
public class NET_EHOME_SERVER_INFO_V50 extends HIKSDKStructure {
    public int dwSize;
    /** Интервал keep-alive, сек (0 = 15с). */
    public int dwKeepAliveSec;
    /** Кол-во пропущенных keep-alive до offline (0 = 6). */
    public int dwTimeOutCount;
    public NET_EHOME_IPADDRESS struTCPAlarmSever = new NET_EHOME_IPADDRESS();
    public NET_EHOME_IPADDRESS struUDPAlarmSever = new NET_EHOME_IPADDRESS();
    /** 0 - только UDP, 1 - UDP+TCP, 2 - MQTT. */
    public int dwAlarmServerType;
    public NET_EHOME_IPADDRESS struNTPSever = new NET_EHOME_IPADDRESS();
    public int dwNTPInterval;
    public NET_EHOME_IPADDRESS struPictureSever = new NET_EHOME_IPADDRESS();
    /** 0 - Tomcat, 1 - VRB, 2 - облако, 3 - KMS, 4 - ISUP5.0. */
    public int dwPicServerType;
    public NET_EHOME_BLACKLIST_SEVER struBlackListServer = new NET_EHOME_BLACKLIST_SEVER();
    public NET_EHOME_IPADDRESS struRedirectSever = new NET_EHOME_IPADDRESS();
    public byte[] byClouldAccessKey = new byte[64];
    public byte[] byClouldSecretKey = new byte[64];
    public byte byClouldHttps;
    public byte[] byRes1 = new byte[3];
    public int dwAlarmKeepAliveSec;
    public int dwAlarmTimeOutCount;
    public int dwClouldPoolId;
    public byte[] byRes = new byte[368];
}
