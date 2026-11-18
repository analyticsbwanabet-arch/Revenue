#!/usr/bin/env python3
"""
Import a BwanaBet store revenue workbook ("2026 DAILY REVENUE" tab + "STAFF ATTENDANCE" tab)
into the revenue system tables (rev_*).

The script does NOT connect to the database. It parses the workbook and writes:
  <out>.sql   one transaction that inserts every day, idempotent per branch+date range
  <out>_report.md   everything it could not parse or had to guess, for review

Usage:
  python3 import_excel.py --xlsx 2026_MTENDERE_REVENUE.xlsx --branch MTENDERE --section MAIN --out import_mtendere
  then run the SQL against Supabase (SQL editor or MCP). Add --replace to delete existing imported days in range first.

Rules (documented in the step 1 analysis):
  - A date in column A starts a day block; the block runs until the next date.
  - The night row is the row with revenue formulas in G (or labelled NIGHTSHIFT in A/C). Night M,N,O,P are the cached
    per-shift values (the workbook formula is "cumulative - day").
  - Lucky Balls K is "=in-out". Anything else (single number, extra terms) imports best-effort and flags the day.
  - Lucky 6 J is a net figure: positive -> l6_in, negative -> l6_out. Night J is cumulative-minus-day, cached value used.
  - Expenses: every S/T row in the block. Categories are guessed from keywords (see CATEGORY_RULES) and listed in the report.
  - Shortages U/V/W per row. X (recovered) is applied via rev_import_recovery().
  - AC/AD transfers, AE counterparty text, AF "NAME at HH:MM on dd/mm/yyyy".
  - AI denomination formula -> rev_cash_counts (counted the next morning = closing of the day). AJ -> counted_by / time.
  - AK/AL -> unapproved rev_adjustments (amount = -AK, i.e. an explained shortfall) for owner review.
  - AP/AQ/AR -> rev_fines.
  - STAFF ATTENDANCE tab -> rev_cashier_assignments (position assigned + float).
"""
import argparse, datetime, re, sys, json
import openpyxl

DENOMS = {500: "d500", 200: "d200", 100: "d100", 50: "d50", 20: "d20", 10: "d10", 5: "d5", 2: "d2", 1: "d1", 0.5: "d050"}

CATEGORY_RULES = [
    ("Client refreshments", r"fritter|drink|soft drink|peanut|milk|refresh"),
    ("Utilities (ZESCO, water)", r"zesco|units|water bill|electric"),
    ("Security contractor", r"mcp|star ?24|security"),
    ("Promoter wages", r"promoter"),
    ("Client refund", r"refund"),
    ("Bank / mobile money charges", r"withdraw charge|service charge|charge for|float withdraw"),
    ("Supplies (till rolls, cleaning)", r"till roll|toilet|domestos|cobra|boom|kigtox|pine gel|bloom|sprayer|fumigat|bucket|padlock|bulb|cable|socket|nail|timber|sand|gutter|thermo|rj45|data cable"),
    ("Repairs and maintenance", r"repair|servic|install|welding|labour|plumber|unclog|drilling|signal|fuel|petrol|spark plug|dstv|billboard|bilboard|penalty|flyer|printing"),
    ("Equipment purchase", r"cpu|\bram\b|wall fan|fans\b|aircon(?!.*(repair|servic))|ats\b|power switch|raspberry|genset shelter"),
    ("Transport", r"transport|yango|transpot|from .* to "),
    ("Head office payment", r"money sent to|sent to|paid .* for"),
]
COUNTERPARTY_RULES = [("Charles Eastwood", r"charles|eastwood|0963065588"), ("Bright Mwila", r"bright|mwila|0965939235")]
ROLE_MAP = {"SPORTS": "sports", "SPORT": "sports", "LUCKY BALLS": "lucky_balls", "LUCKY BALL": "lucky_balls", "LUCKY6": "lucky6", "LUCKY 6": "lucky6", "WAITRESS": "waitress"}


def q(s):
    if s is None: return "null"
    return "'" + str(s).replace("'", "''") + "'"


