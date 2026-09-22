-- =====================================================================
-- Журнал группы: состав виден любому сотруднику целиком.
--
-- Manager-scoping (children_staff_select) режет менеджеру чужих детей —
-- и журнал чужой группы выглядел пустым: enrollments приходили, а
-- embedded children обнулялся RLS-ом. Для журнала это неправильно:
-- состав группы — общая рабочая картина, ребёнок должен быть виден
-- всегда, пока числится в группе (в т.ч. месяц после конца абонемента —
-- см. refresh_lifecycle в 20260802000002).
--
-- security definer RPC отдаёт активные записи группы + карты + менеджера
-- + остаток занятий одним запросом. Доступ: офис-роли и тренер группы.
-- Manager-scoping в остальных местах (список «Дети» и т.д.) не трогаем.
-- =====================================================================

create or replace function public.fn_group_tabel_roster(p_group_id uuid)
returns table (
  child_id uuid,
  full_name text,
  enroll_start date,
  enroll_end date,
  card_id uuid,
  card_start date,
  card_end date,
  card_status text,
  total_lessons int,
  remaining int,
  manager_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    is_staff()
    or exists (select 1 from groups g where g.id = p_group_id and g.coach_id = auth.uid())
  ) then
    raise exception 'forbidden';
  end if;

  return query
  select
    e.child_id,
    c.full_name,
    e.start_date,
    e.end_date,
    cc.id,
    cc.start_date,
    cc.end_date,
    cc.status::text,
    cc.total_lessons,
    b.remaining::int,
    m.full_name
  from enrollments e
  join groups g on g.id = e.group_id
  join children c on c.id = e.child_id and c.deleted_at is null
  left join club_cards cc
    on cc.child_id = e.child_id
   and cc.status in ('active', 'ending', 'frozen', 'expired', 'debt')
   and (cc.section_id is null or cc.section_id = g.section_id)
  left join v_child_card_balance b on b.club_card_id = cc.id
  left join profiles m on m.id = c.responsible_manager_id
  where e.group_id = p_group_id
    and e.archived_at is null;
end;
$$;

comment on function public.fn_group_tabel_roster(uuid) is
  'Состав группы для журнала: дети + карты + менеджер + остаток. Обходит manager-scoping — журнал показывает всю группу любому сотруднику.';

grant execute on function public.fn_group_tabel_roster(uuid) to authenticated;

notify pgrst, 'reload schema';
