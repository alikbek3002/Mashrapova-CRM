import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import multipart from "@fastify/multipart";

import { env, isOriginAllowed, corsOriginList } from "./lib/env.js";
import { ensureLessonHorizon } from "./lib/lesson-generator.js";
import { dispatchOutbound } from "./lib/outbound.js";
import { initSentry, Sentry } from "./lib/sentry.js";
import { healthRoute } from "./routes/health.js";
import { cardsRoutes } from "./routes/v1/cards.js";
import { paymentsRoutes } from "./routes/v1/payments.js";
import { freezesRoutes } from "./routes/v1/freezes.js";
import { lessonsRoutes } from "./routes/v1/lessons.js";
import { notificationsRoutes } from "./routes/v1/notifications.js";
import { coachesRoutes } from "./routes/v1/coaches.js";
import { lessonsBulkRoutes } from "./routes/v1/lessons-bulk.js";
import { cardsManageRoutes } from "./routes/v1/cards-manage.js";
import { coachRatesRoutes } from "./routes/v1/coach-rates.js";
import { parentsRoutes } from "./routes/v1/parents.js";
import { staffRoutes } from "./routes/v1/staff.js";
import { lifecycleRoutes } from "./routes/v1/lifecycle.js";
import { uploadsRoutes } from "./routes/v1/uploads.js";
import { supabaseAdmin } from "./lib/supabase.js";
import { payrollRoutes } from "./routes/v1/payroll.js";
import { refundsRoutes } from "./routes/v1/refunds.js";
import { depositsRoutes } from "./routes/v1/deposits.js";
import { ptRoutes } from "./routes/v1/pt.js";

initSentry();

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  },
  trustProxy: true,
});

await app.register(helmet, {
  contentSecurityPolicy: false, // backend serves JSON only
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / curl
    if (isOriginAllowed(origin)) return cb(null, true);
    app.log.warn({ origin, allowed: corsOriginList }, "cors_rejected");
    cb(new Error("CORS_NOT_ALLOWED"), false);
  },
  credentials: true,
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
});

await app.register(sensible);

// Multipart для загрузки файлов (фото). Лимит 5 МБ на файл.
await app.register(multipart, {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// Routes
await app.register(healthRoute);
await app.register(cardsRoutes);
await app.register(paymentsRoutes);
await app.register(freezesRoutes);
await app.register(lessonsRoutes);
await app.register(notificationsRoutes);
await app.register(coachesRoutes);
await app.register(lessonsBulkRoutes);
await app.register(cardsManageRoutes);
await app.register(coachRatesRoutes);
await app.register(parentsRoutes);
await app.register(staffRoutes);
await app.register(lifecycleRoutes);
await app.register(uploadsRoutes);

// Lightweight in-process scheduler — runs refresh_lifecycle() every hour.
// This is the fallback when pg_cron is not available on the Supabase plan.
// On Pro+ plans, pg_cron handles it nightly via the migration; the hourly
// in-process call is harmless (refresh_lifecycle is idempotent).
const LIFECYCLE_INTERVAL_MS = 60 * 60 * 1000;
const runLifecycle = async () => {
  try {
    const { error } = await supabaseAdmin.rpc("refresh_lifecycle");
    if (error) app.log.warn({ err: error }, "lifecycle_tick_failed");
    else app.log.debug("lifecycle_tick_ok");
  } catch (e) {
    app.log.warn({ err: e }, "lifecycle_tick_threw");
  }
  // ПТ: истечение пакетов + напоминания клиентам за 24 ч (§17)
  try {
    const { error } = await supabaseAdmin.rpc("pt_refresh_lifecycle");
    if (error) app.log.warn({ err: error }, "pt_lifecycle_tick_failed");
    const { error: remErr } = await supabaseAdmin.rpc("pt_send_reminders");
    if (remErr) app.log.warn({ err: remErr }, "pt_reminders_tick_failed");
  } catch (e) {
    app.log.warn({ err: e }, "pt_lifecycle_tick_threw");
  }
  // ТЗ §4.5 и §8.3: события по сроку абонемента и нормативы воронки.
  // Идемпотентны, дубли не создают.
  try {
    const { error: noticeErr } = await supabaseAdmin.rpc("refresh_card_notices");
    if (noticeErr) app.log.warn({ err: noticeErr }, "card_notices_tick_failed");
    const { error: slaErr } = await supabaseAdmin.rpc("refresh_lead_sla");
    if (slaErr) app.log.warn({ err: slaErr }, "lead_sla_tick_failed");
  } catch (e) {
    app.log.warn({ err: e }, "notices_tick_threw");
  }
  // ТЗ §9: разбор очереди исходящих. Пока SMS_PROVIDER=noop сообщения
  // помечаются пропущенными — очередь не растёт бесконечно, и по ней
  // видно, сколько SMS ушло бы с подключённым провайдером.
  try {
    await dispatchOutbound(app.log);
  } catch (e) {
    app.log.warn({ err: e }, "outbound_dispatch_tick_threw");
  }
  // Горизонт занятий: по каждой активной группе занятия существуют от
  // сегодня до max(+30 дней, конец самого дальнего окна записи).
  // Идемпотентно — повторный прогон ничего не дублирует.
  try {
    const res = await ensureLessonHorizon(app.log);
    if (res.inserted > 0) app.log.info(res, "lesson_horizon_tick");
  } catch (e) {
    app.log.warn({ err: e }, "lesson_horizon_tick_threw");
  }
};
// Fire once shortly after boot, then on schedule.
// ВАЖНО: планировщик должен работать только на одном инстансе (см. env.SCHEDULER_ENABLED),
// иначе refresh_lifecycle/pt_send_reminders выполняются дважды и клиентам уходят дубли.
if (env.SCHEDULER_ENABLED) {
  setTimeout(runLifecycle, 30_000);
  setInterval(runLifecycle, LIFECYCLE_INTERVAL_MS);
} else {
  app.log.warn("scheduler_disabled (SCHEDULER_ENABLED=false) — lifecycle/reminders не запускаются на этом инстансе");
}
await app.register(payrollRoutes);
await app.register(refundsRoutes);
await app.register(depositsRoutes);
await app.register(ptRoutes);

// Sentry error capture
app.setErrorHandler((err, req, reply) => {
  req.log.error(err);
  if (env.SENTRY_DSN) Sentry.captureException(err);
  if (err.message === "CORS_NOT_ALLOWED") {
    return reply.code(403).send({ error: "cors_not_allowed" });
  }
  return reply.code(500).send({ error: "internal_error" });
});

// Graceful shutdown
const shutdown = async (signal: string) => {
  app.log.info(`Received ${signal}, shutting down gracefully`);
  try {
    await app.close();
    if (env.SENTRY_DSN) await Sentry.close(2000);
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
