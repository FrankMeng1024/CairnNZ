# Mapbox usage and budget

## Installed-generation assumptions

- JavaScript wrapper: `@rnmapbox/maps` 10.3.1.
- That package declares Android Maps SDK 11.20.1 and an iOS CocoaPods constraint of `~> 11.20.1`.
- The managed checkout has no generated iOS project/Podfile.lock, so the exact native iOS patch compiled into installed Build 62 is **not proven**. The wrapper version is not being presented as the native SDK version.
- Expo is 54.0.35. This repair adds no dependency and does not add Navigation SDK/Free Drive, Tilequery, geocoding, offline-database mining, or a self-hosted road service.
- The Mapbox account's actual plan and month-to-date usage were not queried or changed. Cost values below use public pay-as-you-go planning tiers, not an invoice promise.

## O65 baseline versus repaired policy

| Surface | O65 baseline | Repair |
|---|---:|---:|
| Local Live road context | No coherent activity-wide authority | Rendered-feature queries on the mounted map; zero Navigation API calls |
| Matching inside one Final reconstruction | Up to 33 | Governed across the entire Activity |
| Directions inside one Final reconstruction | Up to 3 | At most 2 per Activity |
| Segments/reopen/restart | Could invoke separate reconstruction budgets | Same persisted owner/activity ledger |
| Concurrent routing requests | Up to 4 | At most 2 per Activity |
| Failure/abort/disused/retry accounting | Invocation-local and resettable | Every actual attempt consumes the durable budget |
| Passive Memory | Not an activity-wide cost contract | Zero Matching/Directions/geocoding/Tilequery |
| Preview, reload, stationary, puck, frame/style render | Not governed as explicit zero phases | Zero Navigation API requests by phase contract |

The O65 structural worst case was `33 * physicalSegments` Matching plus `3 * physicalSegments` Directions for each reconstruction invocation, with another opportunity after retry/reopen. The repair's limits cannot reset on segment, app foreground, screen reopen, or process restart.

## Repaired limits

The persisted governor derives limits from recorded duration and applies all three Matching constraints: Live phase, Final phase, and total, with a hard Activity ceiling.

| Recorded duration | Optional Live Matching | Final Matching | Total Matching | Directions | Concurrent |
|---:|---:|---:|---:|---:|---:|
| 10 min | 2 | 4 | 6 | 2 | 2 |
| 15 min | 3 | 5 | 8 | 2 | 2 |
| 1 h | 10 | 20 | 30 | 2 | 2 |
| 2 h | 20 | 40 | 60 | 2 | 2 |
| 3 h or longer | phase limits continue, but total is hard-capped | phase limits continue, but total is hard-capped | 60 | 2 | 2 |

The present Live implementation uses local rendered context and therefore makes **zero** Matching requests. The Live allowance is reserved for a future evidence-qualified path; it is not spent by each fix or a timer.

Passive, preview, and reload authorization returns `phase-zero-network`. Offline evidence, a missing position, unchanged evidence, or an already successful/unauthorized fingerprint cannot launch a matching retry. The queue and governor bind owner, Activity UUID, revision, evidence fingerprint, profile, and algorithm parameters.

## Measured deterministic receipt

On the rerun synthetic Final trace:

- local Live Matching: 0;
- Final Matching: 2 calls for each complete mocked trace window set;
- Directions: 0;
- passive: 0;
- preview: 0;
- reload: 0.

All eight mocked outcomes retained a valid Final surface: confident, partial tracepoint support, low confidence, `NoMatch`, network failure, timeout, parallel-road ambiguity, and closed-loop temporal crop. The network-failure fixture records both attempted failures rather than treating them as free. This was a local mock, not a paid real-network probe; it supplies invocation logic evidence, not account billing or radio-byte evidence.

Local feature queries happen only when the mounted map has useful context and the qualified route advances at least 12 m, 15 seconds elapse, or the viewport/style/source generation changes. They query rendered SDK data and are not Mapbox Tilequery API requests. Ordinary Maps SDK render/MAU and tile delivery remain a separate usage category.

## Public-tier planning comparison

Planning tiers checked for Map Matching:

- first 100,000 requests/month: $0;
- 100,001–500,000: $2.00 per 1,000;
- 500,001–1,000,000: $1.60 per 1,000;
- next tier through 5 million: $1.20 per 1,000.

At the first paid tier, marginal request costs beyond the shared free allowance are:

| Example | Matching requests | Marginal Matching cost |
|---|---:|---:|
| Repaired synthetic Final | 2 | $0.004 |
| 1 h Final phase ceiling | 20 | $0.040 |
| 1 h total ceiling | 30 | $0.060 |
| Per-Activity hard ceiling | 60 | $0.120 |

The two Directions fallbacks would add two billable Directions requests under that product's separate account tier; `$0.004` is only a same-rate arithmetic illustration, not an asserted Directions price.

Using the task's eight recorded hours per active user/month and the 30 Matching calls/hour planning ceiling:

| Active users | Matching requests/month | Matching-only estimate |
|---:|---:|---:|
| 100 | 24,000 | $0 within the first 100,000 account requests |
| 1,000 | 240,000 | $280 |
| 5,000 | 1,200,000 | $1,840 |

These examples assume no other account traffic consumes the free tier and exclude Maps SDK MAU/tile use, Directions, hosting, taxes, and plan-specific terms. No paid-plan change was made.

## Cost and coverage acceptance verdict

- Request-control gate: **PASS at code/test level**. No per-fix request path exists, all actual attempts count, and activity/restart boundaries are persisted.
- Route-retention gate: **PASS on deterministic fixtures**. Uncertain/no-context spans retain the canonical/Base route; an invalid network candidate cannot erase coverage, bridge a true gap, or make `displayRefined=false` veto the safe Final.
- Real map/account gate: **DEVICE_PENDING**. Exact installed iOS SDK resolution, rendered feature availability on the owner style, account usage, response bytes, and real-route retained coverage need the Build 63+ device run.

Authoritative references:

- https://docs.mapbox.com/api/navigation/map-matching/
- https://www.mapbox.com/pricing
- https://docs.mapbox.com/accounts/guides/pricing/
- https://rnmapbox.github.io/docs/components/MapView
