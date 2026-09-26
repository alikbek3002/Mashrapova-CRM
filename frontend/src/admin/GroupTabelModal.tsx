// Табель группы — открывается по клику на группу в Расписании.
// Сетка дни × дети как у тренера. Офис с правом manage_schedule отмечает
// посещения прямо здесь (клик по ячейке → был / не был / уважительная /
// снять) — так менеджер закрывает пустые клетки задним числом, не открывая
// каждое занятие отдельно (запрос офиса 2026-09-02). Ограничения 24 ч у
// офиса нет (RLS attendance_staff_write). Управление занятием
// (изменить/отменить) — через «Открыть занятие».
import { useMemo, useState } from "react";
import { Icon, I18N } from "../data";
import type { Lang } from "../data";
import { Modal } from "../shared/ui/Modal";
import { AttendanceGrid, type CellClickArg } from "../shared/ui/AttendanceGrid";
import { useGroupTabel, useChildren, useCoaches, useGroups } from "../shared/api/queries";
import { useChangeGroupCoach, useMarkAttendance, useClearAttendance } from "../shared/api/mutations";
import { usePerm } from "../shared/auth/rbac";
import type { AttendanceStatus } from "../shared/types/database";
import { ChildDrawer } from "./ChildDrawer";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";
import { Select } from "../shared/ui/Select";

type Cell = { lesson_id: string; status: string | null };

