import { useEffect, useMemo, useState } from "react";
import { Modal, Field } from "../shared/ui/Modal";
import { Icon } from "../data";
import type { Lang } from "../data";
import {
  useChildren, useSections, useCoaches, useGroups,
  useEnrollmentsByGroup, useGroupSchedule, useActiveCardsForChildren,
  useGroupEvents,
} from "../shared/api/queries";
import type { ActiveCard, GroupEvent } from "../shared/api/queries";
import type { GroupAudience } from "../shared/types/database";
import {
  useUpdateGroup, useArchive, useAddEnrollment, useRemoveEnrollment,
  useBulkGenerateLessons,
} from "../shared/api/mutations";
import { supabase } from "../shared/api/supabase";
import { computeWindowEnd } from "../shared/lib/enrollmentWindow";
import { toast } from "../shared/ui/toast";
import { initialsOf } from "./common";
import { SellCardModal } from "../shared/ui/forms";
import { ChildDrawer } from "./ChildDrawer";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";
import { TimeInput } from "../shared/ui/TimeInput";

type TabId = "params" | "kids" | "schedule" | "history";

const ageFromDob = (dob: string): number => {
  const d = new Date(dob); const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return Math.max(0, a);
};

export const GroupDrawer = ({
  groupId, open, onClose, lang,
}: {
  groupId: string;
  open: boolean;
  onClose: () => void;
  lang: Lang;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: groups = [] } = useGroups();
  const group = groups.find((g: any) => g.id === groupId);
  const { data: enrollments = [] } = useEnrollmentsByGroup(groupId);

  const [tab, setTab] = useState<TabId>("params");
  useEffect(() => { if (open) setTab("params"); }, [open, groupId]);

  if (!group) {
    return (
      <Modal open={open} onClose={onClose} width={760} title={t("Группа", "Топ")}>
        <SkeletonRows rows={4} />
      </Modal>
    );
  }

  const sectionName = lang === "ru" ? group.section?.name_ru : group.section?.name_ky;
  const coachName = group.coach?.full_name ?? "—";
  const filledN = enrollments.length;
  const cap = group.max_capacity;
  const bubble = group.section?.color ?? "var(--blue)";

  return (
    <Modal open={open} onClose={onClose} width={760} title={group.name}>
      <div className="child-hero">
        <div className="child-hero__av" style={{ background: bubble }}>
          {(group.name || "Г").slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="child-hero__name">{group.name}</div>
          <div className="child-hero__meta">
            <span>{sectionName ?? "—"}</span>
            <span>·</span>
            <span><Icon name="whistle" size={12} /> {coachName}</span>
            <span>·</span>
            <span><b>{filledN}/{cap}</b> {t("детей", "бала")}</span>
            <span>·</span>
            <span>{group.duration_min} {t("мин", "мин")}</span>
          </div>
        </div>
      </div>

      <div className="drawer-tabs">
        <button className={`drawer-tab ${tab === "params" ? "is-active" : ""}`} onClick={() => setTab("params")}>
          {t("Параметры", "Параметрлер")}
        </button>
        <button className={`drawer-tab ${tab === "kids" ? "is-active" : ""}`} onClick={() => setTab("kids")}>
          {t("Дети", "Балдар")} · {filledN}
        </button>
        <button className={`drawer-tab ${tab === "schedule" ? "is-active" : ""}`} onClick={() => setTab("schedule")}>
          {t("Расписание", "Жадыбал")}
        </button>
        <button className={`drawer-tab ${tab === "history" ? "is-active" : ""}`} onClick={() => setTab("history")}>
          {t("История", "Тарых")}
        </button>
      </div>

      <div className="drawer-body">
        {tab === "params" && <ParamsTab group={group} lang={lang} onClose={onClose} />}
        {tab === "kids" && <KidsTab group={group} enrollments={enrollments} lang={lang} />}
        {tab === "schedule" && <ScheduleTab groupId={groupId} durationMin={group.duration_min} lang={lang} />}
        {tab === "history" && <HistoryTab groupId={groupId} lang={lang} />}
      </div>
    </Modal>
  );
};

// ============================ Params tab ============================
const ParamsTab = ({ group, lang, onClose }: { group: any; lang: Lang; onClose: () => void }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: sections = [] } = useSections();
  const { data: coaches = [] } = useCoaches();
  const upd = useUpdateGroup();
  const archive = useArchive("groups");

  const [sectionId, setSectionId] = useState(group.section_id ?? "");
  const [coachId, setCoachId] = useState(group.coach_id ?? "");
  const [name, setName] = useState(group.name ?? "");
  const [cap, setCap] = useState(String(group.max_capacity ?? 12));
  const [dur, setDur] = useState(String(group.duration_min ?? 60));
  const [startsOn, setStartsOn] = useState(group.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(group.ends_on ?? "");
  const [rate, setRate] = useState(String(group.coach_rate_per_child ?? 100));
  // Детали группы: возраст и уровень (20260807000003).
  const [ageMin, setAgeMin] = useState(group.age_min != null ? String(group.age_min) : "");
  const [ageMax, setAgeMax] = useState(group.age_max != null ? String(group.age_max) : "");
  const [level, setLevel] = useState(group.level ?? "");
  const [audience, setAudience] = useState<GroupAudience>(group.audience ?? "kids");
  const [err, setErr] = useState<string | null>(null);
  const busy = upd.isPending || archive.isPending;

  const submit = async () => {
    setErr(null);
    if (startsOn && endsOn && endsOn < startsOn) {
      setErr(t("Срок: дата окончания раньше даты начала", "Мөөнөт: аяктоо күнү эрте"));
      return;
    }
    if (ageMin !== "" && ageMax !== "" && Number(ageMin) > Number(ageMax)) {
      setErr(t("Возраст: «от» больше, чем «до»", "Жаш: «баштап» «чейинден» чоң"));
      return;
    }
    try {
      await upd.mutateAsync({
        id: group.id,
        section_id: sectionId, coach_id: coachId, name,
        max_capacity: Number(cap), duration_min: Number(dur),
        starts_on: startsOn || null, ends_on: endsOn || null,
        coach_rate_per_child: Math.max(0, Number(rate) || 0),
        age_min: ageMin === "" ? null : Math.max(0, Number(ageMin) || 0),
        age_max: ageMax === "" ? null : Math.max(0, Number(ageMax) || 0),
        level: level.trim() || null,
        audience,
      });
      // Смена тренера через параметры — тоже «навсегда»: будущие
      // запланированные занятия переводим на нового, иначе они остались
      // бы за прежним тренером (и в его табеле/зарплате).
      if (coachId && coachId !== group.coach_id) {
        const today = new Date().toISOString().slice(0, 10);
        const { error: le } = await supabase
          .from("lessons")
          .update({ coach_id: coachId })
          .eq("group_id", group.id)
          .gte("date", today)
          .eq("status", "scheduled");
        if (le) throw le;
      }
      toast.ok(t("Группа обновлена", "Топ жаңыланды"));
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  const handleArchive = async () => {
    if (!confirm(t("Архивировать группу? Расписание тоже скроется.", "Топту архивдөө?"))) return;
    try {
      await archive.mutateAsync(group.id);
      onClose();
    } catch (e: unknown) { setErr((e as Error).message); }
  };

  return (
    <>
      <Field label={t("Название", "Аты")}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("СГ-2 (старшая)", "СГ-2")} />
      </Field>
      <div className="grid-2">
        <Field label={t("Секция", "Секция")}>
          <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {sections.map((s) => (<option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>))}
          </Select>
        </Field>
        <Field label={t("Тренер", "Тренер")}>
          <Select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
            <option value="">— {t("выбрать", "тандоо")} —</option>
            {coaches.map((c) => (<option key={c.id} value={c.id}>{c.full_name}</option>))}
          </Select>
        </Field>
        <Field label={t("Вместимость", "Багуу")}>
          <input type="number" value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <Field label={t("Длительность (мин)", "Узактыгы (мин)")}>
          <input type="number" value={dur} onChange={(e) => setDur(e.target.value)} />
        </Field>
        <Field
          label={t("Ставка тренера, сом/ребёнок", "Тренер ставкасы, сом/бала")}
          hint={t("Тренер получает эту сумму за каждого пришедшего ребёнка на занятии", "Ар бир келген бала үчүн")}
        >
          <input type="number" min={0} step={1} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="100" />
        </Field>
        <Field label={t("Аудитория", "Аудитория")}>
          <Select value={audience} onChange={(e) => setAudience(e.target.value as GroupAudience)}>
            <option value="kids">{t("Дети", "Балдар")}</option>
            <option value="adults">{t("Взрослые", "Чоңдор")}</option>
            <option value="mixed">{t("Смешанная", "Аралаш")}</option>
          </Select>
        </Field>
        <Field label={t("Уровень / примечание", "Деңгээл / эскертүү")}>
          <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder={t("старшая, ОФП…", "улуу топ…")} />
        </Field>
        <Field label={t("Возраст, от", "Жашы, баштап")}>
          <input type="number" min={0} value={ageMin} onChange={(e) => setAgeMin(e.target.value)} placeholder={t("напр. 5", "мис. 5")} />
        </Field>
        <Field label={t("Возраст, до", "Жашы, чейин")}>
          <input type="number" min={0} value={ageMax} onChange={(e) => setAgeMax(e.target.value)} placeholder={t("напр. 8", "мис. 8")} />
        </Field>
        <Field label={t("Группа работает с", "Топ иштейт")}>
          <DateInput value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field
          label={t("по (срок группы)", "чейин (мөөнөт)")}
          hint={t("Пусто — бессрочная", "Бош — мөөнөтсүз")}
        >
          <DateInput value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
      </div>
      {endsOn && endsOn < new Date().toISOString().slice(0, 10) && (
        <div style={{
          padding: "8px 10px", marginTop: 4,
          background: "var(--yellow-100)", border: "1px solid oklch(0.92 0.10 90)",
          borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--yellow-ink)",
        }}>
          <Icon name="warn" size={12} />{" "}
          {t("Срок группы истёк — новые занятия не создаются.", "Топтун мөөнөтү бүттү — жаңы сабак түзүлбөйт.")}
        </div>
      )}
      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" style={{ marginRight: "auto", color: "var(--red-600)" }} onClick={handleArchive} disabled={busy}>
          <Icon name="x" size={14} /> {t("В архив", "Архивге")}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={busy || !name || !sectionId || !coachId}>
          {busy ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </>
  );
};

// ============================ Kids tab ============================
const KidsTab = ({ group, enrollments, lang }: { group: any; enrollments: any[]; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [] } = useChildren();
  const { data: sections = [] } = useSections();
  const addEnroll = useAddEnrollment();
  const removeEnroll = useRemoveEnrollment();

  const [addOpen, setAddOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [scope, setScope] = useState<"none" | "all">("none");
  const [q, setQ] = useState("");
  // Клик по ребёнку в составе → его полная карточка поверх карточки
  // группы (абонементы, платежи, заморозки, правка — всё не выходя из группы).
  const [openChildId, setOpenChildId] = useState<string | null>(null);

  const enrolledChildIds = useMemo(
    () => new Set(enrollments.map((e: any) => e.child_id)),
    [enrollments],
  );

  const candidates = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return kids.filter((k) => {
      if (enrolledChildIds.has(k.id)) return false;
      if (qq && !k.full_name.toLowerCase().includes(qq)) return false;
      const active = (k.enrollments ?? []).filter((e) => e.archived_at == null);
      if (scope === "none" && active.length > 0) return false;
      return true;
    });
  }, [kids, q, scope, enrolledChildIds]);

  // Активные абонементы для всех видимых кандидатов — одним запросом.
  const candidateIds = useMemo(() => candidates.map((k) => k.id), [candidates]);
  const emptyCardsMap = useMemo(() => new Map<string, ActiveCard[]>(), []);
  const { data: cardsByChild = emptyCardsMap } = useActiveCardsForChildren(candidateIds);

  const sectionNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) m.set(s.id, lang === "ru" ? s.name_ru : s.name_ky);
    return m;
  }, [sections, lang]);

  const groupSectionName = lang === "ru" ? group.section?.name_ru : group.section?.name_ky;

  // Для каждого кандидата — статус валидности и причина.
  type Verdict =
    | { ok: true }
    | { ok: false; reason: "no_card" | "wrong_section" | "legacy_card"; cardSections: string };
  const checkChild = (childId: string): Verdict => {
    const cards: ActiveCard[] = cardsByChild.get(childId) ?? [];
    if (cards.length === 0) return { ok: false, reason: "no_card", cardSections: "" };
    if (group.section_id && cards.some((c: ActiveCard) => c.section_id === group.section_id)) return { ok: true };
    const hasLegacy = cards.some((c: ActiveCard) => c.section_id == null);
    const knownIds: string[] = Array.from(
      new Set(cards.map((c: ActiveCard) => c.section_id).filter((id): id is string => !!id)),
    );
    if (knownIds.length === 0 && hasLegacy) {
      return { ok: false, reason: "legacy_card", cardSections: "" };
    }
    const names = knownIds.map((id) => sectionNameById.get(id) ?? "—").join(", ");
    return { ok: false, reason: "wrong_section", cardSections: names };
  };

  const isFull = enrollments.length >= group.max_capacity;

  // Шаг выбора даты: с какой даты ребёнок числится в группе (перевод
  // задним числом или с будущей даты). По умолчанию — сегодня либо
  // старт карты, если он в будущем.
  const [addTarget, setAddTarget] = useState<{ id: string; name: string } | null>(null);
  const [addDate, setAddDate] = useState("");

  const openAdd = (k: { id: string; full_name: string }) => {
    const card = (cardsByChild.get(k.id) ?? []).find((c: ActiveCard) => c.section_id === group.section_id);
    const today = new Date().toISOString().slice(0, 10);
    const def = card?.start_date && card.start_date > today ? card.start_date : today;
    setAddTarget({ id: k.id, name: k.full_name });
    setAddDate(def);
  };

  const handleAdd = async () => {
    if (isFull || !addTarget || !addDate) return;
    // Окно записи от выбранной даты: конец = N-е занятие по расписанию
    // группы (N = total_lessons карты) — как при продаже абонемента.
    const card = (cardsByChild.get(addTarget.id) ?? []).find((c: ActiveCard) => c.section_id === group.section_id);
    let end_date: string | null = null;
    if (card) {
      const { data: schedule } = await supabase
        .from("group_schedule")
        .select("day_of_week, start_time")
        .eq("group_id", group.id);
      end_date = computeWindowEnd(addDate, card.total_lessons ?? 0, schedule ?? []) ?? card.end_date ?? null;
    }
    await addEnroll.mutateAsync({
      child_id: addTarget.id, group_id: group.id,
      start_date: card ? addDate : null, end_date,
    });
    setAddTarget(null);
  };
  const handleRemove = async (enrollmentId: string, childName: string) => {
    if (!confirm(t(`Убрать ${childName} из группы?`, `${childName} топтон чыгарасызбы?`))) return;
    await removeEnroll.mutateAsync(enrollmentId);
  };

  // Перевод в другую группу прямо из состава: новая запись в целевую
  // группу (окно по её расписанию, абонемент/секцию проверяет
  // validateEnrollment внутри addEnroll), затем архив текущей записи.
  const { data: allGroups = [] } = useGroups();
  const [transferTarget, setTransferTarget] = useState<{ enrollmentId: string; childId: string; childName: string } | null>(null);
  const [transferGroupId, setTransferGroupId] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);

  // Кандидаты: все группы кроме текущей; сперва группы той же секции.
  const transferCandidates = useMemo(() => {
    return (allGroups as any[])
      .filter((g) => g.id !== group.id)
      .sort((a, b) => {
        const sameA = a.section_id === group.section_id ? 0 : 1;
        const sameB = b.section_id === group.section_id ? 0 : 1;
        return sameA - sameB || String(a.name).localeCompare(String(b.name), "ru");
      });
  }, [allGroups, group.id, group.section_id]);

  const openTransfer = (enrollmentId: string, child: { id: string; full_name: string }) => {
    setTransferTarget({ enrollmentId, childId: child.id, childName: child.full_name });
    setTransferGroupId("");
    setTransferDate(new Date().toISOString().slice(0, 10));
  };

  const handleTransfer = async () => {
    if (!transferTarget || !transferGroupId || !transferDate) return;
    setTransferBusy(true);
    try {
      const target = (allGroups as any[]).find((g) => g.id === transferGroupId);
      const { data: cards } = await supabase
        .from("club_cards")
        .select("id, section_id, total_lessons, start_date, end_date")
        .eq("child_id", transferTarget.childId)
        .in("status", ["active", "ending"]);
      const card = ((cards ?? []) as any[]).find((c) => c.section_id === target?.section_id) ?? null;
      let end_date: string | null = null;
      if (card) {
        const { data: schedule } = await supabase
          .from("group_schedule")
          .select("day_of_week, start_time")
          .eq("group_id", transferGroupId);
        end_date = computeWindowEnd(transferDate, card.total_lessons ?? 0, schedule ?? []) ?? card.end_date ?? null;
      }
      await addEnroll.mutateAsync({
        child_id: transferTarget.childId, group_id: transferGroupId,
        start_date: card ? transferDate : null, end_date,
      });
      await removeEnroll.mutateAsync(transferTarget.enrollmentId);
      setTransferTarget(null);
    } finally {
      setTransferBusy(false);
    }
  };

  return (
    <>
      {enrollments.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{t("В группе пока нет детей", "Топто бала жок")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {enrollments.map((e: any) => {
            const child = e.child;
            if (!child) return null;
            return (
              <div key={e.id}>
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px",
                  background: "var(--bg-soft)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-sm)",
                }}
              >
                <div
                  onClick={() => setOpenChildId(child.id)}
                  title={t("Открыть карточку ребёнка", "Баланын карточкасын ачуу")}
                  style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0, cursor: "pointer" }}
                >
                  <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                    {initialsOf(child.full_name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="cell-main" style={{ color: "var(--blue-600, var(--blue))" }}>{child.full_name}</div>
                    <div className="cell-sub" style={{ fontSize: 11 }}>
                      {ageFromDob(child.birth_date)} {t("лет", "жаш")}
                      {child.card_number ? ` · ${child.card_number}` : ""}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => openTransfer(e.id, child)}
                  disabled={transferBusy}
                >
                  {t("Перевести", "Которуу")}
                </button>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "6px 10px", fontSize: 12, color: "var(--red-600)" }}
                  onClick={() => handleRemove(e.id, child.full_name)}
                  disabled={removeEnroll.isPending}
                >
                  {t("Убрать", "Чыгаруу")}
                </button>
              </div>
              {transferTarget?.enrollmentId === e.id && (
                <div style={{
                  padding: "10px 12px", marginTop: 6,
                  background: "var(--bg-soft)", border: "1px solid var(--blue)",
                  borderRadius: "var(--r-sm)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    {t(`Перевести ${child.full_name} в другую группу`, `${child.full_name} башка топко которуу`)}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <Select
                      value={transferGroupId}
                      onChange={(ev) => setTransferGroupId(ev.target.value)}
                      style={{
                        height: 36, minWidth: 220, padding: "0 10px",
                        border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                        background: "#fff", fontSize: 13,
                      }}
                    >
                      <option value="">— {t("выбрать группу", "топ тандоо")} —</option>
                      {transferCandidates.map((g: any) => {
                        const filled = (g.enrollments ?? []).filter((en: any) => en.archived_at == null).length;
                        const full = filled >= g.max_capacity;
                        return (
                          <option key={g.id} value={g.id} disabled={full}>
                            {g.name} · {filled}/{g.max_capacity}{full ? ` — ${t("заполнена", "толгон")}` : ""}
                          </option>
                        );
                      })}
                    </Select>
                    <DateInput
                      value={transferDate}
                      onChange={(ev) => setTransferDate(ev.target.value)}
                      style={{
                        height: 36, padding: "0 10px",
                        border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                        background: "#fff", fontSize: 13,
                      }}
                    />
                    <button
                      className="btn btn--primary"
                      style={{ padding: "8px 14px", fontSize: 12 }}
                      onClick={handleTransfer}
                      disabled={transferBusy || !transferGroupId || !transferDate}
                    >
                      {transferBusy ? t("Перевожу…", "Которулууда…") : t("Перевести с этой даты", "Ушул күндөн которуу")}
                    </button>
                    <button
                      className="btn btn--ghost"
                      style={{ padding: "8px 12px", fontSize: 12 }}
                      onClick={() => setTransferTarget(null)}
                    >
                      {t("Отмена", "Жокко чыгаруу")}
                    </button>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                    {t(
                      "Ребёнок будет убран из этой группы и записан в выбранную. Окно посещений пересчитается по расписанию новой группы.",
                      "Бала бул топтон чыгарылып, тандалган топко жазылат. Каттоо терезеси жаңы топтун жадыбалы боюнча эсептелет.",
                    )}
                  </div>
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}

      {isFull && (
        <div className="field__error" style={{ marginTop: 12 }}>
          {t("Группа заполнена. Сначала уберите кого-то или увеличьте вместимость.", "Топ толду. Адегенде бирөөнү чыгарыңыз.")}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!addOpen && (
          <>
            <button
              className="btn btn--primary"
              onClick={() => setAddOpen(true)}
              disabled={isFull}
            >
              <Icon name="plus" size={14} /> {t("Добавить ребёнка", "Бала кошуу")}
            </button>
            <button
              className="btn"
              onClick={() => setSellOpen(true)}
              disabled={isFull}
              title={t("Продать абонемент новому ребёнку и сразу записать в эту группу", "Жаңы балага абонемент сатуу")}
            >
              <Icon name="card" size={14} /> {t("Продать абонемент", "Абонемент сатуу")}
            </button>
          </>
        )}
        {addOpen && (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div className="seg" style={{ flex: "0 0 auto" }}>
                <button className={`seg__btn ${scope === "none" ? "is-active" : ""}`} onClick={() => setScope("none")}>
                  {t("Без группы", "Топсуз")}
                </button>
                <button className={`seg__btn ${scope === "all" ? "is-active" : ""}`} onClick={() => setScope("all")}>
                  {t("Все", "Баары")}
                </button>
              </div>
              <div className="search-box" style={{ flex: 1, minWidth: 160 }}>
                <Icon name="search" size={14} />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("Поиск по имени…", "Аты боюнча издөө…")}
                />
              </div>
              <button className="btn btn--ghost" onClick={() => setAddOpen(false)}>
                {t("Закрыть", "Жабуу")}
              </button>
            </div>

            <div style={{
              padding: "8px 10px", marginBottom: 8,
              background: "var(--bg-soft)", border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)", fontSize: 11, color: "var(--muted)",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Icon name="info" size={12} />
              {t(
                `Можно добавить только детей с активным абонементом на секцию «${groupSectionName ?? "—"}».`,
                `«${groupSectionName ?? "—"}» секциясына активдүү абонементи бар балдар гана кошулат.`,
              )}
            </div>
            {addTarget && (
              <div style={{
                padding: "10px 12px", marginBottom: 8,
                background: "var(--bg-soft)", border: "1px solid var(--blue)",
                borderRadius: "var(--r-sm)",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {t(`С какой даты добавить ${addTarget.name}?`, `${addTarget.name} качантан кошобуз?`)}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <DateInput
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    style={{
                      height: 36, padding: "0 10px",
                      border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                      background: "#fff", fontSize: 13,
                    }}
                  />
                  <button
                    className="btn btn--primary"
                    style={{ padding: "8px 14px", fontSize: 12 }}
                    onClick={handleAdd}
                    disabled={addEnroll.isPending || !addDate}
                  >
                    {addEnroll.isPending ? t("Добавляю…", "Кошулууда…") : t("Добавить с этой даты", "Ушул күндөн кошуу")}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => setAddTarget(null)}>
                    {t("Отмена", "Жокко чыгаруу")}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                  {t(
                    "До этой даты ребёнок в табеле группы не появится. Окно посещений считается от выбранной даты.",
                    "Бул күнгө чейин бала топтун табелинде көрүнбөйт. Каттоо терезеси тандалган күндөн эсептелет.",
                  )}
                </div>
              </div>
            )}
            {candidates.length === 0 ? (
              <div className="empty">
                <div className="empty__title">
                  {scope === "none"
                    ? t("Все активные дети уже в группах", "Бардык балдар топко кирген")
                    : t("Никого не найдено", "Эч ким табылган жок")}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {candidates.map((k) => {
                  const active = (k.enrollments ?? []).filter((e) => e.archived_at == null);
                  const groupBadges = active.map((e) => e.group?.name).filter(Boolean).join(", ");
                  const verdict = checkChild(k.id);
                  const blocked = !verdict.ok;
                  const reasonText = !verdict.ok
                    ? verdict.reason === "no_card"
                      ? t("Нет активного абонемента", "Активдүү абонемент жок")
                      : verdict.reason === "legacy_card"
                        ? t("У абонемента не указана секция — обновите карту", "Абонементте секция көрсөтүлгөн эмес")
                        : t(`Абонемент: ${verdict.cardSections}`, `Абонемент: ${verdict.cardSections}`)
                    : "";
                  return (
                    <div
                      key={k.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px",
                        background: blocked ? "var(--bg-soft)" : "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-sm)",
                        opacity: blocked ? 0.7 : 1,
                      }}
                    >
                      <div className="call-row__avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                        {initialsOf(k.full_name)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontSize: 13 }}>{k.full_name}</div>
                        <div className="cell-sub" style={{ fontSize: 11 }}>
                          {ageFromDob(k.birth_date)} {t("лет", "жаш")}
                          {groupBadges ? ` · ${groupBadges}` : ` · ${t("нет группы", "топсуз")}`}
                        </div>
                        {blocked && (
                          <div style={{ fontSize: 11, color: "var(--red-600)", marginTop: 2 }}>
                            {reasonText}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn--primary"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                        onClick={() => openAdd(k)}
                        disabled={addEnroll.isPending || isFull || blocked}
                        title={blocked ? reasonText : undefined}
                      >
                        <Icon name="plus" size={12} /> {t("Добавить", "Кошуу")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <SellCardModal
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        lang={lang}
        presetSectionId={group.section_id ?? undefined}
        presetGroupId={group.id}
      />

      {openChildId && (
        <ChildDrawer
          childId={openChildId}
          child={kids.find((k) => k.id === openChildId)}
          open={!!openChildId}
          onClose={() => setOpenChildId(null)}
          lang={lang}
        />
      )}
    </>
  );
};

// ============================ History tab ============================
// Полная история группы: смены тренера, замены на занятие, правки
// расписания, изменения состава. События пишут триггеры БД
// (20260804000005) — здесь только человекочитаемый рендер.
const DOW_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const HistoryTab = ({ groupId, lang }: { groupId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: events = [], isLoading } = useGroupEvents(groupId);

  const fmtSlot = (p: Record<string, unknown>) =>
    `${DOW_RU[Number(p.day_of_week ?? 0)]} ${String(p.start_time ?? "").slice(0, 5)} · ${p.duration_min} ${t("мин", "мин")}`;
  const fmtD = (s: string) =>
    new Date(s).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "2-digit", month: "short" });

  const describe = (ev: GroupEvent): { icon: string; text: string } => {
    const p = ev.payload as Record<string, any>;
    switch (ev.type) {
      case "coach_changed":
        return { icon: "whistle", text: t(
          `Тренер группы: ${p.old_coach_name ?? "—"} → ${p.new_coach_name ?? "—"}`,
          `Машыктыруучу: ${p.old_coach_name ?? "—"} → ${p.new_coach_name ?? "—"}`) };
      case "coach_substituted":
        return { icon: "whistle", text: t(
          `Замена на занятии ${p.date ?? ""} ${String(p.start_time ?? "").slice(0, 5)}: ${p.old_coach_name ?? "—"} → ${p.new_coach_name ?? "—"}`,
          `${p.date ?? ""} сабагында алмаштыруу: ${p.old_coach_name ?? "—"} → ${p.new_coach_name ?? "—"}`) };
      case "schedule_slot_added":
        return { icon: "calendar", text: t(`Расписание: добавлен слот ${fmtSlot(p)}`, `Жадыбал: слот кошулду ${fmtSlot(p)}`) };
      case "schedule_slot_removed":
        return { icon: "calendar", text: t(`Расписание: убран слот ${fmtSlot(p)}`, `Жадыбал: слот алынды ${fmtSlot(p)}`) };
      case "child_added":
        return { icon: "plus", text: t(
          `В группу добавлен ${p.child_name ?? "ребёнок"}${p.start_date ? ` (с ${fmtD(p.start_date)})` : ""}`,
          `Топко кошулду: ${p.child_name ?? "бала"}`) };
      case "child_removed":
        return { icon: "x", text: t(`Из группы убран ${p.child_name ?? "ребёнок"}`, `Топтон чыгарылды: ${p.child_name ?? "бала"}`) };
      case "child_returned":
        return { icon: "check", text: t(`Вернулся в группу: ${p.child_name ?? "ребёнок"}`, `Топко кайтты: ${p.child_name ?? "бала"}`) };
      case "renamed":
        return { icon: "note", text: t(`Переименована: «${p.old_name}» → «${p.new_name}»`, `Аты өзгөрдү: «${p.old_name}» → «${p.new_name}»`) };
      case "rate_changed":
        return { icon: "card", text: t(
          `Ставка тренера: ${Number(p.old_rate)} → ${Number(p.new_rate)} сом/ребёнок`,
          `Тренер ставкасы: ${Number(p.old_rate)} → ${Number(p.new_rate)} сом/бала`) };
      case "activated":
        return { icon: "check", text: t("Группа активирована", "Топ активдешти") };
      case "deactivated":
        return { icon: "x", text: t("Группа деактивирована", "Топ токтотулду") };
      default:
        return { icon: "info", text: ev.type };
    }
  };

  if (isLoading) return <SkeletonRows rows={4} />;
  if (events.length === 0) {
    return (
      <div className="empty">
        <div className="empty__title">{t("История пока пуста", "Тарых азырынча бош")}</div>
        <div>{t("Смены тренера, правки расписания и состава будут записываться здесь.", "Өзгөрүүлөр ушул жерде сакталат.")}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 420, overflowY: "auto" }}>
      {events.map((ev) => {
        const d = describe(ev);
        return (
          <div key={ev.id} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "9px 12px", background: "var(--bg-soft)",
            border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
          }}>
            <span style={{ color: "var(--muted)", marginTop: 1 }}><Icon name={d.icon} size={14} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--ink)" }}>{d.text}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {new Date(ev.created_at).toLocaleString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                {ev.actor?.full_name ? ` · ${ev.actor.full_name}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ============================ Schedule tab ============================
const ScheduleTab = ({ groupId, durationMin, lang }: { groupId: string; durationMin: number; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: existing = [] } = useGroupSchedule(groupId);
  const bulk = useBulkGenerateLessons();

  const [dayTimes, setDayTimes] = useState<Record<number, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (loaded) return;
    const next: Record<number, string> = {};
    for (const row of existing) {
      next[(row as any).day_of_week] = String((row as any).start_time).slice(0, 5);
    }
    setDayTimes(next);
    setLoaded(true);
  }, [existing, loaded]);

  const toggleDay = (d: number) => {
    setDayTimes((prev) => {
      if (d in prev) {
        const { [d]: _removed, ...rest } = prev;
        return rest;
      }
      const existingTimes = Object.values(prev);
      return { ...prev, [d]: existingTimes[0] ?? "16:00" };
    });
  };
  const setDayTime = (d: number, time: string) => setDayTimes((prev) => ({ ...prev, [d]: time }));

  const dayLabels = lang === "ru" ? ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] : ["Жш", "Дш", "Ше", "Ша", "Бш", "Жм", "Иш"];
  const dayFull = lang === "ru"
    ? ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]
    : ["Жекшемби", "Дүйшөмбү", "Шейшемби", "Шаршемби", "Бейшемби", "Жума", "Ишемби"];

  const selectedDays = Object.keys(dayTimes).map(Number).sort();

  const submit = async () => {
    setErr(null);
    if (selectedDays.length === 0) {
      setErr(t("Выберите хотя бы один день", "Жок дегенде бир күн"));
      return;
    }
    for (const d of selectedDays) {
      if (!/^\d{2}:\d{2}$/.test(dayTimes[d] ?? "")) {
        setErr(t("Укажите время для каждого выбранного дня", "Тандалган күн үчүн убакытты көрсөтүңүз"));
        return;
      }
    }
    setSaving(true);
    try {
      const { error: delErr } = await supabase.from("group_schedule").delete().eq("group_id", groupId);
      if (delErr) throw delErr;
      const sched = selectedDays.map((dow) => ({
        group_id: groupId,
        day_of_week: dow,
        start_time: dayTimes[dow],
        duration_min: durationMin,
      }));
      if (sched.length > 0) {
        const { error: insErr } = await supabase.from("group_schedule").insert(sched);
        if (insErr) throw insErr;
      }

      // Шаблон изменился — стираем будущие scheduled-занятия группы (они
      // могли быть в старые дни/время) и материализуем заново на 8 недель.
      const localYmd = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
      };
      const today = new Date();
      const todayStr = localYmd(today);
      const { error: lessonsDelErr } = await supabase
        .from("lessons")
        .delete()
        .eq("group_id", groupId)
        .eq("status", "scheduled")
        .gte("date", todayStr);
      if (lessonsDelErr) throw lessonsDelErr;

      try {
        const monday = new Date(today);
        monday.setHours(0, 0, 0, 0);
        const dow = (monday.getDay() + 6) % 7;
        monday.setDate(monday.getDate() - dow);
        const horizon = new Date(monday.getTime() + 56 * 86400000);
        await bulk.mutateAsync({
          group_id: groupId,
          from: localYmd(monday),
          to: localYmd(horizon),
        });
      } catch (e) {
        console.warn("auto bulk-generate failed:", e);
      }

      toast.ok(t("Расписание сохранено", "Жадыбал сакталды"));
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally { setSaving(false); }
  };

  return (
    <>
      <Field label={t("Дни занятий", "Сабак күндөрү")}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button
              key={d}
              type="button"
              className={`btn ${d in dayTimes ? "btn--primary" : ""}`}
              style={{ padding: "8px 14px", fontSize: 12, minWidth: 48 }}
              onClick={() => toggleDay(d)}
              disabled={saving}
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
                <div style={{ width: 110, fontWeight: 600, fontSize: 13 }}>{dayFull[d]}</div>
                <TimeInput
                  value={dayTimes[d] ?? "16:00"}
                  onChange={(e) => setDayTime(d, e.target.value)}
                  disabled={saving}
                  style={{ flex: 1, maxWidth: 140 }}
                />
                <button
                  type="button"
                  className="icon-btn"
                  title={t("Убрать день", "Күндү алып салуу")}
                  onClick={() => toggleDay(d)}
                  disabled={saving}
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
        <button className="btn btn--primary" onClick={submit} disabled={saving}>
          {saving ? t("Сохраняем…", "Сакталууда…") : t("Сохранить расписание", "Жадыбалды сактоо")}
        </button>
      </div>
    </>
  );
};
