"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth, supabase } from "@/lib/auth-context";
import { fmtK, fmtSigned, dmy, todayIso, monthLabel } from "@/lib/helpers";
import type { Branch, DaySummary, WhoAmI } from "@/lib/types";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarView() {
  const { loading: authLoading } = useAuth();
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [days, setDays] = useState<DaySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const threshold = who?.variance_threshold ?? 50;

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      const [{ data: w }, { data: b }] = await Promise.all([
        supabase.rpc("rev_whoami").single(),
        supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
      ]);
      const me = w as WhoAmI; setWho(me);
      const allowed = (b || []).filter((x: Branch) => me?.is_owner || (me?.branch_ids || []).includes(x.id));
      setBranches(allowed);
      if (allowed.length) setBranchId(allowed[0].id);
    })();
  }, [authLoading]);

  useEffect(() => {
    if (!branchId || !month) return;
    (async () => {
      setLoading(true);
      const start = `${month}-01`;
      const [y, m] = month.split("-").map(Number);
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const { data } = await supabase.from("rev_day_summary").select("*").eq("branch_id", branchId).gte("day_date", start).lte("day_date", end).order("day_date");
      setDays((data || []) as DaySummary[]);
      setLoading(false);
    })();
  }, [branchId, month]);

  const grid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const cells: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [month]);

  const byDate = useMemo(() => Object.fromEntries(days.map((d) => [d.day_date, d])), [days]);
  const today = todayIso();
  const totals = useMemo(() => days.reduce((a, d) => ({
    cash: a.cash + Number(d.cash_revenue), exp: a.exp + Number(d.expenses), net: a.net + Number(d.net_after_costs),
    sh: a.sh + Number(d.shortages), varAbs: a.varAbs + Math.abs(Number(d.variance || 0)), flagged: a.flagged + (d.variance != null && Math.abs(Number(d.variance)) > threshold ? 1 : 0),
    missing: a.missing, submitted: a.submitted + (d.status === "submitted" ? 1 : 0),
  }), { cash: 0, exp: 0, net: 0, sh: 0, varAbs: 0, flagged: 0, missing: 0, submitted: 0 }), [days, threshold]);
  const pastDates = grid.filter((d) => d && d < today) as string[];
  const missing = pastDates.filter((d) => !byDate[d]);
  const uncounted = pastDates.filter((d) => byDate[d] && byDate[d].counted_closing == null);

  const shiftMonth = (n: number) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };

  return (
    <div className="flex flex-col gap-4">
      <div className="chart-card flex flex-wrap items-end gap-3">
        <div><label className="lbl">Store</label>
          <select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={branches.length === 1} style={{ minWidth: 180 }}>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>
        <div><label className="lbl">Month</label>
          <div className="flex items-center gap-1">
            <button className="btn btn-sm" onClick={() => shiftMonth(-1)}>◀</button>
            <input type="month" className="inp" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 150 }} />
            <button className="btn btn-sm" onClick={() => shiftMonth(1)}>▶</button>
          </div></div>
        <div className="text-[13px] font-semibold">{monthLabel(month)}</div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {[
          { l: "Cash revenue", v: fmtK(totals.cash), c: "#4ade80" },
          { l: "Expenses", v: fmtK(totals.exp), c: "#f5f5f5" },
          { l: "Net after expenses", v: fmtK(totals.net), c: "#facc15" },
          { l: "Staff shortages", v: fmtK(totals.sh), c: "#f87171" },
          { l: "Days with variance > K" + threshold, v: String(totals.flagged), c: totals.flagged ? "#f87171" : "#4ade80" },
          { l: "Missing days (past)", v: String(missing.length), c: missing.length ? "#f87171" : "#4ade80" },
          { l: "Days not counted", v: String(uncounted.length), c: uncounted.length ? "#fbbf24" : "#4ade80" },
          { l: "Submitted / entered", v: `${totals.submitted} / ${days.length}`, c: "#22d3ee" },
        ].map((s) => (
          <div className="stat-card" key={s.l}><div className="text-[10px] uppercase tracking-wider" style={{ color: "#636363" }}>{s.l}</div><div className="text-[18px] font-bold mt-1" style={{ color: s.c }}>{s.v}</div></div>
        ))}
      </div>

      <div className="chart-card" style={{ padding: 12 }}>
        {loading && <div className="text-xs mb-2" style={{ color: "#636363" }}>Loading...</div>}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {DOW.map((d) => <div key={d} className="text-[10px] uppercase tracking-wider text-center py-1" style={{ color: "#636363" }}>{d}</div>)}
          {grid.map((iso, i) => {
            if (!iso) return <div key={i} />;
            const d = byDate[iso];
            const isPast = iso < today; const isToday = iso === today; const future = iso > today;
            const v = d?.variance == null ? null : Number(d.variance);
            const flagged = v != null && Math.abs(v) > threshold;
            const border = future ? "#1c1c1c" : !d ? "#f8717160" : flagged ? "#f8717190" : d.counted_closing == null ? "#fbbf2460" : d.status === "submitted" ? "#22c55e50" : "#2a2a2a";
            const bg = !d && isPast ? "#f8717108" : flagged ? "#f8717108" : "#0a0a0a";
            return (
              <Link key={iso} href={`/entry?branch=${branchId}&date=${iso}`} className="block rounded-lg p-2 transition-colors row-hover" style={{ border: `1px solid ${border}`, background: bg, minHeight: 84, opacity: future ? 0.4 : 1 }}>
                <div className="flex justify-between items-center">
                  <span className="text-[12px] font-semibold" style={{ color: isToday ? "#facc15" : "#f5f5f5" }}>{iso.slice(8)}</span>
                  {d ? <span className="text-[9px]" style={{ color: d.status === "submitted" ? "#4ade80" : "#fbbf24" }}>{d.status === "submitted" ? "✓" : "open"}</span>
                    : isPast ? <span className="text-[9px]" style={{ color: "#f87171" }}>missing</span> : null}
                </div>
                {d && (
                  <div className="mt-1 text-[10px] leading-4">
                    <div style={{ color: Number(d.net_after_costs) < 0 ? "#f87171" : "#a3a3a3" }}>net {fmtK(d.net_after_costs)}</div>
                    <div style={{ color: v == null ? "#636363" : flagged ? "#f87171" : "#4ade80" }}>{v == null ? "not counted" : `var ${fmtSigned(v)}`}</div>
                    {Number(d.shortages) > 0 && <div style={{ color: "#fbbf24" }}>short {fmtK(d.shortages)}</div>}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="chart-card">
        <div className="h2">Day by day</div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Status</th><th className="num">Opening</th><th className="num">Tickets</th><th className="num">Deposits</th><th className="num">Payouts</th><th className="num">Withdrawals</th><th className="num">LB In</th><th className="num">LB Out</th><th className="num">L6 In</th><th className="num">L6 Out</th><th className="num">Cash rev</th><th className="num">Expenses</th><th className="num">Sent</th><th className="num">Recv</th><th className="num">Short</th><th className="num">Expected</th><th className="num">Counted</th><th className="num">Variance</th></tr></thead>
            <tbody>
              {days.map((d) => { const v = d.variance == null ? null : Number(d.variance); return (
                <tr key={d.id} className="row-hover">
                  <td><Link href={`/entry?branch=${branchId}&date=${d.day_date}`} style={{ color: "#22d3ee" }}>{dmy(d.day_date)}</Link>{d.lucky_balls_unverified && <span title="Lucky Balls unverified" style={{ color: "#fbbf24" }}> ⚑</span>}</td>
                  <td style={{ color: d.status === "submitted" ? "#4ade80" : "#fbbf24" }}>{d.status}</td>
                  <td className="num">{fmtK(d.opening_cash)}</td><td className="num">{fmtK(d.tickets)}</td><td className="num">{fmtK(d.deposits)}</td><td className="num">{fmtK(d.payouts)}</td><td className="num">{fmtK(d.withdrawals)}</td>
                  <td className="num">{fmtK(d.lb_in)}</td><td className="num">{fmtK(d.lb_out)}</td><td className="num">{fmtK(d.l6_in)}</td><td className="num">{fmtK(d.l6_out)}</td>
                  <td className="num" style={{ color: Number(d.cash_revenue) < 0 ? "#f87171" : "#4ade80" }}>{fmtK(d.cash_revenue)}</td>
                  <td className="num">{fmtK(d.expenses)}</td><td className="num">{fmtK(d.sent)}</td><td className="num">{fmtK(d.received)}</td><td className="num" style={{ color: Number(d.shortages) > 0 ? "#f87171" : undefined }}>{fmtK(d.shortages)}</td>
                  <td className="num">{fmtK(d.expected_closing)}</td><td className="num">{d.counted_closing == null ? "" : fmtK(d.counted_closing)}</td>
                  <td className="num" style={{ color: v == null ? "#636363" : Math.abs(v) > threshold ? "#f87171" : "#4ade80" }}>{v == null ? "" : fmtSigned(v)}</td>
                </tr>); })}
              {days.length === 0 && !loading && <tr><td colSpan={19} style={{ color: "#636363" }}>No days entered for this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
