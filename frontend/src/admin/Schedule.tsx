import { useMemo, useState } from "react";
import { I18N, Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, EmptyState, initialsOf } from "./common";
import { fmtD } from "../shared/lib/dates";
import { useLessons, useGroups, useLessonRoster, useAttendanceForLesson, useFreezesForLessonDate, useSections, useCoaches } from "../shared/api/queries";
import { useMarkAttendance } from "../shared/api/mutations";
import type { AttendanceStatus } from "../shared/types/database";
import { CancelLessonModal, CreateLessonModal, EditLessonModal, BulkRescheduleModal, BulkCancelModal, RescheduleLessonModal } from "../shared/ui/forms";
import { Modal } from "../shared/ui/Modal";
import { Gate } from "../shared/auth/Gate";
import { usePerm } from "../shared/auth/rbac";
import { GroupDrawer } from "./GroupDrawer";
import { GroupTabelModal } from "./GroupTabelModal";
import { usePtSessions, usePtServices, type PtSessionFull } from "../shared/api/pt";
import { BookModal, SessionDetailModal } from "./PersonalTrainings";

// Тип занятий в сетке: обычные (групповые) / персональные (ПТ) / всё сразу.
type LessonKind = "all" | "group" | "pt";
const KIND_LS_KEY = "uq.schedule.kind";

// Локальная YYYY-MM-DD: важно для пользователей в UTC+N.
// toISOString даёт UTC-дату и съезжает на день назад вечером.
const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const startOfWeek = (d: Date) => {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const day = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - day);
  return r;
};

const addDays = (d: Date, n: number) => {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
};

