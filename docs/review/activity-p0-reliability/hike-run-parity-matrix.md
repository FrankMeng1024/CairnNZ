# Hiking / Running P0 parity matrix

| Behavior | Hiking before | Running before | Final shared contract | Intentional domain difference |
|---|---|---|---|---|
| Operational presentation | Store status plus a local `phase` could disagree | Store status plus local `runState` determined major branches | One pure operational adapter makes tracking/session truth dominant | Screens and their visual composition remain separate |
| Start lock | No shared store-boundary guard | Same store call, same gap | Synchronous `requesting` lock; duplicate calls return `false` | None |
| Start readiness | Could present tracking before a usable GPS source; denial degraded into tracking-without-location | Same shared behavior | Tracking begins only after a real source is active; failure returns retryable Error | Copy remains mode-specific |
| Pause / resume | Pause could coexist with pre-start UI | Similar store lifecycle, different screen branches | Paused is an exclusive session-visible state; source must restart before Tracking | Existing control compositions preserved |
| Finish lock | No shared idempotent finishing boundary | Same store call, same gap | Synchronous `isFinishing` lock protects save/flush/completion | Existing completion surfaces remain |
| Unfinished local session | Hosted a recovery modal; scan could include the wrong mode | No recovery host despite Home being able to route an unfinished Run here | Shared mode-filtered finder/restore/discard contract; both host recovery | Mode label and metrics remain specific |
| Save-loss recovery | Hosted durable SAF-01 Retry/Discard | Store could create a Running save-loss payload, but screen did not host recovery | Running now hosts the same durable recovery semantics | Hiking retains its established host during this narrow P0 pass |
| Cold resume lifecycle | Restoration restarted only a source/timer subset | Not hosted | Shared restore rebuilds source switching, backup, monitors, and persistence before returning Tracking | None |
| Screen wake lock | Unconditional screen-level keep-awake | Unconditional keep-awake contradicted “Screen locks automatically” | Neither activity screen holds an unconditional wake lock; background tracking remains owned by the tracking service | Future dedicated navigation policy is outside P0 |
| Map load/failure feedback | Loading/offline/unavailable handling existed | No equivalent map readiness feedback | Both distinguish loading, ready, and unavailable; GPS errors remain explicit | Map interaction behavior is unchanged |
| Mapbox ornaments | Logo/attribution disabled | Logo/attribution disabled in both maps | SDK logo and attribution are enabled | Placement reflects each existing screen layout |
| Plant/Cairn action | Existing production Plant flow | Existing production Cairn action | Preserved exactly | `GLOBAL PRODUCT AUDIT REQUIRED` — both product directions remain open |
| Activity / Route relationship | Existing tracking may consume route-related inputs elsewhere | Same domain may consume route-related inputs elsewhere | No Route semantics were merged into Activity P0 | `GLOBAL PRODUCT AUDIT REQUIRED`; route following was not activated |
| Memory/session completion | Tracking store flushes/saves through existing pipeline | Same shared pipeline | Existing atomic save, fallback, and Memory flush preserved | `GLOBAL PRODUCT AUDIT REQUIRED` for product-level Memory/History behavior |

## P0 boundary

The shared result is narrow: one derived operational state, one guarded lifecycle boundary, one mode-aware recovery adapter, and parity for critical feedback. It is not a shared mega-screen and does not decide later map, Route, Plant, Cairn, Trails, Memory, or Settings product design.
