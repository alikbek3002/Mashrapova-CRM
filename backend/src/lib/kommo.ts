// HTTP-клиент Kommo API v4 — ТЗ §13.
//
// Приватная интеграция с долгосрочным токеном (до 5 лет, без refresh):
// для одного аккаунта Академии OAuth-обмен кодами не нужен.
//
// Лимит Kommo — 7 запросов в секунду с одного IP. При превышении 429, при
// повторных нарушениях IP блокируется и всё отвечает 403. Поэтому все
// запросы идут строго по одному с паузой ≥ 200 мс (≤ 5 в секунду).
import { env } from "./env.js";

export const kommoConfigured = Boolean(env.KOMMO_BASE_URL && env.KOMMO_TOKEN);

export class KommoError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const MIN_GAP_MS = 200;
const MAX_ATTEMPTS = 5;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Очередь: следующий запрос стартует не раньше, чем через MIN_GAP_MS после
// предыдущего, даже если синхронизацию запустили параллельно.
let gate: Promise<void> = Promise.resolve();
const throttle = () => {
  const turn = gate.then(() => sleep(MIN_GAP_MS));
  gate = turn;
  return turn;
};

/** GET к API. 204 (пусто) → null. 429, 5xx и обрыв сети повторяются. */
export const kommoGet = async <T>(path: string): Promise<T | null> => {
  if (!kommoConfigured) throw new KommoError(503, "kommo_not_configured");
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(`${env.KOMMO_BASE_URL}${path}`, {
        headers: { Authorization: `Bearer ${env.KOMMO_TOKEN}` },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await sleep(2_000 * attempt);
      continue;
    }
    if (res.status === 204) return null;
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      lastError = `HTTP ${res.status}`;
      await sleep(3_000 * attempt);
      continue;
    }
    // 401 — токен отозван или истёк; 403 — IP заблокирован. Повтор не поможет.
    const body = await res.text().catch(() => "");
    throw new KommoError(res.status, `kommo ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  throw new KommoError(502, `kommo retries exhausted ${path}: ${lastError}`);
};

type Page<K extends string, T> = {
  _embedded?: Record<K, T[]>;
  _links?: { next?: { href: string } };
};

/** Все страницы списка. limit у Kommo — до 250 (у событий — до 100). */
export const kommoGetAll = async <T>(path: string, key: string, limit = 250): Promise<T[]> => {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; ; page++) {
    const data = await kommoGet<Page<string, T>>(`${path}${sep}limit=${limit}&page=${page}`);
    const items = data?._embedded?.[key] ?? [];
    out.push(...items);
    if (!data?._links?.next || items.length === 0) break;
  }
  return out;
};
