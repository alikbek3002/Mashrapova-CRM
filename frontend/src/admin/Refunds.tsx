import { useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, formatCurrency } from "./common";
import { useRefunds, useCards } from "../shared/api/queries";
import { useCreateRefund } from "../shared/api/mutations";
import { Modal, Field } from "../shared/ui/Modal";
import { usePerm } from "../shared/auth/rbac";

export const RefundsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: refunds = [], isLoading, error } = useRefunds();
  const { data: cards = [] } = useCards("active");
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t("Возвраты", "Кайтаруулар")}
        subtitle={t("Возврат за неиспользованную часть абонемента", "Колдонулбаган бөлүгү үчүн кайтаруу")}
        actions={
          <button className="btn btn--primary" onClick={() => setOpen(true)}>
            <Icon name="plus" /> {t("Новый возврат", "Жаңы кайтаруу")}
          </button>
        }
      />

      {open && (
        <CreateRefundModal
          open={open}
          onClose={() => setOpen(false)}
          lang={lang}
          activeCards={cards.map((c) => ({
            id: c.id,
            // Показываем сумму, которую клиент реально заплатил (со скидкой) —
            // от неё же backend считает возврат.
            label: `${c.child?.full_name ?? "?"} · ${c.type} · ${formatCurrency(Math.max(0, Number(c.price_paid) - Number(c.discount ?? 0)))}`,
          }))}
        />
      )}

      <div className="card">
        {error ? (
          <EmptyState title={t("Ошибка", "Ката")} hint={(error as Error).message} />
        ) : isLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : refunds.length === 0 ? (
          <EmptyState title={t("Возвратов пока нет", "Кайтаруулар жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Дата", "Дата")}</th>
                  <th>{t("Ребёнок", "Бала")}</th>
                  <th>{t("Тип", "Түрү")}</th>
                  <th className="num">{t("Цена", "Баа")}</th>
                  <th className="num">{t("Удержано", "Кармалды")}</th>
                  <th className="num">{t("К возврату", "Кайтарууга")}</th>
                  <th>{t("Причина", "Себеп")}</th>
                  <th>{t("Кто оформил", "Ким")}</th>
                </tr>
              </thead>
              <tbody>
                {refunds.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.processed_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</td>
                    <td>{r.child?.full_name ?? "—"}</td>
                    <td>
                      {r.kind === "with_30pct"
                        ? <span className="pill pill--frozen">{t("С 30%", "30% м-н")}</span>
                        : <span className="pill pill--active">{t("Полный", "Толук")}</span>}
                    </td>
                    <td className="num">{formatCurrency(Number(r.card_price))}</td>
                    <td className="num" style={{ color: Number(r.fee_amount) > 0 ? "var(--red-600)" : "var(--muted)" }}>
                      {Number(r.fee_amount) > 0 ? formatCurrency(Number(r.fee_amount)) : "—"}
                    </td>
                    <td className="num"><b>{formatCurrency(Number(r.refund_amount))}</b></td>
                    <td style={{ fontSize: 12, maxWidth: 280 }}>{r.reason}</td>
                    <td style={{ color: "var(--muted)" }}>{r.processor?.full_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

const CreateRefundModal = ({
  open, onClose, lang, activeCards,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  activeCards: { id: string; label: string }[];
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [card, setCard] = useState("");
  const [kind, setKind] = useState<"with_30pct" | "full_no_fee">("with_30pct");
  const [reason, setReason] = useState("");
  const create = useCreateRefund();
  const canCancel30 = usePerm("cancel_30pct");

  const submit = async () => {
    if (!card || !reason.trim()) return;
    await create.mutateAsync({ club_card_id: card, kind, reason });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Новый возврат", "Жаңы кайтаруу")} width={560}>
      <Field label={t("Абонемент", "Абонемент")}>
        <select value={card} onChange={(e) => setCard(e.target.value)}>
          <option value="">{t("— выберите —", "— тандаңыз —")}</option>
          {activeCards.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
        </select>
      </Field>
      <Field label={t("Тип возврата", "Түрү")} hint={t("Сумма к возврату считается автоматически: остаток / всего × цена − удержание (если есть).", "")}>
        <div style={{ display: "flex", gap: 16, marginTop: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" checked={kind === "with_30pct"} onChange={() => setKind("with_30pct")} />
            {t("С удержанием 30%", "30% кармоо м-н")}
          </label>
          <label
            style={{
              display: "flex", alignItems: "center", gap: 6,
              opacity: canCancel30 ? 1 : 0.45,
              cursor: canCancel30 ? "pointer" : "not-allowed",
            }}
            title={canCancel30 ? "" : t("Доступно только директору, фитнес-директору, ст.менеджеру", "")}
          >
            <input
              type="radio"
              checked={kind === "full_no_fee"}
              disabled={!canCancel30}
              onChange={() => setKind("full_no_fee")}
            />
            {t("Полный (без удержания)", "Толук (кармоосуз)")}
          </label>
        </div>
      </Field>
      <Field label={t("Причина", "Себеп")}>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("обязательно", "милдеттүү")} />
      </Field>
      <div style={{
        marginTop: 10, padding: "10px 12px",
        background: "var(--bg-soft)", border: "1px solid var(--line)",
        borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--muted)",
      }}>
        <Icon name="wallet" size={12} />{" "}
        {t(
          "Сумма к возврату автоматически зачисляется на депозит ребёнка. Для выдачи наличными — операция «Вывести» в карточке ребёнка → Депозит.",
          "Кайтаруу суммасы автоматтык түрдө баланын депозитине которулат. Накта чыгаруу үчүн — баланын карточкасында «Чыгаруу».",
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={create.isPending || !card || !reason.trim()}>
          {create.isPending ? t("Оформление…", "Иштелүүдө…") : t("Оформить возврат", "Кайтарууну түзүү")}
        </button>
      </div>
    </Modal>
  );
};
