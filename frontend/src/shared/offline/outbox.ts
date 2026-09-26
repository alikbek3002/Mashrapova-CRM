// Очередь отложенных операций — ТЗ §12.4 «Офлайн-режим (базовый)».
//
// «Без интернета доступны: просмотр расписания, продажа за наличные,
//  отметка посещений. После восстановления связи данные синхронизируются
//  автоматически.»
//
// Просмотр расписания уже работает: PersistQueryClientProvider держит
// кэш чтения. Здесь — недостающая половина, запись.
//
// Как это устроено
// ----------------
// Операция кладётся в очередь в localStorage и отправляется, когда связь
// есть. Ключ идемпотентности создаётся В МОМЕНТ ПОСТАНОВКИ и не меняется
// при повторах: если соединение оборвалось после отправки, но до ответа,
// мы не знаем, дошёл ли запрос. Повтор с тем же ключом сервер распознаёт
// и возвращает сохранённый ответ (middleware requireIdempotencyKey),
// вместо того чтобы продать абонемент второй раз.
//
// Почему localStorage, а не IndexedDB: операции маленькие (отметки и
// продажа), их единицы, а синхронный доступ избавляет от гонки при
// закрытии вкладки. Если очередь начнёт расти — переезжать в IndexedDB.

import { newKey } from "../api/api-client";

const STORAGE_KEY = "mash_outbox_v1";
/** Больше — значит операция безнадёжна, дальше она только мешает очереди. */
const MAX_ATTEMPTS = 8;

export type OutboxKind = "card.sell" | "attendance.mark";

export type OutboxOp = {
  id: string;
  kind: OutboxKind;
  /** Стабильный ключ идемпотентности; для операций без него — null. */
  idempotencyKey: string | null;
  payload: unknown;
  /** Что показать в списке ожидающих: «Продажа · Иванов Азамат». */
  label: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
};

type Handler = (op: OutboxOp) => Promise<void>;

const handlers = new Map<OutboxKind, Handler>();
const listeners = new Set<(ops: OutboxOp[]) => void>();

export const registerHandler = (kind: OutboxKind, fn: Handler): void => {
  handlers.set(kind, fn);
};

// --------------------------------------------------------------------
// Хранилище
// --------------------------------------------------------------------
const read = (): OutboxOp[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxOp[]) : [];
  } catch {
    // Повреждённая очередь не должна ронять приложение: лучше потерять
    // её, чем не дать войти. Такое бывает при ручной правке хранилища.
    return [];
  }
};

const write = (ops: OutboxOp[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ops));
  } catch {
    // Квота переполнена — очередь не сохранится. Молчать нельзя, но и
    // ронять отметку посещаемости тоже: сообщаем через слушателей.
    console.error("[outbox] не удалось сохранить очередь");
  }
  listeners.forEach((l) => l(ops));
};

export const getOps = (): OutboxOp[] => read();

export const subscribe = (fn: (ops: OutboxOp[]) => void): (() => void) => {
  listeners.add(fn);
  fn(read());
  return () => { listeners.delete(fn); };
};

// --------------------------------------------------------------------
// Постановка в очередь
// --------------------------------------------------------------------
export const enqueue = (
  kind: OutboxKind,
  payload: unknown,
  label: string,
  opts: { idempotent?: boolean } = {},
): OutboxOp => {
  const op: OutboxOp = {
    id: newKey(),
    kind,
    idempotencyKey: opts.idempotent ? newKey() : null,
    payload,
    label,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
  };
  write([...read(), op]);
  return op;
};

export const removeOp = (id: string): void => {
  write(read().filter((o) => o.id !== id));
};

// --------------------------------------------------------------------
// Отправка
// --------------------------------------------------------------------
/**
 * Ошибка окончательная — повторять бессмысленно. 4xx означает, что сервер
 * запрос понял и отверг (нет прав, абонемент уже есть, просрочено окно
 * отметки). Исключения: 408 и 429 — это «попробуй позже».
 */
