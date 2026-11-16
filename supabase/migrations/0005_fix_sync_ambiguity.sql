-- Fix ambiguous column references in rev_sync_to_payroll (applied 2026-11-16 as revenue_0005_fix_sync_ambiguity)
create or replace function rev_sync_to_payroll(p_branch_id uuid, p_from date, p_to date)
returns table (kind text, employee_id uuid, log_date date, amount numeric, outcome text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; v_log uuid; v_existing boolean;
begin
  if not rev_is_owner() and not (p_branch_id = any(rev_my_branch_ids())) then
    raise exception 'not allowed';
  end if;
  for r in
    select 'shortage' kind, s.id, s.employee_id emp, s.shortage_date d, s.amount amt from rev_shortages s
     where s.branch_id = p_branch_id and s.shortage_date between p_from and p_to and s.employee_id is not null and s.resolution = 'payroll'
    union all
    select 'advance', a.id, a.employee_id, a.advance_date, a.amount from rev_advances a
     where a.branch_id = p_branch_id and a.advance_date between p_from and p_to
    union all
    select 'fine', f.id, f.employee_id, f.fine_date, f.amount from rev_fines f
     where f.branch_id = p_branch_id and f.fine_date between p_from and p_to
  loop
    select dl.id into v_log from daily_logs dl where dl.employee_id = r.emp and dl.log_date = r.d;
    v_existing := v_log is not null;
    if not v_existing then
      insert into daily_logs (employee_id, branch_id, log_date, attendance_status, logged_by, comments)
      values (r.emp, p_branch_id, r.d, 'present', 'Revenue System', 'Created by revenue sync')
      returning id into v_log;
    end if;
    if r.kind = 'shortage' then
      update daily_logs dl set shortage_amount = (select coalesce(sum(x.amount),0) from rev_shortages x
            where x.employee_id = r.emp and x.shortage_date = r.d and x.resolution = 'payroll'),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where dl.id = v_log;
      update rev_shortages x set payroll_log_id = v_log, payroll_synced_at = now() where x.id = r.id;
    elsif r.kind = 'advance' then
      update daily_logs dl set advance_amount = (select coalesce(sum(x.amount),0) from rev_advances x
            where x.employee_id = r.emp and x.advance_date = r.d),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where dl.id = v_log;
      update rev_advances x set payroll_log_id = v_log, payroll_synced_at = now() where x.id = r.id;
    else
      update daily_logs dl set fine_amount = (select coalesce(sum(x.amount),0) from rev_fines x
            where x.employee_id = r.emp and x.fine_date = r.d),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where dl.id = v_log;
      update rev_fines x set payroll_log_id = v_log, payroll_synced_at = now() where x.id = r.id;
    end if;
    kind := r.kind; employee_id := r.emp; log_date := r.d; amount := r.amt;
    outcome := case when v_existing then 'updated' else 'inserted' end;
    return next;
  end loop;
end $$;
