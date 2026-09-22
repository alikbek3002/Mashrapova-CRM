import { useEffect, useState } from "react";
import type { Lang } from "../data";
import { PageHeader, EmptyState } from "./common";
import { useOrganization, useUsers, useAuditLog, useOrgSettings } from "../shared/api/queries";
import { useUpdateOrgSettings } from "../shared/api/mutations";
import { supabase } from "../shared/api/supabase";
import { usePerm } from "../shared/auth/rbac";

export const SettingsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Каталог видов абонементов переехал отсюда на страницу «Абонементы»
  // (вкладка «Виды абонементов») — клиент искал его там.
  const [tab, setTab] = useState<"org" | "discounts" | "users" | "audit">("org");
  const allowed = usePerm("system_settings");

  if (!allowed) {
    return (
      <>
        <PageHeader title={t("Настройки", "Жөндөөлөр")} />
        <div className="card">
          <EmptyState
            title={t("Нет доступа", "Жеткиликтүү эмес")}
            hint={t("Этот раздел доступен только директору.", "Бул бөлүм директорго гана.")}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("Настройки", "Жөндөөлөр")}
        subtitle={t("Профиль клуба, пользователи, журнал действий", "Клуб профили, колдонуучулар, журнал")}
      />

      <div className="card">
        <div className="toolbar">
          <div className="tabs">
            <button className={`tabs__btn ${tab === "org" ? "is-active" : ""}`} onClick={() => setTab("org")}>
              {t("Профиль клуба", "Клуб профили")}
            </button>
            <button className={`tabs__btn ${tab === "discounts" ? "is-active" : ""}`} onClick={() => setTab("discounts")}>
              {t("Скидки", "Жеңилдиктер")}
            </button>
            <button className={`tabs__btn ${tab === "users" ? "is-active" : ""}`} onClick={() => setTab("users")}>
              {t("Пользователи", "Колдонуучулар")}
            </button>
            <button className={`tabs__btn ${tab === "audit" ? "is-active" : ""}`} onClick={() => setTab("audit")}>
              {t("Журнал действий", "Журнал")}
            </button>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {tab === "org" && <OrgTab lang={lang} />}
          {tab === "discounts" && <DiscountsTab lang={lang} />}
          {tab === "users" && <UsersTab lang={lang} />}
          {tab === "audit" && <AuditTab lang={lang} />}
        </div>
      </div>
    </>
  );
};

// ============ Org profile ============
const OrgTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: org, isLoading, refetch } = useOrganization();
  const [name, setName] = useState("");
  const [tz, setTz] = useState("Asia/Bishkek");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [waNum, setWaNum] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (org) {
      setName(org.name);
      setTz(org.timezone);
      setPhone(org.phone ?? "");
      setAddress(org.address ?? "");
      setWaNum(org.whatsapp_number ?? "");
    }
  }, [org]);

  const save = async () => {
    if (!org) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.from("organizations").update({
      name, timezone: tz,
      phone: phone || null,
      address: address || null,
      whatsapp_number: waNum || null,
    }).eq("id", org.id);
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg(t("Сохранено", "Сакталды")); refetch(); }
  };

  if (isLoading) return <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />;

  return (
    <div style={{ maxWidth: 480 }}>
      <label className="field">
        <span className="field__label">{t("Название клуба", "Клубдун аты")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
      </label>
      <label className="field">
        <span className="field__label">{t("Часовой пояс", "Убакыт алкагы")}</span>
        <select value={tz} onChange={(e) => setTz(e.target.value)} disabled={busy}>
          <option value="Asia/Bishkek">Asia/Bishkek</option>
          <option value="Asia/Almaty">Asia/Almaty</option>
          <option value="Asia/Tashkent">Asia/Tashkent</option>
          <option value="Europe/Moscow">Europe/Moscow</option>
        </select>
      </label>
      <label className="field">
        <span className="field__label">{t("Телефон клуба", "Клубдун телефону")}</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} placeholder="+996 …" />
      </label>
      <label className="field">
        <span className="field__label">{t("WhatsApp менеджера (для родителей)", "WhatsApp менеджер")}</span>
        <input value={waNum} onChange={(e) => setWaNum(e.target.value)} disabled={busy} placeholder="996700111222" />
        <span className="field__hint">{t("Без + и пробелов. Используется в кнопке родителя.", "+ жана боштуктарсыз")}</span>
      </label>
      <label className="field">
        <span className="field__label">{t("Адрес", "Дареги")}</span>
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} />
      </label>
      {msg && <div className={msg.includes("Сохранено") || msg.includes("Сакталды") ? "field__hint" : "field__error"} style={{ marginTop: 4 }}>{msg}</div>}
      <button className="btn btn--primary" onClick={save} disabled={busy || !name} style={{ marginTop: 12 }}>
        {busy ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
      </button>
    </div>
  );
};

