-- =====================================================================
-- child_internal_notes — внутренние комментарии сотрудников о ребёнке
-- (болезни, особенности, договорённости). НЕ видны родителю/тренеру.
-- Раньше вкладка «Комментарии» в карточке ребёнка была заглушкой.
-- =====================================================================

create table child_internal_notes (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references organizations(id),
  child_id uuid not null references children(id) on delete cascade,
  author_id uuid references profiles(id),
  text text not null,
  created_at timestamptz not null default now()
);
create index child_internal_notes_child_idx on child_internal_notes(child_id, created_at desc);

comment on table child_internal_notes is
  'Внутренние заметки сотрудников о ребёнке (болезни, особенности). Только office-роли, не родитель/тренер.';

alter table child_internal_notes enable row level security;

-- Только office-роли (is_staff) в рамках своей организации.
create policy cin_staff_read on child_internal_notes for select
  using (is_staff() and organization_id = auth_org());

create policy cin_staff_insert on child_internal_notes for insert
  with check (is_staff() and organization_id = auth_org());

create policy cin_staff_delete on child_internal_notes for delete
  using (is_staff() and organization_id = auth_org());
