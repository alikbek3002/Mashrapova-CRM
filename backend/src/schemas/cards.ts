import { z } from "zod";

export const cardSellSchema = z
  .object({
    child_id: z.string().uuid(),
    type: z.enum(["monthly", "quarterly", "nine_month", "personal", "single", "trial"]),
    total_lessons: z.number().int().nullable().optional(),
    // Тариф из каталога card_plans (null — цена/срок введены вручную).
    plan_id: z.string().uuid().nullable().optional(),
    // Снимок срока тарифа в днях; используется при продлении карты.
    duration_days: z.number().int().positive().nullable().optional(),
    freeze_quota: z.number().int().min(0).default(0),
    price: z.number().nonnegative(),
    // Обязательное поле: процент скидки (0..100). Менеджер всегда вводит явно.
    discount_pct: z.number().min(0).max(100),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    payment_method: z.enum(["cash", "terminal"]),
    // Секция, для которой продан абонемент (для отчётов и продления).
    section_id: z.string().uuid().nullable().optional(),
    // Опциональная группа: если задана, ребёнок сразу зачислится в неё.
    group_id: z.string().uuid().nullable().optional(),
    // Окно записи в группу (date-window enrollment): дата первой тренировки
    // и дата N-го занятия. null = открытое окно (без ограничения по датам).
    enrollment_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    enrollment_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    // Депозитная часть оплаты. По умолчанию 0 — обычная продажа налом/терминалом.
    deposit_amount: z.number().nonnegative().default(0),
    // Налично-терминальная часть.
    cash_amount: z.number().nonnegative(),
    // Ставка тренера за одно посещённое занятие этого ребёнка.
    // Default 100 сом (если фронт не передал явно).
    coach_rate_per_lesson: z.number().nonnegative().default(100),
  })
  .refine(
    (v) => {
      // Сумма оплаты (депозит + нал) не может превышать цену до скидки.
      // Точную сверку с итогом после скидки делает фронт (readonly-поле «Доплата»),
      // а авто-скидку 2-го ребёнка применяет RPC из org_settings — поэтому здесь
      // только sanity-граница, иначе refine падал бы на sibling-скидке.
      const sum = v.deposit_amount + v.cash_amount;
      return sum <= v.price + 1;
    },
    {
      message: "Сумма оплаты превышает цену абонемента",
      path: ["cash_amount"],
    }
  );

export type CardSellInput = z.infer<typeof cardSellSchema>;
