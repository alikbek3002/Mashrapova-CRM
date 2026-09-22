// Должники по абонементам (просьба офиса 2026-09-18): один ребёнок — одна
// строка, внутри — карты с долгом. Правило расчёта то же, что в карточке
// ребёнка (useChildCardDebts): цена со скидкой − оплаты − списания депозита.
import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, formatCurrency, initialsOf } from "./common";
import { useAllCardDebts, useChildren, type DebtorRow } from "../shared/api/queries";
import { AcceptPaymentModal } from "../shared/ui/forms";
import { ChildDrawer } from "./ChildDrawer";
import { usePerm } from "../shared/auth/rbac";

const cardTypeLbl: Record<string, { ru: string; ky: string }> = {
  monthly: { ru: "Месячный", ky: "Айлык" },
  quarterly: { ru: "3 месяца", ky: "3 ай" },
  nine_month: { ru: "9 месяцев", ky: "9 ай" },
  personal: { ru: "Персональный", ky: "Жеке" },
  single: { ru: "Разовый", ky: "Бирдик" },
  trial: { ru: "Пробный", ky: "Сыноо" },
};

const childStatusLbl: Record<string, { ru: string; ky: string }> = {
  active: { ru: "Активен", ky: "Активдүү" },
  frozen: { ru: "Заморожен", ky: "Тоңдурулган" },
  expired: { ru: "Истёк", ky: "Мөөнөтү бүткөн" },
  debtor: { ru: "Должник", ky: "Карызкор" },
};

const fmtD = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
};

export const DebtorsPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [q, setQ] = useState("");
  // Импортные карты августа без единой оплаты: долг «неизвестен» — их
  // показываем только по явному переключателю, чтобы не пугать офис
  // 660 тысячами несуществующего долга.
  const [showUnknown, setShowUnknown] = useState(false);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [pay, setPay] = useState<{ childId: string; cardId: string; amount: number; type: string } | null>(null);
  const { data: debtors = [], isLoading, error } = useAllCardDebts();
  const { data: kids = [] } = useChildren();
  const canReceive = usePerm("receive_payment");

  const rows = useMemo((): DebtorRow[] => {
    let list = debtors;
    if (!showUnknown) list = list.filter((d) => d.known);
    const qq = q.trim().toLowerCase();
    if (qq) list = list.filter((d) => d.full_name.toLowerCase().includes(qq) || d.phones.some((p) => p.includes(qq)));
    return list;
  }, [debtors, showUnknown, q]);

  const totalKnown = useMemo(() => rows.reduce((s, d) => s + d.total, 0), [rows]);
  const unknownCount = useMemo(() => debtors.filter((d) => !d.known).length, [debtors]);

  return (
    <>
      <PageHeader
        title={t("Должники", "Карызкорлор")}
        subtitle={t(
          `${rows.length} ${t("детей", "бала")} · ${t("долг", "карыз")} ${formatCurrency(totalKnown)}`,
          `${rows.length} бала · карыз ${formatCurrency(totalKnown)}`,
        )}
      />

      {activeChildId && (
        <ChildDrawer
          childId={activeChildId}
          child={kids.find((k) => k.id === activeChildId)}
          open={!!activeChildId}
          onClose={() => setActiveChildId(null)}
          lang={lang}
        />
      )}
      {pay && (
        <AcceptPaymentModal
          open
          onClose={() => setPay(null)}
          lang={lang}
          presetChildId={pay.childId}
          presetCardId={pay.cardId}
          presetAmount={pay.amount}
          presetComment={t(`Погашение долга по абонементу ${pay.type}`, `${pay.type} абонементи боюнча карызды төлөө`)}
        />
      )}

      <div className="card">
        <div className="toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t("Имя или телефон…", "Аты же телефону…")} />
          {unknownCount > 0 && (
            <label className="check" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={showUnknown} onChange={(e) => setShowUnknown(e.target.checked)} />
              <span>
                <b>{t(`Импорт без оплат (${unknownCount})`, `Төлөмсүз импорт (${unknownCount})`)}</b>
                <small>{t("долг не подтверждён — данные августа", "карыз тастыкталган эмес")}</small>
              </span>
            </label>
          )}
        </div>

        {error ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={(error as Error).message} />
        ) : isLoading ? (
          <EmptyState title={t("Считаем долги…", "Карыздар эсептелүүдө…")} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("Должников нет", "Карызкорлор жок")}
            hint={t("Долг появляется при продаже с частичной оплатой или по импортным картам с неполной оплатой", "Карыз жарым-жартылай төлөмдө пайда болот")}
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Ребёнок", "Бала")}</th>
                  <th>{t("Телефоны", "Телефондор")}</th>
                  <th>{t("Абонементы с долгом", "Карызы бар абонементтер")}</th>
                  <th className="num">{t("Цена", "Баасы")}</th>
                  <th className="num">{t("Оплачено", "Төлөндү")}</th>
                  <th className="num">{t("Долг", "Карыз")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const shownCards = showUnknown ? d.cards : d.cards.filter((c) => c.known);
                  const price = shownCards.reduce((s, c) => s + c.price, 0);
                  const paid = shownCards.reduce((s, c) => s + c.paid, 0);
                  const debt = shownCards.reduce((s, c) => s + c.debt, 0);
                  const first = shownCards[0];
                  const st = childStatusLbl[d.child_status];
                  return (
                    <tr key={d.child_id}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="avatar" style={{ flexShrink: 0 }}>{initialsOf(d.full_name)}</div>
                          <div>
                            <div className="cell-main" style={{ cursor: "pointer" }} onClick={() => setActiveChildId(d.child_id)}>
                              {d.full_name}
                            </div>
                            {st && <span className={`pill pill--${d.child_status}`}>{st[lang]}</span>}
                          </div>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12.5 }}>
                        {d.phones.length ? d.phones.map((p) => <div key={p}>{p}</div>) : <span style={{ color: "var(--muted)" }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12.5 }}>
                        {shownCards.map((c) => (
                          <div key={c.card_id} style={{ whiteSpace: "nowrap" }}>
                            {cardTypeLbl[c.type]?.[lang] ?? c.type} {fmtD(c.start_date)}–{fmtD(c.end_date)}:{" "}
                            <b style={{ color: c.known ? "var(--red-600)" : "var(--muted)" }}>{formatCurrency(c.debt)}</b>
                            {!c.known && <span style={{ color: "var(--muted)" }}> · {t("импорт, без оплат", "импорт, төлөмсүз")}</span>}
                          </div>
                        ))}
                      </td>
                      <td className="num">{formatCurrency(price)}</td>
                      <td className="num">{formatCurrency(paid)}</td>
                      <td className="num" style={{ color: d.known ? "var(--red-600)" : "var(--muted)", fontWeight: 700 }}>
                        {formatCurrency(debt)}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="btn" style={{ padding: "5px 10px", fontSize: 12 }} onClick={() => setActiveChildId(d.child_id)}>
                          {t("Карточка", "Карта")}
                        </button>
                        {canReceive && first && (
                          <>
                            {" "}
                            <button
                              className="btn btn--primary"
                              style={{ padding: "5px 10px", fontSize: 12 }}
                              onClick={() => setPay({ childId: d.child_id, cardId: first.card_id, amount: first.debt, type: cardTypeLbl[first.type]?.[lang] ?? first.type })}
                            >
                              <Icon name="plus" size={12} /> {t("Погасить", "Төлөө")}
                            </button>
                          </>
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