export const GroupTabelModal = ({
  open, onClose, lang, groupId, groupName, focusLessonId, focusDate, onOpenLesson,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  groupId: string;
  groupName: string;
  focusLessonId?: string | null;
  focusDate?: string | null;
  onOpenLesson?: (lessonId: string) => void;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  const [cursor, setCursor] = useState(() => {
    const base = focusDate ? new Date(focusDate) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const periodRange = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const last = new Date(cursor.year, cursor.month + 1, 0);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: fmt(first), to: fmt(last) };
  }, [cursor]);
  const isCurrentMonth = useMemo(() => {
    const n = new Date();
    return n.getFullYear() === cursor.year && n.getMonth() === cursor.month;
  }, [cursor]);
  const todayStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  const { data, isLoading, error } = useGroupTabel(groupId, periodRange);
  // Клик по имени в журнале открывает карточку ребёнка.
  const { data: allKids = [] } = useChildren();
  const [openKidId, setOpenKidId] = useState<string | null>(null);

  // Смена основного тренера группы прямо из журнала: «с какой даты» —
  // будущие занятия с этой даты переводятся на нового тренера.
  const { data: coaches = [] } = useCoaches();
  const { data: groups = [] } = useGroups();
  const currentGroup = groups.find((g: any) => g.id === groupId);
  const changeCoach = useChangeGroupCoach();
  const [coachOpen, setCoachOpen] = useState(false);
  const [newCoachId, setNewCoachId] = useState("");
  const [coachFrom, setCoachFrom] = useState(todayStr);
  const submitCoachChange = async () => {
    if (!newCoachId || !coachFrom) return;
    await changeCoach.mutateAsync({ group_id: groupId, coach_id: newCoachId, from_date: coachFrom });
    setCoachOpen(false);
    setNewCoachId("");
  };

  const fmtMonth = (year: number, month: number) =>
    new Date(year, month, 1).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { month: "long", year: "numeric" });
  const goPrev = () => setCursor(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 });
  const goNext = () => setCursor(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 });
  const goToday = () => { const n = new Date(); setCursor({ year: n.getFullYear(), month: n.getMonth() }); };

  // Отметка из журнала: офис с правом manage_schedule.
  const canMark = usePerm("manage_schedule");
  const mark = useMarkAttendance();
  const clear = useClearAttendance();
  const [picker, setPicker] = useState<CellClickArg | null>(null);
  // Временно (просьба офиса 2026-09-10) только «был / не был»: «уваж.»
  // и «опоздал» убраны из выбора, старые отметки продолжают показываться.
  const PICK: AttendanceStatus[] = ["present", "absent"];
  const PICK_ICON: Record<AttendanceStatus, string> = { present: "check", absent: "x", excused: "warn", late: "clock", makeup: "download" };
  const onPick = async (status: AttendanceStatus) => {
    if (!picker) return;
    try {
      await mark.mutateAsync({ lessonId: picker.lesson_id, marks: [{ child_id: picker.child_id, status }] });
      setPicker(null);
    } catch { /* toast уже показан */ }
  };
  const onClear = async () => {
    if (!picker) return;
    try {
      await clear.mutateAsync({ lessonId: picker.lesson_id, childId: picker.child_id });
      setPicker(null);
    } catch { /* toast уже показан */ }
  };
  const busy = mark.isPending || clear.isPending;

  const kids = data?.kids ?? [];
  const dates = data?.dates ?? [];
  const grid = data?.grid ?? new Map<string, Map<string, Cell>>();
  const frozenByChild = data?.frozenByChild ?? new Map<string, Set<string>>();
  const removedByChild = data?.removedByChild ?? new Map<string, Set<string>>();
  const metaByChild = data?.metaByChild;
  const windowByChild = data?.windowByChild;

  return (
    <Modal open={open} onClose={onClose} width="full" title={groupName}>
      <div className="journal-head">
        <div className="journal-head__title">
          {tt("Журнал группы", "Топ журналы")}
          {canMark && (
            <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--muted)", marginLeft: 10 }}>
              {tt("клик по ячейке — отметить", "уячаны басыңыз — белгилөө")}
            </span>
          )}
          {currentGroup && (
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)", marginTop: 2, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {tt("Тренер", "Машыктыруучу")}: <b style={{ color: "var(--ink)" }}>{(currentGroup as any).coach?.full_name ?? "—"}</b>
              <button
                type="button"
                className="btn btn--ghost"
                style={{ padding: "2px 10px", fontSize: 11.5, height: 24 }}
                onClick={() => { setCoachOpen((v) => !v); setCoachFrom(todayStr); }}
              >
                {tt("Сменить тренера", "Машыктыруучуну алмаштыруу")}
              </button>
            </div>
          )}
        </div>
        <div className="journal-head__nav">
          <button type="button" className="journal-nav-btn" onClick={goPrev} aria-label={tt("Прошлый месяц", "Өткөн ай")}>
            <Icon name="chevron-left" size={18} stroke={2.25} />
          </button>
          <div className="journal-head__month">{fmtMonth(cursor.year, cursor.month)}</div>
          <button type="button" className="journal-nav-btn" onClick={goNext} aria-label={tt("Следующий месяц", "Кийинки ай")}>
            <Icon name="chevron-right" size={18} stroke={2.25} />
          </button>
          {!isCurrentMonth && (
            <button type="button" className="journal-today-btn" onClick={goToday}>
              {tt("Сегодня", "Бүгүн")}
            </button>
          )}
        </div>
      </div>

      {coachOpen && (
        <div style={{
          padding: "10px 12px", marginBottom: 10,
          background: "var(--bg-soft)", border: "1px solid var(--blue)",
          borderRadius: "var(--r-sm)",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {tt("Смена тренера группы", "Топтун машыктыруучусун алмаштыруу")}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Select
              value={newCoachId}
              onChange={(e) => setNewCoachId(e.target.value)}
              style={{ height: 36, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "#fff", fontSize: 13 }}
            >
              <option value="">— {tt("новый тренер", "жаңы машыктыруучу")} —</option>
              {coaches.filter((c: any) => c.id !== currentGroup?.coach_id).map((c: any) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </Select>
            <DateInput
              value={coachFrom}
              onChange={(e) => setCoachFrom(e.target.value)}
              style={{ height: 36, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "#fff", fontSize: 13 }}
            />
            <button
              className="btn btn--primary"
              style={{ padding: "8px 14px", fontSize: 12 }}
              onClick={submitCoachChange}
              disabled={changeCoach.isPending || !newCoachId || !coachFrom}
            >
              {changeCoach.isPending ? tt("Меняю…", "Алмашууда…") : tt("Сменить с этой даты", "Ушул күндөн алмаштыруу")}
            </button>
            <button className="btn btn--ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => setCoachOpen(false)}>
              {tt("Отмена", "Жокко чыгаруу")}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
            {tt(
              "Новый тренер закрепится за группой, все будущие занятия с выбранной даты перейдут к нему. Прошедшие занятия останутся за прежним. Для замены на одно занятие откройте занятие → «Изменить».",
              "Жаңы машыктыруучу топко бекитилет, тандалган күндөн баштап келечектеги сабактар ага өтөт. Бир сабакка алмаштыруу үчүн: сабак → «Өзгөртүү».",
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : error ? (
        // Ошибка загрузки — НЕ «нет учеников»: иначе любая проблема с
        // доступом/сетью выглядит как пустая группа и вводит в заблуждение.
        <div className="empty">
          <div className="empty__title">{tt("Не удалось загрузить журнал", "Журнал жүктөлгөн жок")}</div>
          <div>{(error as Error).message}</div>
        </div>
      ) : kids.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{tt("В группе пока нет учеников", "Топто окуучу жок")}</div>
          <div>{tt("Добавьте детей в группу через продажу абонемента.", "Абонемент сатуу аркылуу балдарды кошуңуз.")}</div>
        </div>
      ) : dates.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{tt("В этом месяце занятий нет", "Бул айда сабак жок")}</div>
          <div>{tt("Переключите месяц стрелками.", "Айды баскычтар менен которуңуз.")}</div>
        </div>
      ) : (
        <AttendanceGrid
          lang={lang}
          kids={kids}
          dates={dates}
          grid={grid}
          todayStr={todayStr}
          frozenByChild={frozenByChild}
          removedByChild={removedByChild}
          metaByChild={metaByChild}
          windowByChild={windowByChild}
          onKidClick={(k) => setOpenKidId(k.id)}
          onCellClick={canMark ? (c) => { if (!c.isFuture) setPicker(c); } : undefined}
        />
      )}

      {picker && (
        <div className="journal-picker__backdrop" onClick={() => !busy && setPicker(null)}>
          <div className="journal-picker" onClick={(e) => e.stopPropagation()}>
            <div className="journal-picker__head">
              <div className="journal-picker__name">{picker.child_name}</div>
              <div className="journal-picker__date">
                {new Date(picker.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </div>
            </div>
            <div className="journal-picker__grid">
              {PICK.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onPick(s)}
                  disabled={busy}
                  className={`journal-picker__btn ${picker.current === s ? "is-active" : ""} jp-${s}`}
                >
                  <span className="journal-picker__icon"><Icon name={PICK_ICON[s]} size={18} stroke={2.5} /></span>
                  {I18N[lang].status[s]}
                </button>
              ))}
            </div>
            {picker.current && (
              <button type="button" className="journal-picker__note-btn" onClick={onClear} disabled={busy}>
                <Icon name="x" size={16} stroke={2.25} />
                {tt("Снять отметку", "Белгини алып салуу")}
              </button>
            )}
            <button type="button" className="btn btn--ghost journal-picker__cancel" onClick={() => setPicker(null)} disabled={busy}>
              {tt("Отмена", "Жокко чыгаруу")}
            </button>
          </div>
        </div>
      )}

      {openKidId && (
        <ChildDrawer
          childId={openKidId}
          child={allKids.find((k) => k.id === openKidId)}
          open={!!openKidId}
          onClose={() => setOpenKidId(null)}
          lang={lang}
        />
      )}

      <div className="modal__foot">
        <button className="btn" onClick={onClose}>{tt("Закрыть", "Жабуу")}</button>
        {focusLessonId && onOpenLesson && (
          <button className="btn btn--primary" onClick={() => onOpenLesson(focusLessonId)}>
            <Icon name="calendar" size={14} /> {tt("Открыть занятие", "Сабакты ачуу")}
            {focusDate ? ` · ${focusDate}` : ""}
          </button>
        )}
      </div>
    </Modal>
  );
};
