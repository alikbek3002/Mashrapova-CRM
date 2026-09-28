// Экран второго фактора — ТЗ §12.3 («двухфакторная аутентификация для
// директора и управляющего»).
//
// Показывается между входом и приложением в двух случаях:
//   1. фактор заведён, но в этой сессии не подтверждён → просим код;
//   2. роль обязывает (директор, управляющий), а фактора нет → просим
//      настроить, без этого дальше не пускаем.
//
// Второй случай нельзя проверять в RLS: директор без фактора тогда не
// смог бы войти и его завести. Поэтому правило живёт здесь.
//
// Сделано максимально просто: QR появляется сразу, на телефоне есть
// кнопка «добавить в приложение», код подтверждается сам на шестой цифре.
import { useEffect, useRef, useState } from "react";
import type { Lang } from "../../data";
import { useAuth } from "./AuthProvider";
import {
  getMfaState, getVerifiedFactorId, enrollTotp, verifyTotp, mfaErrorText,
  type MfaState, type TotpEnrollment,
} from "./mfa";

const APP_STORE = "https://apps.apple.com/app/google-authenticator/id388497605";
const GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2";

const isPhone = () => typeof navigator !== "undefined" && /iphone|ipad|android/i.test(navigator.userAgent);

export const MfaGate = ({ lang, children }: { lang: Lang; children: React.ReactNode }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user, demoMode, signOut } = useAuth();

  const [state, setState] = useState<MfaState | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const enrollStarted = useRef(false);

  // Требование второго фактора берём из профиля: его держит в синхроне
  // с ролью триггер sync_mfa_required (ТЗ §12.3).
  const required = !!(user as { mfa_required?: boolean } | null)?.mfa_required;

  useEffect(() => {
    if (!user || demoMode) { setState("unknown"); return; }
    let cancelled = false;
    (async () => {
      const s = await getMfaState();
      const fid = await getVerifiedFactorId();
      if (cancelled) return;
      setState(s);
      setFactorId(fid);
    })();
    return () => { cancelled = true; };
  }, [user, demoMode]);

  const needsSetup = state === "none" && required;
  const needsCode = state === "challenge_required";

  // Настройка: QR показываем сразу, без лишней кнопки.
  useEffect(() => {
    if (!needsSetup || enrollStarted.current) return;
    enrollStarted.current = true;
    setBusy(true);
    enrollTotp()
      .then(setEnroll)
      .catch((e: Error) => setErr(mfaErrorText(e.message, lang === "ru")))
      .finally(() => setBusy(false));
  }, [needsSetup, lang]);

  useEffect(() => {
    if (needsCode || enroll) codeRef.current?.focus();
  }, [needsCode, enroll]);

  // Демо-режим и ещё не загруженное состояние приложение не блокируют.
  if (!user || demoMode || state === null || state === "unknown") return <>{children}</>;
  if (state === "verified") return <>{children}</>;
  if (state === "none" && !required) return <>{children}</>;

  const submit = async (value: string) => {
    if (busy) return;
    setErr(null); setBusy(true);
    try {
      const id = needsSetup ? enroll?.factorId : factorId;
      if (!id) throw new Error(t("Сначала добавьте аккаунт в приложение", "Адегенде аккаунтту колдонмого кошуңуз"));
      await verifyTotp(id, value);
      setState("verified");
    } catch (e: unknown) {
      setErr(mfaErrorText((e as Error).message, lang === "ru"));
      setCode("");
      codeRef.current?.focus();
    } finally { setBusy(false); }
  };

  // Код подтверждается сам, как только набраны 6 цифр.
  const onCode = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) submit(digits);
  };

  const copySecret = async () => {
    if (!enroll) return;
    try { await navigator.clipboard.writeText(enroll.secret); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* нет доступа к буферу */ }
  };

  const codeField = (
    <div className="mfa-code">
      <input
        ref={codeRef}
        value={code}
        onChange={(e) => onCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={busy}
        aria-label={t("Код из приложения", "Колдонмодогу код")}
      />
      <div className="mfa-code__cells" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <span key={i} className={`mfa-code__cell${i === code.length && !busy ? " is-active" : ""}${code[i] ? " is-filled" : ""}`}>
            {code[i] ?? ""}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mfa">
      <div className="mfa__card">
        <img className="mfa__logo" src="/logo.png" alt="" />

        {needsCode ? (
          <>
            <h1 className="mfa__title">{t("Код входа", "Кирүү коду")}</h1>
            <p className="mfa__text">
              {t("Откройте Google Authenticator и введите 6 цифр «Академия Машрапова».",
                 "Google Authenticator'ду ачып, «Академия Машрапова» алты санын жазыңыз.")}
            </p>
            {codeField}
          </>
        ) : (
          <>
            <h1 className="mfa__title">{t("Защита входа", "Кирүүнү коргоо")}</h1>
            <p className="mfa__text">
              {t("Для директора и управляющего вход подтверждается кодом с телефона. Настройка — один раз, около минуты.",
                 "Директор жана башкаруучу үчүн кирүү телефондогу код менен ырасталат. Бир жолу, болжол менен бир мүнөт.")}
            </p>

            <ol className="mfa__steps">
              <li>
                <b>{t("Установите Google Authenticator", "Google Authenticator орнотуңуз")}</b>
                <div className="mfa__stores">
                  <a href={APP_STORE} target="_blank" rel="noreferrer">App Store</a>
                  <a href={GOOGLE_PLAY} target="_blank" rel="noreferrer">Google Play</a>
                </div>
              </li>
              <li>
                <b>{isPhone()
                  ? t("Добавьте аккаунт кнопкой ниже", "Төмөнкү баскыч менен аккаунт кошуңуз")
                  : t("В приложении нажмите «+» и отсканируйте код", "Колдонмодо «+» басып, кодду сканерлеңиз")}</b>
                {enroll ? (
                  <>
                    {isPhone() ? (
                      <a className="mfa__add" href={enroll.uri}>{t("Добавить в Google Authenticator", "Google Authenticator'го кошуу")}</a>
                    ) : (
                      <img className="mfa__qr" src={enroll.qrSrc} alt={t("QR-код для приложения", "Колдонмо үчүн QR-код")} />
                    )}
                    <button type="button" className="mfa__secret" onClick={copySecret} title={t("Скопировать", "Көчүрүү")}>
                      <span>{t("или ключ вручную:", "же ачкычты кол менен:")}</span>
                      <code>{enroll.secret.match(/.{1,4}/g)?.join(" ")}</code>
                      <em>{copied ? t("скопировано", "көчүрүлдү") : t("копировать", "көчүрүү")}</em>
                    </button>
                  </>
                ) : (
                  <div className="mfa__qr mfa__qr--loading"><span className="sk" style={{ width: "100%", height: "100%" }} /></div>
                )}
              </li>
              <li>
                <b>{t("Введите 6 цифр из приложения", "Колдонмодогу 6 санды жазыңыз")}</b>
                {codeField}
              </li>
            </ol>
          </>
        )}

        {busy && enroll && code.length === 6 && <div className="mfa__hint">{t("Проверяем…", "Текшерилүүдө…")}</div>}
        {err && <div className="mfa__err">{err}</div>}

        <button type="button" className="mfa__out" onClick={signOut}>{t("Выйти", "Чыгуу")}</button>
      </div>
    </div>
  );
};
