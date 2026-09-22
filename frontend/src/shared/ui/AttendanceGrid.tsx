// Презентационная сетка табеля (дни × дети). Используется и тренером
// (с отметкой посещений через onCellClick), и админом в расписании
// (только просмотр — onCellClick не передаётся, ячейки некликабельны).
import { useEffect, useRef } from "react";
import { Icon, I18N } from "../../data";
import type { Lang } from "../../data";
import type { AttendanceStatus } from "../types/database";
import { ChildAvatar } from "./ChildAvatar";

// locked — отметка есть, но она вне окна абонемента (история): показываем,
// менять не даём.
export type TabelCell = { lesson_id: string; status: string | null; locked?: boolean };
// photo_path — то же фото, что уходит на турникет (children.photo_path):
// в журнале лицо узнаётся быстрее, чем фамилия.
export type TabelKid = { id: string; full_name: string; photo_path?: string | null };
// Что видно прямо в колонке с фамилией: кто ведёт ребёнка и до какого
// числа он оплачен.
export type TabelKidMeta = {
  manager: string | null;
  cardStart: string | null;
  cardEnd: string | null;
  remaining: number | null;
  total: number | null;
  cardStatus: string | null;
};
export type TabelWindow = { start: string | null; end: string | null };
export type CellClickArg = {
  child_id: string;
  child_name: string;
  date: string;
  lesson_id: string;
  current: string | null;
  isFuture: boolean;
};

