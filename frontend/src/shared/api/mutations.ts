import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, apiUrl } from "./supabase";
import { apiPost, apiPatch, apiDelete } from "./api-client";
// Офлайн-очередь (ТЗ §12.4): продажа за наличные и отметка посещаемости
// откладываются, если связи нет, и уходят сами при её появлении.
import { enqueue } from "../offline/outbox";
import { writeAttendanceMarks } from "../offline/ops";

/** Подпись операции в списке ожидающих отправки. */
const formatSum = (n: number): string => `${Math.round(n).toLocaleString("ru-RU")} сом`;
import { toast } from "../ui/toast";
import { useAuth } from "../auth/AuthProvider";
import type { CardType, PaymentMethod, LeadStage, LeadSource, Lead, AttendanceStatus, SectionCategory, LessonFault } from "../types/database";

// Парсит сырое сообщение из apiPost/apiPatch (формат "API 409: {\"error\":\"code\"}")
// и возвращает понятный русский текст. Если код не распознан — возвращает
// то, что прислал сервер (а если совсем ничего — generic-сообщение).
// Используется и в toast'ах мутаций, и в inline-ошибках форм.
export const friendlyAuthError = (raw: string): string => {
  const m = raw.match(/"error"\s*:\s*"([^"]+)"/);
  const code = m?.[1];
  switch (code) {
    case "phone_already_exists":
      return "Этот телефон уже используется другим аккаунтом. Укажите другой номер или восстановите профиль из архива.";
    case "phone_previously_used":
      return "Этот телефон был привязан к архивному аккаунту. Восстановите его из «Архива» или укажите другой номер.";
    case "phone_invalid_format":
      return "Неверный формат телефона. Используйте +996 700 12 34 56.";
    case "email_already_exists":
      return "Этот email или телефон уже зарегистрирован в системе авторизации.";
    case "inn_already_exists":
      return "Этот ИНН уже занят.";
    case "family_already_has_parent":
      return "У этой семьи уже есть привязанный аккаунт родителя. Сбросьте пароль вместо повторной выдачи доступа.";
    case "family_not_found":
      return "Семья не найдена. Возможно, её удалили в другой вкладке — обновите страницу.";
    case "cannot_change_director_password":
      return "Нельзя менять пароль другому директору.";
    case "auth_update_failed":
      return "Supabase Auth не смог обновить аккаунт. Проверьте подключение и попробуйте снова.";
    case "profile_insert_failed":
    case "profile_update_failed":
      return "Не удалось сохранить профиль. Проверьте права и повторите.";
    case "password_reset_failed":
      return "Не удалось сменить пароль. Попробуйте ещё раз.";
    case "not_found":
      return "Запись не найдена.";
    case "validation": {
      // Backend возвращает {error:"validation", issues: {fieldErrors:{phone:[...]}}}
      // — пытаемся вытащить конкретное поле, чтобы пользователь сразу понял
      // что чинить.
      const fields: string[] = [];
      const fe = raw.match(/"fieldErrors"\s*:\s*\{([^}]*)\}/);
      if (fe) {
        const inner = fe[1];
        if (/"phone"/.test(inner)) fields.push("телефон (≥7 знаков, формат +996 …)");
        if (/"password"/.test(inner)) fields.push("пароль (≥8 знаков)");
        if (/"email"/.test(inner)) fields.push("email");
        if (/"full_name"/.test(inner)) fields.push("ФИО");
      }
      if (fields.length > 0) {
        return `Проверьте: ${fields.join(", ")}.`;
      }
      return "Поля заполнены некорректно. Проверьте формат телефона и пароль (≥8 символов).";
    }
  }
  // Не получилось распознать — отрезаем префикс "API 4xx:" если он есть.
  const stripped = raw.replace(/^API\s+\d+:\s*/, "").trim();
  return stripped || "Произошла ошибка. Попробуйте ещё раз.";
};

// Pull the caller's organization_id from their profile.
// Cached in-memory after the first lookup — it never changes for a session.
let _cachedOrgId: string | null = null;
const getMyOrgId = async (): Promise<string> => {
  if (_cachedOrgId) return _cachedOrgId;
  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr || !u.user) throw new Error("Не авторизован");
  const { data: p, error: pErr } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("id", u.user.id)
    .single();
  if (pErr || !p?.organization_id) {
    throw new Error("Профиль не найден или нет привязки к организации");
  }
  _cachedOrgId = p.organization_id as string;
  return _cachedOrgId;
};

// ============ Families + Children (direct via Supabase RLS) ============
// Колонки address / father_passport / mother_passport добавляются миграцией
// 20260514000008_family_address_passport.sql. Пока она не применена к
// remote БД, эти поля отрезаем перед insert/update, иначе PostgREST
// падает с "Could not find the 'address' column ... in the schema cache".
const FAMILY_PENDING_MIGRATION_KEYS = ["address", "father_passport", "mother_passport"] as const;
const stripPendingFamilyFields = <T extends Record<string, unknown>>(input: T): Partial<T> => {
  const out: Record<string, unknown> = { ...input };
  for (const k of FAMILY_PENDING_MIGRATION_KEYS) delete out[k];
  return out as Partial<T>;
};

export const useAddFamily = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      father_name?: string | null; father_phone?: string | null;
      father_passport?: string | null;
      mother_name?: string | null; mother_phone?: string | null;
      mother_passport?: string | null;
      address?: string | null;
      comment?: string | null;
    }) => {
      const orgId = await getMyOrgId();
      const safe = stripPendingFamilyFields(input);
      const { data, error } = await supabase
        .from("families")
        .insert({ organization_id: orgId, ...safe })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      toast.ok("Семья добавлена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useAddChild = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      family_id: string;
      full_name: string;
      birth_date: string;
      card_number?: string | null;
      responsible_manager_id?: string | null;
      amo_url?: string | null;
      source?: "target" | "referral" | "other" | null;
      // ТЗ §3.3: кто привёл клиента — основание для бонуса «Приведи друга».
      referred_by_child_id?: string | null;
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("children")
        .insert({ organization_id: orgId, ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Ребёнок добавлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useUpdateChild = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [k: string]: unknown }) => {
      const { data, error } = await supabase.from("children").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["children"] }),
  });
};

// ============ Coaches (через бэк, нужен auth admin) ============
export const useAddCoach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      password: string; full_name: string;
      phone: string;
      email?: string | null;
      bio?: string | null;
      achievements?: string | null; experience_years?: number | null;
    }) => {
      return apiPost<{ ok: boolean; coach_id: string }>("/v1/coaches", input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaches"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Тренер создан");
    },
    onError: (e: Error) => toast.err(friendlyAuthError(e.message)),
  });
};

export const useUpdateFamily = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [k: string]: unknown }) => {
      const safe = stripPendingFamilyFields(patch);
      const { data, error } = await supabase.from("families").update(safe).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["children"] });
    },
  });
};

// ============ Updates / archive ============
export const useUpdateSection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [k: string]: unknown }) => {
      const { data, error } = await supabase.from("sections").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sections"] }),
  });
};

export const useUpdateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [k: string]: unknown }) => {
      const { data, error } = await supabase.from("groups").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
};

