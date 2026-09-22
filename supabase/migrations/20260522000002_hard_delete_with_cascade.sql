-- =====================================================================
-- hard_delete_with_cascade(table, id)
--
-- Окончательное удаление архивной записи вместе со всеми её FK-зависимостями.
-- Доступно только директору (проверка auth.uid() + profiles.role в теле
-- функции, не полагаемся на RLS — потому что функция SECURITY DEFINER).
--
-- Зачем: в архиве админ нажимает «Удалить навсегда», но Postgres блокирует
-- DELETE из-за FK (payments, attendance, lessons, club_cards и т.д.).
-- Прежняя логика требовала вручную чистить каждую зависимость, что в
-- проде нереально. Эта функция сносит всё одной транзакцией в правильном
-- порядке (от листьев к корню).
--
-- ВАЖНО: операция необратима. Стирает финансовую и аудитную историю
-- по сущности. UI обязан показывать explicit confirm с counts'ами.
-- =====================================================================

create or replace function hard_delete_with_cascade(
  p_table text,
  p_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_deleted jsonb := '{}'::jsonb;
  v_count int;
  v_child_id uuid;
  v_group_id uuid;
begin
  -- 1. Auth-гейт. Удалять навсегда могут только директор и фитнес-директор.
  if v_caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select role into v_role from profiles where id = v_caller;
  if v_role not in ('director', 'fitness_director') then
    raise exception 'forbidden: hard delete requires director role' using errcode = '42501';
  end if;

  -- 2. Каскад по типу таблицы. Удаляем от листьев к корню — внутри
  --    одной транзакции (плpgsql сам её даёт).
  if p_table = 'children' then
    -- lesson_notes пишутся тренером по ребёнку.
    delete from lesson_notes where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lesson_notes', v_count);

    delete from attendance where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('attendance', v_count);

    delete from progress_notes where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('progress_notes', v_count);

    -- notifications.child_id хранится в payload jsonb, поля child_id у
    -- таблицы нет — пропускаем (уведомления безвредны и истекают по TTL).

    -- Внутренние заметки сотрудников о ребёнке.
    delete from child_internal_notes where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('child_internal_notes', v_count);

    delete from freezes where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('freezes', v_count);

    delete from deposit_transactions where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('deposit_transactions', v_count);

    delete from payments where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('payments', v_count);

    delete from enrollments where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('enrollments', v_count);

    delete from refunds where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('refunds', v_count);

    delete from club_cards where child_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('club_cards', v_count);

    delete from children where id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('child', v_count);

  elsif p_table = 'families' then
    -- Семья → все дети семьи (и рекурсивно их история).
    -- Снимок id'шников детей: внутри loop рекурсивный вызов удаляет
    -- запись, и без снимка cursor бы поймал stale-данные.
    for v_child_id in select id from children where family_id = p_id loop
      perform hard_delete_with_cascade('children', v_child_id);
    end loop;

    delete from families where id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('family', v_count);

  elsif p_table = 'groups' then
    -- Группа → coach_rates (ставки тренера за группу), расписание,
    -- посещения по урокам группы, сами уроки, enrollments. Карты на
    -- group не ссылаются (только на section_id) — их не трогаем.
    delete from coach_rates where group_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('coach_rates', v_count);

    delete from lesson_notes
      where lesson_id in (select id from lessons where group_id = p_id);
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lesson_notes', v_count);

    delete from attendance
      where lesson_id in (select id from lessons where group_id = p_id);
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('attendance', v_count);

    delete from lessons where group_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lessons', v_count);

    delete from enrollments where group_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('enrollments', v_count);

    delete from group_schedule where group_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('group_schedule', v_count);

    delete from groups where id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('group', v_count);

  elsif p_table = 'sections' then
    -- Секция → group(ы) (рекурсивно), section_coaches.
    for v_group_id in select id from groups where section_id = p_id loop
      perform hard_delete_with_cascade('groups', v_group_id);
    end loop;
    delete from section_coaches where section_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('section_coaches', v_count);

    -- Карты с section_id обнуляем (история продаж не теряется,
    -- ссылка на секцию очищается).
    update club_cards set section_id = null where section_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('club_cards_unlinked', v_count);

    -- Leads с интересом к этой секции — обнуляем ссылку (lead остаётся).
    update leads set section_interest_id = null where section_interest_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('leads_unlinked', v_count);

    delete from sections where id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('section', v_count);

  elsif p_table = 'profiles' then
    -- Тренер/менеджер.
    -- ВНИМАНИЕ: groups.coach_id и lessons.coach_id оба NOT NULL и оба
    -- ссылаются на этот профиль. Обнулить их нельзя — got not_null_violation
    -- (HTTP 400). Поэтому: каскадно сносим группы тренера целиком (вместе с
    -- их уроками/attendance/расписанием), а потом «висячие» уроки-замены
    -- (substitute), где он указан напрямую без группы.
    for v_group_id in select id from groups where coach_id = p_id loop
      perform hard_delete_with_cascade('groups', v_group_id);
    end loop;

    -- Уроки, где тренер указан без своей группы (substitute scenarios).
    delete from lesson_notes
      where lesson_id in (select id from lessons where coach_id = p_id);
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lesson_notes', v_count);

    delete from attendance
      where lesson_id in (select id from lessons where coach_id = p_id);
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('attendance', v_count);

    delete from lessons where coach_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lessons', v_count);

    -- substitute_coach_id — nullable, обнуляем.
    update lessons set substitute_coach_id = null where substitute_coach_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lessons_substitute_unlinked', v_count);

    -- progress_notes.coach_id — NOT NULL FK на coaches(id). Если оставим,
    -- триггерный cascade profiles→coaches упадёт о progress_notes.
    delete from progress_notes where coach_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('progress_notes', v_count);

    delete from coach_rates where coach_id = p_id or set_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('coach_rates', v_count);

    delete from payroll_periods where coach_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('payroll_periods', v_count);

    -- section_coaches — auto cascade через coaches→profiles, но и явно.
    delete from section_coaches where coach_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('section_coaches', v_count);

    -- responsible_manager_id у детей обнуляем (nullable).
    update children set responsible_manager_id = null where responsible_manager_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('children_unmanaged', v_count);

    -- leads.responsible_manager_id — set null.
    update leads set responsible_manager_id = null where responsible_manager_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('leads_unmanaged', v_count);

    -- audit_log.actor_id — set null (история действий сохраняется,
    -- ссылка на удалённый профиль очищается).
    update audit_log set actor_id = null where actor_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('audit_log_unlinked', v_count);

    -- Прочие nullable FK от profiles — обнуляем массово (история записей
    -- сохраняется, ссылка очищается).
    update lessons set created_by = null where created_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('lessons_created_by_unlinked', v_count);

    update attendance set marked_by = null where marked_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('attendance_marked_by_unlinked', v_count);

    update payments set received_by = null where received_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('payments_received_by_unlinked', v_count);

    update freezes set approved_by = null where approved_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('freezes_approved_by_unlinked', v_count);

    -- NOT NULL FK где обнуление невозможно — сносим записи. Это редкие
    -- случаи (тренер инициировал заморозку, получил уведомление,
    -- провёл возврат). Для архивного staff потеря допустима.
    delete from freezes where initiated_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('freezes_initiated', v_count);

    delete from notifications where recipient_id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('notifications', v_count);

    delete from refunds where processed_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('refunds_processed', v_count);

    -- deposit_transactions.received_by — NOT NULL. Если тренер когда-то
    -- принимал депозит (редко, но возможно у универсального staff),
    -- сносим транзакции.
    delete from deposit_transactions where received_by = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('deposit_tx_received', v_count);

    delete from profiles where id = p_id;
    get diagnostics v_count = row_count; v_deleted := v_deleted || jsonb_build_object('profile', v_count);

  else
    raise exception 'unsupported table: %', p_table using errcode = '22023';
  end if;

  return v_deleted;
end;
$$;

grant execute on function hard_delete_with_cascade(text, uuid) to authenticated;

-- =====================================================================
-- archive_dependents_count(table, id) — показывает, сколько строк
-- связано с записью. UI использует это в confirm-диалоге перед каскадом.
-- Без security definer: читать счётчики связи RLS не запрещает админам.
-- =====================================================================

create or replace function archive_dependents_count(
  p_table text,
  p_id uuid
) returns jsonb
language sql stable security definer
set search_path = public
as $$
  select case p_table
    when 'children' then jsonb_build_object(
      'club_cards',           (select count(*) from club_cards where child_id = p_id),
      'payments',             (select count(*) from payments where child_id = p_id),
      'deposit_transactions', (select count(*) from deposit_transactions where child_id = p_id),
      'attendance',           (select count(*) from attendance where child_id = p_id),
      'enrollments',          (select count(*) from enrollments where child_id = p_id),
      'freezes',              (select count(*) from freezes where child_id = p_id),
      'refunds',              (select count(*) from refunds where child_id = p_id),
      'lesson_notes',         (select count(*) from lesson_notes where child_id = p_id),
      'progress_notes',       (select count(*) from progress_notes where child_id = p_id),
      'child_internal_notes', (select count(*) from child_internal_notes where child_id = p_id)
    )
    when 'families' then jsonb_build_object(
      'children', (select count(*) from children where family_id = p_id)
    )
    when 'groups' then jsonb_build_object(
      'lessons',        (select count(*) from lessons where group_id = p_id),
      'enrollments',    (select count(*) from enrollments where group_id = p_id),
      'group_schedule', (select count(*) from group_schedule where group_id = p_id)
    )
    when 'sections' then jsonb_build_object(
      'groups',          (select count(*) from groups where section_id = p_id),
      'section_coaches', (select count(*) from section_coaches where section_id = p_id),
      'club_cards',      (select count(*) from club_cards where section_id = p_id)
    )
    when 'profiles' then jsonb_build_object(
      'groups_as_coach',   (select count(*) from groups where coach_id = p_id),
      'lessons_as_coach',  (select count(*) from lessons where coach_id = p_id),
      'section_coaches',   (select count(*) from section_coaches where coach_id = p_id),
      'children_as_mgr',   (select count(*) from children where responsible_manager_id = p_id)
    )
    else '{}'::jsonb
  end;
$$;

grant execute on function archive_dependents_count(text, uuid) to authenticated;
