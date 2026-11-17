"use client";

import { useEffect, useState } from "react";
import { useAuth, supabase } from "@/lib/auth-context";
import { dmy, todayIso } from "@/lib/helpers";
import type { Branch, Section, ExpenseCategory, Counterparty, ShortageReason } from "@/lib/types";

export default function ManagePage() {
  const { isOwner, isSuperAdmin, loading: authLoading, email } = useAuth();
  const owner = isOwner || isSuperAdmin;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [cps, setCps] = useState<Counterparty[]>([]);
  const [reasons, setReasons] = useState<ShortageReason[]>([]);
  const [windows, setWindows] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const [ns, setNs] = useState({ branch_id: "", name: "", code: "", shifts: "both" });
  const [nc, setNc] = useState({ name: "", flag_for_owner: false });
  const [ncp, setNcp] = useState({ name: "", mobile_number: "", can_send: true, can_receive: true });
  const [nr, setNr] = useState("");
  const [nw, setNw] = useState({ branch_id: "", start_date: todayIso(), end_date: todayIso(), reason: "" });

  const load = async () => {
    const [{ data: b }, { data: s }, { data: c }, { data: cp }, { data: r }, { data: w }, { data: st }, { data: p }] = await Promise.all([
      supabase.from("branches").select("id,name,code").eq("is_active", true).order("name"),
      supabase.from("rev_sections").select("*").order("sort_order"),
      supabase.from("rev_expense_categories").select("*").order("sort_order"),
      supabase.from("rev_counterparties").select("*").order("name"),
      supabase.from("rev_shortage_reasons").select("*").order("sort_order"),
      supabase.from("rev_edit_windows").select("*").order("start_date", { ascending: false }),
      supabase.from("rev_settings").select("*"),
      supabase.from("rev_adjustments").select("*, rev_days(day_date, branch_id)").is("approved_at", null).order("created_at"),
    ]);
    setBranches(b || []); setSections(s || []); setCats(c || []); setCps(cp || []); setReasons(r || []); setWindows(w || []);
    setSettings(Object.fromEntries((st || []).map((x: any) => [x.key, x.value]))); setPending(p || []);
  };
  useEffect(() => { if (!authLoading && owner) load(); }, [authLoading, owner]);

  const run = async (p: PromiseLike<any>) => { const { error } = await p; setMsg(error ? error.message : "Saved"); load(); };
  const bname = (id: string) => branches.find((b) => b.id === id)?.name || "";

  if (!authLoading && !owner) return <div className="text-sm" style={{ color: "#d9534f" }}>Owner only.</div>;

  return (
    <div className="flex flex-col gap-4">
      {msg && <div className="px-3 py-2 rounded-lg text-xs" style={{ background: msg === "Saved" ? "#3fb67a15" : "#d9534f15", color: msg === "Saved" ? "#3fb67a" : "#d9534f" }}>{msg}</div>}

      {pending.length > 0 && (
        <div className="chart-card">
          <div className="h2">Adjustments awaiting approval</div>
          <table className="tbl"><thead><tr><th>Store</th><th>Date</th><th>Reason</th><th>Note</th><th>By</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>{pending.map((a) => (
              <tr key={a.id}><td>{bname(a.rev_days?.branch_id)}</td><td>{dmy(a.rev_days?.day_date)}</td><td>{a.reason}</td><td>{a.note}</td><td style={{ color: "#6b7280" }}>{a.created_by}</td><td className="num">{Number(a.amount).toFixed(2)}</td>
                <td className="num flex gap-1 justify-end"><button className="btn btn-sm btn-green" onClick={() => run(supabase.from("rev_adjustments").update({ approved_by: email, approved_at: new Date().toISOString() }).eq("id", a.id))}>Approve</button><button className="btn btn-sm btn-red" onClick={() => run(supabase.from("rev_adjustments").delete().eq("id", a.id))}>Reject</button></td></tr>))}</tbody></table>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <div className="chart-card">
          <div className="h2">Settings</div>
          {[["variance_threshold", "Variance threshold (K)"], ["edit_window_days", "Manager edit window (days back from today; 1 = today and yesterday)"]].map(([k, l]) => (
            <div key={k} className="flex items-end gap-2 mb-2">
              <div className="flex-1"><label className="lbl">{l}</label><input className="inp inp-num" value={settings[k] ?? ""} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} /></div>
              <button className="btn btn-sm" onClick={() => run(supabase.from("rev_settings").update({ value: settings[k], updated_at: new Date().toISOString() }).eq("key", k))}>Save</button>
            </div>
          ))}
        </div>

        <div className="chart-card">
          <div className="h2">Edit windows (open locked days for a manager)</div>
          {windows.map((w) => <div key={w.id} className="kv"><span>{bname(w.branch_id)} {dmy(w.start_date)} to {dmy(w.end_date)} <span style={{ color: "#6b7280" }}>{w.reason}</span></span><button className="btn btn-sm btn-red" onClick={() => run(supabase.from("rev_edit_windows").delete().eq("id", w.id))}>✕</button></div>)}
          <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "minmax(0,1fr) 130px 130px minmax(0,1fr) auto" }}>
            <select className="inp" value={nw.branch_id} onChange={(e) => setNw({ ...nw, branch_id: e.target.value })}><option value="">Store</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <input type="date" className="inp" value={nw.start_date} onChange={(e) => setNw({ ...nw, start_date: e.target.value })} />
            <input type="date" className="inp" value={nw.end_date} onChange={(e) => setNw({ ...nw, end_date: e.target.value })} />
            <input className="inp" placeholder="Reason" value={nw.reason} onChange={(e) => setNw({ ...nw, reason: e.target.value })} />
            <button className="btn btn-sm btn-green" disabled={!nw.branch_id} onClick={() => run(supabase.from("rev_edit_windows").insert({ ...nw, created_by: email }))}>Open</button>
          </div>
        </div>

        <div className="chart-card">
          <div className="h2">Sections / counters</div>
          <table className="tbl"><tbody>{sections.map((s) => (
            <tr key={s.id}><td>{bname(s.branch_id)}</td><td>{s.name} <span style={{ color: "#6b7280" }}>({s.code})</span></td><td>{s.shifts}</td><td style={{ color: s.is_active ? "#3fb67a" : "#6b7280" }}>{s.is_active ? "active" : "inactive"}</td>
              <td className="num"><button className="btn btn-sm" onClick={() => run(supabase.from("rev_sections").update({ is_active: !s.is_active }).eq("id", s.id))}>{s.is_active ? "Deactivate" : "Activate"}</button></td></tr>))}</tbody></table>
          <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) 90px 90px auto" }}>
            <select className="inp" value={ns.branch_id} onChange={(e) => setNs({ ...ns, branch_id: e.target.value })}><option value="">Store</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <input className="inp" placeholder="Name (e.g. Kanyama 2)" value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} />
            <input className="inp" placeholder="CODE" value={ns.code} onChange={(e) => setNs({ ...ns, code: e.target.value.toUpperCase() })} />
            <select className="inp" value={ns.shifts} onChange={(e) => setNs({ ...ns, shifts: e.target.value })}><option value="both">Day + night</option><option value="day">Day only</option><option value="night">Night only</option></select>
            <button className="btn btn-sm btn-green" disabled={!ns.branch_id || !ns.name || !ns.code} onClick={() => run(supabase.from("rev_sections").insert({ ...ns, sort_order: sections.filter((s) => s.branch_id === ns.branch_id).length + 1 }))}>Add</button>
          </div>
        </div>

        <div className="chart-card">
          <div className="h2">Expense categories</div>
          {cats.map((c) => <div key={c.id} className="kv"><span style={{ color: c.is_active ? undefined : "#6b7280" }}>{c.name} {c.flag_for_owner && <span style={{ color: "#c9a227" }}>flagged</span>}</span>
            <span className="flex gap-1"><button className="btn btn-sm" onClick={() => run(supabase.from("rev_expense_categories").update({ flag_for_owner: !c.flag_for_owner }).eq("id", c.id))}>{c.flag_for_owner ? "Unflag" : "Flag"}</button><button className="btn btn-sm" onClick={() => run(supabase.from("rev_expense_categories").update({ is_active: !c.is_active }).eq("id", c.id))}>{c.is_active ? "Hide" : "Show"}</button></span></div>)}
          <div className="flex gap-2 mt-2 items-center">
            <input className="inp" placeholder="New category" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} />
            <label className="text-[11px] whitespace-nowrap" style={{ color: "#9aa0a8" }}><input type="checkbox" checked={nc.flag_for_owner} onChange={(e) => setNc({ ...nc, flag_for_owner: e.target.checked })} /> flag</label>
            <button className="btn btn-sm btn-green" disabled={!nc.name.trim()} onClick={() => run(supabase.from("rev_expense_categories").insert({ ...nc, sort_order: cats.length + 1 })).then(() => setNc({ name: "", flag_for_owner: false }))}>Add</button>
          </div>
        </div>

        <div className="chart-card">
          <div className="h2">Counterparties (cash sent / received)</div>
          {cps.map((c) => <div key={c.id} className="kv"><span style={{ color: c.is_active ? undefined : "#6b7280" }}>{c.name} <span style={{ color: "#6b7280" }}>{c.mobile_number}</span> <span style={{ color: "#6b7280" }}>{c.can_send && c.can_receive ? "" : c.can_send ? "(sends to shop only)" : "(receives from shop only)"}</span></span>
            <button className="btn btn-sm" onClick={() => run(supabase.from("rev_counterparties").update({ is_active: !c.is_active }).eq("id", c.id))}>{c.is_active ? "Hide" : "Show"}</button></div>)}
          <div className="grid gap-2 mt-2" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto" }}>
            <input className="inp" placeholder="Name" value={ncp.name} onChange={(e) => setNcp({ ...ncp, name: e.target.value })} />
            <input className="inp" placeholder="Mobile number" value={ncp.mobile_number} onChange={(e) => setNcp({ ...ncp, mobile_number: e.target.value })} />
            <button className="btn btn-sm btn-green" disabled={!ncp.name.trim()} onClick={() => run(supabase.from("rev_counterparties").insert(ncp)).then(() => setNcp({ name: "", mobile_number: "", can_send: true, can_receive: true }))}>Add</button>
          </div>
        </div>

        <div className="chart-card">
          <div className="h2">Shortage reasons</div>
          {reasons.map((r) => <div key={r.id} className="kv"><span>{r.name}</span><button className="btn btn-sm" onClick={() => run(supabase.from("rev_shortage_reasons").update({ is_active: !(r as any).is_active }).eq("id", r.id))}>{(r as any).is_active ? "Hide" : "Show"}</button></div>)}
          <div className="flex gap-2 mt-2"><input className="inp" placeholder="New reason" value={nr} onChange={(e) => setNr(e.target.value)} /><button className="btn btn-sm btn-green" disabled={!nr.trim()} onClick={() => run(supabase.from("rev_shortage_reasons").insert({ name: nr.trim(), sort_order: reasons.length + 1 })).then(() => setNr(""))}>Add</button></div>
        </div>
      </div>
    </div>
  );
}
