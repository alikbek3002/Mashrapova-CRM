// Воронка лидов — этапы и нормативы ТЗ §8.
//
// Задачи здесь СЧИТАЮТСЯ из самих лидов, а не читаются из notifications,
// и это не дубль инбокса (admin/Inbox.tsx), а другой горизонт: по §8.3
// менеджер должен видеть, что норматив истекает, ДО того как сработает
// refresh_lead_sla() — она гоняется по расписанию, а не непрерывно.
// Инбокс показывает уже зафиксированные события, воронка — текущую
// просрочку в минутах. Источник правды для срока один: org_settings.
import type { Lead, LeadStage } from "../shared/types/database";

export const FUNNEL_STAGES: LeadStage[] = [
  "new",
  "contacted",
  "trial_booked",
  "trial_attended",
  "converted",
];

// Тупики воронки — показываются отдельно, вне основной цепочки.
export const DEAD_END_STAGES: LeadStage[] = ["no_show", "lost", "waiting"];

export const stageLabel = (s: LeadStage, ru: boolean): string => {
  const map: Record<LeadStage, [string, string]> = {
    new: ["Новый", "Жаңы"],
    contacted: ["Связались", "Байланыштык"],
    trial_booked: ["Записан на пробную", "Сыноого жазылды"],
    trial_attended: ["Пришёл на пробную", "Сыноого келди"],
    no_show: ["Не пришёл", "Келген жок"],
    converted: ["Купил абонемент", "Абонемент алды"],
    lost: ["Отказ", "Баш тартты"],
    waiting: ["Лист ожидания", "Күтүү тизмеси"],
  };
  const [r, k] = map[s];
  return ru ? r : k;
};

export const stageTone = (s: LeadStage): { bg: string; fg: string } => {
  switch (s) {
    case "new":            return { bg: "var(--blue-50)",   fg: "var(--blue-ink)" };
    case "contacted":      return { bg: "var(--blue-50)",   fg: "var(--blue-ink)" };
    case "trial_booked":   return { bg: "var(--yellow-100)", fg: "var(--yellow-ink)" };
    case "trial_attended": return { bg: "var(--yellow-100)", fg: "var(--yellow-ink)" };
    case "converted":      return { bg: "var(--green-100, var(--bg-soft))", fg: "var(--green-ink, var(--ink))" };
    case "no_show":        return { bg: "var(--red-50, var(--bg-soft))", fg: "var(--red-600)" };
    case "lost":           return { bg: "var(--bg-soft)",   fg: "var(--muted)" };
    default:               return { bg: "var(--bg-soft)",   fg: "var(--muted)" };
  }
};

export const sourceLabel = (s: string | null, ru: boolean): string => {
  switch (s) {
    case "target":   return ru ? "Таргет Instagram" : "Instagram таргет";
    case "referral": return ru ? "Рекомендация" : "Сунуштама";
    case "direct":   return ru ? "Прямое обращение" : "Түз кайрылуу";
    case "other":    return ru ? "Другое" : "Башка";
    default:         return "—";
  }
};

// Что именно требует действия прямо сейчас. Порядок = приоритет:
// первым идёт то, что просрочено дольше всего по нормативу.
export type LeadTaskKind =
  | "first_contact_overdue"
  | "trial_reminder"
  | "no_show_call"
  | "conversion_call";

export type LeadTask = {
  kind: LeadTaskKind;
  /** Насколько просрочено/скоро, минут. Отрицательное — ещё впереди. */
  overdueMin: number;
  escalated: boolean;
};

export type LeadSla = {
  firstContactMin: number;
  escalationMin: number;
  noShowHours: number;
};

export const DEFAULT_SLA: LeadSla = {
  firstContactMin: 10,
  escalationMin: 30,
  noShowHours: 3,
};

const minutesSince = (iso: string, now: number) => (now - new Date(iso).getTime()) / 60000;

/**
 * Задача по лиду на момент `now`, или null если делать нечего.
 * Правила — ТЗ §8.2 и §8.3.
 */
export const leadTask = (l: Lead, sla: LeadSla, now: number): LeadTask | null => {
  // §8.3 — первый контакт не позже 10 минут; через 30 минут эскалация.
  if (l.stage === "new" && !l.first_contact_at) {
    const age = minutesSince(l.created_at, now);
    if (age >= sla.firstContactMin) {
      return {
        kind: "first_contact_overdue",
        overdueMin: age - sla.firstContactMin,
        escalated: age >= sla.escalationMin,
      };
    }
    return null;
  }

  // §8.2 — напоминание за 24ч и за 2ч; через 3ч после пробной, если
  // приход не отмечен, — задача позвонить.
  if (l.stage === "trial_booked" && l.trial_at) {
    const minToTrial = (new Date(l.trial_at).getTime() - now) / 60000;
    if (minToTrial < -sla.noShowHours * 60) {
      return { kind: "no_show_call", overdueMin: -minToTrial - sla.noShowHours * 60, escalated: false };
    }
    if (minToTrial <= 24 * 60 && minToTrial > 0) {
      return { kind: "trial_reminder", overdueMin: -minToTrial, escalated: false };
    }
    return null;
  }

  // §8.2 — после пробной позвонить и предложить абонемент.
  if (l.stage === "trial_attended") {
    return { kind: "conversion_call", overdueMin: minutesSince(l.created_at, now), escalated: false };
  }

  return null;
};

export const taskLabel = (task: LeadTask, ru: boolean): string => {
  switch (task.kind) {
    case "first_contact_overdue":
      return ru ? "Просрочен первый контакт" : "Биринчи байланыш кечиктирилди";
    case "trial_reminder":
      return ru ? "Напомнить о пробной" : "Сыноо жөнүндө эскертүү";
    case "no_show_call":
      return ru ? "Не пришёл — позвонить" : "Келген жок — чалуу";
    case "conversion_call":
      return ru ? "Предложить абонемент" : "Абонемент сунуштоо";
  }
};

/** «12 мин», «3 ч 20 мин», «2 дн» — компактно для бейджа. */
export const humanMinutes = (min: number, ru: boolean): string => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} ${ru ? "мин" : "мүн"}`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rest = m % 60;
    return rest ? `${h} ${ru ? "ч" : "с"} ${rest} ${ru ? "мин" : "мүн"}` : `${h} ${ru ? "ч" : "с"}`;
  }
  return `${Math.floor(h / 24)} ${ru ? "дн" : "күн"}`;
};