// ============ Discounts ============
const DiscountsTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: settings, isLoading } = useOrgSettings();
  const { data: org } = useOrganization();
  const update = useUpdateOrgSettings();
  const [enabled, setEnabled] = useState(true);
  const [amount, setAmount] = useState("500");

  useEffect(() => {
    if (settings) {
      setEnabled(settings.sibling_discount_enabled);
      setAmount(String(settings.sibling_discount_amount));
    }
  }, [settings]);

  const save = async () => {
    // organization_id берём из настроек, либо из профиля клуба — чтобы upsert
    // создал строку, если её ещё нет (seed не применён).
    const orgId = settings?.organization_id ?? org?.id;
    if (!orgId) return;
    await update.mutateAsync({
      organization_id: orgId,
      sibling_discount_enabled: enabled,
      sibling_discount_amount: Number(amount) || 0,
    });
  };

  if (isLoading) return <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />;

  return (
    <div style={{ maxWidth: 480 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
        {t("Скидка для 2-го ребёнка из семьи", "Үй-бүлөдөгү 2-баланын жеңилдиги")}
      </h3>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
        {t(
          "Применяется автоматически при продаже абонемента, если у других детей в семье есть активный абонемент. Если выбранная менеджером скидка меньше — будет использована эта.",
          "Үй-бүлөнүн башка балдарында активдүү абонемент болсо, абонемент сатууда автоматтык колдонулат.",
        )}
      </p>

      <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          disabled={update.isPending}
        />
        <span>{t("Скидка включена", "Жеңилдик иштейт")}</span>
      </label>

      <label className="field">
        <span className="field__label">{t("Размер скидки, KGS", "Жеңилдиктин көлөмү, KGS")}</span>
        <input
          type="number"
          min={0}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={update.isPending || !enabled}
        />
        <span className="field__hint">
          {t("По умолчанию: 500 сом", "Демейки боюнча: 500 сом")}
        </span>
      </label>

      <button className="btn btn--primary" onClick={save} disabled={update.isPending} style={{ marginTop: 12 }}>
        {update.isPending ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
      </button>
    </div>
  );
};

// ============ Users ============
const UsersTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: users = [], isLoading, refetch } = useUsers();

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("profiles").update({ is_active: !current }).eq("id", id);
    refetch();
  };

  if (isLoading) return <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />;
  return (
    <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t("ФИО", "ФИО")}</th>
            <th>{t("Email", "Email")}</th>
            <th>{t("Роль", "Роль")}</th>
            <th>{t("Активен", "Активдүү")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ cursor: "default" }}>
              <td><div className="cell-main">{u.full_name}</div></td>
              <td style={{ color: "var(--muted)", fontSize: 12 }}>{u.email ?? "—"}</td>
              <td><span className="pill pill--active">{u.role}</span></td>
              <td>
                {u.is_active ? <span className="pill pill--active">{t("Да", "Ооба")}</span> : <span className="pill pill--archived">{t("Нет", "Жок")}</span>}
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="btn btn--ghost" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => toggleActive(u.id, u.is_active)}>
                  {u.is_active ? t("Деактивировать", "Деактивдештирүү") : t("Активировать", "Активдештирүү")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ Audit log ============
const AuditTab = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: log = [], isLoading } = useAuditLog(100);

  if (isLoading) return <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />;
  if (log.length === 0) return <EmptyState title={t("Журнал пуст", "Журнал бош")} />;

  return (
    <div className="table-scroll">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t("Время", "Убакыт")}</th>
            <th>{t("Действие", "Иш")}</th>
            <th>{t("Сущность", "Объект")}</th>
            <th>{t("Актор", "Кимдин")}</th>
          </tr>
        </thead>
        <tbody>
          {log.map((row: any) => (
            <tr key={row.id} style={{ cursor: "default" }}>
              <td style={{ color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" }}>
                {new Date(row.created_at).toLocaleString(lang === "ru" ? "ru-RU" : "ky-KG")}
              </td>
              <td><span className="pill pill--frozen">{row.action}</span></td>
              <td><div className="cell-sub" style={{ fontSize: 12 }}>{row.entity}</div><div style={{ color: "var(--muted)", fontSize: 11 }}>{row.entity_id?.slice(0, 8)}</div></td>
              <td style={{ color: "var(--muted)", fontSize: 12 }}>{row.actor_id?.slice(0, 8) ?? "system"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
