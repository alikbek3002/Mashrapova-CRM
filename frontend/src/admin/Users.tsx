import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, initialsOf } from "./common";
import { useStaff, type StaffMember } from "../shared/api/queries";
import {
  useCreateStaff, useUpdateStaff, useDeleteStaff, useRestoreStaff,
  useResetStaffPassword, useUploadAvatar,
  friendlyAuthError,
  type StaffRole,
} from "../shared/api/mutations";
import { Modal, Field } from "../shared/ui/Modal";
import { PasswordChangedDialog } from "../shared/ui/PasswordChangedDialog";
import { normalizeE164KG, isValidPhoneInput } from "../shared/auth/normalizePhone";
import { Gate } from "../shared/auth/Gate";
import { useAuth } from "../shared/auth/AuthProvider";
import { resolveAvatarUrl } from "../shared/api/avatar";

const ROLE_LABELS: Record<StaffMember["role"], { ru: string; ky: string }> = {
  director:         { ru: "Директор",         ky: "Директор" },
  fitness_director: { ru: "Управляющий",      ky: "Башкаруучу" },
  senior_manager:   { ru: "Старший менеджер", ky: "Башкы менеджер" },
  manager:          { ru: "Менеджер",         ky: "Менеджер" },
  cashier:          { ru: "Ресепшен",         ky: "Ресепшен" },
};

