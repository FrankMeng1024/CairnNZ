# ADR-009: backend migration runner DB allowlist

## Context
v0.2.5 Phase 0.13 introduced `backend/scripts/run-migration.js` to apply schema
migrations against the configured DB.

Round-1 review (#0-1 MEDIUM) flagged that the runner reads `process.env.DB_NAME`
via dotenv and does NOT validate it before issuing destructive `DELETE` /
`ALTER TABLE` statements (specifically migration 015 wipes all `markers` rows).

Main agent fix: `assertSafeDb()` allowlist of `['cairn', 'cairn_dev', 'cairn_test',
'cairn_staging']`.

Round-2 review (#0-4 MEDIUM) flagged that the allowlist is hardcoded with no ADR
and no env override path; a future production rename or new shard name would fail
silently to the operator.

## Decision

### A. Allowlist is hardcoded in code, not config
- The allowlist of acceptable DB_NAME values is a **safety check**, not a config.
  Config files can be edited to bypass; code requires a code review.
- Adding a new DB to the allowlist requires:
  1. PR that touches `backend/scripts/run-migration.js:ALLOWED_DB_NAMES`
  2. PR description naming the new DB and what it is (e.g. "shard-eu-west")
  3. This ADR amended to record the addition

### B. Hard fail with explicit error, not silent skip
- `assertSafeDb()` THROWS when `DB_NAME` is not in the allowlist. The runner exits
  non-zero with the offending name printed. Operator MUST update the allowlist
  before re-running.

### C. Why NOT an env override (`MIGRATION_ALLOW_DB`)
- An env override defeats the purpose: an attacker (or accidental config) with
  shell access could `MIGRATION_ALLOW_DB=cairn_prod node run-migration.js apply
  some_destructive.sql`. Forcing a code change keeps the safety check honest.

### D. Initial allowlist (as of 2026-06-17)
- `cairn` — primary aliyun database (production data)
- `cairn_dev` — local dev
- `cairn_test` — automated test runs
- `cairn_staging` — pre-prod stage

(Note: `cairn` is in the list because the project IS in pre-launch / closed-beta
where 015 destructive migration is intentional. After Phase 7 GA, `cairn` MUST
be removed from this allowlist; new migrations will go via ALTER ONLY.)

## Consequences
- (+) Hard ceiling on which DBs a migration can run against.
- (+) ADR records every future addition / removal.
- (-) Adding a shard requires a PR, not just an env var. Acceptable for a kill
  switch.

## Failure modes
- Allowlist drifts from reality (someone renames `cairn_test` → `cairn_qa` and
  forgets to update the allowlist) → `assertSafeDb` throws → operator updates →
  PR merge re-enables. Visible failure, not silent.

## Expiration phase
Phase 7 (post-GA `cairn` removal trigger)

## Status
active

## Signoff
- Main agent: 2026-06-17
- User review pending
