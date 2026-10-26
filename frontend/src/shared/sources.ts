// Откуда пришёл клиент или лид. Один список для ученика и для лида.
// Те же значения держит CHECK в базе (миграция 20261020000001_client_sources):
// новый вариант добавлять в обоих местах, иначе сохранение упадёт.
// Порядок — как в выпадающем списке: сначала интернет, потом люди, потом офлайн.
import type { ClientSource } from "./types/database";
import type { Lang } from "../data";

export const SOURCE_OPTIONS: { id: ClientSource; ru: string; ky: string }[] = [
  { id: "target",      ru: "Таргет (Instagram)",              ky: "Таргет (Instagram)" },
  { id: "instagram",   ru: "Instagram: страница, сторис",     ky: "Instagram: барак, сторис" },
  { id: "tiktok",      ru: "TikTok",                          ky: "TikTok" },
  { id: "blogger",     ru: "Блогер",                          ky: "Блогер" },
  { id: "maps",        ru: "2ГИС / Google Карты",             ky: "2ГИС / Google Карталар" },
  { id: "messenger",   ru: "WhatsApp / Telegram",             ky: "WhatsApp / Telegram" },
  { id: "referral",    ru: "Рекомендация",                    ky: "Сунуштама" },
  { id: "sibling",     ru: "Брат или сестра уже занимается",  ky: "Бир тууганы мында машыгат" },
  { id: "returning",   ru: "Занимался раньше, вернулся",      ky: "Мурда машыккан, кайра келди" },
  { id: "direct",      ru: "Пришёл сам, увидел вывеску",      ky: "Өзү келди, көрнөктү көрдү" },
  { id: "event",       ru: "Соревнования, мероприятие",       ky: "Мелдеш, иш-чара" },
  { id: "offline_ads", ru: "Листовки, баннер",                ky: "Баракча, баннер" },
  { id: "other",       ru: "Другое",                          ky: "Башка" },
];

export const sourceText = (s: string | null | undefined, lang: Lang): string => {
  const o = SOURCE_OPTIONS.find((x) => x.id === s);
  return o ? o[lang] : "—";
};
