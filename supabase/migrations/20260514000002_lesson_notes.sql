-- =====================================================================
-- Lesson notes — заметка тренера к конкретному занятию + ребёнку.
-- Текст обязателен, до 3 фото в storage bucket lesson-notes.
-- Триггер генерирует notification родителю при insert.
-- =====================================================================

create table if not exists lesson_notes (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  lesson_id uuid not null references lessons(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  coach_id uuid not null references profiles(id),
  text text not null check (length(trim(text)) > 0),
  photo_paths text[] not null default '{}'::text[]
    check (array_length(photo_paths, 1) is null or array_length(photo_paths, 1) <= 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, child_id)
);

create index if not exists lesson_notes_child_idx
  on lesson_notes(child_id, created_at desc);
create index if not exists lesson_notes_coach_idx
  on lesson_notes(coach_id, created_at desc);
create index if not exists lesson_notes_lesson_idx
  on lesson_notes(lesson_id);

alter table lesson_notes enable row level security;

-- Coach r/w своих заметок
drop policy if exists lesson_notes_coach_rw on lesson_notes;
create policy lesson_notes_coach_rw on lesson_notes
  for all
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

-- Staff read all in org
drop policy if exists lesson_notes_staff_read on lesson_notes;
create policy lesson_notes_staff_read on lesson_notes
  for select
  using (is_staff() and organization_id = auth_org());

-- Parent read только заметки своих детей
drop policy if exists lesson_notes_parent_read on lesson_notes;
create policy lesson_notes_parent_read on lesson_notes
  for select
  using (
    is_parent()
    and exists (
      select 1 from children c
      join families f on f.id = c.family_id
      where c.id = lesson_notes.child_id
        and f.parent_user_id = auth.uid()
    )
  );

-- Триггер: при insert/update заметки создаём notification всем родителям
-- из семьи ребёнка. У одного ребёнка одна семья и обычно один parent_user_id,
-- но цикл универсален.
create or replace function notify_parents_on_lesson_note()
returns trigger
language plpgsql
security definer
as $$
declare
  r record;
begin
  for r in
    select f.parent_user_id as pid
    from children c
    join families f on f.id = c.family_id
    where c.id = new.child_id
      and f.parent_user_id is not null
  loop
    insert into notifications (recipient_id, type, payload)
    values (
      r.pid,
      'lesson_note',
      jsonb_build_object(
        'lesson_note_id', new.id,
        'child_id', new.child_id,
        'lesson_id', new.lesson_id,
        'coach_id', new.coach_id
      )
    );
  end loop;
  return new;
end
$$;

drop trigger if exists trg_lesson_note_notify on lesson_notes;
create trigger trg_lesson_note_notify
  after insert on lesson_notes
  for each row execute function notify_parents_on_lesson_note();

-- Touch updated_at on edit
create or replace function lesson_notes_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_lesson_notes_touch on lesson_notes;
create trigger trg_lesson_notes_touch
  before update on lesson_notes
  for each row execute function lesson_notes_touch_updated_at();
