import type { CSSProperties, ReactElement } from "react";

export type Lang = "ru" | "ky";
export type Role = "admin" | "coach" | "parent";

// Направления (sections.category): единоборства и фитнес-зона
export type DirectionId = "mart" | "fit";


export type AttStatus = "present" | "absent" | "excused" | "late" | "makeup";
export type LeadStage = "new" | "trial" | "waiting";

export type Bilingual = { ru: string; ky: string };

export const I18N = {
  ru: {
    roles: {
      admin: "Администрация",
      director: "Директор",
      fitness_director: "Управляющий",
      senior_manager: "Старший менеджер",
      manager: "Менеджер",
      cashier: "Ресепшен",
      coach: "Тренер",
      parent: "Родитель",
    },
    directions: {
      mart: "Единоборства",
      fit: "Фитнес-зона",
    },
    admin: {
      title: "Дашборд",
      subtitle: "Академия Машрапова, Ош · сегодня",
      today: "Сегодня",
      newLesson: "Новое занятие",
      nav: {
        dash: "Дашборд",
        kids: "Дети",
        parents: "Родители",
        schedule: "Расписание",
        cards: "Абонементы",
        freezes: "Заморозки",
        payments: "Платежи",
        leads: "Воронка",
        coaches: "Тренеры",
        coachRates: "Ставки тренеров",
        payroll: "Зарплаты",
        refunds: "Возвраты",
        sections: "Секции",
        groups: "Группы",
        settings: "Настройки",
        archive: "Архив",
      },
      section: { operations: "ОПЕРАЦИИ", analytics: "АНАЛИТИКА", setup: "НАСТРОЙКИ" },
      kpi: {
        activeKids: "Активных детей",
        revenue: "Выручка, апрель",
        attendance: "Посещаемость",
        expiring: "Истекают < 5 дней",
        vs: "к марту",
      },
      callList: { title: "Надо позвонить сегодня", sub: "Абонементы истекают в ближайшие 5 дней", days: "дн." },
      leads: { title: "Новые лиды", sub: "Из amoCRM · за 24 часа", trial: "Пробное", new: "Новый", waiting: "Ожидает" },
      debtors: { title: "Должники", sub: "Ходят, но не оплатили", days: "дн." },
      calendar: { title: "Расписание недели", sub: "28 апр — 4 мая 2026" },
      attendance: { title: "Посещаемость по секциям", sub: "За последние 30 дней" },
    },
    coach: {
      hello: "С возвращением,",
      today: "Сегодня",
      myGroups: "Мои группы",
      tabel: "Табель месяца",
      lessons: "занятий",
      kids: "детей",
      present: "присут.",
      markAll: "Отметить всех",
      pending: "Не отмечено",
      done: "Готово",
      save: "Сохранить",
      mark: "Отметить посещения",
      avg: "Ср. посещ.",
      nextLessons: "Следующие занятия",
    },
    parent: {
      hello: "Доброе утро,",
      lessonsLeft: "Осталось занятий",
      validUntil: "Действует до",
      of: "из",
      nextLesson: "Ближайшее занятие",
      schedule: "Расписание",
      attendance: "Посещения",
      achievements: "Успехи",
      payments: "Платежи",
      contact: "Связь с клубом",
      writeWA: "Написать в WhatsApp",
      writeWASub: "Менеджер ответит в рабочее время",
      call: "Позвонить в клуб",
      callSub: "+996 555 123 456",
      history: "История",
      paidFor: "Оплата за",
      legendPresent: "Была",
      legendAbsent: "Не была",
      legendExcused: "Уважит.",
      legendLate: "Опоздала",
      legendMakeup: "Отработка",
    },
    status: {
      present: "Пришёл",
      absent: "Не пришёл",
      excused: "Уважит.",
      late: "Опоздал",
      makeup: "Отработка",
    },
    tabbar: { home: "Главная", schedule: "Расписание", card: "Абонемент", deposit: "Счёт", stats: "Посещения", notes: "Заметки", profile: "Связь" },
    coachTabbar: { today: "Сегодня", tabel: "Табель", groups: "Группы", salary: "Зарплата", profile: "Я" },
    weekdays: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"],
    monthsGen: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  },
  ky: {
    roles: {
      admin: "Администрация",
      director: "Директор",
      fitness_director: "Башкаруучу",
      senior_manager: "Башкы менеджер",
      manager: "Менеджер",
      cashier: "Ресепшен",
      coach: "Тренер",
      parent: "Ата-эне",
    },
    directions: {
      mart: "Күрөш спорттору",
      fit: "Фитнес-зона",
    },
    admin: {
      title: "Башкы бет",
      subtitle: "Машрапов академиясы, Ош · бүгүн",
      today: "Бүгүн",
      newLesson: "Жаңы сабак",
      nav: {
        dash: "Башкы бет",
        kids: "Балдар",
        parents: "Ата-энелер",
        schedule: "Жадыбал",
        cards: "Абонементтер",
        freezes: "Тындыруулар",
        payments: "Төлөмдөр",
        leads: "Сатуу каналы",
        coaches: "Тренерлер",
        coachRates: "Тренер ставкалары",
        payroll: "Эмгек акы",
        refunds: "Кайтаруулар",
        sections: "Секциялар",
        groups: "Топтор",
        settings: "Жөндөөлөр",
        archive: "Архив",
      },
      section: { operations: "ОПЕРАЦИЯЛАР", analytics: "АНАЛИТИКА", setup: "ЖӨНДӨӨЛӨР" },
      kpi: {
        activeKids: "Активдүү балдар",
        revenue: "Киреше, апрель",
        attendance: "Катышуу",
        expiring: "5 күндөн аз калды",
        vs: "мартка салыштырмалуу",
      },
      callList: { title: "Бүгүн чалуу керек", sub: "Абонемент жакын 5 күндө бүтөт", days: "күн" },
      leads: { title: "Жаңы арыздар", sub: "amoCRM'ден · 24 саат ичинде", trial: "Сыноо сабак", new: "Жаңы", waiting: "Күтүүдө" },
      debtors: { title: "Карыздар", sub: "Катышат, бирок төлөнгөн эмес", days: "күн" },
      calendar: { title: "Бул жуманын жадыбалы", sub: "28 апр — 4 май 2026" },
      attendance: { title: "Секциялар боюнча катышуу", sub: "Акыркы 30 күндө" },
    },
    coach: {
      hello: "Кош келдиңиз,",
      today: "Бүгүн",
      myGroups: "Менин топторум",
      tabel: "Айлык табель",
      lessons: "сабак",
      kids: "бала",
      present: "кел.",
      markAll: "Бардыгын белгилөө",
      pending: "Белгиленген жок",
      done: "Даяр",
      save: "Сактоо",
      mark: "Катышууну белгилөө",
      avg: "Орт. катышуу",
      nextLessons: "Кийинки сабактар",
    },
    parent: {
      hello: "Кутман таң,",
      lessonsLeft: "Калган сабак",
      validUntil: "Мөөнөтү",
      of: "ичинен",
      nextLesson: "Жакынкы сабак",
      schedule: "Жадыбал",
      attendance: "Катышуу",
      achievements: "Жетишкендиктер",
      payments: "Төлөмдөр",
      contact: "Клуб менен байланыш",
      writeWA: "WhatsApp жазуу",
      writeWASub: "Менеджер жумуш убагында жооп берет",
      call: "Клубка чалуу",
      callSub: "+996 555 123 456",
      history: "Тарых",
      paidFor: "Төлөм",
      legendPresent: "Келди",
      legendAbsent: "Келген жок",
      legendExcused: "Жүйөлүү",
      legendLate: "Кечикти",
      legendMakeup: "Иштеп бер.",
    },
    status: {
      present: "Келди",
      absent: "Келген жок",
      excused: "Жүйөлүү",
      late: "Кечикти",
      makeup: "Иштеп бер.",
    },
    tabbar: { home: "Башкы", schedule: "Жадыбал", card: "Абонемент", deposit: "Эсеп", stats: "Катышуу", notes: "Жазма", profile: "Байланыш" },
    coachTabbar: { today: "Бүгүн", tabel: "Табель", groups: "Топтор", salary: "Эмгек акы", profile: "Мен" },
    weekdays: ["Дш", "Ше", "Ша", "Бш", "Жм", "Иш", "Жш"],
    monthsGen: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
  },
};


