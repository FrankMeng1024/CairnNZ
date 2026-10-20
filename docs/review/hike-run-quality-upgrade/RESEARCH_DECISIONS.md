# Research-to-implementation decisions

Frozen direction before implementation, updated only with experiment outcomes.

## Adopted

- Keep raw observations, canonical accepted evidence, Live presentation, and Final reconstruction as separate authorities.
- Make Owner diagnostic replay an explicit, local-only mode. Its durable stream is chunked at 48 records, capped at 8 MiB per Activity, retained for at most three Activities per owner, checksummed, and never uploaded automatically. It records raw receipt order, acceptance/rejection, later canonical promotions, lifecycle/application stages, provider receipts/responses, and the final artifact.
- Attach Final display timestamps by a monotonic, bounded-forward correspondence from canonical evidence to display chainage. Preserve stops as elapsed time at one position, preserve long delivery/outage gaps as time steps rather than invented continuous movement, and prevent an outbound pause from jumping to a later repeated corridor.
- Evaluate local Final utility by actual bidirectional displacement, path length, temporal order, topology, turns, and evidence support. Vertex count alone is not a quality criterion.
- Treat Mapbox as optional sequence evidence for walkable roads and mapped trails, never mandatory road snapping. Provider failure, ambiguity, timeout, 401, off-network movement, and known gaps retain a useful local artifact.
- Replay only provider responses the app actually consumed. A response captured after an app timeout remains an explicit provider-unavailable outcome; feeding the late body back instantly would change fallback decisions.
- Preserve active Activity identity during Plant even when the last coordinate is stale. Coordinate freshness and Activity provenance are independent facts.

## Compared and rejected

- A new robust recent-tail Live estimator was rejected for this candidate. The frozen development runs already had 0.5 m mean stationary Live growth, prompt ordinary departure, and no recurring Live-tail geometry failure; the partial alternative did not improve the biased Central Park run and added another mutable authority.
- A whole-journey optimizer, HMM road network, Kalman dependency, or native sensor dependency was rejected. The evidence did not justify the complexity, release risk, or assumption that a hiker must follow a routable road.
- Stronger global simplification and nearest-road snapping were rejected because they risk erasing returns, switchbacks, slow turns, and genuine off-network trails.
- Raising diagnostic memory caps or persisting each callback independently was rejected. Both hide loss or create unacceptable write amplification.
- A provider-success requirement for Activity-to-Route correction was rejected. The production Draw transaction must remain useful during a provider outage through an explicit manual section; this was tested with network fallthrough blocked.

## Resulting mechanism boundary

The selected algorithm change is deliberately small: Final geometry is still produced by Cairn's existing uncertainty-aware, turn-protected, segment-aware local and Mapbox-assisted pipeline. The change corrects chronological metadata and removes a vertex-count-only rejection. It does not claim a new GPS filter, new map matcher, or invented coverage across unobserved gaps. Live geometry remained unchanged after the comparison showed no general benefit.
