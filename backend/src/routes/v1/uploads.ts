import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { authenticate, requireRole } from "../../middleware/auth.js";
import { env } from "../../lib/env.js";
import { getStorage, isStorageConfigured } from "../../lib/storage.js";
import { supabaseAdmin } from "../../lib/supabase.js";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Прокси-URL отдаёт файл через наш backend, так бакет может оставаться
// приватным (а Tigris по умолчанию приватный) и нам не нужно настраивать
// public ACL/CORS на стороне хранилища.
const buildProxyUrl = (req: { protocol: string; host: string }, key: string): string => {
  return `${req.protocol}://${req.host}/v1/uploads/file/${key}`;
};

export const uploadsRoutes = async (app: FastifyInstance) => {
  // POST /v1/uploads/avatar — загружает картинку в MinIO bucket и возвращает
  // публичный URL. Сохранение URL в profiles.avatar_url делает фронт после
  // получения ответа.
  app.post(
    "/v1/uploads/avatar",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "coach"),
      ],
    },
    async (req, reply) => {
      if (!isStorageConfigured()) {
        return reply.code(503).send({
          error: "storage_not_configured",
          message: "MINIO_* env vars не заданы. Файловое хранилище недоступно.",
        });
      }

      const file = await req.file({ limits: { fileSize: MAX_BYTES } });
      if (!file) return reply.code(400).send({ error: "no_file" });
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        return reply.code(400).send({ error: "invalid_mime", message: `Допустимы: ${[...ALLOWED_MIMES].join(", ")}` });
      }

      // Собираем буфер. file.toBuffer() выкинет ошибку, если превышен лимит.
      let buf: Buffer;
      try {
        buf = await file.toBuffer();
      } catch (e) {
        return reply.code(413).send({ error: "too_large", message: `Максимум ${MAX_BYTES / 1024 / 1024} МБ` });
      }

      // Имя объекта: avatars/{user_id}/{uuid}.{ext}
      const ext = file.mimetype === "image/png" ? "png"
        : file.mimetype === "image/webp" ? "webp"
        : "jpg";
      const key = `avatars/${req.user!.id}/${randomUUID()}.${ext}`;

      const s3 = getStorage()!;
      try {
        await s3.putObject(env.MINIO_BUCKET!, key, buf, buf.length, {
          "Content-Type": file.mimetype,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
      } catch (e) {
        req.log.error({ err: e }, "minio_put_failed");
        return reply.code(500).send({ error: "upload_failed", message: (e as Error).message });
      }

      return reply.send({
        ok: true,
        url: buildProxyUrl({ protocol: req.protocol, host: req.hostname }, key),
        key,
      });
    },
  );

  // POST /v1/uploads/child-photo/:childId — фото ребёнка. Доступно сотрудникам,
  // тренерам и родителю (только для своего ребёнка). Пишет children.photo_path
  // через admin-клиент, т.к. у родителя нет прямого UPDATE по children.
  app.post<{ Params: { childId: string } }>(
    "/v1/uploads/child-photo/:childId",
    {
      preHandler: [
        authenticate,
        requireRole("director", "fitness_director", "senior_manager", "manager", "coach", "parent"),
      ],
    },
    async (req, reply) => {
      if (!isStorageConfigured()) {
        return reply.code(503).send({
          error: "storage_not_configured",
          message: "MINIO_* env vars не заданы. Файловое хранилище недоступно.",
        });
      }

      const { childId } = req.params as { childId: string };
      const user = req.user!;

      // Ребёнок существует и в той же организации.
      const { data: child, error: cErr } = await supabaseAdmin
        .from("children")
        .select("id, family_id, organization_id")
        .eq("id", childId)
        .maybeSingle();
      if (cErr) {
        req.log.error({ err: cErr }, "child_photo_load_failed");
        return reply.code(500).send({ error: "load_failed" });
      }
      if (!child) return reply.code(404).send({ error: "child_not_found" });
      if (child.organization_id !== user.organization_id) {
        return reply.code(403).send({ error: "forbidden" });
      }

      // Родитель — только для своего ребёнка (family.parent_user_id === user.id).
      if (user.role === "parent") {
        const { data: fam } = await supabaseAdmin
          .from("families")
          .select("id")
          .eq("id", child.family_id)
          .eq("parent_user_id", user.id)
          .maybeSingle();
        if (!fam) return reply.code(403).send({ error: "not_your_child" });
      }

      const file = await req.file({ limits: { fileSize: MAX_BYTES } });
      if (!file) return reply.code(400).send({ error: "no_file" });
      if (!ALLOWED_MIMES.has(file.mimetype)) {
        return reply.code(400).send({ error: "invalid_mime", message: `Допустимы: ${[...ALLOWED_MIMES].join(", ")}` });
      }

      let buf: Buffer;
      try {
        buf = await file.toBuffer();
      } catch (e) {
        return reply.code(413).send({ error: "too_large", message: `Максимум ${MAX_BYTES / 1024 / 1024} МБ` });
      }

      const ext = file.mimetype === "image/png" ? "png"
        : file.mimetype === "image/webp" ? "webp"
        : "jpg";
      const key = `children/${childId}/${randomUUID()}.${ext}`;

      const s3 = getStorage()!;
      try {
        await s3.putObject(env.MINIO_BUCKET!, key, buf, buf.length, {
          "Content-Type": file.mimetype,
          "Cache-Control": "public, max-age=31536000, immutable",
        });
      } catch (e) {
        req.log.error({ err: e }, "minio_put_failed");
        return reply.code(500).send({ error: "upload_failed", message: (e as Error).message });
      }

      // Аудит-актор + сохраняем ключ в children.photo_path.
      await supabaseAdmin.rpc("set_config", {
        setting_name: "app.actor_id",
        new_value: user.id,
        is_local: true,
      } as never);
      const { error: uErr } = await supabaseAdmin
        .from("children")
        .update({ photo_path: key })
        .eq("id", childId);
      if (uErr) {
        req.log.error({ err: uErr }, "child_photo_save_failed");
        return reply.code(500).send({ error: "save_failed", message: uErr.message });
      }

      return reply.send({
        ok: true,
        key,
        url: buildProxyUrl({ protocol: req.protocol, host: req.hostname }, key),
      });
    },
  );

  // GET /v1/uploads/file/*key — стримит файл из MinIO через backend.
  // Без auth: аватары публичны для просмотра в админке и PWA.
  app.get<{ Params: { "*": string } }>(
    "/v1/uploads/file/*",
    async (req, reply) => {
      const key = (req.params as { "*": string })["*"];
      if (!key) return reply.code(400).send({ error: "no_key" });
      if (!isStorageConfigured()) return reply.code(503).send({ error: "storage_not_configured" });

      const s3 = getStorage()!;
      try {
        const stat = await s3.statObject(env.MINIO_BUCKET!, key);
        const contentType =
          stat.metaData?.["content-type"] ?? stat.metaData?.["Content-Type"] ?? "application/octet-stream";
        // faces/* — единственный «перезаписываемый» ключ (заливка лица на
        // турникет кладёт файл по faces/<id>.jpg). Это же фото показывается
        // как аватарка, поэтому immutable-кэш здесь недопустим: после новой
        // заливки браузер годами отдавал бы старый портрет. ETag делает
        // ревалидацию дешёвой (304 без тела).
        const mutable = key.startsWith("faces/");
        const etag = stat.etag ? `"${stat.etag.replace(/"/g, "")}"` : null;
        if (etag) reply.header("ETag", etag);
        reply.header("Cache-Control", mutable
          ? "public, max-age=60, must-revalidate"
          : "public, max-age=31536000, immutable");
        if (etag && req.headers["if-none-match"] === etag) {
          reply.header("Cross-Origin-Resource-Policy", "cross-origin");
          return reply.code(304).send();
        }
        const stream = await s3.getObject(env.MINIO_BUCKET!, key);
        reply.header("Content-Type", contentType);
        // CORP: helmet по умолчанию ставит 'same-origin' и Chrome блокирует
        // <img src> с другого домена (ERR_BLOCKED_BY_RESPONSE.NotSameOrigin).
        // Для публичных аватаров нужно cross-origin.
        reply.header("Cross-Origin-Resource-Policy", "cross-origin");
        if (stat.size) reply.header("Content-Length", String(stat.size));
        return reply.send(stream);
      } catch (e: unknown) {
        req.log.warn({ err: e, key }, "minio_get_failed");
        return reply.code(404).send({ error: "not_found" });
      }
    },
  );
};