// ============================================================
// Icons (inline SVG)
// ============================================================
export type IconProps = {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
};

export const Icon = ({ name, size = 18, stroke = 1.75, className = "", style }: IconProps): ReactElement | null => {
  const s: CSSProperties = { width: size, height: size, ...style };
  const p = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "dashboard": return (<svg viewBox="0 0 24 24" style={s} className={className}><rect x="3" y="3" width="7" height="9" rx="2" {...p}/><rect x="14" y="3" width="7" height="5" rx="2" {...p}/><rect x="14" y="12" width="7" height="9" rx="2" {...p}/><rect x="3" y="16" width="7" height="5" rx="2" {...p}/></svg>);
    case "kids": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="9" cy="8" r="3" {...p}/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p}/><circle cx="17" cy="10" r="2" {...p}/><path d="M15 20c0-2.2 1.8-4 4-4" {...p}/></svg>);
    case "parents": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="8" cy="7" r="3" {...p}/><circle cx="17" cy="9" r="2.5" {...p}/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p}/><path d="M14 19c0-2.8 1.7-5 4-5" {...p}/></svg>);
    case "calendar": return (<svg viewBox="0 0 24 24" style={s} className={className}><rect x="3" y="4" width="18" height="17" rx="3" {...p}/><path d="M3 9h18" {...p}/><path d="M8 2v4M16 2v4" {...p}/></svg>);
    case "card": return (<svg viewBox="0 0 24 24" style={s} className={className}><rect x="3" y="6" width="18" height="13" rx="3" {...p}/><path d="M3 11h18" {...p}/></svg>);
    case "freeze": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M12 2v20M4 6l16 12M20 6 4 18M7 4l5 3 5-3M7 20l5-3 5 3M2 12h20" {...p}/></svg>);
    case "wallet": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 7a3 3 0 0 1 3-3h11v4" {...p}/><path d="M3 7v11a3 3 0 0 0 3 3h14V7" {...p}/><circle cx="17" cy="14" r="1.5" fill="currentColor" stroke="none"/></svg>);
    case "funnel": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 4h18l-7 9v7l-4-2v-5L3 4z" {...p}/></svg>);
    case "trending-down": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 7l7 7 4-4 7 7" {...p}/><path d="M21 17v-6h-6" {...p}/></svg>);
    case "whistle": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="10" cy="14" r="6" {...p}/><path d="M16 14h6l-4-6" {...p}/><path d="M10 10V6" {...p}/></svg>);
    case "tag": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M20 12 12 4H4v8l8 8 8-8z" {...p}/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>);
    case "settings": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="12" cy="12" r="3" {...p}/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.1a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.1a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p}/></svg>);
    case "plus": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M12 5v14M5 12h14" {...p}/></svg>);
    case "search": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="11" cy="11" r="7" {...p}/><path d="m20 20-3.5-3.5" {...p}/></svg>);
    case "phone": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.86.31 1.7.58 2.51a2 2 0 0 1-.45 2.11L8 9.5a16 16 0 0 0 6 6l1.16-1.16a2 2 0 0 1 2.11-.45c.81.27 1.65.46 2.51.58A2 2 0 0 1 22 16.92z" {...p}/></svg>);
    case "whatsapp": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 21l1.6-5A8.5 8.5 0 1 1 8 19.4L3 21z" {...p}/><path d="M8.5 9c.5 1.5 1.5 2.5 3 3.5 1 .7 2 .5 2.5 0l.8-.8 2 1.2" {...p}/></svg>);
    case "voice": return (<svg viewBox="0 0 24 24" style={s} className={className}><rect x="9" y="3" width="6" height="12" rx="3" {...p}/><path d="M5 11a7 7 0 0 0 14 0" {...p}/><path d="M12 18v3" {...p}/></svg>);
    case "check": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="m5 12 5 5L20 7" {...p}/></svg>);
    case "x": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="m6 6 12 12M6 18 18 6" {...p}/></svg>);
    case "clock": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="12" cy="12" r="9" {...p}/><path d="M12 7v5l3 2" {...p}/></svg>);
    case "warn": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" {...p}/><path d="M12 9v4M12 17h.01" {...p}/></svg>);
    case "home": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2V10z" {...p}/></svg>);
    case "trophy": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" {...p}/><path d="M7 7H4v2a3 3 0 0 0 3 3M17 7h3v2a3 3 0 0 1-3 3M9 21h6M12 14v7" {...p}/></svg>);
    case "user": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="12" cy="8" r="4" {...p}/><path d="M4 21c0-4 4-7 8-7s8 3 8 7" {...p}/></svg>);
    case "bell": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8z" {...p}/><path d="M10 21a2 2 0 0 0 4 0" {...p}/></svg>);
    case "chevron-right": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="m9 6 6 6-6 6" {...p}/></svg>);
    case "chevron-left": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="m15 6-6 6 6 6" {...p}/></svg>);
    case "download": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M12 3v13m0 0-4-4m4 4 4-4M5 21h14" {...p}/></svg>);
    case "filter": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" {...p}/></svg>);
    case "sparkle": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8" {...p}/></svg>);
    case "more": return (<svg viewBox="0 0 24 24" style={s} className={className}><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>);
    case "archive": return (<svg viewBox="0 0 24 24" style={s} className={className}><rect x="3" y="4" width="18" height="4" rx="1" {...p}/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" {...p}/><path d="M10 12h4" {...p}/></svg>);
    case "restore": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 12a9 9 0 1 0 3-6.7" {...p}/><path d="M3 4v5h5" {...p}/></svg>);
    case "trash": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M4 7h16" {...p}/><path d="M9 7V4h6v3" {...p}/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" {...p}/><path d="M10 11v7M14 11v7" {...p}/></svg>);
    case "eye": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></svg>);
    case "eye-off": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M3 3l18 18" {...p}/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" {...p}/><path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1" {...p}/><path d="M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1" {...p}/></svg>);
    case "note": return (<svg viewBox="0 0 24 24" style={s} className={className}><path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" {...p}/><path d="M14 3v5h5" {...p}/><path d="M8 13h8M8 17h5" {...p}/></svg>);
    default: return null;
  }
};

