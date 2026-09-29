// Предложение сменить временный пароль после входа.
//
// Сотрудникам, которых заводят вручную, выдают временный пароль и ставят в
// метаданные учётки must_change_password: true (user_metadata в Supabase
// Auth — без миграции). Пока метка стоит, после входа показываем это окно.
// Смена пароля снимает метку тем же запросом.
//
// Это предложение, а не требование: «Позже» прячет окно до конца сеанса во
// вкладке, при следующем входе оно появится снова.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Icon } from "../../data";
import type { Lang } from "../../data";
import { supabase } from "../api/supabase";
import { Modal, Field } from "../ui/Modal";
import { toast } from "../ui/toast";

const SNOOZE_KEY = "pw_prompt_snoozed";

const errorText = (msg: string, ru: boolean): string => {
  const m = msg.toLowerCase();
  if (m.includes("same_password") || m.includes("different from the old")) {
    return ru
      ? "Новый пароль совпадает с временным. Придумайте другой."
      : "Жаңы сырсөз убактылуусу менен бирдей. Башкасын ойлоп табыңыз.";
  }
  if (m.includes("weak_password") || m.includes("weak")) {
    return ru
      ? "Пароль слишком простой. Сделайте его длиннее, добавьте буквы и цифры."
      : "Сырсөз өтө жөнөкөй. Узунураак кылып, тамга жана сан кошуңуз.";
  }
  // Supabase просит повторный вход, если с момента входа прошло много времени.
  if (m.includes("reauthentication")) {
    return ru
      ? "Сессия устарела. Выйдите, войдите снова и смените пароль сразу после входа."
      : "Сессия эскирди. Чыгып, кайра кирип, сырсөздү дароо алмаштырыңыз.";
  }
  return msg;
};

export const PasswordPrompt = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  const [userId, setUserId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Демо-вход сессии Supabase не создаёт — окно там не появится.
    const check = (user: User | null) => {
      if (!user) { setUserId(null); setOpen(false); return; }
      let snoozed = false;
      try { snoozed = sessionStorage.getItem(SNOOZE_KEY) === user.id; } catch { /* нет доступа к хранилищу */ }
      setUserId(user.id);
      setOpen(user.user_metadata?.must_change_password === true && !snoozed);
    };
    supabase.auth.getSession().then(({ data }) => check(data.session?.user ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => check(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const reset = () => { setPw(""); setPw2(""); setReveal(false); setErr(null); };

  const snooze = () => {
    if (busy) return;
    try { if (userId) sessionStorage.setItem(SNOOZE_KEY, userId); } catch { /* нет доступа к хранилищу */ }
    setOpen(false);
    reset();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr(t("Пароль должен быть не менее 8 символов", "Сырсөз кеминде 8 белги болсун")); return; }
    if (pw !== pw2) { setErr(t("Пароли не совпадают", "Сырсөздөр дал келбейт")); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } });
    setBusy(false);
    if (error) { setErr(errorText(`${error.code ?? ""} ${error.message}`, lang === "ru")); return; }
    setOpen(false);
    reset();
    toast.ok(t("Пароль изменён", "Сырсөз алмаштырылды"));
  };

  return (
    <Modal open={open} onClose={snooze} title={t("Смените временный пароль", "Убактылуу сырсөздү алмаштырыңыз")} width={420}>
      <form onSubmit={submit}>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, margin: "0 0 14px" }}>
          {t("Вам выдали временный пароль. Задайте свой — его будете знать только вы.",
             "Сизге убактылуу сырсөз берилди. Өзүңүздүкүн коюңуз — аны сиз гана билесиз.")}
        </p>
        <Field label={t("Новый пароль (не менее 8 символов)", "Жаңы сырсөз (8+ белги)")}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type={reveal ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              disabled={busy}
              autoFocus
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="icon-btn"
              title={reveal ? t("Скрыть", "Жашыруу") : t("Показать", "Көрсөтүү")}
              onClick={() => setReveal((v) => !v)}
            >
              <Icon name={reveal ? "eye-off" : "eye"} size={14} />
            </button>
          </div>
        </Field>
        <Field label={t("Повторите пароль", "Сырсөздү кайталаңыз")}>
          <input
            type={reveal ? "text" : "password"}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
            disabled={busy}
          />
        </Field>

        {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

        <div className="modal__foot">
          <button type="button" className="btn" onClick={snooze} disabled={busy}>{t("Позже", "Кийинчерээк")}</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !pw || !pw2}>
            {busy ? t("Сохраняем…", "Сакталууда…") : t("Сменить пароль", "Сырсөздү алмаштыруу")}
          </button>
        </div>
      </form>
    </Modal>
  );
};
