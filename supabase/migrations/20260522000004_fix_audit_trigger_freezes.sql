-- =====================================================================
-- Фикс audit_trigger_func: freezes не имеет organization_id, поэтому
-- триггер падал с "record new has no field organization_id" при любом
-- INSERT в freezes (т.е. весь flow заморозок был сломан).
--
-- Решение: обернуть чтение new.organization_id в exception-блок и
-- для child-scoped таблиц (freezes, attendance — оба имеют child_id
-- но не organization_id) брать org через children.
-- =====================================================================

create or replace function audit_trigger_func()
returns trigger as $$
declare
  actor uuid;
  org_id uuid;
  v_action text;
  v_child_id uuid;
begin
  -- Текущий actor (бэк ставит через set_config('app.actor_id', ...)).
  begin
    actor := nullif(current_setting('app.actor_id', true), '')::uuid;
  exception when others then
    actor := null;
  end;

  -- Получаем organization_id из строки. Если колонки нет (freezes,
  -- attendance) — fallback через child_id → children.organization_id.
  if (tg_op = 'DELETE') then
    begin
      org_id := (old.organization_id)::uuid;
    exception when others then
      begin v_child_id := (old.child_id)::uuid; exception when others then v_child_id := null; end;
      if v_child_id is not null then
        select organization_id into org_id from children where id = v_child_id;
      end if;
    end;
  else
    begin
      org_id := (new.organization_id)::uuid;
    exception when others then
      begin v_child_id := (new.child_id)::uuid; exception when others then v_child_id := null; end;
      if v_child_id is not null then
        select organization_id into org_id from children where id = v_child_id;
      end if;
    end;
  end if;

  if (tg_op = 'INSERT') then
    v_action := tg_table_name || '.insert';
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, after_data)
    values (org_id, actor, v_action, tg_table_name, (new.id)::uuid, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    v_action := tg_table_name || '.update';
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data, after_data)
    values (org_id, actor, v_action, tg_table_name, (new.id)::uuid, to_jsonb(old), to_jsonb(new));
    return new;
  elsif (tg_op = 'DELETE') then
    v_action := tg_table_name || '.delete';
    insert into audit_log (organization_id, actor_id, action, entity_type, entity_id, before_data)
    values (org_id, actor, v_action, tg_table_name, (old.id)::uuid, to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;
