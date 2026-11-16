-- BwanaBet Daily Revenue System
-- Migration 0001: schema, triggers, views, RLS, seed data
-- All tables are prefixed rev_ and live alongside the payroll tables.

-- ---------------------------------------------------------------
-- Helper functions (auth)
-- ---------------------------------------------------------------
create or replace function rev_current_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function rev_is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles
    where lower(email) = rev_current_email()
      and is_active
      and (is_owner or role = 'super_admin')
  );
$$;

create or replace function rev_my_branch_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when (is_owner or role = 'super_admin')
                 then (select array_agg(id) from branches)
                 else branch_ids end
       from user_roles
      where lower(email) = rev_current_email() and is_active
      limit 1),
    '{}'::uuid[]);
$$;

create or replace function rev_is_read_only() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select read_only from user_roles
                    where lower(email) = rev_current_email() and is_active limit 1), true);
$$;

-- ---------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------
create table if not exists rev_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);
insert into rev_settings (key, value) values
  ('variance_threshold', '50'),
  ('edit_window_days', '2')
on conflict (key) do nothing;

create or replace function rev_setting_num(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select value::numeric from rev_settings where key = p_key), 0);
$$;

-- ---------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------
create table if not exists rev_sections (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  name text not null,
  code text not null,
  shifts text not null default 'both' check (shifts in ('day','night','both')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  unique (branch_id, code)
);

create table if not exists rev_expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  flag_for_owner boolean not null default false,
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table if not exists rev_counterparties (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mobile_number text,
  can_send boolean not null default true,
  can_receive boolean not null default true,
  is_active boolean not null default true,
  unique (name, mobile_number)
);

create table if not exists rev_shortage_reasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table if not exists rev_edit_windows (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  start_date date not null,
  end_date date not null,
  reason text,
  created_by text,
  created_at timestamptz default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------
-- Daily tables
-- ---------------------------------------------------------------
create table if not exists rev_days (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  day_date date not null,
  status text not null default 'open' check (status in ('open','submitted')),
  opening_cash_override numeric(12,2),      -- owner only, used for the first day after migration
  opening_cash_override_note text,
  lucky_balls_unverified boolean not null default false,  -- set by the Excel import
  notes text,
  submitted_by text,
  submitted_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (branch_id, day_date)
);

create table if not exists rev_shift_entries (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  section_id uuid not null references rev_sections(id),
  shift text not null check (shift in ('day','night')),
  manager_employee_id uuid references employees(id),
  sport_tickets     numeric(12,2) not null default 0 check (sport_tickets >= 0),
  sport_deposits    numeric(12,2) not null default 0 check (sport_deposits >= 0),
  sport_payouts     numeric(12,2) not null default 0 check (sport_payouts >= 0),
  sport_withdrawals numeric(12,2) not null default 0 check (sport_withdrawals >= 0),
  lb_in  numeric(12,2) not null default 0 check (lb_in >= 0),
  lb_out numeric(12,2) not null default 0 check (lb_out >= 0),
  l6_in  numeric(12,2) not null default 0 check (l6_in >= 0),
  l6_out numeric(12,2) not null default 0 check (l6_out >= 0),
  source_readings jsonb,                     -- raw cumulative readings if that entry mode was used
  sports_net   numeric(12,2) generated always as (sport_tickets + sport_deposits - sport_payouts - sport_withdrawals) stored,
  sports_ggr   numeric(12,2) generated always as (sport_tickets - sport_payouts) stored,
  lb_balance   numeric(12,2) generated always as (lb_in - lb_out) stored,
  l6_balance   numeric(12,2) generated always as (l6_in - l6_out) stored,
  cash_revenue numeric(12,2) generated always as (sport_tickets + sport_deposits - sport_payouts - sport_withdrawals + lb_in - lb_out + l6_in - l6_out) stored,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (day_id, section_id, shift)
);

create table if not exists rev_cashier_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_entry_id uuid not null references rev_shift_entries(id) on delete cascade,
  employee_id uuid not null references employees(id),
  counter_role text not null check (counter_role in ('sports','lucky_balls','lucky6','waitress','other')),
  float_issued numeric(12,2) not null default 0 check (float_issued >= 0),
  created_at timestamptz default now(),
  unique (shift_entry_id, employee_id, counter_role)
);

create table if not exists rev_expenses (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  shift text check (shift in ('day','night')),
  category_id uuid not null references rev_expense_categories(id),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  paid_to text,
  entered_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rev_cash_transfers (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  direction text not null check (direction in ('sent','received')),
  amount numeric(12,2) not null check (amount > 0),
  counterparty_id uuid references rev_counterparties(id),
  counterparty_text text,                   -- free text only when imported from Excel
  mobile_number text,
  done_by_employee_id uuid references employees(id),
  done_at timestamptz,
  note text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rev_cash_counts (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  counted_at timestamptz,
  counted_by_employee_id uuid references employees(id),
  witness_employee_id uuid references employees(id),
  counted_by_text text,                     -- free text only when imported from Excel
  d500 int not null default 0 check (d500 >= 0),
  d200 int not null default 0 check (d200 >= 0),
  d100 int not null default 0 check (d100 >= 0),
  d50  int not null default 0 check (d50  >= 0),
  d20  int not null default 0 check (d20  >= 0),
  d10  int not null default 0 check (d10  >= 0),
  d5   int not null default 0 check (d5   >= 0),
  d2   int not null default 0 check (d2   >= 0),
  d1   int not null default 0 check (d1   >= 0),
  d050 int not null default 0 check (d050 >= 0),
  other_amount numeric(12,2) not null default 0,
  other_note text,
  total numeric(12,2) generated always as (
    500*d500 + 200*d200 + 100*d100 + 50*d50 + 20*d20 + 10*d10 + 5*d5 + 2*d2 + 1*d1 + 0.5*d050 + other_amount
  ) stored,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (day_id)
);

create table if not exists rev_shortages (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  branch_id uuid not null references branches(id),
  employee_id uuid references employees(id),
  employee_text text,                       -- free text only when imported and unmatched
  shortage_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  reason_id uuid references rev_shortage_reasons(id),
  note text,
  shift_entry_id uuid references rev_shift_entries(id) on delete set null,
  resolution text not null default 'payroll' check (resolution in ('payroll','cash_repaid','written_off')),
  repaid_amount numeric(12,2) not null default 0 check (repaid_amount >= 0),
  repaid_day_id uuid references rev_days(id) on delete set null,
  payroll_log_id uuid,
  payroll_synced_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rev_advances (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  branch_id uuid not null references branches(id),
  employee_id uuid not null references employees(id),
  advance_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  payroll_log_id uuid,
  payroll_synced_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rev_fines (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  branch_id uuid not null references branches(id),
  employee_id uuid not null references employees(id),
  fine_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  payroll_log_id uuid,
  payroll_synced_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists rev_adjustments (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references rev_days(id) on delete cascade,
  amount numeric(12,2) not null check (amount <> 0),   -- signed: positive raises expected cash
  reason text not null check (reason in ('test_tickets','count_correction','unexplained','import','other')),
  note text,
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz default now()
);

create table if not exists rev_audit_log (
  id bigserial primary key,
  table_name text not null,
  row_id uuid,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists rev_audit_log_row_idx on rev_audit_log (table_name, row_id);

-- ---------------------------------------------------------------
-- Triggers: updated_at and audit
-- ---------------------------------------------------------------
create or replace function rev_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function rev_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if tg_op = 'DELETE' then v_id := old.id; else v_id := new.id; end if;
  insert into rev_audit_log (table_name, row_id, action, old_row, new_row, changed_by)
  values (tg_table_name, v_id, tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          rev_current_email());
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['rev_days','rev_shift_entries','rev_expenses','rev_cash_transfers','rev_cash_counts','rev_shortages','rev_advances','rev_fines']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function rev_touch_updated_at()', t, t);
  end loop;
  foreach t in array array['rev_days','rev_shift_entries','rev_cashier_assignments','rev_expenses','rev_cash_transfers','rev_cash_counts','rev_shortages','rev_advances','rev_fines','rev_adjustments','rev_edit_windows','rev_sections','rev_expense_categories','rev_counterparties']
  loop
    execute format('drop trigger if exists %I_audit on %I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function rev_audit()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Edit rule: owner always; manager within edit_window_days of the day or inside an open window
-- ---------------------------------------------------------------
create or replace function rev_can_edit_day(p_branch_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = public as $$
  select rev_is_owner()
      or ( not rev_is_read_only()
           and p_branch_id = any(rev_my_branch_ids())
           and ( current_date <= p_day + (rev_setting_num('edit_window_days'))::int
                 or exists (select 1 from rev_edit_windows w
                             where w.branch_id = p_branch_id
                               and p_day between w.start_date and w.end_date) ) );
$$;

create or replace function rev_day_editable(p_day_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select rev_can_edit_day(d.branch_id, d.day_date) from rev_days d where d.id = p_day_id;
$$;

create or replace function rev_day_branch(p_day_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select branch_id from rev_days where id = p_day_id;
$$;

-- ---------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------
create or replace view rev_shift_summary with (security_invoker = true) as
select e.id as shift_entry_id, d.id as day_id, d.branch_id, d.day_date, s.id as section_id, s.name as section_name, s.sort_order as section_sort,
       e.shift, e.manager_employee_id,
       e.sport_tickets, e.sport_deposits, e.sport_payouts, e.sport_withdrawals,
       e.lb_in, e.lb_out, e.l6_in, e.l6_out,
       e.sports_net, e.sports_ggr, e.lb_balance, e.l6_balance, e.cash_revenue
from rev_shift_entries e
join rev_days d on d.id = e.day_id
join rev_sections s on s.id = e.section_id;

create or replace view rev_day_summary with (security_invoker = true) as
with sh as (
  select day_id,
         sum(sport_tickets) tickets, sum(sport_deposits) deposits, sum(sport_payouts) payouts, sum(sport_withdrawals) withdrawals,
         sum(lb_in) lb_in, sum(lb_out) lb_out, sum(l6_in) l6_in, sum(l6_out) l6_out,
         sum(cash_revenue) cash_revenue, count(*) shift_count
  from rev_shift_entries group by day_id),
ex as (select day_id, sum(amount) expenses, count(*) expense_count from rev_expenses group by day_id),
tr as (select day_id,
              sum(amount) filter (where direction='sent') sent,
              sum(amount) filter (where direction='received') received
       from rev_cash_transfers group by day_id),
so as (select day_id, sum(amount) shortages from rev_shortages group by day_id),
rp as (select repaid_day_id day_id, sum(repaid_amount) repaid from rev_shortages where repaid_day_id is not null group by repaid_day_id),
ad as (select day_id, sum(amount) advances from rev_advances group by day_id),
aj as (select day_id, sum(amount) adjustments from rev_adjustments where approved_at is not null group by day_id),
cc as (select day_id, total counted_closing, counted_at from rev_cash_counts),
base as (
  select d.*,
         coalesce(sh.tickets,0) tickets, coalesce(sh.deposits,0) deposits, coalesce(sh.payouts,0) payouts, coalesce(sh.withdrawals,0) withdrawals,
         coalesce(sh.lb_in,0) lb_in, coalesce(sh.lb_out,0) lb_out, coalesce(sh.l6_in,0) l6_in, coalesce(sh.l6_out,0) l6_out,
         coalesce(sh.cash_revenue,0) cash_revenue, coalesce(sh.shift_count,0) shift_count,
         coalesce(ex.expenses,0) expenses, coalesce(ex.expense_count,0) expense_count,
         coalesce(tr.sent,0) sent, coalesce(tr.received,0) received,
         coalesce(so.shortages,0) shortages, coalesce(rp.repaid,0) repaid,
         coalesce(ad.advances,0) advances, coalesce(aj.adjustments,0) adjustments,
         cc.counted_closing, cc.counted_at
  from rev_days d
  left join sh on sh.day_id = d.id
  left join ex on ex.day_id = d.id
  left join tr on tr.day_id = d.id
  left join so on so.day_id = d.id
  left join rp on rp.day_id = d.id
  left join ad on ad.day_id = d.id
  left join aj on aj.day_id = d.id
  left join cc on cc.day_id = d.id
)
select b.id, b.branch_id, b.day_date, b.status, b.notes, b.lucky_balls_unverified, b.submitted_by, b.submitted_at,
       b.opening_cash_override,
       coalesce(b.opening_cash_override, prev.counted_closing, 0) as opening_cash,
       prev.day_date as opening_from_date,
       b.tickets, b.deposits, b.payouts, b.withdrawals,
       b.tickets + b.deposits - b.payouts - b.withdrawals as sports_net,
       b.tickets - b.payouts as sports_ggr,
       b.lb_in, b.lb_out, b.lb_in - b.lb_out as lb_balance,
       b.l6_in, b.l6_out, b.l6_in - b.l6_out as l6_balance,
       b.tickets + b.lb_in + b.l6_in as gross_stakes,
       b.payouts + b.lb_out + b.l6_out as total_payouts,
       b.cash_revenue, b.shift_count,
       b.expenses, b.expense_count, b.sent, b.received, b.shortages, b.repaid, b.advances, b.adjustments,
       b.cash_revenue - b.expenses as net_after_costs,
       coalesce(b.opening_cash_override, prev.counted_closing, 0)
         + b.cash_revenue - b.expenses - b.sent + b.received - b.shortages + b.repaid - b.advances + b.adjustments as expected_closing,
       b.counted_closing, b.counted_at,
       case when b.counted_closing is null then null
            else b.counted_closing - (coalesce(b.opening_cash_override, prev.counted_closing, 0)
                 + b.cash_revenue - b.expenses - b.sent + b.received - b.shortages + b.repaid - b.advances + b.adjustments) end as variance,
       rev_can_edit_day(b.branch_id, b.day_date) as editable
from base b
left join lateral (
  select c.total as counted_closing, p.day_date
  from rev_days p join rev_cash_counts c on c.day_id = p.id
  where p.branch_id = b.branch_id and p.day_date < b.day_date
  order by p.day_date desc limit 1
) prev on true;

-- ---------------------------------------------------------------
-- Payroll sync: upsert into daily_logs by (employee_id, log_date)
-- ---------------------------------------------------------------
create or replace function rev_sync_to_payroll(p_branch_id uuid, p_from date, p_to date)
returns table (kind text, employee_id uuid, log_date date, amount numeric, outcome text)
language plpgsql security definer set search_path = public as $$
declare r record; v_log uuid; v_existing boolean;
begin
  if not rev_is_owner() and not (p_branch_id = any(rev_my_branch_ids())) then
    raise exception 'not allowed';
  end if;

  for r in
    select 'shortage' kind, s.id, s.employee_id, s.shortage_date d, s.amount from rev_shortages s
     where s.branch_id = p_branch_id and s.shortage_date between p_from and p_to and s.employee_id is not null and s.resolution = 'payroll'
    union all
    select 'advance', a.id, a.employee_id, a.advance_date, a.amount from rev_advances a
     where a.branch_id = p_branch_id and a.advance_date between p_from and p_to
    union all
    select 'fine', f.id, f.employee_id, f.fine_date, f.amount from rev_fines f
     where f.branch_id = p_branch_id and f.fine_date between p_from and p_to
  loop
    select dl.id into v_log from daily_logs dl where dl.employee_id = r.employee_id and dl.log_date = r.d;
    v_existing := v_log is not null;
    if not v_existing then
      insert into daily_logs (employee_id, branch_id, log_date, attendance_status, logged_by, comments)
      values (r.employee_id, p_branch_id, r.d, 'present', 'Revenue System', 'Created by revenue sync')
      returning id into v_log;
    end if;

    -- amounts per kind are the SUM of revenue rows for that employee and day, so re-running is idempotent
    if r.kind = 'shortage' then
      update daily_logs set shortage_amount = (select coalesce(sum(amount),0) from rev_shortages
            where employee_id = r.employee_id and shortage_date = r.d and resolution = 'payroll'),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where id = v_log;
      update rev_shortages set payroll_log_id = v_log, payroll_synced_at = now() where id = r.id;
    elsif r.kind = 'advance' then
      update daily_logs set advance_amount = (select coalesce(sum(amount),0) from rev_advances
            where employee_id = r.employee_id and advance_date = r.d),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where id = v_log;
      update rev_advances set payroll_log_id = v_log, payroll_synced_at = now() where id = r.id;
    else
      update daily_logs set fine_amount = (select coalesce(sum(amount),0) from rev_fines
            where employee_id = r.employee_id and fine_date = r.d),
          last_modified_by = 'Revenue System', last_modified_at = now()
       where id = v_log;
      update rev_fines set payroll_log_id = v_log, payroll_synced_at = now() where id = r.id;
    end if;

    kind := r.kind; employee_id := r.employee_id; log_date := r.d; amount := r.amount;
    outcome := case when v_existing then 'updated' else 'inserted' end;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['rev_settings','rev_sections','rev_expense_categories','rev_counterparties','rev_shortage_reasons','rev_edit_windows',
                           'rev_days','rev_shift_entries','rev_cashier_assignments','rev_expenses','rev_cash_transfers','rev_cash_counts',
                           'rev_shortages','rev_advances','rev_fines','rev_adjustments','rev_audit_log']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- reference tables: everyone signed in reads, owner writes
drop policy if exists ref_read on rev_settings;            create policy ref_read  on rev_settings            for select to authenticated using (true);
drop policy if exists ref_write on rev_settings;           create policy ref_write on rev_settings            for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists ref_read on rev_expense_categories;  create policy ref_read  on rev_expense_categories  for select to authenticated using (true);
drop policy if exists ref_write on rev_expense_categories; create policy ref_write on rev_expense_categories  for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists ref_read on rev_counterparties;      create policy ref_read  on rev_counterparties      for select to authenticated using (true);
drop policy if exists ref_write on rev_counterparties;     create policy ref_write on rev_counterparties      for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists ref_read on rev_shortage_reasons;    create policy ref_read  on rev_shortage_reasons    for select to authenticated using (true);
drop policy if exists ref_write on rev_shortage_reasons;   create policy ref_write on rev_shortage_reasons    for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists sec_read on rev_sections;            create policy sec_read  on rev_sections            for select to authenticated using (branch_id = any(rev_my_branch_ids()));
drop policy if exists sec_write on rev_sections;           create policy sec_write on rev_sections            for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists win_read on rev_edit_windows;        create policy win_read  on rev_edit_windows        for select to authenticated using (branch_id = any(rev_my_branch_ids()));
drop policy if exists win_write on rev_edit_windows;       create policy win_write on rev_edit_windows        for all    to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists audit_read on rev_audit_log;         create policy audit_read on rev_audit_log          for select to authenticated using (rev_is_owner());

-- rev_days
drop policy if exists days_read on rev_days;   create policy days_read   on rev_days for select to authenticated using (branch_id = any(rev_my_branch_ids()));
drop policy if exists days_insert on rev_days; create policy days_insert on rev_days for insert to authenticated with check (rev_can_edit_day(branch_id, day_date));
drop policy if exists days_update on rev_days; create policy days_update on rev_days for update to authenticated using (rev_can_edit_day(branch_id, day_date)) with check (rev_can_edit_day(branch_id, day_date));
drop policy if exists days_delete on rev_days; create policy days_delete on rev_days for delete to authenticated using (rev_is_owner());

-- children keyed by day_id
do $$
declare t text;
begin
  foreach t in array array['rev_shift_entries','rev_expenses','rev_cash_transfers','rev_cash_counts','rev_shortages','rev_advances','rev_fines']
  loop
    execute format('drop policy if exists child_read on %I', t);
    execute format('create policy child_read on %I for select to authenticated using (rev_day_branch(day_id) = any(rev_my_branch_ids()))', t);
    execute format('drop policy if exists child_write on %I', t);
    execute format('create policy child_write on %I for all to authenticated using (rev_day_editable(day_id)) with check (rev_day_editable(day_id))', t);
  end loop;
end $$;

-- assignments keyed through shift entry
create or replace function rev_entry_day(p_entry_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select day_id from rev_shift_entries where id = p_entry_id;
$$;
drop policy if exists asg_read on rev_cashier_assignments;
create policy asg_read on rev_cashier_assignments for select to authenticated using (rev_day_branch(rev_entry_day(shift_entry_id)) = any(rev_my_branch_ids()));
drop policy if exists asg_write on rev_cashier_assignments;
create policy asg_write on rev_cashier_assignments for all to authenticated using (rev_day_editable(rev_entry_day(shift_entry_id))) with check (rev_day_editable(rev_entry_day(shift_entry_id)));

-- adjustments: managers can propose (insert, unapproved), owner approves/edits
drop policy if exists adj_read on rev_adjustments;   create policy adj_read   on rev_adjustments for select to authenticated using (rev_day_branch(day_id) = any(rev_my_branch_ids()));
drop policy if exists adj_insert on rev_adjustments; create policy adj_insert on rev_adjustments for insert to authenticated with check (rev_day_editable(day_id) and (rev_is_owner() or approved_at is null));
drop policy if exists adj_update on rev_adjustments; create policy adj_update on rev_adjustments for update to authenticated using (rev_is_owner()) with check (rev_is_owner());
drop policy if exists adj_delete on rev_adjustments; create policy adj_delete on rev_adjustments for delete to authenticated using (rev_is_owner() or (rev_day_editable(day_id) and approved_at is null));

-- ---------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------
insert into rev_sections (branch_id, name, code, shifts, sort_order)
select id, 'Main', 'MAIN', 'both', 1 from branches where code = 'MTENDERE'
on conflict (branch_id, code) do nothing;

insert into rev_expense_categories (name, flag_for_owner, sort_order) values
  ('Client refreshments', false, 1),
  ('Transport', false, 2),
  ('Utilities (ZESCO, water)', false, 3),
  ('Repairs and maintenance', false, 4),
  ('Supplies (till rolls, cleaning)', false, 5),
  ('Security contractor', true, 6),
  ('Promoter wages', true, 7),
  ('Head office payment', true, 8),
  ('Client refund', false, 9),
  ('Bank / mobile money charges', false, 10),
  ('Equipment purchase', true, 11),
  ('Other', false, 99)
on conflict (name) do nothing;

insert into rev_counterparties (name, mobile_number, can_send, can_receive) values
  ('Charles Eastwood', '0963065588', true, true),
  ('Bright Mwila', '0965939235', true, true)
on conflict do nothing;

insert into rev_shortage_reasons (name, sort_order) values
  ('Counterfeit note', 1), ('Cash count error', 2), ('Wrong payout', 3), ('Unknown', 4), ('Other', 5)
on conflict (name) do nothing;
