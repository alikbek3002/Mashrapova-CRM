import { useEffect, useMemo, useState } from "react";
import { I18N, Icon } from "./data";
import type { Lang, AttStatus } from "./data";
import { useAuth } from "./shared/auth/AuthProvider";
import { useLessons, useLessonRoster, useGroups, useAttendanceForLesson, useChildren, useCoachTabel, useMyPayroll, useMyLivePayroll, useFreezesForLessonDate, useProfile, useLessonNotesForLesson, useLessonNotesForLessons, useMyLessonNotes, useSignedLessonNotePhoto, useGroupRoster, useProgressNotes } from "./shared/api/queries";
import { resolveAvatarUrl } from "./shared/api/avatar";
import { useMarkAttendance, lessonMarkingDeadline, useAddProgressNote } from "./shared/api/mutations";
import { ChildDrawer } from "./admin/ChildDrawer";
import type { AttendanceStatus } from "./shared/types/database";
import { Shell } from "./shared/ui/Shell";
import { AttendanceGrid } from "./shared/ui/AttendanceGrid";
import { ChildAvatar } from "./shared/ui/ChildAvatar";
import { CoachLessonNoteModal } from "./CoachLessonNoteModal";
import { BookModal } from "./admin/PersonalTrainings";
import {
  usePtSessions,
  usePtCompleteSession,
  usePtCancelSession,
  usePtRescheduleSession,
  usePtMyPayroll,
  usePtPendingComments,
  usePtAddCoachComment,
  type PtSessionFull,
} from "./shared/api/pt";
import { DateInput } from "./shared/ui/DateInput";
import { SkeletonRows } from "./shared/ui/Skeleton";
import { Select } from "./shared/ui/Select";
import { TimeInput } from "./shared/ui/TimeInput";

type CoachT = (typeof I18N)["ru"]["coach"];

// Локальная YYYY-MM-DD (важно для UTC+N), чтобы lesson.date в БД (yyyy-mm-dd)
// корректно сопоставлялся с "сегодня"/"завтра" в часовом поясе пользователя.
const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const initialsOf = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export const CoachScreen = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].coach;
  const tt = I18N[lang];
  const { user } = useAuth();
  const [tab, setTab] = useState<"today" | "pt" | "tabel" | "groups" | "salary" | "me">("today");
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);

  if (!user) return null;

  const tabs = [
    { id: "today",  label: tt.coachTabbar.today,                  icon: "today" },
    { id: "pt",     label: lang === "ru" ? "ПТ" : "ЖМ",           icon: "fitness_center" },
    { id: "tabel",  label: tt.coachTabbar.tabel,                  icon: "fact_check" },
    { id: "groups", label: tt.coachTabbar.groups,                 icon: "groups" },
    { id: "salary", label: (tt.coachTabbar as any).salary ?? "Зарплата", icon: "account_balance_wallet" },
    { id: "me",     label: tt.coachTabbar.profile,                icon: "person" },
  ];

  return (
    <Shell
      brand={{ title: lang === "ru" ? "Тренер" : "Тренер", subtitle: "Академия Машрапова" }}
      user={{ name: user.full_name, subtitle: t.hello, avatar: "/icon-192.png" }}
      tabs={tabs}
      active={tab}
      onTab={(id) => { setTab(id as typeof tab); if (id === "today") setActiveLessonId(null); }}
    >
      <div className="m-screen">
        <div className="m-top">
          <div className="m-avatar" style={{ overflow: "hidden", padding: 0 }}>
            <img
              src="/icon-192.png"
              alt="Академия Машрапова"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
          <div className="m-greet">
            <div className="m-greet__hello">{t.hello}</div>
            <div className="m-greet__name">{user.full_name}</div>
          </div>
          <button className="m-bell">
            <Icon name="bell" size={18} />
            <span className="m-bell__dot" />
          </button>
        </div>

        <div className="m-scroll">
          {tab === "today" && !activeLessonId && (
            <CoachToday lang={lang} t={t} setActive={setActiveLessonId} coachId={user.id} />
          )}
          {tab === "today" && activeLessonId && (
            <CoachLessonView lang={lang} t={t} lessonId={activeLessonId} back={() => setActiveLessonId(null)} />
          )}
          {tab === "pt" && <CoachPt lang={lang} coachId={user.id} />}
          {tab === "tabel" && <CoachTabel lang={lang} t={t} coachId={user.id} />}
          {tab === "groups" && <CoachGroups lang={lang} t={t} coachId={user.id} />}
          {tab === "salary" && <CoachSalary lang={lang} />}
          {tab === "me" && <CoachMe lang={lang} userId={user.id} userName={user.full_name} />}
        </div>
      </div>
    </Shell>
  );
};

