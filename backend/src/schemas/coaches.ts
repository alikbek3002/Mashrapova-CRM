import { z } from "zod";

// email опционален: если не указан — backend сконструирует pseudo-email из phone.
// phone теперь обязателен (для логина по телефону).
export const coachCreateSchema = z.object({
  email: z.string().email().nullable().optional(),
  password: z.string().min(8),
  full_name: z.string().min(2),
  phone: z.string().min(7),
  bio: z.string().nullable().optional(),
  achievements: z.string().nullable().optional(),
  experience_years: z.number().int().min(0).max(80).nullable().optional(),
});

export type CoachCreateInput = z.infer<typeof coachCreateSchema>;
