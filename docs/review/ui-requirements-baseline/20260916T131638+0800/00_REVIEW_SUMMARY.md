# Cairn requirements / page baseline audit review summary

Audit run: `20260916T131638+0800`  
Verdict: **The audit is complete; the product is not complete and no scoped page receives a new user-acceptance PASS.**

## What this audit adds

- One authoritative 57-record requirements register derived into CSV, with every original 33 capability IDs crosswalked.
- Page/flow baselines for Hike, Run, Trails, Activity Detail, Route Detail, Route Editor, Plant/Quick Cairn, Own Cairn Detail, Memory, and Settings.
- An explicit reachability result: **All Cairns is missing/unreachable; non-owner Cairn Detail is source-present but normally unreachable.**
- 41 full-resolution Day/Sunset/Night Expo Web fixture captures (390×844 main matrix plus representative 320×568 and 430×932) and three offline boards, each labeled by renderer and fixture boundary.
- Focused verification: 12 suites / 116 tests passed. Several are source-string or in-memory contracts; they do not establish native/deployed/device/field/user acceptance.
- Exactly one next card: **CARD-01 first iPhone Hike/Run evidence review, with no code changes.**

## P0 risks remain separate from page review

1. **Friend-fog authorization:** prior production evidence found arbitrary-user/cap/query/revoke exposure. It was not retested against real users. Sharing pilot/external release remain blocked until separately approved containment is deployed and isolated proof exists.
2. **Release truth:** O56 advertises feedback and seven-day account restoration while the previously verified production backend lacked feedback and used a five-minute deletion schedule. No backend change/deploy is authorized here.

These do not prevent safe personal UI review, but they must stay visible and must not be conflated with CARD-01.

## Current page verdicts

| Page | Reachability | Current maturity | Important gaps |
|---|---|---|---|
| Hike | NORMAL_USER | SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED | Native map/theme proof; Current field recovery proof; Too-short paused Continue inconsistency; Expo Web 320×568 capture clips top/bottom chrome |
| Run | NORMAL_USER | SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED | Startup pace/current field proof; Native themes/legal-control proof; Quick Cairn later retrieval |
| Trails | NORMAL_USER | INTEGRATED_LIST / COMPLETENESS_AND_ACCEPTANCE_PARTIAL | Search/pagination covers loaded subset only; No All Cairns; Downstream details not accepted |
| Activity Detail | NORMAL_USER | NORMALLY_REACHABLE / PARTIAL_DNA / NOT_ACCEPTED | Web fallback only in audit; Native detail proof; Durable refinement truth |
| Route Detail | NORMAL_USER | NORMALLY_REACHABLE / ERROR_HANDLING_PARTIAL / NOT_ACCEPTED | Layers no-op; Rename/delete failure feedback; Unknown ID loading/not-found; Native renderer proof |
| Route Editor | NORMAL_USER | NORMALLY_REACHABLE / WEB_MAP_FALLBACK / PARTIAL_FAILURE_HANDLING | Gear no-op; Delete failure catch; Post-create landing mismatch; Server provenance loss |
| Plant / Quick Cairn | NORMAL_USER | FULL_PLANT_REACHABLE / QUICK_ACTION_REACHABLE / DEVICE_DURABILITY_UNVERIFIED | Title-in-note schema debt; Quick Cairn retrieval after creation; No current reconnect device proof |
| Own Cairn Detail | NORMAL_USER | REACHABLE_AFTER_FULL_PLANT / PARTIAL_DNA / NOT_ACCEPTED | No normal personal index; Native map/device proof; Potential exact-coordinate presentation |
| Non-owner Cairn Detail | UNREACHABLE | SOURCE_COMPONENTS_ONLY / NORMAL_ENTRY_UNREACHABLE | circleMarkers disconnected; public markers unpressable; full screen resolves own store only; hide no-op |
| All Cairns | UNREACHABLE | MISSING | No screen; No normal entry; No visual evidence |
| Memory | NORMAL_USER | NORMAL_ENTRY / FEATURE_RICH_SOURCE / DIVERGENT_VISUAL_AND_SECURITY_BOUNDARY | Known friend auth P0; circle markers disconnected; Web loading/runtime error; Final visual language open |
| Settings | NORMAL_USER | STRONG_SOURCE_DNA / DEPLOYMENT_CONTRACT_MISMATCH | Feedback endpoint absent in production; Deletion timing mismatch; Export content/version mismatch; No update ID |
| Home / Friends / Auth references | NORMAL_USER | BOUNDED_ACCEPTED_REFERENCE | Not re-audited comprehensively |

Hike/Run have substantial shared lifecycle/offline work and coherent chrome, but Expo Web only proves surrounding chrome; the native map, current installed O56, current NZ field behavior, and owner acceptance are unknown. Trails’ Activities/Routes IA is explicitly retained, but search is limited to loaded data and downstream Details remain unaccepted. Activity and Route Details are normally reachable, yet error handling, renderer proof, final-worker truth, and visual integration remain incomplete. Full Plant and Own Cairn Detail are reachable; Quick Cairn is durable but lacks a strong later-retrieval surface. Memory’s personal/friend implementation is broad but its final visual language is open, the friend authorization P0 remains, circle Cairns are disconnected, and this Web run showed only the loading state after one runtime error. Settings is visually aligned, while its deployed contracts are not.

## Requirements allocation

- CURRENT_SLICE: 8
- KEEP_NO_CHANGE: 9
- LATER_SLICE: 35
- NEEDS_PRODUCT_DECISION: 5

No requirement is `UNALLOCATED`. Candidate inclusion is not approval: All Cairns entry, non-owner Detail/privacy, Route provenance, full-history retrieval, export contents, Memory social semantics, Encounter, Moderation, payments, and NZ/offline expansion still require later decisions.

## Runtime safety and limitation

The capture used a fresh browser profile, synthetic identity/coordinates, intercepted read fixtures, and a write-deny policy. No product API write reached production. The app nevertheless attempted **161 POSTs to `/api/edit-diag`**, all blocked. This demonstrates why a preview build pointing at production is not isolated. Historical `/Desktop/54` phone images were inspected only as leads and excluded from the archive because they contain private-looking urban map context and do not establish current O56/NZ identity.

## First recommendation

Approve or reject **CARD-01** in `03_PAGE_LED_SLICE_PLAN.md`: a small, no-code iPhone Hike/Run evidence review using `04_FIRST_IPHONE_REVIEW.md`. Do not select a visual or control implementation slice until the exact device candidate and native symptoms are known.
