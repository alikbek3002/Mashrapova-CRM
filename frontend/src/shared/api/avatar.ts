// Преобразует сохранённый avatar_url в URL, который реально отдаст изображение.
// Старые записи могут хранить прямой URL Tigris (приватный бакет → 403 в браузере).
// В этом случае подменяем на наш прокси /v1/uploads/file/<key>.
//
// Новые загрузки сразу пишут прокси-URL.
import { apiUrl } from "./supabase";

const TIGRIS_HOSTS = ["t3.storageapi.dev", "fly.storage.tigris.dev"];

export const resolveAvatarUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  // Already an absolute non-Tigris URL (или уже proxy) — отдаём как есть.
  let u: URL;
  try { u = new URL(raw); } catch { return raw; }
  if (!TIGRIS_HOSTS.includes(u.hostname)) return raw;

  // path: /<bucket>/<key...> → берём всё после второго слэша как key.
  const parts = u.pathname.replace(/^\/+/, "").split("/");
  if (parts.length < 2) return raw;
  const key = parts.slice(1).join("/");
  return `${apiUrl}/v1/uploads/file/${key}`;
};

// Ключ в хранилище → прокси-URL. Так лежат children.photo_path
// (children/<id>/<uuid>.ext).
// Абсолютные URL (на случай старых данных) — как есть.
export const resolveStorageUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return resolveAvatarUrl(raw);
  return `${apiUrl}/v1/uploads/file/${raw}`;
};

export const resolveChildPhotoUrl = resolveStorageUrl;