export const useUpdateCoach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, profile, coach }: {
      id: string;
      profile?: {
        full_name?: string;
        phone?: string | null;
        email?: string | null;
        avatar_url?: string | null;
        password?: string;
      };
      coach?: Record<string, unknown>;
    }) => {
      // profile-поля (включая password) идут через backend PATCH, чтобы
      // синхронизировать auth.users.{email,password}. avatar_url пишем
      // напрямую в supabase — это не auth-поле. Backend требует phone ≥ 7,
      // password ≥ 8, full_name ≥ 1; пустые значения отрезаем, иначе 400.
      if (profile && Object.keys(profile).length) {
        const { avatar_url, ...authFields } = profile;
        const patchBody: Record<string, unknown> = {};
        if (authFields.full_name !== undefined) {
          const v = String(authFields.full_name).trim();
          if (v.length >= 1) patchBody.full_name = v;
        }
        if (authFields.email !== undefined) {
          if (authFields.email === null) patchBody.email = null;
          else {
            const v = String(authFields.email).trim();
            if (v.length > 0) patchBody.email = v;
          }
        }
        if (authFields.phone !== undefined && authFields.phone !== null) {
          const v = String(authFields.phone).trim();
          if (v.length >= 7) patchBody.phone = v;
        }
        if (authFields.password !== undefined) {
          const v = String(authFields.password);
          if (v.length >= 8) patchBody.password = v;
        }
        if (Object.keys(patchBody).length > 0) {
          await apiPatch<{ ok: boolean }>(`/v1/coaches/${id}`, patchBody);
        }
        if (avatar_url !== undefined) {
          const { error } = await supabase.from("profiles").update({ avatar_url }).eq("id", id);
          if (error) throw error;
        }
      }
      if (coach && Object.keys(coach).length) {
        const { error } = await supabase.from("coaches").update(coach).eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["coaches"] });
      qc.invalidateQueries({ queryKey: ["profile", vars.id] });
      if (vars.profile?.password) toast.ok("Пароль изменён");
    },
    onError: (e: Error) => toast.err(friendlyAuthError(e.message)),
  });
};

// Правка ставки тренера на карте. Доступно director/fitness_director, и только
// если по карте нет утверждённого payroll-периода — backend сам проверяет.
export const useUpdateCoachRate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; coach_rate_per_lesson: number }) =>
      apiPatch<{ ok: boolean; coach_rate_per_lesson: number }>(
        `/v1/cards/${input.card_id}/coach-rate`,
        { coach_rate_per_lesson: input.coach_rate_per_lesson },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["payroll_live"] });
      qc.invalidateQueries({ queryKey: ["payroll_me_live"] });
      toast.ok("Ставка тренера обновлена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ТЗ §12.3: сброс второго фактора сотруднику. Доступно только директору
// (проверяет бэкенд). Нужен, потому что политика mfa_required требует
// aal2 — с потерянным телефоном сотрудник иначе заперт навсегда.
export const useResetMfa = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      apiPost<{ ok: boolean; removed: number }>(`/v1/staff/${userId}/reset-mfa`, {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.ok(Number(r?.removed ?? 0) > 0
        ? "Второй фактор сброшен — сотрудник настроит его заново при входе"
        : "У сотрудника не было настроенного второго фактора");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Перезаписывает набор секций тренера (delete-all + insert).
export const useSetCoachSections = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ coachId, sectionIds }: { coachId: string; sectionIds: string[] }) => {
      const { error: delErr } = await supabase
        .from("section_coaches")
        .delete()
        .eq("coach_id", coachId);
      if (delErr) throw delErr;
      if (sectionIds.length > 0) {
        const rows = sectionIds.map((sid) => ({ coach_id: coachId, section_id: sid }));
        const { error: insErr } = await supabase.from("section_coaches").insert(rows);
        if (insErr) throw insErr;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["coach_sections", vars.coachId] });
      qc.invalidateQueries({ queryKey: ["coaches"] });
    },
    onError: (e: Error) => toast.err("Секции тренера: " + e.message),
  });
};

// Заливает аватар на /v1/uploads/avatar и возвращает publicUrl.
// Сохранение URL в profiles.avatar_url остаётся за вызывающим (useUpdateCoach).
export const useUploadAvatar = () => {
  return useMutation({
    mutationFn: async (file: File): Promise<{ url: string; key: string }> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("not_authenticated");

      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${apiUrl}/v1/uploads/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        if (res.status === 503) {
          throw new Error("Файловое хранилище ещё не настроено. Свяжитесь с админом.");
        }
        throw new Error(`Upload ${res.status}: ${detail.message ?? detail.error ?? "failed"}`);
      }
      return res.json();
    },
    onError: (e: Error) => toast.err("Загрузка фото: " + e.message),
  });
};

