// Двухфакторная аутентификация — ТЗ §12.3.
//
// Способ — TOTP (приложение-аутентификатор: Google Authenticator, Authy,
// встроенный менеджер паролей). SMS-код не подходит: он упирается в
// провайдера, которого у Академии пока нет (§13). Всю механику даёт
// Supabase Auth MFA, своей криптографии здесь нет.
//
// Состояния по документации Supabase:
//   currentLevel aal1, nextLevel aal1 — факторов нет;
//   currentLevel aal1, nextLevel aal2 — фактор есть, но не пройден;
//   currentLevel aal2, nextLevel aal2 — второй фактор пройден.
import { supabase } from "../api/supabase";

export type MfaState =
  /** Факторов нет вовсе. */
  | "none"
  /** Фактор заведён, но в этой сессии ещё не подтверждён — нужен код. */
  | "challenge_required"
  /** Второй фактор пройден. */
  | "verified"
  /** Определить не удалось (нет сети / демо-режим) — не блокируем вход. */
  | "unknown";

export const getMfaState = async (): Promise<MfaState> => {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return "unknown";
  if (data.currentLevel === "aal2") return "verified";
  if (data.nextLevel === "aal2") return "challenge_required";
  return "none";
};

/** Первый подтверждённый TOTP-фактор пользователя, если он есть. */
export const getVerifiedFactorId = async (): Promise<string | null> => {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error || !data) return null;
  const totp = data.totp?.find((f) => f.status === "verified") ?? data.totp?.[0];
  return totp?.id ?? null;
};

/**
 * Заводит новый TOTP-фактор и возвращает QR-код (SVG) с секретом.
 * Фактор остаётся неподтверждённым, пока пользователь не введёт код.
 */
// Supabase отдаёт QR как «data:image/svg+xml;utf-8,<svg…>» с сырым SVG.
// Вставлять его как HTML нельзя (вылезает текст «data:…»), а в <img>
// без кодирования ломается на символах вроде «#». Перекодируем.
const toImgSrc = (qr: string): string => {
  const i = qr.indexOf(",");
  if (!qr.startsWith("data:image/svg+xml") || i < 0) return qr;
  let svg = qr.slice(i + 1);
  try { if (/%3C/i.test(svg)) svg = decodeURIComponent(svg); } catch { /* уже раскодирован */ }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export type TotpEnrollment = {
  factorId: string;
  /** Готовый src для <img>. */
  qrSrc: string;
  /** Секрет для ручного ввода. */
  secret: string;
  /** otpauth://… — на телефоне открывает приложение-аутентификатор. */
  uri: string;
};

export const enrollTotp = async (): Promise<TotpEnrollment> => {
  // Незавершённые попытки накапливаются и мешают: Supabase не даёт
  // завести второй фактор с тем же именем. Чистим брошенные.
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const f of existing?.totp ?? []) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    // Так аккаунт называется в Google Authenticator.
    issuer: "Академия Машрапова",
    friendlyName: `Академия Машрапова ${new Date().toLocaleDateString("ru-RU")} ${Date.now() % 10000}`,
  });
  if (error || !data) throw error ?? new Error("mfa_enroll_failed");
  return { factorId: data.id, qrSrc: toImgSrc(data.totp.qr_code), secret: data.totp.secret, uri: data.totp.uri };
};

/**
 * Подтверждает код из приложения. Используется и при первой настройке,
 * и при каждом входе: шаги одинаковые — challenge, затем verify.
 */
export const verifyTotp = async (factorId: string, code: string): Promise<void> => {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: code.replace(/\s/g, ""),
  });
  if (verify.error) throw verify.error;
};

export const unenrollTotp = async (factorId: string): Promise<void> => {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
};

/** Понятный текст вместо английского сообщения Supabase. */
export const mfaErrorText = (msg: string, ru: boolean): string => {
  const m = msg.toLowerCase();
  if (m.includes("invalid totp code") || m.includes("invalid code")) {
    return ru
      ? "Неверный код. Проверьте, что время на телефоне точное — коды привязаны ко времени."
      : "Код туура эмес. Телефондогу убакытты текшериңиз.";
  }
  if (m.includes("rate limit") || m.includes("too many")) {
    return ru ? "Слишком много попыток. Подождите минуту." : "Аракет көп. Бир аз күтүңүз.";
  }
  return msg;
};