def money(v):
    """numeric or None (text that is not a number returns None)."""
    if v is None: return None
    if isinstance(v, (int, float)): return round(float(v), 2)
    s = str(v).strip().replace(",", "")
    if s in ("", ".", "/", "//", "-"): return None
    try: return round(float(s), 2)
    except ValueError: return None


def eval_simple(expr):
    """Evaluate a formula made of numbers, + - * only. Returns None if anything else is present."""
    e = expr.lstrip("=").replace(" ", "")
    if not re.fullmatch(r"[0-9.+\-*]+", e): return None
    try: return round(float(eval(e, {"__builtins__": {}}, {})), 2)  # safe: digits and + - * only
    except Exception: return None


def as_date(v):
    """Column A value -> date. Accepts real dates and typed text like 04/11/2026 or 04/112026."""
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    if isinstance(v, str):
        m = re.fullmatch(r"\s*(\d{1,2})\s*/\s*(\d{1,2})\s*/?\s*(\d{4})\s*", v)
        if m:
            try: return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
            except ValueError: return None
    return None


def parse_in_out(formula, cached):
    """Lucky Balls: '=in-out'. Returns (in, out, flag)."""
    if formula is None: return 0.0, 0.0, None
    if isinstance(formula, str) and formula.startswith("="):
        e = formula[1:].replace(" ", "")
        e = re.sub(r"^0-0\+", "", e)  # '=0-0+340-200' means in 340, out 200
        m = re.fullmatch(r"(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)", e)
        if m: return float(m.group(1)), float(m.group(2)), None
        m = re.fullmatch(r"(\d+(?:\.\d+)?)", e)
        if m: return float(m.group(1)), 0.0, f"single number {e}"
        # several terms (e.g. two cashiers typed as a-b+c-d): positive terms are IN, negative terms are OUT.
        # The net equals the workbook figure exactly; the split is a best reading, so the day is flagged.
        if re.fullmatch(r"[+-]?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)+", e):
            terms = re.findall(r"[+-]?\d+(?:\.\d+)?", e)
            tin = round(sum(float(t) for t in terms if not t.startswith("-")), 2)
            tout = round(sum(-float(t) for t in terms if t.startswith("-")), 2)
            return tin, tout, f"'{formula}' has {len(terms)} terms: positives summed as IN {tin}, negatives as OUT {tout}"
        v = eval_simple(formula)
        if v is not None:
            return (v, 0.0, f"could not split '{formula}', imported net {v} as IN") if v >= 0 else (0.0, -v, f"could not split '{formula}', imported net {v} as OUT")
        return 0.0, 0.0, f"unparsable '{formula}'"
    v = money(formula)
    if v is None: return 0.0, 0.0, f"non-numeric '{formula}'"
    if v >= 0: return v, 0.0, f"plain number {v} imported as IN"
    return 0.0, -v, f"plain number {v} imported as OUT"


def parse_net(cached):
    """Lucky 6 net -> (in, out)."""
    v = money(cached)
    if v is None: return 0.0, 0.0
    return (v, 0.0) if v >= 0 else (0.0, -v)


