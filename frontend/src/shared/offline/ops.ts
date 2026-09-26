// Операции, которые умеют выполняться из офлайн-очереди — ТЗ §12.4.
//
// По ТЗ офлайн нужны три вещи: просмотр расписания (даёт кэш чтения),
// продажа за наличные и отметка посещений. Здесь — исполнители для
// последних двух. Они же вызываются и в обычном онлайн-режиме, чтобы
// путь записи был один и тот же: иначе офлайн-ветка неизбежно начнёт
// расходиться с основной.
import { supabase } from "../api/supabase";
import { apiPost } from "../api/api-client";
import { registerHandler, type OutboxOp } from "./outbox";

// --------------------------------------------------------------------
// Отметка посещаемости
// --------------------------------------------------------------------
export type AttendanceMarkPayload = {
  lessonId: string;
  marks: { child_id: string; status: string }[];
  markedBy: string | null;
  /** Время фактической отметки, а не отправки: тренер отметил в зале, */
  /** а синхронизация случилась вечером дома. */
  markedAt: string;
};

export type AttendanceWriteResult = { failedIds: string[]; failedNames: string[] };

/**
 * Пишет отметки: удаляет прежние по этим детям в этом занятии и
 * вставляет новые. Повтор безопасен — результат тот же, поэтому для
 * очереди отдельный ключ идемпотентности не нужен.
 */
export const writeAttendanceMarks = async (
  p: AttendanceMarkPayload,
): Promise<AttendanceWriteResult> => {
  const rows = p.marks.map((m) => ({
    lesson_id: p.lessonId,
    child_id: m.child_id,
    status: m.status,
    marked_by: p.markedBy,
    marked_at: p.markedAt,
  }));

  const childIds = p.marks.map((m) => m.child_id);
  const { error: dErr } = await supabase
    .from("attendance")
    .delete()
    .eq("lesson_id", p.lessonId)
    .in("child_id", childIds);
  if (dErr) throw dErr;

  const { error } = await supabase.from("attendance").insert(rows);
  if (!error) return { failedIds: [], failedNames: [] };

  // Пакет не прошёл целиком (RLS или триггер заморозки у одного ребёнка
  // валит весь insert) — сохраняем построчно и называем, кто не прошёл.
  const failedIds: string[] = [];
  let lastMsg = error.message;
  for (const r of rows) {
    const { error: e1 } = await supabase.from("attendance").insert(r);
    if (e1) { failedIds.push(r.child_id); lastMsg = e1.message; }
  }
  if (failedIds.length === rows.length) {
    throw new Error(/row-level security|42501/i.test(lastMsg)
      ? "У выбранных детей нет абонемента или записи в группу на эту дату"
      : lastMsg);
  }
  const { data: kids } = await supabase.from("children").select("id, full_name").in("id", failedIds);
  return { failedIds, failedNames: (kids ?? []).map((k) => k.full_name) };
};

// --------------------------------------------------------------------
// Продажа абонемента
// --------------------------------------------------------------------
export type CardSellPayload = { body: unknown };

export const sellCardRequest = async (body: unknown, idempotencyKey: string): Promise<unknown> =>
  apiPost<unknown>("/v1/cards/sell", body, { idempotencyKey });

// --------------------------------------------------------------------
// Регистрация обработчиков очереди
// --------------------------------------------------------------------
let registered = false;

export const registerOutboxHandlers = (): void => {
  if (registered) return;
  registered = true;

  registerHandler("attendance.mark", async (op: OutboxOp) => {
    await writeAttendanceMarks(op.payload as AttendanceMarkPayload);
  });

  registerHandler("card.sell", async (op: OutboxOp) => {
    const { body } = op.payload as CardSellPayload;
    if (!op.idempotencyKey) throw new Error("card.sell без ключа идемпотентности");
    await sellCardRequest(body, op.idempotencyKey);
  });
};
