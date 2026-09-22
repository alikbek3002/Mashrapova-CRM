import { z } from "zod";

export const depositTopUpSchema = z.object({
  child_id: z.string().uuid(),
  amount: z.number().positive(),
  method: z.enum(["cash", "terminal"]),
  comment: z.string().max(500).optional(),
});
export type DepositTopUpInput = z.infer<typeof depositTopUpSchema>;

// Вывод: comment обязателен — нужно знать причину выдачи наличных.
export const depositWithdrawSchema = z.object({
  child_id: z.string().uuid(),
  amount: z.number().positive(),
  comment: z.string().min(1, "Укажите причину выдачи").max(500),
});
export type DepositWithdrawInput = z.infer<typeof depositWithdrawSchema>;

// Разовое списание (разовое занятие/штраф/другое) без записи в payments.
export const depositChargeSchema = z.object({
  child_id: z.string().uuid(),
  amount: z.number().positive(),
  comment: z.string().min(1, "Опишите услугу").max(500),
});
export type DepositChargeInput = z.infer<typeof depositChargeSchema>;

// Корректировка директором. amount может быть и положительным, и отрицательным.
export const depositAdjustmentSchema = z.object({
  child_id: z.string().uuid(),
  amount: z.number().refine((v) => v !== 0, { message: "Сумма не может быть 0" }),
  reason: z.string().min(1, "Причина обязательна").max(500),
});
export type DepositAdjustmentInput = z.infer<typeof depositAdjustmentSchema>;