def parse_count(formula, cached):
    """AI denomination formula -> dict counts + other. Returns (dict, flag)."""
    if formula is None: return None, None
    if not (isinstance(formula, str) and formula.startswith("=")):
        v = money(formula)
        if v is None: return None, f"count cell not numeric: {formula!r}"
        return {"other_amount": v}, "count typed as a single total, no denominations"
    e = formula[1:].replace(" ", "")
    if re.search(r"[A-Za-z]", e):
        e2 = re.sub(r"[A-Z]+\d+\+?", "", e)  # drop cell refs like AJ253+
        flag = f"cell reference removed from count formula '{formula}'"
        e = e2.strip("+")
    else:
        flag = None
    counts = {v: 0 for v in DENOMS.values()}; other = 0.0; bad = []
    for term in re.split(r"\+", e):
        if term == "": continue
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\*(\d+)", term)
        if m and float(m.group(1)) in DENOMS:
            counts[DENOMS[float(m.group(1))]] += int(m.group(2)); continue
        m = re.fullmatch(r"(\d+)\*(\d+(?:\.\d+)?)", term)
        if m and float(m.group(2)) in DENOMS:
            counts[DENOMS[float(m.group(2))]] += int(m.group(1)); continue
        v = eval_simple("=" + term)
        if v is None: bad.append(term)
        else: other += v
    counts["other_amount"] = round(other, 2)
    total = round(sum(k * counts[v] for k, v in DENOMS.items()) + other, 2)
    c = money(cached)
    if bad: flag = (flag + "; " if flag else "") + f"unparsed terms {bad}"
    if c is not None and abs(total - c) > 0.01:
        flag = (flag + "; " if flag else "") + f"parsed total {total} differs from workbook value {c}"
    return counts, flag


def parse_when(text, fallback_date):
    """'... at HH:MM on dd/mm/yyyy' -> ISO timestamp (Africa/Lusaka = UTC+2)."""
    if not text: return None
    m = re.search(r"(\d{1,2}):(\d{2})\s*on\s*(\d{1,2})/(\d{1,2})/(\d{4})", str(text))
    if not m:
        m2 = re.search(r"on\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*at\s*(\d{1,2}):(\d{2})", str(text))
        if m2: hh, mm, d, mo, y = m2.group(4), m2.group(5), m2.group(1), m2.group(2), m2.group(3)
        else: return None
    else: hh, mm, d, mo, y = m.groups()
    try: return f"{y}-{int(mo):02d}-{int(d):02d}T{int(hh):02d}:{int(mm):02d}:00+02:00"
    except ValueError: return None


def names_from(text):
    """'Counted by CHRISTONE CHIBWE & SHADRICK BANDA at ...' -> ['CHRISTONE CHIBWE','SHADRICK BANDA']"""
    if not text: return []
    s = re.sub(r"(?i)counted by", "", str(text))
    s = re.split(r"(?i)\s+at\s+\d|\s+on\s+\d|\d{1,2}:\d{2}", s)[0]
    return [n.strip(" .") for n in re.split(r"&|,| and ", s) if n.strip(" .")]


def category_for(desc):
    d = (desc or "").lower()
    for name, rx in CATEGORY_RULES:
        if re.search(rx, d): return name
    return "Other"