// Фото ребёнка — загрузка через backend (он же пишет children.photo_path).
// Доступно админу/тренеру и родителю (бэкенд проверяет владение).
export const useUploadChildPhoto = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ childId, file }: { childId: string; file: File }): Promise<{ url: string; key: string }> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("not_authenticated");

      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(`${apiUrl}/v1/uploads/child-photo/${childId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        if (res.status === 503) throw new Error("Файловое хранилище ещё не настроено. Свяжитесь с админом.");
        if (res.status === 403) throw new Error("Нет доступа к этому ребёнку");
        throw new Error(`Upload ${res.status}: ${detail.message ?? detail.error ?? "failed"}`);
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["my_children"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok("Фото обновлено");
    },
    onError: (e: Error) => toast.err("Загрузка фото: " + e.message),
  });
};

export type ArchivableTable = "children" | "families" | "sections" | "groups" | "profiles";

// Точечная инвалидация при архивации/восстановлении/удалении — вместо
// qc.invalidateQueries() без ключа (которое сносило ВЕСЬ кеш приложения и
// вызывало рефетч-шторм всех запросов). Затрагиваем только кеши, связанные
// с сущностями; lessons/payments/attendance/deposit не трогаем.
const ARCHIVE_RELATED_KEYS = new Set([
  "children", "families", "sections", "groups", "users", "coaches", "managers",
  "stats", "archive", "child_enrollments", "enrollments_group",
  "card_balance", "card_balances", "active_cards_child", "active_cards_children",
]);
const invalidateArchiveRelated = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({
    predicate: (q) => ARCHIVE_RELATED_KEYS.has(q.queryKey[0] as string),
  });
};

export const useArchive = (table: ArchivableTable) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateArchiveRelated(qc);
      toast.ok("Архивировано");
    },
    onError: (e: Error) => {
      // The DB trigger may refuse archiving when there are active dependants.
      // Show the message verbatim — it already includes a count and a hint.
      toast.err(e.message);
    },
  });
};

export const useRestore = (table: ArchivableTable) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(table).update({ deleted_at: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateArchiveRelated(qc);
      toast.ok("Восстановлено");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Card plans (каталог тарифов абонементов) ============
export const useAddCardPlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name_ru: string; name_ky: string; type: CardType;
      duration_days: number; lessons_count?: number | null;
      price: number; freeze_quota?: number; sort_order?: number;
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("card_plans")
        .insert({ organization_id: orgId, ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["card_plans"] });
      toast.ok("Тариф создан");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useUpdateCardPlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [k: string]: unknown }) => {
      const { data, error } = await supabase
        .from("card_plans")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["card_plans"] });
      toast.ok("Тариф обновлён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useDeleteCardPlan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("card_plans")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // RLS без delete-политики молча вернёт 0 строк — не считаем это успехом.
      if (!data || data.length === 0) throw new Error("Нет прав на удаление");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["card_plans"] });
      toast.ok("Вид абонемента удалён");
    },
    onError: (e: Error) => {
      const code = (e as { code?: string }).code;
      // 23503 — FK от club_cards.plan_id: вид уже фигурирует в продажах.
      toast.err(code === "23503"
        ? "Вид уже использовался в продажах — удалить нельзя. Выключите его, чтобы скрыть из списка."
        : "Ошибка: " + e.message);
    },
  });
};

// ============ Sections + Groups ============
export const useAddSection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name_ru: string; name_ky: string; category: SectionCategory;
      color?: string | null;
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("sections")
        .insert({ organization_id: orgId, ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sections"] });
      toast.ok("Секция создана");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useAddGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      section_id: string; coach_id: string; name: string;
      max_capacity?: number; duration_min?: number;
      // Срок существования группы (может быть не задан — бессрочная).
      starts_on?: string | null; ends_on?: string | null;
      // Детали группы: секция — общее название, конкретика здесь.
      age_min?: number | null; age_max?: number | null; level?: string | null;
      audience?: "kids" | "adults" | "mixed";
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("groups")
        .insert({ organization_id: orgId, ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["groups"] });
      toast.ok("Группа создана");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Enrollments ============
// Валидация перед записью в группу: ребёнка можно добавить в группу только
// если у него есть активный/ending абонемент именно на эту секцию. Legacy-
// карты без section_id не подходят (нужно их обновить или продать новый
// абонемент). Сообщения подобраны под существующий toast.err("Ошибка: …").
export const validateEnrollment = async (childId: string, groupId: string): Promise<void> => {
  const [cardsRes, groupRes] = await Promise.all([
    supabase
      .from("club_cards")
      .select("id, section_id, status")
      .eq("child_id", childId)
      .in("status", ["active", "ending"]),
    supabase
      .from("groups")
      .select("section_id, name, section:sections(name_ru)")
      .eq("id", groupId)
      .single(),
  ]);
  if (cardsRes.error) throw cardsRes.error;
  if (groupRes.error) throw groupRes.error;

  const cards = (cardsRes.data ?? []) as Array<{ section_id: string | null }>;
  if (cards.length === 0) {
    throw new Error("Нет активного абонемента — сначала продайте абонемент");
  }

  // Supabase возвращает foreign-key объекты, которые TS-генератор иногда
  // типизирует как массив — приводим через unknown к узкой форме.
  const groupRow = groupRes.data as unknown as {
    section_id: string | null;
    name: string;
    section: { name_ru: string } | { name_ru: string }[] | null;
  };
  const groupSectionId = groupRow.section_id;
  const sectionField = groupRow.section;
  const groupSectionName =
    (Array.isArray(sectionField) ? sectionField[0]?.name_ru : sectionField?.name_ru) ?? groupRow.name;

  const hasLegacy = cards.some((c) => c.section_id == null);
  const hasMatch = groupSectionId != null && cards.some((c) => c.section_id === groupSectionId);

  if (hasMatch) return;

  if (hasLegacy && !cards.some((c) => c.section_id != null)) {
    throw new Error("У абонемента не указана секция — обновите абонемент перед записью в группу");
  }
  // У ребёнка есть активные карты, но все — на другие секции.
  const otherSectionIds = Array.from(
    new Set(cards.map((c) => c.section_id).filter((id): id is string => !!id)),
  );
  if (otherSectionIds.length > 0) {
    const { data: secs } = await supabase
      .from("sections")
      .select("name_ru")
      .in("id", otherSectionIds);
    const cardSectionNames = ((secs ?? []) as Array<{ name_ru: string }>)
      .map((s) => s.name_ru)
      .filter(Boolean)
      .join(", ");
    throw new Error(
      `Активный абонемент на «${cardSectionNames || "другую секцию"}». Эта группа — секция «${groupSectionName}»`,
    );
  }
  throw new Error("Абонемент не подходит для этой группы");
};

export const useAddEnrollment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string; group_id: string;
      // Окно записи (date-window). Не передано → null = открытое окно.
      start_date?: string | null; end_date?: string | null;
    }) => {
      await validateEnrollment(input.child_id, input.group_id);
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("enrollments")
        .insert({
          child_id: input.child_id,
          group_id: input.group_id,
          enrolled_at: today,
          start_date: input.start_date ?? null,
          end_date: input.end_date ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      qc.invalidateQueries({ queryKey: ["lesson_roster"] });
      qc.invalidateQueries({ queryKey: ["child_lessons_v3"] });
      toast.ok("Ребёнок добавлен в группу");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Смена основного тренера группы «с даты»: группа + все будущие
// запланированные занятия выравниваются на нового тренера. Замены на
// конкретное занятие (substitute_coach_id) не трогаем. Событие в
// историю группы пишет триггер.
export const useChangeGroupCoach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { group_id: string; coach_id: string; from_date: string }) => {
      const { error } = await supabase
        .from("groups")
        .update({ coach_id: input.coach_id })
        .eq("id", input.group_id);
      if (error) throw error;
      const { error: le } = await supabase
        .from("lessons")
        .update({ coach_id: input.coach_id })
        .eq("group_id", input.group_id)
        .gte("date", input.from_date)
        .eq("status", "scheduled");
      if (le) throw le;
    },
    onSuccess: () => {
      for (const k of ["groups", "lessons", "coach_tabel", "group_tabel", "group_events"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      toast.ok("Тренер группы изменён — будущие занятия переведены");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useRemoveEnrollment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await supabase
        .from("enrollments")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", enrollmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      qc.invalidateQueries({ queryKey: ["lesson_roster"] });
      qc.invalidateQueries({ queryKey: ["child_lessons_v3"] });
      toast.ok("Убрано из группы");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Leads ============
export const useAddLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      parent_name?: string | null; phone?: string | null;
      child_name?: string | null; child_age?: number | null;
      section_interest_id?: string | null; stage?: LeadStage;
      source?: LeadSource | null; comment?: string | null;
      instagram?: string | null;
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("leads")
        .insert({ organization_id: orgId, stage: "new", ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Лид добавлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useUpdateLeadStage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: LeadStage }) => {
      const { data, error } = await supabase.from("leads").update({ stage }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
};

// Правка карточки лида целиком (ТЗ §8.2): запись на пробную, причина
// отказа, ответственный менеджер. first_contact_at при уходе с этапа
// «новый» проставляет триггер в БД — руками его слать не нужно.
export const useUpdateLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Lead> }) => {
      const { data, error } = await supabase.from("leads").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Bulk-generate lessons from group_schedule ============
export const useBulkGenerateLessons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { group_id: string; from: string; to: string }) => {
      return apiPost<{ ok: boolean; inserted: number }>("/v1/lessons/bulk-generate", input);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lessons"] }),
  });
};

// ============ Outreach (weekly call/whatsapp checkboxes) ============
export const useUpsertOutreach = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { child_id: string; week_start: string; service_call_done?: boolean; whatsapp_sent?: boolean }) => {
      const { error } = await supabase
        .from("outreach_log")
        .upsert(input, { onConflict: "child_id,week_start" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["outreach"] }),
  });
};

// ============ Lessons (direct insert via RLS — staff only) ============
export const useCreateLesson = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      group_id: string; coach_id: string; date: string; start_time: string;
      duration_min: number; type?: "regular" | "trial" | "single";
      capacity_limit?: number | null;
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("lessons")
        .insert({ organization_id: orgId, type: "regular", ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      toast.ok("Занятие создано");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Payments (staff manual receipt via backend) ============
export const useRecordPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string; amount: number; method: PaymentMethod;
      club_card_id?: string | null; comment?: string | null;
      // Опциональное частичное списание с депозита одновременно с платежом
      // (например, разовое занятие 1000₸: 500 с депозита + 500 нал).
      use_deposit?: number;
    }) => {
      return apiPost<{
        ok: boolean;
        payment_id: string | null;
        deposit_tx_id: string | null;
        balance_after: number | null;
      }>("/v1/payments", input, { idempotent: true });
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      toast.ok("Платёж принят");
    },
    onError: (e: Error) => toast.err("Ошибка платежа: " + e.message),
  });
};

// ============ Deposits (через бэк) ============
export const useTopUpDeposit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string;
      amount: number;
      method: PaymentMethod;
      comment?: string;
    }) => {
      return apiPost<{ ok: boolean; tx_id: string; balance_after: number }>(
        "/v1/deposits/topup",
        input,
        { idempotent: true }
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Депозит пополнен");
    },
    onError: (e: Error) => toast.err("Ошибка пополнения: " + e.message),
  });
};

export const useWithdrawDeposit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string;
      amount: number;
      comment: string;
    }) => {
      return apiPost<{ ok: boolean; tx_id: string; balance_after: number }>(
        "/v1/deposits/withdraw",
        input,
        { idempotent: true }
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.ok("Средства выданы");
    },
    onError: (e: Error) => toast.err("Ошибка вывода: " + e.message),
  });
};

export const useChargeDeposit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string;
      amount: number;
      comment: string;
    }) => {
      return apiPost<{ ok: boolean; tx_id: string; balance_after: number }>(
        "/v1/deposits/charge",
        input,
        { idempotent: true }
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      toast.ok("Списано с депозита");
    },
    onError: (e: Error) => toast.err("Ошибка списания: " + e.message),
  });
};

export const useAdjustDeposit = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string;
      amount: number;
      reason: string;
    }) => {
      return apiPost<{ ok: boolean; tx_id: string; balance_after: number }>(
        "/v1/deposits/adjustment",
        input,
        { idempotent: true }
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      toast.ok("Депозит скорректирован");
    },
    onError: (e: Error) => toast.err("Ошибка корректировки: " + e.message),
  });
};

// ============ Внутренние комментарии о ребёнке (office-only) ============
export const useAddChildComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { child_id: string; text: string }) => {
      const orgId = await getMyOrgId();
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("child_internal_notes")
        .insert({
          organization_id: orgId,
          child_id: input.child_id,
          text: input.text,
          author_id: u.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["child_comments", vars.child_id] });
      toast.ok("Комментарий добавлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useDeleteChildComment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; child_id: string }) => {
      const { error } = await supabase
        .from("child_internal_notes")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["child_comments", vars.child_id] });
      toast.ok("Комментарий удалён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Org settings (скидка для 2-го ребёнка и др.) ============
export const useUpdateOrgSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organization_id: string;
      sibling_discount_enabled: boolean;
      sibling_discount_amount: number;
    }) => {
      // upsert, а не update: если строки ещё нет (seed не применён / новая
      // организация), update затронул бы 0 строк и .single() упал бы.
      const { data, error } = await supabase
        .from("org_settings")
        .upsert(
          { ...input, updated_at: new Date().toISOString() },
          { onConflict: "organization_id" }
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["org_settings"] });
      toast.ok("Настройки сохранены");
    },
    onError: (e: Error) => toast.err("Ошибка сохранения: " + e.message),
  });
};

// ============ Cards / Payments / Freezes (через бэк) ============
export const useSellCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string; type: CardType; total_lessons?: number | null;
      // Тариф из каталога (null — ручной ввод) + снимок срока в днях.
      plan_id?: string | null; duration_days?: number | null;
      freeze_quota?: number; price: number;
      discount_pct: number;
      // ТЗ §3.3: причина обязательна, если скидка больше нуля.
      discount_reason?: string | null;
      start_date: string; end_date: string; payment_method: PaymentMethod;
      section_id?: string | null;
      group_id?: string | null;
      // Окно записи в группу (date-window). null = открытое окно.
      enrollment_start_date?: string | null;
      enrollment_end_date?: string | null;
      // Депозит: сколько списать с депозита + сколько налом/терминалом.
      // По умолчанию: вся сумма после скидки идёт через cash_amount.
      deposit_amount?: number;
      cash_amount?: number;
      // Ставка тренера за одно посещённое занятие (default 100).
      coach_rate_per_lesson?: number;
    }) => {
      const finalAmount = Math.max(
        0,
        input.price - (input.price * input.discount_pct) / 100
      );
      const deposit_amount = input.deposit_amount ?? 0;
      const cash_amount = input.cash_amount ?? Math.max(0, finalAmount - deposit_amount);
      const body = { freeze_quota: 0, ...input, deposit_amount, cash_amount };

      // ТЗ §12.4: без интернета доступна продажа ЗА НАЛИЧНЫЕ. Терминал
      // офлайн невозможен физически, а списание с депозита требует
      // проверки баланса на сервере — их в очередь не кладём.
      const cashOnly = input.payment_method === "cash" && deposit_amount === 0;
      if (!navigator.onLine && cashOnly) {
        const op = enqueue("card.sell", { body }, `Продажа абонемента · ${formatSum(cash_amount)}`, {
          idempotent: true,
        });
        // Ответ сервера появится только после синхронизации. Возвращаем
        // заглушку, чтобы экран продажи закрылся: деньги от клиента
        // получены, задерживать кассира нечем.
        return {
          ok: true,
          queued: true,
          op_id: op.id,
          card_id: "",
          applied_discount: 0,
          applied_discount_pct: 0,
          discount_reason: null,
          enrollment_id: null,
        };
      }
      if (!navigator.onLine) {
        throw new Error(
          "Нет связи. Офлайн можно продать только за наличные — без терминала и списания с депозита.",
        );
      }

      return apiPost<{
        ok: boolean;
        card_id: string;
        applied_discount: number;
        applied_discount_pct: number;
        discount_reason: string | null;
        enrollment_id: string | null;
      }>("/v1/cards/sell", body, { idempotent: true });
    },
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      // Новая карта меняет состав занятий, окно записи и пул занятий
      // ребёнка — табели и карточка обязаны перечитаться сразу.
      qc.invalidateQueries({ queryKey: ["lesson_roster"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["child_lessons_v3"] });
      qc.invalidateQueries({ queryKey: ["attendance_child"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["active_cards_child", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["active_cards_children"] });
      qc.invalidateQueries({ queryKey: ["deposit_balance", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_history", vars.child_id] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      qc.invalidateQueries({ queryKey: ["payroll_live"] });
      qc.invalidateQueries({ queryKey: ["payroll_me_live"] });
      // Офлайн-продажа (ТЗ §12.4): сервер её ещё не видел, поэтому ни
      // скидок, ни записи в группу в ответе нет — не выдумываем их.
      if ((data as { queued?: boolean } | undefined)?.queued) {
        toast.ok("Продажа сохранена и уйдёт, как появится связь. Абонемент появится после синхронизации.");
        return;
      }
      const enrolled = !!data?.enrollment_id;
      const sibling = data?.discount_reason === "auto_2nd_child";
      const msg = enrolled
        ? sibling
          ? "Карта продана, ребёнок записан в группу. Применена авто-скидка за 2-го ребёнка."
          : "Карта продана, ребёнок записан в группу."
        : sibling
          ? "Карта продана. Применена авто-скидка за 2-го ребёнка."
          : "Карта продана";
      toast.ok(msg);
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useCreateFreeze = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      child_id: string;
      club_card_id: string;
      reason: string;
      start_date: string;
      end_date: string;
    }) => {
      return apiPost<{ ok: boolean; freeze_id: string; status: string }>(
        "/v1/freezes",
        input,
        { idempotent: true }
      );
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["freezes"] });
      qc.invalidateQueries({ queryKey: ["freezes_child"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      // Старшие роли создают сразу approved — а значит триггер уже продлил
      // абонемент и сдвинул окно записи в группу. Без сброса этих кэшей на
      // экране остался бы старый срок карты и старый ростер.
      if (data?.status !== "pending") {
        qc.invalidateQueries({ queryKey: ["club_cards"] });
        qc.invalidateQueries({ queryKey: ["card_balance"] });
        qc.invalidateQueries({ queryKey: ["card_balances"] });
        qc.invalidateQueries({ queryKey: ["enrollments_group"] });
        qc.invalidateQueries({ queryKey: ["child_enrollments"] });
        qc.invalidateQueries({ queryKey: ["group_tabel"] });
      }
      // Родитель/тренер создают pending → формулируем как «запрос»;
      // старшие роли auto-approve → «создана».
      toast.ok(data?.status === "pending"
        ? "Запрос на заморозку отправлен"
        : "Заморозка создана");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useApproveFreeze = () => {
  const qc = useQueryClient();
  return useMutation({
    // Опционально можно прислать start_date/end_date — backend
    // обновит даты при approve (manager корректирует, если родитель
    // указал неточно).
    mutationFn: async (input: string | { id: string; start_date?: string; end_date?: string }) => {
      const id = typeof input === "string" ? input : input.id;
      const body = typeof input === "string" ? {} : { start_date: input.start_date, end_date: input.end_date };
      return apiPost<{ ok: boolean }>(`/v1/freezes/${id}/approve`, body, { idempotent: true });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["freezes"] });
      qc.invalidateQueries({ queryKey: ["freezes_child"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      // Одобрение применяет эффект: карта продлевается, окно записи едет.
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok("Заморозка одобрена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useRejectFreeze = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiPost<{ ok: boolean }>(`/v1/freezes/${id}/reject`, {}, { idempotent: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["freezes"] });
      qc.invalidateQueries({ queryKey: ["freezes_child"] });
      toast.ok("Заморозка отклонена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Card lifecycle (extend / cancel) ============
export const useExtendCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; new_end_date: string }) =>
      apiPost<{ ok: boolean }>("/v1/cards/extend", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["active_cards_child"] });
      qc.invalidateQueries({ queryKey: ["active_cards_children"] });
      // Продление двигает окно записи и занятия — обновляем табели и
      // список посещений, иначе «продлили, а тренировки не появились».
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["attendance_child"] });
      qc.invalidateQueries({ queryKey: ["child_lessons_v3"] });
      qc.invalidateQueries({ queryKey: ["lesson_roster"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok("Срок абонемента изменён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Закрыть абонемент досрочно (заблокировать) — с сохранением истории.
// Отличие от «Отменить» (archived): карта остаётся в истории, её
// посещения и пропуски видны, остаток фиксируется; ребёнок остаётся в
// группе, но дальше по этой карте не отмечается. Нужно офису, когда
// ребёнок переходит в другую группу/время — следом продают новый
// абонемент с новой группой (запрос старшего менеджера 2026-09-02).
export const useCloseCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; reason: string }) =>
      apiPost<{ ok: boolean; end_date: string }>("/v1/cards/close", input),
    onSuccess: () => {
      for (const k of [
        "club_cards", "card_balance", "card_balances", "children", "stats",
        "active_cards_child", "active_cards_children",
        "enrollments_group", "child_enrollments", "attendance_child",
        "child_lessons_v3", "lesson_roster", "coach_tabel", "group_tabel",
      ]) qc.invalidateQueries({ queryKey: [k] });
      toast.ok("Абонемент закрыт — история сохранена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Снять отметку (офис правит табель): удаляем строку attendance. Нужна
// для исправления ошибочных отметок — например, когда тренер отметил
// ребёнка не в том занятии.
export const useClearAttendance = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ lessonId, childId }: { lessonId: string; childId: string }) => {
      const { error } = await supabase
        .from("attendance")
        .delete()
        .eq("lesson_id", lessonId)
        .eq("child_id", childId);
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      for (const k of ["attendance_by_section", "coach_tabel", "group_tabel", "attendance_child", "card_balance", "card_balances", "child_lessons_v3", "payroll_live", "payroll_me_live"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
      qc.invalidateQueries({ queryKey: ["attendance_lesson", vars.lessonId] });
      qc.invalidateQueries({ queryKey: ["lesson_roster", vars.lessonId] });
      toast.ok("Отметка снята");
    },
    onError: (e: Error) => toast.err("Не удалось снять отметку: " + e.message),
  });
};

// Добавить занятия к абонементу («+ занятия»): счётчик total_lessons
// растёт, срок карты и окно записи продлеваются по расписанию группы,
// занятия догенерируются, оплата необязательна (0 = компенсация).
export const useAddCardLessons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      card_id: string; count: number; price?: number;
      payment_method?: PaymentMethod; deposit_amount?: number; comment?: string | null;
    }) =>
      apiPost<{ ok: boolean; total_lessons: number; end_date: string; end_source: "schedule" | "estimate" }>(
        "/v1/cards/add-lessons", input, { idempotent: true },
      ),
    onSuccess: (res) => {
      for (const k of [
        "club_cards", "card_balance", "card_balances", "children", "stats",
        "active_cards_child", "active_cards_children", "payments",
        "deposit_balance", "deposit_history", "deposit_summary",
        "enrollments_group", "child_enrollments", "attendance_child",
        "child_lessons_v3", "lesson_roster", "coach_tabel", "group_tabel", "lessons",
        "child_comments",
      ]) qc.invalidateQueries({ queryKey: [k] });
      const [y, m, d] = res.end_date.split("-");
      toast.ok(`Занятия добавлены: теперь ${res.total_lessons}, срок до ${d}.${m}.${y}`);
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Снять тренировки с абонемента («Удалить тренировки»): выбранные
// предстоящие занятия пропадают у ребёнка, счётчик занятий уменьшается.
const CARD_LESSON_KEYS = [
  "club_cards", "card_balance", "card_balances", "card_lesson_exclusions",
  "child_lessons_v3", "lesson_roster", "coach_tabel", "group_tabel",
  "attendance_child", "child_comments", "children", "stats",
];
export const useRemoveCardLessons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; lesson_ids: string[]; reason?: string | null }) =>
      apiPost<{ ok: boolean; removed: number; total_lessons: number | null; rejected: Array<{ lesson_id: string; reason: string }> }>(
        "/v1/cards/remove-lessons", input, { idempotent: true },
      ),
    onSuccess: (res) => {
      for (const k of CARD_LESSON_KEYS) qc.invalidateQueries({ queryKey: [k] });
      const rej = res.rejected?.length ?? 0;
      toast.ok(`Снято тренировок: ${res.removed}${res.total_lessons != null ? ` · занятий теперь ${res.total_lessons}` : ""}${rej ? ` · не снято: ${rej}` : ""}`);
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};
export const useRestoreCardLessons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; lesson_ids: string[] }) =>
      apiPost<{ ok: boolean; restored: number; total_lessons: number | null }>("/v1/cards/restore-lessons", input),
    onSuccess: (res) => {
      for (const k of CARD_LESSON_KEYS) qc.invalidateQueries({ queryKey: [k] });
      toast.ok(`Возвращено тренировок: ${res.restored}`);
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// Сверка по кассе: исправить способ оплаты (нал ↔ терминал), если при
// приёме выбрали не то. Сумма и дата не меняются; факт правки уходит в
// комментарий платежа и в audit_log.
export const useChangePaymentMethod = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { payment_id: string; method: PaymentMethod; reason?: string }) =>
      apiPatch<{ ok: boolean }>(`/v1/payments/${input.payment_id}/method`, {
        method: input.method, reason: input.reason ?? null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Способ оплаты исправлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useCancelCard = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { card_id: string; reason: string }) =>
      apiPost<{ ok: boolean }>("/v1/cards/cancel", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["active_cards_child"] });
      qc.invalidateQueries({ queryKey: ["active_cards_children"] });
      toast.ok("Абонемент отменён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Freeze early end ============
export const useEndFreeze = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiPost<{ ok: boolean }>(`/v1/freezes/${id}/end`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["freezes"] });
      qc.invalidateQueries({ queryKey: ["freezes_child"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      // Досрочное снятие откатывает и окно записи в группу — ростер и
      // табель обязаны перечитаться.
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok("Заморозка снята");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

// ============ Lesson edit (PATCH /v1/lessons/:id) ============
export const useUpdateLesson = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; date?: string; start_time?: string; duration_min?: number; coach_id?: string; substitute_coach_id?: string | null; capacity_limit?: number | null }) => {
      const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/v1/lessons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.json() as Promise<{ ok: boolean; lesson: any }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      // Перенос даты подтягивает окно записи в группу на backend'е.
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok("Занятие обновлено");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useCancelLesson = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason, force_majeure, cancellation_fault }: {
      id: string;
      reason: string;
      force_majeure: boolean;
      // ТЗ §5.3 п.4: от вины зависит оплата тренера.
      cancellation_fault?: LessonFault;
    }) =>
      apiPost<{ ok: boolean; credited: number; notified: number }>(
        `/v1/lessons/${id}/cancel`,
        { reason, force_majeure, cancellation_fault },
        { idempotent: true },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["freezes"] });
      // Компенсация по ТЗ §4.4 — не молчаливая: офис должен видеть,
      // скольким детям вернули занятие.
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      const credited = Number(r?.credited ?? 0);
      toast.ok(credited > 0
        ? `Занятие отменено · +1 занятие вернули ${credited} детям`
        : "Занятие отменено");
    },
    onError: (e: Error) => toast.err("Ошибка отмены: " + e.message),
  });
};

// ============ Attendance (coach direct via RLS) ============
// Helper: compute the 24h deadline after a lesson ends (local wall-clock
// time, treated as Asia/Bishkek — the org default — to match the RLS check).
export const lessonMarkingDeadline = (
  date: string,
  start_time: string,
  duration_min: number
): Date => {
  // Build a Date from the lesson's local wall-clock fields. The runtime
  // treats it as the browser's local time, which for staff/coaches in the
  // club's TZ matches the RLS comparison. Acceptable approximation — the
  // server is the source of truth via RLS.
  const [hh, mm] = start_time.slice(0, 5).split(":").map((n) => parseInt(n, 10));
  const d = new Date(date + "T00:00:00");
  d.setHours(hh, mm, 0, 0);
  d.setMinutes(d.getMinutes() + duration_min + 24 * 60);
  return d;
};

export const useMarkAttendance = () => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? null;
  return useMutation({
    mutationFn: async ({ lessonId, marks }: { lessonId: string; marks: { child_id: string; status: AttendanceStatus }[] }) => {
      if (marks.length === 0) throw new Error("Нечего сохранять");

      // ТЗ §12.4: офлайн отметка посещений должна работать. Проверяем
      // связь ПЕРВЫМ делом: и сверка занятия ниже, и auth.getUser() ходят
      // в сеть, то есть офлайн мы бы упали, не дойдя до очереди.
      //
      // Серверные проверки (будущая дата, 24-часовое окно) при этом не
      // теряются: экран тренера уже блокирует кнопки по тем же правилам,
      // а на синхронизации границу держит RLS. Отклонённое попадёт в
      // список отклонённых, а не растворится.
      if (!navigator.onLine) {
        // getSession читает токен из локального хранилища, без сети —
        // в отличие от getUser().
        const { data: sess } = await supabase.auth.getSession();
        enqueue(
          "attendance.mark",
          {
            lessonId,
            marks,
            markedBy: sess.session?.user?.id ?? null,
            markedAt: new Date().toISOString(),
          },
          `Посещаемость · ${marks.length} отметок`,
        );
        return { failedIds: [] as string[], failedNames: [] as string[], queued: true };
      }

      // 1. Lesson must not be in the future, and for coaches the 24h
      // marking window must still be open. Mirrors the RLS policy, gives
      // a clearer error than the obscure RLS denial.
      const { data: lesson, error: lessonErr } = await supabase
        .from("lessons")
        .select("date, start_time, duration_min, group:groups(section_id)")
        .eq("id", lessonId)
        .maybeSingle();
      if (lessonErr) throw lessonErr;
      if (!lesson) throw new Error("Занятие не найдено");
      const today = new Date().toISOString().slice(0, 10);
      if (lesson.date > today) {
        throw new Error("Нельзя отмечать посещение для будущего занятия");
      }
      if (role === "coach") {
        const deadline = lessonMarkingDeadline(
          lesson.date,
          lesson.start_time,
          lesson.duration_min ?? 60
        );
        if (Date.now() > deadline.getTime()) {
          throw new Error("Окно отметки закрыто (24 ч после занятия). Обратитесь к администратору");
        }
      }

      // 2. Клиентского фильтра «есть ли абонемент на дату» больше НЕТ
      // (инцидент 2026-09-11: тренер отметил ребёнка, приложение молча
      // выбросило его из сохранения — club_cards читались под RLS тренера,
      // карта другой секции была не видна, а окно записи в группу вообще
      // не учитывалось). Границу держит сервер: политика attendance_coach_write
      // → fn_attendance_date_allowed (абонемент ИЛИ окно записи покрывает
      // дату). Если сервер отвергнет кого-то — сохраняем остальных и
      // называем имена, а не прячем.
      const acceptedMarks = marks;
      if (acceptedMarks.length === 0) throw new Error("Нечего сохранять");

      const { data: sess } = await supabase.auth.getSession();
      // Время отметки, а не отправки: тренер отмечает в зале, а очередь
      // может уйти вечером. marked_at должен показывать первое.
      const payload = {
        lessonId,
        marks: acceptedMarks,
        markedBy: sess.session?.user?.id ?? null,
        markedAt: new Date().toISOString(),
      };

      // Онлайн идём тем же исполнителем, что и очередь: две копии пути
      // записи неизбежно разъехались бы.
      const res = await writeAttendanceMarks(payload);
      return { ...res, queued: false };
    },
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["attendance_lesson", vars.lessonId] });
      qc.invalidateQueries({ queryKey: ["attendance_by_section"] });
      qc.invalidateQueries({ queryKey: ["coach_tabel"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      // Отметка может добавить ребёнка в состав занятия («есть отметка»)
      // и меняет пул занятий карты (посещение потрачено).
      qc.invalidateQueries({ queryKey: ["lesson_roster", vars.lessonId] });
      qc.invalidateQueries({ queryKey: ["child_lessons_v3"] });
      qc.invalidateQueries({ queryKey: ["attendance_child"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      // Live-зарплата зависит от present-отметок — пересчитываем сразу,
      // чтобы тренер видел движение цифры после сохранения отметок.
      qc.invalidateQueries({ queryKey: ["payroll_live"] });
      qc.invalidateQueries({ queryKey: ["payroll_me_live"] });
      // ["stats"] намеренно НЕ инвалидируем: отметку делает тренер, а это
      // запускало 11-запросный пересчёт KPI, который тренеру не показывается.
      // Посещаемость в Dashboard обновится по staleTime.
      // Офлайн-отметка ещё не доехала до сервера — не говорим «сохранено»,
      // это разные вещи (ТЗ §12.4).
      if ((res as { queued?: boolean } | undefined)?.queued) {
        toast.ok("Отмечено. Отправим, как появится связь.");
        return;
      }
      const failed = res?.failedIds?.length ?? 0;
      if (failed > 0) {
        const who = res.failedNames.length ? res.failedNames.join(", ") : `${failed} детей`;
        toast.err(`НЕ сохранено: ${who} — нет абонемента или записи в группу на эту дату. Сообщите офису.`);
      } else {
        toast.ok("Сохранено");
      }
    },
    onError: (e: Error) => toast.err("Не удалось сохранить: " + e.message),
  });
};

export const useAddProgressNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { child_id: string; coach_id: string; text: string; is_public?: boolean }) => {
      const { data, error } = await supabase
        .from("progress_notes")
        .insert({ is_public: true, ...input })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ["progress_notes", vars.child_id] }),
  });
};


// ============ Coach rates / payroll / refunds (backend-mediated) ============
export const useAddCoachRate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      coach_id: string; group_id: string; rate_per_kid: number;
      effective_from: string; comment?: string | null;
    }) => apiPost<{ ok: boolean; rate: any }>("/v1/coach-rates", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coach_rates"] });
      toast.ok("Ставка сохранена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useRecomputePayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { period_start: string; period_end: string }) =>
      apiPost<{ ok: boolean; count: number }>("/v1/payroll/recompute", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.ok("Зарплаты пересчитаны");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useAdjustPayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; manual_adjustment: number; adjustment_reason: string }) =>
      apiPost<{ ok: boolean }>(`/v1/payroll/${input.id}/adjust`, {
        manual_adjustment: input.manual_adjustment,
        adjustment_reason: input.adjustment_reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.ok("Корректировка сохранена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useAdvancePayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiPost<{ ok: boolean; advance_amount: number }>(`/v1/payroll/${id}/advance`, {}),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      // Сумму показываем сразу: по ТЗ §10.2 её считает сервер (50% от
      // заработанного с 1-го по 20-е), и управляющий должен увидеть,
      // сколько выдавать на руки, не открывая отчёт.
      const amount = Number(r?.advance_amount ?? 0);
      toast.ok(amount > 0 ? `Аванс отмечен: ${amount.toLocaleString("ru-RU")} сом` : "Аванс отмечен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useApprovePayroll = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiPost<{ ok: boolean }>(`/v1/payroll/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll"] });
      toast.ok("Зарплата утверждена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useCreateRefund = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { club_card_id: string; kind: "with_30pct" | "full_no_fee"; reason: string }) =>
      apiPost<{
        ok: boolean;
        refund_id: string;
        refund_amount: number;
        fee_amount: number;
        balance_after: number | null;
      }>("/v1/refunds", input, { idempotent: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["refunds"] });
      qc.invalidateQueries({ queryKey: ["club_cards"] });
      qc.invalidateQueries({ queryKey: ["card_balance"] });
      qc.invalidateQueries({ queryKey: ["card_balances"] });
      qc.invalidateQueries({ queryKey: ["children"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["active_cards_child"] });
      qc.invalidateQueries({ queryKey: ["active_cards_children"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["deposit_balance"] });
      qc.invalidateQueries({ queryKey: ["deposit_history"] });
      qc.invalidateQueries({ queryKey: ["deposit_summary"] });
      toast.ok("Возврат оформлен — сумма зачислена на депозит");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};


export const useCreateParentAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      password: string; full_name: string; phone: string | null;
      email?: string | null;
      family_id?: string;
      father_name?: string | null; father_phone?: string | null;
      mother_name?: string | null; mother_phone?: string | null;
      comment?: string | null;
    }) => apiPost<{ ok: boolean; parent_id: string; family_id: string }>("/v1/parents", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      toast.ok("Родитель создан, доступ выдан");
    },
    onError: (e: Error) => toast.err(friendlyAuthError(e.message)),
  });
};

