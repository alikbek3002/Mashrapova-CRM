// Заморозка абонемента из приложения тренера — ТЗ §4.3.
//
// «Ставит менеджер или тренер (через приложение тренера). Если заморозку
// поставил тренер, менеджер получает уведомление в системе.»
//
// Тренер создаёт ЗАЯВКУ (pending) — бэкенд сам рассылает freeze.pending
// старшим ролям и ответственному менеджеру ребёнка. Одобряет офис.
import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "./shared/ui/Modal";
import type { Lang } from "./data";
import { useChildActiveCards } from "./shared/api/queries";
import { useCreateFreeze } from "./shared/api/mutations";

const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const CoachFreezeModal = ({
  open, onClose, lang, childId, childName,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  childId: string;
  childName: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: cards = [], isLoading } = useChildActiveCards(childId);
  const create = useCreateFreeze();

  const today = useMemo(() => ymd(new Date()), []);
  const [cardId, setCardId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setReason("");
    setFrom(today);
    setTo("");
    // Один абонемент — выбирать нечего, подставляем сразу.
    setCardId(cards.length === 1 ? cards[0]!.id : "");
  }, [open, cards, today]);

  const submit = async () => {
    setErr(null);
    if (!cardId) {
      setErr(t("Выберите абонемент", "Абонементти тандаңыз"));
      return;
    }
    if (!from || !to) {
      setErr(t("Укажите период заморозки", "Тындыруу мезгилин көрсөтүңүз"));
      return;
    }
    if (to < from) {
      setErr(t("Дата окончания раньше начала", "Аяктоо датасы башталыштан мурда"));
      return;
    }
    if (!reason.trim()) {
      setErr(t("Укажите причину — её увидит менеджер", "Себебин жазыңыз — менеджер көрөт"));
      return;
    }
    try {
      await create.mutateAsync({
        child_id: childId,
        club_card_id: cardId,
        reason: reason.trim(),
        start_date: from,
        end_date: to,
      });
      onClose();
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "";
      // Лимит заморозок зависит от типа абонемента (ТЗ §4.3, §4.1):
      // у месячных его нет вовсе, у пакетов — 1/2/3.
      if (msg.includes("freeze_quota_exceeded")) {
        setErr(t(
          "Лимит заморозок по этому абонементу исчерпан — он зависит от типа абонемента.",
          "Бул абонемент боюнча тындыруу лимити түгөндү.",
        ));
      } else if (msg.includes("freeze_overlaps_existing")) {
        setErr(t("На этот абонемент уже есть заморозка на пересекающийся период",
                 "Бул абонементте кайчылашкан мезгилге тындыруу бар"));
      } else {
        setErr(msg);
      }
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Заморозить абонемент", "Абонементти тындыруу")}>
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        <b>{childName}</b>
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("Загрузка…", "Жүктөлүүдө…")}</div>
      ) : cards.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--muted)" }}>
          {t("У ребёнка нет действующего абонемента — замораживать нечего.",
             "Баланын активдүү абонементи жок.")}
        </div>
      ) : (
        <>
          {cards.length > 1 && (
            <Field label={t("Абонемент", "Абонемент")}>
              <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                <option value="">—</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.type} · {c.start_date} — {c.end_date}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid-2">
            <Field label={t("С какого дня", "Кайсы күндөн")}>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("По какой день", "Кайсы күнгө чейин")}>
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label={t("Причина", "Себеби")}>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={t("болезнь / отъезд / травма…", "оору / сапар / жаракат…")} />
          </Field>
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
            {t("Это заявка: менеджер получит уведомление и подтвердит её. Срок абонемента продлится на дни заморозки.",
               "Бул арыз: менеджер эскертме алып, бекитет. Абонементтин мөөнөтү тындыруу күндөрүнө узарат.")}
          </div>
        </>
      )}

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={create.isPending || cards.length === 0}
        >
          {create.isPending ? "…" : t("Отправить заявку", "Арыз жөнөтүү")}
        </button>
      </div>
    </Modal>
  );
};