def counterparty_for(text):
    t = (text or "").lower()
    for name, rx in COUNTERPARTY_RULES:
        if re.search(rx, t): return name
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True); ap.add_argument("--branch", required=True, help="branches.code, e.g. MTENDERE")
    ap.add_argument("--section", default="MAIN", help="rev_sections.code"); ap.add_argument("--sheet", default="2026 DAILY REVENUE")
    ap.add_argument("--attendance", default="STAFF ATTENDANCE"); ap.add_argument("--out", required=True)
    ap.add_argument("--replace", action="store_true"); ap.add_argument("--from", dest="dfrom"); ap.add_argument("--to", dest="dto")
    a = ap.parse_args()

    wf = openpyxl.load_workbook(a.xlsx)[a.sheet]
    wv = openpyxl.load_workbook(a.xlsx, data_only=True)[a.sheet]
    F = lambda r, c: wf[f"{c}{r}"].value
    V = lambda r, c: wv[f"{c}{r}"].value
    report = []; sql = []
    def rep(day, msg): report.append((day, msg))

    # ---- day blocks
    dayrows = [r for r in range(3, wv.max_row + 1) if as_date(V(r, "A")) is not None]
    textdates = [r for r in dayrows if not isinstance(V(r, "A"), datetime.datetime)]
    blocks = []
    for i, r in enumerate(dayrows):
        end = dayrows[i + 1] - 1 if i + 1 < len(dayrows) else wv.max_row
        d = as_date(V(r, "A")).isoformat()
        if a.dfrom and d < a.dfrom: continue
        if a.dto and d > a.dto: continue
        night = [x for x in range(r + 1, end + 1) if (F(x, "G") is not None and str(F(x, "G")).startswith("=")) or "NIGHT" in str(V(x, "A")).upper() or "NIGHT" in str(V(x, "C")).upper()]
        blocks.append((d, r, end, night))
    if not blocks: print("no day blocks found"); sys.exit(1)
    _seen=set(); _b=[]
    for b in blocks:
        if b[0] in _seen: continue
        _seen.add(b[0]); _b.append(b)
    blocks=_b
    dates = [b[0] for b in blocks]
    # weekday check
    for d, r, *_ in blocks:
        lab = str(V(r, "B") or "").strip().upper()[:3]
        real = datetime.date.fromisoformat(d).strftime("%a").upper()
        if lab and lab != real: rep(d, f"weekday label '{V(r,'B')}' does not match {real}")
    seen = set()
    for d in dates:
        if d in seen: rep(d, "DUPLICATE date block, second one skipped")
        seen.add(d)
    dmin, dmax = min(dates), max(dates)
    d0 = datetime.date.fromisoformat(dmin); d1 = datetime.date.fromisoformat(dmax)
    missing = [(d0 + datetime.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]
    missing = [m for m in missing if m not in seen]
    for m in missing: rep(m, "no block for this date in the workbook")

    # ---- attendance tab -> assignments per date/shift
    assign = {}  # (date, shift) -> [(name, role, float)]
    try:
        af = openpyxl.load_workbook(a.xlsx)[a.attendance]; av = openpyxl.load_workbook(a.xlsx, data_only=True)[a.attendance]
        cur = None; shift = "day"
        for r in range(2, av.max_row + 1):
            A = av[f"A{r}"].value
            if as_date(A) is not None: cur = as_date(A).isoformat(); shift = "day"
            elif A and "NIGHT" in str(A).upper(): shift = "night"
            name = av[f"D{r}"].value
            if not cur or not name: continue
            pos = str(av[f"N{r}"].value or "").strip().upper()
            if pos in ("//", "-", "/", "N/A"): pos = ""
            if "ABSENT" in str(av[f"E{r}"].value or "").upper(): continue
            fl = af[f"O{r}"].value; flv = eval_simple(fl) if isinstance(fl, str) and fl.startswith("=") else money(fl)
            if pos == "MANAGER" or pos == "":
                if pos == "" and flv: role = "other"
                else: continue
            else: role = ROLE_MAP.get(pos, "other")
            assign.setdefault((cur, shift), []).append((str(name).strip(), role, flv or 0.0))
    except KeyError:
        rep("", f"attendance sheet '{a.attendance}' not found; no cashier assignments imported")

    # ---- SQL header
    sql.append("begin;")
    sql.append(f"""do $$ declare b uuid; begin
  select id into b from branches where code = {q(a.branch)};
  if b is null then raise exception 'branch % not found', {q(a.branch)}; end if;
  if not exists (select 1 from rev_sections where branch_id = b and code = {q(a.section)}) then raise exception 'section % not found', {q(a.section)}; end if;
  if exists (select 1 from rev_days where branch_id = b and day_date between {q(dmin)} and {q(dmax)}) then
    {"delete from rev_days where branch_id = b and day_date between " + q(dmin) + " and " + q(dmax) + ";" if a.replace else "raise exception 'days already exist for this branch in range; re-run with --replace to overwrite';"}
  end if;
end $$;""")
    B = "b"; S = "s"
    emp = lambda name: f"rev_match_employee({B}, {q(name)})"
    cat = lambda name: f"(select id from rev_expense_categories where name = {q(name)})"
    cp = lambda name: f"(select id from rev_counterparties where name = {q(name)} limit 1)"

    first_day = True
    for r in textdates:
        dd = as_date(V(r, "A")).isoformat()
        if (not a.dfrom or dd >= a.dfrom) and (not a.dto or dd <= a.dto): rep(dd, f"date typed as text {V(r, 'A')!r} in A{r}, read as {dd}")
    for d, r, end, night in blocks:
        rows = range(r, end + 1)
        notes = []; flags = []
        dayid = "d"
        day_sql = []
        manager = str(V(r, "C") or "").strip()
        comments = V(r, "AN")
        if len(night) > 1: rep(d, f"more than one night row detected (rows {night}); using the first"); night = night[:1]
        if not night: rep(d, "no night row found")

        # shift entries
        entries = []
        for shift, row in (("day", r), ("night", night[0] if night else None)):
            if row is None: continue
            vals = {}
            for col, fld in (("M", "sport_tickets"), ("N", "sport_deposits"), ("O", "sport_payouts"), ("P", "sport_withdrawals")):
                v = money(V(row, col))
                if v is None and V(row, col) not in (None, ""): rep(d, f"{shift} {fld}: non-numeric cell {col}{row} = {V(row,col)!r}, imported 0")
                v = v or 0.0
                if v < 0: rep(d, f"{shift} {fld} is negative ({v}), imported as 0 - check cumulative entry"); v = 0.0
                vals[fld] = v
            lb_in, lb_out, flag = parse_in_out(F(row, "K"), V(row, "K"))
            if flag: flags.append(f"Lucky Balls {shift}: {flag}"); rep(d, f"Lucky Balls {shift}: {flag}")
            l6_in, l6_out = parse_net(V(row, "J"))
            if V(row, "J") not in (None, "", 0) and money(V(row, "J")) is None: rep(d, f"Lucky 6 {shift}: non-numeric {V(row,'J')!r}")
            vals.update(lb_in=lb_in, lb_out=lb_out, l6_in=l6_in, l6_out=l6_out)
            # sanity: cached G vs recomputed
            g = money(V(row, "G")); calc = round(vals["sport_tickets"] + vals["sport_deposits"] - vals["sport_payouts"] - vals["sport_withdrawals"] + lb_in - lb_out + l6_in - l6_out, 2)
            if g is not None and abs(g - calc) > 0.05: rep(d, f"{shift}: workbook G={g} but recomputed cash revenue={calc} (formula bug in workbook row {row})")
            entries.append((shift, vals, row))
        lb_unverified = any("Lucky Balls" in f for f in flags)

        # cash count (AI/AJ) - the count belongs to this day (taken next morning)
        cnt, cflag = parse_count(F(r, "AI"), V(r, "AI"))
        if cnt is None and night:
            cnt, cflag = parse_count(F(night[0], "AI"), V(night[0], "AI"))
        if cflag: rep(d, f"cash count: {cflag}")
        if cnt is None: rep(d, "no closing cash count on this day")
        aj = V(r, "AJ") or (V(night[0], "AJ") if night else None)
        counted_at = parse_when(aj, d); counters = names_from(aj)
        if aj and not counted_at: rep(d, f"count timestamp not parsed from {aj!r}")

        # expenses, shortages, recoveries, fines, transfers in block
        expenses = []; shortages = []; recoveries = []; fines = []; transfers = []; adjustments = []
        for x in rows:
            s = money(V(x, "S")); t = V(x, "T")
            if V(x, "S") not in (None, "") and s is None: rep(d, f"expense amount not numeric at S{x}: {V(x,'S')!r}")
            if s:
                desc = str(t or "").strip() or "(no description)"
                if re.search(r"advance", desc, re.I):
                    m = re.match(r"(.+?)'?s?\s+advance", desc, re.I)
                    who = m.group(1).strip() if m else desc
                    shortages.append(("ADVANCE", who, s, desc)); rep(d, f"'{desc}' K{s} imported as a staff advance for '{who}'")
                else:
                    c = category_for(desc); expenses.append((c, desc, s))
                    if c == "Other": rep(d, f"expense '{desc}' K{s} categorised as Other")
            u = money(V(x, "U")); vname = V(x, "V"); w = V(x, "W"); xr = money(V(x, "X"))
            if u: shortages.append(("SHORT", str(vname or "").strip(), u, str(w or "").strip()))
            if V(x, "U") not in (None, "") and u is None: rep(d, f"shortage amount not numeric at U{x}: {V(x,'U')!r}")
            if xr: recoveries.append((str(vname or "").strip(), xr))
            if V(x, "X") not in (None, "", ".") and xr is None: rep(d, f"recovered amount not numeric at X{x}: {V(x,'X')!r}")
            if V(x, "Y") not in (None, ""): rep(d, f"column Y (company expense) has a value {V(x,'Y')!r}, not imported")
            z = money(V(x, "Z"))
            if z: shortages.append(("ADVANCE", str(V(x, "AA") or "").strip(), z, "workbook advance column"))
            ac = money(V(x, "AC")); ad = money(V(x, "AD")); ae = V(x, "AE"); af = V(x, "AF")
            if ac: transfers.append(("sent", ac, ae, af))
            if ad: transfers.append(("received", ad, ae, af))
            ak = money(V(x, "AK"))
            if ak: adjustments.append((ak, str(V(x, "AL") or "").strip()))
            ap_ = money(V(x, "AP"))
            if ap_: fines.append((str(V(x, "AQ") or "").strip(), ap_, str(V(x, "AR") or "").strip() or "Fine (workbook)"))
            # junk markers in numeric cells
            for col in ("E", "G", "H", "J", "K", "M", "R"):
                if V(x, col) in (".", "/", " "): rep(d, f"junk text {V(x,col)!r} in {col}{x} ignored")

        # ---- emit SQL for the day
        status = "submitted" if cnt is not None else "open"
        note = "Imported from Excel workbook." + (" " + " ".join(flags) if flags else "") + (f" General comments: {comments}" if comments else "")
        day_sql.append(f"insert into rev_days (branch_id, day_date, status, notes, lucky_balls_unverified, created_by, submitted_by, submitted_at) values ({B}, {q(d)}, {q(status)}, {q(note)}, {str(bool(lb_unverified)).lower()}, 'excel-import', {"'excel-import', now()" if status == "submitted" else "null, null"}) returning id into d;")
        for shift, vals, row in entries:
            cols = ", ".join(vals.keys()); vs = ", ".join(str(round(v, 2)) for v in vals.values())
            day_sql.append(f"insert into rev_shift_entries (day_id, section_id, shift, manager_employee_id, {cols}, created_by) values ({dayid}, {S}, {q(shift)}, {emp(manager) if manager else 'null'}, {vs}, 'excel-import') returning id into e;")
            for name, role, fl in assign.get((d, shift), []):
                day_sql.append(f"perform rev_imp_assign(e, b, {q(name)}, {q(role)}, {round(fl,2)}, {q(d)}, {q(shift)});")
        for c, desc, s in expenses:
            day_sql.append(f"perform rev_imp_expense(d, {q(c)}, {q(desc)}, {s});")
        for kind, who, amt, text in shortages:
            if kind == "SHORT":
                day_sql.append(f"insert into rev_shortages (day_id, branch_id, employee_id, employee_text, shortage_date, amount, reason_id, note, created_by) values ({dayid}, {B}, {emp(who)}, {q(who)}, {q(d)}, {amt}, (select id from rev_shortage_reasons where lower(name) = lower({q(text)}) limit 1), {q(text or None)}, 'excel-import');")
            else:
                day_sql.append(f"insert into rev_advances (day_id, branch_id, employee_id, advance_date, amount, note, created_by) select {dayid}, {B}, {emp(who)}, {q(d)}, {amt}, {q(text)}, 'excel-import' where {emp(who)} is not null;")
                day_sql.append(f"insert into rev_expenses (day_id, category_id, description, amount, entered_by) select {dayid}, {cat('Other')}, {q('UNMATCHED ADVANCE: ' + text)}, {amt}, 'excel-import' where {emp(who)} is null;")
        for who, amt in recoveries:
            day_sql.append(f"perform rev_import_recovery({dayid}, {B}, {emp(who)}, {q(who)}, {amt});")
        for direction, amt, ae, af in transfers:
            cpn = counterparty_for(ae); when = parse_when(af, d)
            mob = re.search(r"0\d{9}|\+260\d{9}", str(ae or "")); mob = mob.group(0) if mob else None
            by = None
            m = re.match(r"\s*([A-Za-z ]+?)\s+(?:at|on)\s", str(af or "")); by = m.group(1).strip() if m else None
            if not cpn: rep(d, f"transfer {direction} K{amt}: counterparty not recognised in {ae!r}, kept as text")
            day_sql.append(f"insert into rev_cash_transfers (day_id, direction, amount, counterparty_id, counterparty_text, mobile_number, done_by_employee_id, done_at, created_by) values ({dayid}, {q(direction)}, {amt}, {cp(cpn) if cpn else 'null'}, {q(ae)}, {q(mob)}, {emp(by) if by else 'null'}, {q(when)}, 'excel-import');")
        for who, amt, reason in fines:
            day_sql.append(f"perform rev_imp_fine(d, b, {q(who)}, {q(d)}, {amt}, {q(reason)});")
        for amt, why in adjustments:
            day_sql.append(f"insert into rev_adjustments (day_id, amount, reason, note, created_by) values ({dayid}, {-amt}, 'import', {q('Workbook AK/AL: ' + str(amt) + ' ' + why)}, 'excel-import');")
            rep(d, f"AK shortage/overage K{amt} '{why}' imported as an UNAPPROVED adjustment of {-amt} for owner review")
        if cnt is not None:
            cols = ", ".join(cnt.keys()); vs = ", ".join(str(v) for v in cnt.values())
            cby = emp(counters[0]) if counters else "null"; wit = emp(counters[1]) if len(counters) > 1 else "null"
            day_sql.append(f"insert into rev_cash_counts (day_id, counted_at, counted_by_employee_id, witness_employee_id, counted_by_text, {cols}, created_by) values ({dayid}, {q(counted_at)}, {cby}, {wit}, {q(aj)}, {vs}, 'excel-import');")
        if first_day:
            # back-calculate the opening cash so the first imported day reconciles to zero
            day_sql.append(f"""update rev_days set opening_cash_override = (
                select s.counted_closing - (s.cash_revenue - s.expenses - s.sent + s.received - s.shortages + s.repaid - s.advances + s.adjustments)
                from rev_day_summary s where s.id = {dayid}), opening_cash_override_note = 'Back-calculated at import (no earlier day available)'
              where id = {dayid} and exists (select 1 from rev_cash_counts c where c.day_id = {dayid})
                and not exists (select 1 from rev_days p join rev_cash_counts pc on pc.day_id = p.id where p.branch_id = b and p.day_date < {q(d)});""")
            first_day = False
        sql.append(f"do $$ declare b uuid := (select id from branches where code = {q(a.branch)}); s uuid := (select id from rev_sections x where x.branch_id = (select id from branches where code = {q(a.branch)}) and x.code = {q(a.section)}); d uuid; e uuid; begin\n" + "\n".join(day_sql) + "\nend $$;")
    sql.append("commit;")

    with open(a.out + ".sql", "w") as f: f.write("\n".join(sql) + "\n")
    with open(a.out + "_report.md", "w") as f:
        f.write(f"# Import report: {a.xlsx} -> {a.branch}/{a.section}\n\n{len(blocks)} day blocks, {dmin} to {dmax}, {len(missing)} missing dates.\n\n")
        f.write("Items below need a human look. Lines marked Lucky Balls set the day's 'lucky_balls_unverified' flag.\n\n| Date | Note |\n|---|---|\n")
        for d, m in sorted(report, key=lambda x: x[0]): f.write(f"| {d} | {m.replace('|', '/')} |\n")
        f.write("\nUnmatched staff names (cashier assignments and fines that could not be linked) are written to rev_audit_log with table_name = 'import_unmatched'.\n")
    print(f"wrote {a.out}.sql ({len(sql)} statements) and {a.out}_report.md ({len(report)} notes)")


if __name__ == "__main__":
    main()
