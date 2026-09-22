/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0). See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

import com.sun.jna.Callback;
import com.sun.jna.Pointer;

/** Callback событий alarm-сервера. */
public interface EHomeMsgCallBack extends Callback {
    boolean invoke(int iHandle, NET_EHOME_ALARM_MSG pAlarmMsg, Pointer pUser);
}
