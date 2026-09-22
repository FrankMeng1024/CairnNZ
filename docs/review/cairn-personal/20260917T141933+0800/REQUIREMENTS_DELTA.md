# CARD-CAIRN-01 requirements delta

Run ID: `20260917T141933+0800`

This is a scoped delta to the existing requirements register. It does not create a competing requirements system. Status axes are intentionally independent.

| Requirement | Original capability | Candidate result | Automated proof | Visual proof | Backend deployed | Device loaded | Owner accepted |
|---|---|---|---|---|---|---|---|
| `RQ-CAIRN-001` Preserve full Plant creation | `CAIRN-01` | Preserved; no creation-flow redesign | PASS — Plant/title-body and offline regressions | `CAIRN-VIS-003` current-source Plant reference | Not required for preserved client flow | UNVERIFIED | PENDING |
| `RQ-CAIRN-002` Preserve Quick Cairn and Activity provenance | `CAIRN-02` | Preserved; empty content remains valid; explicit provenance only | PASS — identity/content/offline/Activity regression | `CAIRN-VIS-004`, `005`, `014` | Not required for local create; replay enhancement not deployed | UNVERIFIED | PENDING |
| `RQ-CAIRN-003` One stable identity across entries | `CAIRN-02`, `ACT-02`, `MEM-02` | IMPLEMENTED CANDIDATE — local/server aliases, dedupe, owner guards, tombstones | PASS — fast acknowledgement, account switch, late response, merge tests | Required flow in `capture-results.json`; `CAIRN-VIS-004` to `008`, `013` | Create-replay convergence not deployed | UNVERIFIED | PENDING |
| `RQ-CAIRN-004` Authoritative Own Detail/edit/delete | `CAIRN-03` | IMPLEMENTED CANDIDATE — one Detail, supported content edit, secondary non-cascade delete | PASS — content, mutation, tombstone and navigation contracts | `CAIRN-VIS-005`, `006`, `011`-`016`, `019`, `020` | Existing mutation routes assumed; additive replay patch not deployed | UNVERIFIED | PENDING |
| `RQ-CAIRN-005` Truthful mutation boundaries | `CAIRN-03`, `OFFLINE-02` | IMPLEMENTED CANDIDATE — pending durability, synced acknowledgement, retained failure draft, real retry | PASS — offline revision, fast ack, update/delete success/failure tests | `CAIRN-VIS-006`, `008`, `014`, `015`, `016` | Partial: new replay path not deployed | UNVERIFIED | PENDING |
| `RQ-CAIRN-006` Minimal personal All Cairns entry/index | `CAIRN-04`, `MEM-02` | TASK-AUTHORIZED IMPLEMENTED CANDIDATE — normal Memory entry, own-only list, search, pagination, honest old-server fallback | PASS — owner-only retrieval, scope, pagination, navigation and UI contracts | `CAIRN-VIS-007`-`010`, `013`, `017`, `018`; three boards | **NO** — full remote history/search requires owner-library endpoint deployment | UNVERIFIED | PENDING |
| `RQ-CAIRN-007` Non-owner/Public Cairn Detail | `CAIRN-05` | NOT IMPLEMENTED / OUT OF SCOPE | None claimed | None claimed | No | UNVERIFIED | PENDING |
| `RQ-CAIRN-008` Encounter/Thanks/Report | `CAIRN-06` | NOT IMPLEMENTED / OUT OF SCOPE | None claimed | None claimed | No | UNVERIFIED | PENDING |

## Activity Detail evidence boundary

The run proves only the explicit linked-own-Cairn handler into the shared Detail, edit, Back to the same Activity, and later retrieval through All Cairns. CARD-AD-01 Route saving, Activity deletion, and sync retry remain pending their own evidence and are not promoted by this delta.

## Visual evidence boundary

All listed captures are isolated Expo Web fixture evidence. `CAIRN-VIS-004`, `005`, `007`, and `011` use the intentional map-unavailable fallback. No capture proves actual Web Mapbox, native RN Mapbox, physical-device loading, native small-screen fit, or owner acceptance.
