/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import java.util.List;

public class BYTE_ARRAY extends HIKSDKStructure {
    public byte[] byValue;

    public BYTE_ARRAY(int iLen) {
        byValue = new byte[iLen];
    }

    @Override
    protected List<String> getFieldOrder() {
        return List.of("byValue");
    }
}
