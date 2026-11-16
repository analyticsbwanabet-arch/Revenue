# BwanaBet Daily Revenue System

Replaces the "Daily Revenue" tab of the per-store Excel workbooks. Sits alongside the Payroll system and shares its Supabase project (branches, employees, logins, daily_logs).

## Stack
Next.js 14 (App Router, TypeScript), Supabase (Postgres, auth, RLS, SQL views and functions), Vercel.

## Pages
- `/entry` Daily Entry (managers): per section and shift figures, cashiers on duty, expenses, cash sent/received, shortages, advances, fines, closing denomination count, live reconciliation, submit.
- `/calendar` Daily Summary per store: month grid with net, variance, missing days, plus a day table.
- `/monthly` Monthly Summary (owner): per store, per section/shift, Lucky Balls In/Out/Balance, shortages by cashier, expenses by category, all days, Excel export.
- `/sync` Payroll sync: pushes shortages, advances and fines into payroll `daily_logs`, or exports a CSV in that shape.
- `/manage` (owner): settings (variance threshold, edit window), edit windows, sections, expense categories, counterparties, shortage reasons, pending adjustments.

## Database
All tables are prefixed `rev_` (see `supabase/migrations`). Key derived view: `rev_day_summary`.

```
expected_closing = opening_cash + cash_revenue - expenses - sent + received - shortages + repaid - advances + adjustments
variance         = counted_closing - expected_closing
```
`opening_cash` is the previous day's counted closing (or the owner's override). Every figure is a sum of child rows, each audited in `rev_audit_log`.

Access: managers see and edit their own branch for today and yesterday (`edit_window_days` = 1, same as payroll); the owner sees and edits everything and can open edit windows. RLS enforces this in the database, not only in the UI.

## Excel import
`python3 scripts/import_excel.py --xlsx <workbook> --branch MTENDERE --section MAIN --out import_mtendere` writes `import_mtendere.sql` and `import_mtendere_report.md`. Run the SQL in the Supabase SQL editor as the owner. Re-run with `--replace` to overwrite a range. The report lists every guess and unparsed cell. Days where Lucky Balls could not be split into In and Out are flagged `lucky_balls_unverified`.

## Environment
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```
