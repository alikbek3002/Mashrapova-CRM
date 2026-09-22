import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, formatCurrency, initialsOf } from "./common";
import { usePayments } from "../shared/api/queries";
import { useChangePaymentMethod } from "../shared/api/mutations";
import { AcceptPaymentModal, SellCardModal, TopUpDepositModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";

const methodLabel: Record<string, { ru: string; ky: string }> = {
  cash: { ru: "Наличные", ky: "Накта" },
  terminal: { ru: "Терминал", ky: "Терминал" },
};

export const PaymentsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "cash" | "terminal">("all");
  // Фильтр по периоду: включительно с обеих сторон, пусто = без границы.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const { data: payments = [], isLoading, error } = usePayments();
  // Сверка по кассе: нал ↔ терминал у уже принятого платежа. Правка
  // помечается в комментарии платежа и в audit_log.
  const canCorrect = usePerm("correct_payments");
  const changeMethod = useChangePaymentMethod();
  const correct = (id: string, from: string) => {
    const to = from === "cash" ? "terminal" : "cash";
    const reason = prompt(t(
      `Исправить способ оплаты: ${methodLabel[from]?.ru ?? from} → ${methodLabel[to]?.ru ?? to}. Причина (необязательно):`,
      `Төлөм ыкмасын оңдоо: ${methodLabel[from]?.ky ?? from} → ${methodLabel[to]?.ky ?? to}. Себеби:`,
    ), "");
    if (reason === null) return;
    changeMethod.mutate({ payment_id: id, method: to, reason: reason.trim() || undefined });
  };

  const rows = useMemo(() => {
    let list = payments;
    if (filter !== "all") list = list.filter((p) => p.method === filter);
    // paid_at — timestamptz; сравниваем локальную дату платежа с границами.
    if (dateFrom) list = list.filter((p) => {
      const d = new Date(p.paid_at);
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return local >= dateFrom;
    });
    if (dateTo) list = list.filter((p) => {
      const d = new Date(p.paid_at);
      const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return local <= dateTo;
    });
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((p) => p.child?.full_name.toLowerCase().includes(qq));
    return list;
  }, [q, filter, payments, dateFrom, dateTo]);

  // Сумма по отфильтрованному периоду — видно итог за выбранные даты.
  const filteredTotal = useMemo(() => rows.reduce((s, p) => s + Number(p.amount), 0), [rows]);

  const total30 = payments.filter((p) => Date.now() - new Date(p.paid_at).getTime() < 30 * 86400000).reduce((s, p) => s + Number(p.amount), 0);
  const cashCount = payments.filter((p) => p.method === "cash").length;
  const termCount = payments.filter((p) => p.method === "terminal").length;

  return (
    <>
      <PageHeader
        title={t("Платежи", "Төлөмдөр")}
        subtitle={isLoading ? t("Загрузка…", "Жүктөлүүдө…") : t(`${formatCurrency(total30)} за 30 дней · наличные ${cashCount} · терминал ${termCount}`, `${formatCurrency(total30)} 30 күндө`)}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Gate perm="receive_payment">
              <button className="btn" onClick={() => setPayOpen(true)}>
                <Icon name="plus" /> {t("Принять платёж", "Кабыл алуу")}
              </button>
            </Gate>
            <Gate perm="sell_cards">
              <button className="btn" onClick={() => setSellOpen(true)}>
                <Icon name="card" /> {t("Продать абонемент", "Абонемент сатуу")}
              </button>
            </Gate>
            <Gate perm="receive_payment">
              <button className="btn btn--primary" onClick={() => setTopUpOpen(true)}>
                <Icon name="wallet" /> {t("Пополнить депозит", "Депозитти толтуруу")}
              </button>
            </Gate>
          </div>
        }
      />

      <AcceptPaymentModal open={payOpen} onClose={() => setPayOpen(false)} lang={lang} />
      <SellCardModal open={sellOpen} onClose={() => setSellOpen(false)} lang={lang} />
      <TopUpDepositModal open={topUpOpen} onClose={() => setTopUpOpen(false)} lang={lang} />

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t("Поиск по ребёнку…", "Бала боюнча…")} />
          <div className="tabs">
            {(["all", "cash", "terminal"] as const).map((f) => (
              <button key={f} className={`tabs__btn ${filter === f ? "is-active" : ""}`} onClick={() => setFilter(f)}>
                {f === "all" ? t("Все", "Баары") : methodLabel[f][lang]}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)" }}>
            {t("Период:", "Мезгил:")}
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ height: 34, padding: "0 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--bg-soft)", fontSize: 13 }}
              title={t("С даты", "Күндөн")}
            />
            —
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ height: 34, padding: "0 8px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--bg-soft)", fontSize: 13 }}
              title={t("По дату", "Күнгө чейин")}
            />
            {(dateFrom || dateTo) && (
              <>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                >
                  {t("Сброс", "Тазалоо")}
                </button>
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                  {t("Итого:", "Баары:")} {formatCurrency(filteredTotal)}
                </span>
              </>
            )}
          </div>
        </div>
        {error ? <EmptyState title={t("Ошибка", "Ката")} hint={error.message} /> :
          isLoading ? <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} /> :
          rows.length === 0 ? <EmptyState title={t("Платежей нет", "Төлөмдөр жок")} /> : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t("Дата", "Күн")}</th>
                    <th>{t("Ребёнок", "Бала")}</th>
                    <th>{t("Метод", "Метод")}</th>
                    <th>{t("Кто принял", "Ким кабыл алды")}</th>
                    <th>{t("Комментарий", "Комментарий")}</th>
                    <th className="num">{t("Сумма", "Сумма")}</th>
                    {canCorrect && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(p.paid_at).toLocaleString(lang === "ru" ? "ru-RU" : "ky-KG", { dateStyle: "short", timeStyle: "short" })}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                            {p.child ? initialsOf(p.child.full_name) : "?"}
                          </div>
                          <div className="cell-main">{p.child?.full_name ?? p.child_id.slice(0, 8)}</div>
                        </div>
                      </td>
                      <td style={{ color: "var(--muted)" }}>{methodLabel[p.method]?.[lang] ?? p.method}</td>
                      {/* Сверка по кассе: кто внёс оплату (запрос офиса 2026-09-02). */}
                      <td style={{ fontSize: 12 }}>{p.receiver?.full_name ?? "—"}</td>
                      <td style={{ color: "var(--muted)", fontSize: 12 }}>{p.comment ?? "—"}</td>
                      <td className="num">{formatCurrency(Number(p.amount))}</td>
                      {canCorrect && (
                        <td style={{ textAlign: "right", width: 1, whiteSpace: "nowrap" }}>
                          <button
                            className="btn btn--ghost"
                            style={{ padding: "4px 8px", fontSize: 11 }}
                            onClick={() => correct(p.id, p.method)}
                            disabled={changeMethod.isPending}
                            title={t("Исправить способ оплаты (сверка по кассе)", "Төлөм ыкмасын оңдоо")}
                          >
                            → {p.method === "cash" ? methodLabel.terminal[lang] : methodLabel.cash[lang]}
                          </button>
                        </td>
                      )}
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
