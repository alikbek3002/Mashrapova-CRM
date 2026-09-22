-- =====================================================================
-- fn_group_tabel_roster: журнал группы доступен и тренеру ЧУЖОЙ группы.
--
-- Прежний guard пускал офис-роли и только тренера самой группы. Если
-- тренер открывал журнал другой группы (замены, общий обзор в админке),
-- RPC кидал forbidden, а модалка показывала «В группе пока нет учеников».
-- Просмотр состава — read-only и не секрет внутри клуба: пускаем любого
-- активного сотрудника с ролью тренера. Родителям по-прежнему нельзя.
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
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.role = 'coach' and p.is_active
    )
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

notify pgrst, 'reload schema';
