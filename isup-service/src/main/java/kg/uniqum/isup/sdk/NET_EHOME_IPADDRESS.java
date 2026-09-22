/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

public class NET_EHOME_IPADDRESS extends HIKSDKStructure {
    public byte[] szIP = new byte[128];
    public short wPort;
    public byte[] byRes = new byte[2];

    /** Заполняет szIP строкой (ASCII). */
    public void setIp(String ip) {
        byte[] b = ip.getBytes();
        System.arraycopy(b, 0, szIP, 0, Math.min(b.length, szIP.length));
    }
}
