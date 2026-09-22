-- Add contact fields to organizations + substitute coach to lessons
alter table organizations
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists whatsapp_number text;

alter table lessons
  add column if not exists substitute_coach_id uuid references profiles(id);
