// MinIO / S3-совместимое хранилище для аватаров и других пользовательских файлов.
// Клиент создаётся лениво при первом обращении и кэшируется.
import { Client as MinioClient } from "minio";
import { env } from "./env.js";

let cached: MinioClient | null = null;

export const isStorageConfigured = (): boolean =>
  !!(env.MINIO_ENDPOINT && env.MINIO_ACCESS_KEY && env.MINIO_SECRET_KEY && env.MINIO_BUCKET);

/** Возвращает singleton MinIO-клиент или null если не настроен. */
export const getStorage = (): MinioClient | null => {
  if (cached) return cached;
  if (!isStorageConfigured()) return null;

  // Парсим endpoint: minio-lib хочет отдельно host, port, useSSL.
  const url = new URL(env.MINIO_ENDPOINT!);
  const useSSL = env.MINIO_USE_SSL ?? (url.protocol === "https:");
  const port = env.MINIO_PORT ?? (url.port ? Number(url.port) : (useSSL ? 443 : 80));

  cached = new MinioClient({
    endPoint: url.hostname,
    port,
    useSSL,
    region: env.MINIO_REGION ?? "us-east-1",
    accessKey: env.MINIO_ACCESS_KEY!,
    secretKey: env.MINIO_SECRET_KEY!,
    pathStyle: true, // Tigris/MinIO используют path-style URL
  } as never);
  return cached;
};

/** Базовый URL для http-доступа к объекту: MINIO_PUBLIC_URL ?? MINIO_ENDPOINT. */
export const publicUrlBase = (): string => {
  const raw = env.MINIO_PUBLIC_URL ?? env.MINIO_ENDPOINT ?? "";
  return raw.replace(/\/$/, "");
};

/** Строит публичный URL вида {base}/{bucket}/{key}. */
export const objectPublicUrl = (key: string): string =>
  `${publicUrlBase()}/${env.MINIO_BUCKET}/${key}`;
