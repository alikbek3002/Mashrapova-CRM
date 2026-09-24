// Concrete modal forms used across admin pages.
import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "./Modal";
import { PasswordChangedDialog } from "./PasswordChangedDialog";
import { Icon } from "../../data";
import { useAddChild, useAddFamily, useAddSection, useAddGroup, useAddLead, useSellCard, useApproveFreeze, useRejectFreeze, useCancelLesson, useAddCoach, useCreateLesson, useRecordPayment, useUpdateSection, useUpdateCoach, useUpdateChild, useUpdateFamily, useUpdateGroup, useUpdateLesson, useArchive, useCreateParentAccount, useUpdateParent, useBulkGenerateLessons, useSetCoachSections, useUploadAvatar, useTopUpDeposit, useWithdrawDeposit, useBulkReschedule, useBulkCancelLessons, useRemoveEnrollment, friendlyAuthError } from "../api/mutations";
import { toast } from "./toast";
import { useFamilies, useSections, useChildren, useCoaches, useCards, useFreezableCards, useGroups as useGroupsQ, useManagers, useGroupSchedule, useProfile, useCoachSections, useChildActiveCards, useDepositBalance, useOrgSettings, useChildEnrollments, useCardPlans } from "../api/queries";
import { resolveAvatarUrl } from "../api/avatar";
import { computeWindowEnd, formatWindow } from "../lib/enrollmentWindow";
import { fmtD } from "../lib/dates";
import { useAuth } from "../auth/AuthProvider";
import { usePerm } from "../auth/rbac";
import { normalizeE164KG, isValidPhoneInput } from "../auth/normalizePhone";
import { supabase } from "../api/supabase";
import type { Lang } from "../../data";
import type { CardType, PaymentMethod, SectionCategory, LeadStage, LeadSource, Family, ClientSource, GroupAudience, CoachPayMode, LessonFault } from "../types/database";

// =============================================================
// AddFamily — create or edit (with archive)
// =============================================================
type FamilyInitial = {
  id?: string;
  father_name?: string | null;
  father_phone?: string | null;
  mother_name?: string | null;
  mother_phone?: string | null;
  comment?: string | null;
  parent_user_id?: string | null;
  address?: string | null;
  father_passport?: string | null;
  mother_passport?: string | null;
};

