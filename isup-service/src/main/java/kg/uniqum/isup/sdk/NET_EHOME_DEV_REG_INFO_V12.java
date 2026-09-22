/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

public class NET_EHOME_DEV_REG_INFO_V12 extends HIKSDKStructure {
    public NET_EHOME_DEV_REG_INFO struRegInfo = new NET_EHOME_DEV_REG_INFO();
    public NET_EHOME_IPADDRESS struRegAddr = new NET_EHOME_IPADDRESS();
    public byte[] sDevName = new byte[64];
    /** Полный серийный номер устройства. */
    public byte[] byDeviceFullSerial = new byte[64];
    public byte[] byRes = new byte[128];
}
