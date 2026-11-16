"use client";
import type { Employee } from "@/lib/types";

export default function EmployeeSelect({ employees, value, onChange, disabled, placeholder = "Select staff", className = "inp" }: {
  employees: Employee[]; value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; placeholder?: string; className?: string;
}) {
  return (
    <select className={className} value={value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      <option value="">{placeholder}</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>{e.full_name}{e.position ? ` (${e.position.replace(/_/g, " ")})` : ""}</option>
      ))}
    </select>
  );
}
