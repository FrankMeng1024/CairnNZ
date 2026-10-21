# E04 — exact-final test and source authority

## Authority

- Executable source SHA: `c3b765e0c8bc5f1b16c1e72f0eefdcd9a954434d`.
- Fingerprint: `eb55a87b4a846259be65d91fb9622501a643af5d794104174330d29012eed362`, 991 files across `app/src`, `app/scripts`, both app manifests/lockfiles, `backend/src`, `backend/scripts`, and both backend manifests/lockfiles.
- The worktree was clean before review-document authoring. Review documents are outside the fingerprint scope.

## Exact-final results

| Gate | Result | Notes |
| --- | --- | --- |
| App full Jest | 246/246 suites; 2,416 pass, 4 skip, 0 fail | 2,420 total; retained Jest force-exit/open-handle warning |
| Backend Node test | 205/205 pass | 0 fail/skip |
| Activity full | 2,653/2,657 | client 2,416/2,420; server 191/191; static 46/46; four intentional skips |
| Activity changed scope | 637/637 | Run after the Web adapter correction |
| Mapbox adapter focused | 3/3 suites, 10/10 tests | Legacy entry, Web shape and Cairn pin actions |
| E01 MySQL | 81/81 checks | Three modes × 27; disposable MySQL 8.0.36 |
| Public API/MySQL | 21/21 | 70 publications, 11 encounters, one thanks row and report |
| Memory API/MySQL | 35/35 | Includes 1,005 found + 1,005 left, unique stable UTC cursor under Shanghai timezone |
| Personal/Friends API/MySQL | 26/26 | Real isolated auth/authorization lock race and revocation |
| Connected UI/API/MySQL | 7/7 | Actual Expo Web screens with real login/API/MySQL; one acquired/opened/thanked/presented and one retained revision |
| TypeScript comparison | 159 inherited, 0 new | Exact same command/output set as baseline |
| node-cron v4 | PASS | Six production registrations; execution/no-overlap/stop/destroy/shutdown |

The connected trace used isolated author `2`, viewer `3` and operator `4`; Plant created marker/publication `1`, the protected operator decision approved revision 1, a separate authorized viewer acquired/opened/thanked revision 1, the author updated then withdrew, and the retained viewer copy remained readable after withdrawal and offline browser reconstruction. IDs are disposable isolated-schema identities, not production accounts.

Public invalid/nonfriend/duplicate/security cases are covered by the 21-check Public harness, QA expiry/legacy authorization by the 35-check Memory harness, and the dedicated E01 negative matrix. Browser pedestrian journeys are simulated and labelled; no physical GPS claim is made.

## Visual/source identity

The exact-final core capture ran source `c3b765e…` and the same fingerprint. Found Detail's dedicated 24-state matrix/video was created at implementation SHA `863acbc…`; its screen Git object is byte-identical at `c3b765e…`. The only later executable change was the Web Mapbox import plus its test, and the affected Mapbox routes were rerun.

## Pending, not failed

- Native iOS/Android Mapbox rendering and build compatibility.
- Physical GPS, locked/background Activity telemetry and real pedestrian arrival.
- VoiceOver, Dynamic Type, haptics, native keyboard and frame timing.
- Hike/Run integrated resolution and combined regression.
- Production deployment, production schema/data verification, Shanghai fixtures, EAS Build, OTA/TestFlight and release authorization.

No production/shared database, account, fixture or service was touched. Only positively identified new local QA containers/anonymous volumes were removed.
