/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Pointer;

/** Параметры ISAPI-passthrough (NET_ECMS_ISAPIPassThrough). */
public class NET_EHOME_PTXML_PARAM extends HIKSDKStructure {
    /** URL запроса, напр. "POST /ISAPI/AccessControl/UserInfo/Record?format=json". */
    public Pointer pRequestUrl;
    public int dwRequestUrlLen;
    /** Условие (XML), обычно null. */
    public Pointer pCondBuffer;
    public int dwCondSize;
    /** Тело запроса (XML/JSON). */
    public Pointer pInBuffer;
    public int dwInSize;
    /** Буфер ответа. */
    public Pointer pOutBuffer;
    public int dwOutSize;
    /** Фактическая длина ответа. */
    public int dwReturnedXMLLen;
    /** Таймаут приёма, мс (по умолчанию 5000). */
    public int dwRecvTimeOut;
    public int dwHandle;
    public byte[] byRes = new byte[24];
}
