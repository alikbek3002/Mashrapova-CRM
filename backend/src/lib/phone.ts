// Нормализация телефонов до E.164 для KG (+996).
// Используется и для логина (pseudo-email), и для хранения в profiles.phone.
//
// Принимает форматы:
//   +996700123456, 996700123456, 0700123456, 700123456
// Возвращает: "+996700123456"
// Бросает исключение, если на выходе не получается валидный +996 + 9 цифр.

const PHONE_DOMAIN = "staff.mashrapov.local";

export const normalizeE164KG = (raw: string | null | undefined): string => {
  if (!raw) throw new Error("phone_required");
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  // Strip non-digit leftovers
  digits = digits.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("996")) {
    // 996 700 123 456 → +996700123456
  } else if (digits.length === 10 && digits.startsWith("0")) {
    // 0 700 123 456 → +996 700 123 456
    digits = "996" + digits.slice(1);
  } else if (digits.length === 9) {
    // 700 123 456 → +996 700 123 456
    digits = "996" + digits;
  } else {
    throw new Error("phone_invalid_format");
  }

  const e164 = "+" + digits;
  if (!/^\+996[0-9]{9}$/.test(e164)) {
    throw new Error("phone_invalid_format");
  }
  return e164;
};

export const phoneToPseudoEmail = (phone: string): string => {
  const e164 = normalizeE164KG(phone);
  // strip "+" — local-part в email не должен начинаться с него
  return `${e164.slice(1)}@${PHONE_DOMAIN}`;
};
