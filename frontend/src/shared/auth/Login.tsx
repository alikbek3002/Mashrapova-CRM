import { useState, type FormEvent } from "react";
import { supabase } from "../api/supabase";
import { UniqumLogo, Icon } from "../../data";
import type { Lang } from "../../data";
import { normalizeE164KG, phoneToPseudoEmail } from "./normalizePhone";

const T = {
  ru: {
    welcome: "Добро пожаловать",
    sub: "Uniqum Sport ERP",
    phone: "Телефон",
    email: "Email",
    password: "Пароль",
    enter: "Войти",
    loading: "Вход...",
    invalid: "Неверные данные или пароль",
    network: "Ошибка соединения. Проверьте интернет",
    showPwd: "Показать пароль",
    hidePwd: "Скрыть пароль",
    byPhone: "По телефону",
    byEmail: "По email",
    phonePlaceholder: "+996 700 12 34 56",
    phoneInvalid: "Введите телефон в формате +996 700 12 34 56",
  },
  ky: {
    welcome: "Кош келиңиз",
    sub: "Uniqum Sport ERP",
    phone: "Телефон",
    email: "Email",
    password: "Сырсөз",
    enter: "Кирүү",
    loading: "Кирүүдө...",
    invalid: "Туура эмес маалымат же сырсөз",
    network: "Туташуу катасы. Интернетти текшериңиз",
    showPwd: "Сырсөздү көрсөтүү",
    hidePwd: "Сырсөздү жашыруу",
    byPhone: "Телефон менен",
    byEmail: "Email менен",
    phonePlaceholder: "+996 700 12 34 56",
    phoneInvalid: "+996 700 12 34 56 форматында жазыңыз",
  },
} as const;

type Mode = "phone" | "email";

export const Login = ({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) => {
  const t = T[lang];
  const [mode, setMode] = useState<Mode>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      let loginEmail: string;
      if (mode === "phone") {
        try {
          loginEmail = phoneToPseudoEmail(phone);
        } catch {
          setErr(t.phoneInvalid);
          setBusy(false);
          return;
        }
        // Также попробуем настоящий email-формат `phone@uniqum.test` для родителей,
        // которых ранее создавали с настоящими email. Сначала пробуем pseudo,
        // если не сработало — пробуем «прямой» E.164 (см. fallback ниже).
      } else {
        loginEmail = email.trim();
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });

      if (error) {
        // Если режим phone и не сработало — пробуем настоящий email через
        // ввод "<phone>@" — но это редкий случай, лучше дать понятную ошибку.
        if (mode === "phone") {
          // Try fallback: maybe user was created with real email AND phone stored.
          // We do not have a way to look up by phone without service role, so
          // surface the standard invalid-credentials error.
        }
        setErr(error.message.toLowerCase().includes("invalid") ? t.invalid : error.message);
      }
    } catch (e: unknown) {
      setErr((e as Error)?.message || t.network);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === "phone"
    ? phone.trim().length >= 7 && password.length > 0
    : email.trim().length > 0 && password.length > 0;

  // Live-валидация телефона (без раздражающего красного при пустом)
  const phoneInvalid = mode === "phone" && phone.length >= 6 && (() => {
    try { normalizeE164KG(phone); return false; } catch { return true; }
  })();

  return (
    <div className="login-page">
      <div className="login-page__lang">
        {(["ru", "ky"] as const).map((l) => (
          <button
            key={l}
            className={`lang-switch__btn ${lang === l ? "is-active" : ""}`}
            onClick={() => setLang(l)}
            type="button"
          >
            {l === "ru" ? "RU" : "КЫ"}
          </button>
        ))}
      </div>

      <form className="login-card" onSubmit={submit}>
        <div className="login-card__brand">
          <UniqumLogo size={56} />
          <div>
            <div className="login-card__title">{t.welcome}</div>
            <div className="login-card__sub">{t.sub}</div>
          </div>
        </div>

        <div className="seg" style={{ marginBottom: 12 }}>
          <button
            type="button"
            className={`seg__btn ${mode === "phone" ? "is-active" : ""}`}
            onClick={() => setMode("phone")}
          >
            {t.byPhone}
          </button>
          <button
            type="button"
            className={`seg__btn ${mode === "email" ? "is-active" : ""}`}
            onClick={() => setMode("email")}
          >
            {t.byEmail}
          </button>
        </div>

        {mode === "phone" ? (
          <label className="login-field">
            <span>{t.phone}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              placeholder={t.phonePlaceholder}
              style={phoneInvalid ? { borderColor: "var(--red-600)" } : undefined}
            />
            {phoneInvalid && (
              <span style={{ color: "var(--red-600)", fontSize: 12, marginTop: 4 }}>
                {t.phoneInvalid}
              </span>
            )}
          </label>
        ) : (
          <label className="login-field">
            <span>{t.email}</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              placeholder="you@uniqum.test"
            />
          </label>
        )}

        <label className="login-field">
          <span>{t.password}</span>
          <div className="login-pwd-wrap">
            <input
              type={showPwd ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              placeholder="••••••••"
            />
            <button
              type="button"
              className="login-pwd-eye"
              onClick={() => setShowPwd((v) => !v)}
              title={showPwd ? t.hidePwd : t.showPwd}
              aria-label={showPwd ? t.hidePwd : t.showPwd}
              tabIndex={-1}
            >
              <Icon name={showPwd ? "eye-off" : "eye"} size={18} />
            </button>
          </div>
        </label>

        {err && <div className="login-error">{err}</div>}

        <button className="login-submit" type="submit" disabled={busy || !canSubmit || phoneInvalid}>
          {busy ? t.loading : t.enter}
        </button>
      </form>
    </div>
  );
};
