export interface Branch { id: string; name: string; code: string; }
export interface Employee { id: string; full_name: string; position: string; branch_id: string; employment_status: string; date_started: string | null; date_ended: string | null; is_protected?: boolean; }
export interface Section { id: string; branch_id: string; name: string; code: string; shifts: "day" | "night" | "both"; sort_order: number; is_active: boolean; }
export interface ExpenseCategory { id: string; name: string; flag_for_owner: boolean; sort_order: number; is_active: boolean; }
export interface Counterparty { id: string; name: string; mobile_number: string | null; can_send: boolean; can_receive: boolean; is_active: boolean; }
export interface ShortageReason { id: string; name: string; sort_order: number; }

export interface RevDay {
  id: string; branch_id: string; day_date: string; status: "open" | "submitted";
  opening_cash_override: number | null; opening_cash_override_note: string | null;
  lucky_balls_unverified: boolean; notes: string | null;
  submitted_by: string | null; submitted_at: string | null;
}

export interface ShiftEntry {
  id?: string; day_id: string; section_id: string; shift: "day" | "night";
  manager_employee_id: string | null;
  sport_tickets: number; sport_deposits: number; sport_payouts: number; sport_withdrawals: number;
  lb_in: number; lb_out: number; l6_in: number; l6_out: number;
  source_readings: any | null;
}

export interface Assignment { id?: string; shift_entry_id?: string; employee_id: string; counter_role: string; float_issued: number; }
export interface Expense { id: string; day_id: string; shift: string | null; category_id: string; description: string; amount: number; paid_to: string | null; }
export interface Transfer { id: string; day_id: string; direction: "sent" | "received"; amount: number; counterparty_id: string | null; counterparty_text: string | null; mobile_number: string | null; done_by_employee_id: string | null; done_at: string | null; note: string | null; }
export interface CashCount {
  id?: string; day_id: string; counted_at: string | null; counted_by_employee_id: string | null; witness_employee_id: string | null; counted_by_text?: string | null;
  d500: number; d200: number; d100: number; d50: number; d20: number; d10: number; d5: number; d2: number; d1: number; d050: number;
  other_amount: number; other_note: string | null; total?: number;
}
export interface Shortage { id: string; day_id: string; branch_id: string; employee_id: string | null; employee_text: string | null; shortage_date: string; amount: number; reason_id: string | null; note: string | null; shift_entry_id: string | null; resolution: string; repaid_amount: number; repaid_day_id: string | null; payroll_synced_at: string | null; }
export interface Advance { id: string; day_id: string; branch_id: string; employee_id: string; advance_date: string; amount: number; note: string | null; payroll_synced_at: string | null; }
export interface Fine { id: string; day_id: string; branch_id: string; employee_id: string; fine_date: string; amount: number; reason: string; payroll_synced_at: string | null; }
export interface Adjustment { id: string; day_id: string; amount: number; reason: string; note: string | null; approved_by: string | null; approved_at: string | null; created_by: string | null; }

export interface DaySummary {
  id: string; branch_id: string; day_date: string; status: string; notes: string | null; lucky_balls_unverified: boolean;
  submitted_by: string | null; submitted_at: string | null; opening_cash_override: number | null;
  opening_cash: number; opening_from_date: string | null;
  tickets: number; deposits: number; payouts: number; withdrawals: number; sports_net: number; sports_ggr: number;
  lb_in: number; lb_out: number; lb_balance: number; l6_in: number; l6_out: number; l6_balance: number;
  gross_stakes: number; total_payouts: number; cash_revenue: number; shift_count: number;
  expenses: number; expense_count: number; sent: number; received: number; shortages: number; repaid: number; advances: number; adjustments: number;
  net_after_costs: number; expected_closing: number; counted_closing: number | null; counted_at: string | null; variance: number | null; editable: boolean;
}

export interface WhoAmI { email: string; is_owner: boolean; read_only: boolean; branch_ids: string[]; variance_threshold: number; edit_window_days: number; }
