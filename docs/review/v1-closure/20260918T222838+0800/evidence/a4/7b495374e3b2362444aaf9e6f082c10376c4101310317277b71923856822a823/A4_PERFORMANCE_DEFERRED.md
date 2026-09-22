# A4 current-fingerprint performance disposition

Recorded: `2026-09-20T15:58:40+08:00`

Verdict: **PERFORMANCE_DEFERRED_ENVIRONMENT/HARNESS / UNVERIFIED**. Product
fingerprint
`7b495374e3b2362444aaf9e6f082c10376c4101310317277b71923856822a823`
(643 files) remains unchanged. The retained 10,000-point
`tile_geometry=162 ms` result against the frozen `<150 ms` ceiling is the
controlling **FAIL/HOLD**. There was no retry to green, threshold/radius/truth
change, history reduction, or deferral of live work to Finish.

Controlling command: `cd app && npm run verify:changed`. Complete log:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/verify-changed-7b495374-f2-owner-activity-boundary-20260920T145930+0800.log`,
SHA-256
`6475c2c1890c6f80efea0c4579e7aed8375c42970077e128932dfa992c38040d`.
Result: exit 1, 123/124 suites and 1,170/1,174 tests passed; 10k total
69,124.3 ms; slowest slice tile `174786|-41282`, 162 ms.

The failing tile contains 18 points, as do 1,032/1,890 output tiles. Earlier
failures moved among other 14-18-point tiles. The current benchmark and lock
hashes match the prior profiles, while the exact current circle and
clipped-tile hot-path spans are byte-identical to the earlier standard PASS.
This makes a deterministic code/dependency regression unlikely but does not
prove whether the interval was GC, allocation, or scheduler interruption.

The approved six-case phase/allocation/GC diagnostic did not produce valid
benchmark evidence: first a zero-test external module-resolution boot
failure; then a wrapper lost Turf's non-enumerable `__esModule` and exercised
circle but no union, returning null Fog geometry; finally the corrected,
fail-sensitive preflight was outside Jest's app root and collected zero
tests. The explicit stop rule then applied. No product optimization is
demonstrated or authorized.

Full diagnostic narrative, exact commands, dependency/span hashes, process
audits, and invalid artifact hashes:
`/Users/mzm/Desktop/cairn_revision03_work/evidence/a4/7b495374e3b2362444aaf9e6f082c10376c4101310317277b71923856822a823/slice-diagnostic/DIAGNOSTIC_DISPOSITION.md`,
SHA-256
`0f5156e0caf6d0687cddb97aa6f24bd8446e266d96ed27854471f34c7d0c38c9`.

No product, benchmark, dependency, lockfile, F1/F2 harness, backend,
database, deployment, OTA, version marker, supervision hook, radius,
geometry truth, gap/history, or live-before-Finish behavior changed. No
owned process or heavy token remained when this disposition was recorded.
