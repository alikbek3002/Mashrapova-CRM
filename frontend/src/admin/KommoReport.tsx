// Отчёт по Kommo (ТЗ §13, §7.4, §8): скорость первого ответа, каналы,
// воронка по этапам Kommo, менеджеры, секции и «Неразобранное».
// Все цифры — из kommo_report(); на клиенте ничего не пересчитываем.
import { useState } from "react";
import type { Lang } from "../data";
import { EmptyState, formatCurrency } from "./common";
import { useKommoReport } from "../shared/api/queries";
import { useKommoSync } from "../shared/api/mutations";
import { DateInput } from "../shared/ui/DateInput";
import { SkeletonRows } from "../shared/ui/Skeleton";
import { stageLabel, channelLabel } from "./leadFunnel";
import type { KommoReport } from "../shared/types/database";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : "—");
const minutes = (m: number | null | undefined, ru: boolean) => {
  if (m == null) return "—";
  if (m < 60) return `${m} ${ru ? "мин" : "мүн"}`;
  const h = m / 60;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} ${ru ? "ч" : "с"}`;
};

type Segment = keyof KommoReport["response"];
const SEGMENTS: { key: Segment; ru: string; ky: string }[] = [
  { key: "all", ru: "Все обращения", ky: "Бардык кайрылуулар" },
  { key: "work_hours", ru: "Днём (9:00–21:00)", ky: "Күндүз (9:00–21:00)" },
  { key: "off_hours", ru: "Ночью и рано утром", ky: "Түнкүсүн жана эрте менен" },
  { key: "whatsapp", ru: "WhatsApp", ky: "WhatsApp" },
  { key: "instagram", ru: "Instagram", ky: "Instagram" },
];

export const KommoTab = ({ lang }: { lang: Lang }) => {
  const ru = lang === "ru";
  const t = (r: string, k: string) => (ru ? r : k);
  const [from, setFrom] = useState(ymd(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(ymd(new Date()));
  const { data: r, isLoading } = useKommoReport(from, to);
  const sync = useKommoSync();

  if (isLoading) return <SkeletonRows rows={6} avatar={false} />;
  if (!r || !r.sync?.last_ok_at) {
    return (
      <EmptyState
        title={t("Kommo ещё не синхронизирован", "Kommo азырынча шайкештирилген жок")}
        hint={t("Синхронизация запускается на сервере, когда заданы KOMMO_BASE_URL и KOMMO_TOKEN.",
                "KOMMO_BASE_URL жана KOMMO_TOKEN берилгенде серверде шайкештирүү башталат.")}
      />
    );
  }

  const all = r.response.all;
  const f = r.funnel;
  const maxHour = Math.max(1, ...r.by_hour);

  const tiles: { label: string; value: string; hint?: string; ok?: boolean }[] = [
    { label: t("Обращений", "Кайрылуулар"), value: String(f.leads),
      hint: t(`в «Неразобранном» ${f.unsorted}`, `«Иреттелбеген» ${f.unsorted}`) },
    { label: t("Ответ за 10 минут", "10 мүнөттө жооп"), value: all ? pct(all.within_10_min, all.talks) : "—",
      hint: t("цель ТЗ §7.4 — 10 минут", "ТТ §7.4 максаты — 10 мүнөт"),
      ok: all ? all.within_10_min / Math.max(all.talks, 1) >= 0.8 : undefined },
    { label: t("Медиана ответа", "Жооптун медианасы"), value: minutes(all?.median_min, ru),
      hint: t("автоответы не считаются", "автожооптор эсепке алынбайт") },
    { label: t("Без ответа", "Жоопсуз"), value: all ? String(all.no_reply) : "—",
      hint: all ? t(`из ${all.talks} бесед`, `${all.talks} маектен`) : undefined },
    { label: t("Продаж", "Сатуулар"), value: String(f.converted), hint: pct(f.converted, f.leads) },
    { label: t("Выручка по сделкам", "Бүтүмдөр боюнча киреше"), value: formatCurrency(Number(f.revenue)),
      hint: f.avg_check ? t(`средний чек ${formatCurrency(Number(f.avg_check))}`, `орточо чек ${formatCurrency(Number(f.avg_check))}`) : undefined },
  ];

  return (
    <>
      <div className="toolbar" style={{ padding: 0, marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
        <div className="grid-2" style={{ maxWidth: 360 }}>
          <label className="field">
            <span className="field__label">{t("С", "Башт.")}</span>
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">{t("По", "Чейин")}</span>
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <div className="toolbar__spacer" />
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
          {t("Синхронизировано", "Шайкештирилди")}{" "}
          {new Date(r.sync.last_ok_at).toLocaleString(ru ? "ru-RU" : "ky-KG", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          {r.sync.last_error && (
            <div style={{ color: "var(--red-600)" }}>{t("Последняя ошибка", "Акыркы ката")}: {r.sync.last_error.slice(0, 120)}</div>
          )}
        </div>
        <button className="btn btn--ghost" disabled={sync.isPending} onClick={() => sync.mutate({})}>
          {sync.isPending ? t("Синхронизация…", "Шайкештирүү…") : t("Синхронизировать", "Шайкештирүү")}
        </button>
      </div>

      <div className="kpi-grid">
        {tiles.map((x) => (
          <div className="kpi" key={x.label}>
            <div className="kpi__label">{x.label}</div>
            <div className="kpi__value" style={x.ok === false ? { color: "var(--red-600)" } : undefined}>{x.value}</div>
            {x.hint && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{x.hint}</div>}
          </div>
        ))}
      </div>

      {/* Скорость первого ответа: беседа → первый исходящий не быстрее 5 с */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Скорость первого ответа", "Биринчи жооптун ылдамдыгы")}</h3>
      <div className="table-scroll">
        <table className="admin-table">
          <thead>
            <tr>
              <th></th>
              <th>{t("Бесед", "Маектер")}</th>
              <th>{t("Медиана", "Медиана")}</th>
              <th>{t("75% ответов быстрее", "Жооптордун 75% тезирээк")}</th>
              <th>{t("≤ 10 мин", "≤ 10 мүн")}</th>
              <th>{t("≤ 30 мин", "≤ 30 мүн")}</th>
              <th>{t("> 3 ч", "> 3 с")}</th>
              <th>{t("Без ответа", "Жоопсуз")}</th>
            </tr>
          </thead>
          <tbody>
            {SEGMENTS.map((sg) => {
              const x = r.response[sg.key];
              if (!x) return null;
              return (
                <tr key={sg.key}>
                  <td className="cell-main">{ru ? sg.ru : sg.ky}</td>
                  <td>{x.talks}</td>
                  <td>{minutes(x.median_min, ru)}</td>
                  <td>{minutes(x.p75_min, ru)}</td>
                  <td>{pct(x.within_10_min, x.talks)}</td>
                  <td>{pct(x.within_30_min, x.talks)}</td>
                  <td>{pct(x.over_3_hours, x.talks)}</td>
                  <td>{x.no_reply}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Когда пишут — чтобы видеть, кого и когда держать на смене */}
      <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Когда пишут (по часам)", "Качан жазышат (саат боюнча)")}</h3>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 96, overflowX: "auto" }}>
        {r.by_hour.map((n, h) => (
          <div key={h} title={`${h}:00 — ${n}`} style={{ flex: "1 0 14px", textAlign: "center" }}>
            <div style={{ height: Math.round((n / maxHour) * 72), background: h >= 9 && h < 21 ? "var(--blue)" : "var(--muted-2)", borderRadius: 3 }} />
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{h}</div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 24, gap: 24, alignItems: "start" }}>
        <div>
          <h3 style={{ fontSize: 14 }}>{t("Воронка за период", "Мезгилдеги воронка")}</h3>
          <table className="admin-table">
            <tbody>
              <tr><td>{t("Обращений", "Кайрылуулар")}</td><td>{f.leads}</td><td></td></tr>
              <tr><td>{t("Был ответ или контакт", "Жооп же байланыш болду")}</td><td>{f.contacted}</td><td>{pct(f.contacted, f.leads)}</td></tr>
              <tr><td>{t("Записались на пробное", "Сыноого жазылды")}</td><td>{f.trial_booked}</td><td>{pct(f.trial_booked, f.leads)}</td></tr>
              <tr><td>{t("Пришли на пробное", "Сыноого келди")}</td><td>{f.trial_attended}</td><td>{pct(f.trial_attended, f.trial_booked)}</td></tr>
              <tr><td>{t("Купили", "Сатып алды")}</td><td>{f.converted}</td><td>{pct(f.converted, f.leads)}</td></tr>
              <tr><td>{t("Отказ", "Баш тартты")}</td><td>{f.lost}</td>
                <td style={{ color: "var(--muted)", fontSize: 12 }}>{t(`с причиной ${f.lost_with_reason}`, `себеби менен ${f.lost_with_reason}`)}</td></tr>
              <tr><td>{t("Менеджер отмечен", "Менеджер белгиленген")}</td><td>{f.with_manager}</td><td>{pct(f.with_manager, f.leads)}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Каналы", "Каналдар")}</h3>
          <table className="admin-table">
            <tbody>
              {Object.entries(r.by_channel).sort((a, b) => b[1] - a[1]).map(([ch, n]) => (
                <tr key={ch}><td>{ch === "unknown" ? "—" : channelLabel(ch, ru)}</td><td>{n}</td><td>{pct(n, f.leads)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ fontSize: 14 }}>{t("«Неразобранное» сейчас", "«Иреттелбеген» азыр")}</h3>
          <table className="admin-table">
            <tbody>
              <tr><td>{t("Ждут разбора", "Иреттөөнү күтүүдө")}</td><td>{r.backlog.unsorted_total}</td></tr>
              <tr><td>{t("Ответили в чате, но не приняли", "Чатта жооп берилди, бирок кабыл алынган жок")}</td><td>{r.backlog.replied}</td></tr>
              <tr><td>{t("Без ответа", "Жоопсуз")}</td><td>{r.backlog.never_replied}</td></tr>
              <tr><td>{t("Старше 7 дней", "7 күндөн эски")}</td><td>{r.backlog.older_than_7_days}</td></tr>
            </tbody>
          </table>
          <h3 style={{ marginTop: 24, fontSize: 14 }}>{t("Этапы Kommo", "Kommo этаптары")}</h3>
          <div className="table-scroll">
            <table className="admin-table">
              <tbody>
                {r.by_status.map((s) => (
                  <tr key={`${s.pipeline}:${s.status}`}>
                    <td>{s.pipeline} · {s.status}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{stageLabel(s.stage, ru)}</td>
                    <td>{s.leads}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 24, gap: 24, alignItems: "start" }}>
        <div>
          <h3 style={{ fontSize: 14 }}>{t("Менеджеры", "Менеджерлер")}</h3>
          <table className="admin-table">
            <thead>
              <tr><th></th><th>{t("Сделок", "Бүтүмдөр")}</th><th>{t("Продаж", "Сатуулар")}</th><th>{t("Конверсия", "Конверсия")}</th><th>{t("Выручка", "Киреше")}</th></tr>
            </thead>
            <tbody>
              {r.by_manager.map((m) => (
                <tr key={m.manager}>
                  <td className="cell-main">{m.manager === "—" ? t("Не отмечен", "Белгиленген эмес") : m.manager}</td>
                  <td>{m.leads}</td><td>{m.converted}</td><td>{pct(m.converted, m.leads)}</td>
                  <td>{formatCurrency(Number(m.revenue))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 style={{ fontSize: 14 }}>{t("Секции", "Секциялар")}</h3>
          <table className="admin-table">
            <thead>
              <tr><th></th><th>{t("Сделок", "Бүтүмдөр")}</th><th>{t("Продаж", "Сатуулар")}</th><th>{t("Конверсия", "Конверсия")}</th></tr>
            </thead>
            <tbody>
              {r.by_section.map((s) => (
                <tr key={s.section}>
                  <td className="cell-main">{s.section === "—" ? t("Не указана", "Көрсөтүлгөн эмес") : s.section}</td>
                  <td>{s.leads}</td><td>{s.converted}</td><td>{pct(s.converted, s.leads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
};
