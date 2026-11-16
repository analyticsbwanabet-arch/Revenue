-- Mark an earlier shortage as repaid in cash on a given (editable) day
create or replace function rev_mark_repaid(p_shortage_id uuid, p_repaid_day_id uuid, p_amount numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare s rev_shortages%rowtype; d rev_days%rowtype;
begin
  select * into s from rev_shortages where id = p_shortage_id;
  select * into d from rev_days where id = p_repaid_day_id;
  if s.id is null or d.id is null then raise exception 'not found'; end if;
  if s.branch_id <> d.branch_id then raise exception 'branch mismatch'; end if;
  if not rev_can_edit_day(d.branch_id, d.day_date) then raise exception 'day is locked'; end if;
  update rev_shortages
     set resolution = 'cash_repaid', repaid_amount = coalesce(p_amount, amount), repaid_day_id = p_repaid_day_id
   where id = p_shortage_id;
end $$;

create or replace function rev_unmark_repaid(p_shortage_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s rev_shortages%rowtype; d rev_days%rowtype;
begin
  select * into s from rev_shortages where id = p_shortage_id;
  if s.id is null or s.repaid_day_id is null then return; end if;
  select * into d from rev_days where id = s.repaid_day_id;
  if not rev_can_edit_day(d.branch_id, d.day_date) then raise exception 'day is locked'; end if;
  update rev_shortages set resolution = 'payroll', repaid_amount = 0, repaid_day_id = null where id = p_shortage_id;
end $$;

-- Expose the caller's own permissions to the UI
create or replace function rev_whoami()
returns table (email text, is_owner boolean, read_only boolean, branch_ids uuid[], variance_threshold numeric, edit_window_days int)
language sql stable security definer set search_path = public as $$
  select rev_current_email(), rev_is_owner(), rev_is_read_only(), rev_my_branch_ids(),
         rev_setting_num('variance_threshold'), rev_setting_num('edit_window_days')::int;
$$;

-- Lock window: 1 = today and yesterday editable by managers (same as payroll)
update rev_settings set value = '1' where key = 'edit_window_days';
