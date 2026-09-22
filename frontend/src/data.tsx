import type { CSSProperties, ReactElement } from "react";

export type Lang = "ru" | "ky";
export type Role = "admin" | "coach" | "parent";

// 4 направления (категории) с лендинга uniqumsport.kg
export type DirectionId = "lfk" | "gym" | "mart" | "dev";

// 11 реальных секций
export type SectionId =
  | "lfk_spine"
  | "lfk_posture"
  | "lfk_pelvic"
  | "gym_sport"
  | "gym_acro"
  | "gym_aero"
  | "gym_aest"
  | "mart_judo"
  | "mart_tkd"
  | "mart_box"
  | "dev";

export type AttStatus = "present" | "absent" | "excused" | "late" | "makeup";
export type LeadStage = "new" | "trial" | "waiting";

export type Bilingual = { ru: string; ky: string };

export const I18N = {
  ru: {
    roles: {
      admin: "Администрация",
      director: "Директор",
      fitness_director: "Фитнес-директор",
      senior_manager: "Старший менеджер",
      manager: "Менеджер",
      cashier: "Кассир",
      coach: "Тренер",
      parent: "Родитель",
    },
    directions: {
      lfk: "ЛФК",
      gym: "Гимнастика",
      mart: "Единоборства",
      dev: "Развивающая гимнастика",
    },
    sections: {
      lfk_spine: "Здоровая спина и стопы",
      lfk_posture: "Коррекция осанки",
      lfk_pelvic: "Коррекция таза, вальгуса, плоскостопия",
      gym_sport: "Спортивная гимнастика",
      gym_acro: "Акробатика",
      gym_aero: "Аэробная гимнастика",
      gym_aest: "Эстетическая гимнастика",
      mart_judo: "Дзюдо",
      mart_tkd: "Тхэквондо ITF",
      mart_box: "Бокс",
      dev: "Развивающая гимнастика",
    },
    admin: {
      title: "Дашборд",
      subtitle: "Uniqum Sport, Бишкек · сегодня",
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
      fitness_director: "Фитнес-директор",
      senior_manager: "Башкы менеджер",
      manager: "Менеджер",
      cashier: "Кассир",
      coach: "Тренер",
      parent: "Ата-эне",
    },
    directions: {
      lfk: "ДДТ",
      gym: "Гимнастика",
      mart: "Күрөш спорттору",
      dev: "Өнүктүрүүчү гимнастика",
    },
    sections: {
      lfk_spine: "Дени соо омуртка жана таман",
      lfk_posture: "Дене сөөктү түздөө",
      lfk_pelvic: "Таз, вальгус жана жалпак таманды түздөө",
      gym_sport: "Спорттук гимнастика",
      gym_acro: "Акробатика",
      gym_aero: "Аэробдук гимнастика",
      gym_aest: "Эстетикалык гимнастика",
      mart_judo: "Дзюдо",
      mart_tkd: "Тхэквондо ITF",
      mart_box: "Бокс",
      dev: "Өнүктүрүүчү гимнастика",
    },
    admin: {
      title: "Башкы бет",
      subtitle: "Uniqum Sport, Бишкек · бүгүн",
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

export type Direction = { id: DirectionId; color: string; tint: string; dot: string };
export const DIRECTIONS: Direction[] = [
  { id: "lfk",  color: "dir-lfk",  tint: "tint-lfk",  dot: "d-lfk"  },
  { id: "gym",  color: "dir-gym",  tint: "tint-gym",  dot: "d-gym"  },
  { id: "mart", color: "dir-mart", tint: "tint-mart", dot: "d-mart" },
  { id: "dev",  color: "dir-dev",  tint: "tint-dev",  dot: "d-dev"  },
];

export type Section = { id: SectionId; direction: DirectionId; color: string; tint: string; dot: string };
export const SECTIONS: Section[] = [
  { id: "lfk_spine",   direction: "lfk",  color: "sec-lfk-spine",   tint: "tint-lfk-spine",   dot: "s-lfk-spine"   },
  { id: "lfk_posture", direction: "lfk",  color: "sec-lfk-posture", tint: "tint-lfk-posture", dot: "s-lfk-posture" },
  { id: "lfk_pelvic",  direction: "lfk",  color: "sec-lfk-pelvic",  tint: "tint-lfk-pelvic",  dot: "s-lfk-pelvic"  },
  { id: "gym_sport",   direction: "gym",  color: "sec-gym-sport",   tint: "tint-gym-sport",   dot: "s-gym-sport"   },
  { id: "gym_acro",    direction: "gym",  color: "sec-gym-acro",    tint: "tint-gym-acro",    dot: "s-gym-acro"    },
  { id: "gym_aero",    direction: "gym",  color: "sec-gym-aero",    tint: "tint-gym-aero",    dot: "s-gym-aero"    },
  { id: "gym_aest",    direction: "gym",  color: "sec-gym-aest",    tint: "tint-gym-aest",    dot: "s-gym-aest"    },
  { id: "mart_judo",   direction: "mart", color: "sec-mart-judo",   tint: "tint-mart-judo",   dot: "s-mart-judo"   },
  { id: "mart_tkd",    direction: "mart", color: "sec-mart-tkd",    tint: "tint-mart-tkd",    dot: "s-mart-tkd"    },
  { id: "mart_box",    direction: "mart", color: "sec-mart-box",    tint: "tint-mart-box",    dot: "s-mart-box"    },
  { id: "dev",         direction: "dev",  color: "sec-dev",         tint: "tint-dev",         dot: "s-dev"         },
];

export type Kid = {
  id: string;
  name: Bilingual;
  age: number;
  sec: SectionId;
  lessonsLeft: number;
  total: number;
  coach: string;
};

export const KIDS: Kid[] = [
  { id: "k1",  name: { ru: "Алина Жумабекова",   ky: "Алина Жумабекова" },  age: 7,  sec: "gym_aero", lessonsLeft: 6,  total: 8,  coach: "Юлия" },
  { id: "k2",  name: { ru: "Тимур Осмонов",       ky: "Тимур Осмонов" },     age: 9,  sec: "gym_sport", lessonsLeft: 3,  total: 8,  coach: "Тимур Бакир" },
  { id: "k3",  name: { ru: "София Абдыкадыр",     ky: "София Абдыкадыр" },   age: 6,  sec: "gym_aero", lessonsLeft: 2,  total: 8,  coach: "Виталина" },
  { id: "k4",  name: { ru: "Мирлан Кенжебаев",    ky: "Мирлан Кенжебаев" },  age: 8,  sec: "gym_acro", lessonsLeft: 11, total: 24, coach: "Жанна" },
  { id: "k5",  name: { ru: "Ева Темирова",        ky: "Ева Темирова" },      age: 7,  sec: "gym_aero", lessonsLeft: 1,  total: 8,  coach: "Палина" },
  { id: "k6",  name: { ru: "Искендер Бейшеналы",  ky: "Искендер Бейшеналы" },age: 10, sec: "mart_judo", lessonsLeft: 7,  total: 8,  coach: "Борис" },
  { id: "k7",  name: { ru: "Амина Сулайман",      ky: "Амина Сулайман" },    age: 7,  sec: "gym_aest", lessonsLeft: 5,  total: 8,  coach: "Светлана" },
  { id: "k8",  name: { ru: "Давид Калыков",       ky: "Давид Калыков" },     age: 8,  sec: "gym_sport", lessonsLeft: 4,  total: 8,  coach: "Тимур Бакир" },
  { id: "k9",  name: { ru: "Камила Орозбекова",   ky: "Камила Орозбекова" }, age: 6,  sec: "gym_aero", lessonsLeft: 8,  total: 8,  coach: "Юлия" },
  { id: "k10", name: { ru: "Максим Жакыпов",      ky: "Максим Жакыпов" },    age: 9,  sec: "gym_acro", lessonsLeft: 2,  total: 8,  coach: "Палина" },
  { id: "k11", name: { ru: "Айлин Нурланова",     ky: "Айлин Нурланова" },   age: 7,  sec: "gym_aero", lessonsLeft: 4,  total: 8,  coach: "Юлия" },
  { id: "k12", name: { ru: "Эмир Токтосунов",     ky: "Эмир Токтосунов" },   age: 8,  sec: "gym_acro", lessonsLeft: 9,  total: 24, coach: "Жанна" },
];

export type CoachLesson = {
  id: string;
  title: Bilingual;
  sub: Bilingual;
  time: string;
  when: Bilingual;
  enrolled: number;
  present: number | null;
  state: "pending" | "done";
  sec: SectionId;
  kidIds: string[];
};

export type CoachGroup = {
  id: string;
  name: Bilingual;
  sec: SectionId;
  kids: string[];
  schedule: Bilingual;
};

export const ME_COACH = {
  name: { ru: "Юлия Исакова", ky: "Юлия Исакова" } as Bilingual,
  short: "ЮИ",
  section: "gym_aero" as SectionId,
  groups: [
    {
      id: "g1",
      name: { ru: "Ритмическая · 6–7 лет", ky: "Ритмикалык · 6–7 жаш" },
      sec: "gym_aero" as SectionId,
      kids: ["k1", "k9", "k11", "k5"],
      schedule: { ru: "Пн / Ср / Пт · 16:00", ky: "Дш / Ша / Жм · 16:00" },
    },
    {
      id: "g2",
      name: { ru: "Ритмическая · 8–9 лет", ky: "Ритмикалык · 8–9 жаш" },
      sec: "gym_aero" as SectionId,
      kids: ["k3"],
      schedule: { ru: "Пн / Ср / Пт · 17:30", ky: "Дш / Ша / Жм · 17:30" },
    },
  ] as CoachGroup[],
  todayLessons: [
    { id: "l1", title: { ru: "Группа «Звёздочки»", ky: "«Жылдызчалар»" }, sub: { ru: "Ритмическая · Зал 2", ky: "Ритмикалык · 2-зал" }, time: "16:00", when: { ru: "сегодня", ky: "бүгүн" }, enrolled: 8, present: null, state: "pending", sec: "gym_aero", kidIds: ["k1", "k9", "k11", "k5"] },
    { id: "l2", title: { ru: "Группа «Грация»", ky: "«Грация»" }, sub: { ru: "Ритмическая · Зал 2", ky: "Ритмикалык · 2-зал" }, time: "17:30", when: { ru: "сегодня", ky: "бүгүн" }, enrolled: 6, present: null, state: "pending", sec: "gym_aero", kidIds: ["k3"] },
    { id: "l3", title: { ru: "Индивидуальная · Ева Т.", ky: "Жеке · Ева Т." }, sub: { ru: "Мини-группа", ky: "Мини-топ" }, time: "19:00", when: { ru: "сегодня", ky: "бүгүн" }, enrolled: 1, present: null, state: "pending", sec: "gym_aero", kidIds: ["k5"] },
  ] as CoachLesson[],
};

export type ParentKid = Kid & { short: string; color: string };

export const ME_PARENT = {
  name: { ru: "Айгуль", ky: "Айгүл" } as Bilingual,
  kids: [
    { ...KIDS[0], short: "АЖ", color: "linear-gradient(135deg, oklch(0.85 0.17 90), oklch(0.63 0.22 25))" },
    { ...KIDS[3], short: "МК", color: "linear-gradient(135deg, oklch(0.56 0.17 252), oklch(0.72 0.16 160))" },
  ] as ParentKid[],
  upcomingLessons: [
    { id: "ul1", kid: "k1", title: { ru: "Ритмическая", ky: "Ритмикалык" }, sub: { ru: "Тренер Юлия · Зал 2", ky: "Тренер Юлия · 2-зал" }, wd: { ru: "СР", ky: "ША" }, d: 29, time: "16:00–17:30" },
    { id: "ul2", kid: "k1", title: { ru: "Ритмическая", ky: "Ритмикалык" }, sub: { ru: "Тренер Юлия · Зал 2", ky: "Тренер Юлия · 2-зал" }, wd: { ru: "ПТ", ky: "ЖМ" }, d: 1,  time: "16:00–17:30" },
    { id: "ul3", kid: "k1", title: { ru: "Открытый урок", ky: "Ачык сабак" }, sub: { ru: "Для родителей · Зал 1", ky: "Ата-энелер · 1-зал" }, wd: { ru: "СБ", ky: "ИШ" }, d: 2,  time: "11:00–12:00" },
  ],
  achievements: [
    {
      id: "a1",
      title: { ru: "Мост с ноги — выполнен!", ky: "Көпүрө бутунан — аткарылды!" },
      by: { ru: "Тренер Юлия · 22 апреля", ky: "Тренер Юлия · 22 апрель" },
      medal: "gold" as const,
    },
    {
      id: "a2",
      title: { ru: "Шпагат поперечный — 80%", ky: "Тик шпагат — 80%" },
      by: { ru: "Тренер Юлия · 15 апреля", ky: "Тренер Юлия · 15 апрель" },
      medal: "silver" as const,
    },
    {
      id: "a3",
      title: { ru: "Первое выступление на отчётном концерте", ky: "Отчёттук концертте биринчи чыгуу" },
      by: { ru: "Тренер Юлия · 10 апреля", ky: "Тренер Юлия · 10 апрель" },
      medal: "bronze" as const,
    },
  ],
  coachNote: {
    ru: "Алина делает большие успехи в растяжке. На этой неделе попробуем колесо с разбега — принесите, пожалуйста, гетры.",
    ky: "Алина созулууда чоң ийгиликтерге жетишти. Бул жумада чуркап келип дөңгөлөккө аракет кылабыз — гольф алып келсеңиз.",
  } as Bilingual,
  payments: [
    { id: "p1", title: { ru: "Апрель · Ритмическая, 8 занятий", ky: "Апрель · Ритмикалык, 8 сабак" }, date: "02.04.2026", amt: "4 500 с" },
    { id: "p2", title: { ru: "Март · Ритмическая, 8 занятий", ky: "Март · Ритмикалык, 8 сабак" }, date: "03.03.2026", amt: "4 500 с" },
    { id: "p3", title: { ru: "Февраль · Ритмическая, 8 занятий", ky: "Февраль · Ритмикалык, 8 сабак" }, date: "05.02.2026", amt: "4 500 с" },
  ],
  attendance: {
    month: { ru: "Апрель 2026", ky: "Апрель 2026" } as Bilingual,
    days: {
      1: 1, 3: 1, 6: 1, 8: 1, 10: 1, 13: 2, 15: 3, 17: 1, 20: 1, 22: 1, 24: 4, 27: 5, 29: 0,
    } as Record<number, number>,
  },
};

export type CallItem = {
  id: string;
  kidName: Bilingual;
  parent: Bilingual;
  phone: string;
  daysLeft: number;
  sec: SectionId;
  done: boolean;
};

export const CALL_LIST: CallItem[] = [
  { id: "c1", kidName: { ru: "Ева Темирова",      ky: "Ева Темирова" },      parent: { ru: "Айдай Темирова",    ky: "Айдай Темирова" },    phone: "+996 550 44 ·· 12", daysLeft: 1, sec: "gym_aero", done: true },
  { id: "c2", kidName: { ru: "София Абдыкадыр",   ky: "София Абдыкадыр" },   parent: { ru: "Асель Абдыкадыр",   ky: "Асель Абдыкадыр" },   phone: "+996 700 22 ·· 45", daysLeft: 2, sec: "gym_aero", done: false },
  { id: "c3", kidName: { ru: "Максим Жакыпов",     ky: "Максим Жакыпов" },    parent: { ru: "Бектур Жакыпов",    ky: "Бектур Жакыпов" },    phone: "+996 555 19 ·· 80", daysLeft: 3, sec: "gym_acro", done: false },
  { id: "c4", kidName: { ru: "Тимур Осмонов",      ky: "Тимур Осмонов" },     parent: { ru: "Нурсултан Осмонов", ky: "Нурсултан Осмонов" }, phone: "+996 707 33 ·· 02", daysLeft: 4, sec: "gym_sport", done: false },
  { id: "c5", kidName: { ru: "Давид Калыков",      ky: "Давид Калыков" },     parent: { ru: "Айсулуу Калыкова",  ky: "Айсулуу Калыкова" },  phone: "+996 500 71 ·· 91", daysLeft: 5, sec: "gym_sport", done: false },
];

export type Lead = {
  id: string;
  kidName: Bilingual;
  source: string;
  stage: LeadStage;
  age: string;
};

export const LEADS: Lead[] = [
  { id: "ld1", kidName: { ru: "Асель Маматова, 5 л.",    ky: "Асель Маматова, 5 ж." },   source: "Instagram",   stage: "new",     age: "12 мин" },
  { id: "ld2", kidName: { ru: "Ислам Тагаев, 7 л.",       ky: "Ислам Тагаев, 7 ж." },      source: "WhatsApp",    stage: "trial",   age: "1 ч"   },
  { id: "ld3", kidName: { ru: "Милана Уразова, 6 л.",     ky: "Милана Уразова, 6 ж." },    source: "Сарафан",     stage: "waiting", age: "3 ч"   },
  { id: "ld4", kidName: { ru: "Тамерлан Касымов, 9 л.",   ky: "Тамерлан Касымов, 9 ж." },  source: "Google Ads",  stage: "new",     age: "6 ч"   },
];

export type Debtor = {
  id: string;
  kidName: Bilingual;
  sum: string;
  daysLate: number;
  sec: SectionId;
};

export const DEBTORS: Debtor[] = [
  { id: "d1", kidName: { ru: "Мирлан Кенжебаев",  ky: "Мирлан Кенжебаев" },  sum: "3 200 с",  daysLate: 12, sec: "gym_acro" },
  { id: "d2", kidName: { ru: "Амина Сулайман",    ky: "Амина Сулайман" },    sum: "4 500 с",  daysLate: 8,  sec: "gym_aest" },
  { id: "d3", kidName: { ru: "Искендер Бейшеналы",ky: "Искендер Бейшеналы" },sum: "6 000 с",  daysLate: 5,  sec: "mart_judo" },
];

// ============================================================
// Parents — for the "Родители" admin page
// ============================================================
export type Parent = {
  id: string;
  name: Bilingual;
  phone: string;
  email: string;
  kids: string[]; // kid ids
};

export const PARENTS: Parent[] = [
  { id: "pr1", name: { ru: "Айдай Темирова",    ky: "Айдай Темирова" },    phone: "+996 550 44 12 12", email: "aiday.t@gmail.com",     kids: ["k5"] },
  { id: "pr2", name: { ru: "Асель Абдыкадыр",   ky: "Асель Абдыкадыр" },   phone: "+996 700 22 45 45", email: "asel.abd@mail.ru",      kids: ["k3"] },
  { id: "pr3", name: { ru: "Бектур Жакыпов",    ky: "Бектур Жакыпов" },    phone: "+996 555 19 80 80", email: "bektur.j@gmail.com",    kids: ["k10"] },
  { id: "pr4", name: { ru: "Нурсултан Осмонов", ky: "Нурсултан Осмонов" }, phone: "+996 707 33 02 02", email: "n.osmonov@gmail.com",   kids: ["k2"] },
  { id: "pr5", name: { ru: "Айсулуу Калыкова",  ky: "Айсулуу Калыкова" },  phone: "+996 500 71 91 91", email: "a.kalykova@mail.ru",    kids: ["k8"] },
  { id: "pr6", name: { ru: "Айгуль Жумабекова", ky: "Айгүл Жумабекова" },  phone: "+996 555 12 34 56", email: "aigul.j@gmail.com",     kids: ["k1", "k4"] },
  { id: "pr7", name: { ru: "Чолпон Бейшеналы",  ky: "Чолпон Бейшеналы" },  phone: "+996 770 55 01 23", email: "cholpon.b@mail.ru",     kids: ["k6"] },
  { id: "pr8", name: { ru: "Бермет Сулайман",   ky: "Бермет Сулайман" },   phone: "+996 501 09 77 88", email: "bermet.s@gmail.com",    kids: ["k7"] },
  { id: "pr9", name: { ru: "Элида Орозбекова",  ky: "Элида Орозбекова" },  phone: "+996 700 81 11 22", email: "elida.o@mail.ru",       kids: ["k9"] },
  { id: "pr10", name: { ru: "Гулназ Нурланова", ky: "Гүлназ Нурланова" },  phone: "+996 555 60 30 40", email: "gulnaz.n@gmail.com",    kids: ["k11"] },
  { id: "pr11", name: { ru: "Санжар Токтосунов",ky: "Санжар Токтосунов" }, phone: "+996 707 45 67 89", email: "sanjar.t@gmail.com",    kids: ["k12"] },
];

// ============================================================
// Subscription cards — one per kid
// ============================================================
export type CardStatus = "active" | "expiring" | "expired" | "frozen";

export type SubCard = {
  id: string;
  kidId: string;
  sec: SectionId;
  purchased: string; // date
  validUntil: string; // date
  status: CardStatus;
  price: number; // KGS
};

export const CARDS: SubCard[] = [
  { id: "sc1",  kidId: "k1",  sec: "gym_aero", purchased: "01.04.2026", validUntil: "30.04.2026", status: "active",   price: 4500 },
  { id: "sc2",  kidId: "k2",  sec: "gym_sport", purchased: "26.03.2026", validUntil: "26.04.2026", status: "expiring", price: 5000 },
  { id: "sc3",  kidId: "k3",  sec: "gym_aero", purchased: "27.03.2026", validUntil: "25.04.2026", status: "expiring", price: 4500 },
  { id: "sc4",  kidId: "k4",  sec: "gym_acro", purchased: "03.04.2026", validUntil: "03.05.2026", status: "active",   price: 5500 },
  { id: "sc5",  kidId: "k5",  sec: "gym_aero", purchased: "25.03.2026", validUntil: "24.04.2026", status: "expiring", price: 4500 },
  { id: "sc6",  kidId: "k6",  sec: "mart_judo", purchased: "10.04.2026", validUntil: "10.05.2026", status: "active",   price: 5000 },
  { id: "sc7",  kidId: "k7",  sec: "gym_aest", purchased: "05.04.2026", validUntil: "05.05.2026", status: "active",   price: 4800 },
  { id: "sc8",  kidId: "k8",  sec: "gym_sport", purchased: "15.03.2026", validUntil: "15.04.2026", status: "expired",  price: 5000 },
  { id: "sc9",  kidId: "k9",  sec: "gym_aero", purchased: "08.04.2026", validUntil: "08.05.2026", status: "active",   price: 4500 },
  { id: "sc10", kidId: "k10", sec: "gym_acro", purchased: "02.04.2026", validUntil: "02.05.2026", status: "active",   price: 5200 },
  { id: "sc11", kidId: "k11", sec: "gym_aero", purchased: "14.04.2026", validUntil: "14.05.2026", status: "active",   price: 4500 },
  { id: "sc12", kidId: "k12", sec: "gym_acro", purchased: "06.04.2026", validUntil: "06.05.2026", status: "frozen",   price: 5500 },
];

// ============================================================
// Freezes
// ============================================================
export type Freeze = {
  id: string;
  kidId: string;
  sec: SectionId;
  from: string;
  until: string;
  reason: Bilingual;
};

export const FREEZES: Freeze[] = [
  { id: "fz1", kidId: "k12", sec: "gym_acro", from: "14.04.2026", until: "28.04.2026", reason: { ru: "Болезнь", ky: "Ооруп калды" } },
  { id: "fz2", kidId: "k7",  sec: "gym_aest", from: "10.04.2026", until: "24.04.2026", reason: { ru: "Отъезд", ky: "Барбай турат" } },
  { id: "fz3", kidId: "k4",  sec: "gym_acro", from: "18.04.2026", until: "02.05.2026", reason: { ru: "Травма колена", ky: "Тизе жаракат" } },
  { id: "fz4", kidId: "k2",  sec: "gym_sport", from: "20.04.2026", until: "04.05.2026", reason: { ru: "Семейные", ky: "Үй-бүлөлүк" } },
  { id: "fz5", kidId: "k6",  sec: "mart_judo", from: "22.04.2026", until: "06.05.2026", reason: { ru: "Болезнь", ky: "Ооруп калды" } },
  { id: "fz6", kidId: "k9",  sec: "gym_aero", from: "15.04.2026", until: "22.04.2026", reason: { ru: "Болезнь", ky: "Ооруп калды" } },
  { id: "fz7", kidId: "k10", sec: "gym_acro", from: "19.04.2026", until: "03.05.2026", reason: { ru: "Соревнования в Алматы", ky: "Алматыда мелдеш" } },
];

// ============================================================
// Payments (расширенная история платежей)
// ============================================================
export type PayMethod = "cash" | "card" | "mbank" | "optima";
export type PayStatus = "paid" | "pending" | "refund";

export type PaymentRow = {
  id: string;
  date: string;
  kidId: string;
  sec: SectionId;
  period: Bilingual;
  amount: number;
  method: PayMethod;
  status: PayStatus;
};

export const PAYMENTS: PaymentRow[] = [
  { id: "py1",  date: "22.04.2026", kidId: "k1",  sec: "gym_aero", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 4500, method: "mbank",  status: "paid" },
  { id: "py2",  date: "21.04.2026", kidId: "k6",  sec: "mart_judo", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 5000, method: "card",   status: "paid" },
  { id: "py3",  date: "21.04.2026", kidId: "k10", sec: "gym_acro", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 5200, method: "cash",   status: "paid" },
  { id: "py4",  date: "20.04.2026", kidId: "k11", sec: "gym_aero", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 4500, method: "optima", status: "paid" },
  { id: "py5",  date: "20.04.2026", kidId: "k7",  sec: "gym_aest", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 4800, method: "mbank",  status: "paid" },
  { id: "py6",  date: "18.04.2026", kidId: "k4",  sec: "gym_acro", period: { ru: "Апрель · 24 занятий", ky: "Апрель · 24 сабак" },  amount: 5500, method: "card",   status: "paid" },
  { id: "py7",  date: "16.04.2026", kidId: "k9",  sec: "gym_aero", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 4500, method: "cash",   status: "paid" },
  { id: "py8",  date: "14.04.2026", kidId: "k1",  sec: "gym_aero", period: { ru: "Открытый урок", ky: "Ачык сабак" },               amount: 500,  method: "mbank",  status: "pending" },
  { id: "py9",  date: "12.04.2026", kidId: "k3",  sec: "gym_aero", period: { ru: "Март · 8 занятий", ky: "Март · 8 сабак" },        amount: 4500, method: "card",   status: "refund" },
  { id: "py10", date: "10.04.2026", kidId: "k12", sec: "gym_acro", period: { ru: "Апрель · 24 занятий", ky: "Апрель · 24 сабак" },  amount: 5500, method: "mbank",  status: "paid" },
  { id: "py11", date: "08.04.2026", kidId: "k2",  sec: "gym_sport", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 5000, method: "card",   status: "paid" },
  { id: "py12", date: "05.04.2026", kidId: "k5",  sec: "gym_aero", period: { ru: "Апрель · 8 занятий", ky: "Апрель · 8 сабак" },    amount: 4500, method: "cash",   status: "paid" },
];

// ============================================================
// Coaches
// ============================================================
export type CoachRow = {
  id: string;
  name: Bilingual;
  short: string;
  sec: SectionId;
  groups: number;
  kids: number;
  avg: number;
  exp: number; // years
};

export const COACHES: CoachRow[] = [
  { id: "co1", name: { ru: "Юлия Исакова",     ky: "Юлия Исакова" },     short: "ЮИ", sec: "gym_aero", groups: 3, kids: 24, avg: 92, exp: 8 },
  { id: "co2", name: { ru: "Тимур Бакиров",    ky: "Тимур Бакиров" },    short: "ТБ", sec: "gym_sport", groups: 2, kids: 18, avg: 89, exp: 12 },
  { id: "co3", name: { ru: "Жанна Асанова",    ky: "Жанна Асанова" },    short: "ЖА", sec: "gym_acro", groups: 2, kids: 16, avg: 81, exp: 6 },
  { id: "co4", name: { ru: "Светлана Беккулова", ky: "Светлана Беккулова" }, short: "СБ", sec: "gym_aest", groups: 2, kids: 14, avg: 90, exp: 5 },
  { id: "co5", name: { ru: "Палина Ким",       ky: "Палина Ким" },       short: "ПК", sec: "gym_acro", groups: 2, kids: 12, avg: 76, exp: 4 },
  { id: "co6", name: { ru: "Борис Семёнов",    ky: "Борис Семёнов" },    short: "БС", sec: "mart_judo", groups: 3, kids: 22, avg: 84, exp: 10 },
  { id: "co7", name: { ru: "Виталина Орлова",  ky: "Виталина Орлова" },  short: "ВО", sec: "gym_aero", groups: 1, kids: 8,  avg: 88, exp: 3 },
];

export type CalEvent = {
  id: string;
  day: number;
  start: number;
  dur: number;
  title: string;
  sub: string;
  sec: SectionId;
};

export const CAL_EVENTS: CalEvent[] = [
  { id: "e1", day: 0, start: 1, dur: 1.5, title: "СГ · Тимур", sub: "Группа 1 · 12 детей", sec: "gym_sport" },
  { id: "e2", day: 0, start: 3, dur: 1.5, title: "РГ · Юлия", sub: "Звёздочки · 8 детей", sec: "gym_aero" },
  { id: "e3", day: 1, start: 1, dur: 1, title: "АГ · Жанна", sub: "Группа 3", sec: "gym_acro" },
  { id: "e4", day: 1, start: 2.5, dur: 1.5, title: "ЭГ · Светлана", sub: "10 детей", sec: "gym_aest" },
  { id: "e5", day: 2, start: 1, dur: 1.5, title: "СГ · Тимур", sub: "Группа 1", sec: "gym_sport" },
  { id: "e6", day: 2, start: 3, dur: 1.5, title: "РГ · Юлия", sub: "Звёздочки", sec: "gym_aero" },
  { id: "e7", day: 2, start: 5, dur: 1, title: "КА · Палина", sub: "Группа 2", sec: "gym_acro" },
  { id: "e8", day: 3, start: 1.5, dur: 1, title: "ЕБ · Борис", sub: "Группа 1", sec: "mart_judo" },
  { id: "e9", day: 3, start: 3, dur: 1.5, title: "АГ · Жанна", sub: "Группа 3", sec: "gym_acro" },
  { id: "e10", day: 4, start: 1, dur: 1.5, title: "СГ · Тимур", sub: "Группа 1", sec: "gym_sport" },
  { id: "e11", day: 4, start: 3, dur: 1.5, title: "РГ · Юлия", sub: "Звёздочки", sec: "gym_aero" },
  { id: "e12", day: 4, start: 5, dur: 1, title: "ЕБ · Борис", sub: "Группа 2", sec: "mart_judo" },
  { id: "e13", day: 5, start: 0.5, dur: 1, title: "Открытый урок", sub: "Все секции", sec: "gym_aest" },
  { id: "e14", day: 5, start: 2, dur: 1.5, title: "КА · Палина", sub: "Сборная", sec: "gym_acro" },
];

// Посещаемость по направлениям (4 направления: ЛФК, Гимнастика, Единоборства, Развивающая)
export const ATTENDANCE_BY_DIR: { id: DirectionId; value: number }[] = [
  { id: "lfk",  value: 89 },
  { id: "gym",  value: 87 },
  { id: "mart", value: 84 },
  { id: "dev",  value: 92 },
];

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

export const UniqumLogo = ({ size = 34 }: { size?: number }): ReactElement => (
  <div className="brand__mark" style={{ height: size }} aria-label="Uniqum Sport">
    <img src="/uniqum-logo.png" alt="Uniqum Sport" style={{ height: size, width: "auto", display: "block" }} />
  </div>
);
