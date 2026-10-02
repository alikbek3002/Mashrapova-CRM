import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { env } from "../../lib/env.js";
import { kommoConfigured } from "../../lib/kommo.js";
import { scheduleKommoSync, syncKommo } from "../../lib/kommo-sync.js";

const syncBody = z.object({ full: z.boolean().optional() }).optional();

const secretMatches = (given: string) => {
  const expected = env.KOMMO_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const kommoRoutes = async (app: FastifyInstance) => {
  // Kommo шлёт вебхуки как application/x-www-form-urlencoded. Тело нам не
  // нужно — вебхук только запускает синхронизацию, данные берутся из API.
  // Парсер объявлен внутри плагина и на остальные маршруты не влияет.
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    done(null, body);
  });

  // POST /v1/kommo/sync — синхронизация вручную (кнопка в отчётах).
  // full: true — перечитать всю историю; только руководителям: это сотни
  // запросов к Kommo.
  app.post(
    "/v1/kommo/sync",
    { preHandler: [authenticate, requireRole("director", "fitness_director", "senior_manager", "manager")] },
    async (req, reply) => {
      if (!kommoConfigured) return reply.code(503).send({ error: "kommo_not_configured" });
      const parsed = syncBody.safeParse(req.body ?? undefined);
      if (!parsed.success) return reply.code(400).send({ error: "validation", issues: parsed.error.issues });
      const full = parsed.data?.full ?? false;
      if (full && req.user?.role === "manager") return reply.code(403).send({ error: "forbidden" });
      // Полная перезагрузка идёт минуты (2 тыс. сделок и 18 тыс. событий —
      // около 5 минут: Kommo медленно отдаёт события). Держать HTTP-запрос
      // столько нельзя — запускаем в фоне, итог виден в kommo_sync_state.
      if (full) {
        syncKommo({ full, log: req.log }).catch((e) => req.log.error({ err: e }, "kommo_full_sync_failed"));
        return reply.code(202).send({ ok: true, started: true });
      }
      try {
        const result = await syncKommo({ full, log: req.log });
        return reply.send({ ok: true, result });
      } catch (e) {
        req.log.error({ err: e }, "kommo_sync_failed");
        return reply.code(502).send({ error: "kommo_sync_failed", message: e instanceof Error ? e.message : String(e) });
      }
    },
  );

  // POST /v1/webhooks/kommo/:secret — вебхук Kommo (Настройки → Интеграции →
  // Web hooks). Подписи у Kommo нет, поэтому секрет в адресе; данным из
  // тела не доверяем. Отвечаем сразу: у Kommo таймаут 2 секунды, после
  // сотни ошибок за 2 часа вебхук отключается.
  app.post(
    "/v1/webhooks/kommo/:secret",
    { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { secret } = req.params as { secret: string };
      if (!kommoConfigured || !secretMatches(secret)) return reply.code(404).send({ error: "not_found" });
      scheduleKommoSync(req.log);
      return reply.send({ ok: true });
    },
  );
};
