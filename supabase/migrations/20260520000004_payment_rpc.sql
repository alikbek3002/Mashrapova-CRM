-- =====================================================================
-- record_payment_with_deposit — атомарная запись разового платежа
-- с опциональным списанием с депозита.
--
-- Используется AcceptPaymentModal: если родитель оплачивает разовое
-- занятие или штраф, часть может пойти с депозита, часть нал/терминалом.
-- =====================================================================

create or replace function record_payment_with_deposit(
  p_organization_id uuid,
  p_child_id uuid,
  p_received_by uuid,
  p_club_card_id uuid,
  p_amount numeric,
  p_method payment_method,
  p_use_deposit numeric,
  p_comment text,
  p_idempotency_key uuid
) returns table (
  payment_id uuid,
  deposit_tx_id uuid,
  balance_after numeric
)
language plpgsql security definer
as $rec_pay$
declare
  v_pay_id uuid;
  v_tx_id uuid;
  v_balance numeric;
begin
  if p_use_deposit > 0 then
    insert into deposit_transactions (
      organization_id, child_id, amount, type,
      received_by, comment, idempotency_key
    ) values (
      p_organization_id, p_child_id, -p_use_deposit, 'service_charge',
      p_received_by, p_comment, p_idempotency_key
    ) returning id, deposit_transactions.balance_after into v_tx_id, v_balance;
  end if;

  if p_amount > 0 then
    insert into payments (
      organization_id, child_id, club_card_id, amount, method,
      received_by, comment, idempotency_key
    ) values (
      p_organization_id, p_child_id, p_club_card_id, p_amount, p_method,
      p_received_by, p_comment, p_idempotency_key
    ) returning id into v_pay_id;
  end if;

  payment_id := v_pay_id;
  deposit_tx_id := v_tx_id;
  balance_after := v_balance;
  return next;
end;
$rec_pay$;

-- =====================================================================
-- create_refund_with_deposit — атомарное оформление возврата:
--   1) создаёт запись в refunds
--   2) пишет компенсирующий payment (-amount) для чистоты отчётов
--   3) ЗАЧИСЛЯЕТ refund_amount обратно на депозит ребёнка
--   4) архивирует исходную карту
-- =====================================================================

create or replace function create_refund_with_deposit(
  p_organization_id uuid,
  p_club_card_id uuid,
  p_child_id uuid,
  p_kind refund_kind,
  p_remaining_lessons int,
  p_total_lessons int,
  p_card_price numeric,
  p_refund_amount numeric,
  p_fee_amount numeric,
  p_reason text,
  p_processed_by uuid,
  p_payment_method payment_method,
  p_idempotency_key uuid
) returns table (
  refund_id uuid,
  deposit_tx_id uuid,
  balance_after numeric
)
language plpgsql security definer
as $rec_refund$
declare
  v_refund_id uuid;
  v_tx_id uuid;
  v_balance numeric;
begin
  insert into refunds (
    organization_id, club_card_id, child_id, kind,
    remaining_lessons, total_lessons, card_price,
    refund_amount, fee_amount, reason, processed_by
  ) values (
    p_organization_id, p_club_card_id, p_child_id, p_kind,
    p_remaining_lessons, p_total_lessons, p_card_price,
    p_refund_amount, p_fee_amount, p_reason, p_processed_by
  ) returning id into v_refund_id;

  if p_refund_amount > 0 then
    insert into payments (
      organization_id, child_id, club_card_id, amount, method,
      received_by, comment
    ) values (
      p_organization_id, p_child_id, p_club_card_id, -p_refund_amount, p_payment_method,
      p_processed_by, 'Возврат->депозит: ' || p_reason
    );

    insert into deposit_transactions (
      organization_id, child_id, amount, type,
      related_card_id, related_refund_id, received_by, comment, idempotency_key
    ) values (
      p_organization_id, p_child_id, p_refund_amount, 'refund_in',
      p_club_card_id, v_refund_id, p_processed_by,
      'Возврат после отмены абонемента', p_idempotency_key
    ) returning id, deposit_transactions.balance_after into v_tx_id, v_balance;
  end if;

  update club_cards set status = 'archived' where id = p_club_card_id;

  refund_id := v_refund_id;
  deposit_tx_id := v_tx_id;
  balance_after := v_balance;
  return next;
end;
$rec_refund$;
