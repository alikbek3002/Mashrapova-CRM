import { useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import type { CardPlan, CardType } from "../shared/types/database";
import { EmptyState } from "./common";
import { useCardPlans } from "../shared/api/queries";
import { useAddCardPlan, useUpdateCardPlan, useDeleteCardPlan } from "../shared/api/mutations";
import { Modal, Field } from "../shared/ui/Modal";
import { usePerm } from "../shared/auth/rbac";
import { SkeletonRows } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

// ============ Виды абонементов (каталог card_plans) ============
// Живёт вкладкой на странице «Абонементы»: директор создаёт виды,
// менеджеры видят каталог и выбирают вид при продаже.

const PLAN_TYPE_OPTS: { value: CardType; ru: string; ky: string; days: number }[] = [
  { value: "monthly",    ru: "1 месяц",   ky: "1 ай",       days: 30 },
  { value: "quarterly",  ru: "3 месяца",  ky: "3 ай",       days: 90 },
  { value: "half_year",  ru: "6 месяцев", ky: "6 ай",       days: 180 },
  { value: "annual",     ru: "12 месяцев",ky: "12 ай",      days: 360 },
  { value: "single",     ru: "Разовый",   ky: "Бир жолку",  days: 30 },
  { value: "trial",      ru: "Пробный",   ky: "Сыноо",      days: 30 },
];

export const CardPlansPanel = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const canManage = usePerm("manage_card_plans");
  const { data: plans = [], isLoading } = useCardPlans(canManage);
  const upd = useUpdateCardPlan();
  const del = useDeleteCardPlan();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CardPlan | null>(null);

  const toggleActive = async (p: CardPlan) => {
    await upd.mutateAsync({ id: p.id, is_active: !p.is_active });
  };

  const remove = (p: CardPlan) => {
    const name = lang === "ru" ? p.name_ru : p.name_ky;
    if (!confirm(t(`Удалить вид «${name}»?`, `«${name}» түрүн өчүрөсүзбү?`))) return;
    del.mutate(p.id);
  };

  return (
    <div style={{ padding: 16 }}>
      <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
        {t(
          "Каталог видов абонементов: при продаже менеджер выбирает вид из списка — цена, число занятий, срок и заморозки подставляются автоматически.",
          "Абонемент түрлөрүнүн каталогу: сатууда менеджер түрдү тандайт — баасы, сабак саны, мөөнөтү жана тоңдуруулар автоматтык коюлат.",
        )}
      </p>
      {canManage && (
        <button
          className="btn btn--primary"
          style={{ marginBottom: 12 }}
          onClick={() => { setEditing(null); setModalOpen(true); }}
        >
          <Icon name="plus" /> {t("Новый вид", "Жаңы түр")}
        </button>
      )}

      {isLoading ? (
        <SkeletonRows />
      ) : plans.length === 0 ? (
        <EmptyState
          title={t("Видов абонементов пока нет", "Абонемент түрлөрү азырынча жок")}
          hint={canManage
            ? t("Создайте виды (напр. «1 месяц · 12 занятий») — менеджеры будут выбирать их при продаже.", "Түрлөрдү түзүңүз (мис. «1 ай · 12 сабак») — менеджерлер сатууда тандайт.")
            : t("Виды абонементов создаёт директор.", "Абонемент түрлөрүн директор түзөт.")}
        />
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Название", "Аты")}</th>
                <th>{t("Тип", "Түрү")}</th>
                <th>{t("Срок", "Мөөнөтү")}</th>
                <th className="num">{t("Занятий", "Сабак")}</th>
                <th className="num">{t("Цена, KGS", "Баасы, KGS")}</th>
                <th className="num">{t("Заморозки", "Тоңдуруу")}</th>
                <th>{t("Активен", "Активдүү")}</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const typeOpt = PLAN_TYPE_OPTS.find((o) => o.value === p.type);
                return (
                  <tr key={p.id} style={{ cursor: "default", opacity: p.is_active ? 1 : 0.55 }}>
                    <td><div className="cell-main">{lang === "ru" ? p.name_ru : p.name_ky}</div></td>
                    <td style={{ color: "var(--muted)" }}>{typeOpt ? (lang === "ru" ? typeOpt.ru : typeOpt.ky) : p.type}</td>
                    <td>{p.duration_days} {t("дней", "күн")}</td>
                    <td className="num">{p.lessons_count ?? "∞"}</td>
                    <td className="num">{Number(p.price).toLocaleString("ru-RU")}</td>
                    <td className="num">{p.freeze_quota}</td>
                    <td>
                      {p.is_active
                        ? <span className="pill pill--active">{t("Да", "Ооба")}</span>
                        : <span className="pill pill--archived">{t("Нет", "Жок")}</span>}
                    </td>
                    {canManage && (
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button
                          className="btn btn--ghost"
                          style={{ padding: "6px 10px", fontSize: 12 }}
                          onClick={() => { setEditing(p); setModalOpen(true); }}
                        >
                          {t("Изменить", "Өзгөртүү")}
                        </button>
                        <button
                          className="btn btn--ghost"
                          style={{ padding: "6px 10px", fontSize: 12 }}
                          onClick={() => toggleActive(p)}
                          disabled={upd.isPending}
                        >
                          {p.is_active ? t("Выключить", "Өчүрүү") : t("Включить", "Күйгүзүү")}
                        </button>
                        <button
                          className="btn btn--ghost"
                          style={{ padding: "6px 10px", fontSize: 12, color: "var(--red-600)" }}
                          onClick={() => remove(p)}
                          disabled={del.isPending}
                          title={t("Удалить (если вид ещё не продавался)", "Өчүрүү (түр сатыла элек болсо)")}
                        >
                          {t("Удалить", "Өчүрүү")}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <PlanModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          lang={lang}
          plan={editing}
        />
      )}
    </div>
  );
};

const PlanModal = ({ open, onClose, lang, plan }: {
  open: boolean; onClose: () => void; lang: Lang; plan: CardPlan | null;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = useAddCardPlan();
  const upd = useUpdateCardPlan();
  const isEdit = !!plan;

  const [nameRu, setNameRu] = useState(plan?.name_ru ?? "");
  const [nameKy, setNameKy] = useState(plan?.name_ky ?? "");
  const [type, setType] = useState<CardType>(plan?.type ?? "monthly");
  const [days, setDays] = useState(String(plan?.duration_days ?? 30));
  const [lessons, setLessons] = useState(plan?.lessons_count != null ? String(plan.lessons_count) : "12");
  const [price, setPrice] = useState(plan != null ? String(Number(plan.price)) : "");
  const [freezes, setFreezes] = useState(String(plan?.freeze_quota ?? 0));
  const [err, setErr] = useState<string | null>(null);
  const busy = add.isPending || upd.isPending;

  const onTypeChange = (v: CardType) => {
    setType(v);
    // Срок подставляем из типа; при желании можно поправить руками.
    const opt = PLAN_TYPE_OPTS.find((o) => o.value === v);
    if (opt) setDays(String(opt.days));
  };

  const submit = async () => {
    setErr(null);
    if (!nameRu.trim()) { setErr(t("Укажите название", "Аталышын жазыңыз")); return; }
    if (price === "" || isNaN(Number(price)) || Number(price) < 0) {
      setErr(t("Укажите цену", "Баасын көрсөтүңүз")); return;
    }
    if (!Number(days) || Number(days) <= 0) {
      setErr(t("Срок должен быть больше 0 дней", "Мөөнөтү 0дөн чоң болушу керек")); return;
    }
    try {
      const payload = {
        name_ru: nameRu.trim(),
        name_ky: (nameKy || nameRu).trim(),
        type,
        duration_days: Number(days),
        lessons_count: lessons === "" ? null : Math.max(1, Number(lessons) || 1),
        price: Number(price),
        freeze_quota: Math.max(0, Number(freezes) || 0),
      };
      if (isEdit) await upd.mutateAsync({ id: plan!.id, ...payload });
      else await add.mutateAsync(payload);
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t("Редактировать вид", "Түрдү өзгөртүү") : t("Новый вид абонемента", "Жаңы абонемент түрү")}>
      <div className="grid-2">
        <Field label={t("Название (RU)", "Аты (RU)")}>
          <input value={nameRu} onChange={(e) => setNameRu(e.target.value)} placeholder={t("напр. 1 месяц · 12 занятий", "мис. 1 ай")} disabled={busy} />
        </Field>
        <Field label={t("Название (KY)", "Аты (KY)")}>
          <input value={nameKy} onChange={(e) => setNameKy(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Тип", "Түрү")}>
          <Select value={type} onChange={(e) => onTypeChange(e.target.value as CardType)} disabled={busy}>
            {PLAN_TYPE_OPTS.map((o) => (
              <option key={o.value} value={o.value}>{lang === "ru" ? o.ru : o.ky}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("Срок, дней", "Мөөнөтү, күн")}>
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Занятий", "Сабак саны")} hint={t("Пусто — без лимита", "Бош — чексиз")}>
          <input type="number" min={1} value={lessons} onChange={(e) => setLessons(e.target.value)} disabled={busy} />
        </Field>
        <Field label={t("Цена, KGS", "Баасы, KGS")}>
          <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder={t("напр. 5000", "мис. 5000")} disabled={busy} />
        </Field>
        <Field label={t("Заморозок, шт", "Тоңдуруу, саны")} hint={t("Сколько раз можно заморозить этот абонемент", "Канча жолу тоңдурууга болот")}>
          <input type="number" min={0} value={freezes} onChange={(e) => setFreezes(e.target.value)} disabled={busy} />
        </Field>
      </div>
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy}>
          {busy ? t("Сохраняем…", "Сакталууда…") : isEdit ? t("Сохранить", "Сактоо") : t("Создать", "Түзүү")}
        </button>
      </div>
    </Modal>
  );
};
