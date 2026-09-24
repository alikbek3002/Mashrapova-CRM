// SMS-провайдер — ТЗ §9.2 и §13.
//
// Договора с SMS.kg у Академии ещё нет (открытые вопросы 1–2), поэтому
// провайдер абстрактный. По умолчанию работает "noop": сообщения копятся
// в очереди и помечаются пропущенными с явной причиной, ничего наружу не
// уходит. Когда ключи появятся — SMS_PROVIDER=smskg и четыре переменные
// окружения; остальной код не меняется.
//
// Почему интерфейс, а не «потом вставим fetch»: без него точка отправки
// расползётся по обработчикам событий, и подключение провайдера станет
// переписыванием, а не настройкой.
import { env } from "./env.js";

export type SmsResult =
  | { ok: true; providerMessageId: string | null }
  /** Отправить нельзя и повтор не поможет: неверный номер, нет денег. */
  | { ok: false; permanent: true; error: string }
  /** Временная неудача: сеть, 5xx у провайдера. Повторим позже. */
  | { ok: false; permanent: false; error: string };

export interface SmsProvider {
  readonly name: string;
  /** Настроен ли провайдер: без ключей отправлять нечем. */
  readonly configured: boolean;
  send(to: string, body: string): Promise<SmsResult>;
}

// --------------------------------------------------------------------
// Заглушка: провайдера нет
// --------------------------------------------------------------------
const noopProvider: SmsProvider = {
  name: "noop",
  configured: false,
  async send(): Promise<SmsResult> {
    return {
      ok: false,
      permanent: true,
      error: "SMS-провайдер не подключён (SMS_PROVIDER=noop). Сообщение не отправлено.",
    };
  },
};

// --------------------------------------------------------------------
// SMS.kg
//
// Точный формат запроса зависит от договора: у провайдера есть варианты
// с GET-строкой и с JSON, а имя отправителя регистрируется отдельно.
// Здесь — общий HTTP-вызов по параметрам из окружения; при подключении
// сверить с документацией, которую выдаст провайдер, и поправить
// разбор ответа.
// --------------------------------------------------------------------
const smskgProvider: SmsProvider = {
  name: "smskg",
  configured: Boolean(env.SMS_API_URL && env.SMS_LOGIN && env.SMS_PASSWORD && env.SMS_SENDER),

  async send(to: string, body: string): Promise<SmsResult> {
    if (!this.configured) {
      return { ok: false, permanent: true, error: "SMS.kg выбран, но не заданы SMS_API_URL / SMS_LOGIN / SMS_PASSWORD / SMS_SENDER" };
    }
    // Номер приводим к виду без плюса и пробелов — так его ждёт
    // большинство кыргызских шлюзов.
    const phone = to.replace(/[^0-9]/g, "");
    if (phone.length < 9) {
      return { ok: false, permanent: true, error: `Некорректный номер: ${to}` };
    }

    try {
      const res = await fetch(env.SMS_API_URL!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " + Buffer.from(`${env.SMS_LOGIN}:${env.SMS_PASSWORD}`).toString("base64"),
        },
        body: JSON.stringify({ phone, text: body, sender: env.SMS_SENDER }),
        // Без таймаута зависший шлюз останавливает всю рассылку.
        signal: AbortSignal.timeout(15_000),
      });

      const text = await res.text();
      if (!res.ok) {
        // 4xx — наша вина (номер, баланс, подпись), повтор не поможет.
        return { ok: false, permanent: res.status >= 400 && res.status < 500, error: `${res.status}: ${text.slice(0, 300)}` };
      }

      // Идентификатор сообщения нужен для разбора жалоб «не пришло».
      let id: string | null = null;
      try {
        const json = JSON.parse(text) as Record<string, unknown>;
        id = String(json.id ?? json.message_id ?? json.smsId ?? "") || null;
      } catch {
        id = null;
      }
      return { ok: true, providerMessageId: id };
    } catch (e: unknown) {
      // Сеть или таймаут — временная неудача.
      return { ok: false, permanent: false, error: (e as Error).message };
    }
  },
};

export const smsProvider: SmsProvider =
  env.SMS_PROVIDER === "smskg" ? smskgProvider : noopProvider;
