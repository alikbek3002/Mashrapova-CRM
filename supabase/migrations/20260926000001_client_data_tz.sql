-- =====================================================================
-- Данные клиента по ТЗ §3.2 и §2.2.
--
-- 1. Семья: тренер видит семьи своих учеников — ФИО и телефоны родителей
--    и комментарий к семье («комментарии видны менеджерам и тренерам»).
-- 2. Комментарии администратора к ребёнку «видны всем сотрудникам»:
--    тренер видит комментарии офиса о своих учениках. Комментарии других
--    тренеров по-прежнему видят только офис и автор.
-- 3. Удалять данные не может никто (§2.2): комментарии к ребёнку больше
--    не удаляются.
-- =====================================================================

-- Семьи учеников текущего тренера. security definer — чтобы не упираться
-- в RLS children/families внутри политики (и не ловить рекурсию).
create or replace function coach_family_ids() returns setof uuid
language sql stable security definer set search_path = public
as $$
  select c.family_id from children c
  where c.id in (select coach_child_ids())
$$;

drop policy if exists families_coach_select on families;
create policy families_coach_select on families for select
  using ((select is_coach()) and id in (select coach_family_ids()));

-- Автор комментария — тренер?
create or replace function profile_is_coach(p_id uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from profiles where id = p_id and role = 'coach')
$$;

drop policy if exists cin_coach_read_office on child_internal_notes;
create policy cin_coach_read_office on child_internal_notes for select
  using (
    (select is_coach())
    and child_id in (select coach_child_ids())
    and not profile_is_coach(author_id)
  );

-- Удаление комментариев запрещено.
drop policy if exists cin_staff_delete on child_internal_notes;
drop policy if exists cin_coach_delete_own on child_internal_notes;
drop trigger if exists forbid_delete on child_internal_notes;
create trigger forbid_delete before delete on child_internal_notes
  for each row execute function forbid_delete();

notify pgrst, 'reload schema';
