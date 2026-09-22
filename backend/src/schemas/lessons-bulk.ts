import { z } from "zod";

export const lessonsBulkGenerateSchema = z.object({
  group_id: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type LessonsBulkGenerateInput = z.infer<typeof lessonsBulkGenerateSchema>;
