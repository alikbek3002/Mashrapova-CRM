/*
 * Adapted from https://github.com/oldweipro/hik-isup (Apache-2.0),
 * classes EHOME_REGISTER_TYPE and EHOME_ALARM_TYPE. See NOTICE.md.
 */
package kg.uniqum.isup.sdk;

/** Константы ISUP SDK, используемые сервисом. */
public final class IsupConstants {
    private IsupConstants() {}

    // ---- Типы callback регистрации (DEVICE_REGISTER_CB.dwDataType) ----
    /** Устройство онлайн. */
    public static final int ENUM_DEV_ON = 0;
    /** Устройство офлайн. */
    public static final int ENUM_DEV_OFF = 1;
    /** Адрес устройства изменился. */
    public static final int ENUM_DEV_ADDRESS_CHANGED = 2;
    /** ISUP5.0: запрос ключа авторизации (в pInBuffer нужно записать ISUP_KEY). */
    public static final int ENUM_DEV_AUTH = 3;
    /** ISUP5.0: callback SessionKey. */
    public static final int ENUM_DEV_SESSIONKEY = 4;
    /** ISUP5.0: запрос перенаправления (DAS). */
    public static final int ENUM_DEV_DAS_REQ = 5;
    /** ISUP5.0: запрос SessionKey. */
    public static final int ENUM_DEV_SESSIONKEY_REQ = 6;
    /** Повторная регистрация. */
    public static final int ENUM_DEV_DAS_REREGISTER = 7;
    /** Heartbeat регистрации. */
    public static final int ENUM_DEV_DAS_PINGREO = 8;
    /** Неверный ISUP-ключ. */
    public static final int ENUM_DEV_DAS_EHOMEKEY_ERROR = 9;
    /** Ошибка обмена SessionKey. */
    public static final int ENUM_DEV_SESSIONKEY_ERROR = 10;

    // ---- Типы событий alarm-сервера (NET_EHOME_ALARM_MSG.dwAlarmType) ----
    public static final int EHOME_ALARM = 1;
    public static final int EHOME_ALARM_FACESNAP_REPORT = 3;
    public static final int EHOME_ALARM_NOTICE_PICURL = 6;
    /** События СКУД (сырые XML/JSON данные в pAlarmInfo). */
    public static final int EHOME_ALARM_ACS = 11;
    /** ISAPI-событие (NET_EHOME_ALARM_ISAPI_INFO в pAlarmInfo) — основной путь
     *  для AccessControllerEvent от face-терминалов. */
    public static final int EHOME_ISAPI_ALARM = 13;

    // ---- AccessControllerEvent: major/sub типы (ISAPI) ----
    /** majorEventType «событие» (проходы). */
    public static final int ACS_MAJOR_EVENT = 5;
    /** subEventType: карта — успешный проход. */
    public static final int ACS_SUB_LEGAL_CARD_PASS = 1;
    /** subEventType: лицо — успешная верификация (0x4B). */
    public static final int ACS_SUB_FACE_VERIFY_PASS = 75;
    /** subEventType: лицо — верификация не пройдена (0x4C). */
    public static final int ACS_SUB_FACE_VERIFY_FAIL = 76;
}
