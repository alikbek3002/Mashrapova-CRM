-- =====================================================================
-- Storage bucket для фото заметок тренера.
-- Путь: {organization_id}/{lesson_id}/{child_id}/{uuid}.{ext}
-- Приватный, 5MB, изображения.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lesson-notes',
  'lesson-notes',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Staff full access (загрузка/чтение через сервис-роль и офис-ролей)
drop policy if exists "lesson-notes: staff full access" on storage.objects;
create policy "lesson-notes: staff full access"
on storage.objects for all
using (bucket_id = 'lesson-notes' and is_staff())
with check (bucket_id = 'lesson-notes' and is_staff());

-- Coach: upload и read к своим заметкам (по lesson_id в пути)
drop policy if exists "lesson-notes: coach write" on storage.objects;
create policy "lesson-notes: coach write"
on storage.objects for insert
with check (
  bucket_id = 'lesson-notes' and is_coach()
);

drop policy if exists "lesson-notes: coach read" on storage.objects;
create policy "lesson-notes: coach read"
on storage.objects for select
using (
  bucket_id = 'lesson-notes' and is_coach()
);

-- Parent read: только фото заметок своих детей (lesson_id+child_id в пути)
drop policy if exists "lesson-notes: parent read" on storage.objects;
create policy "lesson-notes: parent read"
on storage.objects for select
using (
  bucket_id = 'lesson-notes'
  and is_parent()
  and exists (
    select 1 from lesson_notes ln
    join children c on c.id = ln.child_id
    join families f on f.id = c.family_id
    where (storage.foldername(storage.objects.name))[2] = ln.lesson_id::text
      and (storage.foldername(storage.objects.name))[3] = ln.child_id::text
      and f.parent_user_id = auth.uid()
  )
);
