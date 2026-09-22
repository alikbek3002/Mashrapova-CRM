/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Pointer;

public class NET_EHOME_ALARM_ISAPI_INFO extends HIKSDKStructure {
    /** Данные события (XML или JSON). */
    public Pointer pAlarmData;
    public int dwAlarmDataLen;
    /** 0 - invalid, 1 - xml, 2 - json. */
    public byte byDataType;
    /** Кол-во картинок. */
    public byte byPicturesNumber;
    public byte[] byRes = new byte[2];
    /** byPicturesNumber структур NET_EHOME_ALARM_ISAPI_PICDATA. */
    public Pointer pPicPackData;
    public byte[] byRes1 = new byte[32];
}
