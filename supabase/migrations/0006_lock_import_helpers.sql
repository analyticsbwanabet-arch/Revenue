-- Import helpers write rows without checking the caller. Only the database owner (SQL editor / migrations) may call them.
revoke execute on function rev_imp_assign(uuid, uuid, text, text, numeric, date, text) from public, anon, authenticated;
revoke execute on function rev_imp_expense(uuid, text, text, numeric) from public, anon, authenticated;
revoke execute on function rev_imp_fine(uuid, uuid, text, date, numeric, text) from public, anon, authenticated;
revoke execute on function rev_import_recovery(uuid, uuid, uuid, text, numeric) from public, anon, authenticated;
revoke execute on function rev_match_employee(uuid, text) from public, anon, authenticated;