export const SchedulePage = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].admin;
  const wd = I18N[lang].weekdays;
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [cancelOpen, setCancelOpen] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState<string | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  // Табель группы (клик по событию группы). Хранит и кликнутое занятие —
  // чтобы из табеля можно было открыть его карточку (изменить/отменить).
  const [tabelOpen, setTabelOpen] = useState<{ groupId: string; groupName: string; lessonId: string; date: string } | null>(null);
  const canManageSchedule = usePerm("manage_schedule");

  // Multi-select для bulk-операций (перенос/отмена нескольких занятий).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkRescheduleOpen, setBulkRescheduleOpen] = useState(false);
  const [bulkCancelOpen, setBulkCancelOpen] = useState(false);
  const toggleSelected = (lessonId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };
  const clearSelection = () => { setSelectedIds(new Set()); setSelectionMode(false); };
  // Ручной bulk-generate из шапки больше не показываем: занятия и так
  // материализуются автоматически при сохранении расписания группы
  // (см. GroupDrawer.ScheduleTab + AddGroupModal). Дублирующая кнопка
  // путала и приводила к дубликатам уроков.

  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const sunday = dates[6];

  const { data: lessons = [], isLoading } = useLessons({ from: ymd(weekStart), to: ymd(sunday) });
  const { data: groups = [] } = useGroups();
  // Персональные тренировки — в общем расписании клуба (ПТ §4)
  const { data: ptSessions = [] } = usePtSessions({ from: ymd(weekStart), to: ymd(sunday) });
  const { data: sections = [] } = useSections();
  const { data: coaches = [] } = useCoaches();
  const { data: ptServices = [] } = usePtServices();
  const canViewPt = usePerm("view_pt");
  const canManagePt = usePerm("manage_pt") || usePerm("sell_pt");

  // ---- Фильтры сетки: тип занятий, секция, тренер, услуга ПТ ----
  const [kind, setKind] = useState<LessonKind>(() => {
    const saved = localStorage.getItem(KIND_LS_KEY);
    return saved === "group" || saved === "pt" ? saved : "all";
  });
  const setKindPersist = (k: LessonKind) => { setKind(k); localStorage.setItem(KIND_LS_KEY, k); };
  const [sectionFilter, setSectionFilter] = useState("");
  const [coachFilter, setCoachFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const filtersOn = !!sectionFilter || !!coachFilter || !!serviceFilter || kind !== "all";
  const resetFilters = () => {
    setKindPersist("all"); setSectionFilter(""); setCoachFilter(""); setServiceFilter("");
  };

  // Роль без доступа к ПТ видит только обычные занятия — сегмент ПТ скрыт,
  // и «все» для неё означает именно групповые.
  const showPt = canViewPt && kind !== "group";
  const showGroups = kind !== "pt" || !canViewPt;

  const [ptOpenId, setPtOpenId] = useState<string | null>(null);
  const [ptBookOpen, setPtBookOpen] = useState(false);

  const shownLessons = useMemo(() => {
    if (!showGroups) return [];
    return lessons.filter((l) => {
      if (sectionFilter && (l.group?.section_id ?? null) !== sectionFilter) return false;
      if (coachFilter && l.coach_id !== coachFilter && (l as any).substitute_coach_id !== coachFilter) return false;
      return true;
    });
  }, [lessons, showGroups, sectionFilter, coachFilter]);

  const shownPt = useMemo(() => {
    if (!showPt) return [];
    return ptSessions.filter((s) => {
      if (s.status === "rescheduled") return false;
      if (sectionFilter && (s.service?.section_id ?? null) !== sectionFilter) return false;
      if (coachFilter && s.coach_id !== coachFilter && s.actual_coach_id !== coachFilter) return false;
      if (serviceFilter && s.service_id !== serviceFilter) return false;
      return true;
    });
  }, [ptSessions, showPt, sectionFilter, coachFilter, serviceFilter]);

  const todayStr = ymd(new Date());

  // Клик по событию: в режиме selection — добавляем/убираем из выделения;
  // иначе у группы открываем табель-сетку, у одиночного — карточку.
  const openEvent = (l: any) => {
    if (selectionMode) {
      // Нельзя выбирать уже отменённое занятие — оно не подлежит bulk-операциям.
      if (l.status === "cancelled" || l.status === "force_majeure") return;
      toggleSelected(l.id);
      return;
    }
    if (l.group?.id) {
      setTabelOpen({ groupId: l.group.id, groupName: l.group.name ?? "—", lessonId: l.id, date: l.date });
    } else {
      setInfoOpen(l.id);
    }
  };

  // Диапазон часов считаем динамически: 7–22 как база, расширяем по
  // фактическим занятиям, чтобы ранние (например, 8:00) и поздние
  // тренировки не пропадали с сетки.
  const DEFAULT_START = 7, DEFAULT_END = 22;
  let hoursStart = DEFAULT_START, hoursEnd = DEFAULT_END;
  for (const l of [...shownLessons, ...shownPt]) {
    const sh = Number(String(l.start_time).split(":")[0]);
    if (Number.isFinite(sh)) {
      if (sh < hoursStart) hoursStart = sh;
      const endH = sh + Math.ceil((l.duration_min ?? 60) / 60);
      if (endH > hoursEnd) hoursEnd = endH;
    }
  }
  const hours: number[] = [];
  for (let h = hoursStart; h < hoursEnd; h++) hours.push(h);

  return (
    <>
      <PageHeader
        title={tt("Расписание", "Жадыбал")}
        subtitle={`${fmtD(ymd(weekStart))} — ${fmtD(ymd(sunday))} · ${groups.length} ${tt("групп", "топ")}`}
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {canViewPt && canManagePt && (
              <button className="btn" onClick={() => setPtBookOpen(true)}>
                <Icon name="plus" size={14} /> {tt("Записать на ПТ", "ЖМга жазуу")}
              </button>
            )}
            <Gate perm="manage_schedule">
              {kind !== "pt" && (
                <button
                  className={`btn ${selectionMode ? "btn--primary" : ""}`}
                  onClick={() => { if (selectionMode) clearSelection(); else setSelectionMode(true); }}
                  title={tt("Выбрать несколько занятий", "Бир нече сабакты тандоо")}
                >
                  <Icon name={selectionMode ? "x" : "check"} size={14} />
                  {selectionMode
                    ? tt("Выйти из выбора", "Тандоодон чыгуу")
                    : tt("Выбрать несколько", "Бир нече тандоо")}
                </button>
              )}
              <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" /> {t.newLesson}
              </button>
            </Gate>
          </div>
        }
      />

      <CreateLessonModal open={createOpen} onClose={() => setCreateOpen(false)} lang={lang} />

      <div className="card">
        <div className="card__head">
          <div>
            <div className="card__title"><Icon name="calendar" size={16} /> {t.calendar.title}</div>
            <div className="card__subtitle">
              {showGroups && `${shownLessons.length} ${tt("групповых", "топтук")}`}
              {showGroups && showPt && " · "}
              {showPt && `${shownPt.length} ${tt("персональных", "жеке")}`}
              {" · "}
              {tt("на неделе", "жумада")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="chevron-left" /></button>
            <button className="btn btn--ghost" style={{ padding: "6px 10px" }} onClick={() => setWeekStart(startOfWeek(new Date()))}>
              {t.today}
            </button>
            <button className="icon-btn" onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="chevron-right" /></button>
          </div>
        </div>

        {/* Фильтры сетки: тип занятий · секция · тренер · услуга ПТ */}
        <div className="toolbar">
          {canViewPt && (
            <div className="seg seg--compact" role="group" aria-label={tt("Тип занятий", "Сабактын түрү")}>
              <button
                type="button"
                className={`seg__btn ${kind === "all" ? "is-active" : ""}`}
                onClick={() => setKindPersist("all")}
              >
                {tt("Все", "Баары")}
              </button>
              <button
                type="button"
                className={`seg__btn ${kind === "group" ? "is-active" : ""}`}
                onClick={() => setKindPersist("group")}
              >
                <span className="cal-dot cal-dot--group" /> {tt("Обычные", "Кадимки")}
              </button>
              <button
                type="button"
                className={`seg__btn ${kind === "pt" ? "is-active" : ""}`}
                onClick={() => { setKindPersist("pt"); clearSelection(); }}
              >
                <span className="cal-dot cal-dot--pt" /> {tt("Индивидуальные", "Жеке")}
              </button>
            </div>
          )}

          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            title={tt("Секция", "Секция")}
          >
            <option value="">{tt("Все секции", "Бардык секциялар")}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
            ))}
          </select>

          <select
            value={coachFilter}
            onChange={(e) => setCoachFilter(e.target.value)}
            title={tt("Тренер", "Тренер")}
          >
            <option value="">{tt("Все тренеры", "Бардык тренерлер")}</option>
            {coaches.map((c: { id: string; full_name: string }) => (
              <option key={c.id} value={c.id}>{c.full_name}</option>
            ))}
          </select>

          {showPt && (
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              title={tt("Услуга ПТ", "ЖМ кызматы")}
            >
              <option value="">{tt("Все услуги ПТ", "Бардык ЖМ кызматтары")}</option>
              {ptServices.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          {filtersOn && (
            <button className="btn btn--ghost" style={{ padding: "6px 10px" }} onClick={resetFilters}>
              <Icon name="x" size={13} /> {tt("Сбросить", "Тазалоо")}
            </button>
          )}
        </div>

        {isLoading ? <EmptyState title={tt("Загрузка…", "Жүктөлүүдө…")} />
          : shownLessons.length === 0 && shownPt.length === 0 ? (
            <EmptyState title={filtersOn
              ? tt("По выбранным фильтрам занятий нет", "Тандалган чыпкалар боюнча сабак жок")
              : tt("На этой неделе занятий нет", "Бул жумада сабак жок")} />
          ) : (
          <div className="cal">
            <div className="cal__grid cal__grid--head">
              <div />
              {wd.map((d, i) => (
                <div
                  key={i}
                  className={`cal__head${ymd(dates[i]) === todayStr ? " is-today" : ""}${i >= 5 ? " is-weekend" : ""}`}
                >
                  {d}
                  <span className="d">{dates[i].getDate()}</span>
                </div>
              ))}
            </div>
            <div className="cal__grid" style={{ position: "relative" }}>
              {hours.map((h) => (
                <Row key={h} h={h} dates={dates} lessons={shownLessons} lang={lang}
                  onOpen={openEvent}
                  selectedIds={selectedIds}
                  ptSessions={shownPt}
                  onOpenPt={(s) => setPtOpenId(s.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {cancelOpen && (
        <CancelLessonModal open={!!cancelOpen} onClose={() => setCancelOpen(null)} lang={lang} lessonId={cancelOpen} />
      )}
      {editOpen && (() => {
        const l = lessons.find((x) => x.id === editOpen);
        if (!l) return null;
        return (
          <EditLessonModal
            open={!!editOpen}
            onClose={() => setEditOpen(null)}
            lang={lang}
            lesson={{
              id: l.id,
              date: l.date,
              start_time: l.start_time,
              duration_min: l.duration_min,
              coach_id: l.coach_id,
              substitute_coach_id: (l as any).substitute_coach_id ?? null,
            }}
          />
        );
      })()}
      {infoOpen && (() => {
        const l = lessons.find((x) => x.id === infoOpen);
        if (!l) return null;
        return (
          <LessonInfoModal
            open={!!infoOpen}
            onClose={() => setInfoOpen(null)}
            lang={lang}
            lesson={l}
            canEdit={canManageSchedule}
            onEdit={() => { setEditOpen(l.id); setInfoOpen(null); }}
            onReschedule={() => { setRescheduleOpen(l.id); setInfoOpen(null); }}
            onCancel={() => { setCancelOpen(l.id); setInfoOpen(null); }}
            onOpenGroup={l.group?.id ? () => { setOpenGroupId(l.group!.id); setInfoOpen(null); } : undefined}
          />
        );
      })()}
      {rescheduleOpen && (() => {
        const l = lessons.find((x) => x.id === rescheduleOpen);
        if (!l) return null;
        return (
          <RescheduleLessonModal
            open={!!rescheduleOpen}
            onClose={() => setRescheduleOpen(null)}
            lang={lang}
            lesson={l as any}
          />
        );
      })()}
      {openGroupId && (
        <GroupDrawer
          groupId={openGroupId}
          open={!!openGroupId}
          onClose={() => setOpenGroupId(null)}
          lang={lang}
        />
      )}
      {tabelOpen && (
        <GroupTabelModal
          open={!!tabelOpen}
          onClose={() => setTabelOpen(null)}
          lang={lang}
          groupId={tabelOpen.groupId}
          groupName={tabelOpen.groupName}
          focusLessonId={tabelOpen.lessonId}
          focusDate={tabelOpen.date}
          onOpenLesson={(lessonId) => { setTabelOpen(null); setInfoOpen(lessonId); }}
        />
      )}

      {selectionMode && selectedIds.size > 0 && (
        <div className="bulk-action-bar">
          <span className="bulk-action-bar__count">
            {tt("Выбрано:", "Тандалды:")} <b>{selectedIds.size}</b>
          </span>
          <button className="btn" onClick={clearSelection}>
            {tt("Снять выделение", "Тандоону алып салуу")}
          </button>
          <button className="btn" style={{ color: "var(--red-600)" }} onClick={() => setBulkCancelOpen(true)}>
            <Icon name="x" size={14} /> {tt("Отменить", "Жокко чыгаруу")}
          </button>
          <button className="btn btn--primary" onClick={() => setBulkRescheduleOpen(true)}>
            <Icon name="calendar" size={14} /> {tt("Перенести", "Жылдыруу")}
          </button>
        </div>
      )}

      {bulkRescheduleOpen && (
        <BulkRescheduleModal
          open={bulkRescheduleOpen}
          onClose={() => setBulkRescheduleOpen(false)}
          lang={lang}
          lessons={lessons.filter((l) => selectedIds.has(l.id))}
          onSuccess={() => { setBulkRescheduleOpen(false); clearSelection(); }}
        />
      )}
      {bulkCancelOpen && (
        <BulkCancelModal
          open={bulkCancelOpen}
          onClose={() => setBulkCancelOpen(false)}
          lang={lang}
          lessons={lessons.filter((l) => selectedIds.has(l.id))}
          onSuccess={() => { setBulkCancelOpen(false); clearSelection(); }}
        />
      )}

      {/* ПТ прямо из расписания: провести, перенести, отменить, замена тренера,
          правка даты/времени — та же карточка, что в разделе «Персональные». */}
      {ptOpenId && (() => {
        const s = ptSessions.find((x) => x.id === ptOpenId);
        if (!s) return null;
        return (
          <SessionDetailModal
            open
            session={s}
            lang={lang}
            canManage={canManagePt}
            onClose={() => setPtOpenId(null)}
          />
        );
      })()}

      {ptBookOpen && (
        <BookModal open onClose={() => setPtBookOpen(false)} lang={lang} />
      )}
    </>
  );
};

const Row = ({ h, dates, lessons, lang, onOpen, selectedIds, ptSessions = [], onOpenPt }: {
  h: number; dates: Date[]; lessons: any[]; lang: Lang; onOpen: (l: any) => void;
  selectedIds?: Set<string>;
  ptSessions?: PtSessionFull[];
  onOpenPt?: (s: PtSessionFull) => void;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const todayStr = ymd(new Date());
  return (
    <>
      <div className="cal__hour">{h}:00</div>
      {[0, 1, 2, 3, 4, 5, 6].map((di) => {
        const dStr = ymd(dates[di]);
        const cellLessons = lessons
          .filter((l) => l.date === dStr && Number(l.start_time.split(":")[0]) === h)
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        const cellPt = ptSessions
          .filter((s) => s.date === dStr && Number(s.start_time.split(":")[0]) === h && s.status !== "rescheduled")
          .sort((a, b) => a.start_time.localeCompare(b.start_time));
        return (
          <div
            key={di}
            className={`cal__cell${dStr === todayStr ? " is-today" : ""}${di >= 5 ? " is-weekend" : ""}`}
          >
            {cellPt.map((s) => {
              const kids = s.lessons.map((l) => l.child?.full_name ?? "").filter(Boolean);
              const coachName = s.actual_coach?.full_name ?? s.coach?.full_name ?? "";
              return (
                <div
                  key={`pt-${s.id}`}
                  className={`cal__event cal__event--pt lesson-status--${s.status === "completed" ? "completed" : s.status === "cancelled" ? "cancelled" : "scheduled"}`}
                  style={{ cursor: "pointer" }}
                  title={`${tt("Персональная", "Жеке")} · ${s.service?.name ?? ""} · ${kids.join(", ")} · ${coachName}`}
                  onClick={() => onOpenPt?.(s)}
                >
                  <div className="cal__event__time">
                    {s.start_time.slice(0, 5)} · {s.duration_min}{tt("м", "м")}
                    <span className="cal__event__tag">{tt("ПТ", "ЖМ")}</span>
                  </div>
                  <div className="cal__event__name">
                    {kids.map((n) => n.split(" ")[0]).join(", ") || (s.service?.name ?? "—")}
                  </div>
                  <div className="cal__event__sub">{coachName}</div>
                </div>
              );
            })}
            {cellLessons.map((l) => {
              const sec = l.group?.section;
              const secName = sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : null;
              const groupName = l.group?.name ?? "—";
              const isSelected = selectedIds?.has(l.id) ?? false;
              return (
                <div
                  key={l.id}
                  className={`cal__event lesson-status--${l.status}${isSelected ? " cal__event--selected" : ""}`}
                  style={{ cursor: "pointer" }}
                  title={`${groupName} · ${l.start_time.slice(0, 5)} · ${l.duration_min}м`}
                  onClick={() => onOpen(l)}
                >
                  <div className="cal__event__time">
                    {l.start_time.slice(0, 5)} · {l.duration_min}{lang === "ru" ? "м" : "м"}
                  </div>
                  <div className="cal__event__name">{groupName}</div>
                  {(secName || l.coach?.full_name) && (
                    <div className="cal__event__sub">
                      {secName ? secName : ""}
                      {secName && l.coach?.full_name ? " · " : ""}
                      {l.coach?.full_name ?? ""}
                      {(l as any).substitute_coach_id ? (lang === "ru" ? " (замена)" : " (алмаштыруу)") : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
};

// ============================ Lesson info modal ============================
// Табель посещаемости конкретного занятия. Доступ — всем, у кого есть
// `view_schedule` (включая кассира). Только просмотр: редактирует тренер
// в своём кабинете.
type AttPillMeta = { label: { ru: string; ky: string }; bg: string; fg: string; icon: string };
const ATT_META: Record<AttendanceStatus, AttPillMeta> = {
  present: { label: { ru: "Был",      ky: "Болду"        }, bg: "var(--green)",   fg: "#fff",              icon: "check"    },
  absent:  { label: { ru: "Не был",   ky: "Болгон жок"   }, bg: "var(--red)",     fg: "#fff",              icon: "x"        },
  late:    { label: { ru: "Опоздал",  ky: "Кечикти"      }, bg: "var(--yellow)",  fg: "var(--yellow-ink)", icon: "clock"    },
  excused: { label: { ru: "Уваж.",    ky: "Себептүү"     }, bg: "var(--blue)",    fg: "#fff",              icon: "warn"     },
  makeup:  { label: { ru: "Отработка",ky: "Иштеп берүү"  }, bg: "var(--bg-soft)", fg: "var(--ink)",        icon: "download" },
};

const LessonInfoModal = ({
  open, onClose, lang, lesson, canEdit, onEdit, onReschedule, onCancel, onOpenGroup,
}: {
  open: boolean; onClose: () => void; lang: Lang;
  lesson: any; canEdit: boolean;
  onEdit: () => void; onReschedule: () => void; onCancel: () => void;
  onOpenGroup?: () => void;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Состав занятия — RPC fn_lesson_roster: окно записи ИЛИ абонемент
  // покрывает дату ИЛИ есть отметка. Не только окно записи — оно у части
  // детей устарело, и ребёнок с пропусками в карточке в занятии не
  // находился (офис, 2026-09-02).
  const { data: enrollments = [], isLoading } = useLessonRoster(lesson.id);
  const { data: attendance = [] } = useAttendanceForLesson(lesson.id);
  const childIds = useMemo(() => enrollments.map((e: any) => e.child_id), [enrollments]);
  const { data: frozenSet = new Set<string>() } = useFreezesForLessonDate(lesson.date, childIds);
  const mark = useMarkAttendance();
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, AttendanceStatus | "">>({});

  const attMap = useMemo(() => {
    const m = new Map<string, AttendanceStatus>();
    for (const a of attendance) m.set(a.child_id, a.status);
    return m;
  }, [attendance]);

  // Временно (просьба офиса 2026-09-10) только «был / не был».
  const STATUSES: AttendanceStatus[] = ["present", "absent"];
  const startEdit = () => {
    const init: Record<string, AttendanceStatus | ""> = {};
    for (const e of enrollments as any[]) {
      const cid = e.child_id;
      if (frozenSet.has(cid)) continue;
      const cur = attMap.get(cid);
      init[cid] = cur ?? "";
    }
    setEdits(init);
    setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setEdits({}); };
  const saveEdits = async () => {
    const marks = Object.entries(edits)
      .filter(([, v]) => v !== "")
      .map(([child_id, status]) => ({ child_id, status: status as AttendanceStatus }));
    if (!marks.length) { setEditing(false); return; }
    try {
      await mark.mutateAsync({ lessonId: lesson.id, marks });
      setEditing(false);
      setEdits({});
    } catch {/* toast already shown */}
  };

  const sec = lesson.group?.section;
  const secName = sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : "—";
  const groupName = lesson.group?.name ?? "—";

  const today = ymd(new Date());
  const isFuture = lesson.date > today;
  const isCancelled = lesson.status === "cancelled";

  // Сводка: «Был» + «Опоздал» + «Отработка» считаются как пришёл.
  const stats = useMemo(() => {
    let present = 0, total = 0, frozen = 0;
    for (const e of enrollments as any[]) {
      const cid = e.child_id;
      if (frozenSet.has(cid)) { frozen++; continue; }
      total++;
      const s = attMap.get(cid);
      if (s === "present" || s === "late" || s === "makeup") present++;
    }
    return { present, total, frozen };
  }, [enrollments, attMap, frozenSet]);

  return (
    <Modal open={open} onClose={onClose} width={640} title={groupName}>
      <div style={{
        display: "flex", flexDirection: "column", gap: 4,
        padding: 12, background: "var(--bg-soft)",
        border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
        marginBottom: 14, fontSize: 13,
      }}>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Секция:", "Секция:")} </span>
          <b>{secName}</b>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Дата и время:", "Күн жана убакыт:")} </span>
          <b>{lesson.date} · {lesson.start_time.slice(0, 5)} · {lesson.duration_min} {t("мин", "мин")}</b>
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Тренер:", "Тренер:")} </span>
          <b>{lesson.coach?.full_name ?? "—"}</b>
          {lesson.substitute_coach_id && (
            <span style={{ marginLeft: 6, fontSize: 11, color: "var(--yellow-ink)" }}>
              ({t("замена", "алмаштыруу")})
            </span>
          )}
        </div>
        <div>
          <span style={{ color: "var(--muted)" }}>{t("Статус:", "Абалы:")} </span>
          <span className={`pill pill--${lesson.status === "scheduled" ? "active" : lesson.status === "cancelled" ? "expired" : "frozen"}`}>
            {lesson.status}
          </span>
        </div>
      </div>

      {/* Сводка табеля */}
      {!isCancelled && enrollments.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 14,
          padding: "10px 14px", marginBottom: 10,
          background: isFuture ? "var(--yellow-100)" : "var(--blue-50)",
          border: `1px solid ${isFuture ? "oklch(0.92 0.10 90)" : "var(--blue-100)"}`,
          color: isFuture ? "var(--yellow-ink)" : "var(--blue-ink)",
          borderRadius: "var(--r-sm)", fontSize: 13,
        }}>
          {isFuture ? (
            <>
              <Icon name="clock" size={16} />
              <span>{t("Занятие ещё не прошло — табель пока пуст.", "Сабак өткөн жок — табель бош.")}</span>
            </>
          ) : (
            <>
              <Icon name="check" size={16} />
              <span>
                <b>{t("Был", "Болду")}: {stats.present}</b> {t("из", "ичинен")} <b>{stats.total}</b>
                {stats.total > 0 && ` · ${Math.round((stats.present / stats.total) * 100)}%`}
                {stats.frozen > 0 && ` · ${t("заморожено", "тындырылган")}: ${stats.frozen}`}
              </span>
            </>
          )}
        </div>
      )}

      <div style={{
        fontSize: 11, fontWeight: 600, color: "var(--muted)",
        textTransform: "uppercase", letterSpacing: 0.04, marginBottom: 8,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>{t("Табель посещаемости", "Катышуу табели")} · {enrollments.length}</span>
      </div>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{t("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : enrollments.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{t("В этой группе пока нет детей", "Топто бала жок")}</div>
          {onOpenGroup && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn--primary" onClick={onOpenGroup}>
                <Icon name="plus" size={14} /> {t("Добавить детей в группу", "Топко балдарды кошуу")}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {(enrollments as any[]).map((e) => {
            const c = e.child;
            if (!c) return null;
            const isFrozen = frozenSet.has(c.id);
            const status = attMap.get(c.id);
            const meta = status ? ATT_META[status] : null;
            return (
              <div
                key={e.id}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 12px",
                  background: "var(--surface)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-sm)",
                  fontSize: 13,
                }}
              >
                <div className="call-row__avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                  {initialsOf(c.full_name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-main">{c.full_name}</div>
                  <div className="cell-sub" style={{ fontSize: 11 }}>
                    {c.card_number ? c.card_number : ""}
                  </div>
                </div>
                {isFrozen ? (
                  <span className="pill pill--frozen" style={{ fontSize: 11 }}>
                    {t("Заморожен", "Тындырылган")}
                  </span>
                ) : isCancelled ? (
                  <span className="pill pill--expired" style={{ fontSize: 11 }}>
                    {t("Отменено", "Жокко чыгарылды")}
                  </span>
                ) : editing ? (
                  <select
                    value={edits[c.id] ?? ""}
                    onChange={(e) => setEdits((p) => ({ ...p, [c.id]: e.target.value as AttendanceStatus | "" }))}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--line)", background: "var(--surface)" }}
                  >
                    <option value="">{t("— не отмечен —", "— белгиленбеген —")}</option>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{ATT_META[s].label[lang]}</option>
                    ))}
                  </select>
                ) : meta ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "3px 9px", borderRadius: 999,
                    background: meta.bg, color: meta.fg,
                    fontSize: 11, fontWeight: 600,
                  }}>
                    <Icon name={meta.icon} size={11} stroke={2.5} />
                    {meta.label[lang]}
                  </span>
                ) : (
                  <span style={{
                    padding: "3px 9px", borderRadius: 999,
                    background: "transparent", color: "var(--muted)",
                    border: "1px dashed var(--line)",
                    fontSize: 11, fontWeight: 500,
                  }}>
                    {t("не отмечено", "белгиленген эмес")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="modal__foot">
        {editing ? (
          <>
            <button className="btn" onClick={cancelEdit} disabled={mark.isPending}>
              {t("Отмена", "Жокко чыгаруу")}
            </button>
            <button className="btn btn--primary" onClick={saveEdits} disabled={mark.isPending}>
              <Icon name="check" size={14} /> {mark.isPending ? "…" : t("Сохранить отметки", "Белгилерди сактоо")}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>{t("Закрыть", "Жабуу")}</button>
            {onOpenGroup && (
              <button className="btn" onClick={onOpenGroup}>
                <Icon name="dashboard" size={14} /> {t("Открыть группу", "Топту ачуу")}
              </button>
            )}
            {canEdit && !isFuture && !isCancelled && enrollments.length > 0 && (
              <button className="btn" onClick={startEdit}>
                <Icon name="settings" size={14} /> {t("Редактировать посещаемость", "Катышууну өзгөртүү")}
              </button>
            )}
            {canEdit && lesson.status === "scheduled" && (
              <>
                <button className="btn" style={{ color: "var(--red-600)" }} onClick={onCancel}>
                  <Icon name="x" size={14} /> {t("Отменить занятие", "Сабакты жокко чыгаруу")}
                </button>
                <button className="btn" onClick={onEdit} title={t("Сменить тренера, длительность", "Тренер, узактык")}>
                  <Icon name="settings" size={14} /> {t("Сменить тренера", "Тренер")}
                </button>
                <button className="btn btn--primary" onClick={onReschedule}>
                  <Icon name="calendar" size={14} /> {t("Перенести занятие", "Сабакты жылдыруу")}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
