"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, supabase } from "@/lib/auth-context";
import { fmtK, fmtSigned, dmy, todayIso, addDays } from "@/lib/helpers";
import type { Branch, DaySummary, WhoAmI } from "@/lib/types";

interface ShiftRow { shift_entry_id: string; day_id: string; branch_id: string; day_date: string; section_id: string; section_name: string; section_sort: number; shift: string;
  sport_tickets: number; sport_deposits: number; sport_payouts: number; sport_withdrawals: number; lb_in: number; lb_out: number; l6_in: number; l6_out: number; sports_net: number; sports_ggr: number; lb_balance: number; l6_balance: number; cash_revenue: number; }
interface ShortRow { id: string; branch_id: string; employee_id: string | null; employee_text: string | null; shortage_date: string; amount: number; resolution: string; repaid_amount: number; payroll_synced_at: string | null; }
interface ExpRow { day_id: string; category_id: string; amount: number; description: string; }

const n = (v: any) => Number(v || 0);
const monthStart = (iso: string) => iso.slice(0, 7) + "-01";
const monthEnd = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => { const out: string[] = []; let d = a; while (d <= b) { out.push(d); d = addDays(d, 1); } return out; };

export default function MonthlySummary() {
  const { isOwner, isSuperAdmin, loading: authLoading } = useAuth();
  const owner = isOwner || isSuperAdmin;
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState("all");
  const [from, setFrom] = useState(monthStart(todayIso()));
  const [to, setTo] = useState(monthEnd(todayIso()));
  const [days, setDays] = useState<DaySummary[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [shorts, setShorts] = useState<ShortRow[]>([]);
  const [exps, setExps] = useState<ExpRow[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string; flag_for_owner: boolean }[]>([]);
  const [emps, setEmps] = useState<Record<string, string>>({});
  const [sections, setSections] = useState<{ id: string; branch_id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"stores" | "sections" | "lucky" | "shortages" | "expenses" | "days">("stores");
  const threshold = who?.variance_threshold ?? 50;

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      const [{ data: w }, { data: b }, { data: c }, { data: e }, { data: s }] = await Promise.all([
        supabase.rpc("rev_whoami").single(),
        supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
        supabase.from("rev_expense_categories").select("id,name,flag_for_owner").order("sort_order"),
        supabase.from("employees").select("id,full_name"),
        supabase.from("rev_sections").select("id,branch_id,name").order("sort_order"),
      ]);
      const me = w as WhoAmI; setWho(me);
      setBranches((b || []).filter((x: Branch) => me?.is_owner || (me?.branch_ids || []).includes(x.id)));
      setCats(c || []); setEmps(Object.fromEntries((e || []).map((x: any) => [x.id, x.full_name]))); setSections(s || []);
    })();
  }, [authLoading]);

  useEffect(() => {
    if (!from || !to || !who) return;
    (async () => {
      setLoading(true);
      const [{ data: d }, { data: sh }, { data: so }] = await Promise.all([
        supabase.from("rev_day_summary").select("*").gte("day_date", from).lte("day_date", to).order("day_date"),
        supabase.from("rev_shift_summary").select("*").gte("day_date", from).lte("day_date", to),
        supabase.from("rev_shortages").select("id,branch_id,employee_id,employee_text,shortage_date,amount,resolution,repaid_amount,payroll_synced_at").gte("shortage_date", from).lte("shortage_date", to),
      ]);
      const dayIds = (d || []).map((x: any) => x.id);
      const { data: ex } = dayIds.length ? await supabase.from("rev_expenses").select("day_id,category_id,amount,description").in("day_id", dayIds) : { data: [] as any[] };
      setDays((d || []) as DaySummary[]); setShifts((sh || []) as ShiftRow[]); setShorts((so || []) as ShortRow[]); setExps((ex || []) as ExpRow[]);
      setLoading(false);
    })();
  }, [from, to, who]);

  const visBranches = useMemo(() => branches.filter((b) => branchFilter === "all" || b.id === branchFilter), [branches, branchFilter]);
  const bname = (id: string) => branches.find((b) => b.id === id)?.name || "";
  const fDays = useMemo(() => days.filter((d) => branchFilter === "all" || d.branch_id === branchFilter), [days, branchFilter]);
  const fShifts = useMemo(() => shifts.filter((d) => branchFilter === "all" || d.branch_id === branchFilter), [shifts, branchFilter]);
  const fShorts = useMemo(() => shorts.filter((d) => branchFilter === "all" || d.branch_id === branchFilter), [shorts, branchFilter]);
  const allDates = useMemo(() => daysBetween(from, to).filter((x) => x < todayIso()), [from, to]);

  // per store
  const storeRows = useMemo(() => visBranches.map((b) => {
    const ds = fDays.filter((d) => d.branch_id === b.id);
    const sum = (k: keyof DaySummary) => ds.reduce((a, d) => a + n(d[k]), 0);
    const entered = new Set(ds.map((d) => d.day_date));
    const missing = allDates.filter((x) => !entered.has(x)).length;
    const flagged = ds.filter((d) => d.variance != null && Math.abs(n(d.variance)) > threshold).length;
    return { id: b.id, name: b.name, days: ds.length, missing, flagged,
      tickets: sum("tickets"), deposits: sum("deposits"), payouts: sum("payouts"), withdrawals: sum("withdrawals"), sports_net: sum("sports_net"), sports_ggr: sum("sports_ggr"),
      lb_in: sum("lb_in"), lb_out: sum("lb_out"), lb_balance: sum("lb_balance"), l6_in: sum("l6_in"), l6_out: sum("l6_out"), l6_balance: sum("l6_balance"),
      cash_revenue: sum("cash_revenue"), expenses: sum("expenses"), sent: sum("sent"), received: sum("received"), shortages: sum("shortages"), advances: sum("advances"), adjustments: sum("adjustments"),
      net: sum("net_after_costs"), variance: ds.reduce((a, d) => a + n(d.variance), 0), unverified: ds.filter((d) => d.lucky_balls_unverified).length };
  }), [visBranches, fDays, allDates, threshold]);

  // per section (and shift)
  const sectionRows = useMemo(() => {
    const map: Record<string, any> = {};
    fShifts.forEach((s) => {
      const k = `${s.branch_id}|${s.section_id}|${s.shift}`;
      if (!map[k]) map[k] = { branch: bname(s.branch_id), section: s.section_name, shift: s.shift, sort: s.section_sort, days: 0, tickets: 0, deposits: 0, payouts: 0, withdrawals: 0, sports_net: 0, sports_ggr: 0, lb_in: 0, lb_out: 0, lb_balance: 0, l6_in: 0, l6_out: 0, l6_balance: 0, cash_revenue: 0 };
      const r = map[k]; r.days++;
      ["sport_tickets", "sport_deposits", "sport_payouts", "sport_withdrawals"].forEach((f, i) => (r[["tickets", "deposits", "payouts", "withdrawals"][i]] += n((s as any)[f])));
      ["sports_net", "sports_ggr", "lb_in", "lb_out", "lb_balance", "l6_in", "l6_out", "l6_balance", "cash_revenue"].forEach((f) => (r[f] += n((s as any)[f])));
    });
    return Object.values(map).sort((a, b) => a.branch.localeCompare(b.branch) || a.sort - b.sort || a.shift.localeCompare(b.shift));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fShifts, branches]);

  // lucky balls: store (and section where more than one)
  const luckyRows = useMemo(() => {
    const rows: { label: string; in: number; out: number; balance: number }[] = [];
    visBranches.forEach((b) => {
      const secs = sections.filter((s) => s.branch_id === b.id);
      const bs = fShifts.filter((s) => s.branch_id === b.id);
      if (secs.length > 1) {
        secs.forEach((sec) => { const ss = bs.filter((x) => x.section_id === sec.id); if (!ss.length) return; const i = ss.reduce((a, x) => a + n(x.lb_in), 0), o = ss.reduce((a, x) => a + n(x.lb_out), 0); rows.push({ label: `${b.name} ${sec.name}`, in: i, out: o, balance: i - o }); });
      }
      const i = bs.reduce((a, x) => a + n(x.lb_in), 0), o = bs.reduce((a, x) => a + n(x.lb_out), 0);
      rows.push({ label: b.name + (secs.length > 1 ? " (total)" : ""), in: i, out: o, balance: i - o });
    });
    return rows;
  }, [visBranches, sections, fShifts]);

  const shortageRows = useMemo(() => {
    const map: Record<string, any> = {};
    fShorts.forEach((s) => {
      const k = `${s.branch_id}|${s.employee_id || s.employee_text}`;
      if (!map[k]) map[k] = { branch: bname(s.branch_id), cashier: s.employee_id ? emps[s.employee_id] || "Former staff" : `${s.employee_text} (unmatched)`, count: 0, total: 0, payroll: 0, repaid: 0, written_off: 0, synced: 0 };
      const r = map[k]; r.count++; r.total += n(s.amount);
      if (s.resolution === "payroll") r.payroll += n(s.amount); else if (s.resolution === "cash_repaid") r.repaid += n(s.repaid_amount); else r.written_off += n(s.amount);
      if (s.payroll_synced_at) r.synced++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fShorts, emps, branches]);

  const expenseRows = useMemo(() => {
    const dayBranch = Object.fromEntries(days.map((d) => [d.id, d.branch_id]));
    const map: Record<string, any> = {};
    exps.forEach((e) => {
      const b = dayBranch[e.day_id]; if (!b || (branchFilter !== "all" && b !== branchFilter)) return;
      const k = `${b}|${e.category_id}`; const c = cats.find((x) => x.id === e.category_id);
      if (!map[k]) map[k] = { branch: bname(b), category: c?.name || "?", flagged: c?.flag_for_owner, count: 0, total: 0 };
      map[k].count++; map[k].total += n(e.amount);
    });
    return Object.values(map).sort((a, b) => a.branch.localeCompare(b.branch) || b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exps, days, cats, branchFilter, branches]);

  const flaggedExpenses = useMemo(() => {
    const dayMap = Object.fromEntries(days.map((d) => [d.id, d]));
    return exps.filter((e) => cats.find((c) => c.id === e.category_id)?.flag_for_owner).map((e) => ({ ...e, day: dayMap[e.day_id] })).filter((e) => e.day && (branchFilter === "all" || e.day.branch_id === branchFilter)).sort((a, b) => a.day.day_date.localeCompare(b.day.day_date));
  }, [exps, days, cats, branchFilter]);

  const exportXlsx = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: any[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
    add("Stores", storeRows.map((r) => ({ Store: r.name, "Days entered": r.days, "Missing days": r.missing, "Ticket sales": r.tickets, Deposits: r.deposits, Payouts: r.payouts, Withdrawals: r.withdrawals, "Sports net": r.sports_net, "Sports GGR": r.sports_ggr, "LB In": r.lb_in, "LB Out": r.lb_out, "LB Balance": r.lb_balance, "L6 In": r.l6_in, "L6 Out": r.l6_out, "L6 Balance": r.l6_balance, "Cash revenue": r.cash_revenue, Expenses: r.expenses, "Sent to HQ": r.sent, "Received": r.received, Shortages: r.shortages, Advances: r.advances, Adjustments: r.adjustments, "Net after expenses": r.net, "Variance total": r.variance, "Days variance > threshold": r.flagged })));
    add("Sections", sectionRows.map((r) => ({ Store: r.branch, Section: r.section, Shift: r.shift, Shifts: r.days, "Ticket sales": r.tickets, Deposits: r.deposits, Payouts: r.payouts, Withdrawals: r.withdrawals, "Sports net": r.sports_net, "Sports GGR": r.sports_ggr, "LB In": r.lb_in, "LB Out": r.lb_out, "LB Balance": r.lb_balance, "L6 In": r.l6_in, "L6 Out": r.l6_out, "L6 Balance": r.l6_balance, "Cash revenue": r.cash_revenue })));
    add("Lucky Balls", luckyRows.map((r) => ({ Store: r.label, In: r.in, Out: r.out, Balance: r.balance })));
    add("Shortages", shortageRows.map((r) => ({ Store: r.branch, Cashier: r.cashier, Count: r.count, Total: r.total, "To payroll": r.payroll, "Repaid in cash": r.repaid, "Written off": r.written_off, "Synced to payroll": r.synced })));
    add("Expenses", expenseRows.map((r) => ({ Store: r.branch, Category: r.category, Count: r.count, Total: r.total })));
    add("Days", fDays.map((d) => ({ Store: bname(d.branch_id), Date: dmy(d.day_date), Status: d.status, Opening: n(d.opening_cash), "Ticket sales": n(d.tickets), Deposits: n(d.deposits), Payouts: n(d.payouts), Withdrawals: n(d.withdrawals), "LB In": n(d.lb_in), "LB Out": n(d.lb_out), "L6 In": n(d.l6_in), "L6 Out": n(d.l6_out), "Cash revenue": n(d.cash_revenue), Expenses: n(d.expenses), Sent: n(d.sent), Received: n(d.received), Shortages: n(d.shortages), Repaid: n(d.repaid), Advances: n(d.advances), Adjustments: n(d.adjustments), Expected: n(d.expected_closing), Counted: d.counted_closing == null ? "" : n(d.counted_closing), Variance: d.variance == null ? "" : n(d.variance), "LB unverified": d.lucky_balls_unverified ? "yes" : "", Notes: d.notes || "" })));
    XLSX.writeFile(wb, `BwanaBet_Revenue_${from}_to_${to}.xlsx`);
  };

  if (!owner && !authLoading) return <div className="text-sm" style={{ color: "#d9534f" }}>Owner only.</div>;

  const num = (v: number, red = false) => <td className="num" style={{ color: red && v < 0 ? "#d9534f" : undefined }}>{fmtK(v)}</td>;
  const tabs: [typeof tab, string][] = [["stores", "Per store"], ["sections", "Per section / shift"], ["lucky", "Lucky Balls"], ["shortages", "Shortages by cashier"], ["expenses", "Expenses"], ["days", "All days"]];

  return (
    <div className="flex flex-col gap-4">
      <div className="chart-card flex flex-wrap items-end gap-3">
        <div><label className="lbl">Store</label><select className="inp" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} style={{ minWidth: 170 }}><option value="all">All stores</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label className="lbl">From</label><input type="date" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="lbl">To</label><input type="date" className="inp" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex gap-1">
          <button className="btn btn-sm" onClick={() => { const m = addDays(monthStart(from), -1); setFrom(monthStart(m)); setTo(monthEnd(m)); }}>◀ month</button>
          <button className="btn btn-sm" onClick={() => { setFrom(monthStart(todayIso())); setTo(monthEnd(todayIso())); }}>This month</button>
          <button className="btn btn-sm" onClick={() => { const m = addDays(monthEnd(to), 1); setFrom(monthStart(m)); setTo(monthEnd(m)); }}>month ▶</button>
        </div>
        <div className="flex-1" />
        <button className="btn btn-green" onClick={exportXlsx} disabled={loading || !days.length}>Export to Excel</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">{tabs.map(([k, l]) => <button key={k} className={`chip ${tab === k ? "chip-active" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {loading && <div className="text-xs" style={{ color: "#6b7280" }}>Loading...</div>}

      {tab === "stores" && (
        <div className="chart-card" style={{ overflowX: "auto" }}>
          <table className="tbl"><thead><tr><th>Store</th><th className="num">Days</th><th className="num">Missing</th><th className="num">Tickets</th><th className="num">Deposits</th><th className="num">Payouts</th><th className="num">Withdrawals</th><th className="num">Sports net</th><th className="num">Sports GGR</th><th className="num">LB bal</th><th className="num">L6 bal</th><th className="num">Cash rev</th><th className="num">Expenses</th><th className="num">Sent HQ</th><th className="num">Received</th><th className="num">Shortages</th><th className="num">Net</th><th className="num">Var total</th><th className="num">Var &gt; K{threshold}</th></tr></thead>
            <tbody>{storeRows.map((r) => (
              <tr key={r.id} className="row-hover"><td style={{ color: "#e6e8eb", fontWeight: 600 }}>{r.name}{r.unverified ? <span title={`${r.unverified} days with unverified Lucky Balls`} style={{ color: "#c9a227" }}> ⚑</span> : null}</td><td className="num">{r.days}</td><td className="num" style={{ color: r.missing ? "#d9534f" : "#3fb67a" }}>{r.missing}</td>
                {num(r.tickets)}{num(r.deposits)}{num(r.payouts)}{num(r.withdrawals)}{num(r.sports_net, true)}{num(r.sports_ggr, true)}{num(r.lb_balance, true)}{num(r.l6_balance, true)}{num(r.cash_revenue, true)}{num(r.expenses)}{num(r.sent)}{num(r.received)}{num(r.shortages)}
                <td className="num" style={{ color: "#c9a227", fontWeight: 600 }}>{fmtK(r.net)}</td><td className="num">{fmtSigned(r.variance)}</td><td className="num" style={{ color: r.flagged ? "#d9534f" : "#3fb67a" }}>{r.flagged}</td></tr>))}
              {storeRows.length > 1 && (() => { const t = storeRows.reduce((a: any, r) => { Object.keys(r).forEach((k) => { if (typeof (r as any)[k] === "number") a[k] = (a[k] || 0) + (r as any)[k]; }); return a; }, {}); return (
                <tr style={{ fontWeight: 700, borderTop: "2px solid #23272e" }}><td>Total</td><td className="num">{t.days}</td><td className="num">{t.missing}</td>{num(t.tickets)}{num(t.deposits)}{num(t.payouts)}{num(t.withdrawals)}{num(t.sports_net, true)}{num(t.sports_ggr, true)}{num(t.lb_balance, true)}{num(t.l6_balance, true)}{num(t.cash_revenue, true)}{num(t.expenses)}{num(t.sent)}{num(t.received)}{num(t.shortages)}<td className="num" style={{ color: "#c9a227" }}>{fmtK(t.net)}</td><td className="num">{fmtSigned(t.variance)}</td><td className="num">{t.flagged}</td></tr>); })()}
            </tbody></table>
          <div className="text-[10px] mt-2" style={{ color: "#6b7280" }}>Sports net = tickets + deposits - payouts - withdrawals (cash view). Sports GGR = tickets - payouts (betting view). Missing = past dates in range with no entry.</div>
        </div>
      )}

      {tab === "sections" && (
        <div className="chart-card" style={{ overflowX: "auto" }}>
          <table className="tbl"><thead><tr><th>Store</th><th>Section</th><th>Shift</th><th className="num">Shifts</th><th className="num">Tickets</th><th className="num">Deposits</th><th className="num">Payouts</th><th className="num">Withdrawals</th><th className="num">Sports net</th><th className="num">LB In</th><th className="num">LB Out</th><th className="num">LB bal</th><th className="num">L6 In</th><th className="num">L6 Out</th><th className="num">L6 bal</th><th className="num">Cash rev</th></tr></thead>
            <tbody>{sectionRows.map((r, i) => <tr key={i} className="row-hover"><td>{r.branch}</td><td>{r.section}</td><td>{r.shift}</td><td className="num">{r.days}</td>{num(r.tickets)}{num(r.deposits)}{num(r.payouts)}{num(r.withdrawals)}{num(r.sports_net, true)}{num(r.lb_in)}{num(r.lb_out)}{num(r.lb_balance, true)}{num(r.l6_in)}{num(r.l6_out)}{num(r.l6_balance, true)}{num(r.cash_revenue, true)}</tr>)}</tbody></table>
        </div>
      )}

      {tab === "lucky" && (
        <div className="chart-card" style={{ maxWidth: 560 }}>
          <div className="h2">Lucky Balls {dmy(from)} to {dmy(to)}</div>
          <table className="tbl"><thead><tr><th>Store</th><th className="num">In</th><th className="num">Out</th><th className="num">Balance</th></tr></thead>
            <tbody>{luckyRows.map((r, i) => <tr key={i} className="row-hover"><td>{r.label}</td>{num(r.in)}{num(r.out)}<td className="num" style={{ color: r.balance < 0 ? "#d9534f" : "#3fb67a", fontWeight: 600 }}>{fmtK(r.balance)}</td></tr>)}</tbody></table>
        </div>
      )}

      {tab === "shortages" && (
        <div className="chart-card" style={{ maxWidth: 900 }}>
          <table className="tbl"><thead><tr><th>Store</th><th>Cashier</th><th className="num">Count</th><th className="num">Total</th><th className="num">To payroll</th><th className="num">Repaid cash</th><th className="num">Written off</th><th className="num">Synced</th></tr></thead>
            <tbody>{shortageRows.map((r, i) => <tr key={i} className="row-hover"><td>{r.branch}</td><td>{r.cashier}</td><td className="num">{r.count}</td><td className="num" style={{ color: "#d9534f" }}>{fmtK(r.total)}</td>{num(r.payroll)}{num(r.repaid)}{num(r.written_off)}<td className="num">{r.synced}/{r.count}</td></tr>)}
              {!shortageRows.length && <tr><td colSpan={8} style={{ color: "#6b7280" }}>No shortages in range.</td></tr>}</tbody></table>
        </div>
      )}

      {tab === "expenses" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
          <div className="chart-card"><div className="h2">By category</div>
            <table className="tbl"><thead><tr><th>Store</th><th>Category</th><th className="num">Count</th><th className="num">Total</th></tr></thead>
              <tbody>{expenseRows.map((r, i) => <tr key={i} className="row-hover"><td>{r.branch}</td><td>{r.category}{r.flagged && <span style={{ color: "#c9a227" }}> ⚑</span>}</td><td className="num">{r.count}</td>{num(r.total)}</tr>)}</tbody></table></div>
          <div className="chart-card"><div className="h2">Flagged for owner</div>
            <table className="tbl"><thead><tr><th>Date</th><th>Store</th><th>Specification</th><th className="num">Amount</th></tr></thead>
              <tbody>{flaggedExpenses.map((e, i) => <tr key={i} className="row-hover"><td>{dmy(e.day.day_date)}</td><td>{bname(e.day.branch_id)}</td><td>{e.description}</td>{num(n(e.amount))}</tr>)}
                {!flaggedExpenses.length && <tr><td colSpan={4} style={{ color: "#6b7280" }}>None.</td></tr>}</tbody></table></div>
        </div>
      )}

      {tab === "days" && (
        <div className="chart-card" style={{ overflowX: "auto" }}>
          <table className="tbl"><thead><tr><th>Store</th><th>Date</th><th>Status</th><th className="num">Opening</th><th className="num">Cash rev</th><th className="num">Expenses</th><th className="num">Sent</th><th className="num">Recv</th><th className="num">Short</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th><th>Notes</th></tr></thead>
            <tbody>{fDays.map((d) => { const v = d.variance == null ? null : n(d.variance); return (
              <tr key={d.id} className="row-hover"><td>{bname(d.branch_id)}</td><td><a href={`/entry?branch=${d.branch_id}&date=${d.day_date}`} style={{ color: "#9aa0a8" }}>{dmy(d.day_date)}</a></td><td style={{ color: d.status === "submitted" ? "#3fb67a" : "#c9a227" }}>{d.status}</td>
                {num(n(d.opening_cash))}{num(n(d.cash_revenue), true)}{num(n(d.expenses))}{num(n(d.sent))}{num(n(d.received))}{num(n(d.shortages))}{num(n(d.expected_closing))}<td className="num">{d.counted_closing == null ? "" : fmtK(d.counted_closing)}</td>
                <td className="num" style={{ color: v == null ? "#6b7280" : Math.abs(v) > threshold ? "#d9534f" : "#3fb67a" }}>{v == null ? "" : fmtSigned(v)}</td><td style={{ color: "#9aa0a8", maxWidth: 260 }}>{d.notes}</td></tr>); })}</tbody></table>
        </div>
      )}
    </div>
  );
}
