-- =====================================================================
-- Смена ставки тренера группы — тоже событие истории группы.
-- Дополняет fn_ge_on_group_update (20260804000005).
-- =====================================================================

create or replace function fn_ge_on_group_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.coach_id is distinct from old.coach_id then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id, 'coach_changed', jsonb_build_object(
      'old_coach_id', old.coach_id,
      'old_coach_name', fn_ge_profile_name(old.coach_id),
      'new_coach_id', new.coach_id,
      'new_coach_name', fn_ge_profile_name(new.coach_id)
    ), fn_ge_actor());
  end if;
  if new.name is distinct from old.name then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id, 'renamed',
      jsonb_build_object('old_name', old.name, 'new_name', new.name), fn_ge_actor());
  end if;
  if new.is_active is distinct from old.is_active then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id,
      case when new.is_active then 'activated' else 'deactivated' end,
      '{}'::jsonb, fn_ge_actor());
  end if;
  if new.coach_rate_per_child is distinct from old.coach_rate_per_child then
    insert into group_events (organization_id, group_id, type, payload, actor_id)
    values (new.organization_id, new.id, 'rate_changed', jsonb_build_object(
      'old_rate', old.coach_rate_per_child,
      'new_rate', new.coach_rate_per_child
    ), fn_ge_actor());
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
