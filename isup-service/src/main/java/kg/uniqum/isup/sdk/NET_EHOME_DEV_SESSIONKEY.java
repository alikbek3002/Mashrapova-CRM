/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

public class NET_EHOME_DEV_SESSIONKEY extends HIKSDKStructure {
    public byte[] sDeviceID = new byte[256];
    public byte[] sSessionKey = new byte[16];
}