const CoachToday = ({ lang, t, setActive, coachId }: { lang: Lang; t: CoachT; setActive: (id: string) => void; coachId: string }) => {
  const today = ymd(new Date());
  const tomorrow = ymd(new Date(Date.now() + 86400000));
  // Окно "ближайшего" — следующие 14 дней, чтобы понять, когда занятие.
  const in14 = ymd(new Date(Date.now() + 14 * 86400000));
  const { data: lessons = [] } = useLessons({ from: today, to: today, coachId });
  const { data: tomorrowLessons = [] } = useLessons({ from: tomorrow, to: tomorrow, coachId });
  const { data: upcoming = [] } = useLessons({ from: today, to: in14, coachId });
  // Ближайшее занятие после "сегодня" (для подсказки, когда в эти 2 дня пусто).
  const nextLesson = upcoming.find((l) => l.date > today);

  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "long", day: "numeric", month: "long" });

  const renderLessons = (list: any[], title: string) => (
    <>
      <div className="m-sect">
        <span className="m-sect__title">{title}</span>
      </div>
      {list.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Занятий нет", "Сабак жок")}</div></div>
      ) : list.map((l) => {
        const sec = l.group?.section;
        const title = sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : (l.group?.name ?? "—");
        const isDone = l.status === "completed";
        return (
          <div key={l.id} className="lesson-card" onClick={() => setActive(l.id)}>
            <div className="lesson-card__head">
              <div className="lesson-card__tint" style={{ background: sec?.color ?? "var(--blue)" }} />
              <div style={{ flex: 1 }}>
                <div className="lesson-card__title">{title}</div>
                <div className="lesson-card__meta">{l.group?.name ?? ""}</div>
              </div>
              <div className="lesson-card__time">
                <div className="t">{l.start_time.slice(0, 5)}</div>
                <div className="d">{l.duration_min}м</div>
              </div>
            </div>
            <div className="lesson-card__foot">
              <span className={`lesson-card__state ${isDone ? "" : "lesson-card__state--pending"}`}>
                {isDone ? <><Icon name="check" size={12} stroke={2.5} /> {t.done}</> : t.pending}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );

  return (
    <>
      <div className="summary-pill" style={{ marginTop: 4 }}>
        <div>
          <div className="summary-pill__val">{lessons.length}</div>
          <div className="summary-pill__lbl">{t.lessons}</div>
        </div>
        <div className="summary-pill__sep" />
        <div>
          <div className="summary-pill__val">{tomorrowLessons.length}</div>
          <div className="summary-pill__lbl">{tt("завтра", "эртең")}</div>
        </div>
      </div>
      {renderLessons(lessons, t.today)}
      {tomorrowLessons.length > 0 && renderLessons(tomorrowLessons, tt("Завтра", "Эртең"))}
      {lessons.length === 0 && tomorrowLessons.length === 0 && nextLesson && (
        <div style={{
          marginTop: 12, padding: 12,
          background: "var(--blue-50)", border: "1px solid var(--blue-100)",
          borderRadius: "var(--r-md)", fontSize: 13, color: "var(--blue-ink)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <Icon name="calendar" size={14} />
          <div>
            <div style={{ fontWeight: 600 }}>
              {tt("Ближайшее занятие", "Кийинки сабак")}: {fmtDate(nextLesson.date)} · {nextLesson.start_time.slice(0, 5)}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>
              {(nextLesson as any).group?.name ?? ""}
            </div>
          </div>
        </div>
      )}
      {lessons.length === 0 && tomorrowLessons.length === 0 && !nextLesson && (
        <div style={{
          marginTop: 12, padding: 12,
          background: "var(--bg-soft)", border: "1px solid var(--line)",
          borderRadius: "var(--r-md)", fontSize: 13, color: "var(--muted)",
        }}>
          {tt("В ближайшие 2 недели занятий нет. Возможно, для ваших групп ещё не сгенерировано расписание.",
              "Жакынкы 2 жумада сабак жок. Балким, топторуңузга жадыбал түзүлгөн эмес.")}
        </div>
      )}
    </>
  );
};

// Тренер видит и ставит только Present/Absent. Если ребёнок заморожен —
// кнопки заблокированы и показан бейдж «Заморожен».
type SimpleStatus = "present" | "absent";

const CoachLessonView = ({ lang, t, lessonId, back }: { lang: Lang; t: CoachT; lessonId: string; back: () => void }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: lessonsAll = [] } = useLessons({});
  const lesson = lessonsAll.find((l) => l.id === lessonId);
  // Состав занятия — тот же RPC, что и у офиса в расписании (см.
  // useLessonRoster): по абонементу и отметкам, не только по окну записи.
  const { data: enrollments = [] } = useLessonRoster(lessonId);
  const { data: existing = [] } = useAttendanceForLesson(lessonId);
  const mark = useMarkAttendance();

  const childIds = useMemo(() => enrollments.map((e: any) => e.child_id), [enrollments]);
  const { data: frozenSet = new Set<string>() } = useFreezesForLessonDate(lesson?.date, childIds);

  const [state, setState] = useState<Record<string, SimpleStatus>>({});
  const [activeChildId, setActiveChildId] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<{ id: string; name: string } | null>(null);
  const { data: kids = [] } = useChildren();
  const { data: lessonNotes = [] } = useLessonNotesForLesson(lessonId);
  // Полная карта заметок по ребёнку — нужна не только для бейджа,
  // но и для inline-превью текста под именем ребёнка.
  const noteByChild = useMemo(() => {
    const m = new Map<string, typeof lessonNotes[number]>();
    for (const n of lessonNotes) m.set(n.child_id, n);
    return m;
  }, [lessonNotes]);

  const initialState = useMemo(() => {
    const m: Record<string, SimpleStatus> = {};
    for (const a of existing) {
      // Старые записи могут иметь late/excused/makeup. Маппим в P/A для UI тренера.
      if (a.status === "present" || a.status === "late" || a.status === "makeup") m[a.child_id] = "present";
      else if (a.status === "absent" || a.status === "excused") m[a.child_id] = "absent";
    }
    return m;
  }, [existing]);

  const merged: Record<string, SimpleStatus> = { ...initialState, ...state };

  const setStatus = (childId: string, status: SimpleStatus) => {
    if (frozenSet.has(childId)) return;
    setState((prev) => ({ ...prev, [childId]: status }));
  };
  const markAll = () => {
    const next: Record<string, SimpleStatus> = { ...merged };
    for (const e of enrollments) if (!frozenSet.has((e as any).child_id)) next[(e as any).child_id] = "present";
    setState(next);
  };

  const save = async () => {
    const marks = enrollments
      .filter((e: any) => merged[e.child_id] && !frozenSet.has(e.child_id))
      .map((e: any) => ({ child_id: e.child_id, status: merged[e.child_id] as AttendanceStatus }));
    if (!marks.length) return;
    await mark.mutateAsync({ lessonId, marks });
    back();
  };

  if (!lesson) return <div className="empty"><div className="empty__title">{tt("Не найдено", "Табылган жок")}</div></div>;

  const today = ymd(new Date());
  const isFuture = lesson.date > today;
  // 24h window: coach can mark only until lesson_end + 24h. After that —
  // admin only (the server enforces via RLS; here we mirror to give UX).
  const deadline = lessonMarkingDeadline(
    lesson.date,
    lesson.start_time,
    (lesson as any).duration_min ?? 60,
  );
  const msLeft = deadline.getTime() - Date.now();
  const isClosed = !isFuture && msLeft <= 0;
  const isClosingSoon = !isFuture && !isClosed && msLeft < 4 * 60 * 60 * 1000;
  const hoursLeft = Math.max(1, Math.ceil(msLeft / (60 * 60 * 1000)));
  const sec = (lesson as any).group?.section;
  const title = sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : ((lesson as any).group?.name ?? "—");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0 10px" }}>
        <button className="icon-btn" onClick={back}><Icon name="chevron-left" /></button>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{lesson.date} · {lesson.start_time.slice(0, 5)}</div>
        </div>
      </div>

      {isFuture && (
        <div style={{
          background: "var(--yellow-100)", color: "var(--yellow-ink)",
          border: "1px solid oklch(0.92 0.10 90)", borderRadius: "var(--r-md)",
          padding: 12, fontSize: 13, marginBottom: 12, display: "flex", gap: 8,
        }}>
          <Icon name="warn" size={16} />
          {tt("Это занятие ещё не прошло. Посещения можно будет отметить после его даты.",
              "Бул сабак өткөн жок. Катышуу датасынан кийин гана белгилене алат.")}
        </div>
      )}

      {isClosed && (
        <div style={{
          background: "var(--red-50, #fef2f2)", color: "var(--red-ink, #991b1b)",
          border: "1px solid var(--red-200, #fecaca)", borderRadius: "var(--r-md)",
          padding: 12, fontSize: 13, marginBottom: 12, display: "flex", gap: 8,
        }}>
          <Icon name="warn" size={16} />
          {tt("Окно отметки закрыто (24 ч после занятия). Обратитесь к администратору.",
              "Белгилөө терезеси жабылды (сабактан кийин 24 саат). Администраторго кайрылыңыз.")}
        </div>
      )}

      {isClosingSoon && (
        <div style={{
          background: "var(--yellow-100)", color: "var(--yellow-ink)",
          border: "1px solid oklch(0.92 0.10 90)", borderRadius: "var(--r-md)",
          padding: 12, fontSize: 13, marginBottom: 12, display: "flex", gap: 8,
        }}>
          <Icon name="clock" size={16} />
          {tt(`До закрытия отметки осталось ~${hoursLeft} ч.`,
              `Белгилөөгө ~${hoursLeft} с. калды.`)}
        </div>
      )}

      <button
        className="btn btn--accent"
        style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: 13 }}
        onClick={markAll}
        disabled={isFuture || isClosed}
      >
        <Icon name="check" size={15} /> {t.markAll}
      </button>

      <div className="m-sect" style={{ paddingTop: 16 }}>
        <span className="m-sect__title">{tt("Список детей", "Балдардын тизмеси")} · {enrollments.length}</span>
      </div>

      {enrollments.map((e: any) => {
        const k = e.child;
        if (!k) return null;
        const isFrozen = frozenSet.has(k.id);
        const status = merged[k.id];
        const disabled = isFuture || isFrozen || isClosed;
        const note = noteByChild.get(k.id);
        return (
          <div key={k.id} className="roster-block">
            <div className="roster-row">
              <ChildAvatar
                className="m-avatar"
                style={{ width: 36, height: 36, fontSize: 12, cursor: "pointer" }}
                photoPath={k.photo_path}
                fullName={k.full_name}
                onClick={() => setActiveChildId(k.id)}
              />
              <div onClick={() => setActiveChildId(k.id)} style={{ cursor: "pointer", flex: 1, minWidth: 0 }}>
                <div className="roster-row__name">
                  {k.full_name}
                </div>
                <div className="roster-row__meta">{k.card_number ?? ""}</div>
              </div>
              {isFrozen ? (
                <span
                  className="pill pill--frozen"
                  title={tt("Заморозка установлена менеджером", "Менеджер тарабынан тындырылган")}
                  style={{ marginRight: 6 }}
                >
                  {tt("Заморожен", "Тындырылган")}
                </span>
              ) : (
                <div className="status-pick">
                  <button
                    className={`status-pick__btn sp-present ${status === "present" ? "is-active" : ""}`}
                    onClick={() => !disabled && setStatus(k.id, "present")}
                    aria-label={I18N[lang].status.present}
                    disabled={disabled}
                    style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                  >
                    <Icon name="check" size={13} stroke={2.5} />
                  </button>
                  <button
                    className={`status-pick__btn sp-absent ${status === "absent" ? "is-active" : ""}`}
                    onClick={() => !disabled && setStatus(k.id, "absent")}
                    aria-label={I18N[lang].status.absent}
                    disabled={disabled}
                    style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
                  >
                    <Icon name="x" size={13} stroke={2.5} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="btn coach-note-btn"
                title={isFuture
                  ? tt("Заметку можно оставить после занятия", "Сабактан кийин гана жазма калтыруу")
                  : note
                  ? tt("Редактировать заметку", "Жазманы өзгөртүү")
                  : tt("Заметка для родителя", "Ата-эне үчүн эскертүү")}
                onClick={() => !isFuture && setNoteFor({ id: k.id, name: k.full_name })}
                disabled={isFuture}
                data-has-note={note ? "1" : undefined}
                style={{
                  marginLeft: 6, height: 32, padding: "0 10px", gap: 6, fontSize: 12,
                  whiteSpace: "nowrap",
                  opacity: isFuture ? 0.4 : 1,
                  cursor: isFuture ? "not-allowed" : "pointer",
                  ...(note && !isFuture
                    ? { background: "var(--green-50, #ecfdf5)", color: "var(--green-ink, #065f46)", borderColor: "var(--green-200, #a7f3d0)" }
                    : {}),
                }}
              >
                <Icon name="note" size={14} />
                {note ? tt("Заметка", "Эскертүү") : tt("+ Заметка", "+ Эскертүү")}
              </button>
            </div>
            {note && (
              <button
                type="button"
                className="roster-note"
                onClick={() => !isFuture && setNoteFor({ id: k.id, name: k.full_name })}
                disabled={isFuture}
              >
                <div className="roster-note__head">
                  <Icon name="note" size={11} stroke={2.5} />
                  <span>{tt("Заметка тренера", "Тренердин жазмасы")}</span>
                  <span className="roster-note__edit">
                    {tt("Редактировать", "Өзгөртүү")}
                  </span>
                </div>
                <div className="roster-note__text">{note.text}</div>
                {note.photo_paths && note.photo_paths.length > 0 && (
                  <div className="roster-note__photos-meta">
                    {note.photo_paths.length} {tt("фото", "сүрөт")}
                  </div>
                )}
              </button>
            )}
          </div>
        );
      })}

      <button className="btn btn--primary"
        style={{ width: "100%", justifyContent: "center", padding: "14px", marginTop: 16, fontSize: 14 }}
        onClick={save}
        disabled={mark.isPending || isFuture || isClosed}
        title={isFuture
          ? tt("Занятие ещё не прошло", "Сабак өткөн жок")
          : isClosed
            ? tt("Окно отметки закрыто", "Белгилөө терезеси жабылды")
            : ""}
      >
        <Icon name="check" size={16} /> {mark.isPending ? "…" : t.save}
      </button>

      {activeChildId && (
        <ChildDrawer
          childId={activeChildId}
          child={kids.find((k) => k.id === activeChildId)}
          open={!!activeChildId}
          onClose={() => setActiveChildId(null)}
          lang={lang}
        />
      )}

      {noteFor && (
        <CoachLessonNoteModal
          open={!!noteFor}
          onClose={() => setNoteFor(null)}
          lang={lang}
          lessonId={lessonId}
          childId={noteFor.id}
          childName={noteFor.name}
        />
      )}
    </>
  );
};

const CoachTabel = ({ lang, t, coachId }: { lang: Lang; t: CoachT; coachId: string }) => {
  // Для шапки карточки ребёнка (ФИО, семья, комментарий) — как на вкладке «Сегодня».
  const { data: tabelKids = [] } = useChildren();
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  // Период — текущий месяц по умолчанию, со стрелками вперёд/назад.
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
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

  const { data, isLoading } = useCoachTabel(coachId, periodRange);
  // Тяжёлый запрос на период чтобы знать start_time/duration_min — нужно
  // для расчёта 24-часового окна отметки тренера в picker'е ниже.
  const { data: lessonsInPeriod = [] } = useLessons(periodRange);
  const lessonById = useMemo(() => {
    const m = new Map<string, { date: string; start_time: string; duration_min: number }>();
    for (const l of lessonsInPeriod as any[]) {
      m.set(l.id, { date: l.date, start_time: l.start_time, duration_min: l.duration_min ?? 60 });
    }
    return m;
  }, [lessonsInPeriod]);
  const mark = useMarkAttendance();
  const [picker, setPicker] = useState<{ child_id: string; child_name: string; date: string; lesson_id: string; current: string | null; isFuture: boolean; isClosed: boolean } | null>(null);
  const [noteFor, setNoteFor] = useState<{ lesson_id: string; child_id: string; child_name: string } | null>(null);
  // Клик по имени в табеле — карточка ребёнка.
  const [openKidId, setOpenKidId] = useState<string | null>(null);
  // Какая группа сейчас активна в табеле. По умолчанию — первая группа
  // тренера; сбрасывается при подгрузке данных (см. useEffect ниже).
  // "all" доступен как опция в свитчере, но не по умолчанию — иначе
  // непонятно, какие занятия к какой группе относятся.
  const [activeGroupId, setActiveGroupId] = useState<string>("");

  const todayStr = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
  }, []);

  // Тренеру доступны только Present/Absent — остальные статусы (excused/late/makeup)
  // редактирует менеджер в админке.
  const STATUSES: ("present" | "absent")[] = ["present", "absent"];
  const STATUS_META: Record<AttendanceStatus, { bg: string; fg: string; icon: string }> = {
    present: { bg: "var(--green)",        fg: "#fff",            icon: "check" },
    absent:  { bg: "var(--red)",          fg: "#fff",            icon: "x" },
    late:    { bg: "var(--yellow)",       fg: "var(--yellow-ink)", icon: "clock" },
    excused: { bg: "var(--blue)",         fg: "#fff",            icon: "warn" },
    makeup:  { bg: "var(--bg-soft)",      fg: "var(--ink)",      icon: "download" },
  };

  const onPick = async (status: "present" | "absent") => {
    if (!picker) return;
    try {
      await mark.mutateAsync({
        lessonId: picker.lesson_id,
        marks: [{ child_id: picker.child_id, status: status as AttendanceStatus }],
      });
      setPicker(null);
    } catch {
      // toast already shown
    }
  };

  // Все lesson_ids из табеля — чтобы одним запросом вытянуть, в каких
  // ячейках уже есть заметка тренера.
  const allLessonIds = useMemo(() => {
    if (!data?.grid) return [] as string[];
    const set = new Set<string>();
    for (const row of data.grid.values()) {
      for (const cell of row.values()) {
        const c = cell as { lesson_id: string };
        if (c.lesson_id) set.add(c.lesson_id);
      }
    }
    return Array.from(set);
  }, [data?.grid]);
  const { data: notesMap = new Map<string, Set<string>>() } = useLessonNotesForLessons(allLessonIds);

  const fmtMonth = (year: number, month: number) =>
    new Date(year, month, 1).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { month: "long", year: "numeric" });
  const monthLabel = fmtMonth(cursor.year, cursor.month);
  const goPrev = () => setCursor(({ year, month }) => month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 });
  const goNext = () => setCursor(({ year, month }) => month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 });
  const goToday = () => {
    const n = new Date();
    setCursor({ year: n.getFullYear(), month: n.getMonth() });
  };

  const journalHead = (
    <div className="journal-head">
      <div className="journal-head__title">{tt("Журнал группы", "Топ журналы")}</div>
      <div className="journal-head__nav">
        <button type="button" className="journal-nav-btn" onClick={goPrev} aria-label={tt("Прошлый месяц", "Өткөн ай")}>
          <Icon name="chevron-left" size={18} stroke={2.25} />
        </button>
        <div className="journal-head__month">{monthLabel}</div>
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
  );

  const { kids = [], dates = [], grid, groupsCount = 0, enrollmentsCount = 0, groups: tabelGroups = [], groupsByChild = new Map<string, Set<string>>(), lessonsByGroup = new Map<string, Set<string>>(), frozenByChild = new Map<string, Set<string>>(), removedByChild = new Map<string, Set<string>>(), metaByChild, windowByChild } = data ?? { kids: [], dates: [], grid: new Map(), groupsCount: 0, enrollmentsCount: 0 } as any;

  // ВАЖНО: этот useEffect ДО любых early-return — иначе при первой
  // загрузке (isLoading=true) хук не вызывается, а после загрузки
  // вызывается → React падает с error #310.
  useEffect(() => {
    const list = tabelGroups as Array<{ id: string; name: string }>;
    if (list.length === 0) return;
    if (activeGroupId === "all") return;
    if (!activeGroupId || !list.some((g) => g.id === activeGroupId)) {
      setActiveGroupId(list[0]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabelGroups.length]);

  if (isLoading) return (
    <>
      {journalHead}
      <SkeletonRows rows={4} />
    </>
  );

  if (kids.length === 0 || dates.length === 0) {
    let emptyTitle: string;
    let emptyHint: string;
    if (groupsCount === 0) {
      emptyTitle = tt("У вас пока нет групп", "Сизде топ жок");
      emptyHint = tt("Менеджер должен назначить вас на группу.", "Менеджер сизди топко дайындашы керек.");
    } else if (enrollmentsCount === 0) {
      emptyTitle = tt("В ваших группах пока нет учеников", "Топторуңузда окуучу жок");
      emptyHint = tt("Попросите менеджера добавить детей в группу.", "Менеджерден балдарды кошуусун сураныңыз.");
    } else {
      emptyTitle = tt("В этом месяце занятий нет", "Бул айда сабак жок");
      emptyHint = tt("Переключите месяц стрелками.", "Айды баскычтар менен которуңуз.");
    }
    return (
      <>
        {journalHead}
        <div className="empty">
          <div className="empty__title">{emptyTitle}</div>
          <div>{emptyHint}</div>
        </div>
      </>
    );
  }

  // При нескольких группах — фильтруем kids+dates по выбранной группе.
  // "all" показывает всех (когда групп ≤ 1 или тренер сам так выбрал).
  const filteredKids = activeGroupId === "all"
    ? kids
    : (kids as Array<{ id: string; full_name: string; photo_path: string | null }>).filter(
        (k) => (groupsByChild as Map<string, Set<string>>).get(k.id)?.has(activeGroupId)
      );
  const filteredDates = activeGroupId === "all"
    ? dates
    : (dates as string[]).filter(
        (d) => (lessonsByGroup as Map<string, Set<string>>).get(activeGroupId)?.has(d)
      );

  return (
    <>
      {journalHead}

      {/* Переключатель групп: показываем только если их >1 у тренера. */}
      {(tabelGroups as Array<{ id: string; name: string }>).length > 1 && (
        <div className="coach-tabel-groups">
          <button
            type="button"
            className={`coach-tabel-groups__btn ${activeGroupId === "all" ? "is-active" : ""}`}
            onClick={() => setActiveGroupId("all")}
          >
            {tt("Все группы", "Бардык топтор")}
          </button>
          {(tabelGroups as Array<{ id: string; name: string }>).map((g) => (
            <button
              key={g.id}
              type="button"
              className={`coach-tabel-groups__btn ${activeGroupId === g.id ? "is-active" : ""}`}
              onClick={() => setActiveGroupId(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <AttendanceGrid
        lang={lang}
        kids={filteredKids}
        dates={filteredDates}
        grid={grid}
        todayStr={todayStr}
        notesMap={notesMap}
        frozenByChild={frozenByChild}
        removedByChild={removedByChild}
        metaByChild={metaByChild}
        windowByChild={windowByChild}
        onKidClick={(k) => setOpenKidId(k.id)}
        onCellClick={(c) => {
          let isClosed = false;
          if (!c.isFuture && c.lesson_id) {
            const meta = lessonById.get(c.lesson_id);
            if (meta) {
              const dl = lessonMarkingDeadline(meta.date, meta.start_time, meta.duration_min);
              isClosed = Date.now() > dl.getTime();
            }
          }
          setPicker({ ...c, isClosed });
        }}
      />

      {picker && (
        <div
          onClick={() => !mark.isPending && setPicker(null)}
          className="journal-picker__backdrop"
        >
          <div onClick={(e) => e.stopPropagation()} className="journal-picker">
            <div className="journal-picker__head">
              <div className="journal-picker__name">{picker.child_name}</div>
              <div className="journal-picker__date">
                {new Date(picker.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </div>
              {picker.isFuture && (
                <div className="journal-picker__future-hint">
                  <Icon name="clock" size={13} stroke={2.25} />
                  {tt("Занятие ещё не прошло — статус доступен после даты.", "Сабак өткөн жок — статус датадан кийин.")}
                </div>
              )}
              {picker.isClosed && (
                <div className="journal-picker__future-hint">
                  <Icon name="warn" size={13} stroke={2.25} />
                  {tt("Окно отметки закрыто (24 ч после занятия). Обратитесь к администратору.",
                      "Белгилөө терезеси жабылды. Администраторго кайрылыңыз.")}
                </div>
              )}
            </div>
            {!picker.isFuture && !picker.isClosed && (
              <div className="journal-picker__grid">
                {STATUSES.map((s) => {
                  const meta = STATUS_META[s];
                  const isActive = picker.current === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onPick(s)}
                      disabled={mark.isPending}
                      className={`journal-picker__btn ${isActive ? "is-active" : ""} jp-${s}`}
                    >
                      <span className="journal-picker__icon">
                        <Icon name={meta.icon} size={18} stroke={2.5} />
                      </span>
                      {I18N[lang].status[s]}
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="journal-picker__note-btn"
              onClick={() => {
                setNoteFor({ lesson_id: picker.lesson_id, child_id: picker.child_id, child_name: picker.child_name });
                setPicker(null);
              }}
              disabled={mark.isPending || picker.isFuture}
              title={picker.isFuture
                ? tt("Занятие ещё не прошло — заметку можно оставить после занятия", "Сабак өткөн жок — кийин жазма калтырыңыз")
                : ""}
              style={picker.isFuture ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              <Icon name="note" size={16} stroke={2.25} />
              {tt("Написать заметку родителю", "Ата-энеге эскертүү жазуу")}
            </button>
            <button
              type="button"
              className="btn btn--ghost journal-picker__cancel"
              onClick={() => setPicker(null)}
              disabled={mark.isPending}
            >
              {tt("Отмена", "Жокко чыгаруу")}
            </button>
          </div>
        </div>
      )}

      {noteFor && (
        <CoachLessonNoteModal
          open={!!noteFor}
          onClose={() => setNoteFor(null)}
          lang={lang}
          lessonId={noteFor.lesson_id}
          childId={noteFor.child_id}
          childName={noteFor.child_name}
        />
      )}

      {openKidId && (
        <ChildDrawer
          childId={openKidId}
          child={tabelKids.find((k) => k.id === openKidId)}
          open={!!openKidId}
          onClose={() => setOpenKidId(null)}
          lang={lang}
        />
      )}
    </>
  );
};

const CoachGroups = ({ lang, t, coachId }: { lang: Lang; t: CoachT; coachId: string }) => {
  const { data: groups = [] } = useGroups();
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const myGroups = groups.filter((g) => g.coach_id === coachId);
  const [openGroup, setOpenGroup] = useState<{ id: string; name: string } | null>(null);

  return (
    <>
      <div className="m-sect" style={{ paddingTop: 6 }}>
        <span className="m-sect__title">{t.myGroups} · {myGroups.length}</span>
      </div>
      {myGroups.length === 0 && <div className="empty"><div className="empty__title">{tt("Групп нет", "Топ жок")}</div></div>}
      {myGroups.map((g) => {
        const sec = (g as any).section;
        return (
          <button
            key={g.id}
            type="button"
            className="group-card group-card--tap"
            onClick={() => setOpenGroup({ id: g.id, name: g.name })}
          >
            <div className="group-card__tint" style={{ background: sec?.color ?? "var(--blue)" }} />
            <div style={{ paddingLeft: 8, flex: 1 }}>
              <div className="group-card__title">{g.name}</div>
              <div className="group-card__sub">{sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : ""}</div>
              <div className="group-card__stats">
                <div className="group-card__stat">
                  <div className="v">{g.max_capacity}</div>
                  <div className="l">{tt("мест", "орун")}</div>
                </div>
                <div className="group-card__stat">
                  <div className="v">{g.duration_min}</div>
                  <div className="l">{tt("мин", "мин")}</div>
                </div>
              </div>
            </div>
            <span className="group-card__chev">
              <Icon name="chevron-right" size={18} stroke={2.25} />
            </span>
          </button>
        );
      })}
      {openGroup && (
        <CoachGroupRosterSheet
          lang={lang}
          coachId={coachId}
          group={openGroup}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </>
  );
};

// Список детей группы: тренер тапает по карточке группы и видит состав
// (срок абонемента + остаток занятий), а тап по ребёнку открывает
// заметки о прогрессе — то, что видит родитель в приложении.
const CoachGroupRosterSheet = ({
  lang, coachId, group, onClose,
}: {
  lang: Lang; coachId: string; group: { id: string; name: string }; onClose: () => void;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: kids = [], isLoading, error } = useGroupRoster(group.id);
  const [noteKid, setNoteKid] = useState<{ id: string; name: string } | null>(null);
  const todayStr = ymd(new Date());
  const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

  return (
    <>
      <div className="journal-picker__backdrop" onClick={onClose}>
        <div className="journal-picker coach-roster" onClick={(e) => e.stopPropagation()}>
          <div className="journal-picker__head">
            <div className="journal-picker__name">{group.name}</div>
            <div className="journal-picker__date">
              {tt("Ученики", "Окуучулар")} · {kids.length} · {tt("тап по ребёнку — заметка о прогрессе", "баланы басыңыз — прогресс жазмасы")}
            </div>
          </div>
          {isLoading ? (
            <SkeletonRows rows={4} />
          ) : error ? (
            <div className="empty">
              <div className="empty__title">{tt("Не удалось загрузить список", "Тизме жүктөлгөн жок")}</div>
              <div>{(error as Error).message}</div>
            </div>
          ) : kids.length === 0 ? (
            <div className="empty"><div className="empty__title">{tt("В группе пока нет учеников", "Топто окуучу жок")}</div></div>
          ) : (
            <div className="coach-roster__list">
              {kids.map((k) => {
                const ended = !!k.cardEnd && k.cardEnd < todayStr;
                return (
                  <button
                    key={k.id}
                    type="button"
                    className="coach-roster__row"
                    onClick={() => setNoteKid({ id: k.id, name: k.full_name })}
                  >
                    <div className="journal__av">{(k.full_name[0] || "?").toUpperCase()}</div>
                    <div className="coach-roster__info">
                      <div className="coach-roster__name">{k.full_name}</div>
                      <div className={`coach-roster__meta${ended ? " is-ended" : ""}`}>
                        {k.cardStart && k.cardEnd
                          ? `${shortDate(k.cardStart)} – ${shortDate(k.cardEnd)}`
                          : tt("Без абонемента", "Абонементсиз")}
                        {k.remaining != null &&
                          ` · ${tt(`осталось ${k.remaining}`, `калды ${k.remaining}`)}${k.total ? ` ${tt("из", "/")} ${k.total}` : ""}`}
                      </div>
                    </div>
                    <Icon name="note" size={16} stroke={2} />
                  </button>
                );
              })}
            </div>
          )}
          <button type="button" className="btn btn--ghost journal-picker__cancel" onClick={onClose}>
            {tt("Закрыть", "Жабуу")}
          </button>
        </div>
      </div>
      {noteKid && (
        <CoachProgressNoteSheet
          lang={lang}
          coachId={coachId}
          kid={noteKid}
          onClose={() => setNoteKid(null)}
        />
      )}
    </>
  );
};

// Заметки о прогрессе ребёнка (progress_notes): видны родителю.
// RLS: тренер пишет от своего имени и видит только свои заметки.
const CoachProgressNoteSheet = ({
  lang, coachId, kid, onClose,
}: {
  lang: Lang; coachId: string; kid: { id: string; name: string }; onClose: () => void;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: notes = [] } = useProgressNotes(kid.id);
  const add = useAddProgressNote();
  const [text, setText] = useState("");

  const save = () => {
    const v = text.trim();
    if (!v || add.isPending) return;
    add.mutate(
      { child_id: kid.id, coach_id: coachId, text: v },
      { onSuccess: () => setText("") },
    );
  };

  return (
    <div className="journal-picker__backdrop" onClick={() => !add.isPending && onClose()}>
      <div className="journal-picker coach-roster" onClick={(e) => e.stopPropagation()}>
        <div className="journal-picker__head">
          <div className="journal-picker__name">{kid.name}</div>
          <div className="journal-picker__date">{tt("Прогресс и примечания — видны родителю", "Прогресс жана эскертүүлөр — ата-энеге көрүнөт")}</div>
        </div>
        <textarea
          className="input coach-roster__ta"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tt("Например: сделал первый мост, хорошо тянется, работаем над колесом…", "Мисалы: биринчи көпүрөнү жасады, жакшы созулат…")}
        />
        {add.isError && (
          <div className="coach-roster__err">{tt("Не удалось сохранить: ", "Сакталган жок: ")}{(add.error as Error).message}</div>
        )}
        <button
          type="button"
          className="btn btn--primary coach-roster__save"
          onClick={save}
          disabled={add.isPending || !text.trim()}
        >
          {add.isPending ? tt("Сохраняю…", "Сакталууда…") : tt("Сохранить заметку", "Жазманы сактоо")}
        </button>
        <div className="coach-roster__notes">
          {notes.length === 0 && (
            <div className="coach-roster__empty">{tt("Ваших заметок по этому ребёнку пока нет", "Бул бала боюнча жазмаңыз жок")}</div>
          )}
          {notes.map((n) => (
            <div key={n.id} className="coach-roster__note">
              <div className="coach-roster__note-date">
                {new Date(n.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "2-digit", month: "long", year: "numeric" })}
              </div>
              <div>{n.text}</div>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--ghost journal-picker__cancel" onClick={onClose} disabled={add.isPending}>
          {tt("Закрыть", "Жабуу")}
        </button>
      </div>
    </div>
  );
};

// Профиль тренера: компактная карточка с аватаром + история его заметок.
// Зарплата вынесена в отдельный таб (CoachSalary), здесь — только профиль.
const CoachMe = ({ lang, userId, userName }: { lang: Lang; userId: string; userName: string }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: profile } = useProfile(userId);
  const { signOut } = useAuth();
  const avatar = resolveAvatarUrl(profile?.avatar_url);
  const { data: myNotes = [] } = useMyLessonNotes(userId, 50);
  const [viewNote, setViewNote] = useState<typeof myNotes[number] | null>(null);

  return (
    <div className="coach-me">
      <div className="coach-me__card">
        <div className="coach-me__avatar">
          {initialsOf(userName)}
          {avatar && (
            <img
              src={avatar}
              alt=""
              referrerPolicy="no-referrer"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}
        </div>
        <div className="coach-me__meta">
          <div className="coach-me__name">{userName}</div>
          <div className="coach-me__role">{tt("Тренер", "Тренер")}</div>
          {profile?.phone && (
            <div className="coach-me__phone">
              <Icon name="phone" size={12} /> {profile.phone}
            </div>
          )}
        </div>
      </div>

      <div className="m-sect" style={{ paddingTop: 8 }}>
        <span className="m-sect__title">{tt("Мои заметки", "Жазмаларым")}</span>
        <span className="m-sect__more" style={{ color: "var(--muted)" }}>
          {myNotes.length} {tt("шт.", "даана")}
        </span>
      </div>

      {myNotes.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{tt("Заметок пока нет", "Жазма жок")}</div>
          <div>{tt("Заметки появятся здесь после того, как вы напишете их в журнале.",
                  "Журналда жазма калтыргандан кийин бул жерден көрөсүз.")}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {myNotes.map((n) => (
            <button
              key={n.id}
              type="button"
              className="coach-mynote"
              onClick={() => setViewNote(n)}
            >
              <div className="coach-mynote__head">
                <div className="coach-mynote__child">
                  {n.child?.full_name ?? "—"}
                </div>
                <div className="coach-mynote__date">
                  {n.lesson?.date
                    ? new Date(n.lesson.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "2-digit", month: "short" })
                    : ""}
                </div>
              </div>
              <div className="coach-mynote__text">{n.text}</div>
              {n.photo_paths && n.photo_paths.length > 0 && (
                <div className="coach-mynote__photos">
                  <Icon name="note" size={11} /> {n.photo_paths.length} {tt("фото", "сүрөт")}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="coach-me__logout"
        onClick={() => signOut()}
      >
        <Icon name="x" size={14} stroke={2.5} />
        {tt("Выйти из аккаунта", "Аккаунттан чыгуу")}
      </button>

      {viewNote && (
        <CoachViewNote note={viewNote} lang={lang} onClose={() => setViewNote(null)} />
      )}
    </div>
  );
};

// Просмотр одной заметки тренера (read-only — для редактирования
// существующей записи откройте журнал и тапните по ячейке).
const CoachViewNote = ({ note, lang, onClose }: { note: any; lang: Lang; onClose: () => void }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const dt = note.lesson?.date
    ? new Date(note.lesson.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "";
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "var(--r-lg)", width: "100%", maxWidth: 420,
          padding: 18, display: "flex", flexDirection: "column", gap: 12,
          maxHeight: "80vh", overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16 }}>
            {note.child?.full_name ?? tt("Заметка", "Жазма")}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{dt}</div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5, color: "var(--ink)" }}>{note.text}</div>
        {note.photo_paths && note.photo_paths.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {note.photo_paths.map((p: string) => (
              <CoachNotePhoto key={p} path={p} />
            ))}
          </div>
        )}
        <button className="btn" onClick={onClose} style={{ alignSelf: "flex-end" }}>
          {tt("Закрыть", "Жабуу")}
        </button>
      </div>
    </div>
  );
};

const CoachNotePhoto = ({ path }: { path: string }) => {
  const { data: url } = useSignedLessonNotePhoto(path);
  if (!url) return <div style={{ width: 96, height: 96, background: "var(--bg-soft)", borderRadius: 8 }} />;
  return (
    <img
      src={url}
      alt=""
      style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
    />
  );
};

// Зарплата — отдельный таб. Накапало (по факту present) + прогноз до конца месяца.
const CoachSalary = ({ lang }: { lang: Lang }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Курсор по месяцам: 0 — текущий, +1 — следующий, -1 — прошлый.
  // Тренер листает вперёд, чтобы видеть прогноз по июню/июлю, не дожидаясь
  // их наступления (карты-абонементы часто переползают из мая в июнь).
  const [monthOffset, setMonthOffset] = useState(0);
  const now = new Date();
  const cursor = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const isCurrent = monthOffset === 0;
  const start = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const end = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const { data: pay } = useMyPayroll(start, end);
  // Текущий месяц — без параметра (быстрее, идёт через view).
  // Другие месяцы — передаём period_start, backend пересчитает через RPC.
  const { data: live } = useMyLivePayroll(isCurrent ? undefined : start);
  const total = pay ? Number(pay.computed_amount) + Number(pay.manual_adjustment ?? 0) : 0;
  const status = pay?.status ?? "draft";
  const statusLabel =
    status === "paid" ? tt("Выплачено", "Төлөнгөн")
    : status === "advance_paid" ? tt("Аванс выдан", "Аванс берилди")
    : tt("Начислено", "Эсептелди");
  const liveActual = live ? Number(live.actual_amount) : 0;
  const liveVisits = live ? Number(live.visits_count ?? 0) : 0;
  // Факт за сегодня: пришедшие дети × ставка группы (только текущий месяц).
  const todayAmount = isCurrent && live ? Number(live.today_amount ?? 0) : 0;
  const todayVisits = isCurrent && live ? Number(live.today_visits ?? 0) : 0;
  const todayGroups = isCurrent && live ? (live.today_groups ?? []) : [];
  const liveMax = live ? Number((live as any).max_amount ?? live.projected_amount + live.actual_amount) : 0;
  const liveRemaining = Math.max(0, liveMax - liveActual);
  const pct = liveMax > 0 ? Math.min(100, Math.round((liveActual / liveMax) * 100)) : 0;
  const monthLabel = cursor.toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { month: "long", year: "numeric" });
  // Для подписи под суммой — название месяца в родительном падеже («мая», «июня»).
  // Берём `month: "long"` без года и приводим в нижний регистр.
  const monthOnly = cursor.toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { month: "long" });

  return (
    <div className="coach-salary">
      <div className="coach-salary__hero">
        <div className="coach-salary__period" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <button
            type="button"
            className="journal-nav-btn"
            onClick={() => setMonthOffset((v) => v - 1)}
            aria-label={tt("Прошлый месяц", "Өткөн ай")}
          >
            <Icon name="chevron-left" size={16} stroke={2.25} />
          </button>
          <span style={{ textTransform: "capitalize" }}>{monthLabel}</span>
          <button
            type="button"
            className="journal-nav-btn"
            onClick={() => setMonthOffset((v) => v + 1)}
            aria-label={tt("Следующий месяц", "Кийинки ай")}
          >
            <Icon name="chevron-right" size={16} stroke={2.25} />
          </button>
        </div>
        <div className="coach-salary__amount">
          {liveActual.toLocaleString("ru-RU")} <span>с</span>
        </div>
        <div className="coach-salary__sub">
          {tt(
            `заработано за ${monthOnly} по факту · потолок месяца ${liveMax.toLocaleString("ru-RU")} с`,
            `${monthOnly} боюнча факт · айдын максимуму ${liveMax.toLocaleString("ru-RU")} с`,
          )}
        </div>
        <div className="coach-salary__progress">
          <div className="coach-salary__progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="coach-salary__progress-meta">
          <span>{pct}% {tt("получено", "алынды")}</span>
          <span>{tt(`ещё ${liveRemaining.toLocaleString("ru-RU")} с до максимума`, `максимумга ${liveRemaining.toLocaleString("ru-RU")} с калды`)}</span>
        </div>
      </div>

      {isCurrent && (
        <div className="coach-salary__row" style={{ background: "var(--green-50, oklch(0.96 0.05 150))", borderRadius: "var(--r-sm)" }}>
          <div className="coach-salary__row-key">
            <b>{tt("Сегодня", "Бүгүн")}</b> · {todayVisits} {tt("детей", "бала")}
            {todayGroups.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {todayGroups.map((g) => `${g.name}: ${g.visits}`).join(" · ")}
              </div>
            )}
          </div>
          <div className="coach-salary__row-val" style={{ color: "var(--green)" }}><b>{todayAmount.toLocaleString("ru-RU")} с</b></div>
        </div>
      )}
      <div className="coach-salary__row">
        <div className="coach-salary__row-key">
          {tt("Посещений за месяц", "Айга катышуу")}
        </div>
        <div className="coach-salary__row-val">{liveVisits.toLocaleString("ru-RU")}</div>
      </div>
      <div className="coach-salary__row">
        <div className="coach-salary__row-key">
          {tt("Уже заработано (по present)", "Учурда табылды")}
        </div>
        <div className="coach-salary__row-val">{liveActual.toLocaleString("ru-RU")} с</div>
      </div>
      <div className="coach-salary__row">
        <div className="coach-salary__row-key">
          {tt(`Максимум до конца ${monthOnly}`, `${monthOnly} аягына чейин максимум`)}
        </div>
        <div className="coach-salary__row-val">{liveMax.toLocaleString("ru-RU")} с</div>
      </div>

      {pay && total > 0 && (
        <div className="coach-salary__committed">
          <span>{statusLabel}</span>
          <b>{total.toLocaleString("ru-RU")} с</b>
        </div>
      )}

      <div className="coach-salary__note">
        {tt(
          `«Максимум до конца ${monthOnly}» — потолок: если каждый ребёнок придёт на все запланированные занятия этого месяца. Абонементы часто тянутся через несколько месяцев, поэтому пролистай вперёд, чтобы увидеть прогноз по следующему месяцу. «Уже заработано» растёт с каждой отметкой «Пришёл». Если ребёнок пропустил — ставка за это занятие пропадает, не переносится.`,
          `«${monthOnly} аягына чейин максимум» — ар бир бала пландалган сабактардын баарына катышса болот. Абонементтер бир канча айга жайылат, кийинки айды көрүү үчүн алдыга өтүңүз. «Учурда табылды» — «Келди» белгилеген сайын өсөт. Бала келбей койсо — ал сабак үчүн ставка кошулбайт.`,
        )}
      </div>
    </div>
  );
};

// ============================================================
// ПЕРСОНАЛЬНЫЕ ТРЕНИРОВКИ ТРЕНЕРА (§5, §6, §16, §19, §20)
// ============================================================
const CoachPt = ({ lang, coachId }: { lang: Lang; coachId: string }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const today = ymd(new Date());
  const weekAgo = ymd(new Date(Date.now() - 7 * 86400000));
  const in14 = ymd(new Date(Date.now() + 14 * 86400000));
  const { data: sessions = [] } = usePtSessions({ from: weekAgo, to: in14, coach_id: coachId });
  const { data: pay } = usePtMyPayroll();
  const { data: pending = [] } = usePtPendingComments();
  const [bookOpen, setBookOpen] = useState(false);
  const [activeSession, setActiveSession] = useState<PtSessionFull | null>(null);
  const [commentFor, setCommentFor] = useState<(typeof pending)[number] | null>(null);

  const upcoming = sessions
    .filter((s) => s.status === "scheduled" && s.date >= today)
    .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time));
  const needMark = sessions
    .filter((s) => s.status === "scheduled" && s.date < today)
    .sort((a, b) => (b.date + b.start_time).localeCompare(a.date + a.start_time));
  const todayList = upcoming.filter((s) => s.date === today);
  const future = upcoming.filter((s) => s.date > today);

  const fmtD = (s: string) =>
    new Date(s + "T00:00:00").toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "short", day: "numeric", month: "short" });

  const sessionCard = (s: PtSessionFull, highlight = false) => (
    <button
      key={s.id}
      className="lesson-card"
      style={{ width: "100%", textAlign: "left", marginBottom: 8, border: highlight ? "1px solid var(--red-600)" : undefined }}
      onClick={() => setActiveSession(s)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>
            {s.lessons.map((l) => l.child?.full_name?.split(" ")[0] ?? "").join(", ")}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            {s.service?.name} · {fmtD(s.date)} · {s.start_time.slice(0, 5)} · {s.duration_min}′
          </div>
        </div>
        {highlight ? (
          <span className="pill pill--debt">{tt("Отметить!", "Белгилөө!")}</span>
        ) : (
          <Icon name="chevron_right" size={16} />
        )}
      </div>
    </button>
  );

  return (
    <>
      {/* §16: система требует комментарий каждые 10 тренировок */}
      {pending.length > 0 && (
        <div style={{ background: "var(--red-50, #fef2f2)", border: "1px solid var(--red-600)", borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
            {tt("Требуется комментарий по итогам тренировок", "Машыгуулар боюнча комментарий керек")}
          </div>
          {pending.map((p) => {
            const childName = Array.isArray(p.child) ? p.child[0]?.full_name : p.child?.full_name;
            return (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 13 }}>
                  <b>{childName ?? "—"}</b> · {p.lessons_used}/{p.lessons_total}
                </span>
                <button className="btn btn--primary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setCommentFor(p)}>
                  {tt("Написать", "Жазуу")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Зарплата по ПТ: свои + замены (§20) */}
      {pay && Number(pay.total_sessions) > 0 && (
        <div style={{ background: "var(--bg-soft)", borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{tt("ПТ за этот месяц", "Бул айдагы ЖМ")}</div>
          <div>{tt("Свои", "Өз")}: <b>{pay.own_sessions}</b> · {Math.round(Number(pay.own_amount)).toLocaleString("ru-RU")} с</div>
          <div>{tt("Замены", "Алмаштыруу")}: <b>{pay.sub_sessions}</b> · {Math.round(Number(pay.sub_amount)).toLocaleString("ru-RU")} с</div>
          <div style={{ marginTop: 4 }}>
            {tt("Итого", "Жыйынтык")}: <b>{pay.total_sessions}</b> {tt("трен.", "маш.")} ·{" "}
            <b>{Math.round(Number(pay.total_amount)).toLocaleString("ru-RU")} с</b>
          </div>
        </div>
      )}

      <button className="btn btn--primary" style={{ width: "100%", marginBottom: 12 }} onClick={() => setBookOpen(true)}>
        <Icon name="plus" size={14} /> {tt("Записать клиента", "Кардарды жазуу")}
      </button>

      {needMark.length > 0 && (
        <>
          <div className="m-sect"><span className="m-sect__title">{tt("Не отмечены", "Белгиленген эмес")}</span></div>
          {needMark.map((s) => sessionCard(s, true))}
        </>
      )}

      <div className="m-sect"><span className="m-sect__title">{tt("Сегодня", "Бүгүн")}</span></div>
      {todayList.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Сегодня персональных нет", "Бүгүн жеке машыгуу жок")}</div></div>
      ) : (
        todayList.map((s) => sessionCard(s))
      )}

      <div className="m-sect"><span className="m-sect__title">{tt("Ближайшие", "Жакынкы")}</span></div>
      {future.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Записей нет", "Жазуулар жок")}</div></div>
      ) : (
        future.map((s) => sessionCard(s))
      )}

      {bookOpen && <BookModal open onClose={() => setBookOpen(false)} lang={lang} fixedCoachId={coachId} />}
      {activeSession && (
        <CoachPtSessionModal session={activeSession} onClose={() => setActiveSession(null)} lang={lang} />
      )}
      {commentFor && (
        <CoachPtCommentModal pendingItem={commentFor} onClose={() => setCommentFor(null)} lang={lang} />
      )}
    </>
  );
};

const CoachPtSessionModal = ({
  session,
  onClose,
  lang,
}: {
  session: PtSessionFull;
  onClose: () => void;
  lang: Lang;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const complete = usePtCompleteSession();
  const cancel = usePtCancelSession();
  const reschedule = usePtRescheduleSession();
  const [mode, setMode] = useState<"view" | "complete" | "cancel" | "reschedule">("view");
  const [marks, setMarks] = useState<Record<string, "attended" | "missed">>(
    Object.fromEntries(session.lessons.map((l) => [l.id, "attended" as const]))
  );
  const [reason, setReason] = useState("");
  const [newDate, setNewDate] = useState(session.date);
  const [newTime, setNewTime] = useState(session.start_time.slice(0, 5));
  const [err, setErr] = useState<string | null>(null);
  const busy = complete.isPending || cancel.isPending || reschedule.isPending;

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 250, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 16, width: "100%", maxWidth: 420, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
          {session.service?.name}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          {new Date(session.date + "T00:00:00").toLocaleDateString("ru-RU")} · {session.start_time.slice(0, 5)} ·{" "}
          {session.lessons.map((l) => l.child?.full_name ?? "").join(", ")}
        </div>

        {mode === "view" && (
          <div style={{ display: "grid", gap: 8 }}>
            <button className="btn btn--primary" onClick={() => setMode("complete")}>
              {tt("Провести тренировку", "Машыгууну өткөрүү")}
            </button>
            <button className="btn" onClick={() => setMode("reschedule")}>{tt("Перенести", "Которуу")}</button>
            <button className="btn btn--ghost" style={{ color: "var(--red-600)" }} onClick={() => setMode("cancel")}>
              {tt("Отменить", "Жокко чыгаруу")}
            </button>
          </div>
        )}

        {mode === "complete" && (
          <>
            {session.lessons.map((l) => (
              <div key={l.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                <span style={{ flex: 1, fontSize: 14 }}>{l.child?.full_name}</span>
                <Select
                  value={marks[l.id]}
                  onChange={(e) => setMarks((m) => ({ ...m, [l.id]: e.target.value as "attended" | "missed" }))}
                >
                  <option value="attended">{tt("✓ Пришёл", "✓ Келди")}</option>
                  <option value="missed">{tt("Неявка (списать)", "Келген жок")}</option>
                </Select>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setMode("view")}>{tt("Назад", "Артка")}</button>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() =>
                  run(() =>
                    complete.mutateAsync({
                      session_id: session.id,
                      attendance: session.lessons.map((l) => ({ lesson_id: l.id, status: marks[l.id] ?? "attended", charge: true })),
                      source: "coach",
                    })
                  )
                }
              >
                {busy ? "…" : tt("Провести", "Өткөрүү")}
              </button>
            </div>
          </>
        )}

        {(mode === "cancel" || mode === "reschedule") && (
          <>
            {mode === "reschedule" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <DateInput value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                <TimeInput value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              </div>
            )}
            <textarea
              rows={2}
              placeholder={tt("Причина (обязательно)", "Себеби (милдеттүү)")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => setMode("view")}>{tt("Назад", "Артка")}</button>
              <button
                className="btn btn--primary"
                style={{ flex: 1 }}
                disabled={busy || !reason.trim()}
                onClick={() =>
                  run(() =>
                    mode === "cancel"
                      ? cancel.mutateAsync({ session_id: session.id, reason: reason.trim() })
                      : reschedule.mutateAsync({ session_id: session.id, new_date: newDate, new_time: newTime, reason: reason.trim() })
                  )
                }
              >
                {mode === "cancel" ? tt("Отменить", "Жокко чыгаруу") : tt("Перенести", "Которуу")}
              </button>
            </div>
          </>
        )}

        {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}
      </div>
    </div>
  );
};

const CoachPtCommentModal = ({
  pendingItem,
  onClose,
  lang,
}: {
  pendingItem: { id: string; next_milestone: number; child: { full_name: string } | { full_name: string }[] | null };
  onClose: () => void;
  lang: Lang;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = usePtAddCoachComment();
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const childName = Array.isArray(pendingItem.child) ? pendingItem.child[0]?.full_name : pendingItem.child?.full_name;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 250, padding: 16 }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 16, width: "100%", maxWidth: 420 }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
          {tt("Комментарий по итогам", "Жыйынтык боюнча комментарий")} · {childName ?? ""}
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
          {tt(`После ${pendingItem.next_milestone} тренировок — опишите прогресс клиента. Комментарий сохранится в карточке.`,
              `${pendingItem.next_milestone} машыгуудан кийин — кардардын прогрессин жазыңыз.`)}
        </div>
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} style={{ width: "100%" }} maxLength={2000} />
        {err && <div className="field__error" style={{ marginTop: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn" style={{ flex: 1 }} onClick={onClose}>{tt("Позже", "Кийин")}</button>
          <button
            className="btn btn--primary"
            style={{ flex: 1 }}
            disabled={add.isPending || text.trim().length < 3}
            onClick={async () => {
              setErr(null);
              try {
                await add.mutateAsync({ package_id: pendingItem.id, milestone: pendingItem.next_milestone, text: text.trim() });
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            {add.isPending ? "…" : tt("Сохранить", "Сактоо")}
          </button>
        </div>
      </div>
    </div>
  );
};
