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
