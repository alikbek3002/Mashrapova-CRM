import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const freezeCreateSchema = z.object({
  child_id: z.string().uuid(),
  club_card_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
  start_date: z.string().regex(dateRegex, "Дата начала обязательна"),
  end_date: z.string().regex(dateRegex, "Дата окончания обязательна"),
}).refine((d) => d.end_date >= d.start_date, {
  message: "Дата окончания должна быть не раньше даты начала",
  path: ["end_date"],
});
export type FreezeCreateInput = z.infer<typeof freezeCreateSchema>;

export const freezeApproveSchema = z.object({
  freeze_id: z.string().uuid(),
});
