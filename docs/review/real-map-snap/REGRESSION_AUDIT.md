# O71 real-map seam repair regression audit

The only production geometry change in this campaign is a bounded boundary
trim for a network candidate that already passed corridor, confidence,
correspondence, geometry-quality and topology gates but failed only its entry
or exit heading seam. The trim is limited by the pre-existing
`MAX_SEAM_TRIM = 3` policy and every unchanged gate is run again on the
trimmed candidate. There is no global threshold relaxation.

## Demonstrated failure and counterexample

- X01's exact captured Mapbox response contained 77 supported central
  observations. The candidate passed all safety gates except the exit seam at
  one adjacent ambiguous observation. Before the repair the complete Activity
  remained local; after a one-observation tail trim it persisted a bounded
  hybrid section with reason `bounded-seam-trim-0-1`.
- X02's exact captured responses still persist an all-local route: its new 2026
  boardwalk is absent and its late support remains fragmented/ambiguous. This
  proves the repair does not manufacture provider authority.

## Product-contract surfaces audited

| Contract | Regression control |
|---|---|
| Raw, canonical, WAL and QA Memory authority | Trim is Final-only; the 30 actual-app records preserve pre-Finish canonical distance and QA Memory. |
| Network trust | Candidate must pass the existing provider confidence, tracepoint coverage, ambiguity and corridor-evidence gates before trim is considered. |
| Topology | `evaluateTopologyQuality` is re-run after every bounded trim. |
| Seams and full route | `evaluateIslandSeamQuality`, assembly safety and whole-route validation are re-run; unsafe islands fall back locally. |
| Directions provenance | Unchanged; Directions still requires independent authority from Matching evidence. |
| True gaps / segment boundaries | Unchanged segmentation; selected geometry is assembled independently per canonical segment. |
| Offline Finish / immutable route snapshot | X05 saves local first, cold-reopens, upgrades once, and retains its revision-1 route snapshot. |
| Persistence identity | Completion, Detail, snapshot, and cold reopen bind the same QA Activity and geometry fingerprints. |
| Production isolation | The campaign uses the `snap-lab` realm and an intercepted GET-only Cairn API façade; no QA identity or coordinate payload reaches production. |

## Verification scope

- `cd app && npm run verify:changed` is the required Activity gate.
- The existing logical SnapLab matrix remains frozen; production Snap changes
  run through the changed-source routing suites without regenerating inputs.
- Focused coverage includes successful seam-boundary trimming plus the prior
  corridor, topology, gap, Directions-authority and whole-route fallbacks.
- Expo Web at 390×844 supplies the actual-app lifecycle evidence. Native GNSS,
  background execution and physical trail behaviour remain pending field
  validation and are not claimed by this campaign.
