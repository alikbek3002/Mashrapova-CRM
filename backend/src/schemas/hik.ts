import { z } from "zod";

// Нормализованное событие прохода — его шлёт ISUP-сервис (и тесты curl'ом).
// Терминал в режиме прямого HTTP-push шлёт свой родной формат — он
// нормализуется в routes/v1/hik.ts (normalizeHikEvent).
export const hikEventSchema = z.object({
  device_serial: z.string().min(1).max(120),
  person_no: z.string().min(1).max(64).nullish(),
  event_serial: z.coerce.number().int().nonnegative().nullish(),
  event_type: z.enum(["face_ok", "face_fail", "card_ok", "other", "auto_out", "denied"]).default("other"),
  direction: z.enum(["in", "out", "unknown"]).default("unknown"),
  occurred_at: z.string().datetime({ offset: true }),
  raw: z.unknown().optional(),
});

export type HikEvent = z.infer<typeof hikEventSchema>;

export const hikHeartbeatSchema = z.object({
  device_serial: z.string().min(1).max(120),
  ip: z.string().max(64).nullish(),
});
