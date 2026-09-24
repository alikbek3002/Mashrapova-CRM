import { useMemo, useState } from "react";
import { I18N, Icon } from "./data";
import type { Lang } from "./data";
import { useAuth } from "./shared/auth/AuthProvider";
import {
  useChildren, useCardBalance, useCardBalances, useChildLessons, useProgressNotes,
  useAttendanceForChild, useOrganization, useFreezesForChild,
  useProfile, useChildPrimaryCoach,
  useNotifications, useUnreadNotificationsCount,
  useLessonNotesForParent, useSignedLessonNotePhoto,
  useDepositBalance, useDepositHistory,
  type LessonNoteFeed,
} from "./shared/api/queries";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useCreateFreeze } from "./shared/api/mutations";
import { usePtPackages, usePtSessions } from "./shared/api/pt";
import { Modal, Field } from "./shared/ui/Modal";
import { ChildDrawer } from "./admin/ChildDrawer";
import { Shell } from "./shared/ui/Shell";
import { ChildAvatar, EditableChildAvatar } from "./shared/ui/ChildAvatar";

type ParentT = (typeof I18N)["ru"]["parent"];

const initialsOf = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const ageFromDob = (dob: string) => {
  const d = new Date(dob); const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return Math.max(0, a);
};
// ВАЖНО: считаем дату в локали браузера, а не в UTC. У родителей в Бишкеке
// (UTC+6) после полуночи `toISOString()` ещё возвращает вчерашнюю дату —
// today-индикатор на календаре уезжал на день назад, и пользователи думали,
// что у ребёнка появилось «занятие в четверг».
const ymd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

type TabId = "home" | "schedule" | "card" | "deposit" | "stats" | "notes" | "profile";

