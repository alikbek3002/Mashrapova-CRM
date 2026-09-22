-- =====================================================================
-- Storage buckets — private only
-- =====================================================================

-- Photos of children and coaches — PRIVATE bucket; serve via signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  false, -- private
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- RLS for storage.objects on this bucket
-- Staff can upload/read/delete; coach can read photos of own kids;
-- parent can read photos of own kids. No public access.

create policy "profile-photos: staff full access"
on storage.objects for all
using (
  bucket_id = 'profile-photos' and is_staff()
)
with check (
  bucket_id = 'profile-photos' and is_staff()
);

create policy "profile-photos: coach reads own kids"
on storage.objects for select
using (
  bucket_id = 'profile-photos'
  and is_coach()
  and exists (
    select 1 from children c
    join enrollments e on e.child_id = c.id
    join groups g on g.id = e.group_id
    where g.coach_id = auth.uid()
      and (storage.objects.name like 'children/' || c.id::text || '/%'
           or storage.objects.name like 'coaches/' || auth.uid()::text || '/%')
  )
);

create policy "profile-photos: parent reads own family"
on storage.objects for select
using (
  bucket_id = 'profile-photos'
  and is_parent()
  and exists (
    select 1 from children c
    join families f on f.id = c.family_id
    where f.parent_user_id = auth.uid()
      and storage.objects.name like 'children/' || c.id::text || '/%'
  )
);
