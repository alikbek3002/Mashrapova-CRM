/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Pointer;

public class NET_EHOME_ALARM_MSG extends HIKSDKStructure {
    /** Тип события, см. IsupConstants.EHOME_ALARM_*. */
    public int dwAlarmType;
    /** Тело события (структура, зависит от dwAlarmType). */
    public Pointer pAlarmInfo;
    public int dwAlarmInfoLen;
    /** Тело события (XML). */
    public Pointer pXmlBuf;
    public int dwXmlBufLen;
    /** Серийный номер устройства. */
    public byte[] sSerialNumber = new byte[12];
    public Pointer pHttpUrl;
    public int dwHttpUrlLen;
    public byte[] byRes = new byte[12];
}
