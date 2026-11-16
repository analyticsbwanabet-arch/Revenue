create or replace function rev_imp_assign(p_entry uuid, p_branch uuid, p_name text, p_role text, p_float numeric, p_date date, p_shift text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := rev_match_employee(p_branch, p_name);
begin
  if v is null then
    insert into rev_audit_log (table_name, action, new_row, changed_by)
    values ('import_unmatched', 'INSERT', jsonb_build_object('date', p_date, 'shift', p_shift, 'name', p_name, 'role', p_role), 'excel-import');
  else
    insert into rev_cashier_assignments (shift_entry_id, employee_id, counter_role, float_issued) values (p_entry, v, p_role, coalesce(p_float,0)) on conflict do nothing;
  end if;
end $$;

create or replace function rev_imp_expense(p_day uuid, p_cat text, p_desc text, p_amt numeric)
returns void language sql security definer set search_path = public as $$
  insert into rev_expenses (day_id, category_id, description, amount, entered_by)
  values (p_day, (select id from rev_expense_categories where name = p_cat), p_desc, p_amt, 'excel-import');
$$;

create or replace function rev_imp_fine(p_day uuid, p_branch uuid, p_name text, p_date date, p_amt numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := rev_match_employee(p_branch, p_name);
begin
  if v is null then
    insert into rev_audit_log (table_name, action, new_row, changed_by)
    values ('import_unmatched', 'INSERT', jsonb_build_object('date', p_date, 'fine_for', p_name, 'amount', p_amt), 'excel-import');
  else
    insert into rev_fines (day_id, branch_id, employee_id, fine_date, amount, reason, created_by) values (p_day, p_branch, v, p_date, p_amt, p_reason, 'excel-import');
  end if;
end $$;
