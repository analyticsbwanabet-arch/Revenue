export const fmtK = (n: number | string | null | undefined) =>
  `K${Number(n || 0).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtSigned = (n: number | string | null | undefined) => {
  const v = Number(n || 0);
  return (v < 0 ? "-" : v > 0 ? "+" : "") + fmtK(Math.abs(v));
};

/** ISO (yyyy-mm-dd) to dd/mm/yyyy */
export const dmy = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const todayIso = () => {
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const weekday = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }).toUpperCase();

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return new Date(Date.UTC(+y, +m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const num = (v: any) => {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

export const DENOMS: { key: string; value: number; label: string }[] = [
  { key: "d500", value: 500, label: "K500" },
  { key: "d200", value: 200, label: "K200" },
  { key: "d100", value: 100, label: "K100" },
  { key: "d50", value: 50, label: "K50" },
  { key: "d20", value: 20, label: "K20" },
  { key: "d10", value: 10, label: "K10" },
  { key: "d5", value: 5, label: "K5" },
  { key: "d2", value: 2, label: "K2" },
  { key: "d1", value: 1, label: "K1" },
  { key: "d050", value: 0.5, label: "50n" },
];

export const COUNTER_ROLES = [
  { value: "sports", label: "Sports" },
  { value: "lucky_balls", label: "Lucky Balls" },
  { value: "lucky6", label: "Lucky 6" },
  { value: "waitress", label: "Waitress" },
  { value: "other", label: "Other" },
];

const TZ = "Africa/Lusaka";
/** ISO timestamp -> HH:MM in Lusaka time */
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "";
/** ISO timestamp -> dd/mm/yyyy HH:MM in Lusaka time */
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ }) : "";
/** ISO timestamp -> value for <input type=datetime-local> expressed in Lusaka time */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value || "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
};
/** datetime-local value (Lusaka time, UTC+2, no DST) -> ISO */
export const fromLocalInput = (v: string) => (v ? new Date(v + ":00+02:00").toISOString() : null);
