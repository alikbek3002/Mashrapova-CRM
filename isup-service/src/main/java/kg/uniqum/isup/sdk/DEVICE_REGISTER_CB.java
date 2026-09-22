/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Callback;
import com.sun.jna.Pointer;

/** Callback регистрации устройства (CMS). dwDataType — см. IsupConstants.ENUM_DEV_*. */
public interface DEVICE_REGISTER_CB extends Callback {
    boolean invoke(int lUserID, int dwDataType, Pointer pOutBuffer, int dwOutLen,
                   Pointer pInBuffer, int dwInLen, Pointer pUser);
}
