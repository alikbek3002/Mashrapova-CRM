import { useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, formatCurrency } from "./common";
import { useCoaches, useGroups, useCoachRates } from "../shared/api/queries";
import { useAddCoachRate } from "../shared/api/mutations";
import { Modal, Field } from "../shared/ui/Modal";
import { Gate } from "../shared/auth/Gate";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

const today = () => new Date().toISOString().slice(0, 10);

export const CoachRatesPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: rates = [], isLoading, error } = useCoachRates();
  const { data: coaches = [] } = useCoaches();
  const { data: groups = [] } = useGroups();
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title={t("Ставки тренеров", "Тренер ставкалары")}
        subtitle={t("Ставка за фактически пришедшего ребёнка на тренировке", "Сабакка келген балага ставка")}
        actions={
          <Gate perm="manage_coach_rates">
            <button className="btn btn--primary" onClick={() => setOpen(true)}>
              <Icon name="plus" /> {t("Новая ставка", "Жаңы ставка")}
            </button>
          </Gate>
        }
      />

      {open && (
        <AddRateModal
          open={open}
          onClose={() => setOpen(false)}
          lang={lang}
          coaches={coaches.map((c) => ({ id: c.id, name: c.full_name }))}
          groups={(groups as any[]).map((g) => ({ id: g.id, name: g.name }))}
        />
      )}

      <div className="card">
        {error ? (
          <EmptyState title={t("Ошибка", "Ката")} hint={(error as Error).message} />
        ) : isLoading ? (
          <SkeletonRows />
        ) : rates.length === 0 ? (
          <EmptyState
            title={t("Ставок пока нет", "Ставкалар жок")}
            hint={t("Добавьте первую ставку через кнопку справа сверху.", "")}
          />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Тренер", "Тренер")}</th>
                  <th>{t("Группа", "Топ")}</th>
                  <th className="num">{t("Ставка / ребёнок", "Ставка / бала")}</th>
                  <th>{t("С даты", "Качандан")}</th>
                  <th>{t("По дату", "Качанга")}</th>
                  <th>{t("Статус", "Абалы")}</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <td>{r.coach?.full_name ?? "—"}</td>
                    <td>{r.group?.name ?? "—"}</td>
                    <td className="num">{formatCurrency(Number(r.rate_per_kid))}</td>
                    <td>{r.effective_from}</td>
                    <td>{r.effective_to ?? "—"}</td>
                    <td>
                      {r.effective_to === null
                        ? <span className="pill pill--active">{t("Активна", "Активдүү")}</span>
                        : <span className="pill pill--archived">{t("Закрыта", "Жабылган")}</span>}
                    </td>
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

const AddRateModal = ({
  open, onClose, lang, coaches, groups,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  coaches: { id: string; name: string }[];
  groups: { id: string; name: string }[];
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [coach_id, setCoach] = useState("");
  const [group_id, setGroup] = useState("");
  const [rate, setRate] = useState("0");
  const [from, setFrom] = useState(today());
  const [comment, setComment] = useState("");
  const add = useAddCoachRate();

  const submit = async () => {
    if (!coach_id || !group_id) return;
    await add.mutateAsync({
      coach_id, group_id,
      rate_per_kid: Number(rate) || 0,
      effective_from: from,
      comment: comment || null,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("Новая ставка", "Жаңы ставка")}>
      <Field label={t("Тренер", "Тренер")}>
        <Select value={coach_id} onChange={(e) => setCoach(e.target.value)}>
          <option value="">{t("— выберите —", "— тандаңыз —")}</option>
          {coaches.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
        </Select>
      </Field>
      <Field label={t("Группа", "Топ")}>
        <Select value={group_id} onChange={(e) => setGroup(e.target.value)}>
          <option value="">{t("— выберите —", "— тандаңыз —")}</option>
          {groups.map((g) => (<option key={g.id} value={g.id}>{g.name}</option>))}
        </Select>
      </Field>
      <Field label={t("Ставка за пришедшего ребёнка (с)", "Ставка (с)")}>
        <input type="number" min="0" value={rate} onChange={(e) => setRate(e.target.value)} />
      </Field>
      <Field label={t("Действует с", "Качандан")}>
        <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <Field label={t("Комментарий", "Эскертүү")}>
        <input value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={onClose}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={add.isPending || !coach_id || !group_id}>
          {add.isPending ? t("Сохранение…", "Сакталууда…") : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};