export const useUpdateParent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: {
      id: string;
      full_name?: string;
      email?: string | null;
      phone?: string;
      password?: string;
    }) => {
      // Backend schema у /v1/parents/:id: phone ≥ 7 символов, password ≥ 8,
      // full_name ≥ 1, email — корректный email или null. Если поле пустое
      // строкой ("") или короткое — backend вернёт 400 validation. Чистим
      // payload, чтобы случайные пустые/невалидные значения не уходили.
      const clean: Record<string, unknown> = {};
      if (patch.full_name !== undefined) {
        const v = String(patch.full_name).trim();
        if (v.length >= 1) clean.full_name = v;
      }
      if (patch.phone !== undefined) {
        const v = String(patch.phone).trim();
        if (v.length >= 7) clean.phone = v;
      }
      if (patch.password !== undefined) {
        const v = String(patch.password);
        if (v.length >= 8) clean.password = v;
      }
      if (patch.email !== undefined) {
        // email можно явно сбросить в null, иначе должен быть непустой
        if (patch.email === null) {
          clean.email = null;
        } else {
          const v = String(patch.email).trim();
          if (v.length > 0) clean.email = v;
        }
      }
      if (Object.keys(clean).length === 0) {
        // Нечего отправлять — это, скорее всего, баг UI (нажали "сохранить"
        // не изменив ничего). Не дёргаем backend ради 400.
        return { ok: true };
      }
      return apiPatch<{ ok: boolean }>(`/v1/parents/${id}`, clean);
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["families"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["profile", vars.id] });
      if (vars.password) toast.ok("Пароль изменён");
      else toast.ok("Данные родителя обновлены");
    },
    onError: (e: Error) => toast.err(friendlyAuthError(e.message)),
  });
};

