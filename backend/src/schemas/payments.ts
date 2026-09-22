import { z } from "zod";

export const paymentCreateSchema = z
  .object({
    child_id: z.string().uuid(),
    club_card_id: z.string().uuid().optional(),
    amount: z.number().nonnegative(),
    method: z.enum(["cash", "terminal"]),
    // Сколько списать с депозита одновременно с приёмом платежа.
    // Используется в AcceptPaymentModal для разовых услуг с комбинированной оплатой.
    use_deposit: z.number().nonnegative().default(0),
    comment: z.string().max(500).optional(),
  })
  .refine((v) => v.amount > 0 || v.use_deposit > 0, {
    message: "Сумма (amount или use_deposit) должна быть больше 0",
    path: ["amount"],
  });
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;
