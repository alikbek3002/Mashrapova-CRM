// Разбор очереди исходящих сообщений — ТЗ §9.
//
// Вынесено из маршрута, потому что вызывается из двух мест: планировщик
// гоняет разбор раз в час, а маршрут /v1/notifications/dispatch позволяет
// запустить вручную. Две копии этой логики разъехались бы.
import { supabaseAdmin } from "./supabase.js";
import { smsProvider } from "./sms.js";

export type DispatchResult = {
  provider: string;
  configured: boolean;
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

/** Больше — считаем сообщение безнадёжным, иначе очередь не двигается. */
const MAX_ATTEMPTS = 5;

export const dispatchOutbound = async (
  log?: { warn: (o: unknown, m: string) => void; info: (o: unknown, m: string) => void },
  organizationId?: string,
): Promise<DispatchResult> => {
  let q = supabaseAdmin
    .from("outbound_messages")
    .select("id, channel, to_phone, body, attempts")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(200);
  if (organizationId) q = q.eq("organization_id", organizationId);

  const { data: queued, error } = await q;
  if (error) {
    log?.warn({ err: error }, "outbound_queue_read_failed");
    return { provider: smsProvider.name, configured: smsProvider.configured, processed: 0, sent: 0, skipped: 0, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const m of queued ?? []) {
    // Push отправлять нечем: решение по приложению родителя в версии 1.0
    // не принято (ТЗ §15, открытый вопрос 3). Не копим такие сообщения
    // вечно — помечаем с причиной, чтобы очередь оставалась читаемой.
    if (m.channel === "push") {
      await supabaseAdmin
        .from("outbound_messages")
        .update({
          status: "skipped",
          last_error: "Push не настроен: приложение родителя в версии 1.0 не согласовано (ТЗ §15).",
        })
        .eq("id", m.id);
      skipped += 1;
      continue;
    }

    const res = await smsProvider.send(m.to_phone ?? "", m.body);
    if (res.ok) {
      await supabaseAdmin
        .from("outbound_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider: smsProvider.name,
          provider_message_id: res.providerMessageId,
          attempts: m.attempts + 1,
        })
        .eq("id", m.id);
      sent += 1;
      continue;
    }

    const done = res.permanent || m.attempts + 1 >= MAX_ATTEMPTS;
    // Пока провайдера нет, «не отправлено» — ожидаемое состояние, а не
    // авария: отличаем skipped от failed, иначе отчёт о рассылке будет
    // выглядеть как сплошной сбой.
    const status = done ? (smsProvider.configured ? "failed" : "skipped") : "queued";
    await supabaseAdmin
      .from("outbound_messages")
      .update({
        status,
        last_error: res.error,
        provider: smsProvider.name,
        attempts: m.attempts + 1,
      })
      .eq("id", m.id);
    if (status === "failed") failed += 1;
    else if (status === "skipped") skipped += 1;
  }

  const result: DispatchResult = {
    provider: smsProvider.name,
    configured: smsProvider.configured,
    processed: queued?.length ?? 0,
    sent, skipped, failed,
  };
  if (result.processed > 0) log?.info(result, "outbound_dispatch");
  return result;
};