// ============ Staff (директор: создание/правка сотрудников) ============
export type StaffRole = "fitness_director" | "senior_manager" | "manager" | "cashier";

export type StaffOptionalFields = {
  email?: string | null;
  avatar_url?: string | null;
  inn?: string | null;
  birthday?: string | null;
  hire_date?: string | null;
  address?: string | null;
  notes?: string | null;
};

export const useCreateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      phone: string; password: string; full_name: string; role: StaffRole;
    } & StaffOptionalFields) =>
      apiPost<{ ok: boolean; staff_id: string; phone: string }>("/v1/staff", input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.ok("Сотрудник создан");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useUpdateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: {
      id: string;
      full_name?: string;
      phone?: string;
      role?: StaffRole;
      is_active?: boolean;
    } & StaffOptionalFields) => apiPatch<{ ok: boolean }>(`/v1/staff/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.ok("Сотрудник обновлён");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useDeleteStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => apiDelete<{ ok: boolean }>(`/v1/staff/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.ok("Сотрудник удалён");
    },
    onError: (e: Error) => {
      const msg = e.message;
      if (msg.includes("cannot_delete_director")) toast.err("Директора удалить нельзя");
      else if (msg.includes("cannot_delete_self")) toast.err("Нельзя удалить себя");
      else toast.err("Ошибка: " + msg);
    },
  });
};

