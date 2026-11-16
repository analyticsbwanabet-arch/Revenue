-- Name matching for Excel imports: exact token match, then 4-letter prefix token match, branch first then global (if unique)
create or replace function rev_norm_tokens(p text) returns text[]
language sql immutable as $$
  select array(select t from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(p,''), '[^a-zA-Z ]', ' ', 'g')), '\s+')) t where t <> '' and t not in ('mr','mrs','ms','miss') order by t);
$$;

create or replace function rev_match_employee(p_branch_id uuid, p_name text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare toks text[]; v uuid; cnt int;
begin
  toks := rev_norm_tokens(p_name);
  if array_length(toks,1) is null then return null; end if;
  select e.id into v from employees e where e.branch_id = p_branch_id and rev_norm_tokens(e.full_name) = toks limit 1;
  if v is not null then return v; end if;
  select e.id, count(*) over () into v, cnt from employees e
   where e.branch_id = p_branch_id
     and array_length(rev_norm_tokens(e.full_name),1) = array_length(toks,1)
     and (select array_agg(left(t,4) order by left(t,4)) from unnest(rev_norm_tokens(e.full_name)) t) = (select array_agg(left(t,4) order by left(t,4)) from unnest(toks) t)
   limit 1;
  if v is not null and cnt = 1 then return v; end if;
  select e.id, count(*) over () into v, cnt from employees e where rev_norm_tokens(e.full_name) = toks limit 1;
  if v is not null and cnt = 1 then return v; end if;
  return null;
end $$;

create or replace function dmy(d date) returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY'); $$;

-- Apply a "recovered" (cash paid back) amount from the workbook: mark the latest unrepaid shortage
-- of that employee as repaid on p_day_id; if none, record an import adjustment for the owner.
create or replace function rev_import_recovery(p_day_id uuid, p_branch_id uuid, p_employee_id uuid, p_employee_text text, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare s rev_shortages%rowtype; d rev_days%rowtype;
begin
  select * into d from rev_days where id = p_day_id;
  if p_employee_id is not null then
    select * into s from rev_shortages
     where branch_id = p_branch_id and employee_id = p_employee_id and resolution = 'payroll' and shortage_date <= d.day_date
     order by shortage_date desc limit 1;
  end if;
  if s.id is not null then
    update rev_shortages set resolution = 'cash_repaid', repaid_amount = p_amount, repaid_day_id = p_day_id,
           note = coalesce(note || ' | ', '') || 'repaid in cash (workbook col X)'
     where id = s.id;
    return 'repaid shortage of ' || dmy(s.shortage_date);
  else
    insert into rev_adjustments (day_id, amount, reason, note, created_by, approved_by, approved_at)
    values (p_day_id, p_amount, 'import', 'Workbook col X: ' || p_amount || ' recovered from ' || coalesce(p_employee_text,'?') || ' with no matching shortage', 'excel-import', 'excel-import', now());
    return 'no matching shortage, adjustment created';
  end if;
end $$;