const StaffAvatar = ({ url, name, size = 32 }: { url: string | null; name: string; size?: number }) => {
  const resolved = url ? resolveAvatarUrl(url) ?? url : null;
  return (
    <div
      className="call-row__avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36), overflow: "hidden", position: "relative" }}
    >
      {initialsOf(name)}
      {resolved && (
        <img
          src={resolved}
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
  );
};

export const UsersPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user: currentUser } = useAuth();
  const [showArchived, setShowArchived] = useState(false);
  const { data: staff = [], isLoading, error } = useStaff({ includeArchived: showArchived });
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return staff;
    return staff.filter(
      (s) =>
        s.full_name.toLowerCase().includes(qq) ||
        (s.phone ?? "").toLowerCase().includes(qq) ||
        (s.email ?? "").toLowerCase().includes(qq) ||
        (s.inn ?? "").includes(qq),
    );
  }, [q, staff]);

  const totalLabel = isLoading
    ? t("Загрузка…", "Жүктөлүүдө…")
    : showArchived
      ? t(`${staff.length} (вкл. архивных)`, `${staff.length} (архив менен)`)
      : t(`${staff.length} сотрудников`, `${staff.length} кызматкер`);

  return (
    <>
      <PageHeader
        title={t("Сотрудники", "Кызматкерлер")}
        subtitle={totalLabel}
        actions={
          <Gate perm="manage_users">
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" /> {t("Добавить сотрудника", "Кызматкер кошуу")}
            </button>
          </Gate>
        }
      />

      <StaffModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        lang={lang}
        mode="create"
      />
      {editing && (
        <StaffModal
          open={!!editing}
          onClose={() => setEditing(null)}
          lang={lang}
          mode="edit"
          initial={editing}
          currentUserId={currentUser?.id}
        />
      )}

      <div className="card">
        <div className="toolbar" style={{ alignItems: "center", gap: 12 }}>
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder={t("Поиск по имени, телефону или ИНН…", "Аты, телефону же ИИН боюнча…")}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginLeft: "auto" }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            {t("Показать архивных", "Архивдик")}
          </label>
        </div>

        {error ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={(error as Error).message} />
        ) : isLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("Никого не найдено", "Эч ким табылган жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("ФИО", "ФИО")}</th>
                  <th>{t("Должность", "Кызмат")}</th>
                  <th>{t("Телефон", "Телефон")}</th>
                  <th>{t("ИНН", "ИИН")}</th>
                  <th>{t("Статус", "Абалы")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const isArchived = !!s.deleted_at;
                  const isDirector = s.role === "director";
                  const rowClickable = !isDirector && !isArchived;
                  return (
                    <tr
                      key={s.id}
                      onClick={() => rowClickable && setEditing(s)}
                      style={{
                        cursor: rowClickable ? "pointer" : "default",
                        opacity: isArchived ? 0.55 : 1,
                      }}
                    >
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <StaffAvatar url={s.avatar_url} name={s.full_name} />
                          <div className="cell-main">
                            {s.full_name}
                            {isArchived && (
                              <span className="pill pill--expired" style={{ marginLeft: 8, fontSize: 10 }}>
                                {t("Удалён", "Өчүрүлгөн")}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{lang === "ru" ? ROLE_LABELS[s.role].ru : ROLE_LABELS[s.role].ky}</td>
                      <td style={{ color: "var(--muted)" }}>
                        {s.phone ? (
                          <a
                            href={`tel:${s.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: "var(--blue)" }}
                          >
                            {s.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {s.inn ?? "—"}
                      </td>
                      <td>
                        <span className={`pill pill--${isArchived ? "expired" : s.is_active ? "active" : "expired"}`}>
                          {isArchived
                            ? t("Удалён", "Өчүрүлгөн")
                            : s.is_active
                              ? t("Активен", "Активдүү")
                              : t("Отключён", "Өчүрүлгөн")}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", width: 1 }} onClick={(e) => e.stopPropagation()}>
                        {!isDirector && (
                          <StaffRowActions
                            staff={s}
                            lang={lang}
                            onEdit={() => setEditing(s)}
                            currentUserId={currentUser?.id}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

// =====================================================================
// Inline actions: edit / delete or restore
// =====================================================================
const StaffRowActions = ({
  staff, lang, onEdit, currentUserId,
}: {
  staff: StaffMember;
  lang: Lang;
  onEdit: () => void;
  currentUserId?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const del = useDeleteStaff();
  const restore = useRestoreStaff();
  const isSelf = currentUserId === staff.id;
  const isArchived = !!staff.deleted_at;

  const onDelete = () => {
    if (isSelf) return;
    const ok = window.confirm(
      t(
        `Удалить сотрудника «${staff.full_name}»? Можно будет восстановить.`,
        `«${staff.full_name}» кызматкерди өчүрөбүзбү? Калыбына келтирүүгө болот.`,
      ),
    );
    if (ok) del.mutate(staff.id);
  };

  const onRestore = () => {
    const ok = window.confirm(
      t(`Восстановить «${staff.full_name}»?`, `«${staff.full_name}» калыбына келтирүүбү?`),
    );
    if (ok) restore.mutate(staff.id);
  };

  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {!isArchived && (
        <button className="icon-btn" onClick={onEdit} title={t("Редактировать", "Өзгөртүү")}>
          <Icon name="edit" size={14} />
        </button>
      )}
      {isArchived ? (
        <button
          className="icon-btn"
          onClick={onRestore}
          title={t("Восстановить", "Калыбына келтирүү")}
          disabled={restore.isPending}
        >
          <Icon name="refresh" size={14} />
        </button>
      ) : (
        <button
          className="icon-btn"
          onClick={onDelete}
          title={isSelf ? t("Нельзя удалить себя", "Өзүңдү өчүрө албайсың") : t("Удалить", "Өчүрүү")}
          disabled={isSelf || del.isPending}
          style={{ color: isSelf ? undefined : "var(--red-600)" }}
        >
          <Icon name="trash" size={14} />
        </button>
      )}
    </div>
  );
};

// =====================================================================
// Modal: create / edit staff with extended fields + avatar + password reset
// =====================================================================
const StaffModal = ({
  open, onClose, lang, mode, initial, currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  mode: "create" | "edit";
  initial?: StaffMember;
  currentUserId?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const del = useDeleteStaff();
  const uploadAvatar = useUploadAvatar();
  const resetPw = useResetStaffPassword();
  const isCreate = mode === "create";
  const isSelf = !!initial && currentUserId === initial.id;

  // Core fields
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>(
    (initial?.role && initial.role !== "director" ? initial.role : "manager") as StaffRole,
  );
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  // Extended fields
  const [avatarUrl, setAvatarUrl] = useState<string>(initial?.avatar_url ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [inn, setInn] = useState(initial?.inn ?? "");
  const [birthday, setBirthday] = useState(initial?.birthday ?? "");
  const [hireDate, setHireDate] = useState(initial?.hire_date ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [err, setErr] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCreatedOpen, setPwCreatedOpen] = useState(false);
  const [pwCreatedValue, setPwCreatedValue] = useState("");

  const busy = create.isPending || update.isPending || del.isPending || uploadAvatar.isPending;

  const generatePassword = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setPassword(s);
  };

  const phoneInvalid = phone.length >= 6 && !isValidPhoneInput(phone);
  const innInvalid = !!inn && !/^\d{14}$/.test(inn);
  const emailInvalid = !!email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const onPickFile = async (file: File) => {
    try {
      const { url } = await uploadAvatar.mutateAsync(file);
      setAvatarUrl(url);
    } catch {
      // toast уже в хуке
    }
  };

  const submit = async () => {
    setErr(null);
    if (!fullName.trim() || fullName.trim().length < 2) {
      setErr(t("Укажите ФИО (минимум 2 символа)", "ФИОну толтуруңуз"));
      return;
    }
    if (phoneInvalid || !isValidPhoneInput(phone)) {
      setErr(t("Введите телефон в формате +996 700 12 34 56", "+996 700 12 34 56 форматында"));
      return;
    }
    if (isCreate && password.length < 8) {
      setErr(t("Пароль минимум 8 символов", "Сырсөз кеминде 8 белги"));
      return;
    }
    if (innInvalid) {
      setErr(t("ИНН должен содержать ровно 14 цифр", "ИИН так 14 сан болушу керек"));
      return;
    }
    if (emailInvalid) {
      setErr(t("Неверный формат email", "Email форматы туура эмес"));
      return;
    }
    try {
      const e164 = normalizeE164KG(phone);
      const optional = {
        email: email.trim() || null,
        avatar_url: avatarUrl || null,
        inn: inn || null,
        birthday: birthday || null,
        hire_date: hireDate || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };
      if (isCreate) {
        await create.mutateAsync({
          phone: e164,
          password,
          full_name: fullName.trim(),
          role,
          ...optional,
        });
        // Показываем подтверждение с паролем для передачи сотруднику.
        setPwCreatedValue(password);
        setPwCreatedOpen(true);
        return; // не закрываем модал — закроется после Готово
      } else if (initial) {
        await update.mutateAsync({
          id: initial.id,
          full_name: fullName.trim(),
          phone: e164,
          role,
          is_active: isActive,
          ...optional,
        });
      }
      onClose();
    } catch (e: unknown) {
      setErr(friendlyAuthError((e as Error).message));
    }
  };

  const onDelete = () => {
    if (!initial || isSelf) return;
    const ok = window.confirm(
      t(
        `Удалить сотрудника «${initial.full_name}»? Можно будет восстановить.`,
        `«${initial.full_name}» өчүрүлсүнбү? Калыбына келтирүүгө болот.`,
      ),
    );
    if (!ok) return;
    del.mutate(initial.id, { onSuccess: () => onClose() });
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        width={720}
        title={isCreate ? t("Новый сотрудник", "Жаңы кызматкер") : t("Карточка сотрудника", "Кызматкер картасы")}
      >
        {/* Avatar + base actions */}
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
              {t("JPG, PNG или WebP. Не более 5 МБ.", "JPG, PNG же WebP. 5 МБдан көп эмес.")}
            </div>
          </div>
        </div>

        <div className="grid-2">
          <Field label={t("ФИО", "ФИО") + " *"}>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} required />
          </Field>
          <Field label={t("Должность", "Кызмат") + " *"}>
            <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)} disabled={busy}>
              <option value="fitness_director">{t("Управляющий", "Башкаруучу")}</option>
              <option value="senior_manager">{t("Старший менеджер", "Башкы менеджер")}</option>
              <option value="manager">{t("Менеджер", "Менеджер")}</option>
              <option value="cashier">{t("Ресепшен / кассир", "Ресепшен / кассир")}</option>
            </select>
          </Field>

          <Field label={t("Телефон (логин)", "Телефон (логин)") + " *"}>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              placeholder="+996 700 12 34 56"
              style={phoneInvalid ? { borderColor: "var(--red-600)" } : undefined}
              required
            />
          </Field>
          <Field label="Email" hint={t("Опционально, для уведомлений", "Милдеттүү эмес")}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              placeholder="staff@mashrapov.kg"
              style={emailInvalid ? { borderColor: "var(--red-600)" } : undefined}
            />
          </Field>

          <Field label={t("ИНН", "ИИН")} hint={t("14 цифр", "14 сан")}>
            <input
              inputMode="numeric"
              value={inn}
              onChange={(e) => setInn(e.target.value.replace(/\D/g, "").slice(0, 14))}
              disabled={busy}
              placeholder="22612200310000"
              style={innInvalid ? { borderColor: "var(--red-600)" } : { fontFamily: "var(--font-mono)" }}
              maxLength={14}
            />
          </Field>
          <Field label={t("Дата рождения", "Туулган күнү")}>
            <input
              type="date"
              value={birthday}
              onChange={(e) => setBirthday(e.target.value)}
              disabled={busy}
            />
          </Field>

          <Field label={t("Дата приёма на работу", "Жумушка кабыл алынган күн")}>
            <input
              type="date"
              value={hireDate}
              onChange={(e) => setHireDate(e.target.value)}
              disabled={busy}
            />
          </Field>
          {!isCreate && (
            <Field label={t("Статус", "Абалы")}>
              <select
                value={isActive ? "1" : "0"}
                onChange={(e) => setIsActive(e.target.value === "1")}
                disabled={busy}
              >
                <option value="1">{t("Активен", "Активдүү")}</option>
                <option value="0">{t("Отключён", "Өчүрүлгөн")}</option>
              </select>
            </Field>
          )}
          {isCreate && (
            <Field label={t("Пароль (мин. 8)", "Сырсөз (мин. 8)") + " *"}>
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
        </div>

        <Field label={t("Адрес", "Дареги")}>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={busy}
            placeholder={t("Бишкек, ул. Манаса 1", "Бишкек, Манас көч. 1")}
          />
        </Field>

        <Field label={t("Внутренние заметки", "Ички жазуулар")} hint={t("Видит только директор", "Директор гана көрөт")}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            rows={3}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
          />
        </Field>

        {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

        <div className="modal__foot" style={{ justifyContent: "space-between" }}>
          {!isCreate && initial && (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn"
                onClick={onDelete}
                disabled={busy || isSelf}
                title={isSelf ? t("Нельзя удалить себя", "Өзүңдү өчүрө албайсың") : undefined}
                style={{ color: "var(--red-600)" }}
              >
                <Icon name="trash" size={14} /> {t("Удалить", "Өчүрүү")}
              </button>
              <button
                className="btn"
                onClick={() => setPwOpen(true)}
                disabled={busy}
              >
                <Icon name="key" size={14} /> {t("Сбросить пароль", "Сырсөздү алмаштыруу")}
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button className="btn" onClick={onClose} disabled={busy}>
              {t("Отмена", "Жокко чыгаруу")}
            </button>
            <button
              className="btn btn--primary"
              onClick={submit}
              disabled={busy || !fullName || !phone || (isCreate && !password)}
            >
              {busy
                ? t("Сохраняем…", "Сакталууда…")
                : isCreate
                  ? t("Создать сотрудника", "Кызматкер түзүү")
                  : t("Сохранить", "Сактоо")}
            </button>
          </div>
        </div>
      </Modal>

      {initial && (
        <ResetPasswordModal
          open={pwOpen}
          onClose={() => setPwOpen(false)}
          lang={lang}
          staff={initial}
          mutation={resetPw}
        />
      )}
      <PasswordChangedDialog
        open={pwCreatedOpen}
        onClose={() => {
          setPwCreatedOpen(false);
          setPwCreatedValue("");
          onClose();
        }}
        lang={lang}
        password={pwCreatedValue}
        who={fullName.trim()}
      />
    </>
  );
};

// =====================================================================
// Reset password mini-modal
// =====================================================================
const ResetPasswordModal = ({
  open, onClose, lang, staff, mutation,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  staff: StaffMember;
  mutation: ReturnType<typeof useResetStaffPassword>;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pwChangedOpen, setPwChangedOpen] = useState(false);
  const [pwChangedValue, setPwChangedValue] = useState("");
  const busy = mutation.isPending;

  const generate = () => {
    const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setPw(s);
  };

  const submit = async () => {
    setErr(null);
    if (pw.length < 8) {
      setErr(t("Минимум 8 символов", "Кеминде 8 белги"));
      return;
    }
    try {
      await mutation.mutateAsync({ id: staff.id, password: pw });
      setPwChangedValue(pw);
      setPwChangedOpen(true);
      setPw("");
    } catch {
      // toast в хуке
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(`Сбросить пароль: ${staff.full_name}`, `Сырсөздү алмаштыруу: ${staff.full_name}`)}
    >
      <Field label={t("Новый пароль", "Жаңы сырсөз")} hint={t("Передайте сотруднику этот пароль вручную", "Бул сырсөздү кызматкерге жеке өзүңүз бериңиз")}>
        <input
          type="text"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          disabled={busy}
          autoFocus
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </Field>
      <button className="btn" onClick={generate} disabled={busy} style={{ marginTop: 8 }}>
        <Icon name="refresh" size={14} /> {t("Сгенерировать", "Жаратуу")}
      </button>

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={busy}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || pw.length < 8}>
          {busy ? t("Сохраняем…", "Сакталууда…") : t("Применить", "Колдонуу")}
        </button>
      </div>
      <PasswordChangedDialog
        open={pwChangedOpen}
        onClose={() => { setPwChangedOpen(false); setPwChangedValue(""); onClose(); }}
        lang={lang}
        password={pwChangedValue}
        who={staff.full_name}
      />
    </Modal>
  );
};
