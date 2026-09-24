import { z } from "zod";

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;

// §2 Номенклатура услуг
export const ptServiceSchema = z.object({
  name: z.string().min(2).max(200),
  section_id: z.string().uuid().nullable().optional(),
  type: z.enum(["personal", "mini_group"]).default("personal"),
  capacity: z.number().int().min(1).max(50).default(1),
  price: z.number().nonnegative(),
  duration_min: z.number().int().min(15).max(480).default(60),
  lessons_count: z.number().int().min(1).max(200),
  validity_days: z.number().int().min(1).max(730).default(30),
  activation_deadline_days: z.number().int().min(1).max(365).default(30),
  reschedule_limit_hours: z.number().int().min(0).max(720).default(24),
  cancel_limit_hours: z.number().int().min(0).max(720).default(24),
  coach_edit_limit_hours: z.number().int().min(0).max(720).default(2),
  mark_deadline_hours: z.number().int().min(1).max(720).default(24),
  freeze_allowed: z.boolean().default(false),
  refundable: z.boolean().default(true),
  blockable: z.boolean().default(true),
  coach_category: z.string().max(200).nullable().optional(),
  coach_percent_default: z.number().min(0).max(100).default(50),
  comment: z.string().max(1000).nullable().optional(),
  is_active: z.boolean().default(true),
});

export const ptServicePatchSchema = ptServiceSchema.partial();

export const ptCoachRatesSchema = z.object({
  rates: z
    .array(
      z.object({
        coach_id: z.string().uuid(),
        price: z.number().nonnegative().nullable().optional(),
        percent: z.number().min(0).max(100).nullable().optional(),
      })
    )
    .max(100),
});

// §3 Продажа пакетов (персональные и мини-группы)
export const ptSellSchema = z.object({
  service_id: z.string().uuid(),
  coach_id: z.string().uuid(),
  group_name: z.string().max(200).nullable().optional(),
  payment_method: z.enum(["cash", "terminal"]).default("cash"),
  items: z
    .array(
      z.object({
        child_id: z.string().uuid(),
        price: z.number().nonnegative().optional(),
        pay_cash: z.number().nonnegative().default(0),
        pay_deposit: z.number().nonnegative().default(0),
        in_debt: z.boolean().default(false),
        debt_comment: z.string().max(500).nullable().optional(),
      })
    )
    .min(1)
    .max(20),
});

export const ptPaySchema = z.object({
  amount: z.number().nonnegative().default(0),
  use_deposit: z.number().nonnegative().default(0),
  method: z.enum(["cash", "terminal"]).default("cash"),
  comment: z.string().max(500).nullable().optional(),
});

export const ptBlockSchema = z.object({ reason: z.string().min(1).max(500) });

export const ptExtendSchema = z.object({
  new_expires_at: z.string().regex(dateRe),
  comment: z.string().max(500).nullable().optional(),
});

export const ptRefundSchema = z.object({
  kind: z.enum(["partial", "full"]),
  amount: z.number().positive(),
  reason: z.string().min(1).max(500),
  to_deposit: z.boolean().default(true),
  method: z.enum(["cash", "terminal"]).default("cash"),
});

export const ptChangeCoachSchema = z.object({
  coach_id: z.string().uuid(),
  comment: z.string().max(500).nullable().optional(),
});

export const ptAddParticipantSchema = z.object({
  child_id: z.string().uuid(),
  price: z.number().nonnegative(),
  pay_cash: z.number().nonnegative().default(0),
  pay_deposit: z.number().nonnegative().default(0),
  in_debt: z.boolean().default(false),
  debt_comment: z.string().max(500).nullable().optional(),
  payment_method: z.enum(["cash", "terminal"]).default("cash"),
});

// §5/§18 Запись на тренировку
export const ptBookSchema = z.object({
  service_id: z.string().uuid(),
  coach_id: z.string().uuid(),
  date: z.string().regex(dateRe),
  start_time: z.string().regex(timeRe),
  duration_min: z.number().int().min(15).max(480).optional(),
  package_ids: z.array(z.string().uuid()).min(1).max(20),
  comment: z.string().max(500).nullable().optional(),
});

export const ptSessionPatchSchema = z.object({
  date: z.string().regex(dateRe).optional(),
  start_time: z.string().regex(timeRe).optional(),
  duration_min: z.number().int().min(15).max(480).optional(),
  comment: z.string().max(500).nullable().optional(),
});

// §6 Проведение
export const ptCompleteSchema = z.object({
  attendance: z
    .array(
      z.object({
        lesson_id: z.string().uuid(),
        status: z.enum(["attended", "missed"]).default("attended"),
        charge: z.boolean().default(true),
        entry_time: z.string().nullable().optional(),
        exit_time: z.string().nullable().optional(),
      })
    )
    .min(1)
    .max(20),
  actual_coach_id: z.string().uuid().nullable().optional(),
  substitution_comment: z.string().max(500).nullable().optional(),
  source: z.enum(["coach", "admin"]).default("admin"),
});

// §9 Отмена / перенос
export const ptCancelSchema = z.object({
  reason: z.string().min(1).max(500),
  charge: z.boolean().default(false),
});

export const ptRescheduleSchema = z.object({
  new_date: z.string().regex(dateRe),
  new_time: z.string().regex(timeRe),
  reason: z.string().min(1).max(500),
});

// §15 Замена тренера
export const ptSubstituteSchema = z.object({
  actual_coach_id: z.string().uuid(),
  comment: z.string().max(500).nullable().optional(),
});

// §10 Ручные корректировки посещения
export const ptLessonStatusSchema = z.object({
  status: z.enum(["scheduled", "attended", "missed", "cancelled", "rescheduled"]),
  charge: z.boolean(),
  reason: z.string().max(500).nullable().optional(),
});

export const ptEntryExitSchema = z.object({
  entry_time: z.string().nullable().optional(),
  exit_time: z.string().nullable().optional(),
});

// §16 Комментарий тренера
export const ptCommentSchema = z.object({
  package_id: z.string().uuid(),
  milestone: z.number().int().min(1),
  text: z.string().min(3).max(2000),
});
