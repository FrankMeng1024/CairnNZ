# Revision 03 decisions

- 2026-09-18: Use one product-code writer and preserve the pre-existing dirty working tree.
- 2026-09-18: Use task-start Git tree `f40b740bddbf2c67cf9362512cf945c38f0965a8` as the exact diff authority.
- 2026-09-18: Keep Home marker O60 unless a validated owner-testable candidate is produced; never publish OTA in this task.
- 2026-09-18: Do not perform test-data cleanup until the exact environment, schema, account/table scope, backup, and writer fence are established. Independent code/test work proceeds first.
