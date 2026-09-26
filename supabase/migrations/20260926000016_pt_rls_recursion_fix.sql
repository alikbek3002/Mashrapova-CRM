-- =====================================================================
-- Бесконечная рекурсия в политиках персональных тренировок.
--
-- Симптом: любой вход в систему падал с
--   «infinite recursion detected in policy for relation "pt_sessions"»
-- и приложение показывало «Не удалось загрузить профиль».
--
-- Цикл
-- ----
-- Политики в 20260611000001 ссылаются друг на друга через таблицы:
--
--   pt_sessions_parent_select  читает pt_lessons
--   pt_lessons_coach_select    читает pt_sessions   ← замыкание
--
-- Postgres применяет ВСЕ политики SELECT (они объединяются по ИЛИ),
-- поэтому цикл возникает независимо от роли: даже директор, которого
-- пускает pt_sessions_staff_select, упирается в родительскую политику,
-- потому что планировщик обязан разобрать и её.
--
-- Почему это ударило по входу. Первое, что делает приложение после
-- авторизации, — читает свою строку из profiles. На profiles висит
-- политика profiles_parent_read_pt_coaches (родитель видит имя
-- ПТ-тренера своего ребёнка), а она джойнит pt_sessions и pt_lessons.
-- Один этот select затягивал в цикл, и вход был невозможен вообще.
--
-- Почему не поймали раньше
-- ------------------------
-- Стенд supabase/test подключается ролью с BYPASSRLS: политики там не
-- вычисляются ни разу, и все 95 миграций проходят чисто. Стенд проверяет
-- КОРРЕКТНОСТЬ SQL, а не поведение RLS — это записано в его README, и
-- вот ровно тот случай, ради которого оговорка там стоит.
--
-- Решение
-- -------
-- Приём в проекте уже есть: 20260430000007 разорвал такой же цикл
-- children ↔ enrollments ↔ groups функциями security definer. Внутри
-- такой функции RLS не применяется, поэтому цепочка обрывается.
-- Делаем то же самое для ПТ.
--
-- Права при этом не расширяются: функции возвращают ровно те строки,
-- что отбирали прежние подзапросы, и только для текущего пользователя
-- через auth.uid().
-- =====================================================================

-- ---------------------------------------------------------------------
-- Занятия ПТ, доступные родителю: сессии, где занимается его ребёнок
-- ---------------------------------------------------------------------
create or replace function parent_pt_session_ids() returns setof uuid
language sql stable security definer set search_path = public
as $parent_pt_sessions$
  select l.session_id
    from pt_lessons l
    join children c on c.id = l.child_id
    join families f on f.id = c.family_id
   where f.parent_user_id = auth.uid()
$parent_pt_sessions$;

comment on function parent_pt_session_ids() is
  'Сессии ПТ, где занимается ребёнок текущего родителя. security definer — разрывает цикл политик pt_sessions ↔ pt_lessons.';

-- ---------------------------------------------------------------------
-- Сессии текущего тренера, включая подмены
-- ---------------------------------------------------------------------
create or replace function coach_pt_session_ids() returns setof uuid
language sql stable security definer set search_path = public
as $coach_pt_sessions$
  select s.id
    from pt_sessions s
   where s.coach_id = auth.uid()
      or s.actual_coach_id = auth.uid()
$coach_pt_sessions$;

comment on function coach_pt_session_ids() is
  'Сессии ПТ текущего тренера, включая те, где он выходит на подмену (actual_coach_id).';

-- ---------------------------------------------------------------------
-- ПТ-тренеры, чьи имена вправе видеть текущий родитель
--
-- Прежняя политика на profiles собирала это двумя EXISTS прямо в
-- условии — и тянула в цикл каждый запрос к profiles, то есть вообще
-- каждый вход в систему.
-- ---------------------------------------------------------------------
create or replace function parent_pt_coach_ids() returns setof uuid
language sql stable security definer set search_path = public
as $parent_pt_coaches$
  -- Тренер по абонементу ПТ.
  select p.coach_id
    from pt_packages p
    join children c on c.id = p.child_id
    join families f on f.id = c.family_id
   where f.parent_user_id = auth.uid()
     and p.coach_id is not null
  union
  -- Тренер занятия и тот, кто выходил на подмену.
  select coach
    from pt_sessions s
    join pt_lessons l on l.session_id = s.id
    join children c on c.id = l.child_id
    join families f on f.id = c.family_id
   cross join lateral (values (s.coach_id), (s.actual_coach_id)) as v(coach)
   where f.parent_user_id = auth.uid()
     and coach is not null
$parent_pt_coaches$;

comment on function parent_pt_coach_ids() is
  'ПТ-тренеры ребёнка текущего родителя: по абонементу и по проведённым занятиям, включая подмены.';

-- ---------------------------------------------------------------------
-- Политики заново — та же выборка, но без обращения к таблице напрямую
-- ---------------------------------------------------------------------
drop policy if exists pt_sessions_parent_select on pt_sessions;
create policy pt_sessions_parent_select on pt_sessions for select
using (is_parent() and id in (select parent_pt_session_ids()));

drop policy if exists pt_lessons_coach_select on pt_lessons;
create policy pt_lessons_coach_select on pt_lessons for select
using (is_coach() and session_id in (select coach_pt_session_ids()));

drop policy if exists profiles_parent_read_pt_coaches on profiles;
create policy profiles_parent_read_pt_coaches on profiles for select
using (is_parent() and id in (select parent_pt_coach_ids()));

notify pgrst, 'reload schema';
