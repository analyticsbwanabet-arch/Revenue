# Import report: ../wb/mtendere.xlsx -> MTENDERE/MAIN

64 day blocks, 2026-09-01 to 2026-11-03, 0 missing dates.

Items below need a human look. Lines marked Lucky Balls set the day's 'lucky_balls_unverified' flag.

| Date | Note |
|---|---|
| 2026-09-01 | Lucky Balls day: plain number -1141.4 imported as OUT |
| 2026-09-01 | Lucky Balls night: plain number 8.0 imported as IN |
| 2026-09-01 | cash count: count typed as a single total, no denominations |
| 2026-09-04 | junk text '/' in J23 ignored |
| 2026-09-05 | AK shortage/overage K108.92 'i cant seem to find where the excess k109 is coming from' imported as an UNAPPROVED adjustment of -108.92 for owner review |
| 2026-09-11 | junk text '.' in K46 ignored |
| 2026-09-15 | Lucky Balls day: single number 444 |
| 2026-09-18 | Lucky Balls night: single number 0 |
| 2026-09-18 | 'matidah mwanza's advance' K500.0 imported as a staff advance for 'matidah mwanza' |
| 2026-09-21 | day: workbook G=1108.6 but recomputed cash revenue=718.6 (formula bug in workbook row 83) |
| 2026-09-22 | count timestamp not parsed from 'Counted by CHRISTONE CHIBWE & shadreck banda at 08:48 on 2109/2026' |
| 2026-09-24 | Lucky Balls day: single number 0 |
| 2026-09-29 | junk text '.' in M123 ignored |
| 2026-10-05 | expense 'Purchased a drnk for a vip client' K12.0 categorised as Other |
| 2026-10-08 | Lucky Balls day: single number 71 |
| 2026-10-15 | weekday label 'WED' does not match THU |
| 2026-10-15 | junk text '.' in R196 ignored |
| 2026-10-16 | weekday label 'THUR' does not match FRI |
| 2026-10-25 | junk text '.' in H235 ignored |
| 2026-10-26 | junk text '.' in E239 ignored |
| 2026-10-26 | expense 'Two failed reprints of k32 each on lucky balls where IT was inspecting' K64.0 categorised as Other |
| 2026-10-28 | Lucky Balls day: extra terms '+4356' dropped from '=377-372+4356' |
| 2026-10-28 | day: workbook G=7418.11 but recomputed cash revenue=3062.11 (formula bug in workbook row 251) |
| 2026-10-28 | cash count: cell reference removed from count formula '=AJ253+200*7+100*15+50*10+20*43+10*51+2*3+300+1908' |
| 2026-10-28 | AK shortage/overage K4784.0 'Multiple trial lucky balls tickets printed' imported as an UNAPPROVED adjustment of -4784.0 for owner review |
| 2026-10-30 | Lucky Balls day: extra terms '+5' dropped from '=326.8-1000+5' |
| 2026-10-30 | day: workbook G=1953.8 but recomputed cash revenue=1948.8 (formula bug in workbook row 258) |
| 2026-10-30 | Lucky Balls night: extra terms '+30' dropped from '=46-306+30' |
| 2026-10-30 | night: workbook G=2040.0 but recomputed cash revenue=2010.0 (formula bug in workbook row 260) |
| 2026-10-31 | Lucky Balls day: could not split '=200+216', imported net 416.0 as IN |
| 2026-11-01 | Lucky Balls day: could not split '=4+205', imported net 209.0 as IN |
| 2026-11-03 | no closing cash count on this day |

Unmatched staff names (cashier assignments and fines that could not be linked) are written to rev_audit_log with table_name = 'import_unmatched'.