export const ParentScreen = ({ lang }: { lang: Lang }) => {
  const t = I18N[lang].parent;
  const tt = I18N[lang];
  const { user } = useAuth();
  const { data: kids = [] } = useChildren();
  const { data: unreadCount = 0 } = useUnreadNotificationsCount();
  const [activeKidIdx, setActiveKidIdx] = useState(0);
  const [tab, setTab] = useState<TabId>("home");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  if (!user) return null;
  const kid = kids[activeKidIdx];

  const tabs = [
    { id: "home",     label: tt.tabbar.home,     icon: "home" },
    { id: "schedule", label: tt.tabbar.schedule, icon: "calendar_month" },
    { id: "card",     label: (tt.tabbar as any).card ?? "Абонемент", icon: "credit_card" },
    { id: "deposit",  label: (tt.tabbar as any).deposit ?? (lang === "ru" ? "Счёт" : "Эсеп"), icon: "account_balance_wallet" },
    { id: "stats",    label: tt.tabbar.stats,    icon: "emoji_events" },
    { id: "notes",    label: (tt.tabbar as any).notes ?? "Заметки", icon: "edit_note" },
    { id: "profile",  label: tt.tabbar.profile,  icon: "person" },
  ];

  return (
    <Shell
      brand={{ title: lang === "ru" ? "Родитель" : "Ата-эне", subtitle: "Академия Машрапова" }}
      user={{ name: user.full_name, subtitle: t.hello, avatar: initialsOf(user.full_name) }}
      tabs={tabs}
      active={tab}
      onTab={(id) => setTab(id as TabId)}
    >
      <div className="m-screen">
        <div className="m-top">
          <div className="m-avatar" style={{ background: "var(--yellow)", color: "var(--yellow-ink)" }}>
            {initialsOf(user.full_name)}
          </div>
          <div className="m-greet">
            <div className="m-greet__hello">{t.hello}</div>
            <div className="m-greet__name">{user.full_name} 👋</div>
          </div>
          <button className="m-bell" onClick={() => setNotifOpen(true)} title={lang === "ru" ? "Уведомления" : "Эскертүүлөр"}>
            <Icon name="bell" size={18} />
            {unreadCount > 0 && (
              <span
                className="m-bell__dot"
                style={{
                  width: "auto", height: 16, minWidth: 16, padding: "0 4px",
                  borderRadius: 8, background: "var(--red-600)", color: "#fff",
                  fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center",
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Kid switcher — only if multiple kids */}
        {kids.length > 1 && (
          <div className="kid-switch">
            {kids.map((k, i) => (
              <button key={k.id} className={`kid-chip ${i === activeKidIdx ? "is-active" : ""}`} onClick={() => setActiveKidIdx(i)}>
                <ChildAvatar className="kid-chip__av" photoPath={(k as any).photo_path} fullName={k.full_name} />
                <span className="kid-chip__name">{k.full_name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        )}

        <div className="m-scroll">
          {!kid ? (
            <div className="empty"><div className="empty__title">{lang === "ru" ? "Дети не привязаны" : "Балдар жок"}</div></div>
          ) : (
            <>
              {tab === "home" && <ParentHome lang={lang} t={t} kid={kid} onOpenCard={() => setDrawerOpen(true)} />}
              {tab === "schedule" && <ParentSchedule lang={lang} t={t} kid={kid} />}
              {tab === "card" && <ParentCard lang={lang} t={t} kid={kid} />}
              {tab === "deposit" && <ParentDeposit lang={lang} kid={kid} />}
              {tab === "stats" && <ParentAttendanceCalendar lang={lang} kid={kid} />}
              {tab === "notes" && <ParentNotes lang={lang} kid={kid} />}
              {tab === "profile" && <ParentProfile lang={lang} t={t} kid={kid} />}
            </>
          )}
        </div>

        {kid && drawerOpen && (
          <ChildDrawer
            childId={kid.id}
            child={kid}
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            lang={lang}
          />
        )}

        <ParentNotificationsPanel
          open={notifOpen}
          onClose={() => setNotifOpen(false)}
          lang={lang}
        />
      </div>
    </Shell>
  );
};

// =====================================================================
// Home — overview
// =====================================================================
const ParentHome = ({ lang, t, kid, onOpenCard }: { lang: Lang; t: ParentT; kid: any; onOpenCard: () => void }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: balance } = useCardBalance(kid.id);
  const today = ymd(new Date());
  const in14 = ymd(new Date(Date.now() + 14 * 86400000));
  const { data: lessons = [] } = useChildLessons(kid.id, { from: today, to: in14 });
  const { data: notes = [] } = useProgressNotes(kid.id);
  const { data: manager } = useProfile(kid.responsible_manager_id ?? null);
  const { data: primaryCoach } = useChildPrimaryCoach(kid.id);

  const pct = balance && balance.total_lessons ? Math.round(((balance.remaining ?? 0) / balance.total_lessons) * 100) : 0;
  const next = lessons[0];

  return (
    <>
      <div className="kid-hero" onClick={onOpenCard} style={{ cursor: "pointer" }}>
        <div className="kid-hero__top">
          <EditableChildAvatar
            className="kid-hero__face"
            style={{ background: "var(--blue)" }}
            childId={kid.id}
            photoPath={(kid as any).photo_path}
            fullName={kid.full_name}
            canEdit
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="kid-hero__name">{kid.full_name}</div>
            <div className="kid-hero__sub">
              {ageFromDob(kid.birth_date)} {tt("лет", "жаш")} · {kid.card_number ?? "—"}
            </div>
          </div>
          <Icon name="chevron-right" size={20} />
        </div>
        <div className="kid-hero__stats">
          <div className="kid-hero__stat">
            <div className="kid-hero__stat-label">{t.lessonsLeft}</div>
            <div className="kid-hero__stat-value">
              {balance?.remaining ?? "—"}
              {balance?.total_lessons && <small>{t.of} {balance.total_lessons}</small>}
            </div>
            <div className="kid-hero__bar">
              <div className="kid-hero__bar-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="kid-hero__stat">
            <div className="kid-hero__stat-label">{tt("Статус", "Абалы")}</div>
            <div className="kid-hero__stat-value" style={{ fontSize: 18 }}>
              <span className={`pill pill--${kid.status}`}>{kid.status}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Менеджер и тренер ребёнка */}
      <div className="m-sect" style={{ paddingTop: 8 }}>
        <span className="m-sect__title">{tt("Контакты по ребёнку", "Бала боюнча байланыш")}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 }}>
        <ContactRow
          icon="user"
          label={tt("Менеджер", "Менеджер")}
          name={manager?.full_name}
          phone={manager?.phone ?? null}
          empty={tt("не назначен", "дайындалган эмес")}
        />
        <ContactRow
          icon="whistle"
          label={tt("Тренер", "Тренер")}
          name={primaryCoach?.full_name}
          phone={primaryCoach?.phone ?? null}
          empty={tt("не назначен", "дайындалган эмес")}
        />
      </div>

      {next && (
        <>
          <div className="m-sect"><span className="m-sect__title">{t.nextLesson}</span></div>
          <div className="next-card">
            <div className="next-card__when">
              <div className="wd">{new Date(next.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "short" })}</div>
              <div className="d">{new Date(next.date).getDate()}</div>
            </div>
            <div className="next-card__main">
              <div className="next-card__title">
                <span className="section-dot" style={{ background: "var(--blue)" }} />
                {(next as any).group?.section?.name_ru ?? (next as any).group?.name ?? "—"}
              </div>
              <div className="next-card__meta">{(next as any).coach?.full_name ?? ""}</div>
              <div style={{ fontSize: 11, color: "var(--blue)", fontWeight: 600, marginTop: 4 }}>{next.start_time.slice(0, 5)}</div>
            </div>
          </div>
        </>
      )}

      {notes.length > 0 && (
        <>
          <div className="m-sect"><span className="m-sect__title">{tt("От тренера", "Тренерден")}</span></div>
          {notes.slice(0, 2).map((n) => (
            <div key={n.id} className="coach-note">
              <div className="coach-note__head">{tt("Заметка", "Жазма")}</div>
              <div className="coach-note__text">{n.text}</div>
              <div className="coach-note__sig">— {n.coach?.full_name ?? ""}, {new Date(n.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
};

// =====================================================================
// Schedule — next 14 days, сгруппировано по датам, без мусора
// =====================================================================
const ParentSchedule = ({ lang, t, kid }: { lang: Lang; t: ParentT; kid: any }) => {
  const today = ymd(new Date());
  const in14 = ymd(new Date(Date.now() + 14 * 86400000));
  // Только занятия, попадающие в окно абонемента ребёнка по его группе.
  const { data: lessons = [] } = useChildLessons(kid?.id, { from: today, to: in14 });
  // Персональные тренировки ребёнка — в общем расписании (ПТ §4, §17)
  const { data: ptSessions = [] } = usePtSessions({ from: today, to: in14, child_id: kid?.id });
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  type DayEntry = { key: string; time: string; title: string; coachName: string | null; color: string; isPt: boolean };

  // Группируем по дате: одна дата = одна шапка, под ней — занятия (групповые + ПТ).
  const byDate = useMemo(() => {
    const m = new Map<string, DayEntry[]>();
    const push = (date: string, e: DayEntry) => {
      const arr = m.get(date) ?? [];
      arr.push(e);
      m.set(date, arr);
    };
    for (const l of lessons) {
      const sec = (l as any).group?.section;
      push(l.date, {
        key: `l-${l.id}`,
        time: l.start_time,
        title: sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : ((l as any).group?.name ?? "—"),
        coachName: (l as any).coach?.full_name ?? null,
        color: sec?.color ?? "var(--blue)",
        isPt: false,
      });
    }
    for (const s of ptSessions) {
      if (s.status !== "scheduled") continue;
      push(s.date, {
        key: `pt-${s.id}`,
        time: s.start_time,
        title: `${tt("Персональная", "Жеке машыгуу")} · ${s.service?.name ?? ""}`,
        coachName: s.actual_coach?.full_name ?? s.coach?.full_name ?? null,
        color: "var(--yellow-600, #ca8a04)",
        isPt: true,
      });
    }
    for (const arr of m.values()) arr.sort((a, b) => a.time.localeCompare(b.time));
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, ptSessions, lang]);

  const totalCount = lessons.length + ptSessions.filter((s) => s.status === "scheduled").length;

  const fmtDayHeader = (d: string) => {
    const dt = new Date(d);
    const wd = dt.toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "long" });
    const dm = dt.toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "numeric", month: "long" });
    return { wd: wd.charAt(0).toUpperCase() + wd.slice(1), dm };
  };
  const isToday = (d: string) => d === today;
  const isWeekend = (d: string) => {
    const dow = new Date(d).getDay();
    return dow === 0 || dow === 6;
  };

  return (
    <>
      <div className="m-sect" style={{ paddingTop: 6 }}>
        <span className="m-sect__title">{t.schedule}</span>
        <span className="m-sect__more" style={{ color: "var(--muted)" }}>
          {tt(`${totalCount} занятий`, `${totalCount} сабак`)}
        </span>
      </div>

      {totalCount === 0 ? (
        <div className="empty">
          <div className="empty__title">{tt("На ближайшие 2 недели занятий нет", "Жакынкы 2 жумада сабак жок")}</div>
        </div>
      ) : (
        <div className="psched">
          {byDate.map(([date, items]) => {
            const h = fmtDayHeader(date);
            return (
              <div key={date} className={`psched__day ${isToday(date) ? "is-today" : ""} ${isWeekend(date) ? "is-weekend" : ""}`}>
                <div className="psched__day-head">
                  <div className="psched__day-num">{new Date(date).getDate()}</div>
                  <div className="psched__day-meta">
                    <div className="psched__day-wd">{h.wd}</div>
                    <div className="psched__day-dm">{h.dm}</div>
                  </div>
                  {isToday(date) && <span className="psched__badge">{tt("Сегодня", "Бүгүн")}</span>}
                </div>
                <div className="psched__lessons">
                  {items.map((e) => (
                    <div key={e.key} className="psched__lesson">
                      <span className="psched__tint" style={{ background: e.color }} />
                      <div className="psched__lesson-main">
                        <div className="psched__lesson-title">{e.title}</div>
                        {e.coachName && (
                          <div className="psched__lesson-meta">
                            <Icon name="whistle" size={11} /> {e.coachName}
                          </div>
                        )}
                      </div>
                      <div className="psched__lesson-time">{e.time.slice(0, 5)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

// =====================================================================
// Card — subscription details + freezes
// =====================================================================
const ParentCard = ({ lang, t, kid }: { lang: Lang; t: ParentT; kid: any }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: cards = [] } = useCardBalances(kid.id);
  const { data: freezes = [] } = useFreezesForChild(kid.id);
  const { data: ptPackages = [] } = usePtPackages({ child_id: kid.id });
  const fmtDate = (s: string | null | undefined) =>
    s ? new Date(s).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const activeCards = cards.filter((c) => c.status === "active" || c.status === "ending" || c.status === "frozen");
  const historyCards = cards.filter((c) => !(c.status === "active" || c.status === "ending" || c.status === "frozen"));

  // Заморозку оформляет только офис (менеджер/директор) — родитель видит
  // статус и историю, но кнопки запроса больше нет (запрос клиента).
  const today = ymd(new Date());
  const activeFreeze = freezes.find((f: any) =>
    f.status === "approved" && today >= f.start_date && today <= f.end_date,
  );

  return (
    <>
      <div className="m-sect" style={{ paddingTop: 6 }}>
        <span className="m-sect__title">{tt("Текущие абонементы", "Учурдагы абонементтер")}</span>
      </div>

      {activeFreeze && (
        <div style={{
          background: "oklch(0.94 0.06 25)",
          border: "1px solid oklch(0.78 0.10 25)",
          color: "oklch(0.35 0.12 25)",
          borderRadius: "var(--r-md)",
          padding: "10px 14px",
          margin: "8px 0",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, fontWeight: 600,
        }}>
          <span style={{ fontSize: 18 }} aria-hidden="true">❄</span>
          {tt(
            `Заморозка активна: ${fmtDate(activeFreeze.start_date)} — ${fmtDate(activeFreeze.end_date)}. Эти дни не списываются, абонемент продлён.`,
            `Тындыруу активдүү: ${fmtDate(activeFreeze.start_date)} — ${fmtDate(activeFreeze.end_date)}. Бул күндөр эсептелбейт, абонемент узартылат.`,
          )}
        </div>
      )}

      {activeCards.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Активного абонемента нет", "Активдүү абонемент жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {activeCards.map((c) => (
            <div key={c.club_card_id} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{tt("Тип", "Түрү")}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, marginTop: 2 }}>{c.type}</div>
                </div>
                <span className={`pill pill--${c.status}`}>{c.status}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.lessonsLeft}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700 }}>
                    {c.remaining ?? "—"}{c.total_lessons && <small style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}> / {c.total_lessons}</small>}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.validUntil}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>{fmtDate(c.end_date)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Пакеты персональных тренировок (ПТ §17: клиент видит остаток после списания) */}
      {ptPackages.length > 0 && (
        <>
          <div className="m-sect"><span className="m-sect__title">{tt("Персональные тренировки", "Жеке машыгуулар")}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ptPackages
              .filter((p) => !["refunded", "annulled"].includes(p.status))
              .map((p) => {
                const stLbl =
                  p.status === "active" ? tt("Действующий", "Активдүү")
                  : p.status === "awaiting_activation" ? tt("Ожидает активации", "Активацияны күтөт")
                  : p.status === "purchased" ? tt("Куплен", "Сатылды")
                  : p.status === "completed" ? tt("Завершен", "Аяктады")
                  : p.status === "expired" ? tt("Истёк", "Мөөнөтү бүттү")
                  : tt("Заблокирован", "Бөгөттөлгөн");
                const stCls =
                  p.status === "active" ? "active"
                  : p.status === "completed" || p.status === "expired" ? "expired"
                  : p.status === "blocked" ? "frozen" : "frozen";
                return (
                  <div key={p.id} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {tt("Персональные", "Жеке машыгуу")}
                        </div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, marginTop: 2 }}>
                          {p.service?.name ?? "—"}
                        </div>
                      </div>
                      <span className={`pill pill--${stCls}`}>{stLbl}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{tt("Осталось тренировок", "Калган машыгуулар")}</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 24, fontWeight: 700 }}>
                          {p.lessons_total - p.lessons_used}
                          <small style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}> / {p.lessons_total}</small>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, color: "var(--muted)" }}>{t.validUntil}</div>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>{fmtDate(p.expires_at)}</div>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {tt("Тренер", "Тренер")}: <b>{p.coach?.full_name ?? "—"}</b>
                      {Number(p.paid) < Number(p.price) && (
                        <span style={{ color: "var(--red-600)", marginLeft: 8 }}>
                          {tt("Долг", "Карыз")}: <b>{(Number(p.price) - Number(p.paid)).toLocaleString("ru-RU")} с</b>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {historyCards.length > 0 && (
        <>
          <div className="m-sect"><span className="m-sect__title">{tt("История абонементов", "Абонементтер тарыхы")}</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {historyCards.map((c) => (
              <div key={c.club_card_id} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.type}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmtDate(c.start_date)} — {fmtDate(c.end_date)}</div>
                </div>
                <span className={`pill pill--${c.status}`}>{c.status}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="m-sect"><span className="m-sect__title">{tt("История заморозок", "Тындыруулар")}</span></div>
      {freezes.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Заморозок не было", "Тындыруулар жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {freezes.map((f: any) => (
            <div key={f.id} style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {fmtDate(f.start_date)} — {fmtDate(f.end_date)}
                </div>
                <span className={`pill pill--${f.status === "approved" ? "active" : f.status === "pending" ? "frozen" : "expired"}`}>
                  {f.status === "approved" ? tt("Активна", "Активдүү") : f.status === "pending" ? tt("Ожидает", "Күтүүдө") : tt("Завершена", "Бүттү")}
                </span>
              </div>
              {f.reason && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>{f.reason}</div>}
            </div>
          ))}
        </div>
      )}

    </>
  );
};

// =====================================================================
// Deposit — баланс счёта + история операций (read-only для родителя).
// =====================================================================
const ParentDeposit = ({ lang, kid }: { lang: Lang; kid: any }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: balance = 0 } = useDepositBalance(kid.id);
  const { data: history = [] } = useDepositHistory(kid.id, 50);
  const { data: org } = useOrganization();
  const fmt = (v: number) =>
    new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v) + " с";

  const typeLabel = (type: string) => {
    switch (type) {
      case "top_up": return tt("Пополнение", "Толтуруу");
      case "withdraw": return tt("Вывод", "Чыгаруу");
      case "card_purchase": return tt("Покупка абонемента", "Абонемент сатып алуу");
      case "card_renewal": return tt("Продление абонемента", "Абонемент узартуу");
      case "refund_in": return tt("Возврат", "Кайтаруу");
      case "service_charge": return tt("Услуга", "Кызмат");
      case "adjustment": return tt("Корректировка", "Корректировка");
      default: return type;
    }
  };
  const typeColor = (type: string): string => {
    if (type === "top_up" || type === "refund_in") return "var(--green)";
    if (type === "withdraw" || type === "card_purchase" || type === "card_renewal" || type === "service_charge")
      return "var(--red-600)";
    return "var(--muted)";
  };

  const waLink = (() => {
    const phone = org?.whatsapp_number ?? "";
    const digits = phone.replace(/[^0-9]/g, "");
    if (!digits) return null;
    const text = encodeURIComponent(
      tt(
        `Здравствуйте! Хочу пополнить счёт ${kid.full_name}.`,
        `Салам! ${kid.full_name} эсебин толтургум келет.`,
      ),
    );
    return `https://wa.me/${digits}?text=${text}`;
  })();

  return (
    <div className="m-section">
      <div style={{
        padding: "20px 22px", background: "var(--surface)",
        border: "1px solid var(--line)", borderRadius: "var(--r-md)",
        display: "flex", flexDirection: "column", gap: 6, marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{tt("Текущий баланс", "Учурдагы баланс")}</div>
        <div style={{
          fontSize: 32, fontWeight: 700, fontFamily: "var(--font-display)",
          color: balance > 0 ? "var(--green)" : "var(--ink)",
        }}>
          {fmt(balance)}
        </div>
      </div>

      {waLink && (
        <a href={waLink} target="_blank" rel="noreferrer" className="btn btn--primary" style={{ marginBottom: 14, justifyContent: "center" }}>
          <Icon name="whatsapp" size={14} /> {tt("Запросить пополнение", "Толтурууну сурануу")}
        </a>
      )}

      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
        {tt("Операции", "Операциялар")}
      </div>
      {history.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Операций пока нет", "Операциялар жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {history.map((tx) => {
            const color = typeColor(tx.type);
            const sign = Number(tx.amount) > 0 ? "+" : "";
            return (
              <div key={tx.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 12px", background: "var(--surface)",
                border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{typeLabel(tx.type)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {new Date(tx.paid_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "numeric", month: "short" })}
                    {tx.comment ? " · " + tx.comment : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color, fontWeight: 700, fontSize: 14 }}>{sign}{fmt(Number(tx.amount))}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{fmt(Number(tx.balance_after))}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// =====================================================================
// Attendance calendar — month-by-month with colored dots per day
// =====================================================================
const ParentAttendanceCalendar = ({ lang, kid }: { lang: Lang; kid: any }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [monthOffset, setMonthOffset] = useState(0);
  const { data: att = [] } = useAttendanceForChild(kid.id, 180);
  // «Предстоит» — остаток занятий по действующим картам (с учётом заморозок).
  const { data: kidBalances = [] } = useCardBalances(kid.id);
  const upcoming = kidBalances
    .filter((b: any) => ["active", "ending", "frozen"].includes(b.status))
    .reduce((s: number, b: any) => s + Math.max(0, Number(b.remaining ?? 0)), 0);

  const refDate = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const monthName = refDate.toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { month: "long", year: "numeric" });
  const year = refDate.getFullYear();
  const month = refDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // First day offset (Mon = 0)
  const firstOffset = (new Date(year, month, 1).getDay() + 6) % 7;

  // Доп. запрос — занятия видимого месяца, СТРОГО внутри окна
  // абонемента ребёнка (по enrollment.start_date..end_date). Так на
  // календаре не показываем занятия за пределами абонемента, даже если
  // расписание группы сгенерировано далеко вперёд.
  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const { data: monthLessons = [] } = useChildLessons(kid?.id, { from: monthStart, to: monthEnd });
  const todayStr = ymd(new Date());

  // Map "yyyy-mm-dd" → status (фактическая отметка) и set предстоящих
  // дат, где есть занятие у группы этого ребёнка.
  const byDay = new Map<string, string>();
  for (const a of att) {
    const d = (a.lesson?.date ?? "").slice(0, 10);
    if (!d) continue;
    byDay.set(d, a.status);
  }
  const scheduledDays = new Set<string>();
  for (const l of monthLessons as Array<{ date: string; status: string }>) {
    if (l.status === "cancelled" || l.status === "force_majeure") continue;
    if (l.date < todayStr) continue;            // прошлое — у нас уже из attendance
    if (byDay.has(l.date)) continue;            // уже есть отметка — не дублируем
    scheduledDays.add(l.date);
  }

  const cellColor = (s: string | undefined) => {
    if (!s) return "transparent";
    if (s === "present" || s === "late" || s === "makeup") return "var(--green)";
    if (s === "absent") return "var(--red)";
    if (s === "excused") return "var(--yellow)";
    return "var(--muted)";
  };

  // Stats for the visible month
  const inMonth = att.filter((a) => {
    const d = a.lesson?.date ?? "";
    return d.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`);
  });
  const present = inMonth.filter((a) => a.status === "present" || a.status === "late" || a.status === "makeup").length;
  const absent = inMonth.filter((a) => a.status === "absent").length;
  const total = inMonth.length;

  type Cell = { day: number; date: string; status: string | undefined; scheduled: boolean };
  const cells: (Cell | null)[] = [];
  for (let i = 0; i < firstOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ day, date, status: byDay.get(date), scheduled: scheduledDays.has(date) });
  }

  const wd = lang === "ru" ? ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"] : ["Дш","Ше","Ша","Бш","Жм","Иш","Жк"];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 12px" }}>
        <button className="icon-btn" onClick={() => setMonthOffset(monthOffset - 1)}><Icon name="chevron-left" /></button>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, textTransform: "capitalize" }}>{monthName}</div>
        <button className="icon-btn" onClick={() => setMonthOffset(monthOffset + 1)}><Icon name="chevron-right" /></button>
      </div>

      <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, fontSize: 11, color: "var(--muted)", textAlign: "center", marginBottom: 4 }}>
          {wd.map((w) => <div key={w}>{w}</div>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {cells.map((c, i) => {
            if (!c) return <div key={i} style={{ aspectRatio: "1", opacity: 0 }} />;
            const isToday = c.date === ymd(new Date());
            const filled = !!c.status;
            return (
              <div key={i} style={{
                aspectRatio: "1", display: "grid", placeItems: "center",
                borderRadius: 6,
                background: filled ? cellColor(c.status) : "transparent",
                color: filled ? "#fff" : "var(--ink)",
                fontWeight: filled ? 700 : 500,
                fontSize: 13,
                border: c.scheduled
                  ? "1.5px dashed var(--blue)"
                  : isToday ? "1.5px solid var(--blue)" : "1.5px solid transparent",
                position: "relative",
              }}>
                {c.day}
                {c.scheduled && (
                  <span style={{
                    position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)",
                    width: 4, height: 4, borderRadius: "50%", background: "var(--blue)",
                  }} />
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, background: "var(--green)", borderRadius: 3 }} /> {tt("Был", "Болду")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, background: "var(--red)", borderRadius: 3 }} /> {tt("Пропустил", "Калтырды")}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 12, height: 12, border: "1.5px dashed var(--blue)", borderRadius: 3 }} /> {tt("Предстоит", "Болот")}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12, background: "#fff", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: 12 }}>
        <div className="summary-pill">
          <div>
            <div className="summary-pill__val" style={{ color: "var(--green)" }}>{present}</div>
            <div className="summary-pill__lbl">{tt("Был", "Болду")}</div>
          </div>
          <div className="summary-pill__sep" />
          <div>
            <div className="summary-pill__val" style={{ color: "var(--red)" }}>{absent}</div>
            <div className="summary-pill__lbl">{tt("Пропустил", "Калтырды")}</div>
          </div>
          <div className="summary-pill__sep" />
          <div>
            <div className="summary-pill__val" style={{ color: "var(--blue)" }}>{upcoming}</div>
            <div className="summary-pill__lbl">{tt("Предстоит", "Алдыда")}</div>
          </div>
          <div className="summary-pill__sep" />
          <div>
            <div className="summary-pill__val">{total > 0 ? `${Math.round((present / total) * 100)}%` : "—"}</div>
            <div className="summary-pill__lbl">{tt("Посещ.", "Катышуу")}</div>
          </div>
        </div>
      </div>
    </>
  );
};

// =====================================================================
// Notes — feed заметок тренера к занятиям (с фото)
// Фильтруем по активному ребёнку, чтобы родитель видел заметки именно по нему.
// =====================================================================
const ParentNotes = ({ lang, kid }: { lang: Lang; kid: any }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: feed = [], isLoading } = useLessonNotesForParent();
  const { data: notifications = [] } = useNotifications(100);
  const markRead = useMarkNotificationRead();
  const notes = feed.filter((n) => n.child_id === kid.id);

  // Соответствие note.id → notification (если есть). Уведомление
  // содержит признак is_read и id для пометки прочитанным.
  const notifByNoteId = useMemo(() => {
    const m = new Map<string, { id: string; is_read: boolean }>();
    for (const n of notifications) {
      const payload = (n.payload as { lesson_note_id?: string } | null) ?? null;
      const noteId = payload?.lesson_note_id;
      if (!noteId) continue;
      // Если несколько уведомлений на одну заметку — берём первое непрочитанное.
      const prev = m.get(noteId);
      if (!prev || (prev.is_read && !n.is_read)) {
        m.set(noteId, { id: n.id, is_read: n.is_read });
      }
    }
    return m;
  }, [notifications]);

  return (
    <>
      <div className="m-sect" style={{ paddingTop: 6 }}>
        <span className="m-sect__title">{tt("Заметки тренера", "Тренердин жазмалары")}</span>
      </div>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{tt("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : notes.length === 0 ? (
        <div className="empty"><div className="empty__title">{tt("Заметок пока нет", "Жазмалар жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notes.map((n) => (
            <LessonNoteCard
              key={n.id}
              note={n}
              lang={lang}
              notif={notifByNoteId.get(n.id) ?? null}
              onMarkRead={(notifId) => markRead.mutate(notifId)}
              markPending={markRead.isPending}
            />
          ))}
        </div>
      )}
    </>
  );
};

// Карточка одной заметки с фото (приватный bucket → signed URLs).
// Дополнительно: статус «прочитано / не прочитано» (по уведомлению,
// которое создаётся триггером при insert lesson_notes) и кнопка
// «Просмотрено» — отмечает уведомление прочитанным.
const LessonNoteCard = ({
  note, lang, notif, onMarkRead, markPending,
}: {
  note: LessonNoteFeed;
  lang: Lang;
  notif: { id: string; is_read: boolean } | null;
  onMarkRead: (notifId: string) => void;
  markPending: boolean;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const lessonDate = note.lesson?.date
    ? new Date(note.lesson.date).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", {
        day: "2-digit", month: "long", year: "numeric",
      })
    : "";
  const isUnread = !!notif && !notif.is_read;
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${isUnread ? "var(--blue)" : "var(--line)"}`,
      borderRadius: "var(--r-lg)", padding: 14,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          {isUnread && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue)" }} />
          )}
          {note.coach?.full_name ?? tt("Тренер", "Тренер")}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {lessonDate}{note.lesson?.start_time ? ` · ${note.lesson.start_time.slice(0, 5)}` : ""}
        </div>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink)", whiteSpace: "pre-wrap" }}>
        {note.text}
      </div>
      {note.photo_paths && note.photo_paths.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {note.photo_paths.map((p) => (
            <NotePhoto key={p} path={p} />
          ))}
        </div>
      )}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--line)",
        fontSize: 12,
      }}>
        <span style={{ color: isUnread ? "var(--blue)" : "var(--muted)", fontWeight: isUnread ? 600 : 500 }}>
          {isUnread
            ? tt("Не прочитано", "Окулган жок")
            : notif
              ? tt("Прочитано", "Окулган")
              : tt("—", "—")}
        </span>
        {isUnread && notif && (
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onMarkRead(notif.id)}
            disabled={markPending}
            style={{ padding: "6px 14px", fontSize: 12, gap: 6 }}
          >
            <Icon name="check" size={12} stroke={2.5} />
            {tt("Просмотрено", "Көрдүм")}
          </button>
        )}
      </div>
    </div>
  );
};

const NotePhoto = ({ path }: { path: string }) => {
  const { data: url } = useSignedLessonNotePhoto(path);
  if (!url) {
    return (
      <div style={{
        width: 96, height: 96, background: "var(--bg-soft)", borderRadius: "var(--r-sm)",
        display: "grid", placeItems: "center", color: "var(--muted)", fontSize: 11,
      }}>…</div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt=""
        style={{
          width: 96, height: 96, objectFit: "cover",
          borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
        }}
      />
    </a>
  );
};

// Контактная строка (менеджер/тренер) в Home
const ContactRow = ({
  icon, label, name, phone, empty,
}: {
  icon: string;
  label: string;
  name: string | null | undefined;
  phone: string | null | undefined;
  empty: string;
}) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12,
    background: "#fff", border: "1px solid var(--line)",
    borderRadius: "var(--r-md)", padding: 12,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: "50%", background: "var(--bg-soft)",
      display: "grid", placeItems: "center", color: "var(--ink)",
    }}>
      <Icon name={icon} size={18} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>
        {name ?? <span style={{ color: "var(--muted)", fontWeight: 400 }}>{empty}</span>}
      </div>
    </div>
    {phone && (
      <>
        <a href={`tel:${phone}`} className="icon-btn" title="Позвонить" style={{ color: "var(--blue)" }}>
          <Icon name="phone" size={16} />
        </a>
        <a
          href={`https://wa.me/${phone.replace(/[^0-9]/g, "")}`}
          target="_blank" rel="noreferrer"
          className="icon-btn"
          title="WhatsApp"
          style={{ color: "oklch(0.68 0.16 150)" }}
        >
          <Icon name="whatsapp" size={16} />
        </a>
      </>
    )}
  </div>
);

// Notifications panel — выезжающее окно с уведомлениями
const ParentNotificationsPanel = ({
  open, onClose, lang,
}: { open: boolean; onClose: () => void; lang: Lang }) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: notifications = [] } = useNotifications(50);
  const { data: feed = [] } = useLessonNotesForParent();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  if (!open) return null;

  // Сопоставляем notification.payload.lesson_note_id → объект заметки
  const notesById = new Map(feed.map((n) => [n.id, n]));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "grid", placeItems: "flex-start", zIndex: 250, padding: 16,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "var(--r-lg)", marginTop: 60,
          width: "100%", maxWidth: 420, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          maxHeight: "80vh", display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700 }}>
            {tt("Уведомления", "Эскертүүлөр")}
          </div>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending || notifications.every((n) => n.is_read)}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            {tt("Отметить всё", "Баарын окуу")}
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {notifications.length === 0 ? (
            <div className="empty"><div className="empty__title">{tt("Пока пусто", "Бош")}</div></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notifications.map((n) => {
                const noteId = (n.payload as any)?.lesson_note_id as string | undefined;
                const note = noteId ? notesById.get(noteId) : undefined;
                return (
                  <div
                    key={n.id}
                    style={{
                      background: n.is_read ? "var(--bg-soft)" : "#fff",
                      border: `1px solid ${n.is_read ? "var(--line)" : "var(--blue)"}`,
                      borderRadius: "var(--r-md)", padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
                        {!n.is_read && (
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--blue)" }} />
                        )}
                        {n.type === "lesson_note"
                          ? tt("Новая заметка тренера", "Жаңы жазма")
                          : n.type === "progress_note"
                          ? tt("Заметка о прогрессе", "Прогресс жазмасы")
                          : n.type === "card_expiring"
                          ? tt("Абонемент скоро закончится", "Абонемент жакында бүтөт")
                          : n.type === "card_expired"
                          ? tt("Абонемент закончился", "Абонемент бүттү")
                          : n.type === "lesson.rescheduled"
                          ? tt("Занятие перенесено", "Сабак жылдырылды")
                          : n.type === "lesson.cancelled"
                          ? tt("Занятие отменено", "Сабак жокко чыгарылды")
                          : n.type === "pt_booked"
                          ? tt("Запись на тренировку", "Машыгууга жазылуу")
                          : n.type === "pt_reminder"
                          ? tt("Напоминание о тренировке", "Машыгуу жөнүндө эскертүү")
                          : n.type === "pt_completed"
                          ? tt("Тренировка состоялась", "Машыгуу өттү")
                          : n.type === "pt_charged_no_show"
                          ? tt("Тренировка списана", "Машыгуу эсептен алынды")
                          : n.type}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {new Date(n.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}
                      </div>
                    </div>
                    {n.type === "card_expiring" ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const p = (n.payload ?? {}) as { child_name?: string; days_left?: number; end_date?: string };
                          const who = p.child_name ? tt(`ребёнка ${p.child_name}`, `${p.child_name} баласынын`) : tt("ребёнка", "баланын");
                          if (p.days_left === 0)
                            return tt(`Абонемент ${who} заканчивается сегодня. Продлите его, чтобы не пропускать занятия.`,
                                      `${who} абонементи бүгүн бүтөт. Сабактарды өткөрбөө үчүн узартыңыз.`);
                          const d = p.days_left === 1 ? tt("завтра", "эртең") : tt(`через ${p.days_left} дня`, `${p.days_left} күндөн кийин`);
                          return tt(`Абонемент ${who} заканчивается ${d}. Продлите его заранее.`,
                                    `${who} абонементи ${d} бүтөт. Алдын ала узартыңыз.`);
                        })()}
                      </div>
                    ) : n.type === "progress_note" ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const p = (n.payload ?? {}) as { child_name?: string; text?: string };
                          return (
                            <>
                              {p.child_name && <b>{p.child_name}: </b>}
                              {p.text ?? tt("Тренер оставил заметку о прогрессе.", "Машыктыруучу прогресс жазмасын калтырды.")}
                            </>
                          );
                        })()}
                      </div>
                    ) : n.type === "card_expired" ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const name = (n.payload as { child_name?: string } | null)?.child_name;
                          return name
                            ? tt(`Абонемент ребёнка ${name} закончился. Продлите его в кассе, чтобы продолжить занятия.`,
                                 `${name} баласынын абонементи бүттү. Сабактарды улантуу үчүн кассада узартыңыз.`)
                            : tt("Абонемент закончился. Продлите его в кассе, чтобы продолжить занятия.",
                                 "Абонемент бүттү. Сабактарды улантуу үчүн кассада узартыңыз.");
                        })()}
                      </div>
                    ) : n.type === "lesson.rescheduled" ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const p = (n.payload ?? {}) as {
                            group_name?: string | null;
                            previous_date?: string;
                            previous_start_time?: string;
                            new_date?: string;
                            new_start_time?: string;
                            reason?: string | null;
                          };
                          const grp = p.group_name ?? tt("Занятие", "Сабак");
                          const oldT = (p.previous_start_time ?? "").slice(0, 5);
                          const newT = (p.new_start_time ?? "").slice(0, 5);
                          return (
                            <>
                              {tt(
                                `${grp}: перенесено с ${p.previous_date} ${oldT} на ${p.new_date} ${newT}.`,
                                `${grp}: ${p.previous_date} ${oldT} → ${p.new_date} ${newT}.`,
                              )}
                              {p.reason && (
                                <div style={{ marginTop: 4, color: "var(--muted)" }}>
                                  {tt("Причина:", "Себеби:")} {p.reason}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : n.type === "lesson.cancelled" ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const p = (n.payload ?? {}) as {
                            group_name?: string | null;
                            date?: string;
                            start_time?: string;
                            reason?: string;
                          };
                          const grp = p.group_name ?? tt("Занятие", "Сабак");
                          const tm = (p.start_time ?? "").slice(0, 5);
                          return (
                            <>
                              {tt(`${grp}: занятие ${p.date} ${tm} отменено.`,
                                  `${grp}: ${p.date} ${tm} жокко чыгарылды.`)}
                              {p.reason && (
                                <div style={{ marginTop: 4, color: "var(--muted)" }}>
                                  {tt("Причина:", "Себеби:")} {p.reason}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    ) : n.type?.startsWith("pt_") ? (
                      <div style={{ fontSize: 13 }}>
                        {(() => {
                          const p = (n.payload ?? {}) as {
                            child_name?: string;
                            coach_name?: string;
                            service_name?: string;
                            date?: string;
                            start_time?: string;
                            lessons_used?: number;
                            lessons_total?: number;
                          };
                          const tm = (p.start_time ?? "").slice(0, 5);
                          const rest =
                            p.lessons_total != null && p.lessons_used != null
                              ? ` ${tt("Остаток:", "Калдыгы:")} ${p.lessons_total - p.lessons_used}/${p.lessons_total}.`
                              : "";
                          if (n.type === "pt_booked") {
                            return tt(
                              `${p.child_name ?? ""}: вы записаны на тренировку к тренеру ${p.coach_name ?? ""}, ${p.date ?? ""} в ${tm}.`,
                              `${p.child_name ?? ""}: ${p.coach_name ?? ""} тренерге ${p.date ?? ""} күнү саат ${tm}де жазылдыңыз.`,
                            );
                          }
                          if (n.type === "pt_reminder") {
                            return tt(
                              `Напоминаем: ${p.date ?? ""} в ${tm} — персональная тренировка у тренера ${p.coach_name ?? ""}.`,
                              `Эскертүү: ${p.date ?? ""} саат ${tm}де — ${p.coach_name ?? ""} тренер менен жеке машыгуу.`,
                            );
                          }
                          if (n.type === "pt_charged_no_show") {
                            return tt(
                              `Ваша тренировка ${p.date ?? ""} списана, так как вы заранее не уведомили тренера.${rest}`,
                              `${p.date ?? ""} машыгууңуз эсептен алынды — тренерге алдын ала кабарлаган жоксуз.${rest}`,
                            );
                          }
                          return tt(
                            `Тренировка ${p.date ?? ""} в ${tm} состоялась (${p.service_name ?? ""}).${rest}`,
                            `${p.date ?? ""} саат ${tm}дегі машыгуу өттү.${rest}`,
                          );
                        })()}
                      </div>
                    ) : note ? (
                      <>
                        <div style={{ fontSize: 13, marginBottom: 6 }}>
                          {note.child?.full_name && <b>{note.child.full_name} · </b>}
                          {note.text.slice(0, 140)}{note.text.length > 140 ? "…" : ""}
                        </div>
                        {note.photo_paths && note.photo_paths.length > 0 && (
                          <div style={{ display: "flex", gap: 6 }}>
                            {note.photo_paths.slice(0, 3).map((p) => (
                              <NotePhotoSmall key={p} path={p} />
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        {tt("Откройте вкладку «Заметки», чтобы увидеть детали.",
                            "«Жазмалар» бөлүмүнө кириңиз.")}
                      </div>
                    )}
                    {!n.is_read && (
                      <button
                        type="button"
                        className="btn btn--primary"
                        onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                        disabled={markRead.isPending}
                        style={{
                          marginTop: 10, width: "100%", justifyContent: "center",
                          padding: "8px 12px", fontSize: 13,
                        }}
                      >
                        <Icon name="check" size={14} stroke={2.5} />
                        {tt("Просмотрено", "Көрдүм")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <button type="button" className="btn" onClick={onClose} style={{ marginTop: 12 }}>
          {tt("Закрыть", "Жабуу")}
        </button>
      </div>
    </div>
  );
};

const NotePhotoSmall = ({ path }: { path: string }) => {
  const { data: url } = useSignedLessonNotePhoto(path);
  return (
    <div
      style={{
        width: 48, height: 48, borderRadius: "var(--r-sm)",
        background: url ? `center / cover no-repeat url("${url}")` : "var(--bg-soft)",
        border: "1px solid var(--line)",
      }}
    />
  );
};

// =====================================================================
// Profile / Contact
// =====================================================================
// Связь — контакты тренера/менеджера, прикреплённых к ребёнку, плюс
// контакты клуба. Если детей несколько — берём активного (тот же,
// что выбран в kid-switch'е сверху).
const ParentProfile = ({ lang, kid }: { lang: Lang; t?: ParentT; kid?: any }) => {
  const { data: org } = useOrganization();
  const { user, signOut } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: manager } = useProfile(kid?.responsible_manager_id ?? null);
  const { data: primaryCoach } = useChildPrimaryCoach(kid?.id);
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  return (
    <div style={{ padding: "8px 0" }}>
      {user?.full_name && (
        <div className="coach-me__card" style={{ marginBottom: 12 }}>
          <div className="coach-me__avatar" style={{ background: "var(--yellow-100)", color: "var(--yellow-ink)" }}>
            {(user.full_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="coach-me__meta">
            <div className="coach-me__name">{user.full_name}</div>
            <div className="coach-me__role">{tt("Родитель", "Ата-эне")}</div>
            {profile?.phone && (
              <div className="coach-me__phone">
                <Icon name="phone" size={12} /> {profile.phone}
              </div>
            )}
          </div>
        </div>
      )}

      {kid && (
        <>
          <div className="m-sect" style={{ paddingTop: 0 }}>
            <span className="m-sect__title">
              {tt("Контакты по ребёнку", "Бала боюнча байланыш")}
            </span>
            {kid.full_name && (
              <span className="m-sect__more" style={{ color: "var(--muted)" }}>
                {kid.full_name}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <ContactRow
              icon="user"
              label={tt("Менеджер", "Менеджер")}
              name={manager?.full_name}
              phone={manager?.phone ?? null}
              empty={tt("не назначен", "дайындалган эмес")}
            />
            <ContactRow
              icon="whistle"
              label={tt("Тренер", "Тренер")}
              name={primaryCoach?.full_name}
              phone={primaryCoach?.phone ?? null}
              empty={tt("не назначен", "дайындалган эмес")}
            />
          </div>
        </>
      )}

      <div className="m-sect" style={{ paddingTop: 0 }}>
        <span className="m-sect__title">{tt("Связь с клубом", "Клуб менен байланыш")}</span>
      </div>
      {(!org?.whatsapp_number && !org?.phone) ? (
        <div className="empty">
          <div className="empty__title">{tt("Контакты клуба не указаны", "Клубдун байланышы көрсөтүлгөн эмес")}</div>
        </div>
      ) : (
        <div className="contact-grid">
          {org?.whatsapp_number && (
            <a className="contact-card" href={`https://wa.me/${org.whatsapp_number}`} target="_blank" rel="noreferrer">
              <div className="contact-card__icon" style={{ background: "oklch(0.68 0.16 150)" }}>
                <Icon name="whatsapp" size={18} />
              </div>
              <div className="contact-card__title">{tt("Написать в WhatsApp", "WhatsAppга жазуу")}</div>
              <div className="contact-card__sub">{org.whatsapp_number}</div>
            </a>
          )}
          {org?.phone && (
            <a className="contact-card" href={`tel:${org.phone}`}>
              <div className="contact-card__icon" style={{ background: "var(--blue)" }}>
                <Icon name="phone" size={18} />
              </div>
              <div className="contact-card__title">{tt("Позвонить", "Чалуу")}</div>
              <div className="contact-card__sub">{org.phone}</div>
            </a>
          )}
        </div>
      )}

      <button
        type="button"
        className="coach-me__logout"
        onClick={() => signOut()}
        style={{ marginTop: 18 }}
      >
        <Icon name="x" size={14} stroke={2.5} />
        {tt("Выйти из аккаунта", "Аккаунттан чыгуу")}
      </button>
    </div>
  );
};
