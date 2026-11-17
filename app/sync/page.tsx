"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, supabase } from "@/lib/auth-context";
import { fmtK, dmy, todayIso } from "@/lib/helpers";
import type { Branch, WhoAmI } from "@/lib/types";

interface Row { kind: "shortage" | "advance" | "fine"; id: string; employee_id: string | null; employee_text: string | null; date: string; amount: number; note: string; synced_at: string | null; resolution?: string; }

const monthStart = (iso: string) => iso.slice(0, 7) + "-01";
const monthEnd = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export default function SyncPage() {
  const { loading: authLoading, readOnly } = useAuth();
  const [who, setWho] = useState<WhoAmI | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState(monthStart(todayIso()));
  const [to, setTo] = useState(monthEnd(todayIso()));
  const [rows, setRows] = useState<Row[]>([]);
  const [emps, setEmps] = useState<Record<string, string>>({});
  const [result, setResult] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      const [{ data: w }, { data: b }, { data: e }] = await Promise.all([
        supabase.rpc("rev_whoami").single(),
        supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
        supabase.from("employees").select("id,full_name"),
      ]);
      const me = w as WhoAmI; setWho(me);
      const allowed = (b || []).filter((x: Branch) => me?.is_owner || (me?.branch_ids || []).includes(x.id));
      setBranches(allowed); if (allowed.length) setBranchId(allowed[0].id);
      setEmps(Object.fromEntries((e || []).map((x: any) => [x.id, x.full_name])));
    })();
  }, [authLoading]);

  const load = async () => {
    if (!branchId) return;
    const [{ data: s }, { data: a }, { data: f }] = await Promise.all([
      supabase.from("rev_shortages").select("id,employee_id,employee_text,shortage_date,amount,note,resolution,payroll_synced_at").eq("branch_id", branchId).gte("shortage_date", from).lte("shortage_date", to).order("shortage_date"),
      supabase.from("rev_advances").select("id,employee_id,advance_date,amount,note,payroll_synced_at").eq("branch_id", branchId).gte("advance_date", from).lte("advance_date", to).order("advance_date"),
      supabase.from("rev_fines").select("id,employee_id,fine_date,amount,reason,payroll_synced_at").eq("branch_id", branchId).gte("fine_date", from).lte("fine_date", to).order("fine_date"),
    ]);
    setRows([
      ...(s || []).map((x: any) => ({ kind: "shortage" as const, id: x.id, employee_id: x.employee_id, employee_text: x.employee_text, date: x.shortage_date, amount: x.amount, note: x.note || "", synced_at: x.payroll_synced_at, resolution: x.resolution })),
      ...(a || []).map((x: any) => ({ kind: "advance" as const, id: x.id, employee_id: x.employee_id, employee_text: null, date: x.advance_date, amount: x.amount, note: x.note || "", synced_at: x.payroll_synced_at })),
      ...(f || []).map((x: any) => ({ kind: "fine" as const, id: x.id, employee_id: x.employee_id, employee_text: null, date: x.fine_date, amount: x.amount, note: x.reason || "", synced_at: x.payroll_synced_at })),
    ].sort((x, y) => x.date.localeCompare(y.date)));
    setResult(null);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [branchId, from, to]);

  const syncable = useMemo(() => rows.filter((r) => r.employee_id && (r.kind !== "shortage" || r.resolution === "payroll")), [rows]);
  const blocked = useMemo(() => rows.filter((r) => !r.employee_id), [rows]);

  const runSync = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("rev_sync_to_payroll", { p_branch_id: branchId, p_from: from, p_to: to });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setResult(data || []);
    load();
  };

  const exportCsv = () => {
    const lines = ["employee_id,employee_name,branch_id,date,kind,amount,note"];
    syncable.forEach((r) => lines.push([r.employee_id, `"${(emps[r.employee_id!] || "").replace(/"/g, '""')}"`, branchId, r.date, r.kind, Number(r.amount).toFixed(2), `"${r.note.replace(/"/g, '""')}"`].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `payroll_daily_log_${from}_${to}.csv`; a.click();
  };

  const bname = branches.find((b) => b.id === branchId)?.name;

  return (
    <div className="flex flex-col gap-4">
      <div className="chart-card flex flex-wrap items-end gap-3">
        <div><label className="lbl">Store</label><select className="inp" value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={branches.length === 1} style={{ minWidth: 180 }}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        <div><label className="lbl">From</label><input type="date" className="inp" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="lbl">To</label><input type="date" className="inp" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        <div className="flex-1" />
        <button className="btn" onClick={exportCsv} disabled={!syncable.length}>CSV (daily log shape)</button>
        <button className="btn btn-green" onClick={runSync} disabled={busy || !syncable.length || readOnly}>{busy ? "Syncing..." : `Sync ${syncable.length} to payroll Daily Log`}</button>
      </div>

      <div className="chart-card text-[12px]" style={{ color: "#9aa0a8" }}>
        Sync writes each cashier's shortage, advance and fine amounts for the day into the payroll <b>daily_logs</b> row (employee_id + date), creating the row as "present" if the manager has not logged attendance yet. Amounts are the sum for that employee and day, so running it again is safe. Shortages marked "repaid in cash" or "written off" are not sent.
        {blocked.length > 0 && <div className="mt-2" style={{ color: "#c9a227" }}>{blocked.length} imported shortage(s) have an unmatched staff name and will be skipped until a cashier is selected on the day's entry.</div>}
        {err && <div className="mt-2" style={{ color: "#d9534f" }}>{err}</div>}
        {result && <div className="mt-2" style={{ color: "#3fb67a" }}>Synced {result.length} line(s): {result.filter((r) => r.outcome === "updated").length} updated existing logs, {result.filter((r) => r.outcome === "inserted").length} created new log rows.</div>}
      </div>

      <div className="chart-card" style={{ overflowX: "auto" }}>
        <div className="h2">{bname} • {dmy(from)} to {dmy(to)}</div>
        <table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Staff</th><th>Note</th><th>Resolution</th><th className="num">Amount</th><th>Payroll</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.kind + r.id} className="row-hover">
              <td>{dmy(r.date)}</td><td style={{ color: r.kind === "shortage" ? "#d9534f" : r.kind === "advance" ? "#9aa0a8" : "#c9a227" }}>{r.kind}</td>
              <td>{r.employee_id ? emps[r.employee_id] || "Former staff" : <span style={{ color: "#c9a227" }}>{r.employee_text} (unmatched)</span>}</td><td style={{ color: "#9aa0a8" }}>{r.note}</td>
              <td style={{ color: "#6b7280" }}>{r.resolution === "cash_repaid" ? "repaid in cash (not synced)" : r.resolution === "written_off" ? "written off (not synced)" : r.resolution === "payroll" ? "deduct from pay" : ""}</td>
              <td className="num">{fmtK(r.amount)}</td>
              <td style={{ color: r.synced_at ? "#3fb67a" : "#6b7280" }}>{r.synced_at ? `synced ${new Date(r.synced_at).toLocaleDateString("en-GB")}` : "not synced"}</td>
            </tr>))}
            {!rows.length && <tr><td colSpan={7} style={{ color: "#6b7280" }}>Nothing in this range.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
