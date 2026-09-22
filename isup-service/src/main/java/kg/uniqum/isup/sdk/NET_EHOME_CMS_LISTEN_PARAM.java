/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Pointer;

public class NET_EHOME_CMS_LISTEN_PARAM extends HIKSDKStructure {
    /** Локальный адрес listen; 0.0.0.0 = все интерфейсы. */
    public NET_EHOME_IPADDRESS struAddress = new NET_EHOME_IPADDRESS();
    /** Callback регистрации устройств. */
    public DEVICE_REGISTER_CB fnCB;
    public Pointer pUserData;
    public byte[] byRes = new byte[32];
}
