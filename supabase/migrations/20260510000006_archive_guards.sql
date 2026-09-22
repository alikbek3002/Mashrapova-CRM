-- =====================================================================
-- Archive guards: refuse archiving an entity that still has active
-- dependants. Otherwise we end up with orphan groups (no coach, no
-- section) and broken RLS chains.
--
-- Triggers fire on UPDATE of deleted_at NULL → NOT NULL.
-- Hard delete is forbidden for everyone (per ТЗ); only soft archive.
-- =====================================================================

-- Coach (profiles.role='coach') cannot be archived if still owns active groups.
create or replace function fn_check_coach_archive() returns trigger
language plpgsql as $$
declare
  cnt int;
begin
  if new.deleted_at is not null and old.deleted_at is null and new.role = 'coach' then
    select count(*) into cnt from groups
     where coach_id = new.id and deleted_at is null;
    if cnt > 0 then
      raise exception 'У тренера % активных групп. Сначала переведите группы на другого тренера или архивируйте их.', cnt
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_coach_archive on profiles;
create trigger trg_check_coach_archive
  before update on profiles
  for each row execute function fn_check_coach_archive();

-- Section cannot be archived if still has active groups.
create or replace function fn_check_section_archive() returns trigger
language plpgsql as $$
declare
  cnt int;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    select count(*) into cnt from groups
     where section_id = new.id and deleted_at is null;
    if cnt > 0 then
      raise exception 'В секции % активных групп. Сначала архивируйте их.', cnt
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_section_archive on sections;
create trigger trg_check_section_archive
  before update on sections
  for each row execute function fn_check_section_archive();

-- Group cannot be archived if still has active enrollments.
create or replace function fn_check_group_archive() returns trigger
language plpgsql as $$
declare
  cnt int;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    select count(*) into cnt from enrollments
     where group_id = new.id and archived_at is null;
    if cnt > 0 then
      raise exception 'В группе % активных учеников. Сначала переведите их в другую группу.', cnt
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_group_archive on groups;
create trigger trg_check_group_archive
  before update on groups
  for each row execute function fn_check_group_archive();

-- Family cannot be archived if it still has non-archived children.
create or replace function fn_check_family_archive() returns trigger
language plpgsql as $$
declare
  cnt int;
begin
  if new.deleted_at is not null and old.deleted_at is null then
    select count(*) into cnt from children
     where family_id = new.id and deleted_at is null;
    if cnt > 0 then
      raise exception 'В семье % активных детей. Сначала архивируйте их.', cnt
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_check_family_archive on families;
create trigger trg_check_family_archive
  before update on families
  for each row execute function fn_check_family_archive();
