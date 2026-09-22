/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

public class NET_EHOME_DEV_REG_INFO extends HIKSDKStructure {
    public int dwSize;
    public int dwNetUnitType;
    /** ISUP Device ID (то, что вбито на терминале). */
    public byte[] byDeviceID = new byte[256];
    public byte[] byFirmwareVersion = new byte[24];
    public NET_EHOME_IPADDRESS struDevAdd = new NET_EHOME_IPADDRESS();
    public int dwDevType;
    public int dwManufacture;
    public byte[] byPassWord = new byte[32];
    /** Серийный номер устройства (короткий). */
    public byte[] sDeviceSerial = new byte[12];
    public byte byReliableTransmission;
    public byte byWebSocketTransmission;
    public byte bySupportRedirect;
    public byte[] byDevProtocolVersion = new byte[6];
    /** SessionKey устройства (ISUP 5.0). */
    public byte[] bySessionKey = new byte[16];
    public byte byMarketType;
    public byte[] byRes = new byte[26];
}
