-- =====================================================================
-- Добавляем дополнительный FK с coach_id → profiles(id) для таблиц,
-- где coach_id исторически указывает на coaches(id).
--
-- Зачем: PostgREST не умеет автоматически проходить транзитивную связь
-- groups.coach_id → coaches.id → profiles.id, поэтому эмбед
-- `coach:profiles!coach_id(full_name)` падает с 400. После добавления
-- прямого FK на profiles(id) подсказка !coach_id однозначно разрешается.
--
-- Семантика не меняется: coaches.id REFERENCES profiles(id), поэтому
-- любой валидный coach_id для coaches(id) автоматически валиден и для
-- profiles(id). Старый FK на coaches(id) оставляем — он гарантирует,
-- что назначаемый профиль действительно представлен в таблице coaches.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'groups_coach_profiles_fkey'
  ) then
    alter table groups
      add constraint groups_coach_profiles_fkey
      foreign key (coach_id) references profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'lessons_coach_profiles_fkey'
  ) then
    alter table lessons
      add constraint lessons_coach_profiles_fkey
      foreign key (coach_id) references profiles(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'progress_notes_coach_profiles_fkey'
  ) then
    alter table progress_notes
      add constraint progress_notes_coach_profiles_fkey
      foreign key (coach_id) references profiles(id);
  end if;
end $$;

-- Обновляем кэш схемы PostgREST, чтобы новые отношения подхватились
-- без рестарта проекта Supabase.
notify pgrst, 'reload schema';
