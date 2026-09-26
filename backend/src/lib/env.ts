import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_ANON_KEY: z.string().min(20),
  FRONTEND_ORIGINS: z.string().min(1),
  SENTRY_DSN: z.string().optional(),

  // Фоновый планировщик (refresh_lifecycle + PT-напоминания). Должен работать
  // РОВНО на одном инстансе бэкенда, иначе клиентам уходят дубли напоминаний.
  // На время миграции второй бэкенд поднимаем с SCHEDULER_ENABLED=false.
  SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),

  // SMS-провайдер (ТЗ §9.2, §13). Договора с SMS.kg пока нет, поэтому по
  // умолчанию провайдер "noop": сообщения копятся в очереди и помечаются
  // как пропущенные, ничего никуда не уходит. Когда ключи появятся —
  // выставить SMS_PROVIDER=smskg и заполнить логин, пароль и отправителя.
  SMS_PROVIDER: z.enum(["noop", "smskg"]).default("noop"),
  SMS_API_URL: z.string().optional(),
  SMS_LOGIN: z.string().optional(),
  SMS_PASSWORD: z.string().optional(),
  SMS_SENDER: z.string().optional(),

  // MinIO / S3-compatible storage (avatars, photos).
  // Работает с MinIO, Tigris (t3.storageapi.dev), R2, AWS S3 и т.д.
  // Все необязательные — если не заданы, /v1/uploads/* возвращают 503.
  MINIO_ENDPOINT: z.string().optional(),            // https://t3.storageapi.dev | https://minio-xxxx.up.railway.app
  MINIO_PORT: z.coerce.number().int().optional(),    // обычно из ENDPOINT, переопределить можно
  MINIO_USE_SSL: z.coerce.boolean().optional(),
  MINIO_REGION: z.string().optional(),               // "auto" для Tigris/R2, "us-east-1" для AWS
  MINIO_ACCESS_KEY: z.string().optional(),
  MINIO_SECRET_KEY: z.string().optional(),
  MINIO_BUCKET: z.string().optional(),               // имя bucket (например "avatars")
  MINIO_PUBLIC_URL: z.string().optional(),           // публичный префикс. По умолчанию = MINIO_ENDPOINT
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Каждая запись из FRONTEND_ORIGINS — это либо точный origin
// (https://app.example.com), либо glob с `*` (https://*.up.railway.app).
// `*` означает "любое количество символов кроме `/`".
const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
const compileOriginPattern = (raw: string): RegExp => {
  const pattern = raw
    .split("*")
    .map(escapeRegex)
    .join("[^/]*");
  return new RegExp(`^${pattern}$`);
};

const originEntries = env.FRONTEND_ORIGINS.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const corsOriginPatterns = originEntries.map(compileOriginPattern);
export const corsOriginList = originEntries;
export const isOriginAllowed = (origin: string): boolean =>
  corsOriginPatterns.some((re) => re.test(origin));