// Material Symbols (Google Icons) — выводит глифовый шрифт `Material Symbols Rounded`.
// Сам шрифт подключается в frontend/index.html, стили — в styles.css.
export type MIconProps = {
  name: string;
  size?: number;
  fill?: boolean;
  weight?: 300 | 400 | 500 | 600 | 700;
  className?: string;
  style?: CSSProperties;
};

export const MIcon = ({ name, size = 22, fill = false, weight = 400, className = "", style }: MIconProps): ReactElement => (
  <span
    className={`material-symbols-rounded ${className}`}
    aria-hidden
    style={{
      fontSize: size,
      lineHeight: 1,
      fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' 24`,
      ...style,
    }}
  >
    {name}
  </span>
);

export type MedalProps = { variant?: "gold" | "silver" | "bronze"; size?: number };

export const Medal = ({ variant = "gold", size = 48 }: MedalProps): ReactElement => {
  const palette = {
    gold:   { ring: "#F4B90D", inner: "#FFE48A", star: "#8A5A00", ribbon: "#2148C0" },
    silver: { ring: "#B7BFCF", inner: "#E1E6EF", star: "#4B5872", ribbon: "#D94A2A" },
    bronze: { ring: "#C17644", inner: "#EAB48A", star: "#5D3112", ribbon: "#1E3A8A" },
  }[variant];
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden>
      <path d="M14 4l5 12h10L34 4h-6l-4 8-4-8h-6z" fill={palette.ribbon}/>
      <circle cx="24" cy="30" r="14" fill={palette.ring}/>
      <circle cx="24" cy="30" r="10" fill={palette.inner}/>
      <path d="M24 22l2.2 4.5 5 .7-3.6 3.5.9 4.9L24 33.4 19.5 35.6l.9-4.9-3.6-3.5 5-.7L24 22z" fill={palette.star}/>
    </svg>
  );
};

export const BrandLogo = ({ size = 34 }: { size?: number }): ReactElement => (
  <div className="brand__mark" style={{ height: size }} aria-label="Академия Машрапова">
    <img src="/logo.png" alt="Академия Машрапова" style={{ height: size, width: size, display: "block" }} />
  </div>
);
