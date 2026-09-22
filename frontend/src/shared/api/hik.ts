// Турникеты Hikvision (Face ID): API-клиент и хуки.
// Серверные ручки — backend/src/routes/v1/hik.ts; журнал — таблица access_events.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost } from "./api-client";
import { supabase } from "./supabase";

export type DoorCmd = "open" | "alwaysOpen" | "alwaysClose" | "resume";

export type HikDevice = {
  serial: string;
  name: string;
  ip: string | null;
  direction: "in" | "out" | "both";
  last_seen_at: string | null;
  online: boolean;
  /** Последний включённый режим по журналу команд ("normal", если команд не было). */
  mode: "normal" | "alwaysOpen" | "alwaysClose";
};

export type HikEventRow = {
  id: string;
  person_no: string | null;
  device_serial: string;
  event_type: "face_ok" | "face_fail" | "card_ok" | "other" | "auto_out" | "denied";
  direction: "in" | "out" | "unknown";
  occurred_at: string;
  children: { full_name: string } | null;
  /** Имя ребёнка или сотрудника (по номеру), если удалось определить. */
  person_name?: string | null;
};

export type ChildAccessInfo = {
  access_person_no: string | null;
  face_photo_path: string | null;
  face_enrolled_at: string | null;
};

// ---------- терминалы ----------

export const useHikDevices = () =>
  useQuery({
    queryKey: ["hik_devices"],
    queryFn: () => apiGet<{ devices: HikDevice[] }>("/v1/hik/devices").then((r) => r.devices),
    refetchInterval: 15_000,
  });

export const useHikDoorCmd = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ serial, cmd }: { serial: string; cmd: DoorCmd }) =>
      apiPost<{ ok: boolean }>(`/v1/hik/devices/${serial}/door`, { cmd }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hik_devices"] }),
  });
};

// ---------- журнал проходов ----------

export const useHikRecentEvents = () =>
  useQuery({
    queryKey: ["hik_recent"],
    queryFn: () => apiGet<{ events: HikEventRow[] }>("/v1/hik/recent").then((r) => r.events),
    refetchInterval: 10_000,
  });

// Проходная есть у детей и у ВСЕХ сотрудников (тренеры, менеджеры, директор).
// Один набор хуков, разные бэкенд-пути.
export type AccessSubject = { kind: "child" | "staff"; id: string };
const accessBase = (s: AccessSubject) =>
  s.kind === "child" ? `/v1/hik/children/${s.id}` : `/v1/hik/staff/${s.id}`;

export const useChildAccessEvents = (subject: AccessSubject | null) =>
  useQuery({
    queryKey: ["hik_child_events", subject?.kind, subject?.id],
    enabled: !!subject,
    queryFn: () =>
      apiGet<{ events: HikEventRow[] }>(`${accessBase(subject!)}/events`).then((r) => r.events),
  });

/** Проходы за день (для маркеров у тренера): child_id -> первое время входа. */
export const useAccessEventsForDate = (date: string | undefined, childIds: string[]) =>
  useQuery({
    // ключ — по составу списка, не по длине: у тренера могут быть две группы
    // одинакового размера в один день
    queryKey: ["hik_day_events", date, [...childIds].sort().join("|")],
    enabled: !!date && childIds.length > 0,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_events")
        .select("child_id, occurred_at, direction, event_type")
        .in("child_id", childIds)
        .in("event_type", ["face_ok", "card_ok"])
        .gte("occurred_at", `${date}T00:00:00+06:00`)
        .lt("occurred_at", `${date}T23:59:59+06:00`)
        .order("occurred_at", { ascending: true });
      if (error) throw error;
      const firstIn = new Map<string, string>();
      for (const e of data ?? []) {
        if (e.direction === "out") continue; // маркер — про вход в здание
        if (e.child_id && !firstIn.has(e.child_id)) firstIn.set(e.child_id, e.occurred_at);
      }
      return firstIn;
    },
  });

// ---------- проходная в карточке ребёнка ----------

export const useChildAccessInfo = (subject: AccessSubject | null) =>
  useQuery({
    queryKey: ["hik_child_access", subject?.kind, subject?.id],
    enabled: !!subject,
    queryFn: async (): Promise<ChildAccessInfo> => {
      if (subject!.kind === "staff") {
        return apiGet<ChildAccessInfo>(`${accessBase(subject!)}/access`);
      }
      const { data, error } = await supabase
        .from("children")
        .select("access_person_no, face_photo_path, face_enrolled_at")
        .eq("id", subject!.id)
        .single();
      if (error) throw error;
      return data as ChildAccessInfo;
    },
  });

const invalidateSubject = (qc: ReturnType<typeof useQueryClient>, s: AccessSubject) => {
  qc.invalidateQueries({ queryKey: ["hik_child_access", s.kind, s.id] });
  qc.invalidateQueries({ queryKey: ["hik_face_status", s.kind, s.id] });
};

