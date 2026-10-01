# O70 real-map campaign acceptance criteria

Status: **frozen before candidate output and before the first new Mapbox API
dispatch** on 2026-10-01.

Frozen campaign SHA-256:
`ce01e93b5e1aabd7ffa3f9d44b811133903adbafba4b5e9db1bace79b1d402c1`.

The intended reference is a planned public-map route, not surveyed physical
ground truth. OSM-routed references are independent of the Mapbox API response
but share some underlying OSM cartography with Mapbox Streets. U04 and X02 are
medium-confidence council-authority cartographic traces of paths opened in
2026; their Mapbox coverage is UNKNOWN at freeze time. They must stay local if
current provider evidence is absent or unreliable.

## Frozen route criteria

| ID | Reference confidence | Eligible source fractions | Independent tolerance mean / p95 / max | Protected context/topology | Expected refinement |
|---|---|---|---|---|---|
| U01 | High planned route | 0–100% | 7 / 13 / 24 m | several ordered blocks and corners | useful network positive |
| U02 | High planned route | 0–100% | 7 / 13 / 24 m | three corners and curved Avon corridor; no tracepoint chord | useful full-geometry network positive |
| U03 | High planned route | 0–100% | 6 / 11 / 20 m | Fish Lane/South Way internal sequence; no arterial theft | minor-path positive |
| U04 | Medium council cartographic trace | none predeclared | 10 / 18 / 30 m | complete Hayman Park circuit; no Lambie Drive/rail transfer | local unless independent current provider authority exists |
| U05 | High supported passage | 20–85% | 6 / 10 / 18 m | St George approach → Chambers Laneway → Wallace/leisure exit; buildings/walls | supported passage positive, no invented shortcut |
| U06 **holdout** | High planned route | 0–43%, 62–100% | 7 / 13 / 24 m | shop stop, true blackout, later exit | independent pre/post-gap opportunity; zero gap connector |
| M01 | High DOC-supported track | 8–100% | 8 / 15 / 28 m | Hooker turns and legitimate Lower Hooker bridge | mapped-trail positive |
| M02 | High planned route | 5–95% | 8 / 15 / 27 m | ordered Queenstown Hill switchbacks; no hillside chord | mapped-trail positive |
| M03 | Medium shared-OSM-lineage route | 12–68% | 9 / 17 / 30 m | Rāpaki trail before road; no Summit Road theft | local or supported trail, never wrong road |
| M04 | High planned route | 0–100% | 9 / 17 / 30 m | fork order, revisited corridor, one complete Redwoods loop | topology-preserving trail hybrid |
| M05 | High DOC-supported track | 0–38%, 57–100% | 9 / 17 / 30 m | Routeburn forest, true blackout, later delivered batch | mapped trail around gap; late batch is not a second gap |
| M06 **holdout** | High supported passage | 0–100% | 9 / 17 / 30 m | Falls River Suspension Bridge; no water chord | mapped-trail/bridge positive |
| X01 | High planned route | 0–28%, 32–70%, 75–100% | 8 / 15 / 27 m | city entry → Botanic Garden → independent city exit | useful network/trail/network positive |
| X02 | Medium-high council cartographic trace | 0–12%, 86–100% | 10 / 18 / 32 m | north approach → new curving Te Whau boardwalk → Roberts Road exit | network/local/network; unknown middle must not veto exit |
| X03 | High planned route | 0–100% | 7 / 13 / 23 m | street → Albert Park interior → street; walls/buildings | supported mixed positive without parallel-road theft |
| X04 | High planned route | 0–48%, 68–100% | 8 / 15 / 27 m | one U-turn, revisited corridor, stop, true blackout and recovery | topology-preserving hybrid in Hike and Run |
| X05 | High planned route | 0–100% | 8 / 15 / 27 m | lakefront/garden route; offline save and immutable pre-upgrade snapshot | safe local first, at most one useful online upgrade |
| X06 **holdout** | High planned route | 0–26%, 34–66%, 74–100% | 9 / 17 / 30 m | urban entry, Mount Victoria traverse, true gap, late city exit | bounded partial hybrid with early/middle/late fairness |

## Zero-tolerance safety and lifecycle rules

1. Wrong arterial/parallel corridor occupation introduced by refinement: 0 m.
2. Selected or rendered edge crossing a true observation gap: 0.
3. Newly introduced unsupported wall/building/water/disconnected-path
   shortcut: 0. A council-confirmed laneway or bridge is not a violation.
4. Protected U-turn, revisit, loop, switchback and corner order is unchanged.
5. Accepted canonical point identity, timestamps, segment identity, distance,
   time and QA Memory evidence are invariant under Final changes.
6. Every saved record remains `realm: snap-lab`, owner-scoped and absent from
   production Activity/Memory/Route/Friends/sync/achievement writes.
7. Completion, Detail and cold reopen show the same selected revision. X05's
   Route snapshot remains byte-identical after its one optional upgrade.
8. Clear urban positives and M01/M02/M06 must show materially useful
   response-driven geometry when provider evidence is adequate. All-local is a
   utility finding, not a positive pass.
9. X01 must demonstrate supported network/trail/network coverage. X02 must
   independently consider the late supported interval even if its new-boardwalk
   middle remains local/unknown.

## Measurements and verdicts

- Geometry is sampled at equal arclength; coverage is measured on ordered
  canonical source arclength, never on the shorter selected display length.
- Report reference mean/p95/max deviation, wrong-corridor length, straight
  interval raw→canonical→local→selected jitter, ordered topology, seam
  angle/edge, request coverage, calls and quality per request.
- Section states are reported as `NETWORK_REFINED`, `LOCAL`,
  `MOVEMENT_EVIDENCE_GAP`, `NOT_EVALUATED` or `UNKNOWN_CONTEXT`.
- A mapped positive must improve lateral mean or heading-change RMS by at
  least 10% when injected wobble is visibly correctable, while selected p95 is
  no more than 0.5 m worse than Local Final.
- Correct-corridor occupation for an eligible positive is at least 95%.
- Verdict vocabulary includes `PASS_IN_DECLARED_SCOPE`,
  `URBAN_TOO_CONSERVATIVE`, `WRONG_CORRIDOR`,
  `REQUEST_CONSTRUCTION_DEFECT`, `RESPONSE_GEOMETRY_LOSS`,
  `UNSUPPORTED_OBSTACLE_CROSSING`, `MAP_DATA_LIMITATION`,
  `TIME_BUDGET_FAILURE`, and `ORACLE_UNCERTAIN`.

The reviewer holdouts U06, M06 and X06 remain unopened for candidate scoring
until the first implementation/sentinel pass is frozen.
