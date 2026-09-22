-- Следующий свободный номер на проходной. Считаем в SQL: PostgREST
-- обрезает невыстроенные выборки на 1000 строк, а access_person_no — text,
-- так что max по числовому значению корректен только на стороне БД.
create or replace function next_access_person_no() returns text
language sql
as $$
  select (coalesce(max(access_person_no::bigint), 10001) + 1)::text
  from children
  where access_person_no ~ '^\d+$' and length(access_person_no) <= 6;
$$;