const isPermanent = (message: string): boolean => {
  const m = /API (\d{3})/.exec(message);
  if (!m) return false;
  const code = Number(m[1]);
  if (code === 408 || code === 429) return false;
  return code >= 400 && code < 500;
};

let flushing = false;

/**
 * Отправляет очередь по порядку. Останавливается на первой временной
 * ошибке: порядок важен (продажа абонемента может опираться на то, что
 * уже ушло раньше), а долбить сервер в офлайне смысла нет.
 */
export const flush = async (): Promise<{ sent: number; failed: number }> => {
  if (flushing) return { sent: 0, failed: 0 };
  flushing = true;
  let sent = 0;
  let failed = 0;
  try {
    // Каждую итерацию перечитываем: пользователь мог добавить операцию,
    // пока мы отправляли предыдущую.
    for (;;) {
      const ops = read();
      const op = ops.find((o) => o.attempts < MAX_ATTEMPTS);
      if (!op) break;

      const handler = handlers.get(op.kind);
      if (!handler) {
        // Обработчик не зарегистрирован — операция из старой версии
        // приложения. Держать её вечно нельзя.
        console.error("[outbox] нет обработчика для", op.kind);
        removeOp(op.id);
        failed += 1;
        continue;
      }

      try {
        await handler(op);
        removeOp(op.id);
        sent += 1;
      } catch (e: unknown) {
        const msg = (e as Error).message ?? String(e);
        const next = read().map((o) =>
          o.id === op.id ? { ...o, attempts: o.attempts + 1, lastError: msg } : o,
        );
        write(next);
        failed += 1;

        if (isPermanent(msg)) {
          // Сервер отверг по существу — повторы не помогут. Убираем из
          // очереди, чтобы она не встала намертво; пользователь увидит
          // причину в списке отклонённых.
          rejectOp(op, msg);
          continue;
        }
        // Временная ошибка (нет сети, 5xx) — прекращаем проход.
        break;
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
};

// --------------------------------------------------------------------
// Отклонённые операции
//
// Их нельзя просто выбросить: офлайн-продажа, которую сервер не принял,
// — это деньги, взятые с клиента. Складываем отдельно, чтобы офис увидел
// и разобрался вручную.
// --------------------------------------------------------------------
const REJECTED_KEY = "mash_outbox_rejected_v1";

export type RejectedOp = OutboxOp & { rejectedAt: string; reason: string };

const rejectOp = (op: OutboxOp, reason: string): void => {
  try {
    const raw = localStorage.getItem(REJECTED_KEY);
    const list: RejectedOp[] = raw ? JSON.parse(raw) : [];
    list.push({ ...op, rejectedAt: new Date().toISOString(), reason });
    // Держим последние 50 — это журнал для разбора, а не архив.
    localStorage.setItem(REJECTED_KEY, JSON.stringify(list.slice(-50)));
  } catch { /* переполнение хранилища не должно ломать отправку */ }
  removeOp(op.id);
};

export const getRejected = (): RejectedOp[] => {
  try {
    const raw = localStorage.getItem(REJECTED_KEY);
    return raw ? (JSON.parse(raw) as RejectedOp[]) : [];
  } catch { return []; }
};

export const clearRejected = (): void => {
  try { localStorage.removeItem(REJECTED_KEY); } catch { /* пусто */ }
  listeners.forEach((l) => l(read()));
};

// --------------------------------------------------------------------
// Автоматическая отправка при восстановлении связи (ТЗ §12.4)
// --------------------------------------------------------------------
let started = false;

export const startOutbox = (): void => {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("online", () => { void flush(); });
  // navigator.onLine врёт при «есть Wi-Fi, но нет интернета», поэтому
  // дополнительно пробуем по таймеру и при возврате на вкладку.
  window.addEventListener("focus", () => { if (navigator.onLine) void flush(); });
  setInterval(() => { if (navigator.onLine && read().length > 0) void flush(); }, 30_000);

  if (navigator.onLine) void flush();
};
