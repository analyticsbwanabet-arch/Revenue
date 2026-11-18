"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth, supabase } from "@/lib/auth-context";
import { fmtK, fmtSigned, dmy, todayIso, addDays, weekday, r2, num, DENOMS, COUNTER_ROLES, fmtTime, fmtDateTime, toLocalInput, fromLocalInput } from "@/lib/helpers";
import EmployeeSelect from "@/components/EmployeeSelect";
import TimeSelect from "@/components/TimeSelect";
import type {
  Branch, Employee, Section, ExpenseCategory, Counterparty, ShortageReason, RevDay, ShiftEntry, Assignment,
  Expense, Transfer, CashCount, Shortage, Advance, Fine, Adjustment, DaySummary, WhoAmI,
} from "@/lib/types";

type Key = string; // `${section_id}|${shift}`
const key = (s: string, sh: string) => `${s}|${sh}`;
const MONEY = ["sport_tickets", "sport_deposits", "sport_payouts", "sport_withdrawals", "lb_in", "lb_out", "l6_in", "l6_out"] as const;
type MoneyField = (typeof MONEY)[number];
const FIELD_LABEL: Record<MoneyField, string> = {
  sport_tickets: "Ticket sales", sport_deposits: "Deposits", sport_payouts: "Payouts", sport_withdrawals: "Withdrawals",
  lb_in: "Lucky Balls IN", lb_out: "Lucky Balls OUT", l6_in: "Lucky 6 IN", l6_out: "Lucky 6 OUT",
};

const blankEntry = (day_id: string, section_id: string, shift: "day" | "night"): ShiftEntry => ({
  day_id, section_id, shift, manager_employee_id: null,
  sport_tickets: 0, sport_deposits: 0, sport_payouts: 0, sport_withdrawals: 0, lb_in: 0, lb_out: 0, l6_in: 0, l6_out: 0, source_readings: null,
});
const blankCount = (day_id: string): CashCount => ({
  day_id, counted_at: null, counted_by_employee_id: null, witness_employee_id: null,
  d500: 0, d200: 0, d100: 0, d50: 0, d20: 0, d10: 0, d5: 0, d2: 0, d1: 0, d050: 0, other_amount: 0, other_note: null,
});
const countTotal = (c: CashCount) => r2(DENOMS.reduce((a, d) => a + d.value * (Number((c as any)[d.key]) || 0), 0) + num(c.other_amount));
const entryCash = (e: ShiftEntry) => r2(num(e.sport_tickets) + num(e.sport_deposits) - num(e.sport_payouts) - num(e.sport_withdrawals) + num(e.lb_in) - num(e.lb_out) + num(e.l6_in) - num(e.l6_out));

