# O70 real-map campaign cost and request plan

Status: frozen before the first new Mapbox API dispatch on 2026-10-01.

## Authority and pricing assumptions

- Token authority: the existing `EXPO_PUBLIC_MAPBOX_TOKEN` in the current EAS production environment. The value is not copied into Git, evidence, browser storage, screenshots, request URLs, or reports.
- The checkout and shell do not contain a usable token. The production EAS environment is therefore the current configured authority, not an old Web export.
- No Mapbox account plan, token, scope, permission, or billing setting will be changed.
- Account-specific remaining free allowance and negotiated rates are not available read-only. Cost is therefore estimated conservatively as if public free allowances were already exhausted.
- Public pay-as-you-go first-paid-tier prices verified at <https://www.mapbox.com/pricing> on 2026-10-01:
  - Map Matching API: US$2.00 / 1,000 requests = US$0.002/request.
  - Directions API: US$2.00 / 1,000 requests = US$0.002/request.
  - Mapbox GL JS map loads: US$5.00 / 1,000 loads = US$0.005/load.
  - Static Images API: US$1.00 / 1,000 requests = US$0.001/request.
  - Tilequery API: US$1.50 / 1,000 requests = US$0.0015/request.
- Navigation SDK MAU/trip prices are not part of this HTTP Map Matching/Directions campaign.

## Hard campaign limits

| Product | Limit | Worst-case estimated cost at limit |
|---|---:|---:|
| Matching + Directions, combined | 120 attempts | US$0.24 |
| GL JS map loads | 200 | US$1.00 |
| Static Images | 200 | US$0.20 |
| Tilequery, only if demonstrated necessary | 250 | US$0.375 |
| All incremental API products | — | **US$5.00 total hard stop** |

Every attempted live request is reserved atomically before dispatch. Timeouts,
network failures, HTTP failures, probes and retries count. A reservation that
is proven not to have dispatched is explicitly released. Captured-real replay,
synthetic regression and public non-Mapbox reference reads are labelled and do
not increment live Mapbox counters.

## Dispatch plan

- Planned Navigation maximum before the diagnosis reserve: **90**.
- Protected diagnosis/final-confirmation reserve: **30**.
- First actual-app live sentinels, in order: U01 Hike normal, U04 Hike normal,
  M01 Hike normal, M02 Hike normal, X01 Hike normal, X02 Hike normal.
- Auth/config/connectivity is checked by U01's first production-built request;
  there is no unrelated chargeable probe.
- Normal/degraded/Run variants reuse an exact response only when the complete
  sanitized request identity is identical. Changed coordinates, timestamps,
  radiuses or parameters require a new request.
- Short cases target one or two coherent full-coverage Matching windows. Long
  cases retain structural points and use sparse truthful timing so early,
  middle and late coverage can be tested without spending the reserve.
- Directions is permitted only from independent accepted Matching evidence and
  remains within the production cap. It is never used to relabel an ambiguous
  Match as confident.
- One reusable Mapbox GL JS map instance will render multiple evidence layers
  and cases where practical. Static images are fallback evidence, not the
  default rendering strategy. Tilequery remains zero unless a reproduced
  obstacle/context failure justifies it.

The persistent authority is
`~/Desktop/Cairn_RealMap_Snap_Final_Review/request-cost-ledger.json`.
