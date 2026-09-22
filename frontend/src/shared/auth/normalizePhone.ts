// Нормализация телефонов до E.164 (+996) и конструирование pseudo-email
// для логина по телефону без SMS. Зеркало backend/src/lib/phone.ts.

const PHONE_DOMAIN = "staff.uniqum.local";

export const normalizeE164KG = (raw: string | null | undefined): string => {
  if (!raw) throw new Error("phone_required");
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");

  if (digits.length === 12 && digits.startsWith("996")) {
    // ok
  } else if (digits.length === 10 && digits.startsWith("0")) {
    digits = "996" + digits.slice(1);
  } else if (digits.length === 9) {
    digits = "996" + digits;
  } else {
    throw new Error("phone_invalid_format");
  }
  const e164 = "+" + digits;
  if (!/^\+996[0-9]{9}$/.test(e164)) throw new Error("phone_invalid_format");
  return e164;
};

export const phoneToPseudoEmail = (phoneRaw: string): string => {
  const e164 = normalizeE164KG(phoneRaw);
  return `${e164.slice(1)}@${PHONE_DOMAIN}`;
};

export const isValidPhoneInput = (raw: string): boolean => {
  try {
    normalizeE164KG(raw);
    return true;
  } catch {
    return false;
  }
};
