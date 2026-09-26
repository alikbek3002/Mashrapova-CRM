// Каталог событий уведомлений — ТЗ §9.1.
//
// Один справочник на три экрана: инбокс задач сотрудника, матрица каналов
// и шаблоны сообщений. Раньше типы событий существовали только строками в
// SQL (`notifications.type`, `notification_matrix.event_type`), и человек
// в интерфейсе видел бы `lead_first_contact_overdue` как есть.
//
// Почему справочник, а не таблица в базе: названия событий — это текст
// интерфейса, он живёт рядом с интерфейсом и переводится на два языка.
// В базе лежит то, что Академия правит сама: галочки каналов и шаблоны.

import type { Lang } from "../data";

/** Кому адресовано событие. Совпадает с notification_matrix.audience. */
export type EventAudience = "client" | "staff";

export type EventMeta = {
  /** Material Symbols. */
  icon: string;
  ru: string;
  ky: string;
  audience: EventAudience;
  /**
   * Событие требует действия сотрудника, а не просто извещает.
   * По таким строкам собирается вкладка «Требуют действия».
   */
  task?: boolean;
  /** Что делать — подсказка под строкой задачи. */
  hintRu?: string;
  hintKy?: string;
  /** Раздел, куда ведёт задача. Совпадает с id пункта меню админки. */
  goTo?: "leads" | "cards" | "kids" | "freezes";
};

export const EVENTS: Record<string, EventMeta> = {
  // ---- Воронка лидов (§8.3) -----------------------------------------
  lead_first_contact_overdue: {
    icon: "call_missed_outgoing",
    ru: "Просрочен первый контакт",
    ky: "Биринчи байланыш кечиктирилди",
    audience: "staff",
    task: true,
    hintRu: "Норматив §8.3 — 10 минут с момента заявки. Позвонить сейчас.",
    hintKy: "Ченем §8.3 — арыздан кийин 10 мүнөт. Азыр чалуу керек.",
    goTo: "leads",
  },
  lead_sla_escalation: {
    icon: "priority_high",
    ru: "Эскалация: лид без контакта",
    ky: "Эскалация: лид байланышсыз",
    audience: "staff",
    task: true,
    hintRu: "Прошло 30 минут, менеджер не связался. Разобраться лично.",
    hintKy: "30 мүнөт өттү, менеджер байланышкан жок. Өзү чечүү керек.",
    goTo: "leads",
  },
  lead_no_show_call: {
    icon: "phone_missed",
    ru: "Не пришёл на пробную",
    ky: "Сыноого келген жок",
    audience: "staff",
    task: true,
    hintRu: "Позвонить и предложить другое время.",
    hintKy: "Чалып, башка убакыт сунуштоо.",
    goTo: "leads",
  },
  lead_conversion_call: {
    icon: "sell",
    ru: "Предложить абонемент",
    ky: "Абонемент сунуштоо",
    audience: "staff",
    task: true,
    hintRu: "Пробная состоялась — это самый тёплый момент для продажи.",
    hintKy: "Сыноо болду — сатуу үчүн эң жылуу учур.",
    goTo: "leads",
  },
  lead_trial_booked: {
    icon: "event_available",
    ru: "Запись на пробную",
    ky: "Сыноого жазылуу",
    audience: "client",
  },
  lead_trial_reminder_24h: {
    icon: "alarm",
    ru: "Напоминание о пробной за 24 ч",
    ky: "Сыноо жөнүндө 24 саат мурун эскертүү",
    audience: "client",
  },
  lead_trial_reminder_2h: {
    icon: "alarm_on",
    ru: "Напоминание о пробной за 2 ч",
    ky: "Сыноо жөнүндө 2 саат мурун эскертүү",
    audience: "client",
  },

  // ---- Срок абонемента (§4.5) ---------------------------------------
  card_renewal_task: {
    icon: "autorenew",
    ru: "Продлить абонемент",
    ky: "Абонементти узартуу",
    audience: "staff",
    task: true,
    hintRu: "Связаться с родителем до окончания срока.",
    hintKy: "Мөөнөт бүткөнгө чейин ата-эне менен байланышуу.",
    goTo: "cards",
  },
  card_used_up: {
    icon: "battery_alert",
    ru: "Израсходована последняя тренировка",
    ky: "Акыркы машыгуу жумшалды",
    audience: "staff",
    task: true,
    hintRu: "Абонемент закрыт по остатку. Предложить продление на ресепшене.",
    hintKy: "Абонемент калдыгы боюнча жабылды. Узартууну сунуштоо.",
    goTo: "cards",
  },
  churn_risk: {
    icon: "trending_down",
    ru: "Риск оттока",
    ky: "Кетип калуу коркунучу",
    audience: "staff",
    task: true,
    hintRu: "Не приходит больше 10 дней (§4.5). Выяснить причину.",
    hintKy: "10 күндөн ашык келбейт (§4.5). Себебин билүү керек.",
    goTo: "kids",
  },
  card_expiring: {
    icon: "schedule",
    ru: "Абонемент заканчивается",
    ky: "Абонемент бүтүп калды",
    audience: "client",
  },
  card_expired: {
    icon: "event_busy",
    ru: "Абонемент закончился",
    ky: "Абонемент бүттү",
    audience: "client",
  },
  card_winback: {
    icon: "favorite",
    ru: "Возвращение клиента (win-back)",
    ky: "Кардарды кайтаруу (win-back)",
    audience: "client",
  },

  // ---- Заморозки (§4.3) ---------------------------------------------
  "freeze.pending": {
    icon: "pause_circle",
    ru: "Заявка на заморозку",
    ky: "Тындырууга арыз",
    audience: "staff",
    task: true,
    hintRu: "Заявку создал тренер или офис — подтвердить или отклонить.",
    hintKy: "Арызды машыктыруучу же офис түздү — тастыктоо же четке кагуу.",
    goTo: "freezes",
  },
  "freeze.approved": {
    icon: "check_circle",
    ru: "Заморозка подтверждена",
    ky: "Тындыруу тастыкталды",
    audience: "client",
  },
  "freeze.rejected": {
    icon: "cancel",
    ru: "Заморозка отклонена",
    ky: "Тындыруу четке кагылды",
    audience: "client",
  },

  // ---- Занятия (§5.3) -----------------------------------------------
  "lesson.cancelled": {
    icon: "event_busy",
    ru: "Тренировка отменена",
    ky: "Машыгуу жокко чыгарылды",
    audience: "client",
  },
  "lesson.rescheduled": {
    icon: "update",
    ru: "Тренировка перенесена",
    ky: "Машыгуу көчүрүлдү",
    audience: "client",
  },
  child_present: {
    icon: "how_to_reg",
    ru: "Ребёнок на тренировке",
    ky: "Бала машыгууда",
    audience: "client",
  },
  child_absent: {
    icon: "person_off",
    ru: "Ребёнок не пришёл",
    ky: "Бала келген жок",
    audience: "client",
  },

  // ---- Рассылка (§9.2) ----------------------------------------------
  broadcast: {
    icon: "campaign",
    ru: "Массовая рассылка",
    ky: "Массалык жөнөтүү",
    audience: "client",
  },
};

