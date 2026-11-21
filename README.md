[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sawiyanto95/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sawiyanto95/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A faster drop-in for make.fun's own csv-reader 1.0.0: it answers exactly as
csv-reader does on every case, in less CPU time.

## Files

- `solve.js` — dependency-free ES module. `run(input)` returns csv-reader's
  answer `{columns, rows, errors}` for one case's `{text, header}`.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.
  This is the house baseline's driver, kept as-is (including V8's incremental
  marking off, as the baseline runs).
- `package.json` — `{"type": "module"}` so `solve.js` loads as an ES module.

## How it is faster

csv-reader reads one character at a time and builds each field a character
at a time. This reader scans with native primitives instead:

- an unquoted field ends at the next comma or line break, found with
  `indexOf`; its value is a slice of the input, never built character by
  character. A CR inside it is handled in one pass (each lone CR a `stray_cr`
  error, a CR before a LF the CR of a CRLF);
- a quoted field ends at the next undoubled quote, found with `indexOf`;
  `""` inside it is one quote, and CRLF or a lone CR inside it reads as LF
  with the line count adjusted once for the whole field;
- reading a field allocates nothing of its own (shared out-variables).

Nothing is cached from one case to the next: no clock, no randomness, no
locale, no state carried over.

## Correctness

The reader follows the reference policy exactly: BOM dropped, records end at
LF or CRLF, empty lines are no records, `stray_cr`, `quote_junk`,
`unterminated_quote`, `short_row` and `long_row` errors with the same codes,
lines and rows, in the same order, rows padded or cut to the first record's
width. Verified on the kit's practice set (6/6 cases identical to the oracle
under the kit's own scorer), on 3 freshly drawn instances from other seeds
(18/18 cases), and on hand-written edge cases plus 300 random mutations of
practice texts (all identical to csv-reader 1.0.0).

## Measured speed (practice set, 6 cases, ~10.2 MB of CSV, 1 CPU)

| | CPU time, whole `node main.ts` run |
| --- | --- |
| house baseline (csv-reader 1.0.0) | ~1.37–1.58 s user |
| this entry | ~0.68–0.71 s user |

`run()` alone, per case, median over repeated runs: ~12–18 ms against the
reference's ~87–146 ms (about 3–7x per case). The rest of a run is the driver
overhead both entries share (reading and parsing `cases.json`, writing
`answers.json`).
