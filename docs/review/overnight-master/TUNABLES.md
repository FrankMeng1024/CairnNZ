# Actual tunable parameters

These are current reversible implementation defaults, not field-validated
optima.

## Discovery and presentation

| Parameter | Default | Bound/source |
|---|---:|---|
| Per-Cairn discovery radius | 50 m | Existing server discovery policy; unchanged. |
| `MAX_CAIRNS_PER_LOCAL_VISIT` | 3 | env bounded 1–20; Friends may exceed. |
| `SAME_LOCALITY_EXIT_DISTANCE_M` | 120 m | env bounded 60–500. |
| `SAME_LOCALITY_REVISIT_MINUTES` | 15 min | env bounded 1–240. |
| `PRESENTATION_MERGE_WINDOW_SECONDS` | 20 s | env bounded 1–120. |
| `HAPTIC_MIN_INTERVAL_SECONDS` | 180 s | env bounded 30–3600; eligibility only, no new native haptic implementation. |
| Discovery sound | OFF | `DEFAULT_DISCOVERY_SOUND_ENABLED=false`. |
| Ordinary category split | about 50/50 | NEW_PUBLIC / UPDATED; empty category redistributes. |
| Freshness boost | max 20% | `CAIRN_FRESHNESS_MAX_BOOST_PERCENT`, 168 h window. |
| Thanks boost | none presently | No reliable bounded input was added; fair randomized selection remains. |
| Connected presence upload cadence | 5 s debounce / 10 s max wait | Bounded batch; not one request per point. |
| Friend Fog delay | 1800 s | Server-side timestamp cutoff. |

## Route editing

| Parameter | Value | Meaning |
|---|---:|---|
| Attachment tolerance | 20 m | Route-specific endpoint attachment bound. |
| Coordinate equality | 0.35 m | Consecutive numeric normalization only. |
| Maximum points per part | 5000 | Structural guard. |
| Map Matching request maximum | 100 coordinates | Adapter/provider limit. |
| Chunk input | 90 coordinates | Leaves overlap/seam room. |
| Maximum chunks | 8 | Prevents unbounded/billable retry. |
| Provider endpoint tolerance | 25 m | Larger shift is not silently anchored. |
| Shape review deviation | 45 m | Continuous candidate requires review. |
| Shape reject/manual-recovery deviation | 90 m | Matched candidate rejected; coherent raw Draw may be kept explicitly. |
| Accepted Point animation | 800 ms | Geometry already committed; cancellable/skippable visual only. |

The 20 m Route attachment tolerance is unrelated to the 50 m Cairn discovery
radius. Draw shape safety checks evaluate every original vertex bidirectionally;
100-point progress resampling is used only for order comparison, not to hide
extreme provider geometry.

