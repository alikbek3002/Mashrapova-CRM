import { useState, type FormEvent } from "react";
import { supabase } from "../api/supabase";
import { Icon, I18N } from "../../data";
import type { Lang } from "../../data";
import { phoneToPseudoEmail } from "./normalizePhone";
import { useAuth, DEMO_ACCOUNTS } from "./AuthProvider";

const T = {
  ru: {
    city: "Ош · Кыргызстан",
    heroA: "Академия",
    heroB: "ММА",
    rights: "Академия Машрапова",
    tabLogin: "Вход",
    tabRegister: "Регистрация",
    loginTitle: "Вход",
    loginSub: "Войдите в свой аккаунт академии",
    login: "Телефон или e-mail",
    loginPlaceholder: "+996 700 12 34 56",
    password: "Пароль",
    remember: "Запомнить меня",
    forgot: "Забыли пароль?",
    forgotHint: "Для сброса пароля обратитесь к администратору академии.",
    enter: "Войти",
    loading: "Вход...",
    invalid: "Неверный логин или пароль",
    phoneInvalid: "Введите телефон в формате +996 700 12 34 56",
    network: "Ошибка соединения. Проверьте интернет",
    showPwd: "Показать пароль",
    hidePwd: "Скрыть пароль",
    regTitle: "Регистрация",
    regSub: "Аккаунт активирует администратор академии",
    fullName: "Имя и фамилия",
    fullNamePlaceholder: "Иван Петров",
    phone: "Телефон",
    role: "Роль",
    roles: ["Ученик / родитель", "Тренер", "Администратор", "Владелец"],
    regPassword: "Минимум 8 символов",
    create: "Создать аккаунт",
    regUnavailable: "Регистрация пока не подключена — аккаунт выдаёт администратор академии.",
    demoTitle: "Демо-режим: база не подключена",
    demoAccounts: "Тестовые аккаунты (пароль 123456):",
  },
  ky: {
    city: "Ош · Кыргызстан",
    heroA: "ММА",
    heroB: "академиясы",
    rights: "Машрапов академиясы",
    tabLogin: "Кирүү",
    tabRegister: "Катталуу",
    loginTitle: "Кирүү",
    loginSub: "Академиядагы аккаунтуңузга кириңиз",
    login: "Телефон же e-mail",
    loginPlaceholder: "+996 700 12 34 56",
    password: "Сырсөз",
    remember: "Мени эстеп кал",
    forgot: "Сырсөздү унуттуңузбу?",
    forgotHint: "Сырсөздү калыбына келтирүү үчүн академиянын администраторуна кайрылыңыз.",
    enter: "Кирүү",
    loading: "Кирүүдө...",
    invalid: "Логин же сырсөз туура эмес",
    phoneInvalid: "+996 700 12 34 56 форматында жазыңыз",
    network: "Туташуу катасы. Интернетти текшериңиз",
    showPwd: "Сырсөздү көрсөтүү",
    hidePwd: "Сырсөздү жашыруу",
    regTitle: "Катталуу",
    regSub: "Аккаунтту академиянын администратору активдештирет",
    fullName: "Аты-жөнү",
    fullNamePlaceholder: "Азамат Токтогулов",
    phone: "Телефон",
    role: "Ролу",
    roles: ["Окуучу / ата-эне", "Тренер", "Администратор", "Ээси"],
    regPassword: "Кеминде 8 белги",
    create: "Аккаунт түзүү",
    regUnavailable: "Катталуу азырынча туташтырыла элек — аккаунтту академиянын администратору берет.",
    demoTitle: "Демо-режим: база туташтырылган эмес",
    demoAccounts: "Тесттик аккаунттар (сырсөз 123456):",
  },
} as const;

type Mode = "login" | "register";

// Фото — Unsplash (бесплатная лицензия). Заменить на фото зала, когда будут.
const HERO_PHOTO = "https://images.unsplash.com/photo-1591117207239-788bf8de6c3b?w=1600&q=75&auto=format&fit=crop";

// +996700000000 → «+996 700 00 00 00»
const fmtDemoPhone = (e164: string) => e164.replace(/^\+996(\d{3})(\d{2})(\d{2})(\d{2})$/, "+996 $1 $2 $3 $4");

