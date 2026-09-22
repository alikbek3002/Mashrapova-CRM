// Проходная: турникеты Hikvision Face ID — состояние терминалов, управление
// дверью и живая лента проходов. Данные — shared/api/hik.ts (автообновление в хуках).
import { useState } from "react";
import type { Lang } from "../data";
import { PageHeader, EmptyState } from "./common";
import {
  useHikDevices, useHikDoorCmd, useHikRecentEvents,
  useHikSettings, useUpdateHikSettings, useHikInside,
} from "../shared/api/hik";
import type { DoorCmd, HikDevice, HikEventRow } from "../shared/api/hik";
import { usePerm } from "../shared/auth/rbac";

const modeBadge: Record<HikDevice["mode"], { ru: string; ky: string; cls: string }> = {
  normal: { ru: "Обычный режим", ky: "Кадимки режим", cls: "pill pill--active" },
  alwaysOpen: { ru: "Свободный проход", ky: "Эркин өтүү", cls: "pill pill--frozen" },
  alwaysClose: { ru: "Закрыт", ky: "Жабык", cls: "pill pill--expired" },
};

const eventBadge: Record<HikEventRow["event_type"], { ru: string; ky: string; cls: string }> = {
  face_ok: { ru: "Лицо ✓", ky: "Жүз ✓", cls: "pill pill--active" },
  face_fail: { ru: "Не распознан", ky: "Таанылган жок", cls: "pill pill--expired" },
  card_ok: { ru: "Карта ✓", ky: "Карта ✓", cls: "pill pill--frozen" },
  other: { ru: "Другое", ky: "Башка", cls: "pill pill--archived" },
  auto_out: { ru: "Авто-выход", ky: "Авто-чыгуу", cls: "pill pill--archived" },
  denied: { ru: "Вне расписания", ky: "Расписаниеден тышкары", cls: "pill pill--expired" },
};

const directionLabel: Record<HikEventRow["direction"], { ru: string; ky: string }> = {
  in: { ru: "вход", ky: "кирүү" },
  out: { ru: "выход", ky: "чыгуу" },
  unknown: { ru: "", ky: "" },
};