export default function DailyEntry() {
  const { isOwner, isSuperAdmin, readOnly, allowedBranchIds, logName, email, loading: authLoading } = useAuth();
  const owner = isOwner || isSuperAdmin;
  const params = useSearchParams();

  const [who, setWho] = useState<WhoAmI | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [date, setDate] = useState(params.get("date") || todayIso());

  const [sections, setSections] = useState<Section[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [reasons, setReasons] = useState<ShortageReason[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [allNames, setAllNames] = useState<Record<string, string>>({});

  const [day, setDay] = useState<RevDay | null>(null);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [entries, setEntries] = useState<Record<Key, ShiftEntry>>({});
  const [assign, setAssign] = useState<Record<Key, Assignment[]>>({});
  const [readings, setReadings] = useState<Record<Key, Partial<Record<MoneyField, string>>>>({});
  const [readingsMode, setReadingsMode] = useState<Record<Key, boolean>>({});
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [outstanding, setOutstanding] = useState<Shortage[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [count, setCount] = useState<CashCount | null>(null);
  const [notes, setNotes] = useState("");
  const [override, setOverride] = useState<{ amount: string; note: string }>({ amount: "", note: "" });

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);

  // ---------- bootstrap ----------
  useEffect(() => {
    if (authLoading) return;
    (async () => {
      const [{ data: w }, { data: b }, { data: c }, { data: cp }, { data: rs }] = await Promise.all([
        supabase.rpc("rev_whoami").single(),
        supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
        supabase.from("rev_expense_categories").select("*").eq("is_active", true).order("sort_order"),
        supabase.from("rev_counterparties").select("*").eq("is_active", true).order("name"),
        supabase.from("rev_shortage_reasons").select("*").eq("is_active", true).order("sort_order"),
      ]);
      const me = w as WhoAmI | null;
      setWho(me);
      const allowed = (b || []).filter((x: Branch) => me?.is_owner || (me?.branch_ids || []).includes(x.id));
      setBranches(allowed);
      setCategories(c || []); setCounterparties(cp || []); setReasons(rs || []);
      const wanted = params.get("branch");
      if (allowed.length && !branchId) setBranchId(wanted && allowed.some((x: Branch) => x.id === wanted) ? wanted : allowed[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  // ---------- load branch refs ----------
  useEffect(() => {
    if (!branchId) return;
    (async () => {
      const { data: s } = await supabase.from("rev_sections").select("*").eq("branch_id", branchId).eq("is_active", true).order("sort_order");
      setSections(s || []);
    })();
  }, [branchId]);

  useEffect(() => {
    if (!branchId || !date) return;
    (async () => {
      const [{ data }, { data: all }] = await Promise.all([
        supabase.from("employees").select("id,full_name,position,branch_id,employment_status,date_started,date_ended,is_protected").eq("branch_id", branchId).order("full_name"),
        supabase.from("employees").select("id,full_name"),
      ]);
      setAllNames(Object.fromEntries((all || []).map((e: any) => [e.id, e.full_name])));
      const list = (data || []).filter((e: Employee) =>
        (!e.date_started || e.date_started <= date) && (!e.date_ended || e.date_ended >= date) && (owner || !e.is_protected));
      setEmployees(list);
    })();
  }, [branchId, date, owner]);

  // ---------- load day ----------
  const loadDay = useCallback(async () => {
    if (!branchId || !date) return;
    setLoading(true); setMsg(null); setDirty(false);
    const { data: d } = await supabase.from("rev_days").select("*").eq("branch_id", branchId).eq("day_date", date).maybeSingle();
    setDay(d || null);
    setNotes(d?.notes || "");
    setOverride({ amount: d?.opening_cash_override != null ? String(d.opening_cash_override) : "", note: d?.opening_cash_override_note || "" });
    if (!d) {
      setSummary(null); setEntries({}); setAssign({}); setReadings({}); setReadingsMode({});
      setExpenses([]); setTransfers([]); setShortages([]); setAdvances([]); setFines([]); setAdjustments([]); setCount(null);
      // still show a preview of what opening cash would be
      const { data: prev } = await supabase.from("rev_day_summary").select("day_date,counted_closing").eq("branch_id", branchId).lt("day_date", date).not("counted_closing", "is", null).order("day_date", { ascending: false }).limit(1);
      setSummary(prev && prev[0] ? ({ opening_cash: prev[0].counted_closing, opening_from_date: prev[0].day_date } as any) : null);
      setLoading(false);
      return;
    }
    const [{ data: sm }, { data: en }, { data: ex }, { data: tr }, { data: sh }, { data: ad }, { data: fi }, { data: aj }, { data: cc }, { data: os }] = await Promise.all([
      supabase.from("rev_day_summary").select("*").eq("id", d.id).single(),
      supabase.from("rev_shift_entries").select("*, rev_cashier_assignments(*)").eq("day_id", d.id),
      supabase.from("rev_expenses").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_cash_transfers").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_shortages").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_advances").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_fines").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_adjustments").select("*").eq("day_id", d.id).order("created_at"),
      supabase.from("rev_cash_counts").select("*").eq("day_id", d.id).maybeSingle(),
      supabase.from("rev_shortages").select("*").eq("branch_id", branchId).eq("resolution", "payroll").lt("shortage_date", date).gte("shortage_date", date.slice(0, 7) + "-01").order("shortage_date", { ascending: false }),
    ]);
    setSummary(sm as DaySummary);
    const em: Record<Key, ShiftEntry> = {}; const am: Record<Key, Assignment[]> = {}; const rm: Record<Key, any> = {}; const rmode: Record<Key, boolean> = {};
    (en || []).forEach((e: any) => {
      const k = key(e.section_id, e.shift);
      const { rev_cashier_assignments, ...rest } = e;
      em[k] = rest; am[k] = rev_cashier_assignments || [];
      if (rest.source_readings?.mode === "cumulative") { rm[k] = rest.source_readings.readings || {}; rmode[k] = true; }
    });
    setEntries(em); setAssign(am); setReadings(rm); setReadingsMode(rmode);
    setExpenses(ex || []); setTransfers(tr || []); setShortages(sh || []); setAdvances(ad || []); setFines(fi || []); setAdjustments(aj || []);
    setCount(cc || null); setOutstanding(os || []);
    setLoading(false);
  }, [branchId, date]);

  useEffect(() => { loadDay(); }, [loadDay]);

  // Refresh the saved lists and the summary only. Never touches unsaved shift figures, cashiers, count or notes.
  const refreshLists = useCallback(async () => {
    if (!day) return;
    const [{ data: sm }, { data: ex }, { data: tr }, { data: sh }, { data: ad }, { data: fi }, { data: aj }, { data: os }] = await Promise.all([
      supabase.from("rev_day_summary").select("*").eq("id", day.id).single(),
      supabase.from("rev_expenses").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_cash_transfers").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_shortages").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_advances").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_fines").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_adjustments").select("*").eq("day_id", day.id).order("created_at"),
      supabase.from("rev_shortages").select("*").eq("branch_id", branchId).eq("resolution", "payroll").lt("shortage_date", date).gte("shortage_date", date.slice(0, 7) + "-01").order("shortage_date", { ascending: false }),
    ]);
    if (sm) setSummary(sm as DaySummary);
    setExpenses(ex || []); setTransfers(tr || []); setShortages(sh || []); setAdvances(ad || []); setFines(fi || []); setAdjustments(aj || []); setOutstanding(os || []);
  }, [day, branchId, date]);

  // ---------- permissions ----------
  const editable = !!day ? (summary?.editable ?? false) : (owner || (!readOnly && (date >= addDays(todayIso(), -(who?.edit_window_days ?? 1)))));
  const threshold = who?.variance_threshold ?? 50;
  const branch = branches.find((b) => b.id === branchId);

  // ---------- live calculations ----------
  const live = useMemo(() => {
    const opening = Number(summary?.opening_cash ?? 0);
    const cash = Object.values(entries).reduce((a, e) => a + entryCash(e), 0);
    const exp = expenses.reduce((a, x) => a + num(x.amount), 0);
    const sent = transfers.filter((t) => t.direction === "sent").reduce((a, x) => a + num(x.amount), 0);
    const recv = transfers.filter((t) => t.direction === "received").reduce((a, x) => a + num(x.amount), 0);
    const sh = shortages.reduce((a, x) => a + num(x.amount), 0);
    const repaid = Number(summary?.repaid ?? 0);
    const adv = advances.reduce((a, x) => a + num(x.amount), 0);
    const adj = adjustments.filter((a) => a.approved_at).reduce((a, x) => a + num(x.amount), 0);
    const expected = r2(opening + cash - exp - sent + recv - sh + repaid - adv + adj);
    const counted = count ? countTotal(count) : null;
    const variance = counted == null ? null : r2(counted - expected);
    return { opening, cash: r2(cash), exp: r2(exp), sent, recv, sh, repaid, adv, adj, expected, counted, variance };
  }, [summary, entries, expenses, transfers, shortages, advances, adjustments, count]);

  // ---------- entry helpers ----------
  const getEntry = (sec: Section, shift: "day" | "night"): ShiftEntry => entries[key(sec.id, shift)] || blankEntry(day?.id || "", sec.id, shift);
  const setField = (sec: Section, shift: "day" | "night", f: keyof ShiftEntry, v: any) => {
    const k = key(sec.id, shift);
    setEntries((prev) => ({ ...prev, [k]: { ...(prev[k] || blankEntry(day?.id || "", sec.id, shift)), [f]: v } }));
    setDirty(true);
  };
  const setReading = (sec: Section, f: MoneyField, v: string) => {
    const k = key(sec.id, "night");
    const next = { ...(readings[k] || {}), [f]: v };
    setReadings((p) => ({ ...p, [k]: next }));
    const dayE = getEntry(sec, "day");
    const shiftVal = r2(num(v) - num(dayE[f]));
    setField(sec, "night", f, shiftVal < 0 ? 0 : shiftVal);
  };
  const toggleReadings = (sec: Section) => {
    const k = key(sec.id, "night");
    setReadingsMode((p) => ({ ...p, [k]: !p[k] }));
    setDirty(true);
  };
  const addAssignment = (sec: Section, shift: "day" | "night") => {
    const k = key(sec.id, shift);
    setAssign((p) => ({ ...p, [k]: [...(p[k] || []), { employee_id: "", counter_role: "sports", float_issued: 0 }] }));
    setDirty(true);
  };
  const setAssignment = (sec: Section, shift: "day" | "night", i: number, f: keyof Assignment, v: any) => {
    const k = key(sec.id, shift);
    setAssign((p) => { const l = [...(p[k] || [])]; l[i] = { ...l[i], [f]: v }; return { ...p, [k]: l }; });
    setDirty(true);
  };
  const removeAssignment = (sec: Section, shift: "day" | "night", i: number) => {
    const k = key(sec.id, shift);
    setAssign((p) => { const l = [...(p[k] || [])]; l.splice(i, 1); return { ...p, [k]: l }; });
    setDirty(true);
  };

  // ---------- persistence ----------
  const startDay = async () => {
    setSaving(true); setMsg(null);
    const { data, error } = await supabase.from("rev_days").insert({ branch_id: branchId, day_date: date, created_by: email }).select("*").single();
    setSaving(false);
    if (error) { setMsg({ type: "err", text: error.message }); return; }
    setDay(data);
    // copy yesterday's cashier assignments as a starting point
    const { data: prevEntries } = await supabase.from("rev_shift_entries").select("section_id,shift,manager_employee_id,rev_cashier_assignments(employee_id,counter_role,float_issued), rev_days!inner(branch_id,day_date)")
      .eq("rev_days.branch_id", branchId).eq("rev_days.day_date", addDays(date, -1));
    const am: Record<Key, Assignment[]> = {}; const em: Record<Key, ShiftEntry> = {};
    (prevEntries || []).forEach((e: any) => {
      const k = key(e.section_id, e.shift);
      am[k] = (e.rev_cashier_assignments || []).map((a: any) => ({ employee_id: a.employee_id, counter_role: a.counter_role, float_issued: 0 }));
      em[k] = { ...blankEntry(data.id, e.section_id, e.shift), manager_employee_id: e.manager_employee_id };
    });
    setAssign(am); setEntries(em);
    await loadDayKeepLocal(data.id, em, am);
  };

  // reload lists but keep local unsaved entries/assignments (used after startDay)
  const loadDayKeepLocal = async (dayId: string, em: Record<Key, ShiftEntry>, am: Record<Key, Assignment[]>) => {
    const { data: sm } = await supabase.from("rev_day_summary").select("*").eq("id", dayId).single();
    setSummary(sm as DaySummary);
    setEntries(em); setAssign(am); setDirty(Object.keys(am).length > 0);
  };

  const saveCore = async (): Promise<boolean> => {
    if (!day) return false;
    setSaving(true); setMsg(null);
    try {
      // day notes / override
      const patch: any = { notes: notes || null };
      if (owner) {
        patch.opening_cash_override = override.amount.trim() === "" ? null : num(override.amount);
        patch.opening_cash_override_note = override.note || null;
      }
      const { error: e0 } = await supabase.from("rev_days").update(patch).eq("id", day.id);
      if (e0) throw e0;

      // shift entries (only sections/shifts that apply)
      for (const sec of sections) {
        const shifts: ("day" | "night")[] = sec.shifts === "both" ? ["day", "night"] : [sec.shifts];
        for (const sh of shifts) {
          const k = key(sec.id, sh);
          const e = entries[k];
          if (!e && !(assign[k] || []).length) continue;
          const base = e || blankEntry(day.id, sec.id, sh);
          const row: any = { day_id: day.id, section_id: sec.id, shift: sh, manager_employee_id: base.manager_employee_id || null, created_by: email };
          MONEY.forEach((f) => (row[f] = r2(num(base[f]))));
          row.source_readings = sh === "night" && readingsMode[k] ? { mode: "cumulative", readings: readings[k] || {} } : null;
          const { data: saved, error: e1 } = await supabase.from("rev_shift_entries").upsert(row, { onConflict: "day_id,section_id,shift" }).select("id").single();
          if (e1) throw e1;
          // assignments: replace
          const { error: e2 } = await supabase.from("rev_cashier_assignments").delete().eq("shift_entry_id", saved.id);
          if (e2) throw e2;
          const list = (assign[k] || []).filter((a) => a.employee_id).map((a) => ({ shift_entry_id: saved.id, employee_id: a.employee_id, counter_role: a.counter_role, float_issued: r2(num(a.float_issued)) }));
          if (list.length) { const { error: e3 } = await supabase.from("rev_cashier_assignments").insert(list); if (e3) throw e3; }
        }
      }
      // cash count
      if (count) {
        const row: any = { ...count, day_id: day.id, created_by: email };
        delete row.total; delete row.created_at; delete row.updated_at;
        DENOMS.forEach((d) => (row[d.key] = Math.max(0, Math.round(num((count as any)[d.key])))));
        row.other_amount = r2(num(count.other_amount));
        const { error: e4 } = await supabase.from("rev_cash_counts").upsert(row, { onConflict: "day_id" });
        if (e4) throw e4;
      }
      setDirty(false);
      setMsg({ type: "ok", text: "Saved" });
      await loadDay();
      return true;
    } catch (err: any) {
      setMsg({ type: "err", text: err.message || String(err) });
      return false;
    } finally { setSaving(false); }
  };

  const submitDay = async () => {
    if (!day) return;
    if (dirty) { const ok = await saveCore(); if (!ok) return; }
    // validation
    const problems: string[] = [];
    const hasEntry = Object.values(entries).some((e) => MONEY.some((f) => num(e[f]) > 0));
    if (!hasEntry) problems.push("No revenue figures entered.");
    if (!count) problems.push("Closing cash count is missing.");
    const v = live.variance;
    if (v != null && Math.abs(v) > threshold) {
      if (v < 0) problems.push(`Cash is short by ${fmtK(-v)} (more than K${threshold}). Allocate it to the cashier(s) on duty as a shortage, or propose an adjustment with a note.`);
      else if (!notes.trim()) problems.push(`Cash is over by ${fmtK(v)} (more than K${threshold}). Add a note explaining the overage.`);
    }
    if (problems.length) { setMsg({ type: "warn", text: problems.join(" ") }); return; }
    setSaving(true);
    const { error } = await supabase.from("rev_days").update({ status: "submitted", submitted_by: logName || email, submitted_at: new Date().toISOString() }).eq("id", day.id);
    setSaving(false);
    if (error) { setMsg({ type: "err", text: error.message }); return; }
    setMsg({ type: "ok", text: "Day submitted" });
    await loadDay();
  };

  const reopenDay = async () => {
    if (!day) return;
    const { error } = await supabase.from("rev_days").update({ status: "open" }).eq("id", day.id);
    if (error) setMsg({ type: "err", text: error.message }); else loadDay();
  };

  // generic list ops
  const insertRow = async (table: string, row: any) => {
    const { error } = await supabase.from(table).insert(row);
    if (error) { setMsg({ type: "err", text: error.message }); return false; }
    await refreshLists(); return true;
  };
  const deleteRow = async (table: string, id: string) => {
    if (!confirm("Delete this line?")) return;
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) setMsg({ type: "err", text: error.message }); else refreshLists();
  };

  // ---------- forms state ----------
  const [fx, setFx] = useState({ category_id: "", description: "", amount: "", shift: "", paid_to: "" });
  const [editExpId, setEditExpId] = useState<string | null>(null);
  const blankFx = { category_id: "", description: "", amount: "", shift: "", paid_to: "" };
  const startEditExpense = (x: Expense) => {
    setEditExpId(x.id);
    setFx({ category_id: x.category_id, description: x.description, amount: String(x.amount), shift: x.shift || "", paid_to: x.paid_to || "" });
  };
  const saveExpense = async () => {
    if (!day) return;
    const row = { category_id: fx.category_id, description: fx.description.trim(), amount: r2(num(fx.amount)), shift: fx.shift || null, paid_to: fx.paid_to || null };
    if (editExpId) {
      const { error } = await supabase.from("rev_expenses").update(row).eq("id", editExpId);
      if (error) { setMsg({ type: "err", text: error.message }); return; }
      await refreshLists();
    } else if (!(await insertRow("rev_expenses", { ...row, day_id: day.id, entered_by: email }))) return;
    setEditExpId(null); setFx(blankFx);
  };
  const [ft, setFt] = useState({ direction: "sent", amount: "", counterparty_id: "", mobile_number: "", done_by_employee_id: "", time: "" });
  const [fs, setFs] = useState({ employee_id: "", amount: "", reason_id: "", note: "", shift_entry_id: "" });
  const [fa, setFa] = useState({ employee_id: "", amount: "", note: "" });
  const [ff, setFf] = useState({ employee_id: "", amount: "", reason: "" });
  const [fj, setFj] = useState({ amount: "", reason: "unexplained", note: "" });

  const MANAGER_POS = ["manager", "assistant_manager", "supervisor", "SUPERVISOR", "operations_manager"];
  const CASHIER_POS = ["cashier", "senior_cashier", "waitress", "it_technician", "promoter"];
  const managers = employees.filter((e) => MANAGER_POS.includes(e.position));
  const cashiers = employees.filter((e) => CASHIER_POS.includes(e.position));
  const empName = (id: string | null) => (id ? employees.find((e) => e.id === id)?.full_name || allNames[id] || "Unknown staff" : "");
  const catName = (id: string) => categories.find((c) => c.id === id)?.name || "";

  // ---------- render ----------
  if (authLoading || !who) return <div className="text-sm" style={{ color: "#6b7280" }}>Loading...</div>;
  if (!branches.length) return <div className="text-sm" style={{ color: "#d9534f" }}>No branch assigned to this login.</div>;

  const shiftOptions = sections.flatMap((sec) => (sec.shifts === "both" ? ["day", "night"] : [sec.shifts]).map((sh) => ({
    key: key(sec.id, sh), section_id: sec.id, shift: sh as "day" | "night",
    label: (sh === "day" ? "Day" : "Night") + (sections.length > 1 ? ` • ${sec.name}` : ""),
  })));
  const shiftLabel = (entryId: string | null) => {
    if (!entryId) return "";
    const e = Object.values(entries).find((x) => x.id === entryId);
    return e ? shiftOptions.find((o) => o.key === key(e.section_id, e.shift))?.label || "" : "";
  };
  // A shortage can be tied to a shift before that shift's figures are saved: create the empty shift row if needed.
  const ensureShiftEntry = async (k: string): Promise<string | null> => {
    const o = shiftOptions.find((x) => x.key === k);
    if (!o || !day) return null;
    if (entries[k]?.id) return entries[k].id!;
    const { data: found } = await supabase.from("rev_shift_entries").select("id").eq("day_id", day.id).eq("section_id", o.section_id).eq("shift", o.shift).maybeSingle();
    let id = found?.id as string | undefined;
    if (!id) {
      const { data: ins, error } = await supabase.from("rev_shift_entries").insert({ day_id: day.id, section_id: o.section_id, shift: o.shift, created_by: email }).select("id").single();
      if (error) { setMsg({ type: "err", text: error.message }); return null; }
      id = ins.id;
    }
    setEntries((prev) => ({ ...prev, [k]: { ...(prev[k] || blankEntry(day.id, o.section_id, o.shift)), id } }));
    return id!;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header controls */}
      <div className="chart-card flex flex-wrap items-end gap-3">
        <div>
          <label className="lbl">Store</label>
          <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={branches.length === 1} style={{ minWidth: 180 }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <label className="lbl">Date</label>
          <div className="flex items-center gap-1">
            <button className="btn btn-sm" onClick={() => setDate(addDays(date, -1))}>◀</button>
            <input type="date" className="inp" value={date} max={addDays(todayIso(), 1)} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            <button className="btn btn-sm" onClick={() => setDate(addDays(date, 1))} disabled={date >= addDays(todayIso(), 1)}>▶</button>
            <button className="btn btn-sm" onClick={() => setDate(todayIso())}>Today</button>
          </div>
        </div>
        <div className="text-[13px] font-semibold" style={{ color: "#e6e8eb" }}>{weekday(date)} {dmy(date)}</div>
        <div className="flex-1" />
        {day && (
          <div className="text-[11px] flex items-center gap-3" style={{ color: "#9aa0a8" }}>
            <span className="badge" style={{ background: day.status === "submitted" ? "#12261b" : "#2a2410", color: day.status === "submitted" ? "#3fb67a" : "#c9a227" }}>
              {day.status === "submitted" ? "Submitted" : "Open"}
            </span>
            {!editable && <span className="badge" style={{ background: "#2b1a1a", color: "#d9534f" }}>Locked</span>}
            {day.lucky_balls_unverified && <span className="badge" style={{ background: "#2a2410", color: "#c9a227" }}>Lucky Balls unverified (imported)</span>}
          </div>
        )}
      </div>

      {msg && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{
          background: msg.type === "ok" ? "#3fb67a15" : msg.type === "warn" ? "#c9a22715" : "#d9534f15",
          color: msg.type === "ok" ? "#3fb67a" : msg.type === "warn" ? "#c9a227" : "#d9534f",
          border: `1px solid ${msg.type === "ok" ? "#3fb67a30" : msg.type === "warn" ? "#c9a22730" : "#d9534f30"}` }}>
          {msg.text}
        </div>
      )}

      {loading ? <div className="text-sm" style={{ color: "#6b7280" }}>Loading day...</div> : !day ? (
        <div className="chart-card flex flex-col gap-3 items-start">
          <div className="text-sm" style={{ color: "#9aa0a8" }}>No entry exists for {branch?.name} on {dmy(date)}.</div>
          {summary?.opening_cash != null && (
            <div className="text-xs" style={{ color: "#6b7280" }}>Opening cash will be {fmtK(summary.opening_cash)} (closing count of {dmy(summary.opening_from_date)}).</div>
          )}
          {editable ? <button className="btn btn-green" onClick={startDay} disabled={saving}>Start this day</button>
            : <div className="text-xs" style={{ color: "#d9534f" }}>This date is outside your edit window. Ask the owner to open it.</div>}
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) 320px" }}>
          {/* LEFT: entry */}
          <div className="flex flex-col gap-4 min-w-0">
            {sections.map((sec) => {
              const shifts: ("day" | "night")[] = sec.shifts === "both" ? ["day", "night"] : [sec.shifts];
              return shifts.map((sh) => {
                const e = getEntry(sec, sh);
                const k = key(sec.id, sh);
                const rmode = sh === "night" && readingsMode[k];
                return (
                  <div className="chart-card" key={k}>
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                      <div className="h2" style={{ marginBottom: 0, border: 0, padding: 0 }}>{sh === "day" ? "Day shift" : "Night shift"}{sections.length > 1 ? ` • ${sec.name}` : ""}</div>
                      <div className="flex items-center gap-3">
                        {sh === "night" && (
                          <label className="text-[11px] flex items-center gap-1.5 cursor-pointer" style={{ color: "#9aa0a8" }}>
                            <input type="checkbox" checked={!!rmode} onChange={() => toggleReadings(sec)} disabled={!editable} />
                            Enter end-of-day cumulative readings
                          </label>
                        )}
                        <div className="text-[12px]" style={{ color: "#9aa0a8" }}>Cash revenue: <b style={{ color: entryCash(e) < 0 ? "#d9534f" : "#3fb67a" }}>{fmtK(entryCash(e))}</b></div>
                      </div>
                    </div>
                    <div className="grid gap-3 mb-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                      <div style={{ gridColumn: "span 2" }}>
                        <label className="lbl">Manager on duty</label>
                        <EmployeeSelect employees={managers.length ? managers : employees} value={e.manager_employee_id} onChange={(v) => setField(sec, sh, "manager_employee_id", v || null)} disabled={!editable} placeholder="Select manager" />
                      </div>
                    </div>
                    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                      {MONEY.map((f) => (
                        <div key={f}>
                          <label className="lbl">{FIELD_LABEL[f]}</label>
                          {rmode ? (
                            <div>
                              <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="cumulative" value={readings[k]?.[f] ?? ""} onChange={(ev) => setReading(sec, f, ev.target.value)} disabled={!editable} />
                              <div className="text-[10px] text-right mt-0.5" style={{ color: "#6b7280" }}>shift = {fmtK(e[f])}</div>
                            </div>
                          ) : (
                            <input type="number" step="0.01" min="0" className="inp inp-num" value={e[f] === 0 ? "" : e[f]} placeholder="0.00" onChange={(ev) => setField(sec, sh, f, ev.target.value === "" ? 0 : ev.target.value)} disabled={!editable} />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 flex-wrap mt-2 text-[11px]" style={{ color: "#6b7280" }}>
                      <span>Sports net {fmtK(num(e.sport_tickets) + num(e.sport_deposits) - num(e.sport_payouts) - num(e.sport_withdrawals))}</span>
                      <span>Lucky Balls {fmtK(num(e.lb_in) - num(e.lb_out))}</span>
                      <span>Lucky 6 {fmtK(num(e.l6_in) - num(e.l6_out))}</span>
                    </div>
                    {/* cashiers */}
                    <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="lbl" style={{ marginBottom: 0 }}>Cashiers on duty{sh === "night" ? " (maximum 2)" : ""}</span>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{(assign[k] || []).filter((a) => a.employee_id).length} selected</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {cashiers.map((c) => {
                          const list = assign[k] || [];
                          const on = list.some((a) => a.employee_id === c.id);
                          const full = sh === "night" && !on && list.filter((a) => a.employee_id).length >= 2;
                          return (
                            <button key={c.id} type="button" className={`chip ${on ? "chip-active" : ""}`} disabled={!editable || full}
                              style={{ opacity: full ? 0.4 : 1 }}
                              onClick={() => {
                                setAssign((p) => {
                                  const l = [...(p[k] || [])];
                                  const i = l.findIndex((a) => a.employee_id === c.id);
                                  if (i >= 0) l.splice(i, 1); else l.push({ employee_id: c.id, counter_role: l.some((a) => a.counter_role === "sports") ? "lucky_balls" : "sports", float_issued: 0 });
                                  return { ...p, [k]: l };
                                });
                                setDirty(true);
                              }}>{c.full_name}</button>
                          );
                        })}
                        {cashiers.length === 0 && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>No cashiers on this branch in payroll.</span>}
                      </div>
                      {(assign[k] || []).filter((a) => a.employee_id).map((a, i) => (
                        <div key={a.employee_id} className="grid gap-2 mb-1.5 items-center" style={{ gridTemplateColumns: "minmax(0,2fr) minmax(0,1fr) 120px" }}>
                          <span className="text-[12px]">{empName(a.employee_id)}</span>
                          <select className="inp" value={a.counter_role} onChange={(ev) => setAssignment(sec, sh, (assign[k] || []).indexOf(a), "counter_role", ev.target.value)} disabled={!editable}>
                            {COUNTER_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                          </select>
                          <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Float issued" value={a.float_issued || ""} onChange={(ev) => setAssignment(sec, sh, (assign[k] || []).indexOf(a), "float_issued", ev.target.value)} disabled={!editable} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              });
            })}

            {/* Expenses */}
            <div className="chart-card">
              <div className="h2">Expenses <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• total {fmtK(live.exp)}</span></div>
              {expenses.length > 0 && (
                <table className="tbl mb-3"><thead><tr><th>Category</th><th>Specification</th><th>Paid to</th><th>Shift</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>{expenses.map((x) => { const c = categories.find((cc) => cc.id === x.category_id); return (
                    <tr key={x.id} className={editable ? "row-hover" : ""} title={editable ? "Click to edit" : undefined}
                      style={{ cursor: editable ? "pointer" : "default", background: editExpId === x.id ? "#1f242b" : undefined }}
                      onClick={() => editable && startEditExpense(x)}><td>{c?.name}{c?.flag_for_owner && <span title="Flagged for owner" style={{ color: "#c9a227" }}> ⚑</span>}</td><td>{x.description}</td><td style={{ color: "#9aa0a8" }}>{x.paid_to}</td><td style={{ color: "#6b7280" }}>{x.shift || ""}</td><td className="num">{fmtK(x.amount)}</td>
                      <td className="num">{editable && <button className="btn btn-sm btn-red" onClick={(ev) => { ev.stopPropagation(); if (editExpId === x.id) { setEditExpId(null); setFx(blankFx); } deleteRow("rev_expenses", x.id); }}>✕</button>}</td></tr>); })}</tbody></table>
              )}
              {editable && editExpId && <div className="text-[11px] mb-1.5" style={{ color: "#c9a227" }}>Editing the highlighted expense. Change the fields below and press Update.</div>}
              {editable && (
                <div className="grid gap-2" style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,2fr) minmax(0,1fr) 90px 110px auto" }}>
                  <select className="inp" value={fx.category_id} onChange={(e) => setFx({ ...fx, category_id: e.target.value })}><option value="">Category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                  <input className="inp" placeholder="What exactly (e.g. 100 fritters for clients)" value={fx.description} onChange={(e) => setFx({ ...fx, description: e.target.value })} />
                  <input className="inp" placeholder="Paid to (optional)" value={fx.paid_to} onChange={(e) => setFx({ ...fx, paid_to: e.target.value })} />
                  <select className="inp" value={fx.shift} onChange={(e) => setFx({ ...fx, shift: e.target.value })}><option value="">Shift</option><option value="day">Day</option><option value="night">Night</option></select>
                  <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Amount" value={fx.amount} onChange={(e) => setFx({ ...fx, amount: e.target.value })} />
                  <div className="flex gap-1">
                    <button className="btn btn-sm btn-green" disabled={!fx.category_id || !fx.description.trim() || num(fx.amount) <= 0} onClick={saveExpense}>{editExpId ? "Update" : "Add"}</button>
                    {editExpId && <button className="btn btn-sm" onClick={() => { setEditExpId(null); setFx(blankFx); }}>Cancel</button>}
                  </div>
                </div>
              )}
            </div>

            {/* Cash transfers */}
            <div className="chart-card">
              <div className="h2">Cash sent / received <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• sent {fmtK(live.sent)} • received {fmtK(live.recv)}</span></div>
              {transfers.length > 0 && (
                <table className="tbl mb-3"><thead><tr><th>Direction</th><th>Counterparty</th><th>Number</th><th>By</th><th>Time</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>{transfers.map((t) => { const cp = counterparties.find((c) => c.id === t.counterparty_id); return (
                    <tr key={t.id}><td style={{ color: t.direction === "sent" ? "#d9534f" : "#3fb67a" }}>{t.direction === "sent" ? "Sent from shop" : "Received by shop"}</td><td>{cp?.name || t.counterparty_text}</td><td style={{ color: "#9aa0a8" }}>{t.mobile_number || cp?.mobile_number}</td><td style={{ color: "#9aa0a8" }}>{empName(t.done_by_employee_id)}</td><td style={{ color: "#6b7280" }}>{fmtTime(t.done_at)}</td><td className="num">{fmtK(t.amount)}</td>
                      <td className="num">{editable && <button className="btn btn-sm btn-red" onClick={() => deleteRow("rev_cash_transfers", t.id)}>✕</button>}</td></tr>); })}</tbody></table>
              )}
              {editable && (
                <div className="grid gap-2" style={{ gridTemplateColumns: "130px minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.4fr) 132px 110px auto" }}>
                  <select className="inp" value={ft.direction} onChange={(e) => setFt({ ...ft, direction: e.target.value })}><option value="sent">Sent from shop</option><option value="received">Received by shop</option></select>
                  <select className="inp" value={ft.counterparty_id} onChange={(e) => { const cp = counterparties.find((c) => c.id === e.target.value); setFt({ ...ft, counterparty_id: e.target.value, mobile_number: cp?.mobile_number || "" }); }}>
                    <option value="">Counterparty</option>{counterparties.filter((c) => (ft.direction === "sent" ? c.can_receive : c.can_send)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input className="inp" placeholder="Mobile number" value={ft.mobile_number} onChange={(e) => setFt({ ...ft, mobile_number: e.target.value })} />
                  <EmployeeSelect employees={managers.length ? managers : employees} value={ft.done_by_employee_id} onChange={(v) => setFt({ ...ft, done_by_employee_id: v })} placeholder="Done by (manager)" />
                  <TimeSelect value={ft.time} onChange={(v) => setFt({ ...ft, time: v })} />
                  <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Amount" value={ft.amount} onChange={(e) => setFt({ ...ft, amount: e.target.value })} />
                  <button className="btn btn-sm btn-green" disabled={!ft.counterparty_id || num(ft.amount) <= 0} onClick={async () => {
                    const done_at = ft.time ? fromLocalInput(`${date}T${ft.time}`) : new Date().toISOString();
                    if (await insertRow("rev_cash_transfers", { day_id: day.id, direction: ft.direction, amount: r2(num(ft.amount)), counterparty_id: ft.counterparty_id, mobile_number: ft.mobile_number || null, done_by_employee_id: ft.done_by_employee_id || null, done_at, created_by: email }))
                      setFt({ ...ft, amount: "", time: "" });
                  }}>Add</button>
                </div>
              )}
            </div>

            {/* Shortages */}
            <div className="chart-card">
              <div className="h2">Staff shortages <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• today {fmtK(live.sh)}</span></div>
              {shortages.length > 0 && (
                <table className="tbl mb-3"><thead><tr><th>Staff</th><th>Shift</th><th>Reason</th><th>Note</th><th>Resolution</th><th className="num">Amount</th><th /></tr></thead>
                  <tbody>{shortages.map((s) => (
                    <tr key={s.id}><td>{s.employee_id ? empName(s.employee_id) : <span style={{ color: "#c9a227" }}>{s.employee_text} (unmatched)</span>}</td><td style={{ color: "#9aa0a8" }}>{shiftLabel(s.shift_entry_id)}</td><td>{reasons.find((r) => r.id === s.reason_id)?.name}</td><td style={{ color: "#9aa0a8" }}>{s.note}</td>
                      <td style={{ color: s.resolution === "cash_repaid" ? "#3fb67a" : "#9aa0a8" }}>{s.resolution === "payroll" ? "Deduct from pay" : s.resolution === "cash_repaid" ? `Repaid ${fmtK(s.repaid_amount)}` : "Written off"}{s.payroll_synced_at ? " • synced" : ""}</td>
                      <td className="num" style={{ color: "#d9534f" }}>{fmtK(s.amount)}</td>
                      <td className="num">{editable && <button className="btn btn-sm btn-red" onClick={() => deleteRow("rev_shortages", s.id)}>✕</button>}</td></tr>))}</tbody></table>
              )}
              {editable && (
                <div className="grid gap-2" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr) 110px auto" }}>
                  <EmployeeSelect employees={employees} value={fs.employee_id} onChange={(v) => setFs({ ...fs, employee_id: v })} placeholder="Cashier" />
                  <select className="inp" value={fs.reason_id} onChange={(e) => setFs({ ...fs, reason_id: e.target.value })}><option value="">Reason</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                  <input className="inp" placeholder="Note (optional)" value={fs.note} onChange={(e) => setFs({ ...fs, note: e.target.value })} />
                  <select className="inp" value={fs.shift_entry_id} onChange={(e) => setFs({ ...fs, shift_entry_id: e.target.value })}>
                    <option value="">Shift</option>{shiftOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Amount" value={fs.amount} onChange={(e) => setFs({ ...fs, amount: e.target.value })} />
                  <button className="btn btn-sm btn-green" disabled={!fs.employee_id || num(fs.amount) <= 0} onClick={async () => {
                    let shiftEntryId: string | null = null;
                    if (fs.shift_entry_id) { shiftEntryId = await ensureShiftEntry(fs.shift_entry_id); if (!shiftEntryId) return; }
                    if (await insertRow("rev_shortages", { day_id: day.id, branch_id: branchId, employee_id: fs.employee_id, shortage_date: date, amount: r2(num(fs.amount)), reason_id: fs.reason_id || null, note: fs.note || null, shift_entry_id: shiftEntryId, created_by: email }))
                      setFs({ employee_id: "", amount: "", reason_id: "", note: "", shift_entry_id: "" });
                  }}>Add</button>
                </div>
              )}
              {live.variance != null && live.variance < -threshold && editable && (
                <div className="mt-2 text-[11px]" style={{ color: "#c9a227" }}>
                  Cash is short by {fmtK(-live.variance)}. <button className="btn btn-sm" onClick={() => setFs({ ...fs, amount: String(r2(-live.variance!)) })}>Use this amount</button>
                </div>
              )}
              {outstanding.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid #181c21" }}>
                  <div className="lbl">Outstanding shortages earlier this month (not yet repaid in cash)</div>
                  <table className="tbl"><tbody>{outstanding.map((s) => (
                    <tr key={s.id}><td style={{ color: "#6b7280" }}>{dmy(s.shortage_date)}</td><td>{s.employee_id ? empName(s.employee_id) : s.employee_text}</td><td style={{ color: "#9aa0a8" }}>{s.note}</td><td className="num">{fmtK(s.amount)}</td>
                      <td className="num">{editable && <button className="btn btn-sm" onClick={async () => { const { error } = await supabase.rpc("rev_mark_repaid", { p_shortage_id: s.id, p_repaid_day_id: day.id }); if (error) setMsg({ type: "err", text: error.message }); else refreshLists(); }}>Repaid in cash today</button>}</td></tr>))}</tbody></table>
                </div>
              )}
              {Number(summary?.repaid || 0) > 0 && <div className="mt-2 text-[11px]" style={{ color: "#3fb67a" }}>Cash repaid into till today: {fmtK(summary?.repaid)}</div>}
            </div>

            {/* Advances + Fines */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="chart-card">
                <div className="h2">Staff advances <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• {fmtK(live.adv)}</span></div>
                {advances.map((a) => (
                  <div key={a.id} className="kv"><span>{empName(a.employee_id)} <span style={{ color: "#6b7280" }}>{a.note}</span></span><span className="flex gap-2 items-center">{fmtK(a.amount)}{editable && <button className="btn btn-sm btn-red" onClick={() => deleteRow("rev_advances", a.id)}>✕</button>}</span></div>
                ))}
                {editable && (
                  <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) 100px auto" }}>
                    <EmployeeSelect employees={employees} value={fa.employee_id} onChange={(v) => setFa({ ...fa, employee_id: v })} placeholder="Staff" />
                    <input className="inp" placeholder="Note" value={fa.note} onChange={(e) => setFa({ ...fa, note: e.target.value })} />
                    <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Amount" value={fa.amount} onChange={(e) => setFa({ ...fa, amount: e.target.value })} />
                    <button className="btn btn-sm btn-green" disabled={!fa.employee_id || num(fa.amount) <= 0} onClick={async () => { if (await insertRow("rev_advances", { day_id: day.id, branch_id: branchId, employee_id: fa.employee_id, advance_date: date, amount: r2(num(fa.amount)), note: fa.note || null, created_by: email })) setFa({ employee_id: "", amount: "", note: "" }); }}>Add</button>
                  </div>
                )}
              </div>
              <div className="chart-card">
                <div className="h2">Staff fines <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• not cash</span></div>
                {fines.map((f) => (
                  <div key={f.id} className="kv"><span>{empName(f.employee_id)} <span style={{ color: "#6b7280" }}>{f.reason}</span></span><span className="flex gap-2 items-center">{fmtK(f.amount)}{editable && <button className="btn btn-sm btn-red" onClick={() => deleteRow("rev_fines", f.id)}>✕</button>}</span></div>
                ))}
                {editable && (
                  <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr) 100px auto" }}>
                    <EmployeeSelect employees={employees} value={ff.employee_id} onChange={(v) => setFf({ ...ff, employee_id: v })} placeholder="Staff" />
                    <input className="inp" placeholder="Reason" value={ff.reason} onChange={(e) => setFf({ ...ff, reason: e.target.value })} />
                    <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="Amount" value={ff.amount} onChange={(e) => setFf({ ...ff, amount: e.target.value })} />
                    <button className="btn btn-sm btn-green" disabled={!ff.employee_id || !ff.reason.trim() || num(ff.amount) <= 0} onClick={async () => { if (await insertRow("rev_fines", { day_id: day.id, branch_id: branchId, employee_id: ff.employee_id, fine_date: date, amount: r2(num(ff.amount)), reason: ff.reason.trim(), created_by: email })) setFf({ employee_id: "", amount: "", reason: "" }); }}>Add</button>
                  </div>
                )}
              </div>
            </div>

            {/* Cash count */}
            <div className="chart-card">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="h2" style={{ marginBottom: 0, border: 0, padding: 0 }}>Closing cash count <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• counted the next morning</span></div>
                {!count && editable && <button className="btn btn-sm btn-green" onClick={() => { setCount({ ...blankCount(day.id), counted_at: new Date().toISOString() }); setDirty(true); }}>Enter count</button>}
              </div>
              {count && (
                <>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
                    {DENOMS.map((d) => (
                      <div key={d.key}>
                        <label className="lbl">{d.label}</label>
                        <input type="number" min="0" step="1" className="inp inp-num" placeholder="0" value={(count as any)[d.key] || ""} onChange={(e) => { setCount({ ...count, [d.key]: e.target.value === "" ? 0 : parseInt(e.target.value) || 0 }); setDirty(true); }} disabled={!editable} />
                        <div className="text-[10px] text-right" style={{ color: "#6b7280" }}>{fmtK(d.value * (Number((count as any)[d.key]) || 0))}</div>
                      </div>
                    ))}
                    <div>
                      <label className="lbl">Other</label>
                      <input type="number" step="0.01" min="0" className="inp inp-num" placeholder="0.00" value={count.other_amount || ""} onChange={(e) => { setCount({ ...count, other_amount: e.target.value === "" ? 0 : (e.target.value as any) }); setDirty(true); }} disabled={!editable} />
                    </div>
                  </div>
                  <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 290px" }}>
                    <div><label className="lbl">Other note</label><input className="inp" placeholder="e.g. coins bag, mobile money float" value={count.other_note || ""} onChange={(e) => { setCount({ ...count, other_note: e.target.value }); setDirty(true); }} disabled={!editable} /></div>
                    <div><label className="lbl">Counted by</label><EmployeeSelect employees={employees} value={count.counted_by_employee_id} onChange={(v) => { setCount({ ...count, counted_by_employee_id: v || null }); setDirty(true); }} disabled={!editable} /></div>
                    <div><label className="lbl">Witness</label><EmployeeSelect employees={employees} value={count.witness_employee_id} onChange={(v) => { setCount({ ...count, witness_employee_id: v || null }); setDirty(true); }} disabled={!editable} placeholder="Optional" /></div>
                    <div><label className="lbl">Counted at (24h)</label>
                      <div className="flex gap-1">
                        <input type="date" className="inp" style={{ minWidth: 0 }} value={toLocalInput(count.counted_at).slice(0, 10)} disabled={!editable}
                          onChange={(e) => { const t = toLocalInput(count.counted_at).slice(11, 16) || "08:00"; setCount({ ...count, counted_at: e.target.value ? fromLocalInput(`${e.target.value}T${t}`) : null }); setDirty(true); }} />
                        <TimeSelect value={toLocalInput(count.counted_at).slice(11, 16)} disabled={!editable}
                          onChange={(v) => { const d0 = toLocalInput(count.counted_at).slice(0, 10) || addDays(date, 1); setCount({ ...count, counted_at: fromLocalInput(`${d0}T${v || "00:00"}`) }); setDirty(true); }} />
                      </div></div>
                  </div>
                  <div className="mt-3 text-[13px]">Counted total: <b style={{ color: "#c9a227" }}>{fmtK(countTotal(count))}</b></div>
                </>
              )}
            </div>

            {/* Adjustments (owner) */}
            {(owner || adjustments.length > 0) && (
              <div className="chart-card">
                <div className="h2">Adjustments <span style={{ color: "#9aa0a8", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>• owner approval required</span></div>
                {adjustments.map((a) => (
                  <div key={a.id} className="kv">
                    <span>{a.reason.replace(/_/g, " ")} <span style={{ color: "#6b7280" }}>{a.note}</span> {a.approved_at ? <span style={{ color: "#3fb67a" }}>approved by {a.approved_by}</span> : <span style={{ color: "#c9a227" }}>pending</span>}</span>
                    <span className="flex gap-2 items-center">{fmtSigned(a.amount)}
                      {owner && !a.approved_at && <button className="btn btn-sm btn-green" onClick={async () => { const { error } = await supabase.from("rev_adjustments").update({ approved_by: logName || email, approved_at: new Date().toISOString() }).eq("id", a.id); if (error) setMsg({ type: "err", text: error.message }); else refreshLists(); }}>Approve</button>}
                      {(owner || !a.approved_at) && editable && <button className="btn btn-sm btn-red" onClick={() => deleteRow("rev_adjustments", a.id)}>✕</button>}
                    </span>
                  </div>
                ))}
                {editable && (
                  <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "140px minmax(0,2fr) 120px auto" }}>
                    <select className="inp" value={fj.reason} onChange={(e) => setFj({ ...fj, reason: e.target.value })}>
                      <option value="test_tickets">Test tickets</option><option value="count_correction">Count correction</option><option value="unexplained">Unexplained</option><option value="other">Other</option>
                    </select>
                    <input className="inp" placeholder="Explanation" value={fj.note} onChange={(e) => setFj({ ...fj, note: e.target.value })} />
                    <input type="number" step="0.01" className="inp inp-num" placeholder="+/- amount" value={fj.amount} onChange={(e) => setFj({ ...fj, amount: e.target.value })} />
                    <button className="btn btn-sm" disabled={num(fj.amount) === 0 || !fj.note.trim()} onClick={async () => {
                      const row: any = { day_id: day.id, amount: r2(num(fj.amount)), reason: fj.reason, note: fj.note.trim(), created_by: email };
                      if (owner) { row.approved_by = logName || email; row.approved_at = new Date().toISOString(); }
                      if (await insertRow("rev_adjustments", row)) setFj({ amount: "", reason: "unexplained", note: "" });
                    }}>{owner ? "Add and approve" : "Propose"}</button>
                  </div>
                )}
                <div className="text-[10px] mt-2" style={{ color: "#6b7280" }}>Positive raises expected cash (e.g. test tickets that produced no cash are entered as a negative amount on the revenue they inflated).</div>
              </div>
            )}

            {/* Notes + owner override */}
            <div className="chart-card">
              <div className="h2">Notes</div>
              <textarea className="inp" rows={2} placeholder="Anything unusual today (overage explanation, incidents, client refunds...)" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} disabled={!editable} />
              {owner && (
                <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: "160px minmax(0,1fr)" }}>
                  <div><label className="lbl">Opening cash override (owner)</label><input type="number" step="0.01" className="inp inp-num" placeholder="leave blank" value={override.amount} onChange={(e) => { setOverride({ ...override, amount: e.target.value }); setDirty(true); }} /></div>
                  <div><label className="lbl">Override reason</label><input className="inp" value={override.note} onChange={(e) => { setOverride({ ...override, note: e.target.value }); setDirty(true); }} /></div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: live summary */}
          <div className="flex flex-col gap-3" style={{ position: "sticky", top: 16, alignSelf: "start" }}>
            <div className="chart-card">
              <div className="h2">Live reconciliation</div>
              <div className="kv"><span style={{ color: "#9aa0a8" }}>Opening cash {summary?.opening_from_date ? <span style={{ color: "#6b7280" }}>({dmy(summary.opening_from_date)})</span> : ""}</span><span>{fmtK(live.opening)}</span></div>
              {summary?.opening_from_date && summary.opening_from_date !== addDays(date, -1) && !summary.opening_cash_override && (
                <div className="text-[10px] mb-1" style={{ color: "#c9a227" }}>Previous day has no closing count. Opening carried from {dmy(summary.opening_from_date)}.</div>
              )}
              <div className="kv"><span style={{ color: "#9aa0a8" }}>+ Cash revenue</span><span style={{ color: live.cash < 0 ? "#d9534f" : "#3fb67a" }}>{fmtK(live.cash)}</span></div>
              <div className="kv"><span style={{ color: "#9aa0a8" }}>- Expenses</span><span>{fmtK(live.exp)}</span></div>
              <div className="kv"><span style={{ color: "#9aa0a8" }}>- Sent from shop</span><span>{fmtK(live.sent)}</span></div>
              <div className="kv"><span style={{ color: "#9aa0a8" }}>+ Received by shop</span><span>{fmtK(live.recv)}</span></div>
              <div className="kv"><span style={{ color: "#9aa0a8" }}>- Staff shortages</span><span>{fmtK(live.sh)}</span></div>
              {live.repaid > 0 && <div className="kv"><span style={{ color: "#9aa0a8" }}>+ Shortages repaid</span><span>{fmtK(live.repaid)}</span></div>}
              {live.adv > 0 && <div className="kv"><span style={{ color: "#9aa0a8" }}>- Advances</span><span>{fmtK(live.adv)}</span></div>}
              {live.adj !== 0 && <div className="kv"><span style={{ color: "#9aa0a8" }}>± Adjustments</span><span>{fmtSigned(live.adj)}</span></div>}
              <div className="kv mt-1 pt-1" style={{ borderTop: "1px solid #23272e", fontWeight: 600 }}><span>Expected closing</span><span style={{ color: "#c9a227" }}>{fmtK(live.expected)}</span></div>
              <div className="kv" style={{ fontWeight: 600 }}><span>Counted closing</span><span>{live.counted == null ? <span style={{ color: "#6b7280" }}>not counted</span> : fmtK(live.counted)}</span></div>
              <div className="kv" style={{ fontWeight: 700, fontSize: 14 }}>
                <span>Variance</span>
                <span style={{ color: live.variance == null ? "#6b7280" : Math.abs(live.variance) <= threshold ? "#3fb67a" : "#d9534f" }}>
                  {live.variance == null ? "—" : fmtSigned(live.variance)}
                </span>
              </div>
              {live.variance != null && Math.abs(live.variance) > threshold && (
                <div className="text-[10px] mt-1" style={{ color: "#d9534f" }}>Over the K{threshold} threshold. {live.variance < 0 ? "Allocate to cashier(s) as a shortage." : "Explain in notes."}</div>
              )}
              <div className="kv mt-2 pt-2" style={{ borderTop: "1px solid #23272e" }}><span style={{ color: "#9aa0a8" }}>Net after expenses</span><span>{fmtK(live.cash - live.exp)}</span></div>
            </div>

            <div className="chart-card flex flex-col gap-2">
              {editable ? (
                <>
                  <button className="btn btn-yellow" onClick={saveCore} disabled={saving || !dirty}>{saving ? "Saving..." : dirty ? "Save changes" : "Saved"}</button>
                  {day.status !== "submitted" ? (
                    <button className="btn btn-green" onClick={submitDay} disabled={saving}>Submit day</button>
                  ) : (
                    <button className="btn" onClick={reopenDay} disabled={saving}>Reopen day</button>
                  )}
                </>
              ) : (
                <div className="text-[11px]" style={{ color: "#d9534f" }}>Locked. Managers can edit today and yesterday only. The owner can edit any day or open a window.</div>
              )}
              {day.submitted_at && <div className="text-[10px]" style={{ color: "#6b7280" }}>Submitted by {day.submitted_by} on {fmtDateTime(day.submitted_at)}</div>}
              {dirty && <div className="text-[10px]" style={{ color: "#c9a227" }}>Unsaved changes in figures, cashiers, count or notes.</div>}
            </div>

            <div className="chart-card text-[11px]" style={{ color: "#6b7280" }}>
              <div className="lbl">How to close a day</div>
              1. Enter each shift's figures and cashiers.<br />2. Add expenses and cash sent/received as they happen.<br />3. Next morning, enter the denomination count.<br />4. Explain or allocate any variance over K{threshold}.<br />5. Submit.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