export const useRestoreStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      apiPost<{ ok: boolean }>(`/v1/staff/${id}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["users"] });
      toast.ok("Сотрудник восстановлен");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useResetStaffPassword = () => {
  return useMutation({
    mutationFn: async (input: { id: string; password: string }) =>
      apiPost<{ ok: boolean }>(`/v1/staff/${input.id}/password`, { password: input.password }),
    onSuccess: () => toast.ok("Пароль обновлён"),
    onError: (e: Error) => toast.err(friendlyAuthError(e.message)),
  });
};

// ============ Lesson notes (тренер → заметка к занятию + фото) ============
export const useUpsertLessonNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      lesson_id: string;
      child_id: string;
      coach_id: string;
      text: string;
      photo_paths: string[];
    }) => {
      const orgId = await getMyOrgId();
      const { data, error } = await supabase
        .from("lesson_notes")
        .upsert(
          { organization_id: orgId, ...input },
          { onConflict: "lesson_id,child_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["lesson_notes", vars.lesson_id] });
      qc.invalidateQueries({ queryKey: ["lesson_notes_parent"] });
      qc.invalidateQueries({ queryKey: ["lesson_notes_mine"] });
      qc.invalidateQueries({ queryKey: ["lesson_notes_bulk"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.ok("Заметка сохранена");
    },
    onError: (e: Error) => toast.err("Ошибка: " + e.message),
  });
};

export const useUploadLessonNotePhoto = () => {
  return useMutation({
    mutationFn: async (input: {
      lesson_id: string;
      child_id: string;
      file: File;
    }): Promise<string> => {
      const orgId = await getMyOrgId();
      const ext = input.file.name.split(".").pop()?.toLowerCase() || "jpg";
      const uuid = crypto.randomUUID();
      const path = `${orgId}/${input.lesson_id}/${input.child_id}/${uuid}.${ext}`;
      const { error } = await supabase.storage
        .from("lesson-notes")
        .upload(path, input.file, { contentType: input.file.type, upsert: false });
      if (error) throw error;
      return path;
    },
  });
};

// ============ Notifications (родителю) ============
export const useMarkNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

export const useMarkAllNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("not_authenticated");
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("recipient_id", u.user.id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
};

// ============ Bulk schedule operations ============
export type BulkRescheduleInput =
  | { lesson_ids: string[]; mode: "shift_days"; shift_days: number; new_start_time?: string; reason?: string }
  | { lesson_ids: string[]; mode: "set_date"; new_date: string; new_start_time?: string; reason?: string };

export type BulkConflict = { lesson_id: string; date: string; start_time: string };

export const useBulkReschedule = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkRescheduleInput) => {
      return apiPost<{ ok: true; moved: number; notified: number }>(
        "/v1/lessons/bulk-reschedule",
        input
      );
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      // Перенос вперёд подтягивает окна записи, чтобы дети не выпали из
      // ростера перенесённого занятия (см. extendEnrollmentWindowsForMove).
      qc.invalidateQueries({ queryKey: ["enrollments_group"] });
      qc.invalidateQueries({ queryKey: ["child_enrollments"] });
      qc.invalidateQueries({ queryKey: ["group_tabel"] });
      toast.ok(`Перенесено: ${res.moved}. Уведомлений отправлено: ${res.notified}`);
    },
    onError: (e: Error) => {
      // 409 conflicts come through as "API 409: {\"error\":\"conflicts\",\"conflicts\":[...]}"
      const m = e.message.match(/^API 409:\s*(\{.*\})/);
      if (m) {
        try {
          const body = JSON.parse(m[1]);
          if (body.error === "conflicts") {
            toast.err(`Конфликт времени: ${body.conflicts?.length ?? 0} занятий пересекаются`);
            return;
          }
          if (body.error === "lesson_already_cancelled") {
            toast.err("Среди выбранных есть уже отменённое занятие");
            return;
          }
        } catch {}
      }
      toast.err("Не удалось перенести: " + e.message);
    },
  });
};

export const useBulkCancelLessons = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { lesson_ids: string[]; reason: string }) => {
      return apiPost<{ ok: true; cancelled: number; notified: number }>(
        "/v1/lessons/bulk-cancel",
        input
      );
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
      toast.ok(`Отменено: ${res.cancelled}. Уведомлений: ${res.notified}`);
    },
    onError: (e: Error) => toast.err("Не удалось отменить: " + e.message),
  });
};