export const TurnstilesPage = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: devices = [], isLoading: devLoading, error: devError } = useHikDevices();
  const { data: events = [], isLoading: evLoading, error: evError } = useHikRecentEvents();
  const door = useHikDoorCmd();

  const onlineCount = devices.filter((d) => d.online).length;

  // «был на связи N мин назад» — по last_seen_at, в местном времени.
  const lastSeenLabel = (iso: string | null) => {
    if (!iso) return t("не выходил на связь", "байланышка чыга элек");
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (mins < 1) return t("был на связи только что", "жаңы эле байланышта болгон");
    if (mins < 60) return t(`был на связи ${mins} мин назад`, `${mins} мүн мурун байланышта болгон`);
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t(`был на связи ${hours} ч назад`, `${hours} саат мурун байланышта болгон`);
    const days = Math.floor(hours / 24);
    return t(`был на связи ${days} дн назад`, `${days} күн мурун байланышта болгон`);
  };

  // Состояние per-устройство: общий useMutation отражает только последний
  // вызов, а команды на два терминала могут идти параллельно.
  const [pendingCmd, setPendingCmd] = useState<Record<string, DoorCmd | null>>({});
  const [cmdErrors, setCmdErrors] = useState<Record<string, string | null>>({});

  const sendCmd = (serial: string, cmd: DoorCmd) => {
    setPendingCmd((p) => ({ ...p, [serial]: cmd }));
    setCmdErrors((e) => ({ ...e, [serial]: null }));
    door.mutateAsync({ serial, cmd })
      .catch((e: unknown) => setCmdErrors((prev) => ({
        ...prev, [serial]: e instanceof Error ? e.message : String(e),
      })))
      .finally(() => setPendingCmd((p) => ({ ...p, [serial]: null })));
  };

  const isCmdPending = (serial: string, cmd: DoorCmd) => pendingCmd[serial] === cmd;
  const isDevicePending = (serial: string) => !!pendingCmd[serial];

  // Режим — состояние-переключатель (Обычный ⟷ Свободный проход),
  // «Открыть разово» — отдельное действие для гостей.
  const MODE_OPTIONS: { mode: "normal" | "alwaysOpen"; cmd: DoorCmd; ru: string; ky: string }[] = [
    { mode: "normal", cmd: "resume", ru: "Обычный режим", ky: "Кадимки режим" },
    { mode: "alwaysOpen", cmd: "alwaysOpen", ru: "Свободный проход", ky: "Эркин өтүү" },
  ];

  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(lang === "ru" ? "ru-RU" : "ky-KG", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });

  return (
    <>
      <PageHeader
        title={t("Проходная", "Өткөрмө")}
        subtitle={devLoading
          ? t("Загрузка…", "Жүктөлүүдө…")
          : t(`${devices.length} терминалов · ${onlineCount} онлайн`, `${devices.length} терминал · ${onlineCount} онлайн`)}
      />

      {/* Карточки терминалов */}
      {devError ? (
        <div className="card">
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={devError.message} />
        </div>
      ) : devLoading ? (
        <div className="card">
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        </div>
      ) : devices.length === 0 ? (
        <div className="card">
          <EmptyState
            title={t("Терминалы ещё не подключены", "Терминалдар азырынча туташтырыла элек")}
            hint={t("Терминал появится здесь после первого выхода на связь", "Терминал биринчи байланышка чыккандан кийин бул жерде көрүнөт")}
          />
        </div>
      ) : (
        <div className="coach-grid">
          {devices.map((d) => {
            const mode = modeBadge[d.mode];
            const deviceError = cmdErrors[d.serial] ?? null;
            return (
              <div key={d.serial} className="card" style={{ padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    title={d.online ? t("Онлайн", "Онлайн") : t("Офлайн", "Офлайн")}
                    style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: d.online ? "var(--green)" : "var(--muted-2)",
                    }}
                  />
                  <div style={{ fontWeight: 700, fontSize: 14, flex: 1, minWidth: 0 }}>{d.name}</div>
                  <span className={mode.cls}>{mode[lang]}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                  {d.serial}{d.ip ? ` · ${d.ip}` : ""}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  {d.online ? t("онлайн", "онлайн") : lastSeenLabel(d.last_seen_at)}
                </div>

                {/* Переключатель режима */}
                <div style={{
                  display: "flex", marginTop: 12,
                  border: "1px solid var(--line)", borderRadius: "var(--r-xs)",
                  overflow: "hidden", width: "fit-content",
                }}>
                  {MODE_OPTIONS.map((o) => {
                    const active = d.mode === o.mode;
                    const pending = isCmdPending(d.serial, o.cmd);
                    return (
                      <button
                        key={o.mode}
                        onClick={() => !active && sendCmd(d.serial, o.cmd)}
                        disabled={isDevicePending(d.serial) || active}
                        style={{
                          padding: "7px 14px", fontSize: 12.5, border: "none",
                          cursor: active ? "default" : "pointer",
                          fontWeight: active ? 700 : 400,
                          background: active
                            ? (o.mode === "alwaysOpen" ? "var(--yellow-100, #fff3cd)" : "var(--blue-100, #dbeafe)")
                            : "var(--surface)",
                          color: "var(--ink)",
                        }}
                      >
                        {pending ? "…" : t(o.ru, o.ky)}
                      </button>
                    );
                  })}
                </div>
                {d.mode === "alwaysClose" && (
                  <div style={{ fontSize: 12, color: "var(--red-600)", marginTop: 6 }}>
                    {t("Терминал закрыт — включите обычный режим", "Терминал жабык — кадимки режимди күйгүзүңүз")}
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    style={{ padding: "6px 12px", fontSize: 12 }}
                    disabled={isDevicePending(d.serial)}
                    onClick={() => sendCmd(d.serial, "open")}
                  >
                    {isCmdPending(d.serial, "open") ? "…" : t("Открыть разово (гость)", "Бир жолу ачуу (конок)")}
                  </button>
                </div>

                {deviceError && (
                  <div style={{ fontSize: 12, color: "var(--red-600)", marginTop: 8 }}>
                    {t("Ошибка", "Ката")}: {deviceError}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Доступ по расписанию + кто в здании */}
      <div className="coach-grid" style={{ marginTop: 16 }}>
        <ScheduleAccessCard lang={lang} />
        <InsideCard lang={lang} />
      </div>

      {/* Лента проходов */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <div>
            <div className="card__title">{t("Лента проходов", "Өтүүлөр журналы")}</div>
            <div className="card__subtitle">{t("Обновляется автоматически", "Автоматтык түрдө жаңырат")}</div>
          </div>
        </div>
        {evError ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={evError.message} />
        ) : evLoading ? (
          <EmptyState title={t("Загрузка…", "Жүктөлүүдө…")} />
        ) : events.length === 0 ? (
          <EmptyState title={t("Проходов пока нет", "Өтүүлөр азырынча жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Время", "Убакыт")}</th>
                  <th>{t("Ребёнок", "Бала")}</th>
                  <th>{t("Тип", "Түрү")}</th>
                  <th>{t("Направление", "Багыт")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => {
                  const badge = eventBadge[e.event_type];
                  return (
                    <tr key={e.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{timeOf(e.occurred_at)}</td>
                      <td>
                        {(e.person_name ?? e.children?.full_name)
                          ? <span className="cell-main">{e.person_name ?? e.children?.full_name}</span>
                          : e.person_no
                            ? <span style={{ color: "var(--muted)" }}>№ {e.person_no}</span>
                            : "—"}
                      </td>
                      <td><span className={badge.cls}>{badge[lang]}</span></td>
                      <td style={{ color: "var(--muted)" }}>{directionLabel[e.direction][lang]}</td>
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

// Тумблер «Доступ по расписанию»: терминал пускает ребёнка только в окно
// занятия (см. backend/src/lib/hik-access-windows.ts). Параметры окна —
// из org_settings; править может директор/ст. менеджер (SCHEDULE_ROLES).
const ScheduleAccessCard = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data, isLoading, error } = useHikSettings();
  const update = useUpdateHikSettings();
  const canEdit = usePerm("manage_access_settings");
  const s = data?.settings;
  const sync = data?.sync;

  const toggle = () => {
    if (!s) return;
    const next = !s.enabled;
    const msg = next
      ? t("Включить доступ по расписанию? Дети без занятия сегодня через турникет не пройдут — офис открывает «разово (гость)».",
          "Расписание боюнча кирүүнү күйгүзөсүзбү? Бүгүн сабагы жок балдар турникеттен өтө албайт — офис «бир жолу (конок)» ачат.")
      : t("Выключить? Всем детям вернётся бессрочный доступ на терминалах.",
          "Өчүрөсүзбү? Бардык балдарга терминалда мөөнөтсүз кирүү кайтарылат.");
    if (!confirm(msg)) return;
    update.mutate({ access_schedule_enabled: next });
  };

  const tickAgo = sync?.last_tick_at
    ? Math.max(0, Math.round((Date.now() - new Date(sync.last_tick_at).getTime()) / 1000))
    : null;

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{t("Доступ по расписанию", "Расписание боюнча кирүү")}</div>
        {s && (
          <span className={s.enabled ? "pill pill--active" : "pill pill--archived"}>
            {s.enabled ? t("Включён", "Күйгүзүлгөн") : t("Выключен", "Өчүрүлгөн")}
          </span>
        )}
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "var(--red-600)", marginTop: 8 }}>{error.message}</div>
      ) : isLoading || !s ? (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>{t("Загрузка…", "Жүктөлүүдө…")}</div>
      ) : (
        <>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.5 }}>
            {t(
              `Вход за ${s.beforeMin} мин до занятия, вход и выход до ${s.afterMin} мин после. Без выхода — авто-выход через ${s.autoExitHours} ч после занятия. Считаются группы и ПТ; сотрудники без ограничений.`,
              `Сабакка ${s.beforeMin} мүн калганда кирүү, сабактан кийин ${s.afterMin} мүнөткө чейин кирүү-чыгуу. Чыкпаса — сабактан ${s.autoExitHours} саат кийин авто-чыгуу. Группалар жана ЖМ эсептелет; кызматкерлер чектөөсүз.`,
            )}
          </div>
          {canEdit && (
            <div style={{ marginTop: 12 }}>
              <button
                className={s.enabled ? "btn" : "btn btn--primary"}
                style={{ padding: "7px 14px", fontSize: 12.5 }}
                onClick={toggle}
                disabled={update.isPending}
              >
                {update.isPending ? "…" : s.enabled ? t("Выключить", "Өчүрүү") : t("Включить", "Күйгүзүү")}
              </button>
              {update.error && (
                <div style={{ fontSize: 12, color: "var(--red-600)", marginTop: 6 }}>{(update.error as Error).message}</div>
              )}
            </div>
          )}
          {sync && (
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12, fontFamily: "var(--font-mono)" }}>
              {sync.running
                ? t("синхронизация идёт…", "синхрондоо жүрүп жатат…")
                : tickAgo == null
                  ? t("синхронизация ещё не запускалась", "синхрондоо азырынча иштеген жок")
                  : t(`синхронизация ${tickAgo} с назад`, `синхрондоо ${tickAgo} сек мурун`)}
              {" · "}{t(`детей: ${sync.children}`, `балдар: ${sync.children}`)}
              {sync.pending > 0 && <> · {t(`в очереди: ${sync.pending}`, `кезекте: ${sync.pending}`)}</>}
              {sync.errors > 0 && (
                <span style={{ color: "var(--red-600)" }}> · {t(`ошибок: ${sync.errors}`, `каталар: ${sync.errors}`)}</span>
              )}
              {sync.last_error && <span style={{ color: "var(--red-600)" }}> · {sync.last_error}</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// Кто сейчас в здании: последний проход ребёнка — вход. Список схлопывается
// авто-выходом (см. hik-presence.ts) или реальным проходом на выход.
const InsideCard = ({ lang }: { lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: inside = [], isLoading, error } = useHikInside();
  const [open, setOpen] = useState(false);
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleTimeString(lang === "ru" ? "ru-RU" : "ky-KG", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>{t("Сейчас в здании", "Азыр имаратта")}</div>
        <span className="pill pill--active">{isLoading ? "…" : inside.length}</span>
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: "var(--red-600)", marginTop: 8 }}>{error.message}</div>
      ) : inside.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 8 }}>
          {isLoading ? t("Загрузка…", "Жүктөлүүдө…") : t("Детей в здании нет", "Имаратта балдар жок")}
        </div>
      ) : (
        <>
          <button className="btn" style={{ marginTop: 10, padding: "6px 12px", fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
            {open ? t("Скрыть список", "Тизмени жашыруу") : t("Показать список", "Тизмени көрсөтүү")}
          </button>
          {open && (
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: "auto", fontSize: 13 }}>
              {inside.map((p) => (
                <div key={p.child_id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                  <span style={{ flex: 1 }}>{p.full_name || p.child_id}</span>
                  <span style={{ color: "var(--muted)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {t("с", "")} {timeOf(p.entered_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