export const AttendanceGrid = ({
  lang,
  kids,
  dates,
  grid,
  todayStr,
  notesMap,
  frozenByChild,
  removedByChild,
  metaByChild,
  windowByChild,
  onCellClick,
  onKidClick,
}: {
  lang: Lang;
  kids: TabelKid[];
  dates: string[];
  grid: Map<string, Map<string, TabelCell>>;
  todayStr: string;
  notesMap?: Map<string, Set<string>>;
  // Дни, на которые у конкретного ребёнка action active-freeze. Ячейка
  // помечается «в заморозке», некликабельна, в статистику не идёт.
  frozenByChild?: Map<string, Set<string>>;
  // Дни, снятые офисом с абонемента ребёнка («Удалить тренировки»):
  // серый квадрат, некликабельно, в статистику не идёт.
  removedByChild?: Map<string, Set<string>>;
  // Менеджер и абонемент ребёнка — строкой под фамилией.
  metaByChild?: Map<string, TabelKidMeta>;
  // Окно ребёнка в группе: до start его тут не было, после end абонемент
  // кончился. Обе зоны — серые некликабельные квадраты.
  windowByChild?: Map<string, TabelWindow>;
  onCellClick?: (cell: CellClickArg) => void;
  // Клик по имени ребёнка — открыть его карточку (везде, где есть табель).
  onKidClick?: (kid: TabelKid) => void;
}) => {
  const tt = (ru: string, ky: string) => (lang === "ru" ? ru : ky);

  // dd.mm — год в табеле не нужен, месяц и так выбран в шапке.
  const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

  // Где для этого ребёнка кончается его срок в группе.
  const outside = (kidId: string, date: string): "before" | "after" | null => {
    const win = windowByChild?.get(kidId);
    if (!win) return null;
    if (win.start && date < win.start) return "before";
    if (win.end && date > win.end) return "after";
    return null;
  };

  // Статистика по ребёнку — учитывает только прошедшие занятия.
  // Замороженные дни выкидываем из total/scheduled — карта же продлевается,
  // эти дни не должны портить процент посещаемости.
  const kidStats = (kidId: string) => {
    const row = grid.get(kidId);
    const frozen = frozenByChild?.get(kidId);
    if (!row) return { p: 0, total: 0, scheduled: 0 };
    let p = 0, total = 0, scheduled = 0;
    for (const [date, cell] of row.entries()) {
      if (frozen?.has(date)) continue;
      if (removedByChild?.get(kidId)?.has(date)) continue;
      // Вне окна абонемента статистику не портим: это либо дни до прихода
      // в группу, либо занятия уже после его окончания.
      if (outside(kidId, date)) continue;
      const isFuture = date > todayStr;
      if (isFuture) { scheduled++; continue; }
      if (cell.status === "present" || cell.status === "late" || cell.status === "makeup") p++;
      if (cell.status) total++;
    }
    return { p, total, scheduled };
  };

  // Итог по занятию: сколько детей пришло в конкретный день.
  // «Пришёл» = present/late/makeup (как в kidStats). Замороженные ячейки
  // не считаем. Для будущих дат возвращаем null — занятие ещё не прошло.
  const dayCame = (date: string) => {
    if (date > todayStr) return null;
    let came = 0;
    for (const k of kids) {
      if (frozenByChild?.get(k.id)?.has(date)) continue;
      if (removedByChild?.get(k.id)?.has(date)) continue;
      if (outside(k.id, date)) continue;
      const st = grid.get(k.id)?.get(date)?.status;
      if (st === "present" || st === "late" || st === "makeup") came++;
    }
    return came;
  };
  // Итог за месяц — сумма пришедших по всем прошедшим занятиям.
  const monthCame = dates.reduce((acc, d) => {
    const c = dayCame(d);
    return c == null ? acc : acc + c;
  }, 0);

  const wd = (d: string) =>
    new Date(d).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "short" }).slice(0, 2).toUpperCase();

  // Колонок в месяце больше, чем влезает в телефон. Открываем табель сразу
  // на актуальном занятии: сегодня, а если его в месяце нет — последнее
  // прошедшее (тренер отмечает именно его), иначе первое.
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusDate = dates.includes(todayStr)
    ? todayStr
    : [...dates].reverse().find((d) => d <= todayStr) ?? null;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || !focusDate) return;
    const cell = box.querySelector<HTMLElement>(`[data-col="${focusDate}"]`);
    if (!cell) return;
    // Считаем через getBoundingClientRect, а не offsetLeft: ни таблица, ни
    // контейнер не позиционированы, offsetParent — где-то выше по дереву.
    // Ставим дату примерно в середину — слева часть ширины съедает
    // закреплённая колонка ФИО.
    const cellBox = cell.getBoundingClientRect();
    const viewBox = box.getBoundingClientRect();
    const left = box.scrollLeft + (cellBox.left - viewBox.left) - (box.clientWidth - cellBox.width) / 2;
    box.scrollLeft = Math.max(0, left);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusDate, dates.length]);

  return (
    <>
      <div className="journal-legend">
        <span className="journal-legend__item">
          <span className="journal-mark journal-mark--present"><Icon name="check" size={12} stroke={3} /></span>
          {I18N[lang].status.present}
        </span>
        <span className="journal-legend__item">
          <span className="journal-mark journal-mark--absent"><Icon name="x" size={12} stroke={3} /></span>
          {I18N[lang].status.absent}
        </span>
        <span className="journal-legend__item">
          <span className="journal-mark journal-mark--empty" />
          {tt("не отмечено", "белгиленбеген")}
        </span>
        <span className="journal-legend__item">
          <span className="journal-mark journal-mark--scheduled" />
          {tt("предстоит", "келет")}
        </span>
        {windowByChild && (
          <span className="journal-legend__item">
            <span className="journal-mark journal-mark--expired" />
            {tt("вне абонемента", "абонементтен тышкары")}
          </span>
        )}
        {notesMap && (
          <span className="journal-legend__item">
            <span className="journal-note-badge journal-note-badge--demo">
              <Icon name="note" size={9} stroke={2.5} />
            </span>
            {tt("заметка", "эскертүү")}
          </span>
        )}
      </div>

      <div className="journal">
        <div className="journal__scroll" ref={scrollRef}>
          <table className="journal__grid">
            <thead>
              <tr>
                <th className="journal__num-h">№</th>
                <th className="journal__name-h">{tt("Ф.И. ученика", "Окуучунун аты")}</th>
                {dates.map((d) => {
                  const dt = new Date(d);
                  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                  const isToday = d === todayStr;
                  const isFuture = d > todayStr;
                  const classes = ["journal__date-h"];
                  if (isWeekend) classes.push("is-weekend");
                  if (isToday) classes.push("is-today");
                  if (isFuture) classes.push("is-future");
                  return (
                    <th key={d} className={classes.join(" ")} data-col={d}>
                      <div className="journal__wd">{wd(d)}</div>
                      <div className="journal__day">{dt.getDate()}</div>
                    </th>
                  );
                })}
                <th className="journal__stat-h">%</th>
              </tr>
            </thead>
            <tbody>
              {kids.map((k, idx) => {
                const { p, total, scheduled } = kidStats(k.id);
                const pct = total > 0 ? Math.round((p / total) * 100) : 0;
                return (
                  <tr key={k.id}>
                    <td className="journal__num">{idx + 1}</td>
                    <td
                      className={`journal__name${onKidClick ? " journal__name--clickable" : ""}`}
                      onClick={onKidClick ? () => onKidClick(k) : undefined}
                      title={onKidClick ? tt("Открыть карточку ребёнка", "Бала картасын ачуу") : undefined}
                    >
                      <ChildAvatar className="journal__av" photoPath={k.photo_path} fullName={k.full_name} />
                      <div className="journal__name-box">
                        <div className="journal__name-text">{k.full_name}</div>
                        {(() => {
                          const meta = metaByChild?.get(k.id);
                          if (!meta) return null;
                          const ended = !!meta.cardEnd && meta.cardEnd < todayStr;
                          return (
                            <div className="journal__kid-meta">
                              {meta.manager && (
                                <span className="journal__kid-meta-row journal__kid-meta-row--manager" title={tt("Менеджер ребёнка", "Баланын менеджери")}>
                                  <Icon name="user" size={10} stroke={2.25} />
                                  {meta.manager}
                                </span>
                              )}
                              {meta.cardStart && meta.cardEnd && (
                                <span
                                  className={`journal__kid-meta-row${ended ? " is-ended" : ""}`}
                                  title={ended
                                    ? tt(`Абонемент закончился ${shortDate(meta.cardEnd)}`, `Абонемент ${shortDate(meta.cardEnd)} бүттү`)
                                    : tt("Срок абонемента", "Абонементтин мөөнөтү")}
                                >
                                  <Icon name="card" size={10} stroke={2.25} />
                                  {shortDate(meta.cardStart)} – {shortDate(meta.cardEnd)}
                                </span>
                              )}
                              {meta.remaining != null && (
                                <span
                                  className={`journal__kid-meta-row${meta.remaining <= 0 ? " is-ended" : ""}`}
                                  title={tt("Осталось занятий по абонементу", "Абонемент боюнча калган сабактар")}
                                >
                                  <Icon name="check" size={10} stroke={2.5} />
                                  {meta.remaining > 0
                                    ? tt(`осталось ${meta.remaining}${meta.total ? ` из ${meta.total}` : ""}`,
                                         `калды ${meta.remaining}${meta.total ? ` / ${meta.total}` : ""}`)
                                    : tt("занятия закончились", "сабактар бүттү")}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </td>
                    {dates.map((d) => {
                      const cell = grid.get(k.id)?.get(d);
                      const status = cell?.status as AttendanceStatus | null | undefined;
                      const lessonId = cell?.lesson_id;
                      const isFuture = d > todayStr;
                      const isToday = d === todayStr;
                      const isFrozen = !!frozenByChild?.get(k.id)?.has(d);
                      // Вне окна: до прихода в группу или после конца
                      // абонемента. Клик заблокирован, старая отметка (если
                      // есть) остаётся видна как история.
                      const out = outside(k.id, d);
                      const removed = !!removedByChild?.get(k.id)?.has(d);
                      // В заморозке — клик заблокирован, занятия эти не идут
                      // в табель ребёнка (карта продлевается на эти дни).
                      const clickable = !isFrozen && !out && !removed && !cell?.locked && !!lessonId && !!onCellClick;
                      const hasNote = !!(lessonId && notesMap?.get(lessonId)?.has(k.id));
                      let cls = !lessonId ? "journal-mark journal-mark--no-card" : "journal-mark journal-mark--empty";
                      if (out === "before") cls = "journal-mark journal-mark--before";
                      else if (out === "after") cls = "journal-mark journal-mark--expired";
                      if (removed) cls = "journal-mark journal-mark--expired";
                      if (isFrozen) cls = "journal-mark journal-mark--frozen";
                      else if (status === "present" || status === "late" || status === "makeup") cls = "journal-mark journal-mark--present";
                      else if (status === "absent" || status === "excused") cls = "journal-mark journal-mark--absent";
                      else if (isFuture && lessonId) cls = "journal-mark journal-mark--scheduled";
                      const tdClasses = ["journal__cell"];
                      if (isToday) tdClasses.push("is-today");
                      if (isFuture) tdClasses.push("is-future");
                      // Отметка вне абонемента — история: приглушаем, чтобы
                      // не выглядела как обычная редактируемая ячейка.
                      if ((out || cell?.locked) && status) tdClasses.push("is-locked");
                      const cellStyle = isFrozen || out || removed || cell?.locked
                        ? { cursor: "not-allowed" as const }
                        : !lessonId
                          ? { cursor: "not-allowed" as const }
                          : !onCellClick
                            ? { cursor: "default" as const }
                            : undefined;
                      const meta = metaByChild?.get(k.id);
                      // Окно могло сжаться раньше календарного cardEnd —
                      // абонемент с лимитом занятий (total_lessons) кончается
                      // по числу тренировок, а не по дате (см. useCoachTabel/
                      // useGroupTabel). Тултип берёт реальную границу окна,
                      // а не cardEnd — иначе даты «после лимита, но до
                      // cardEnd» подписывались бы неверной датой окончания.
                      const winEnd = windowByChild?.get(k.id)?.end ?? meta?.cardEnd ?? null;
                      const outTitle = out === "before"
                        ? tt(
                            meta?.cardStart ? `Ещё не в группе — абонемент с ${shortDate(meta.cardStart)}` : "Ещё не в группе",
                            meta?.cardStart ? `Топто эмес — абонемент ${shortDate(meta.cardStart)} башталат` : "Топто эмес",
                          )
                        : out === "after"
                          ? tt(
                              winEnd ? `Занятия по абонементу закончились ${shortDate(winEnd)}` : "Абонемент закончился",
                              winEnd ? `Абонемент боюнча сабактар ${shortDate(winEnd)} бүттү` : "Абонемент бүттү",
                            )
                          : null;
                      return (
                        <td key={d} className={tdClasses.join(" ")}>
                          <button
                            type="button"
                            className={cls}
                            disabled={!clickable}
                            title={isFrozen
                              ? tt("В заморозке абонемента", "Тындырууда")
                              : removed
                                ? tt("Тренировка снята с абонемента", "Машыгуу абонементтен алынган")
                              : outTitle
                                ? outTitle
                                : cell?.locked
                                  ? tt("Занятие вне абонемента — отметку менять нельзя", "Сабак абонементтен тышкары — өзгөртүүгө болбойт")
                                  : !lessonId
                                    ? tt("Абонемент не покрывает эту дату", "Абонемент бул күндү камтыбайт")
                                    : onCellClick
                                      ? (isFuture
                                        ? tt("Занятие ещё не прошло", "Сабак өткөн жок")
                                        : status
                                          ? tt("Изменить отметку", "Белгини өзгөртүү")
                                          : tt("Не отмечено — нажмите, чтобы отметить", "Белгиленбеген — белгилөө үчүн басыңыз"))
                                      : (!status && !isFuture
                                        ? tt("Занятие прошло, отметки тренера нет", "Сабак өттү, белги жок")
                                        : undefined)}
                            onClick={() => clickable && onCellClick!({
                              child_id: k.id,
                              child_name: k.full_name,
                              date: d,
                              lesson_id: lessonId!,
                              current: status ?? null,
                              isFuture,
                            })}
                            style={cellStyle}
                          >
                            {isFrozen
                              ? <span aria-hidden="true" style={{ fontSize: 14 }}>❄</span>
                              : status === "present" || status === "late" || status === "makeup"
                                ? <Icon name="check" size={15} stroke={3} />
                                : status === "absent" || status === "excused"
                                  ? <Icon name="x" size={15} stroke={3} />
                                  : !lessonId
                                    // Вне окна — просто серый квадрат;
                                    // «−» оставляем для «нет покрытия».
                                    ? (out ? null : <span aria-hidden="true">−</span>)
                                    : null}
                            {hasNote && (
                              <span className="journal-note-badge" title={tt("Есть заметка", "Эскертүү бар")}>
                                <Icon name="note" size={9} stroke={2.5} />
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="journal__stat">
                      <div className="journal__pct"
                        style={{ color: total === 0 ? "var(--muted)" : pct >= 70 ? "var(--green)" : pct >= 40 ? "var(--yellow-ink)" : "var(--red)" }}>
                        {total > 0 ? `${pct}%` : "—"}
                      </div>
                      <div className="journal__pct-sub">
                        {total > 0 ? `${p}/${total}` : "—"}
                        {scheduled > 0 && <span className="journal__pct-future"> · +{scheduled}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="journal__foot">
                {/* Две отдельные ячейки вместо colSpan: на телефоне колонка №
                    скрывается, и объединённая подпись съезжала бы на дату. */}
                <td className="journal__foot-num" />
                <td className="journal__foot-label">
                  {tt("Пришло детей", "Келген балдар")}
                </td>
                {dates.map((d) => {
                  const came = dayCame(d);
                  const isToday = d === todayStr;
                  const isFuture = d > todayStr;
                  const cls = ["journal__foot-cell"];
                  if (isToday) cls.push("is-today");
                  if (isFuture) cls.push("is-future");
                  return (
                    <td key={d} className={cls.join(" ")}
                      title={came == null
                        ? tt("Занятие ещё не прошло", "Сабак өткөн жок")
                        : tt(`Пришло на занятие: ${came}`, `Сабакка келди: ${came}`)}>
                      {came == null ? "—" : came}
                    </td>
                  );
                })}
                <td className="journal__foot-total"
                  title={tt(`Всего посещений за месяц: ${monthCame}`, `Айга баардыгы: ${monthCame}`)}>
                  <div className="journal__foot-total-num">{monthCame}</div>
                  <div className="journal__foot-total-sub">{tt("за месяц", "айга")}</div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
};
