import { z } from "zod";

export const lessonCancelSchema = z.object({
  reason: z.string().min(1).max(500),
  force_majeure: z.boolean().default(false),
  // ТЗ §5.3 п.4: от вины зависит оплата тренера, поэтому причина по
  // существу — отдельное поле, а не разбор свободного текста.
  // Не обязательное: офис может не знать причину сразу, но если отмена
  // помечена force_majeure — вина проставляется автоматически.
  cancellation_fault: z
    .enum(["coach", "club", "force_majeure", "client", "other"])
    .optional(),
});
export type LessonCancelInput = z.infer<typeof lessonCancelSchema>;

export const bulkRescheduleSchema = z
  .object({
    lesson_ids: z.array(z.string().uuid()).min(1).max(200),
    mode: z.enum(["shift_days", "set_date"]),
    shift_days: z.number().int().min(-365).max(365).optional(),
    new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    new_start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
    reason: z.string().max(500).optional(),
  })
  .refine(
    (v) => (v.mode === "shift_days" ? typeof v.shift_days === "number" && v.shift_days !== 0 : true),
    { message: "shift_days required and non-zero for mode=shift_days" }
  )
  .refine((v) => (v.mode === "set_date" ? !!v.new_date : true), {
    message: "new_date required for mode=set_date",
  });
export type BulkRescheduleInput = z.infer<typeof bulkRescheduleSchema>;

export const bulkCancelSchema = z.object({
  lesson_ids: z.array(z.string().uuid()).min(1).max(200),
  reason: z.string().min(1).max(500),
});
export type BulkCancelInput = z.infer<typeof bulkCancelSchema>;