export const Login = ({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) => {
  const t = T[lang];
  const { demoMode, signInDemo } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setErr(null);
    setInfo(null);
  };

  const submitLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);

    if (demoMode) {
      if (!signInDemo(login, password, remember)) setErr(t.invalid);
      return;
    }

    // Одно поле: есть «@» — это email, иначе телефон (логин через pseudo-email).
    let loginEmail: string;
    if (login.includes("@")) {
      loginEmail = login.trim();
    } else {
      try {
        loginEmail = phoneToPseudoEmail(login);
      } catch {
        setErr(t.phoneInvalid);
        return;
      }
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
      if (error) setErr(error.message.toLowerCase().includes("invalid") ? t.invalid : error.message);
    } catch (e: unknown) {
      setErr((e as Error)?.message || t.network);
    } finally {
      setBusy(false);
    }
  };

  const submitRegister = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(t.regUnavailable);
  };

  return (
    <div className="auth">
      <aside className="auth__hero">
        <div className="auth__photo" style={{ backgroundImage: `url(${HERO_PHOTO})` }} />
        <div className="auth__shade" />
        <div className="auth__logo">
          <img className="auth__logo-img" src="/logo.png" alt="Академия Машрапова" />
          MASHRAPOVA
        </div>
        <div className="auth__hero-body">
          <div className="auth__kicker">{t.city}</div>
          <h2 className="auth__title">
            <span>{t.heroA}</span>
            <span className="auth__title-accent">{t.heroB}</span>
          </h2>
        </div>
        <div className="auth__copy">© {new Date().getFullYear()} {t.rights}</div>
      </aside>

      <main className="auth__side">
        <div className="auth__lang">
          {(["ru", "ky"] as const).map((l) => (
            <button key={l} type="button" className={lang === l ? "is-active" : ""} onClick={() => setLang(l)}>
              {l === "ru" ? "RU" : "КЫ"}
            </button>
          ))}
        </div>
        <div className="auth__panel">
          <div className="auth__tabs">
            <button
              type="button"
              className={`auth__tab ${mode === "login" ? "is-active" : ""}`}
              onClick={() => switchMode("login")}
            >
              {t.tabLogin}
            </button>
            <button
              type="button"
              className={`auth__tab ${mode === "register" ? "is-active" : ""}`}
              onClick={() => switchMode("register")}
            >
              {t.tabRegister}
            </button>
          </div>

          {mode === "login" ? (
            <form onSubmit={submitLogin}>
              <h1 className="auth__h1">{t.loginTitle}</h1>
              <p className="auth__sub">{t.loginSub}</p>

              {demoMode && (
                <div className="auth__demo">
                  <b>{t.demoTitle}</b>
                  <div>{t.demoAccounts}</div>
                  {DEMO_ACCOUNTS.map((a) => (
                    <button
                      key={a.phone}
                      type="button"
                      className="auth__demo-acc"
                      onClick={() => { setLogin(fmtDemoPhone(a.phone)); setPassword(a.password); setErr(null); }}
                    >
                      <span>{(I18N[lang].roles as Record<string, string>)[a.role] ?? a.role}</span>
                      <code>{fmtDemoPhone(a.phone)}</code>
                    </button>
                  ))}
                </div>
              )}

              <div className="auth__fields">
                <label className="auth__field">
                  {t.login}
                  <input
                    className="auth__input"
                    autoComplete="username"
                    required
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    disabled={busy}
                    placeholder={t.loginPlaceholder}
                  />
                </label>
                <label className="auth__field">
                  {t.password}
                  <div className="auth__pwd">
                    <input
                      className="auth__input"
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
                      className="auth__eye"
                      onClick={() => setShowPwd((v) => !v)}
                      title={showPwd ? t.hidePwd : t.showPwd}
                      aria-label={showPwd ? t.hidePwd : t.showPwd}
                      tabIndex={-1}
                    >
                      <Icon name={showPwd ? "eye-off" : "eye"} size={18} />
                    </button>
                  </div>
                </label>
                <div className="auth__row">
                  <label className="auth__check">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    {t.remember}
                  </label>
                  <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); setErr(null); setInfo(t.forgotHint); }}
                  >
                    {t.forgot}
                  </a>
                </div>

                {err && <div className="auth__msg auth__msg--err">{err}</div>}
                {info && <div className="auth__msg">{info}</div>}

                <button className="auth__submit" type="submit" disabled={busy || !login.trim() || !password}>
                  {busy ? t.loading : t.enter}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={submitRegister}>
              <h1 className="auth__h1">{t.regTitle}</h1>
              <p className="auth__sub">{t.regSub}</p>
              <div className="auth__fields">
                <label className="auth__field">
                  {t.fullName}
                  <input className="auth__input" required placeholder={t.fullNamePlaceholder} />
                </label>
                <label className="auth__field">
                  {t.phone}
                  <input className="auth__input" type="tel" inputMode="tel" required placeholder={t.loginPlaceholder} />
                </label>
                <label className="auth__field">
                  {t.role}
                  <select className="auth__input">
                    {t.roles.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <label className="auth__field">
                  {t.password}
                  <input className="auth__input" type="password" required minLength={8} placeholder={t.regPassword} />
                </label>

                {info && <div className="auth__msg">{info}</div>}

                <button className="auth__submit" type="submit">{t.create}</button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};