/** Неизвестный тип не ломает экран: показываем как есть. */
export const eventMeta = (type: string): EventMeta =>
  EVENTS[type] ?? { icon: "notifications", ru: type, ky: type, audience: "client" };

export const eventLabel = (type: string, lang: Lang): string => {
  const m = eventMeta(type);
  return lang === "ru" ? m.ru : m.ky;
};

export const eventHint = (type: string, lang: Lang): string | null => {
  const m = eventMeta(type);
  return (lang === "ru" ? m.hintRu : m.hintKy) ?? null;
};

/** Задачи сотрудника — по ним собирается вкладка «Требуют действия». */
export const isTaskEvent = (type: string): boolean => eventMeta(type).task === true;

// ---------------------------------------------------------------------
// Строка события из payload
//
// У каждого типа свои ключи (см. refresh_card_notices и refresh_lead_sla),
// поэтому собираем осмысленную фразу, а не печатаем JSON.
// ---------------------------------------------------------------------
const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;
const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const eventSubject = (payload: Record<string, unknown>): string =>
  asStr(payload.child_name) ?? asStr(payload.parent_name) ?? "—";

export const eventDetail = (
  type: string,
  payload: Record<string, unknown>,
  lang: Lang,
): string | null => {
  const ru = lang === "ru";
  const days = asNum(payload.days_left);
  const endDate = asStr(payload.end_date);

  switch (type) {
    case "card_renewal_task": {
      // §4.5 ставит задачу на трёх рубежах, и на рубеже «за 3 дня» ТЗ
      // требует предложить длинный пакет — это разные разговоры.
      const when =
        days === 0
          ? ru ? "заканчивается сегодня" : "бүгүн бүтөт"
          : days === null
            ? null
            : ru ? `осталось ${days} дн.` : `${days} күн калды`;
      const offer =
        payload.offer === "long_package"
          ? ru ? " · предложить длинный пакет" : " · узак пакет сунуштоо"
          : "";
      return [when, endDate ? `до ${endDate}` : null].filter(Boolean).join(", ") + offer;
    }
    case "card_used_up":
      return ru ? "остаток занятий исчерпан" : "машыгуулардын калдыгы бүттү";
    case "churn_risk": {
      const d = asNum(payload.no_visit_days);
      return d === null
        ? null
        : ru ? `не приходит ${d} дн.` : `${d} күн келбейт`;
    }
    case "card_expiring":
    case "card_expired":
    case "card_winback":
      return endDate ? (ru ? `срок до ${endDate}` : `мөөнөтү ${endDate}`) : null;
    case "lead_no_show_call":
    case "lead_trial_booked":
    case "lead_trial_reminder_24h":
    case "lead_trial_reminder_2h": {
      const at = asStr(payload.trial_at);
      return at ? (ru ? `пробная ${at}` : `сыноо ${at}`) : null;
    }
    case "lesson.cancelled": {
      const reason = asStr(payload.reason);
      const date = asStr(payload.date);
      return [date, reason].filter(Boolean).join(" · ") || null;
    }
    case "lesson.rescheduled": {
      const from = asStr(payload.previous_date);
      const to = asStr(payload.new_date);
      return from && to ? `${from} → ${to}` : null;
    }
    default:
      return null;
  }
};
