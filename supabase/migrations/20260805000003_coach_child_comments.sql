-- =====================================================================
-- Комментарии к ребёнку: два потока в одной таблице child_internal_notes.
--
--   «От менеджера» (автор — офис-роль): видят только офис-роли.
--   «От тренера»   (автор — тренер):    видят офис-роли и САМ тренер
--                                        (чужие тренерские — нет).
--   Родитель не видит ничего (select-политики для parent нет).
--   Прогресс (progress_notes) не трогаем — его видит и родитель.
--
-- До этого тренер вообще не имел доступа к таблице (только is_staff).
-- =====================================================================

drop policy if exists cin_coach_insert on child_internal_notes;
create policy cin_coach_insert on child_internal_notes for insert
  with check (
    is_coach()
    and author_id = auth.uid()
    and organization_id = auth_org()
  );

drop policy if exists cin_coach_read_own on child_internal_notes;
create policy cin_coach_read_own on child_internal_notes for select
  using (is_coach() and author_id = auth.uid());

-- Тренер может удалить свой комментарий.
drop policy if exists cin_coach_delete_own on child_internal_notes;
create policy cin_coach_delete_own on child_internal_notes for delete
  using (is_coach() and author_id = auth.uid());

notify pgrst, 'reload schema';
