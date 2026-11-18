"use client";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

/** 24-hour time picker (HH:MM). Value is "" or "HH:MM". */
export default function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [h, m] = value ? value.split(":") : ["", ""];
  return (
    <div className="flex items-center gap-1">
      <select className="inp" aria-label="Hour" value={h} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? "" : `${e.target.value}:${m || "00"}`)}>
        <option value="">HH</option>{HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span style={{ color: "#6b7280" }}>:</span>
      <select className="inp" aria-label="Minute" value={m} disabled={disabled || h === ""} onChange={(e) => onChange(`${h}:${e.target.value || "00"}`)}>
        <option value="">MM</option>{MINUTES.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}