export const AddFamilyModal = ({
  open, onClose, lang, initial,
}: { open: boolean; onClose: () => void; lang: Lang; initial?: FamilyInitial }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = useAddFamily();
  const upd = useUpdateFamily();
  const archive = useArchive("families");
  const createAcct = useCreateParentAccount();
  const updateParent = useUpdateParent();
  const isEdit = !!initial?.id;
  const [father, setFather] = useState(initial?.father_name ?? "");
  const [fatherPhone, setFatherPhone] = useState(initial?.father_phone ?? "");
  const [fatherPassport, setFatherPassport] = useState(initial?.father_passport ?? "");
  const [mother, setMother] = useState(initial?.mother_name ?? "");
  const [motherPhone, setMotherPhone] = useState(initial?.mother_phone ?? "");
  const [motherPassport, setMotherPassport] = useState(initial?.mother_passport ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  // Parent PWA login. На create — обязательно (родитель должен иметь
  // доступ в PWA, чтобы видеть детей и платить). На edit — опционально:
  // checkbox «Выдать доступ» появляется только если parent_user_id ещё нет.
  const [withLogin, setWithLogin] = useState(false);
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPassword, setParentPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Edit-mode access info: подтягиваем профиль родителя и список детей семьи.
  const { data: parentProfile } = useProfile(isEdit ? initial?.parent_user_id ?? null : null);
  const { data: allKids = [] } = useChildren();
  const familyKids = isEdit ? allKids.filter((k) => k.family_id === initial!.id) : [];

  // Editable login fields (when parent_user_id exists)
  const [editLoginOpen, setEditLoginOpen] = useState(false);
  const [loginFullName, setLoginFullName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPhone, setLoginPhone] = useState("");
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [revealPw, setRevealPw] = useState(false);
  // После успешной смены пароля показываем подтверждение и сохранённый
  // пароль, чтобы директор мог его скопировать и передать родителю.
  const [pwChangedOpen, setPwChangedOpen] = useState(false);
  const [pwChangedValue, setPwChangedValue] = useState("");

  // Сбрасываем правки/раскрытия при смене семьи или закрытии модала.
  useEffect(() => {
    if (parentProfile) {
      setLoginFullName(parentProfile.full_name ?? "");
      setLoginEmail(parentProfile.email ?? "");
      setLoginPhone(parentProfile.phone ?? "");
    }
  }, [parentProfile?.id, parentProfile?.full_name, parentProfile?.email, parentProfile?.phone]);
  useEffect(() => {
    if (!open) {
      setEditLoginOpen(false);
      setResetPwOpen(false);
      setNewPassword("");
      setRevealPw(false);
    }
  }, [open]);

  const busy = add.isPending || upd.isPending || archive.isPending || createAcct.isPending || updateParent.isPending;

  // Reset PWA-login fields when modal closes (preserve them while open
  // so the user can still see what they typed in either create or edit mode).
  useEffect(() => {
    if (!open) {
      setWithLogin(false);
      setParentName("");
      setParentEmail("");
      setParentPassword("");
    }
  }, [open]);

  // Какой телефон используется как login для PWA. Backend требует phone
  // и сам конвертирует его в pseudo-email (phoneToPseudoEmail).
  const parentLoginPhone = fatherPhone || motherPhone;
  // Дефолтное ФИО для login — имя того родителя, чей телефон уйдёт в auth.
  const defaultLoginName = fatherPhone ? father : (motherPhone ? mother : (father || mother));

  // Edit-mode «выдать доступ»: автоподстановка ФИО из данных семьи при
  // включении чекбокса (если пользователь ещё ничего не ввёл вручную).
  // Перетирать введённое запрещено — поэтому ставим только когда parentName пуст.
  useEffect(() => {
    if (!isEdit || !withLogin) return;
    if (parentName.trim()) return;
    const fallback = (defaultLoginName ?? "").trim();
    if (fallback) setParentName(fallback);
  }, [withLogin, isEdit, defaultLoginName, parentName]);

  const generateParentPassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setParentPassword(s);
  };

  const submit = async () => {
    setErr(null);
    if (!father && !mother) {
      setErr(t("Укажите имя хотя бы одного родителя", "Жок дегенде бир ата-эненин атын жазыңыз"));
      return;
    }
    // На создании логин теперь обязателен. Email опционален — телефон
    // достаточен для входа.
    if (!isEdit) {
      if (!parentLoginPhone) {
        setErr(t(
          "Укажите телефон отца или матери — он будет использован как логин в PWA",
          "Атасынын же энесинин телефонун жазыңыз — ал PWA логину болот",
        ));
        return;
      }
      const finalName = (parentName.trim() || defaultLoginName || "").trim();
      if (!finalName) {
        setErr(t("Заполните ФИО родителя для входа", "Ата-эненин атын жазыңыз"));
        return;
      }
      if (parentPassword.length < 8) {
        setErr(t("Пароль должен быть не менее 8 символов", "Сырсөз кеминде 8 белги болсун"));
        return;
      }
    }
    // В edit-режиме «выдать доступ» по-прежнему опционален и появляется
    // только если у семьи ещё нет parent_user_id.
    if (isEdit && withLogin) {
      if (!parentName.trim() || parentPassword.length < 8) {
        setErr(t("Заполните ФИО и пароль (≥8) для нового логина", "Аты жана сырсөз (≥8) керек"));
        return;
      }
      if (!parentLoginPhone) {
        setErr(t(
          "Укажите телефон отца или матери — он будет использован как логин в PWA",
          "Атасынын же энесинин телефонун жазыңыз — ал PWA логину болот",
        ));
        return;
      }
    }
    try {
      const payload = {
        father_name: father || null,
        father_phone: fatherPhone || null,
        father_passport: fatherPassport || null,
        mother_name: mother || null,
        mother_phone: motherPhone || null,
        mother_passport: motherPassport || null,
        address: address || null,
        comment: comment || null,
      };
      if (isEdit && withLogin && !initial?.parent_user_id) {
        // Edit-mode "grant access": save family changes + attach a new
        // parent auth account to the existing family_id.
        await upd.mutateAsync({ id: initial!.id!, ...payload });
        await createAcct.mutateAsync({
          family_id: initial!.id!,
          email: parentEmail.trim() || null,
          password: parentPassword,
          full_name: parentName.trim(),
          phone: fatherPhone || motherPhone || null,
        });
        setPwChangedValue(parentPassword);
        setPwChangedOpen(true);
        return; // не закрываем модал — даём увидеть подтверждение
      } else if (isEdit) {
        await upd.mutateAsync({ id: initial!.id!, ...payload });
      } else {
        // На создании ВСЕГДА создаём родительский auth-аккаунт.
        const finalName = (parentName.trim() || defaultLoginName || "").trim();
        await createAcct.mutateAsync({
          email: parentEmail.trim() || null,
          password: parentPassword,
          full_name: finalName,
          phone: parentLoginPhone || null,
          ...payload,
        });
        setPwChangedValue(parentPassword);
        setPwChangedOpen(true);
        // НЕ закрываем модал и НЕ чистим поля — дадим директору скопировать
        // пароль. Очистка произойдёт после закрытия PasswordChangedDialog.
        return;
      }
      onClose();
    } catch (e: unknown) { setErr(friendlyAuthError((e as Error).message)); }
  };

  const handleArchive = async () => {
    if (!isEdit) return;
    if (!confirm(t("Архивировать семью? Дети не удалятся, но семья скроется.", "Үй-бүлөнү архивдөө?"))) return;
    try {
      await archive.mutateAsync(initial!.id!);
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={620} title={isEdit ? t("Редактировать семью", "Үй-бүлөнү өзгөртүү") : t("Новая семья", "Жаңы үй-бүлө")}>
      <div className="grid-2">
        <Field label={t("Имя отца", "Атасынын аты")}>
          <input value={father} onChange={(e) => setFather(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Телефон отца", "Атасынын телефону")}>
          <input value={fatherPhone} onChange={(e) => setFatherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
        </Field>
        <Field label={t("Паспорт/ID отца (КР)", "Атасынын паспорту/ID (КР)")} hint={t("Серия и номер или 14-значный ПИН", "Серия+номер же 14-сан ПИН")}>
          <input value={fatherPassport} onChange={(e) => setFatherPassport(e.target.value)} disabled={busy} placeholder="AN1234567 / 20706200012345" />
        </Field>
        <div />
        <Field label={t("Имя матери", "Энесинин аты")}>
          <input value={mother} onChange={(e) => setMother(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Телефон матери", "Энесинин телефону")}>
          <input value={motherPhone} onChange={(e) => setMotherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
        </Field>
        <Field label={t("Паспорт/ID матери (КР)", "Энесинин паспорту/ID (КР)")} hint={t("Серия и номер или 14-значный ПИН", "Серия+номер же 14-сан ПИН")}>
          <input value={motherPassport} onChange={(e) => setMotherPassport(e.target.value)} disabled={busy} placeholder="AN1234567 / 20706200012345" />
        </Field>
        <div />
      </div>
      <Field label={t("Домашний адрес", "Үй дареги")}>
        <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} placeholder={t("г. Бишкек, ул. ...", "Бишкек ш., ... көч.")} />
      </Field>
      <Field label={t("Комментарий", "Комментарий")}>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} disabled={busy} />
      </Field>

      {!isEdit && (
        <div style={{ marginTop: 8, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            {t("Вход в PWA для родителя", "Ата-эне үчүн PWA логину")}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
            {t(
              "Логин для входа — телефон одного из родителей. Пароль обязателен и передаётся семье вручную.",
              "Кирүү логину — ата-энелердин бирөөнүн телефону. Сырсөз милдеттүү, үй-бүлөгө кол менен өткөрүлөт.",
            )}
          </div>
          <div style={{
            fontSize: 12, padding: "6px 10px", marginBottom: 10,
            background: parentLoginPhone ? "var(--green-50)" : "var(--red-50)",
            color: parentLoginPhone ? "var(--green)" : "var(--red-600)",
            border: "1px solid " + (parentLoginPhone ? "oklch(0.85 0.16 150)" : "var(--red-100)"),
            borderRadius: "var(--r-sm)",
          }}>
            {parentLoginPhone
              ? t(`Логин-телефон: ${parentLoginPhone}`, `Кирүү телефону: ${parentLoginPhone}`)
              : t("Заполните телефон отца или матери выше — он станет логином", "Жогоруда атасынын же энесинин телефонун жазыңыз")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Field label={<>{t("ФИО родителя для входа", "Ата-эненин толук аты")} <span style={{ color: "var(--red-600)" }}>*</span></>}>
              <input
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                disabled={busy}
                placeholder={defaultLoginName || t("Имя для аккаунта PWA", "PWA аккаунту үчүн ат")}
                required
              />
            </Field>
            <Field label={<>{t("Пароль (не менее 8 символов)", "Сырсөз (8+ белги)")} <span style={{ color: "var(--red-600)" }}>*</span></>}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={parentPassword}
                  onChange={(e) => setParentPassword(e.target.value)}
                  disabled={busy}
                  required
                  minLength={8}
                  style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                  placeholder="••••••••"
                />
                <button type="button" className="btn" onClick={generateParentPassword} disabled={busy}>
                  <Icon name="sparkle" size={14} /> {t("Сгенерировать", "Жаратуу")}
                </button>
              </div>
            </Field>
            <Field label={t("Email (необязательно)", "Email (милдеттүү эмес)")} hint={t("Если указан — родитель сможет войти и по email", "Көрсөтүлсө — email менен да кире алат")}>
              <input
                type="email"
                value={parentEmail}
                onChange={(e) => setParentEmail(e.target.value)}
                disabled={busy}
                placeholder="parent@example.com"
              />
            </Field>
          </div>
        </div>
      )}

      {/* Edit mode: grant PWA login for an existing family that has no parent_user_id yet */}
      {isEdit && !initial?.parent_user_id && (
        <div style={{ marginTop: 8, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
          <label
            style={{
              display: "flex", alignItems: "center", gap: 8, fontWeight: 500,
              cursor: parentLoginPhone ? "pointer" : "not-allowed",
              opacity: parentLoginPhone ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={withLogin}
              onChange={(e) => setWithLogin(e.target.checked)}
              disabled={busy || !parentLoginPhone}
            />
            {t("Выдать доступ в PWA родителю", "Ата-энеге PWA-га кирүү берүү")}
          </label>
          {!parentLoginPhone && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--red-600)" }}>
              {t(
                "Сначала укажите телефон отца или матери выше — он будет логином в PWA.",
                "Жогоруда атасынын же энесинин телефонун жазыңыз — ал PWA логину болот.",
              )}
            </div>
          )}
          {withLogin && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{
                fontSize: 12, padding: "6px 10px",
                background: "var(--green-50)", color: "var(--green)",
                border: "1px solid oklch(0.85 0.16 150)",
                borderRadius: "var(--r-sm)",
              }}>
                {t(`Логин-телефон: ${parentLoginPhone}`, `Кирүү телефону: ${parentLoginPhone}`)}
              </div>
              <Field label={t("ФИО родителя (для входа)", "Ата-эненин толук аты")}>
                <input
                  value={parentName}
                  onChange={(e) => setParentName(e.target.value)}
                  disabled={busy}
                  placeholder={defaultLoginName || "Айгуль Жанышева"}
                />
              </Field>
              <Field label={t("Email (необязательно)", "Email (милдеттүү эмес)")} hint={t("Если указан — родитель сможет войти и по email", "Көрсөтүлсө — email менен да кире алат")}>
                <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} disabled={busy} placeholder="parent@example.com" />
              </Field>
              <Field label={t("Пароль (не менее 8 символов)", "Сырсөз (8+ белги)")}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={parentPassword}
                    onChange={(e) => setParentPassword(e.target.value)}
                    disabled={busy}
                    style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                    placeholder="••••••••"
                  />
                  <button type="button" className="btn" onClick={generateParentPassword} disabled={busy}>
                    <Icon name="sparkle" size={14} /> {t("Сгенерировать", "Жаратуу")}
                  </button>
                </div>
              </Field>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("Этот родитель войдёт в свою PWA и увидит только своих детей. Передайте email/пароль семье.",
                   "Ата-эне PWA-га кирип, өз балдарын гана көрөт.")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit mode: дети семьи */}
      {isEdit && (
        <div style={{ marginTop: 12, padding: 12, background: "var(--bg-soft)", borderRadius: "var(--r-sm)" }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--muted)",
            textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 8,
          }}>
            {t("Дети", "Балдар")} · {familyKids.length}
          </div>
          {familyKids.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>
              {t("К этой семье ещё не привязан ни один ребёнок", "Үй-бүлөгө бала тиркелген эмес")}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {familyKids.map((k) => {
                const active = (k.enrollments ?? []).filter((e) => e.archived_at == null);
                const groups = active.map((e) => e.group?.name).filter(Boolean).join(", ");
                return (
                  <div
                    key={k.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "6px 10px",
                      background: "var(--surface)",
                      border: "1px solid var(--line)",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{k.full_name}</b>
                      <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                        {groups || t("без группы", "топсуз")}
                      </span>
                    </span>
                    <span className={`pill pill--${k.status}`} style={{ fontSize: 10 }}>{k.status}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Edit mode: family already has a linked parent — show login & actions */}
      {isEdit && initial?.parent_user_id && (
        <div style={{
          marginTop: 12, padding: 12,
          background: "var(--green-50)",
          border: "1px solid oklch(0.86 0.10 150)",
          borderRadius: "var(--r-sm)",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
            fontSize: 12, fontWeight: 600, color: "oklch(0.40 0.14 150)",
            textTransform: "uppercase", letterSpacing: 0.04,
          }}>
            <Icon name="check" size={14} />
            {t("Доступ в PWA", "PWA доступу")}
          </div>

          {parentProfile ? (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--ink)" }}>
                <div>
                  <span style={{ color: "var(--muted)" }}>{t("ФИО:", "ФИО:")} </span>
                  <b>{parentProfile.full_name}</b>
                </div>
                <div>
                  <span style={{ color: "var(--muted)" }}>{t("Email:", "Email:")} </span>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {parentProfile.email || t("(не задан)", "(жок)")}
                  </code>
                </div>
                <div>
                  <span style={{ color: "var(--muted)" }}>{t("Телефон:", "Телефон:")} </span>
                  <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {parentProfile.phone || t("(не задан)", "(жок)")}
                  </code>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {t("Пароль не показывается. Для смены — кнопка «Сбросить пароль».",
                     "Сырсөз көрсөтүлбөйт. «Сбросить пароль» баскычын колдонуңуз.")}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setEditLoginOpen((v) => !v); setResetPwOpen(false); }}
                  disabled={busy}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  <Icon name="settings" size={12} /> {editLoginOpen ? t("Скрыть", "Жашыруу") : t("Изменить логин", "Логинди өзгөртүү")}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => { setResetPwOpen((v) => !v); setEditLoginOpen(false); }}
                  disabled={busy}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                >
                  <Icon name="restore" size={12} /> {resetPwOpen ? t("Отмена", "Жокко") : t("Сбросить пароль", "Сырсөз алмаштыруу")}
                </button>
              </div>

              {editLoginOpen && (
                <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                  <Field label={t("ФИО родителя (для входа)", "Ата-эненин толук аты")}>
                    <input value={loginFullName} onChange={(e) => setLoginFullName(e.target.value)} disabled={busy} />
                  </Field>
                  <div className="grid-2">
                    <Field label={t("Email", "Email")}>
                      <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} disabled={busy} placeholder="parent@example.com" />
                    </Field>
                    <Field label={t("Телефон", "Телефон")}>
                      <input value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
                    </Field>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={busy || !loginFullName.trim() || !loginPhone.trim()}
                      onClick={async () => {
                        setErr(null);
                        const phoneT = loginPhone.trim();
                        if (phoneT && phoneT.length < 7) {
                          setErr(t(
                            "Телефон должен быть в формате +996 700 12 34 56",
                            "Телефон +996 700 12 34 56 форматында болсун",
                          ));
                          return;
                        }
                        try {
                          const patch: { id: string; full_name?: string; email?: string | null; phone?: string } = {
                            id: initial!.parent_user_id!,
                          };
                          if (loginFullName.trim() !== (parentProfile.full_name ?? "")) patch.full_name = loginFullName.trim();
                          const emailNorm = loginEmail.trim() ? loginEmail.trim() : null;
                          if (emailNorm !== (parentProfile.email ?? null)) patch.email = emailNorm;
                          if (phoneT !== (parentProfile.phone ?? "")) patch.phone = phoneT;
                          if (Object.keys(patch).length > 1) {
                            await updateParent.mutateAsync(patch);
                          }
                          setEditLoginOpen(false);
                        } catch (e: unknown) { setErr(friendlyAuthError((e as Error).message)); }
                      }}
                    >
                      {t("Сохранить логин", "Логинди сактоо")}
                    </button>
                  </div>
                </div>
              )}

              {resetPwOpen && (
                <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
                  <Field label={t("Новый пароль (не менее 8 символов)", "Жаңы сырсөз (8+ белги)")}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type={revealPw ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        disabled={busy}
                        placeholder="********"
                        style={{ flex: 1 }}
                      />
                      <button
                        type="button"
                        className="icon-btn"
                        title={revealPw ? t("Скрыть", "Жашыруу") : t("Показать", "Көрсөтүү")}
                        onClick={() => setRevealPw((v) => !v)}
                      >
                        <Icon name={revealPw ? "eye-off" : "eye"} size={14} />
                      </button>
                    </div>
                  </Field>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      disabled={busy || newPassword.length < 8}
                      onClick={async () => {
                        setErr(null);
                        if (!initial?.parent_user_id) {
                          setErr(t(
                            "У этой семьи ещё нет аккаунта родителя. Выдайте доступ ниже, чтобы создать его.",
                            "Бул үй-бүлөгө аккаунт жок. Адегенде доступ бериңиз.",
                          ));
                          return;
                        }
                        if (newPassword.length < 8) {
                          setErr(t(
                            "Пароль должен быть не менее 8 символов",
                            "Сырсөз кеминде 8 белги болсун",
                          ));
                          return;
                        }
                        try {
                          await updateParent.mutateAsync({
                            id: initial.parent_user_id,
                            password: newPassword,
                          });
                          setPwChangedValue(newPassword);
                          setPwChangedOpen(true);
                          setNewPassword("");
                          setResetPwOpen(false);
                          setRevealPw(false);
                        } catch (e: unknown) { setErr(friendlyAuthError((e as Error).message)); }
                      }}
                    >
                      {t("Сменить пароль", "Сырсөздү алмаштыруу")}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("Загрузка данных аккаунта…", "Жүктөлүүдө…")}
            </div>
          )}
        </div>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        {isEdit && (
          <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
            <Icon name="x" size={14} /> {t("В архив", "Архивге")}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy}>
          {busy ? t("Сохраняем…", "Сакталууда…") : isEdit ? t("Сохранить", "Сактоо") : t("Создать семью", "Үй-бүлө түзүү")}
        </button>
      </div>
      <PasswordChangedDialog
        open={pwChangedOpen}
        onClose={() => {
          setPwChangedOpen(false);
          setPwChangedValue("");
          // После закрытия подтверждения — закрываем форму и чистим поля
          // только если это был create-flow (новая семья) или grant-access.
          if (!isEdit || (isEdit && withLogin)) {
            onClose();
            if (!isEdit) {
              setFather(""); setFatherPhone(""); setFatherPassport("");
              setMother(""); setMotherPhone(""); setMotherPassport("");
              setAddress(""); setComment("");
              setParentName(""); setParentEmail(""); setParentPassword("");
            }
            setWithLogin(false);
          }
        }}
        lang={lang}
        password={pwChangedValue}
        who={parentProfile?.full_name ?? parentName ?? undefined}
      />
    </Modal>
  );
};

// =============================================================
// Подпись семьи: родители, иначе телефон.
const familyLabel = (f: { father_name: string | null; mother_name: string | null; father_phone: string | null; mother_phone: string | null }) =>
  [f.father_name, f.mother_name].filter(Boolean).join(" / ") || f.father_phone || f.mother_phone || "—";

// Поиск существующей семьи: по родителям, телефонам и именам детей
// (просьба офиса 2026-09-10 — выпадающий список из сотен семей неудобен).
const FamilyPicker = ({ families, kids, value, onChange, disabled, lang }: {
  families: Family[];
  kids: { id: string; full_name: string; family_id: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  lang: Lang;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  const kidsByFamily = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of kids) {
      const arr = m.get(k.family_id) ?? [];
      arr.push(k.full_name);
      m.set(k.family_id, arr);
    }
    return m;
  }, [kids]);
  const norm = (s: string) => s.toLowerCase().replace(/[\s\-()+]/g, "");
  const matches = useMemo(() => {
    const needle = norm(q.trim());
    if (needle.length < 2) return [];
    return families
      .filter((f) => {
        const hay = norm([
          f.father_name, f.mother_name, f.father_phone, f.mother_phone,
          ...(kidsByFamily.get(f.id) ?? []),
        ].filter(Boolean).join(" "));
        return hay.includes(needle);
      })
      .slice(0, 25);
  }, [q, families, kidsByFamily]);
  const selected = families.find((f) => f.id === value);

  return (
    <div>
      {selected ? (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
          background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{familyLabel(selected)}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {[selected.father_phone, selected.mother_phone].filter(Boolean).join(" · ")}
              {(kidsByFamily.get(selected.id) ?? []).length > 0 && (
                <> · {t("дети", "балдар")}: {(kidsByFamily.get(selected.id) ?? []).join(", ")}</>
              )}
            </div>
          </div>
          <button type="button" className="btn btn--ghost" style={{ padding: "4px 10px", fontSize: 12 }}
            onClick={() => { onChange(""); setQ(""); }} disabled={disabled}>
            {t("Сменить", "Алмаштыруу")}
          </button>
        </div>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            disabled={disabled}
            autoFocus
            placeholder={t("Имя родителя, телефон или имя ребёнка…", "Ата-эненин аты, телефон же баланын аты…")}
          />
          {q.trim().length >= 2 && (
            <div style={{
              marginTop: 6, border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              maxHeight: 240, overflowY: "auto", background: "var(--surface)",
            }}>
              {matches.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: 13, color: "var(--muted)" }}>
                  {t("Ничего не найдено", "Эч нерсе табылган жок")}
                </div>
              ) : matches.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onChange(f.id)}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                    background: "transparent", border: "none", borderBottom: "1px solid var(--line)",
                    cursor: "pointer", color: "var(--ink)",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{familyLabel(f)}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {[f.father_phone, f.mother_phone].filter(Boolean).join(" · ")}
                    {(kidsByFamily.get(f.id) ?? []).length > 0 && (
                      <> · {(kidsByFamily.get(f.id) ?? []).join(", ")}</>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// AddChild — creates family + child OR edits existing child (with archive)
// =============================================================
type ChildInitial = {
  id?: string;
  family_id?: string;
  full_name?: string;
  birth_date?: string;
  card_number?: string | null;
  responsible_manager_id?: string | null;
  amo_url?: string | null;
  source?: ClientSource | null;
  referred_by_child_id?: string | null;
};

export const AddChildModal = ({
  open, onClose, lang, initial, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  initial?: ChildInitial;
  onCreated?: (childId: string) => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: families = [] } = useFamilies();
  // Дети — для поиска семьи по имени ребёнка (режим «Существующая семья»).
  const { data: kidsForFamilies = [] } = useChildren();
  const { data: managers = [] } = useManagers();
  const { user } = useAuth();
  const addFamily = useAddFamily();
  const addChild = useAddChild();
  const updChild = useUpdateChild();
  const updFamily = useUpdateFamily();
  const archive = useArchive("children");
  const isEdit = !!initial?.id;

  // По умолчанию ответственный = текущий менеджер (если он создаёт).
  // Ответственными могут быть только manager и senior_manager.
  const currentUserIsManagerLike = user?.role === "manager" || user?.role === "senior_manager";

  const [mode, setMode] = useState<"new" | "existing">(isEdit ? "existing" : "new");
  const [familyId, setFamilyId] = useState(initial?.family_id ?? "");
  const [father, setFather] = useState("");
  const [fatherPhone, setFatherPhone] = useState("");
  const [fatherPassport, setFatherPassport] = useState("");
  const [mother, setMother] = useState("");
  const [motherPhone, setMotherPhone] = useState("");
  const [motherPassport, setMotherPassport] = useState("");
  const [address, setAddress] = useState("");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [birth, setBirth] = useState(initial?.birth_date ?? "");
  const [card, setCard] = useState(initial?.card_number ?? "");
  const [amoUrl, setAmoUrl] = useState(initial?.amo_url ?? "");
  const [source, setSource] = useState<ClientSource | "">(initial?.source ?? "");
  // ТЗ §3.3 «Приведи друга»: кто привёл этого клиента. Бонус −300 сом
  // начисляется рефереру и применяется к его следующему абонементу.
  const [referredBy, setReferredBy] = useState(initial?.referred_by_child_id ?? "");
  const [managerId, setManagerId] = useState<string>(
    initial?.responsible_manager_id
      ?? (currentUserIsManagerLike ? (user?.id ?? "") : ""),
  );
  const [err, setErr] = useState<string | null>(null);
  const busy = addFamily.isPending || addChild.isPending || updChild.isPending || archive.isPending;

  // При выборе существующей семьи — подтянуть её responsible_manager_id как default
  useEffect(() => {
    if (managerId || !familyId) return;
    const fam = families.find((f) => f.id === familyId) as { responsible_manager_id?: string | null } | undefined;
    if (fam?.responsible_manager_id) setManagerId(fam.responsible_manager_id);
  }, [familyId, families, managerId]);

  // Редактирование = полная карточка: поля семьи (родители, телефоны,
  // паспорта, адрес) подтягиваются из выбранной семьи и редактируются
  // здесь же — раньше при редактировании семью было не поправить.
  const selectedFamily = useMemo(
    () => families.find((f) => f.id === familyId) as (typeof families)[number] & {
      father_passport?: string | null; mother_passport?: string | null;
      address?: string | null; parent_user_id?: string | null;
    } | undefined,
    [families, familyId],
  );
  useEffect(() => {
    if (!isEdit || !selectedFamily) return;
    setFather(selectedFamily.father_name ?? "");
    setFatherPhone(selectedFamily.father_phone ?? "");
    setFatherPassport(selectedFamily.father_passport ?? "");
    setMother(selectedFamily.mother_name ?? "");
    setMotherPhone(selectedFamily.mother_phone ?? "");
    setMotherPassport(selectedFamily.mother_passport ?? "");
    setAddress(selectedFamily.address ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, selectedFamily?.id]);
  // Учётка родителя: показываем существующую, а если её нет — выдаём
  // доступ прямо отсюда (раньше отправляли на страницу «Родители», и
  // менеджеры «не могли создать» логин из карточки ребёнка).
  const { data: parentAccount } = useProfile(isEdit ? selectedFamily?.parent_user_id ?? null : null);
  const createParentAcct = useCreateParentAccount();
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantName, setGrantName] = useState("");
  const [grantPw, setGrantPw] = useState("");
  const [grantDone, setGrantDone] = useState("");
  const genGrantPw = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setGrantPw(s);
  };
  const grantAccess = async () => {
    setErr(null);
    const phone = fatherPhone || motherPhone;
    if (!phone) {
      setErr(t("Укажите телефон отца или матери — он станет логином родителя в PWA", "Ата-эненин телефонун жазыңыз — ал PWA логину болот"));
      return;
    }
    const name = grantName.trim() || (fatherPhone ? father : mother) || father || mother;
    if (!name) { setErr(t("Укажите имя родителя", "Ата-эненин атын жазыңыз")); return; }
    if (grantPw.length < 8) { setErr(t("Пароль — не менее 8 символов", "Сырсөз кеминде 8 белги")); return; }
    // Сначала сохраняем текущие телефоны в семью — логин делается из них.
    await updFamily.mutateAsync({
      id: familyId,
      father_name: father || null, father_phone: fatherPhone || null,
      mother_name: mother || null, mother_phone: motherPhone || null,
    });
    await createParentAcct.mutateAsync({
      family_id: familyId,
      password: grantPw,
      full_name: name,
      phone,
    });
    setGrantDone(grantPw);
    setGrantOpen(false);
  };

  const submit = async () => {
    setErr(null);
    try {
      if (isEdit) {
        await updChild.mutateAsync({
          id: initial!.id!,
          family_id: familyId || initial?.family_id,
          full_name: fullName,
          birth_date: birth,
          card_number: card || null,
          responsible_manager_id: managerId || null,
          amo_url: amoUrl.trim() || null,
          source: source || null,
          referred_by_child_id: referredBy || null,
        });
        // Полная карточка: правки родителей/телефонов/адреса сохраняются
        // в выбранную семью тем же сабмитом.
        if (familyId) {
          await updFamily.mutateAsync({
            id: familyId,
            father_name: father || null,
            father_phone: fatherPhone || null,
            father_passport: fatherPassport || null,
            mother_name: mother || null,
            mother_phone: motherPhone || null,
            mother_passport: motherPassport || null,
            address: address || null,
          });
        }
        onClose();
        return;
      }
      let fid = familyId;
      if (mode === "new") {
        const f = await addFamily.mutateAsync({
          father_name: father || null,
          father_phone: fatherPhone || null,
          father_passport: fatherPassport || null,
          mother_name: mother || null,
          mother_phone: motherPhone || null,
          mother_passport: motherPassport || null,
          address: address || null,
        });
        fid = f.id;
      }
      if (!fid) {
        setErr(t("Выберите или создайте семью", "Үй-бүлөнү тандаңыз же түзүңүз"));
        return;
      }
      const created = await addChild.mutateAsync({
        family_id: fid,
        full_name: fullName,
        birth_date: birth,
        card_number: card || null,
        responsible_manager_id: managerId || null,
        amo_url: amoUrl.trim() || null,
        source: source || null,
        referred_by_child_id: referredBy || null,
      });
      if (onCreated && created && (created as { id?: string }).id) {
        onCreated((created as { id: string }).id);
      }
      onClose();
      setFullName(""); setBirth(""); setCard(""); setSource(""); setReferredBy("");
      setFather(""); setFatherPhone(""); setFatherPassport("");
      setMother(""); setMotherPhone(""); setMotherPassport("");
      setAddress("");
      setFamilyId(""); setMode("new");
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  };

  const handleArchive = async () => {
    if (!isEdit) return;
    if (!confirm(t("Архивировать ребёнка?", "Баланы архивдөө?"))) return;
    try {
      await archive.mutateAsync(initial!.id!);
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t("Редактировать ребёнка", "Баланы өзгөртүү") : t("Новый ребёнок", "Жаңы бала")}>
      {!isEdit && (
        <div className="seg" style={{ marginBottom: 12 }}>
          <button className={`seg__btn ${mode === "new" ? "is-active" : ""}`} onClick={() => setMode("new")}>
            {t("Новая семья", "Жаңы үй-бүлө")}
          </button>
          <button className={`seg__btn ${mode === "existing" ? "is-active" : ""}`} onClick={() => setMode("existing")}>
            {t("Существующая семья", "Бар үй-бүлө")}
          </button>
        </div>
      )}

      {!isEdit && mode === "new" ? (
        <>
          <div className="grid-2">
            <Field label={t("Имя отца", "Атасынын аты")}>
              <input value={father} onChange={(e) => setFather(e.target.value)} disabled={busy} />
            </Field>
            <Field label={t("Телефон отца", "Атасынын телефону")}>
              <input value={fatherPhone} onChange={(e) => setFatherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
            </Field>
            <Field label={t("Паспорт/ID отца (КР)", "Атасынын паспорту/ID (КР)")} hint={t("Серия+номер или ПИН", "Серия+номер же ПИН")}>
              <input value={fatherPassport} onChange={(e) => setFatherPassport(e.target.value)} disabled={busy} placeholder="AN1234567 / 20706200012345" />
            </Field>
            <div />
            <Field label={t("Имя матери", "Энесинин аты")}>
              <input value={mother} onChange={(e) => setMother(e.target.value)} disabled={busy} />
            </Field>
            <Field label={t("Телефон матери", "Энесинин телефону")}>
              <input value={motherPhone} onChange={(e) => setMotherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
            </Field>
            <Field label={t("Паспорт/ID матери (КР)", "Энесинин паспорту/ID (КР)")} hint={t("Серия+номер или ПИН", "Серия+номер же ПИН")}>
              <input value={motherPassport} onChange={(e) => setMotherPassport(e.target.value)} disabled={busy} placeholder="AN1234567 / 20706200012345" />
            </Field>
            <div />
          </div>
          <Field label={t("Домашний адрес", "Үй дареги")}>
            <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} placeholder={t("г. Бишкек, ул. ...", "Бишкек ш., ... көч.")} />
          </Field>
        </>
      ) : (
        <>
          <Field
            label={t("Семья", "Үй-бүлө")}
            hint={isEdit ? undefined : t("Поиск по родителям, телефону или имени ребёнка", "Ата-эне, телефон же баланын аты боюнча издөө")}
          >
            {isEdit ? (
              <select value={familyId} onChange={(e) => setFamilyId(e.target.value)} disabled={busy}>
                <option value="">— {t("выбрать", "тандоо")} —</option>
                {families.map((f) => (
                  <option key={f.id} value={f.id}>{familyLabel(f)}</option>
                ))}
              </select>
            ) : (
              <FamilyPicker
                families={families}
                kids={kidsForFamilies}
                value={familyId}
                onChange={setFamilyId}
                disabled={busy}
                lang={lang}
              />
            )}
          </Field>
          {isEdit && familyId && (
            <>
              {/* Полная карточка: родители, телефоны, паспорта, адрес —
                  редактируются прямо здесь и сохраняются в семью. */}
              <div className="grid-2">
                <Field label={t("Имя отца", "Атасынын аты")}>
                  <input value={father} onChange={(e) => setFather(e.target.value)} disabled={busy} />
                </Field>
                <Field label={t("Телефон отца", "Атасынын телефону")}>
                  <input value={fatherPhone} onChange={(e) => setFatherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
                </Field>
                <Field label={t("Паспорт/ID отца (КР)", "Атасынын паспорту/ID (КР)")}>
                  <input value={fatherPassport} onChange={(e) => setFatherPassport(e.target.value)} disabled={busy} />
                </Field>
                <div />
                <Field label={t("Имя матери", "Энесинин аты")}>
                  <input value={mother} onChange={(e) => setMother(e.target.value)} disabled={busy} />
                </Field>
                <Field label={t("Телефон матери", "Энесинин телефону")}>
                  <input value={motherPhone} onChange={(e) => setMotherPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
                </Field>
                <Field label={t("Паспорт/ID матери (КР)", "Энесинин паспорту/ID (КР)")}>
                  <input value={motherPassport} onChange={(e) => setMotherPassport(e.target.value)} disabled={busy} />
                </Field>
                <div />
              </div>
              <Field label={t("Домашний адрес", "Үй дареги")}>
                <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} placeholder={t("г. Бишкек, ул. ...", "Бишкек ш., ... көч.")} />
              </Field>
              <div style={{
                padding: "8px 10px", marginBottom: 4,
                background: "var(--bg-soft)", border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)", fontSize: 12.5,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Icon name="user" size={13} />
                  <b>{t("Учётка родителя:", "Ата-эне аккаунту:")}</b>
                  {parentAccount ? (
                    <>
                      <span>{parentAccount.full_name}</span>
                      {parentAccount.phone && <a href={`tel:${parentAccount.phone}`} style={{ color: "var(--blue)" }}>{parentAccount.phone}</a>}
                      {parentAccount.email && <span style={{ color: "var(--muted)" }}>{parentAccount.email}</span>}
                    </>
                  ) : grantDone ? (
                    <span style={{ color: "var(--green, #1a7f37)", fontWeight: 600 }}>
                      {t(`Создана! Логин — телефон родителя, пароль: ${grantDone}. Передайте лично.`,
                         `Түзүлдү! Логин — телефон, сырсөз: ${grantDone}. Жеке бериңиз.`)}
                    </span>
                  ) : (
                    <>
                      <span style={{ color: "var(--muted)" }}>{t("не создана", "түзүлгөн эмес")}</span>
                      {!grantOpen && (
                        <button
                          type="button"
                          className="btn btn--primary"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => { setGrantOpen(true); if (!grantPw) genGrantPw(); }}
                          disabled={busy}
                        >
                          {t("Выдать доступ в PWA", "PWA мүмкүнчүлүк берүү")}
                        </button>
                      )}
                    </>
                  )}
                </div>
                {grantOpen && !parentAccount && !grantDone && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <input
                      value={grantName}
                      onChange={(e) => setGrantName(e.target.value)}
                      placeholder={t("ФИО родителя (по умолч. из семьи)", "Ата-эненин аты")}
                      style={{ height: 34, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 13, flex: 1, minWidth: 150 }}
                    />
                    <input
                      value={grantPw}
                      onChange={(e) => setGrantPw(e.target.value)}
                      placeholder={t("Пароль (≥8)", "Сырсөз (≥8)")}
                      style={{ height: 34, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 13, width: 130, fontFamily: "var(--font-mono)" }}
                    />
                    <button type="button" className="btn btn--ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={genGrantPw}>
                      {t("Сгенерировать", "Жаратуу")}
                    </button>
                    <button
                      type="button"
                      className="btn btn--primary"
                      style={{ padding: "6px 12px", fontSize: 12 }}
                      onClick={grantAccess}
                      disabled={createParentAcct.isPending || updFamily.isPending}
                    >
                      {createParentAcct.isPending ? t("Создаю…", "Түзүлүүдө…") : t("Создать логин", "Логин түзүү")}
                    </button>
                    <div style={{ fontSize: 11.5, color: "var(--muted)", width: "100%" }}>
                      {t("Логин — телефон отца или матери из полей выше. Пароль передайте родителю лично.",
                         "Логин — жогорудагы телефон. Сырсөздү жеке бериңиз.")}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      <div className="divider-soft" />

      <Field label={t("ФИО ребёнка", "Бала ФИО")}>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} required />
      </Field>
      <div className="grid-2">
        <Field label={t("Дата рождения", "Туулган күн")}>
          <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} disabled={busy} required />
        </Field>
        <Field label={t("Номер карты (опц.)", "Карта №")}>
          <input value={card} onChange={(e) => setCard(e.target.value)} disabled={busy} placeholder="U-0005" />
        </Field>
      </div>

      <Field label={t("Источник клиента", "Кардардын булагы")}>
        <select value={source} onChange={(e) => setSource(e.target.value as ClientSource | "")} disabled={busy}>
          <option value="">{t("— не указан —", "— көрсөтүлгөн эмес —")}</option>
          <option value="target">{t("Таргет (Instagram)", "Таргет (Instagram)")}</option>
          <option value="referral">{t("Рекомендация", "Сунуштама")}</option>
          <option value="other">{t("Другое", "Башка")}</option>
        </select>
      </Field>

      {/* ТЗ §3.3 «Приведи друга»: −300 сом с абонемента того, кто привёл */}
      {source === "referral" && (
        <Field label={t("Кто привёл", "Ким алып келди")}>
          <select value={referredBy} onChange={(e) => setReferredBy(e.target.value)} disabled={busy}>
            <option value="">{t("— не указан —", "— көрсөтүлгөн эмес —")}</option>
            {kidsForFamilies
              .filter((c) => c.id !== initial?.id && !c.deleted_at)
              .map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>
            {t("Бонус 300 сом спишется с его следующего абонемента — после того, как этот клиент купит свой.",
               "300 сом бонус ал кийинки абонементинен кемийт.")}
          </div>
        </Field>
      )}

      <Field label={t("Ссылка AmoCRM (опц.)", "AmoCRM шилтемеси (опц.)")}>
        <input
          value={amoUrl}
          onChange={(e) => setAmoUrl(e.target.value)}
          disabled={busy}
          placeholder="https://mashrapov.amocrm.ru/leads/detail/…"
        />
      </Field>

      <Field label={t("Ответственный менеджер", "Жооптуу менеджер")}>
        <select
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          disabled={busy}
        >
          <option value="">— {t("без менеджера", "менеджерсиз")} —</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}{m.phone ? ` · ${m.phone}` : ""}
            </option>
          ))}
        </select>
      </Field>

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

      <div className="modal__foot">
        {isEdit && (
          <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
            <Icon name="x" size={14} /> {t("В архив", "Архивге")}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || !fullName || !birth}>
          {busy ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// AddCoach — via backend POST /v1/coaches (creates auth user + profile + coach)
// Edit mode reuses for existing coaches (updates profile + coaches table directly)
// =============================================================
type CoachInitial = {
  id?: string;
  email?: string | null;
  full_name?: string;
  phone?: string | null;
  bio?: string | null;
  achievements?: string | null;
  experience_years?: number | null;
  is_active?: boolean;
  avatar_url?: string | null;
  pay_mode?: CoachPayMode | null;
  percent_rate?: number | null;
  fixed_monthly?: number | null;
};

// =============================================================
// CoachAccessBlock — логин/email/телефон + смена пароля.
// Зеркало блока для родителя (AddFamilyModal: «Доступ в PWA»).
// =============================================================
const CoachAccessBlock = ({ coachId, lang }: { coachId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: profile } = useProfile(coachId);
  const upd = useUpdateCoach();

  const [editLoginOpen, setEditLoginOpen] = useState(false);
  const [loginFullName, setLoginFullName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPhone, setLoginPhone] = useState("");

  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [revealPw, setRevealPw] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pwChangedOpen, setPwChangedOpen] = useState(false);
  const [pwChangedValue, setPwChangedValue] = useState("");
  const busy = upd.isPending;

  useEffect(() => {
    if (profile) {
      setLoginFullName(profile.full_name ?? "");
      setLoginEmail(profile.email ?? "");
      setLoginPhone(profile.phone ?? "");
    }
  }, [profile?.id, profile?.full_name, profile?.email, profile?.phone]);

  if (!profile) {
    return (
      <div style={{
        marginTop: 12, padding: 12,
        background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
        fontSize: 12, color: "var(--muted)",
      }}>
        {t("Загрузка данных аккаунта…", "Жүктөлүүдө…")}
      </div>
    );
  }

  return (
    <div style={{
      marginTop: 12, padding: 12,
      background: "var(--green-50)",
      border: "1px solid oklch(0.86 0.10 150)",
      borderRadius: "var(--r-sm)",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        fontSize: 12, fontWeight: 600, color: "oklch(0.40 0.14 150)",
        textTransform: "uppercase", letterSpacing: 0.04,
      }}>
        <Icon name="check" size={14} />
        {t("Доступ в систему", "Системага кирүү")}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--ink)" }}>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("ФИО:", "ФИО:")} </span>
          <b>{profile.full_name}</b>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Email:", "Email:")} </span>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {profile.email || t("(не задан)", "(жок)")}
          </code>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Телефон:", "Телефон:")} </span>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
            {profile.phone || t("(не задан)", "(жок)")}
          </code>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {t("Пароль не показывается. Для смены — кнопка «Сбросить пароль».",
             "Сырсөз көрсөтүлбөйт. «Сбросить пароль» баскычын колдонуңуз.")}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          type="button" className="btn"
          onClick={() => { setEditLoginOpen((v) => !v); setResetPwOpen(false); }}
          disabled={busy}
          style={{ padding: "6px 12px", fontSize: 12 }}
        >
          <Icon name="settings" size={12} /> {editLoginOpen ? t("Скрыть", "Жашыруу") : t("Изменить логин", "Логинди өзгөртүү")}
        </button>
        <button
          type="button" className="btn"
          onClick={() => { setResetPwOpen((v) => !v); setEditLoginOpen(false); }}
          disabled={busy}
          style={{ padding: "6px 12px", fontSize: 12 }}
        >
          <Icon name="restore" size={12} /> {resetPwOpen ? t("Отмена", "Жокко") : t("Сбросить пароль", "Сырсөздү алмаштыруу")}
        </button>
      </div>

      {editLoginOpen && (
        <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
          <Field label={t("ФИО тренера (для входа)", "Тренердин толук аты")}>
            <input value={loginFullName} onChange={(e) => setLoginFullName(e.target.value)} disabled={busy} />
          </Field>
          <div className="grid-2">
            <Field label={t("Email", "Email")}>
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} disabled={busy} />
            </Field>
            <Field label={t("Телефон", "Телефон")}>
              <input value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
            </Field>
          </div>
          {err && <div className="field__error" style={{ marginBottom: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ padding: "6px 12px", fontSize: 12 }}
              disabled={busy || !loginFullName.trim() || !loginPhone.trim()}
              onClick={async () => {
                setErr(null);
                try {
                  const patch: Parameters<typeof upd.mutateAsync>[0]["profile"] = {};
                  if (loginFullName.trim() !== (profile.full_name ?? "")) patch!.full_name = loginFullName.trim();
                  const emailNorm = loginEmail.trim() ? loginEmail.trim() : null;
                  if (emailNorm !== (profile.email ?? null)) patch!.email = emailNorm;
                  if (loginPhone.trim() !== (profile.phone ?? "")) patch!.phone = loginPhone.trim();
                  if (Object.keys(patch!).length > 0) {
                    await upd.mutateAsync({ id: coachId, profile: patch });
                  }
                  setEditLoginOpen(false);
                } catch (e: unknown) { setErr(friendlyAuthError((e as Error).message)); }
              }}
            >
              {t("Сохранить логин", "Логинди сактоо")}
            </button>
          </div>
        </div>
      )}

      {resetPwOpen && (
        <div style={{ marginTop: 10, padding: 10, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
          <Field label={t("Новый пароль (не менее 8 символов)", "Жаңы сырсөз (8+ белги)")}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type={revealPw ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="icon-btn"
                title={revealPw ? t("Скрыть", "Жашыруу") : t("Показать", "Көрсөтүү")}
                onClick={() => setRevealPw((v) => !v)}
              >
                <Icon name={revealPw ? "eye-off" : "eye"} size={14} />
              </button>
            </div>
          </Field>
          {err && <div className="field__error" style={{ marginBottom: 6 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn--primary"
              style={{ padding: "6px 12px", fontSize: 12 }}
              disabled={busy || newPassword.length < 8}
              onClick={async () => {
                setErr(null);
                try {
                  await upd.mutateAsync({ id: coachId, profile: { password: newPassword } });
                  setPwChangedValue(newPassword);
                  setPwChangedOpen(true);
                  setNewPassword("");
                  setResetPwOpen(false);
                  setRevealPw(false);
                } catch (e: unknown) { setErr(friendlyAuthError((e as Error).message)); }
              }}
            >
              {t("Сменить пароль", "Сырсөздү алмаштыруу")}
            </button>
          </div>
        </div>
      )}
      <PasswordChangedDialog
        open={pwChangedOpen}
        onClose={() => { setPwChangedOpen(false); setPwChangedValue(""); }}
        lang={lang}
        password={pwChangedValue}
        who={profile?.full_name ?? undefined}
      />
    </div>
  );
};

export const AddCoachModal = ({
  open, onClose, lang, initial,
}: { open: boolean; onClose: () => void; lang: Lang; initial?: CoachInitial }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = useAddCoach();
  const upd = useUpdateCoach();
  const archive = useArchive("profiles");
  const setSections = useSetCoachSections();
  const uploadAvatar = useUploadAvatar();
  const { data: sections = [] } = useSections();
  const { data: currentSectionIds = [] } = useCoachSections(initial?.id);
  const isEdit = !!initial?.id;

  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [achievements, setAchievements] = useState(initial?.achievements ?? "");
  const [exp, setExp] = useState(String(initial?.experience_years ?? ""));
  const [avatarUrl, setAvatarUrl] = useState<string>(initial?.avatar_url ?? "");
  // Оплата тренера (ТЗ §6.1, §10.1). По умолчанию процент от выручки 40% —
  // основной режим для единоборств.
  // Ставки тренера по ТЗ §2.2 ставит только директор/управляющий — то же
  // правило, что и в триггере forbid_coach_pay_change. Старший менеджер
  // тренера заводит, но блок оплаты не видит, иначе упрётся в ошибку БД.
  const canSetPay = usePerm("manage_coach_rates");
  const [payMode, setPayMode] = useState<CoachPayMode>(initial?.pay_mode ?? "percent");
  const [percentRate, setPercentRate] = useState(String(initial?.percent_rate ?? 40));
  const [fixedMonthly, setFixedMonthly] = useState(String(initial?.fixed_monthly ?? 0));
  const [sectionIds, setSectionIds] = useState<Set<string>>(new Set());
  const [sectionsLoaded, setSectionsLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pwChangedOpen, setPwChangedOpen] = useState(false);
  const [pwChangedValue, setPwChangedValue] = useState("");
  const [pwChangedWho, setPwChangedWho] = useState("");
  const busy = add.isPending || upd.isPending || archive.isPending || setSections.isPending || uploadAvatar.isPending;

  const generatePassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setPassword(s);
  };

  // Подтягиваем текущие секции тренера в state один раз при открытии.
  useEffect(() => {
    if (!open) { setSectionsLoaded(false); return; }
    if (sectionsLoaded) return;
    if (isEdit && currentSectionIds.length > 0) {
      setSectionIds(new Set(currentSectionIds));
    } else if (!isEdit) {
      setSectionIds(new Set());
    }
    setSectionsLoaded(true);
  }, [open, sectionsLoaded, isEdit, currentSectionIds]);

  const toggleSection = (sid: string) => {
    setSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid); else next.add(sid);
      return next;
    });
  };

  const onPickFile = async (file: File) => {
    setErr(null);
    try {
      const r = await uploadAvatar.mutateAsync(file);
      setAvatarUrl(r.url);
      toast.ok(t("Фото загружено", "Сүрөт жүктөлдү"));
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  };

  const reset = () => {
    setEmail(""); setPassword(""); setFullName(""); setPhone(""); setBio(""); setAchievements(""); setExp("");
    setAvatarUrl(""); setSectionIds(new Set()); setErr(null);
    setPayMode("percent"); setPercentRate("40"); setFixedMonthly("0");
  };

  // Поля оплаты пишутся прямо в coaches (RLS пускает только директора и
  // управляющего — ТЗ §2.2). Неактуальное для режима поле не обнуляем:
  // переключили на оклад и обратно — процент остался прежним.
  const payFields = () => ({
    pay_mode: payMode,
    percent_rate: percentRate === "" ? 0 : Number(percentRate),
    fixed_monthly: fixedMonthly === "" ? 0 : Number(fixedMonthly),
  });

  const submit = async () => {
    setErr(null);
    if (!isEdit && password.length < 8) {
      setErr(t("Пароль минимум 8 символов", "Сырсөз кеминде 8 белги"));
      return;
    }
    if (!isEdit && !isValidPhoneInput(phone)) {
      setErr(t("Укажите телефон в формате +996 700 12 34 56", "+996 700 12 34 56 форматында"));
      return;
    }
    // Без права на ставки поля оплаты вообще не отправляем: БД их всё
    // равно отклонит триггером, а затирать чужую настройку нельзя.
    const pay = canSetPay ? payFields() : null;
    if (pay && payMode === "percent" && (!Number.isFinite(pay.percent_rate) || pay.percent_rate < 0 || pay.percent_rate > 100)) {
      setErr(t("Процент тренера — число от 0 до 100", "Тренердин пайызы 0дөн 100гө чейин"));
      return;
    }
    if (pay && payMode === "fixed" && (!Number.isFinite(pay.fixed_monthly) || pay.fixed_monthly <= 0)) {
      setErr(t("Укажите оклад в месяц", "Айлык маяна көрсөтүңүз"));
      return;
    }
    try {
      if (isEdit) {
        await upd.mutateAsync({
          id: initial!.id!,
          profile: {
            full_name: fullName,
            phone: phone || null,
            avatar_url: avatarUrl || null,
          },
          coach: {
            bio: bio || null,
            achievements: achievements || null,
            experience_years: exp ? Number(exp) : 0,
            ...(pay ?? {}),
          },
        });
        // Sync sections
        await setSections.mutateAsync({ coachId: initial!.id!, sectionIds: Array.from(sectionIds) });
        toast.ok("Тренер обновлён");
        onClose();
        return;
      }
      const created = await add.mutateAsync({
        password, full_name: fullName,
        phone: normalizeE164KG(phone),
        email: email.trim() || null,
        bio: bio || null,
        achievements: achievements || null,
        experience_years: exp ? Number(exp) : 0,
      });
      // Аватар и модель оплаты POST /v1/coaches не принимает — дописываем
      // их отдельным апдейтом сразу после создания.
      if (avatarUrl || pay) {
        await upd.mutateAsync({
          id: created.coach_id,
          profile: avatarUrl ? { avatar_url: avatarUrl } : undefined,
          coach: pay ?? undefined,
        });
      }
      // Sync sections after coach is created
      if (sectionIds.size > 0) {
        await setSections.mutateAsync({ coachId: created.coach_id, sectionIds: Array.from(sectionIds) });
      }
      // Показываем подтверждение с паролем — модал НЕ закрываем, чтобы
      // директор успел скопировать. Очистка/закрытие — после Готово.
      setPwChangedValue(password);
      setPwChangedWho(fullName);
      setPwChangedOpen(true);
    } catch (e: unknown) {
      const msg = (e as Error).message;
      if (msg.includes("phone_previously_used")) {
        setErr(t(
          "Тренер с этим телефоном был архивирован. Восстановите его в «Архиве» или укажите другой номер.",
          "Бул телефон менен тренер архивде. «Архивден» калыбына келтириңиз же башка телефон коюңуз.",
        ));
      } else if (msg.includes("phone_already_exists")) {
        setErr(t("Этот телефон уже занят", "Бул телефон алынган"));
      } else if (msg.includes("email_already_exists")) {
        // Pseudo-email генерится из телефона, поэтому коллизию пишем именно про телефон.
        setErr(t(
          "Этот телефон уже использовался — занят в системе авторизации.",
          "Бул телефон мурда колдонулган.",
        ));
      } else {
        setErr(msg);
      }
    }
  };

  const handleArchive = async () => {
    if (!isEdit) return;
    if (!confirm(t("Архивировать тренера? Группы потеряют тренера.", "Тренерди архивдөө?"))) return;
    try {
      await archive.mutateAsync(initial!.id!);
      toast.ok(t("Тренер архивирован", "Архивделди"));
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={620} title={isEdit ? t("Редактировать тренера", "Тренерди өзгөртүү") : t("Новый тренер", "Жаңы тренер")}>
      {/* Фото-аватар: превью + загрузка из файла */}
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: "50%",
            background: "var(--blue)",
            border: "1px solid var(--line)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)",
            flexShrink: 0, overflow: "hidden", position: "relative",
          }}
        >
          {/* Инициалы как фоллбек видны всегда — фото перекрывает их сверху если загрузилось. */}
          {fullName ? fullName.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() : "?"}
          {avatarUrl && (
            <img
              src={resolveAvatarUrl(avatarUrl) ?? avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "cover", objectPosition: "center",
              }}
            />
          )}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="btn" style={{ alignSelf: "flex-start", cursor: busy ? "not-allowed" : "pointer", padding: "8px 14px", fontSize: 13 }}>
            <Icon name="download" size={14} />
            {uploadAvatar.isPending
              ? t("Загрузка…", "Жүктөлүүдө…")
              : (avatarUrl ? t("Заменить фото", "Сүрөттү алмаштыруу") : t("Загрузить фото", "Сүрөт жүктөө"))}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = "";
              }}
            />
          </label>
          {avatarUrl && (
            <button
              type="button"
              className="btn btn--ghost"
              style={{ alignSelf: "flex-start", padding: "6px 10px", fontSize: 12, color: "var(--red-600)" }}
              onClick={() => setAvatarUrl("")}
              disabled={busy}
            >
              <Icon name="x" size={12} /> {t("Удалить фото", "Сүрөттү өчүрүү")}
            </button>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            {t("JPG / PNG / WebP, до 5 МБ", "JPG / PNG / WebP, 5 МБ чейин")}
          </div>
        </div>
      </div>

      <Field label={t("ФИО", "ФИО")}>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} required />
      </Field>
      <div className="grid-2">
        <Field label={t("Телефон (логин)", "Телефон (логин)")}>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={busy}
            placeholder="+996 700 12 34 56"
            required
          />
        </Field>
        {!isEdit && (
          <Field label={<>{t("Пароль (мин. 8)", "Сырсөз (мин. 8)")} <span style={{ color: "var(--red-600)" }}>*</span></>}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
                minLength={8}
                style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                placeholder="••••••••"
              />
              <button type="button" className="btn" onClick={generatePassword} disabled={busy}>
                <Icon name="sparkle" size={14} /> {t("Сгенерировать", "Жаратуу")}
              </button>
            </div>
          </Field>
        )}
        <Field label={t("Email (опционально)", "Email (милдеттүү эмес)")}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy || isEdit} />
        </Field>
        <Field label={t("Лет опыта", "Тажрыйба, жыл")}>
          <input type="number" value={exp} onChange={(e) => setExp(e.target.value)} disabled={busy} />
        </Field>
      </div>
      {/* Секции — отдельным карточным блоком, чтобы не сливалось с Достижениями */}
      <div style={{
        padding: 12, marginBottom: 12,
        background: "var(--bg-soft)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 8,
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <span>{t("Секции ведёт", "Секциялар")}</span>
          {sections.length > 0 && (
            <span style={{ color: "var(--ink-2)", fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>
              {sectionIds.size} / {sections.length}
            </span>
          )}
        </div>
        {sections.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("Сначала создайте секции", "Адегенде секцияларды түзүңүз")}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sections.map((s) => {
              const on = sectionIds.has(s.id);
              const label = lang === "ru" ? s.name_ru : s.name_ky;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`btn ${on ? "btn--primary" : ""}`}
                  style={{ padding: "6px 12px", fontSize: 12 }}
                  onClick={() => toggleSection(s.id)}
                  disabled={busy}
                >
                  {on ? <Icon name="check" size={12} stroke={2.5} /> : null} {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Оплата тренера — ТЗ §6.1 «тип оплаты», §10.1 логика расчёта */}
      {canSetPay && (
      <div style={{
        padding: 12, marginBottom: 12,
        background: "var(--bg-soft)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: "var(--muted)",
          textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 8,
        }}>
          {t("Оплата тренера", "Тренердин төлөмү")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {([
            { v: "percent", ru: "% от выручки", ky: "Түшүмдөн %" },
            { v: "fixed", ru: "Оклад в месяц", ky: "Айлык маяна" },
            { v: "per_child", ru: "Ставка за ребёнка", ky: "Бала үчүн ставка" },
          ] as Array<{ v: CoachPayMode; ru: string; ky: string }>).map((o) => (
            <button
              key={o.v}
              type="button"
              className={`btn ${payMode === o.v ? "btn--primary" : ""}`}
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => setPayMode(o.v)}
              disabled={busy}
            >
              {payMode === o.v ? <Icon name="check" size={12} stroke={2.5} /> : null} {t(o.ru, o.ky)}
            </button>
          ))}
        </div>

        {payMode === "percent" && (
          <Field label={t("Процент от выручки занятия, %", "Сабактын түшүмүнөн пайыз, %")}>
            <input
              type="number" min={0} max={100} step={1}
              value={percentRate}
              onChange={(e) => setPercentRate(e.target.value)}
              disabled={busy}
            />
          </Field>
        )}
        {payMode === "fixed" && (
          <Field label={t("Оклад в месяц, сом", "Айлык маяна, сом")}>
            <input
              type="number" min={0} step={500}
              value={fixedMonthly}
              onChange={(e) => setFixedMonthly(e.target.value)}
              disabled={busy}
            />
          </Field>
        )}

        <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
          {payMode === "percent" && t(
            "За каждого пришедшего: доля абонемента, приходящаяся на одно занятие, × процент. Пробные не оплачиваются.",
            "Келген ар бир бала үчүн: бир сабакка туура келген абонементтин үлүшү × пайыз. Сыноо сабактары төлөнбөйт.",
          )}
          {payMode === "fixed" && t(
            "Посещения не влияют. Для дежурного тренера фитнес-зоны. В аванс попадает часть оклада за отработанные дни.",
            "Катышуулар таасир этпейт. Фитнес-зонанын кезметчи тренери үчүн.",
          )}
          {payMode === "per_child" && t(
            "Фиксированная ставка группы за каждого пришедшего ребёнка. Задаётся в карточке группы.",
            "Келген ар бир бала үчүн топтун белгиленген ставкасы. Топтун карточкасында коюлат.",
          )}
        </div>
      </div>
      )}

      <Field label={t("Био / квалификация", "Био / квалификация")}>
        <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} disabled={busy} />
      </Field>
      <Field label={t("Достижения", "Жетишкендиктер")}>
        <input value={achievements} onChange={(e) => setAchievements(e.target.value)} disabled={busy} placeholder="КМС, МС, тренер сборной…" />
      </Field>

      {/* Edit mode: блок «Доступ в систему» — копия параметра родителя */}
      {isEdit && initial?.id && (
        <CoachAccessBlock coachId={initial.id} lang={lang} />
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
       <div className="modal__foot">
        {isEdit && (
          <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
            <Icon name="x" size={14} /> {t("В архив", "Архивге")}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || !fullName || (!isEdit && (!phone || !password))}>
          {busy ? t("Сохраняем…", "Сакталууда…") : isEdit ? t("Сохранить", "Сактоо") : t("Создать тренера", "Тренер түзүү")}
        </button>
      </div>
      <PasswordChangedDialog
        open={pwChangedOpen}
        onClose={() => {
          setPwChangedOpen(false);
          setPwChangedValue("");
          setPwChangedWho("");
          reset();
          onClose();
        }}
        lang={lang}
        password={pwChangedValue}
        who={pwChangedWho}
      />
    </Modal>
  );
};

// =============================================================
// AddSection (also used for edit when initial provided)
// =============================================================
type SectionInitial = {
  id?: string;
  name_ru?: string;
  name_ky?: string;
  category?: SectionCategory;
  color?: string | null;
};

export const AddSectionModal = ({ open, onClose, lang, initial }: { open: boolean; onClose: () => void; lang: Lang; initial?: SectionInitial }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = useAddSection();
  const upd = useUpdateSection();
  const archive = useArchive("sections");
  const isEdit = !!initial?.id;
  const [nameRu, setNameRu] = useState(initial?.name_ru ?? "");
  const [nameKy, setNameKy] = useState(initial?.name_ky ?? "");
  const [category, setCategory] = useState<SectionCategory>(initial?.category ?? "martial_arts");
  const [color, setColor] = useState(initial?.color ?? "#3b82f6");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      const payload = {
        name_ru: nameRu, name_ky: nameKy || nameRu, category, color,
      };
      if (isEdit) await upd.mutateAsync({ id: initial!.id!, ...payload });
      else await add.mutateAsync(payload);
      onClose();
      if (!isEdit) { setNameRu(""); setNameKy(""); }
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  const handleArchive = async () => {
    if (!isEdit) return;
    if (!confirm(t("Архивировать секцию?", "Секцияны архивдөө?"))) return;
    await archive.mutateAsync(initial!.id!);
    onClose();
  };

  const busy = add.isPending || upd.isPending || archive.isPending;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t("Редактировать секцию", "Секцияны өзгөртүү") : t("Новая секция", "Жаңы секция")}>
      <div className="grid-2">
        <Field label={t("Название (RU)", "Аты (RU)")}>
          <input value={nameRu} onChange={(e) => setNameRu(e.target.value)} required disabled={busy} />
        </Field>
        <Field label={t("Название (KY)", "Аты (KY)")}>
          <input value={nameKy} onChange={(e) => setNameKy(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Направление", "Багыт")}>
          {/* Направление = category в БД; страница «Секции» группирует по нему. */}
          <select value={category} onChange={(e) => setCategory(e.target.value as SectionCategory)} disabled={busy}>
            <option value="martial_arts">{t("Единоборства", "Күрөш спорттору")}</option>
            <option value="fitness">{t("Фитнес-зона", "Фитнес-зона")}</option>
          </select>
        </Field>
        <Field label={t("Цвет", "Түс")}>
          <input type="color" value={color ?? "#3b82f6"} onChange={(e) => setColor(e.target.value)} style={{ height: 40 }} disabled={busy} />
        </Field>
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        {isEdit && (
          <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
            {t("В архив", "Архивге")}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || !nameRu}>
          {busy ? t("Сохраняем…", "Сакталууда…") : isEdit ? t("Сохранить", "Сактоо") : t("Создать", "Түзүү")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// AddGroup (also used to edit existing group)
// =============================================================
type GroupInitial = {
  id?: string;
  section_id?: string;
  coach_id?: string;
  name?: string;
  max_capacity?: number;
  duration_min?: number;
  starts_on?: string | null;
  ends_on?: string | null;
  // Детали группы (20260807000003): возраст и уровень.
  age_min?: number | null;
  age_max?: number | null;
  level?: string | null;
  audience?: GroupAudience;
};

// Горизонт автогенерации занятий при сохранении группы (8 недель).
const LESSON_HORIZON_DAYS = 56;
const localYmd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const AddGroupModal = ({ open, onClose, lang, defaultSectionId, initial }: { open: boolean; onClose: () => void; lang: Lang; defaultSectionId?: string; initial?: GroupInitial }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: sections = [] } = useSections();
  const { data: coaches = [] } = useCoaches();
  const add = useAddGroup();
  const upd = useUpdateGroup();
  const archive = useArchive("groups");
  const bulk = useBulkGenerateLessons();
  const isEdit = !!initial?.id;

  // Подгружаем существующее расписание группы при редактировании
  const { data: existingSchedule = [] } = useGroupSchedule(initial?.id);

  const [sectionId, setSectionId] = useState(initial?.section_id ?? defaultSectionId ?? "");
  const [coachId, setCoachId] = useState(initial?.coach_id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [cap, setCap] = useState(String(initial?.max_capacity ?? 12));
  const [dur, setDur] = useState(String(initial?.duration_min ?? 60));
  // Срок существования группы: группу набирают на учебный год / два года,
  // после ends_on занятия по ней не генерируются.
  const [startsOn, setStartsOn] = useState(initial?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(initial?.ends_on ?? "");
  // Ставка тренера за каждого пришедшего ребёнка (groups.coach_rate_per_child).
  const [rate, setRate] = useState(String((initial as any)?.coach_rate_per_child ?? 100));
  // Детали группы: секция — общее название направления, конкретика тут.
  const [ageMin, setAgeMin] = useState(initial?.age_min != null ? String(initial.age_min) : "");
  const [ageMax, setAgeMax] = useState(initial?.age_max != null ? String(initial.age_max) : "");
  const [level, setLevel] = useState(initial?.level ?? "");
  const [audience, setAudience] = useState<GroupAudience>(initial?.audience ?? "kids");
  // День недели → время начала. По умолчанию при создании — Пн/Ср/Пт 16:00.
  const [dayTimes, setDayTimes] = useState<Record<number, string>>(
    isEdit ? {} : { 1: "16:00", 3: "16:00", 5: "16:00" },
  );
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Локальный флаг submit: накрывает весь поток (insert group → insert
  // group_schedule → bulk-generate). Без него после add.mutateAsync кнопка
  // снова становится активной и быстрый второй клик создаёт дубликат группы.
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || add.isPending || upd.isPending || archive.isPending;

  // При первом получении group_schedule в edit-режиме — переносим в state.
  // Делаем один раз, чтобы не перетереть пользовательские правки.
  useEffect(() => {
    if (!isEdit || scheduleLoaded || !open) return;
    if (existingSchedule.length === 0) {
      setScheduleLoaded(true);
      return;
    }
    const next: Record<number, string> = {};
    for (const row of existingSchedule) {
      next[(row as any).day_of_week] = String((row as any).start_time).slice(0, 5);
    }
    setDayTimes(next);
    setScheduleLoaded(true);
  }, [isEdit, scheduleLoaded, open, existingSchedule]);

  const toggleDay = (d: number) => {
    setDayTimes((prev) => {
      if (d in prev) {
        const { [d]: _removed, ...rest } = prev;
        return rest;
      }
      // При добавлении дня берём время первого уже выбранного дня (если есть)
      const existingTimes = Object.values(prev);
      return { ...prev, [d]: existingTimes[0] ?? "16:00" };
    });
  };

  const setDayTime = (d: number, time: string) => {
    setDayTimes((prev) => ({ ...prev, [d]: time }));
  };

  const submit = async () => {
    if (submitting) return;
    setErr(null);
    const days = Object.keys(dayTimes).map(Number).sort();
    if (days.length === 0) {
      setErr(t("Выберите хотя бы один день", "Жок дегенде бир күн"));
      return;
    }
    // Проверка: для каждого дня есть валидное время HH:MM
    for (const d of days) {
      const v = dayTimes[d];
      if (!/^\d{2}:\d{2}$/.test(v ?? "")) {
        setErr(t("Укажите время для каждого выбранного дня", "Тандалган күн үчүн убакытты көрсөтүңүз"));
        return;
      }
    }
    if (startsOn && endsOn && endsOn < startsOn) {
      setErr(t("Срок: дата окончания раньше даты начала", "Мөөнөт: аяктоо күнү эрте"));
      return;
    }
    if (ageMin !== "" && ageMax !== "" && Number(ageMin) > Number(ageMax)) {
      setErr(t("Возраст: «от» больше, чем «до»", "Жаш: «баштап» «чейинден» чоң"));
      return;
    }
    setSubmitting(true);
    try {
      const term = {
        starts_on: startsOn || null,
        ends_on: endsOn || null,
        coach_rate_per_child: Math.max(0, Number(rate) || 0),
        age_min: ageMin === "" ? null : Math.max(0, Number(ageMin) || 0),
        age_max: ageMax === "" ? null : Math.max(0, Number(ageMax) || 0),
        level: level.trim() || null,
        audience,
      };
      let groupId = initial?.id;
      if (isEdit) {
        await upd.mutateAsync({
          id: initial!.id!,
          section_id: sectionId, coach_id: coachId, name,
          max_capacity: Number(cap), duration_min: Number(dur),
          ...term,
        });
      } else {
        const grp = await add.mutateAsync({
          section_id: sectionId, coach_id: coachId, name,
          max_capacity: Number(cap), duration_min: Number(dur),
          ...term,
        });
        groupId = grp.id;
      }

      // Расписание — в edit-режиме перезаписываем целиком (delete+insert).
      // Lessons привязаны к group_id напрямую, не к group_schedule, поэтому
      // удаление шаблона безопасно.
      if (isEdit) {
        const { error: delErr } = await supabase
          .from("group_schedule")
          .delete()
          .eq("group_id", groupId!);
        if (delErr) throw delErr;
      }
      const sched = days.map((dow) => ({
        group_id: groupId!,
        day_of_week: dow,
        start_time: dayTimes[dow],
        duration_min: Number(dur),
      }));
      if (sched.length > 0) {
        const { error: insErr } = await supabase.from("group_schedule").insert(sched);
        if (insErr) throw insErr;
      }

      // Автоматически материализуем lessons на 8 недель вперёд из шаблона
      // group_schedule. Старт — понедельник текущей недели (даже если уже
      // прошёл), чтобы вся неделя была видна в календаре.
      try {
        const today = new Date();
        const monday = new Date(today);
        monday.setHours(0, 0, 0, 0);
        const dow = (monday.getDay() + 6) % 7; // Mon=0..Sun=6
        monday.setDate(monday.getDate() - dow);
        const horizon = new Date(monday.getTime() + LESSON_HORIZON_DAYS * 86400000);
        // Backend дополнительно обрежет диапазон по сроку группы; здесь
        // сужаем сразу, чтобы не гонять лишние даты.
        const from = startsOn && startsOn > localYmd(monday) ? startsOn : localYmd(monday);
        const to = endsOn && endsOn < localYmd(horizon) ? endsOn : localYmd(horizon);
        if (from <= to) {
          await bulk.mutateAsync({ group_id: groupId!, from, to });
        }
      } catch (e) {
        // Не блокируем сохранение группы, если у юзера нет прав на bulk-generate.
        // Шаблон расписания уже сохранён — занятия можно сгенерировать вручную.
        console.warn("auto bulk-generate failed:", e);
      }

      toast.ok(isEdit ? "Группа обновлена" : "Группа создана");
      onClose();
      if (!isEdit) {
        setName(""); setSectionId(defaultSectionId ?? ""); setCoachId("");
        setAgeMin(""); setAgeMax(""); setLevel(""); setAudience("kids");
        setDayTimes({ 1: "16:00", 3: "16:00", 5: "16:00" });
      }
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async () => {
    if (!isEdit) return;
    if (!confirm(t("Архивировать группу? Расписание тоже скроется.", "Топту архивдөө?"))) return;
    try {
      await archive.mutateAsync(initial!.id!);
      toast.ok(t("Группа архивирована", "Архивделди"));
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  const dayLabels = lang === "ru"
    ? ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]
    : ["Жш", "Дш", "Ше", "Ша", "Бш", "Жм", "Иш"];
  const dayFull = lang === "ru"
    ? ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]
    : ["Жекшемби", "Дүйшөмбү", "Шейшемби", "Шаршемби", "Бейшемби", "Жума", "Ишемби"];

  const selectedDays = Object.keys(dayTimes).map(Number).sort();

  return (
    <Modal open={open} onClose={onClose} width={620} title={isEdit ? t("Редактировать группу", "Топту өзгөртүү") : t("Новая группа", "Жаңы топ")}>
      <Field label={t("Название", "Аты")}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("СГ-2 (старшая)", "СГ-2")} />
      </Field>
      <div className="grid-2">
        <Field label={t("Секция", "Секция")}>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {sections.map((s) => (<option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>))}
          </select>
        </Field>
        <Field label={t("Тренер", "Тренер")}>
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {coaches.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
          </select>
        </Field>
        <Field label={t("Вместимость", "Багуу")}>
          <input type="number" value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label={t("Длительность (мин)", "Узактыгы (мин)")}>
          <input type="number" value={dur} onChange={(e) => setDur(e.target.value)} />
        </Field>
        <Field
          label={t("Ставка тренера, сом/ребёнок", "Тренер ставкасы, сом/бала")}
          hint={t("За каждого пришедшего ребёнка на занятии", "Ар бир келген бала үчүн")}
        >
          <input type="number" min={0} step={1} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="100" />
        </Field>
        <Field label={t("Аудитория", "Аудитория")}>
          <select value={audience} onChange={(e) => setAudience(e.target.value as GroupAudience)}>
            <option value="kids">{t("Дети", "Балдар")}</option>
            <option value="adults">{t("Взрослые", "Чоңдор")}</option>
            <option value="mixed">{t("Смешанная", "Аралаш")}</option>
          </select>
        </Field>
        <Field label={t("Уровень / примечание", "Деңгээл / эскертүү")}>
          <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t("старшая, ОФП…", "улуу топ…")} disabled={busy} />
        </Field>
        <Field label={t("Возраст, от", "Жашы, баштап")}>
          <input type="number" min={0} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder={t("напр. 5", "мис. 5")} disabled={busy} />
        </Field>
        <Field label={t("Возраст, до", "Жашы, чейин")}>
          <input type="number" min={0} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder={t("напр. 8", "мис. 8")} disabled={busy} />
        </Field>
      </div>

      <div className="grid-2">
        <Field label={t("Группа работает с", "Топ иштейт")}>
          <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field
          label={t("по (срок группы)", "чейин (мөөнөт)")}
          hint={t(
            "Занятия не создаются после этой даты. Пусто — группа бессрочная.",
            "Бул күндөн кийин сабак түзүлбөйт. Бош — мөөнөтсүз.",
          )}
        >
          <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      {!isEdit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {[
            { m: 6, ru: "полгода", ky: "6 ай" },
            { m: 12, ru: "год", ky: "1 жыл" },
            { m: 24, ru: "2 года", ky: "2 жыл" },
          ].map(({ m, ru, ky }) => (
            <button
              key={m}
              type="button"
              className="btn btn--ghost"
              style={{ padding: "5px 10px", fontSize: 12 }}
              onClick={() => {
                const from = startsOn ? new Date(startsOn + "T00:00:00") : new Date();
                const to = new Date(from);
                to.setMonth(to.getMonth() + m);
                to.setDate(to.getDate() - 1);
                if (!startsOn) setStartsOn(localYmd(from));
                setEndsOn(localYmd(to));
              }}
              disabled={busy}
            >
              {t(ru, ky)}
            </button>
          ))}
        </div>
      )}

      <Field label={t("Дни занятий", "Сабак күндөрү")}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button
              key={d}
              type="button"
              className={`btn ${d in dayTimes ? "btn--primary" : ""}`}
              style={{ padding: "8px 14px", fontSize: 12, minWidth: 48 }}
              onClick={() => toggleDay(d)}
              disabled={busy}
            >
              {dayLabels[d]}
            </button>
          ))}
        </div>
      </Field>

      {selectedDays.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {t("Время начала по дням", "Күн боюнча башталыш")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selectedDays.map((d) => (
              <div
                key={d}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--bg-soft)", padding: "8px 12px",
                  borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
                }}
              >
                <div style={{ width: 110, fontWeight: 600, fontSize: 13 }}>
                  {dayFull[d]}
                </div>
                <input
                  type="time"
                  value={dayTimes[d] ?? "16:00"}
                  onChange={(e) => setDayTime(d, e.target.value)}
                  disabled={busy}
                  style={{ flex: 1, maxWidth: 140 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title={t("Убрать день", "Күндү алып салуу")}
                  onClick={() => toggleDay(d)}
                  disabled={busy}
                  style={{ color: "var(--red-600)" }}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        {isEdit && (
          <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
            <Icon name="x" size={14} /> {t("В архив", "Архивге")}
          </button>
        )}
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || !name || !sectionId || !coachId}>
          {busy ? t("Сохраняем…", "Сакталууда…") : isEdit ? t("Сохранить", "Сактоо") : t("Создать группу", "Топ түзүү")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// AddLead
// =============================================================
export const AddLeadModal = ({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: sections = [] } = useSections();
  const add = useAddLead();
  const [pname, setPname] = useState("");
  const [phone, setPhone] = useState("");
  const [cname, setCname] = useState("");
  const [age, setAge] = useState("");
  const [secId, setSecId] = useState("");
  // ТЗ §8.1: таргет Instagram — основной канал, поэтому он по умолчанию.
  const [source, setSource] = useState<LeadSource>("target");
  const [instagram, setInstagram] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!phone.trim() && !instagram.trim()) {
      setErr(t("Нужен телефон или Instagram — иначе с лидом не связаться",
               "Телефон же Instagram керек"));
      return;
    }
    try {
      // Этап всегда «новый»: с этого момента идёт отсчёт норматива
      // первого контакта (ТЗ §8.3 — 10 минут). Выбирать этап руками при
      // создании нельзя, иначе SLA можно обойти, заведя лид сразу
      // «сконвертированным».
      await add.mutateAsync({
        parent_name: pname || null, phone: phone || null,
        child_name: cname || null, child_age: age ? Number(age) : null,
        section_interest_id: secId || null, stage: "new", source,
        instagram: instagram.trim() ? instagram.trim().replace(/^@/, "") : null,
      });
      onClose();
      setPname(""); setPhone(""); setCname(""); setAge(""); setInstagram("");
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Новый лид", "Жаңы арыз")}>
      <div className="grid-2">
        <Field label={t("Родитель", "Ата-эне")}>
          <input value={pname} onChange={(e) => setPname(e.target.value)} />
        </Field>
        <Field label={t("Телефон", "Телефон")}>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+996 …" />
        </Field>
        <Field label={t("Имя ребёнка", "Бала аты")}>
          <input value={cname} onChange={(e) => setCname(e.target.value)} />
        </Field>
        <Field label={t("Возраст", "Жашы")}>
          <input type="number" value={age} onChange={(e) => setAge(e.target.value)} />
        </Field>
        <Field label={t("Секция (интерес)", "Секция")}>
          <select value={secId} onChange={(e) => setSecId(e.target.value)}>
            <option value="">—</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>)}
          </select>
        </Field>
        <Field label={t("Источник", "Булак")}>
          <select value={source} onChange={(e) => setSource(e.target.value as LeadSource)}>
            <option value="target">{t("Таргет Instagram", "Instagram таргет")}</option>
            <option value="referral">{t("Рекомендация", "Сунуштама")}</option>
            <option value="direct">{t("Прямое обращение", "Түз кайрылуу")}</option>
            <option value="other">{t("Другое", "Башка")}</option>
          </select>
        </Field>
        <Field label={t("Instagram", "Instagram")}>
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@nickname" />
        </Field>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -4, marginBottom: 8, lineHeight: 1.45 }}>
        {t("Лид создаётся на этапе «Новый». Связаться нужно в течение 10 минут — дальше воронка подсветит просрочку.",
           "Арыз «Жаңы» этабында түзүлөт. 10 мүнөттүн ичинде байланышуу керек.")}
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={add.isPending}>
          {add.isPending ? "…" : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// SellCard — uses backend POST /v1/cards/sell (auto-applies 2nd-child discount on backend)
// presetChildId: если передан — ребёнок зафиксирован (вызов из ChildDrawer),
// селект и кнопка «новый ребёнок» прячутся, отображается имя read-only.
// =============================================================
export const SellCardModal = ({
  open, onClose, lang, presetChildId, presetSectionId, presetGroupId,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  presetChildId?: string;
  // Preset из GroupDrawer (продажа внутри группы расписания) —
  // секция и группа фиксируются read-only.
  presetSectionId?: string;
  presetGroupId?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [] } = useChildren();
  const { data: cards = [] } = useCards();
  const { data: sections = [] } = useSections();
  const { data: groupsAll = [] } = useGroupsQ();
  // Каталог тарифов: менеджер выбирает тариф, тип/занятия/цена заполняются
  // сами. "" = ручной ввод (fallback, пока каталог пуст).
  const { data: plans = [] } = useCardPlans();
  const sell = useSellCard();
  const [childId, setChildId] = useState(presetChildId ?? "");
  const [sectionId, setSectionId] = useState(presetSectionId ?? "");
  const [groupId, setGroupId] = useState(presetGroupId ?? "");
  const [planId, setPlanId] = useState("");
  const [type, setType] = useState<CardType>("monthly");
  const [total, setTotal] = useState("12");
  // Дата первой тренировки — старт окна записи (по умолчанию сегодня).
  const [firstLessonDate, setFirstLessonDate] = useState(() => new Date().toISOString().slice(0, 10));
  // Цена абонемента — вводится менеджером при продаже (у секции цены нет).
  const [price, setPrice] = useState("");
  // Скидка в сомах (0..цена). Обязательное поле. Бэкенд принимает процент,
  // поэтому перед отправкой сумма конвертируется в точную долю от цены.
  const [discountAmt, setDiscountAmt] = useState("0");
  // ТЗ §3.3: индивидуальную скидку менеджер обязан обосновать. Поле
  // появляется, только когда скидка больше нуля; авто-скидку на 2-го
  // ребёнка и реферальный бонус проставляет сама БД, обосновывать их
  // руками не нужно.
  const [discountReason, setDiscountReason] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  // Деньги с депозита — строка чтобы можно было вводить вручную и контролировать.
  const [depositInput, setDepositInput] = useState("0");
  // Частичная оплата: остаток уходит в долг по карте (жалоба офиса 2026-09-18:
  // «долг не отображается» — потому что «Доплата» была readonly и долг при
  // продаже возникнуть не мог). По умолчанию выключено — полная оплата.
  const [partialPay, setPartialPay] = useState(false);
  const [cashInput, setCashInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [newChildOpen, setNewChildOpen] = useState(false);

  // Активные карты ребёнка — для preflight-проверки дубликата на ту же секцию.
  const { data: activeCards = [] } = useChildActiveCards(childId || undefined);
  // Баланс депозита выбранного ребёнка.
  const { data: depositBalance = 0 } = useDepositBalance(childId || undefined);
  // Настройки скидок клуба — чтобы итог совпадал с тем, что применит RPC на бэке.
  const { data: orgSettings } = useOrgSettings();
  // Расписание выбранной группы — для расчёта окна записи (даты N-го занятия).
  const { data: groupSchedule = [] } = useGroupSchedule(groupId || undefined);
  // Переход в другую группу той же секции: текущие записи ребёнка в других
  // группах секции предлагаем закрыть вместе с продажей — иначе он
  // останется в составе старой группы (запрос офиса 2026-09-02).
  const { data: childEnrollments = [] } = useChildEnrollments(childId || undefined);
  const removeEnroll = useRemoveEnrollment();
  type EnrRow = { id: string; group_id: string; group: { id: string; name: string; section_id: string } | null };
  const otherGroupsInSection = useMemo((): EnrRow[] => {
    if (!groupId || !sectionId) return [];
    // supabase для join иногда типизирует group массивом — нормализуем.
    return (childEnrollments as unknown as Array<Omit<EnrRow, "group"> & { group: EnrRow["group"] | EnrRow["group"][] }>)
      .map((e) => ({ ...e, group: Array.isArray(e.group) ? (e.group[0] ?? null) : e.group }))
      .filter((e) => e.group && e.group.section_id === sectionId && e.group_id !== groupId);
  }, [childEnrollments, groupId, sectionId]);
  const [leaveOthers, setLeaveOthers] = useState(true);

  // Сбрасываем поля при закрытии — чтобы не показывали остатки прошлой продажи.
  // При preset-ребёнке всё равно сбрасываем секцию/тип/цену, но childId восстанавливаем.
  useEffect(() => {
    if (!open) {
      setChildId(presetChildId ?? "");
      setSectionId(presetSectionId ?? "");
      setGroupId(presetGroupId ?? "");
      setPlanId(""); setType("monthly"); setTotal("12"); setPrice("");
      setFirstLessonDate(new Date().toISOString().slice(0, 10));
      setDiscountAmt("0"); setMethod("cash"); setDepositInput("0");
      setPartialPay(false); setCashInput("");
      setLeaveOthers(true);
      setErr(null);
    } else {
      if (presetChildId) setChildId(presetChildId);
      if (presetSectionId) setSectionId(presetSectionId);
      if (presetGroupId) setGroupId(presetGroupId);
    }
  }, [open, presetChildId, presetSectionId, presetGroupId]);

  // При смене ребёнка сбрасываем сумму с депозита: у нового ребёнка свой баланс.
  useEffect(() => {
    setDepositInput("0");
  }, [childId]);

  // При смене секции обнуляем выбранную группу, чтобы не остаться
  // на группе другой секции.
  useEffect(() => {
    if (!sectionId) return;
    setGroupId((g) => {
      if (!g) return "";
      const grp = groupsAll.find((x: { id: string; section_id?: string }) => x.id === g);
      return grp && (grp as { section_id: string }).section_id === sectionId ? g : "";
    });
  }, [sectionId, groupsAll]);

  // Выбранный тариф из каталога. При выборе — тип/занятия/цена из тарифа.
  const plan = plans.find((p) => p.id === planId) ?? null;
  useEffect(() => {
    if (!plan) return;
    setType(plan.type);
    setTotal(plan.lessons_count != null ? String(plan.lessons_count) : "");
    setPrice(String(Number(plan.price)));
    // deps по planId: правки цены менеджером не затираются фоновым refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  // Группы фильтруются по выбранной секции.
  const groupsForSection = sectionId
    ? groupsAll.filter((g: { section_id?: string }) => (g as { section_id: string }).section_id === sectionId)
    : [];

  // Detect 2nd-child case for UI hint
  const selectedKid = kids.find((k) => k.id === childId);
  const familyId = selectedKid?.family_id;
  const siblingHasActiveCard = familyId
    ? cards.some((c) => c.child?.family_id === familyId && c.child_id !== childId && (c.status === "active" || c.status === "ending"))
    : false;

  const priceNum = Number(price) || 0;
  const manualDiscount = Math.min(Math.max(0, Number(discountAmt) || 0), priceNum);
  // Авто-скидка для 2-го ребёнка: сумму и вкл/выкл берём из org_settings —
  // тот же источник, что использует RPC sell_card_with_deposit на бэке.
  // Это гарантирует, что итог в модалке совпадёт с card.discount на сервере.
  const siblingEnabled = orgSettings?.sibling_discount_enabled ?? true;
  const siblingAmount = Number(orgSettings?.sibling_discount_amount ?? 500);
  const siblingApplies = siblingHasActiveCard && siblingEnabled && siblingAmount > 0;
  const effectiveDiscount = siblingApplies
    ? Math.max(manualDiscount, siblingAmount)
    : manualDiscount;
  const finalPrice = Math.max(0, priceNum - effectiveDiscount);
  const willAutoBoost = siblingApplies && manualDiscount < siblingAmount;
  // API принимает процент: передаём точную долю (без округления) — RPC
  // округлит сумму скидки обратно до сомов, итог совпадёт с введённым.
  const pctNum = priceNum > 0 ? Math.min(100, (manualDiscount / priceNum) * 100) : 0;

  // Preflight. Конфликт — только активная карта ТОЙ ЖЕ секции, чей период
  // ещё покрывает дату первой тренировки. Будущая продажа (старт после
  // конца текущей карты) и параллельная секция — разрешены.
  const hasSameSectionActive = sectionId
    ? activeCards.some((c) => c.section_id === sectionId && c.end_date >= firstLessonDate)
    : false;
  const sameSectionFuture = sectionId
    ? !hasSameSectionActive && activeCards.some((c) => c.section_id === sectionId)
    : false;
  const hasOtherSectionActive = activeCards.some(
    (c) => c.section_id != null && c.section_id !== sectionId,
  );

  // Разбивка оплаты на «с депозита» + «нал/терминал». Юзер вводит сумму с депозита,
  // остаток автоматически идёт на доплату.
  const depositRequested = Math.max(0, Number(depositInput) || 0);
  const depositOverBalance = depositRequested > depositBalance + 0.01;
  const depositOverFinal = depositRequested > finalPrice + 0.01;
  const depositAmount = Math.min(depositRequested, depositBalance, finalPrice);
  // Сколько надо доплатить налом/терминалом после депозита; при частичной
  // оплате менеджер вводит меньшую сумму, разница = долг по карте.
  const cashDue = Math.max(0, finalPrice - depositAmount);
  const cashAmount = partialPay ? Math.min(cashDue, Math.max(0, Number(cashInput) || 0)) : cashDue;
  const debtAfterSale = Math.max(0, cashDue - cashAmount);

  const today = new Date().toISOString().slice(0, 10);
  const inDays = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  // Срок карты: из тарифа; при ручном вводе — фолбэк по типу.
  const periodDays = plan?.duration_days
    ?? (type === "quarterly" ? 90 : type === "half_year" ? 180 : type === "annual" ? 360 : type === "nine_month" ? 270 : 30);

  // Окно записи: считаем только если выбрана группа с расписанием.
  // Иначе окно открытое (null/null) и карта живёт по обычному периоду.
  // Окно задаём только когда посчитали дату конца — без half-open окон.
  const lessonCount = Number(total) || 0;
  const hasWindow = !!groupId && groupSchedule.length > 0;
  const windowEnd = hasWindow ? computeWindowEnd(firstLessonDate, lessonCount, groupSchedule) : null;
  const windowStart = windowEnd ? firstLessonDate : null;
  const windowLabel = windowEnd ? formatWindow(lang, firstLessonDate, windowEnd, groupSchedule, lessonCount) : null;

  const submit = async () => {
    setErr(null);
    if (price === "" || isNaN(Number(price)) || Number(price) < 0) {
      setErr(t("Укажите цену абонемента", "Абонементтин баасын көрсөтүңүз"));
      return;
    }
    if (discountAmt === "" || isNaN(Number(discountAmt))) {
      setErr(t("Укажите скидку в сомах (0, если без скидки)", "Жеңилдикти сом менен көрсөтүңүз (жоксо 0)"));
      return;
    }
    if (Number(discountAmt) < 0 || Number(discountAmt) > priceNum) {
      setErr(t("Скидка не может быть больше цены", "Жеңилдик баадан чоң боло албайт"));
      return;
    }
    if (Number(discountAmt) > 0 && !discountReason.trim()) {
      setErr(t("Укажите причину скидки", "Жеңилдиктин себебин көрсөтүңүз"));
      return;
    }
    if (!sectionId) {
      setErr(t("Выберите секцию", "Секцияны тандаңыз"));
      return;
    }
    if (hasSameSectionActive) {
      setErr(t(
        "Период пересекается с действующим абонементом этой секции. Выберите дату первой тренировки после его окончания — или закройте текущий абонемент кнопкой «Закрыть» во вкладке «Абонементы» (история сохранится).",
        "Мезгил бул секциянын активдүү абонементи менен кайчылашат. Учурдагы абонементти «Жабуу» менен жабыңыз.",
      ));
      return;
    }
    // Абонемент на другую секцию продаже НЕ мешает — параллельные секции
    // поддерживаются (баланс считается по секции карты).
    if (depositOverBalance) {
      setErr(t("Сумма с депозита превышает доступный баланс", "Депозиттен суммасы балансты ашат"));
      return;
    }
    if (hasWindow && lessonCount > 0 && !windowEnd) {
      setErr(t("Не удалось рассчитать окно по расписанию группы", "Топтун жадыбалы боюнча терезе эсептелген жок"));
      return;
    }
    try {
      await sell.mutateAsync({
        child_id: childId, type, total_lessons: Number(total),
        // Снимок тарифа: по нему продление узнаёт цену и срок.
        plan_id: planId || null,
        duration_days: periodDays,
        freeze_quota: plan?.freeze_quota ?? 0,
        price: Number(price), discount_pct: pctNum,
        discount_reason: discountReason.trim() || null,
        // При окне: карта стартует с первой тренировки и «действует до»
        // даты N-го занятия (совпадает с окном ростера). Иначе — обычный период.
        start_date: windowStart ?? today,
        end_date: windowEnd ?? inDays(periodDays),
        payment_method: method,
        section_id: sectionId,
        group_id: groupId || null,
        deposit_amount: depositAmount,
        cash_amount: cashAmount,
        enrollment_start_date: windowStart,
        enrollment_end_date: windowEnd,
        // Ставка тренера больше не задаётся при продаже — она на группе
        // (groups.coach_rate_per_child, см. 20260805000001).
      });
      // Переход в другую группу: снять ребёнка со старых групп секции.
      // Продажа уже прошла — ошибка здесь не должна выглядеть как провал
      // продажи, поэтому не пробрасываем её в setErr.
      if (leaveOthers && otherGroupsInSection.length > 0) {
        for (const e of otherGroupsInSection) {
          try { await removeEnroll.mutateAsync(e.id); } catch { /* toast уже показан */ }
        }
      }
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  const fmtKGS = (v: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v) + " с";

  const presetChildName = presetChildId
    ? (kids.find((k) => k.id === presetChildId)?.full_name ?? "")
    : "";

  return (
    <Modal open={open} onClose={onClose} width={580} title={t("Продать абонемент", "Абонемент сатуу")}>
      {presetChildId ? (
        <Field label={t("Ребёнок", "Бала")}>
          <div style={{
            padding: "8px 12px", background: "var(--bg-soft)",
            border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
            fontWeight: 600, fontSize: 14,
          }}>
            {presetChildName || "—"}
          </div>
        </Field>
      ) : (
        <Field label={t("Ребёнок", "Бала")}>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={childId} onChange={(e) => setChildId(e.target.value)} style={{ flex: 1 }}>
              <option value="">— {t("выбрать", "тандоо")} —</option>
              {kids.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
            </select>
            <button
              type="button"
              className="btn"
              title={t("Создать нового ребёнка", "Жаңы бала түзүү")}
              onClick={() => setNewChildOpen(true)}
              style={{ flexShrink: 0, padding: "0 12px" }}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        </Field>
      )}

      {!presetChildId && (
        <AddChildModal
          open={newChildOpen}
          onClose={() => setNewChildOpen(false)}
          lang={lang}
          onCreated={(newId) => setChildId(newId)}
        />
      )}

      <div className="grid-2">
        <Field label={t("Секция", "Секция")}>
          {presetSectionId ? (
            <div style={{
              padding: "8px 12px", background: "var(--bg-soft)",
              border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              fontWeight: 600, fontSize: 14,
            }}>
              {(() => {
                const s = sections.find((x) => x.id === presetSectionId);
                return s ? (lang === "ru" ? s.name_ru : s.name_ky) : "—";
              })()}
            </div>
          ) : (
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} required>
              <option value="">— {t("выбрать", "тандоо")} —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("Группа (опц.)", "Топ (опц.)")}
          hint={!sectionId ? t("Выберите секцию", "Секцияны тандаңыз") : undefined}
        >
          {presetGroupId ? (
            <div style={{
              padding: "8px 12px", background: "var(--bg-soft)",
              border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              fontWeight: 600, fontSize: 14,
            }}>
              {groupsAll.find((g: { id: string; name?: string }) => g.id === presetGroupId)?.name ?? "—"}
            </div>
          ) : (
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={!sectionId || groupsForSection.length === 0}
            >
              <option value="">— {t("не выбирать", "тандабоо")} —</option>
              {groupsForSection.map((g: { id: string; name: string }) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          )}
        </Field>
        {otherGroupsInSection.length > 0 && (
          <label style={{
            gridColumn: "1 / -1", display: "flex", alignItems: "flex-start", gap: 8,
            padding: "8px 10px", background: "var(--yellow-100)", border: "1px solid oklch(0.92 0.10 90)",
            borderRadius: "var(--r-sm)", fontSize: 12.5, cursor: "pointer",
          }}>
            <input type="checkbox" checked={leaveOthers} onChange={(e) => setLeaveOthers(e.target.checked)} style={{ marginTop: 2 }} />
            <span>
              {t("Убрать из", "Чыгаруу:")}{" "}
              <b>{otherGroupsInSection.map((e) => `«${e.group?.name ?? ""}»`).join(", ")}</b>
              {" — "}
              {t("ребёнок переходит в новую группу. История посещений в старой группе сохранится.", "бала жаңы топко өтөт. Эски топтогу тарых сакталат.")}
            </span>
          </label>
        )}
        <Field
          label={t("Вид абонемента", "Абонемент түрү")}
          hint={plan
            ? `${plan.lessons_count ?? "∞"} ${t("занятий", "сабак")} · ${plan.duration_days} ${t("дней", "күн")}${plan.freeze_quota > 0 ? ` · ${plan.freeze_quota} ${t("заморозки", "тоңдуруу")}` : ""}`
            : plans.length === 0
              ? t("Видов пока нет — создайте их: Абонементы → Виды абонементов", "Түрлөр жок — түзүңүз: Абонементтер → Абонемент түрлөрү")
              : undefined}
        >
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">— {t("ввести вручную", "кол менен киргизүү")} —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {(lang === "ru" ? p.name_ru : p.name_ky)} — {Number(p.price).toLocaleString()} с
              </option>
            ))}
          </select>
        </Field>
        {!plan && (
          <Field label={t("Тип", "Түрү")}>
            <select value={type} onChange={(e) => setType(e.target.value as CardType)}>
              <option value="monthly">{t("Месячный (12)", "Айлык (12)")}</option>
              <option value="quarterly">{t("3 месяца (36)", "3 айлык (36)")}</option>
              <option value="half_year">{t("6 месяцев (72)", "6 айлык (72)")}</option>
              <option value="annual">{t("12 месяцев (144)", "12 айлык (144)")}</option>
              <option value="single">{t("Разовый (1)", "Бирдик (1)")}</option>
              <option value="trial">{t("Пробный", "Сыноо")}</option>
            </select>
          </Field>
        )}
        {/* Количество занятий правится и при выбранном тарифе: тариф лишь
            подставляет значение по умолчанию, менеджер может поменять руками. */}
        <Field
          label={t("Занятий", "Сабактар")}
          hint={plan && plan.lessons_count != null && Number(total) !== plan.lessons_count
            ? t(`Изменено вручную (по тарифу ${plan.lessons_count})`, `Кол менен өзгөртүлдү (тариф: ${plan.lessons_count})`)
            : undefined}
        >
          <input type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} />
        </Field>
        {groupId && (
          <Field label={t("Дата первой тренировки", "Биринчи машыгуу күнү")}>
            <input
              type="date"
              value={firstLessonDate}
              onChange={(e) => setFirstLessonDate(e.target.value)}
            />
          </Field>
        )}
        <Field label={t("Цена, KGS", "Баасы, KGS")}>
          <input
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            placeholder={t("напр. 5000", "мис. 5000")}
          />
        </Field>
        <Field label={t("Скидка, сом", "Жеңилдик, сом")}>
          <input
            type="number"
            min={0}
            step={1}
            value={discountAmt}
            onChange={(e) => setDiscountAmt(e.target.value)}
            required
            placeholder="0"
          />
        </Field>
      </div>

      {/* ТЗ §3.3: причина обязательна для любой ручной скидки */}
      {Number(discountAmt) > 0 && (
        <Field label={<>{t("Причина скидки", "Жеңилдиктин себеби")} <span style={{ color: "var(--red-600)" }}>*</span></>}>
          <input
            value={discountReason}
            onChange={(e) => setDiscountReason(e.target.value)}
            required
            placeholder={t("многодетная семья / сотрудник / акция…", "көп балалуу үй-бүлө / кызматкер / акция…")}
          />
        </Field>
      )}

      {/* Окно записи: дата первой тренировки → дата N-го занятия */}
      {groupId && (
        windowLabel ? (
          <div style={{
            marginTop: 4, marginBottom: 4, padding: "8px 12px",
            background: "var(--blue-50)", border: "1px solid var(--blue-100)",
            color: "var(--blue-ink)", borderRadius: "var(--r-sm)", fontSize: 12,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Icon name="calendar" size={14} />
            <span>{t("Окно записи", "Жазылуу терезеси")}: <b>{windowLabel}</b></span>
          </div>
        ) : groupSchedule.length === 0 ? (
          <div style={{
            marginTop: 4, marginBottom: 4, padding: "8px 12px",
            background: "var(--bg-soft)", border: "1px solid var(--line)",
            color: "var(--muted)", borderRadius: "var(--r-sm)", fontSize: 12,
          }}>
            {t(
              "У группы нет расписания — окно не задаётся, ребёнок будет в табеле без ограничения по датам.",
              "Топтун жадыбалы жок — терезе коюлбайт, бала табелде чектөөсүз болот.",
            )}
          </div>
        ) : null
      )}

      {/* Preflight: уже есть активная карта на эту секцию или на другую */}
      {childId && hasSameSectionActive && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--red-50, oklch(0.97 0.04 25))",
          border: "1px solid var(--red-600)", color: "var(--red-600)",
          borderRadius: "var(--r-sm)", fontSize: 12,
        }}>
          {t(
            "Период пересекается с активным абонементом этой секции. Продлите его или поставьте дату первой тренировки после его окончания.",
            "Мезгил бул секциянын активдүү абонементи менен кайчылашат. Аны узартыңыз же биринчи машыгуу күнүн анын аягынан кийин коюңуз.",
          )}
        </div>
      )}
      {childId && sameSectionFuture && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--green-50, oklch(0.96 0.05 150))",
          border: "1px solid oklch(0.88 0.08 150)",
          borderRadius: "var(--r-sm)", fontSize: 12,
        }}>
          {t(
            "Будущее продление: абонемент начнётся после окончания текущего.",
            "Келечектеги узартуу: абонемент учурдагысы бүткөндөн кийин башталат.",
          )}
        </div>
      )}
      {/* Абонемент на другую секцию — НЕ блокирует: ребёнок может ходить
          в две секции параллельно (баланс по-секционный с 20260809000001).
          Показываем нейтральную подсказку, без «сначала закройте». */}
      {childId && !hasSameSectionActive && hasOtherSectionActive && (
        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "var(--blue-50, var(--bg-soft))",
          border: "1px solid var(--blue-100, var(--line))", color: "var(--blue-ink, var(--ink))",
          borderRadius: "var(--r-sm)", fontSize: 12,
        }}>
          {t(
            "У ребёнка уже есть абонемент на другую секцию — это второй, параллельный.",
            "Балада башка секцияга абонемент бар — бул экинчи, катар абонемент.",
          )}
        </div>
      )}

      {/* Итого к оплате */}
      <div
        style={{
          marginTop: 4, padding: "12px 14px",
          background: "var(--bg-soft)", border: "1px solid var(--line)",
          borderRadius: "var(--r-sm)",
          display: "flex", flexDirection: "column", gap: 6, fontSize: 13,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--muted)" }}>{t("Цена", "Баасы")}</span>
          <span>{fmtKGS(priceNum)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ color: "var(--muted)" }}>
            {t("Скидка", "Жеңилдик")}
          </span>
          <span style={{ color: "var(--red-600)" }}>−{fmtKGS(effectiveDiscount)}</span>
        </div>
        <div style={{ height: 1, background: "var(--line)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 15 }}>
          <span>{t("К оплате", "Төлөнсүн")}</span>
          <span>{fmtKGS(finalPrice)}</span>
        </div>
      </div>

      {/* Способ оплаты: разбивка на депозит + доплату нал/терминал */}
      <div style={{
        marginTop: 10, padding: "12px 14px",
        background: "var(--surface)", border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        display: "flex", flexDirection: "column", gap: 10, fontSize: 13,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <b style={{ fontSize: 13 }}>{t("Способ оплаты", "Төлөм ыкмасы")}</b>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {t("Баланс депозита", "Депозит балансы")}: <b style={{ color: depositBalance > 0 ? "var(--green)" : "var(--muted)" }}>{fmtKGS(depositBalance)}</b>
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">{t("С депозита", "Депозиттен")}</span>
            <input
              type="number"
              min={0}
              max={Math.min(depositBalance, finalPrice)}
              step={1}
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              disabled={depositBalance <= 0 || !childId}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={depositBalance <= 0 || !childId}
            onClick={() => setDepositInput(String(Math.min(depositBalance, finalPrice)))}
            style={{ height: 40 }}
          >
            {t("Всё", "Баары")}
          </button>
        </div>

        <div className="grid-2" style={{ marginBottom: 0 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">
              {partialPay ? t("Оплачено сейчас", "Азыр төлөндү") : t("Доплата", "Кошумча төлөм")}
            </span>
            {partialPay ? (
              <input
                type="number"
                min={0}
                max={cashDue}
                step={1}
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                placeholder={String(cashDue)}
              />
            ) : (
              <input type="number" value={cashAmount} readOnly />
            )}
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field__label">{t("Метод", "Метод")}</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              disabled={cashAmount <= 0}
            >
              <option value="cash">{t("Наличные", "Накта")}</option>
              <option value="terminal">{t("Терминал", "Терминал")}</option>
            </select>
          </label>
        </div>

        <label className="check" style={{ marginTop: 2 }}>
          <input
            type="checkbox"
            checked={partialPay}
            onChange={(e) => { setPartialPay(e.target.checked); setCashInput(e.target.checked ? String(cashDue) : ""); }}
            disabled={cashDue <= 0}
          />
          <span>
            <b>{t("Частичная оплата — остаток в долг", "Жарым-жартылай төлөм — калганы карызга")}</b>
            <small>{t("долг покажется в карточке ребёнка и в списке «Должники»", "карыз баланын картасында жана «Карызкорлор» тизмесинде көрүнөт")}</small>
          </span>
        </label>
        {partialPay && debtAfterSale > 0 && (
          <div style={{
            padding: "8px 12px", fontSize: 13, fontWeight: 700, color: "var(--red-600)",
            background: "var(--red-50)", border: "1px solid var(--red-100)", borderRadius: "var(--r-sm)",
          }}>
            {t("Долг после продажи", "Сатуудан кийинки карыз")}: {fmtKGS(debtAfterSale)}
          </div>
        )}

        {depositOverBalance && (
          <div style={{ color: "var(--red-600)", fontSize: 12 }}>
            {t(
              `Сумма с депозита превышает доступный баланс (${fmtKGS(depositBalance)})`,
              `Депозиттен суммасы балансты ашат (${fmtKGS(depositBalance)})`,
            )}
          </div>
        )}
        {depositOverFinal && !depositOverBalance && (
          <div style={{ color: "var(--muted)", fontSize: 12 }}>
            {t(
              "С депозита нельзя списать больше итога — сумма автоматически уменьшена.",
              "Депозиттен итогтон көп жок — сумма автоматтык азайтылды.",
            )}
          </div>
        )}
      </div>

      {willAutoBoost && (
        <div
          style={{
            background: "var(--green-50)", border: "1px solid oklch(0.85 0.16 150)",
            color: "var(--green)", padding: "10px 12px", borderRadius: "var(--r-sm)",
            fontSize: 12, marginTop: 8,
          }}
        >
          <Icon name="sparkle" size={14} stroke={2} />{" "}
          {t(
            `Авто-скидка: второй ребёнок в семье — минимум ${siblingAmount} сом. Итог пересчитан.`,
            `Авто ${siblingAmount} сом жеңилдик — экинчи бала. Итог пересчиталды.`,
          )}
        </div>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={
            sell.isPending ||
            !childId ||
            !sectionId ||
            price === "" ||
            hasSameSectionActive ||
            // Карта на ДРУГУЮ секцию продажу не блокирует — параллельные
            // секции разрешены и на бэке (20260827000001). Эта строка тут
            // оставалась от старого правила и гасила кнопку «Продать».
            depositOverBalance
          }
        >
          {sell.isPending ? t("Продаём…", "Сатылууда…") : t("Продать", "Сатуу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// CreateFreeze — admin/manager initiating immediate approved freeze
// =============================================================
export const CreateFreezeModal = ({ open, onClose, lang }: { open: boolean; onClose: () => void; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Все абонементы, которые можно поставить на паузу — включая 'ending'
  // (доживает последние дни) и 'debt'. Раньше здесь был useCards("active"),
  // и ровно те карты, которые чаще всего и просят заморозить, в список
  // не попадали.
  const { data: cards = [] } = useFreezableCards();
  const create = useCreateFreezeFromMutations();
  const [cardId, setCardId] = useState("");
  const [q, setQ] = useState("");
  const [reason, setReason] = useState("");
  const todayStr = new Date().toISOString().slice(0, 10);
  const in14Str = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(in14Str);
  const [err, setErr] = useState<string | null>(null);

  const card = cards.find((c) => c.id === cardId);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((c) => (c.child?.full_name ?? "").toLowerCase().includes(needle));
  }, [cards, q]);

  const submit = async () => {
    setErr(null);
    if (!card) { setErr(t("Выберите абонемент", "Абонементти тандаңыз")); return; }
    if (endDate < startDate) {
      setErr(t("Дата окончания должна быть не раньше даты начала", "Аяктоо даты башталыштан кеч болушу керек"));
      return;
    }
    try {
      await create.mutateAsync({
        child_id: card.child_id,
        club_card_id: card.id,
        reason,
        start_date: startDate,
        end_date: endDate,
      });
      onClose();
      setCardId(""); setReason(""); setQ("");
      setStartDate(todayStr); setEndDate(in14Str);
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Новая заморозка", "Жаңы тындыруу")}>
      <Field label={t("Поиск по ребёнку", "Бала боюнча издөө")}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Фамилия или имя…", "Аты-жөнү…")} />
      </Field>
      <Field
        label={t("Абонемент", "Абонемент")}
        hint={t(
          "Заморозить можно любой действующий абонемент — даже если на нём осталась одна тренировка.",
          "Каалаган колдонуудагы абонементти тындырса болот.",
        )}
      >
        <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
          <option value="">— {t("выбрать", "тандоо")} —</option>
          {shown.map((c) => (
            <option key={c.id} value={c.id}>
              {c.child?.full_name ?? c.id.slice(0, 8)} · {c.type}
              {c.total_lessons ? ` · ${c.total_lessons}` : ""} · {fmtD(c.start_date)} → {fmtD(c.end_date)} · {c.status}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid-2">
        <Field label={t("С даты", "Качандан")}>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t("По дату", "Качанга чейин")}>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <Field label={t("Причина", "Себеп")}>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={create.isPending || !cardId || !reason || !startDate || !endDate}
        >
          {create.isPending ? "…" : t("Создать", "Түзүү")}
        </button>
      </div>
    </Modal>
  );
};

// import workaround to avoid circular reference
import { useCreateFreeze as useCreateFreezeFromMutations } from "../api/mutations";

// =============================================================
// Freeze approval (Approve/Reject) — small inline helpers
// =============================================================
export const useFreezeActions = () => {
  const approve = useApproveFreeze();
  const reject = useRejectFreeze();
  return { approve, reject };
};

// =============================================================
// CreateLessonModal — admin creates ad-hoc lesson
// =============================================================
export const CreateLessonModal = ({
  open, onClose, lang, defaultDate,
}: { open: boolean; onClose: () => void; lang: Lang; defaultDate?: string }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: groups = [] } = useGroupsQ();
  const create = useCreateLesson();
  const [groupId, setGroupId] = useState("");
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("16:00");
  const [duration, setDuration] = useState("60");
  const [type, setType] = useState<"regular" | "trial" | "single">("regular");
  const [err, setErr] = useState<string | null>(null);

  const group = groups.find((g) => g.id === groupId);

  const submit = async () => {
    setErr(null);
    if (!group) { setErr(t("Выберите группу", "Топту тандаңыз")); return; }
    try {
      await create.mutateAsync({
        group_id: groupId,
        coach_id: group.coach_id,
        date, start_time: startTime,
        duration_min: Number(duration),
        type,
      });
      onClose();
      setGroupId("");
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Новое занятие", "Жаңы сабак")}>
      <Field label={t("Группа", "Топ")}>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">— {t("выбрать", "тандоо")} —</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </Field>
      <div className="grid-2">
        <Field label={t("Дата", "Күн")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("Время начала", "Башталыш убакыт")}>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label={t("Длительность (мин)", "Узактыгы (мин)")}>
          <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <Field label={t("Тип", "Түрү")}>
          <select value={type} onChange={(e) => setType(e.target.value as "regular" | "trial" | "single")}>
            <option value="regular">{t("Обычное", "Кадимки")}</option>
            <option value="trial">{t("Пробное", "Сыноо")}</option>
            <option value="single">{t("Разовое", "Бирдик")}</option>
          </select>
        </Field>
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={create.isPending || !groupId}>
          {create.isPending ? "…" : t("Создать", "Түзүү")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// AcceptPaymentModal — staff records manual payment via backend.
// Поддерживает комбинированную оплату: часть с депозита + часть нал/терминал.
// =============================================================
export const AcceptPaymentModal = ({
  open, onClose, lang, presetChildId, presetCardId, presetAmount, presetComment,
}: {
  open: boolean; onClose: () => void; lang: Lang;
  // Погашение долга из карточки ребёнка: ребёнок и абонемент зафиксированы,
  // сумма = остаток долга (можно уменьшить — частичное погашение).
  presetChildId?: string; presetCardId?: string | null; presetAmount?: number; presetComment?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [] } = useChildren();
  const record = useRecordPayment();
  const [childId, setChildId] = useState(presetChildId ?? "");
  const [amount, setAmount] = useState(presetAmount != null ? String(presetAmount) : "5000");
  const [useDeposit, setUseDeposit] = useState("0");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [comment, setComment] = useState(presetComment ?? "");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (presetChildId) setChildId(presetChildId);
    if (presetAmount != null) setAmount(String(presetAmount));
    if (presetComment != null) setComment(presetComment);
    setUseDeposit("0"); setErr(null);
  }, [open, presetChildId, presetAmount, presetComment]);

  const { data: depositBalance = 0 } = useDepositBalance(childId || undefined);

  const amountNum = Number(amount) || 0;
  const useDepositRequested = Math.max(0, Number(useDeposit) || 0);
  const useDepositOver = useDepositRequested > depositBalance + 0.01;
  const useDepositAmount = Math.min(useDepositRequested, depositBalance);

  const fmtKGS = (v: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v) + " с";

  const submit = async () => {
    setErr(null);
    if (useDepositOver) {
      setErr(t("С депозита нельзя списать больше баланса", "Депозиттен балансты ашык эмес"));
      return;
    }
    if (amountNum <= 0 && useDepositAmount <= 0) {
      setErr(t("Введите сумму", "Сумманы көрсөтүңүз"));
      return;
    }
    try {
      await record.mutateAsync({
        child_id: childId,
        amount: amountNum,
        method,
        club_card_id: presetCardId ?? null,
        comment: comment || null,
        use_deposit: useDepositAmount,
      });
      onClose();
      if (!presetChildId) { setChildId(""); setAmount("5000"); setComment(""); }
      setUseDeposit("0");
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={presetCardId ? t("Погасить долг по абонементу", "Абонемент боюнча карызды төлөө") : t("Принять платёж", "Төлөм кабыл алуу")}>
      <Field label={t("Ребёнок", "Бала")}>
        <select value={childId} onChange={(e) => setChildId(e.target.value)} disabled={!!presetChildId}>
          <option value="">— {t("выбрать", "тандоо")} —</option>
          {kids.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
        </select>
      </Field>
      {presetCardId && presetAmount != null && (
        <div style={{ fontSize: 12.5, color: "var(--red-600)", marginBottom: 10 }}>
          {t("Остаток долга по абонементу", "Абонемент боюнча карыздын калдыгы")}: <b>{fmtKGS(presetAmount)}</b>
          {" · "}{t("сумму можно уменьшить — частичное погашение", "сумманы азайтса болот — жарым-жартылай төлөө")}
        </div>
      )}
      <div className="grid-2">
        <Field label={t("Сумма, KGS", "Сумма, KGS")} hint={t("Принять налом/терминалом", "Накта/терминалом кабыл алуу")}>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("Метод", "Метод")}>
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={amountNum <= 0}>
            <option value="cash">{t("Наличные", "Накта")}</option>
            <option value="terminal">{t("Терминал", "Терминал")}</option>
          </select>
        </Field>
      </div>

      {/* Опц. дополнительное списание с депозита */}
      {childId && (
        <Field
          label={t("Также списать с депозита (опц.)", "Депозиттен да чыгаруу (опц.)")}
          hint={t(`Доступно: ${fmtKGS(depositBalance)}`, `Жеткиликтүү: ${fmtKGS(depositBalance)}`)}
        >
          <input
            type="number"
            min={0}
            max={depositBalance}
            step={1}
            value={useDeposit}
            onChange={(e) => setUseDeposit(e.target.value)}
            disabled={depositBalance <= 0}
          />
        </Field>
      )}

      <Field label={t("Комментарий", "Комментарий")}>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={record.isPending || !childId || (amountNum <= 0 && useDepositAmount <= 0) || useDepositOver}
        >
          {record.isPending ? "…" : t("Принять", "Кабыл алуу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// TopUpDepositModal — пополнение депозита ребёнка нал/терминалом.
// =============================================================
export const TopUpDepositModal = ({
  open, onClose, lang, presetChildId,
}: { open: boolean; onClose: () => void; lang: Lang; presetChildId?: string }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [] } = useChildren();
  const topup = useTopUpDeposit();
  const [childId, setChildId] = useState(presetChildId ?? "");
  const [amount, setAmount] = useState("1000");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setChildId(presetChildId ?? "");
      setAmount("1000"); setMethod("cash"); setComment(""); setErr(null);
    } else if (presetChildId) {
      setChildId(presetChildId);
    }
  }, [open, presetChildId]);

  const presetName = presetChildId ? kids.find((k) => k.id === presetChildId)?.full_name ?? "" : "";

  const submit = async () => {
    setErr(null);
    if (!childId) { setErr(t("Выберите ребёнка", "Баланы тандаңыз")); return; }
    if (Number(amount) <= 0) { setErr(t("Сумма должна быть больше 0", "Сумма 0дөн көп болушу керек")); return; }
    try {
      await topup.mutateAsync({
        child_id: childId,
        amount: Number(amount),
        method,
        comment: comment || undefined,
      });
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Пополнить депозит", "Депозитти толтуруу")}>
      {presetChildId ? (
        <Field label={t("Ребёнок", "Бала")}>
          <div style={{
            padding: "8px 12px", background: "var(--bg-soft)",
            border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
            fontWeight: 600, fontSize: 14,
          }}>{presetName || "—"}</div>
        </Field>
      ) : (
        <Field label={t("Ребёнок", "Бала")}>
          <select value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
          </select>
        </Field>
      )}
      <div className="grid-2">
        <Field label={t("Сумма, KGS", "Сумма, KGS")}>
          <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={t("Метод", "Метод")}>
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            <option value="cash">{t("Наличные", "Накта")}</option>
            <option value="terminal">{t("Терминал", "Терминал")}</option>
          </select>
        </Field>
      </div>
      <Field label={t("Комментарий (опц.)", "Комментарий (опц.)")}>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={topup.isPending || !childId || Number(amount) <= 0}
        >
          {topup.isPending ? "…" : t("Пополнить", "Толтуруу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// WithdrawDepositModal — выдача наличных с депозита.
// Доступ: только директор / fitness_director / senior_manager (бэк проверяет).
// =============================================================
export const WithdrawDepositModal = ({
  open, onClose, lang, presetChildId,
}: { open: boolean; onClose: () => void; lang: Lang; presetChildId?: string }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [] } = useChildren();
  const withdraw = useWithdrawDeposit();
  const [childId, setChildId] = useState(presetChildId ?? "");
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const { data: depositBalance = 0 } = useDepositBalance(childId || undefined);

  useEffect(() => {
    if (!open) {
      setChildId(presetChildId ?? "");
      setAmount(""); setComment(""); setErr(null);
    } else if (presetChildId) {
      setChildId(presetChildId);
    }
  }, [open, presetChildId]);

  const presetName = presetChildId ? kids.find((k) => k.id === presetChildId)?.full_name ?? "" : "";
  const amountNum = Number(amount) || 0;
  const overBalance = amountNum > depositBalance + 0.01;

  const fmtKGS = (v: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v) + " с";

  const submit = async () => {
    setErr(null);
    if (!childId) { setErr(t("Выберите ребёнка", "Баланы тандаңыз")); return; }
    if (amountNum <= 0) { setErr(t("Сумма должна быть больше 0", "Сумма 0дөн көп болушу керек")); return; }
    if (overBalance) { setErr(t("Сумма превышает баланс", "Сумма балансты ашат")); return; }
    if (!comment.trim()) { setErr(t("Укажите причину выдачи", "Чыгаруу себебин көрсөтүңүз")); return; }
    try {
      await withdraw.mutateAsync({
        child_id: childId,
        amount: amountNum,
        comment: comment.trim(),
      });
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Вывести с депозита", "Депозиттен чыгаруу")}>
      {presetChildId ? (
        <Field label={t("Ребёнок", "Бала")}>
          <div style={{
            padding: "8px 12px", background: "var(--bg-soft)",
            border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
            fontWeight: 600, fontSize: 14,
          }}>{presetName || "—"}</div>
        </Field>
      ) : (
        <Field label={t("Ребёнок", "Бала")}>
          <select value={childId} onChange={(e) => setChildId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {kids.map((k) => <option key={k.id} value={k.id}>{k.full_name}</option>)}
          </select>
        </Field>
      )}

      {childId && (
        <div style={{
          marginBottom: 10, padding: "8px 12px",
          background: "var(--bg-soft)", border: "1px solid var(--line)",
          borderRadius: "var(--r-sm)", fontSize: 13,
          display: "flex", justifyContent: "space-between",
        }}>
          <span style={{ color: "var(--muted)" }}>{t("Доступно на депозите", "Депозитте жеткиликтүү")}</span>
          <b style={{ color: depositBalance > 0 ? "var(--green)" : "var(--muted)" }}>{fmtKGS(depositBalance)}</b>
        </div>
      )}

      <Field label={t("Сумма, KGS", "Сумма, KGS")}>
        <input
          type="number"
          min={1}
          max={depositBalance}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
        />
      </Field>
      <Field label={t("Причина выдачи", "Чыгаруу себеби")} hint={t("Обязательно", "Милдеттүү")}>
        <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} required />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={withdraw.isPending || !childId || amountNum <= 0 || overBalance || !comment.trim()}
        >
          {withdraw.isPending ? "…" : t("Выдать наличными", "Накта чыгаруу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// EditLessonModal — reschedule, change coach or substitute
// =============================================================
type LessonInitial = {
  id: string;
  date: string;
  start_time: string;
  duration_min: number;
  coach_id: string;
  substitute_coach_id?: string | null;
};

export const EditLessonModal = ({
  open, onClose, lang, lesson,
}: { open: boolean; onClose: () => void; lang: Lang; lesson: LessonInitial }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: coaches = [] } = useCoaches();
  const update = useUpdateLesson();
  const [date, setDate] = useState(lesson.date);
  const [startTime, setStartTime] = useState(lesson.start_time.slice(0, 5));
  const [duration, setDuration] = useState(String(lesson.duration_min));
  const [coachId, setCoachId] = useState(lesson.coach_id);
  const [subId, setSubId] = useState(lesson.substitute_coach_id ?? "");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      await update.mutateAsync({
        id: lesson.id,
        date,
        start_time: startTime,
        duration_min: Number(duration),
        coach_id: coachId,
        substitute_coach_id: subId || null,
      });
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Редактировать занятие", "Сабакты өзгөртүү")}>
      <div className="grid-2">
        <Field label={t("Дата", "Күн")}>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t("Время начала", "Башталыш")}>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </Field>
        <Field label={t("Длительность (мин)", "Узактык (мин)")}>
          <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        <Field label={t("Тренер", "Тренер")}>
          <select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            {coaches.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
          </select>
        </Field>
        <Field label={t("Замена (опц.)", "Алмаштыруу")}>
          <select value={subId} onChange={(e) => setSubId(e.target.value)}>
            <option value="">— {t("нет", "жок")} —</option>
            {coaches.filter((c) => c.id !== coachId).map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
          </select>
        </Field>
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={update.isPending}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={update.isPending}>
          {update.isPending ? "…" : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// CancelLessonModal
// =============================================================
export const CancelLessonModal = ({
  open, onClose, lang, lessonId,
}: { open: boolean; onClose: () => void; lang: Lang; lessonId: string }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const cancel = useCancelLesson();
  const [reason, setReason] = useState("");
  const [forceMaj, setForceMaj] = useState(false);
  // ТЗ §5.3 п.4: вина определяет, оплачивается ли занятие тренеру.
  const [fault, setFault] = useState<LessonFault | "">("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      await cancel.mutateAsync({
        id: lessonId,
        reason,
        force_majeure: forceMaj,
        cancellation_fault: fault || undefined,
      });
      onClose();
      setReason(""); setForceMaj(false); setFault("");
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Отмена занятия", "Сабакты жокко чыгаруу")}>
      <Field label={t("Причина", "Себеп")}>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>

      <Field label={t("Из-за чего отмена", "Эмнеден улам")}>
        <select
          value={forceMaj ? "force_majeure" : fault}
          onChange={(e) => setFault(e.target.value as LessonFault | "")}
          disabled={forceMaj}
        >
          <option value="">{t("— не указано —", "— көрсөтүлгөн эмес —")}</option>
          <option value="coach">{t("Вина тренера", "Тренердин күнөөсү")}</option>
          <option value="club">{t("Вина клуба", "Клубдун күнөөсү")}</option>
          <option value="force_majeure">{t("Форс-мажор", "Форс-мажор")}</option>
          <option value="client">{t("По просьбе клиентов", "Кардарлардын өтүнүчү")}</option>
          <option value="other">{t("Другое", "Башка")}</option>
        </select>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.45 }}>
          {fault === "coach" && !forceMaj
            ? t("Это занятие не войдёт в зарплату тренера.", "Бул сабак тренердин эмгек акысына кирбейт.")
            : t("Влияет на зарплату тренера и на отчётность по отменам.",
                "Тренердин эмгек акысына жана отчётко таасир этет.")}
        </div>
      </Field>

      <label className="check">
        <input type="checkbox" checked={forceMaj} onChange={(e) => setForceMaj(e.target.checked)} />
        <span>
          <b>{t("Форс-мажор", "Форс-мажор")}</b>
          <small>{t("Всем детям группы вернётся +1 занятие к абонементу, родители получат уведомление",
                    "Топтогу бардык балдарга абонементке +1 сабак кайтарылат")}</small>
        </span>
      </label>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={cancel.isPending || !reason}>
          {cancel.isPending ? "…" : t("Отменить занятие", "Сабакты жокко чыгаруу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// RescheduleLessonModal — перенос ОДНОГО занятия на новую дату/время.
// Главный «человеческий» путь для менеджеров: открыл занятие в сетке →
// «Перенести» → календарь + время + причина. Родители получают
// уведомление с новой датой/временем и (если указана) причиной.
//
// Под капотом использует bulk-reschedule с массивом из одного id —
// чтобы вся логика уведомлений и проверки коллизий жила в одном месте.
// =============================================================
type SingleLessonForReschedule = {
  id: string;
  date: string;
  start_time: string;
  duration_min: number;
  group?: { name?: string | null } | null;
  coach?: { full_name?: string | null } | null;
};

export const RescheduleLessonModal = ({
  open, onClose, lang, lesson, onSuccess,
}: {
  open: boolean; onClose: () => void; lang: Lang;
  lesson: SingleLessonForReschedule;
  onSuccess?: () => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const bulk = useBulkReschedule();
  const [newDate, setNewDate] = useState(lesson.date);
  const [newTime, setNewTime] = useState(lesson.start_time.slice(0, 5));
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ date: string; start_time: string } | null>(null);

  const sameSlot =
    newDate === lesson.date && newTime === lesson.start_time.slice(0, 5);

  const submit = async () => {
    setErr(null); setConflict(null);
    if (!newDate) { setErr(t("Укажите дату", "Күндү көрсөтүңүз")); return; }
    if (!newTime) { setErr(t("Укажите время", "Убакытты көрсөтүңүз")); return; }
    if (sameSlot) {
      setErr(t("Это та же дата и время — изменения не нужны.", "Ошол эле күн жана убакыт — өзгөртүүнүн кереги жок."));
      return;
    }
    try {
      await bulk.mutateAsync({
        lesson_ids: [lesson.id],
        mode: "set_date",
        new_date: newDate,
        new_start_time: newTime,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      onSuccess?.();
      onClose();
    } catch (e: unknown) {
      const msg = (e as Error).message;
      const m = msg.match(/^API 409:\s*(\{.*\})/);
      if (m) {
        try {
          const body = JSON.parse(m[1]);
          if (body.error === "conflicts" && Array.isArray(body.conflicts) && body.conflicts[0]) {
            setConflict(body.conflicts[0]);
            setErr(t("В это время у тренера уже есть занятие. Выберите другое время.",
                    "Бул убакта тренердин башка сабагы бар. Башка убакыт тандаңыз."));
            return;
          }
        } catch {}
      }
      setErr(msg);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={460} title={t("Перенести занятие", "Сабакты жылдыруу")}>
      <div style={{
        padding: 12, marginBottom: 14,
        background: "var(--bg-soft)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)",
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{lesson.group?.name ?? "—"}</div>
        <div style={{ color: "var(--muted)" }}>
          {t("Сейчас:", "Азыр:")}{" "}
          <b style={{ color: "var(--ink)" }}>
            {lesson.date} · {lesson.start_time.slice(0, 5)}
          </b>
          {lesson.coach?.full_name ? <> · {lesson.coach.full_name}</> : null}
        </div>
      </div>

      <div className="grid-2">
        <Field label={t("Новая дата", "Жаңы күн")}>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </Field>
        <Field label={t("Новое время", "Жаңы убакыт")}>
          <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
        </Field>
      </div>

      <Field label={t("Причина переноса (необязательно)", "Жылдыруунун себеби (милдеттүү эмес)")}>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("Например: тренер заболел, объединили группы", "Мисалы: тренер ооруп калды")}
        />
      </Field>

      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
        {t("Родители получат уведомление о новой дате и времени.",
           "Ата-энелерге жаңы күн жана убакыт боюнча билдирме келет.")}
      </div>

      {conflict && (
        <div style={{ marginTop: 8, padding: 10, background: "var(--red-50, #fef2f2)", border: "1px solid var(--red-200, #fecaca)", borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--red-ink, #991b1b)" }}>
          {t("Конфликт:", "Кагылыш:")} {conflict.date} · {conflict.start_time.slice(0, 5)}
        </div>
      )}
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={bulk.isPending}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={bulk.isPending || sameSlot}
        >
          <Icon name="calendar" size={14} />
          {bulk.isPending ? "…" : t("Перенести занятие", "Сабакты жылдыруу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// BulkRescheduleModal — перенос нескольких занятий разом.
// Баланс абонемента не меняется (требование заказчика). Родители
// получают уведомление на каждое перенесённое занятие.
// =============================================================
type BulkLesson = {
  id: string;
  date: string;
  start_time: string;
  duration_min: number;
  group?: { name?: string | null } | null;
  coach?: { full_name?: string | null } | null;
};

export const BulkRescheduleModal = ({
  open, onClose, lang, lessons, onSuccess,
}: {
  open: boolean; onClose: () => void; lang: Lang;
  lessons: BulkLesson[]; onSuccess: () => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const bulk = useBulkReschedule();
  const [mode, setMode] = useState<"shift_days" | "set_date">("shift_days");
  const [shiftDays, setShiftDays] = useState("1");
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");
  const [conflicts, setConflicts] = useState<{ lesson_id: string; date: string; start_time: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null); setConflicts([]);
    try {
      const ids = lessons.map((l) => l.id);
      const trimmedTime = newTime.trim();
      if (mode === "shift_days") {
        const n = parseInt(shiftDays, 10);
        if (!Number.isFinite(n) || n === 0) { setErr(t("Сдвиг должен быть ненулевым числом", "Жылдыруу нөл эмес болушу керек")); return; }
        await bulk.mutateAsync({
          lesson_ids: ids,
          mode: "shift_days",
          shift_days: n,
          ...(trimmedTime ? { new_start_time: trimmedTime } : {}),
        });
      } else {
        if (!newDate) { setErr(t("Укажите новую дату", "Жаңы күндү көрсөтүңүз")); return; }
        await bulk.mutateAsync({
          lesson_ids: ids,
          mode: "set_date",
          new_date: newDate,
          ...(trimmedTime ? { new_start_time: trimmedTime } : {}),
        });
      }
      onSuccess();
    } catch (e: unknown) {
      const msg = (e as Error).message;
      const m = msg.match(/^API 409:\s*(\{.*\})/);
      if (m) {
        try {
          const body = JSON.parse(m[1]);
          if (body.error === "conflicts" && Array.isArray(body.conflicts)) {
            setConflicts(body.conflicts);
            setErr(t("Найдены конфликты времени. Снимите конфликтные занятия из выбора или измените сдвиг.",
                    "Убакыт боюнча кагылыштар табылды. Тандоодон чыгарыңыз же жылдырууну өзгөртүңүз."));
            return;
          }
        } catch {}
      }
      setErr(msg);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={580} title={t("Перенос занятий", "Сабактарды жылдыруу")}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        {t(`Выбрано занятий: ${lessons.length}`, `Тандалды: ${lessons.length}`)}
      </div>
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 8, marginBottom: 12, fontSize: 12 }}>
        {lessons.map((l) => (
          <div key={l.id} style={{ padding: "4px 6px", borderBottom: "1px dashed var(--line)" }}>
            <b>{l.group?.name ?? "—"}</b> · {l.date} · {l.start_time.slice(0, 5)} · {l.coach?.full_name ?? "—"}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
        <label className="check" style={{ flex: 1 }}>
          <input type="radio" checked={mode === "shift_days"} onChange={() => setMode("shift_days")} />
          <span><b>{t("Сдвинуть на N дней", "N күнгө жылдыруу")}</b></span>
        </label>
        <label className="check" style={{ flex: 1 }}>
          <input type="radio" checked={mode === "set_date"} onChange={() => setMode("set_date")} />
          <span><b>{t("На конкретную дату", "Конкреттүү күнгө")}</b></span>
        </label>
      </div>

      {mode === "shift_days" ? (
        <Field label={t("Сдвиг (дней, можно отрицательный)", "Жылдыруу (терс да болот)")}>
          <input type="number" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)} />
        </Field>
      ) : (
        <Field label={t("Новая дата", "Жаңы күн")}>
          <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </Field>
      )}
      <Field label={t("Новое время старта (опц.)", "Жаңы башталыш (опц.)")}>
        <input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
      </Field>

      {conflicts.length > 0 && (
        <div style={{ marginTop: 8, padding: 10, background: "var(--red-50, #fef2f2)", border: "1px solid var(--red-200, #fecaca)", borderRadius: "var(--r-sm)", fontSize: 12 }}>
          <b style={{ color: "var(--red-ink, #991b1b)" }}>{t("Конфликты:", "Кагылыштар:")}</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {conflicts.map((c, i) => (
              <li key={i}>{c.date} · {c.start_time.slice(0, 5)}</li>
            ))}
          </ul>
        </div>
      )}
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={bulk.isPending}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={bulk.isPending}>
          <Icon name="calendar" size={14} /> {bulk.isPending ? "…" : t("Перенести", "Жылдыруу")}
        </button>
      </div>
    </Modal>
  );
};

// =============================================================
// BulkCancelModal — массовая отмена занятий.
// Баланс детей не меняется. Родители получают уведомление.
// =============================================================
export const BulkCancelModal = ({
  open, onClose, lang, lessons, onSuccess,
}: {
  open: boolean; onClose: () => void; lang: Lang;
  lessons: BulkLesson[]; onSuccess: () => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const bulk = useBulkCancelLessons();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!reason.trim()) { setErr(t("Укажите причину", "Себебин көрсөтүңүз")); return; }
    try {
      await bulk.mutateAsync({ lesson_ids: lessons.map((l) => l.id), reason: reason.trim() });
      setReason("");
      onSuccess();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={520} title={t("Отмена занятий", "Сабактарды жокко чыгаруу")}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
        {t(`Будет отменено: ${lessons.length}. Баланс абонементов не изменится.`,
           `Жокко чыгарылат: ${lessons.length}. Абонементтин балансы өзгөрбөйт.`)}
      </div>
      <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", padding: 8, marginBottom: 12, fontSize: 12 }}>
        {lessons.map((l) => (
          <div key={l.id} style={{ padding: "4px 6px", borderBottom: "1px dashed var(--line)" }}>
            <b>{l.group?.name ?? "—"}</b> · {l.date} · {l.start_time.slice(0, 5)}
          </div>
        ))}
      </div>
      <Field label={t("Причина", "Себеп")}>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={bulk.isPending}>{t("Назад", "Артка")}</button>
        <button className="btn btn--primary" style={{ background: "var(--red-600)" }} onClick={submit} disabled={bulk.isPending || !reason.trim()}>
          <Icon name="x" size={14} /> {bulk.isPending ? "…" : t("Отменить занятия", "Сабактарды жокко чыгаруу")}
        </button>
      </div>
    </Modal>
  );
};