export const useAssignPersonNo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subject: AccessSubject) =>
      apiPost<{ person_no: string }>(`${accessBase(subject)}/person-no`, {}),
    onSuccess: (_r, subject) => invalidateSubject(qc, subject),
  });
};

export const useEnrollFace = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subject, photoBase64 }: { subject: AccessSubject; photoBase64: string }) =>
      apiPost<{ ok: boolean }>(`${accessBase(subject)}/enroll`, { photo_base64: photoBase64 }),
    onSuccess: (_r, v) => {
      // бэкенд вернул ok = лицо принято терминалами; показываем сразу,
      // живую перепроверку (2 запроса к терминалам по 4G) делаем в фоне
      qc.setQueryData(["hik_face_status", v.subject.kind, v.subject.id], true);
      invalidateSubject(qc, v.subject);
      // Это фото стало аватаркой (children.photo_path / profiles.avatar_url) —
      // обновляем списки, где она видна.
      if (v.subject.kind === "child") {
        for (const k of ["children", "my_children", "enrollments_group", "coach_tabel", "group_tabel"]) {
          qc.invalidateQueries({ queryKey: [k] });
        }
      } else {
        for (const k of ["staff", "coaches", "managers"]) {
          qc.invalidateQueries({ queryKey: [k] });
        }
        qc.invalidateQueries({ queryKey: ["profile", v.subject.id] });
      }
    },
  });
};

/** Живой статус лица с терминала (а не из БД): есть ли фото у person_no. 502 — терминал офлайн. */
export const useChildFaceStatus = (subject: AccessSubject | null, enabled: boolean) =>
  useQuery({
    queryKey: ["hik_face_status", subject?.kind, subject?.id],
    enabled: !!subject && enabled,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: () =>
      apiGet<{ enrolled: boolean }>(`${accessBase(subject!)}/face-status`).then((r) => r.enrolled),
  });

/** Удаляет лицо и карточку человека с терминала. */
export const useDeleteFace = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (subject: AccessSubject) =>
      apiPost<{ ok: boolean }>(`${accessBase(subject)}/face-delete`, {}),
    onSuccess: (_r, subject) => invalidateSubject(qc, subject),
  });
};

// ---------- проходная по расписанию ----------

export type AccessSettings = {
  enabled: boolean;
  beforeMin: number;
  afterMin: number;
  autoExitHours: number;
};

export type AccessSyncStatus = {
  last_tick_at: string | null;
  last_duration_ms: number | null;
  devices_online: string[];
  children: number;
  pending: number;
  pushed: number;
  errors: number;
  running: boolean;
  last_error: string | null;
};

export type AccessSettingsResponse = { settings: AccessSettings; sync: AccessSyncStatus };

export const useHikSettings = () =>
  useQuery({
    queryKey: ["hik_settings"],
    queryFn: () => apiGet<AccessSettingsResponse>("/v1/hik/settings"),
    refetchInterval: 30_000,
  });

export type AccessSettingsPatch = Partial<{
  access_schedule_enabled: boolean;
  access_before_min: number;
  access_after_min: number;
  access_auto_exit_hours: number;
}>;

export const useUpdateHikSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AccessSettingsPatch) => apiPatch<AccessSettingsResponse>("/v1/hik/settings", patch),
    onSuccess: (data) => {
      qc.setQueryData(["hik_settings"], data);
      qc.invalidateQueries({ queryKey: ["hik_settings"] });
    },
  });
};

export type InsideRow = { child_id: string; full_name: string; entered_at: string; device_serial: string };

/** Кто сейчас в здании (последний проход — вход). */
export const useHikInside = () =>
  useQuery({
    queryKey: ["hik_inside"],
    queryFn: () => apiGet<{ inside: InsideRow[] }>("/v1/hik/inside").then((r) => r.inside),
    refetchInterval: 30_000,
  });

export type ChildAccessWindow = {
  settings: AccessSettings;
  intervals: { from: string; until: string }[];
  desired: { state: "window" | "none" | "unrestricted"; from: string | null; until: string | null };
  lessons: { child_id: string; starts_at: string; ends_at: string; source: "lesson" | "pt"; ref_id: string }[];
  grants: { device_serial: string; state: string; valid_from: string | null; valid_until: string | null; pushed_at: string; error: string | null }[];
  inside: InsideRow | null;
};

/** Окно доступа ребёнка на сегодня и что выставлено на терминалах. */
export const useChildAccessWindow = (childId: string | null) =>
  useQuery({
    queryKey: ["hik_child_window", childId],
    enabled: !!childId,
    refetchInterval: 60_000,
    queryFn: () => apiGet<ChildAccessWindow>(`/v1/hik/children/${childId}/window`),
  });
