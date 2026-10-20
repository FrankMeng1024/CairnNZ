# Regression audit

## Protected behavior

- Normal turns, slow walking, returns, out-and-back corridors and off-network trails remain canonical-evidence-led.
- Memory is projected from accepted canonical evidence, never provider-planned geometry.
- Save remains local-first; optional Final enhancement cannot block the durable base Activity.
- Simulator evidence remains isolated and visibly labelled; the Web road-context adapter calls the production rendered-feature handler without claiming native provenance.
- Plant changes are limited to active Activity identity and fresh-location reacquisition.
- Create Route copies an Activity into a separate editable object. It never mutates Activity or Memory.

## Old 15 cases

All 15 known cases were replayed against their previously captured real Mapbox responses with live navigation blocked. Geometry was materially unchanged: old training Selected Final mean 5.87 m versus 5.88 m, p95 15.60 m versus 15.60 m; old four holdouts remain identical. Chronological attribution repaired the old training stationary-growth aggregate from 27.01 m to 0 m.

This is a captured-response algorithm regression, not a new production UI or native GPS campaign. The original old stage-ledger exports remain historically partial and are not relabelled complete.

## Product-contract audit

- Activity diagnostics: explicit Owner Debug opt-in, precise-coordinate disclosure, no automatic upload, owner-bounded purge.
- Activity Detail: canonical PrimaryButton, no visual redesign.
- Route editor: production transaction, provider fencing and manual fallback; QA hook is Debug+Web-only and read-only except `submitStroke`, which invokes the production handler.
- Sync/backend: no production backend source change or deploy. The added backend script is an isolated verification harness.
- Release identity: O87, app version, runtime and native dependencies unchanged.

## Rejected experiments

- Robust recent-tail Live candidate: no broad benefit; current ordinary stationary Live already quiet.
- Whole-route HMM/Kalman/road snap: unjustified complexity and trail/return risk.
- Raising diagnostic ring caps: rejected in favor of bounded chunked durability.
- Treating late provider responses as instantly available during replay: rejected because it changes the original timeout decision.
