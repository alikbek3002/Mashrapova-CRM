// Экран второго фактора — ТЗ §12.3.
//
// Показывается между входом и приложением в двух случаях:
//   1. фактор заведён, но в этой сессии не подтверждён → просим код;
//   2. роль обязывает (директор, управляющий), а фактора нет → просим
//      настроить, без этого дальше не пускаем.
//
// Второй случай нельзя проверять в RLS: директор без фактора тогда не
// смог бы войти и его завести. Поэтому правило живёт здесь.
import { useEffect, useState } from "react";
import { Icon } from "../../data";
import type { Lang } from "../../data";
import { useAuth } from "./AuthProvider";
import {
  getMfaState, getVerifiedFactorId, enrollTotp, verifyTotp, mfaErrorText,
  type MfaState,
} from "./mfa";

export const MfaGate = ({ lang, children }: { lang: Lang; children: React.ReactNode }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user, demoMode, signOut } = useAuth();

  const [state, setState] = useState<MfaState | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<{ factorId: string; qrSvg: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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

  // Демо-режим и ещё не загруженное состояние приложение не блокируют.
  if (!user || demoMode || state === null || state === "unknown") return <>{children}</>;
  if (state === "verified") return <>{children}</>;
  if (state === "none" && !required) return <>{children}</>;

  const needsSetup = state === "none";

  const startEnroll = async () => {
    setErr(null); setBusy(true);
    try {
      setEnroll(await enrollTotp());
    } catch (e: unknown) {
      setErr(mfaErrorText((e as Error).message, lang === "ru"));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const id = needsSetup ? enroll?.factorId : factorId;
      if (!id) throw new Error(t("Сначала настройте приложение", "Адегенде колдонмону тууралаңыз"));
      await verifyTotp(id, code);
      setState("verified");
    } catch (e: unknown) {
      setErr(mfaErrorText((e as Error).message, lang === "ru"));
    } finally { setBusy(false); }
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, background: "var(--bg)",
    }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", padding: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Icon name="settings" size={18} />
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>
            {needsSetup
              ? t("Настройте двухфакторный вход", "Эки фактордук кирүүнү тууралаңыз")
              : t("Подтвердите вход", "Кирүүнү ырастаңыз")}
          </div>
        </div>

        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, marginBottom: 14 }}>
          {needsSetup
            ? t("Для вашей роли второй фактор обязателен. Откройте приложение-аутентификатор (Google Authenticator, Authy или менеджер паролей), отсканируйте код и введите шесть цифр.",
                "Ролуңуз үчүн экинчи фактор милдеттүү. Аутентификатор колдонмосун ачып, кодду сканерлеңиз.")
            : t("Введите шесть цифр из приложения-аутентификатора.",
                "Аутентификатор колдонмосунан алты сандык кодду киргизиңиз.")}
        </div>

        {needsSetup && !enroll && (
          <button className="btn btn--primary" onClick={startEnroll} disabled={busy} style={{ width: "100%" }}>
            {busy ? "…" : t("Показать QR-код", "QR-кодду көрсөтүү")}
          </button>
        )}

        {needsSetup && enroll && (
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                display: "flex", justifyContent: "center", padding: 10,
                background: "#fff", borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
              }}
              // QR приходит от Supabase как SVG-разметка; другого способа
              // показать его нет.
              dangerouslySetInnerHTML={{ __html: enroll.qrSvg }}
            />
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.45 }}>
              {t("Не сканируется? Введите код вручную:", "Сканерленбейби? Кодду кол менен киргизиңиз:")}{" "}
              <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{enroll.secret}</code>
            </div>
          </div>
        )}

        {(!needsSetup || enroll) && (
          <>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={7}
              style={{
                width: "100%", fontFamily: "var(--font-mono)", fontSize: 20,
                letterSpacing: 4, textAlign: "center", marginBottom: 10,
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length >= 6) submit(); }}
            />
            <button
              className="btn btn--primary"
              onClick={submit}
              disabled={busy || code.replace(/\s/g, "").length < 6}
              style={{ width: "100%" }}
            >
              {busy ? "…" : t("Подтвердить", "Ырастоо")}
            </button>
          </>
        )}

        {err && <div className="field__error" style={{ marginTop: 10 }}>{err}</div>}

        <button
          className="btn btn--ghost"
          onClick={signOut}
          style={{ width: "100%", marginTop: 10 }}
        >
          {t("Выйти", "Чыгуу")}
        </button>
      </div>
    </div>
  );
};
