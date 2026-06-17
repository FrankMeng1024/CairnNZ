# ADR-008: feature-flags route is unauthenticated public read + HARD_DEFAULTS fail-closed

## Context
v0.2.5 Phase 0.15 introduced two coupled artifacts:
- backend `/api/feature-flags` (read-only public route)
- RN `featureFlagsClient` with `HARD_DEFAULTS` for offline / outage paths

Round-2 review (#0-4) flagged 3 concerns:

1. **No ADR for unauthenticated public read** — flag values exposed to anonymous
   internet; future flags could legitimately be private.
2. **No LIMIT on SELECT** — at 10k rows, every boot streams 100KB+ unauth payload;
   amplification abuse vector.
3. **HARD_DEFAULTS.useV025='true' is fail-OPEN** — if backend is unreachable on
   first launch (DNS/TLS/firewall/outage), every user is silently force-promoted
   to the unproven v025 path with no kill switch.

## Decision

### A. Unauthenticated read = INTENTIONAL
- Flag values must be readable BEFORE sign-in (the very purpose of a kill switch
  is to render the right UI path on launch, including the auth screen)
- Therefore the endpoint is and remains anonymous.
- **Counter-rule**: any flag whose value must be private (e.g.
  `experimental_paymentRouting=stripe_v2`, `internal_betaUserList`) MUST go in a
  separate table + authed route. Do NOT add private flags to `feature_flags`.
- No ADR amendment needed when adding new public flags. New ADR required when
  introducing the first private-flag table.

### B. SELECT LIMIT = 1000
- Hard ceiling on row count returned per request.
- 1KB per row * 1000 rows = ~1MB body — bounded, not abusive.
- If we ever legitimately need >1000 public flags, split by category instead of
  raising the limit (`feature_flags_general` / `feature_flags_visual` etc.).

### C. HARD_DEFAULTS = fail-CLOSED
- `useV025` HARD_DEFAULTS = **'false'** (was 'true' in initial Phase 0.15 commit).
- Reasoning:
  - Backend default IS still `'true'` in 015b_feature_flags.sql, so a successful
    boot fetch flips the flag on within ~1s of first launch.
  - AsyncStorage cache persists, so subsequent boots remain on v025 even offline.
  - The ONLY scenario where HARD_DEFAULTS is read is "device has never had a
    successful fetch + has no cache" — a brand-new install on a broken network.
    In that scenario we'd rather render Legacy (proven) than V2 (Phase 0 stub
    delegating to Legacy anyway, but Phase 1A+ this matters).
- **One-way ratchet**: once cache is populated with `useV025='true'`, the client
  never reverts to HARD_DEFAULTS unless AsyncStorage is wiped (uninstall/reinstall).
- This is a true emergency stop: setting `feature_flags.useV025='false'` server-side
  AND triggering a remote logout / cache invalidation rolls every active user back
  to Legacy on next boot.

### D. ADR review trigger for flipping HARD_DEFAULTS to 'true'
After Phase 1A canary (≥7 days, <0.1% crash delta vs Legacy on real EAS build),
this ADR may be amended to flip HARD_DEFAULTS.useV025 = 'true' for "fail-open after
proven path". Until then: fail-closed.

## Consequences
- (+) Outage at first-boot does not promote users to v025 unsafely.
- (+) LIMIT prevents unauth amplification abuse.
- (+) Unauthenticated read documented + bounded.
- (-) New users on a broken network get Legacy at first launch; once network
  works the next boot fetches v025=true and ratchets forward. Acceptable.
- (-) Anyone scraping /api/feature-flags can learn current rollout posture.
  This is ALREADY true via app inspection; no incremental risk.

## Failure modes
- Migration 015b not run on a new env → /api/feature-flags returns 500
  (`ER_NO_SUCH_TABLE`) → client falls back to HARD_DEFAULTS = useV025=false →
  user sees Legacy. Recoverable: ops runs migration, next boot ratchets forward.
- Backend deploys a bug that returns `useV025: 'wrong'` (non-boolean string) →
  client `isFlagEnabled('useV025')` returns false (only 'true' or '1' enable) →
  user sees Legacy. Conservative; matches kill-switch intent.

## Expiration phase
Phase 5 canary signoff (re-evaluate HARD_DEFAULTS flip after real-device 7-day canary).

## Status
renewed (2026-06-17 final-review: rate limit + LIMIT 1000 + fail-closed all shipped Phase 0; Phase 5 re-evaluates flip)

## Signoff
- Main agent: 2026-06-17
- User review pending
