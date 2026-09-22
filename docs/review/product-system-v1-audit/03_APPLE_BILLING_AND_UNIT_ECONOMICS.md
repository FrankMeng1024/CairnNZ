# 03 — Apple billing and unit economics

## Verdict

Payments are not operational in the published O56 client. The native build contains RevenueCat support and the client wrapper is substantial, but the production EAS environment has no RevenueCat public-key variable, the published bundle contains no iOS `appl_…` key, and the app records `iap:api_key_missing`. Even if a purchase could complete, no backend webhook/receipt/entitlement path updates `memory_subscription_limit`; the paywall's success callback is not supplied by `MemoryScreen`. The advertised “unlimited friend memories” capability therefore cannot be delivered by the current system.

Apple, RevenueCat, Mapbox, and infrastructure account/dashboard facts remain **UNVERIFIED** unless explicitly listed as public documentation or source evidence below.

## Current billing implementation

| Layer | Current source fact | Operational conclusion |
|---|---|---|
| Native SDK | `react-native-purchases` 8.9.0 is installed; native build 56 source includes it | Native capability exists; not sufficient for a transaction |
| Identity | stable Cairn user ID; `logIn` on account switch; `logOut` and cache clear on logout | Reasonable client account binding; dashboard transfer policy unknown |
| Entitlement | hard-coded `memory_pro`; offerings, purchase, restore, CustomerInfo; 24-hour local cache | Source exists; no server authority |
| Keys | code expects `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / Android; EAS project/account env listing has neither | O56 initialization cannot succeed |
| Published bundle | contains `iap:api_key_missing`; no `appl_…` literal | Confirms the missing iOS public-key state for O56 |
| Paywall reachability | shown when the sixth Memory friend is selected | Reachable UI in normal product |
| Price/copy | fallback “NZ$5.99 / month”; claims unlimited fog, marks and routes | Fallback is not verified App Store pricing; marks/routes are not capped by the subscription system |
| Success callback | `PaywallSheet` calls optional `onEntitled`; `MemoryScreen` renders it without that prop | UI/server limit does not change after purchase/restore |
| Backend | no IAP/webhook route, App Store Server API integration, event ledger, signature verification, idempotency, expiry/refund reconciliation | No authoritative entitlement lifecycle |
| Legal links | paywall “Privacy · Terms” control is implemented as another restore action, not document links | Store/readiness gap |

Source: `app/src/services/iapService.ts:32,46-114,120-205`; `app/src/features/memory/components/PaywallSheet.tsx:27-100,118-160`; `MemoryScreen.tsx:1088`; `backend/src` route search.

The production database's missing Memory cap trigger creates a second, opposite failure: normal UI blocks the sixth friend, while a direct API caller can bypass the cap for free. Payment neither grants the advertised access nor protects the free-tier constraint.

## Required owner checks — Apple and RevenueCat

No authorized App Store Connect or RevenueCat dashboard access was available. Minimum owner evidence, without sharing secrets:

1. Apple Developer membership status, legal entity/seller name, and account-holder role.
2. Paid Apps Agreement, tax forms, and banking status.
3. App record/bundle ID, build 56 upload/processing/TestFlight state, current external-test review state.
4. Subscription group, product ID, duration, cleared-for-sale state, NZ storefront price, localization, review screenshot/status, and sandbox availability.
5. Small Business Program enrollment/effective date if claimed; otherwise standard commission assumptions.
6. RevenueCat project/app bundle mapping, public SDK key attached to the correct EAS environment, product→offering→`memory_pro` attachment, sandbox/production mode, user-ID transfer behavior, and webhook delivery history.
7. A sandbox purchase/renewal/expiry/cancel/refund/restore/account-switch trace correlated across device, RevenueCat event, backend event ledger, and effective server entitlement.

Until those checks exist, dashboard state is `UNKNOWN`, not failed. The missing O56 key and missing backend integration, however, are directly verified failures.

## Current public platform rules used in this audit

- Apple says TestFlight builds are testable for up to 90 days from upload, and external testing can require TestFlight App Review. This does not prove build 56 was uploaded or remains available. Sources: [Apple build statuses](https://developer.apple.com/help/app-store-connect/reference/app-uploads/app-build-statuses), [external testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers).
- Apple requires test information including a feedback email for beta review. [Provide test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information).
- TestFlight auto-renewable subscriptions renew on an accelerated schedule and can renew up to six times per subscription period; that is test behavior, not production revenue. [Testing subscriptions and IAP in TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testing-subscriptions-and-in-app-purchases-in-testflight).
- Apple's public subscription terms describe 70% proceeds in the first year and 85% after one year for standard auto-renewable subscriptions; Small Business Program participants receive 85% from the start, subject to eligibility. Exact proceeds also depend on taxes/storefront adjustments and the account's agreements. Sources: [Subscriptions](https://developer.apple.com/app-store/subscriptions/), [Small Business Program](https://developer.apple.com/app-store/small-business-program/).
- Production entitlement reconciliation should use an authoritative server path such as the [App Store Server API](https://developer.apple.com/documentation/appstoreserverapi) and configured [App Store Server Notifications URLs](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications), whether integrated directly or through RevenueCat.
- RevenueCat's current public pricing is free through US$2,500 monthly tracked revenue and then 1%, but an account-specific contract is unknown. [RevenueCat pricing](https://www.revenuecat.com/pricing). Customer identity and lifecycle semantics must be checked against [identifying customers](https://www.revenuecat.com/docs/customers/identifying-customers), [CustomerInfo](https://www.revenuecat.com/docs/customers/customer-info), and [webhook event flows](https://www.revenuecat.com/docs/integrations/webhooks/event-flows).

Public terms are inputs for a model, not evidence of Cairn's agreements, eligibility, or invoices.

## Mapbox and infrastructure cost drivers

Current app source initializes native maps across core surfaces and silently attempts a rough New Zealand offline warmup pack at zoom 5–10 (`app/src/services/mapboxPrewarm.ts`). The source comment's historical “6000 free tile limit” is not accepted as current authority. Official guidance says offline size depends on area, zoom levels, style, and data; account/tile-pack limits must be checked. Sources: [offline usage estimation](https://docs.mapbox.com/help/troubleshooting/estimating-offline-usage/), [mobile offline maps](https://docs.mapbox.com/help/dive-deeper/mobile-offline/).

The current public Mapbox list price at audit time shows:

- Maps SDKs for Mobile: first 25,000 monthly active users free, then tiered per 1,000 MAU;
- Map Matching and Directions: first 100,000 requests per service/month free, then tiered request pricing.

Those public thresholds/rates are not the Cairn account contract or invoice. Sources: [Mapbox pricing](https://www.mapbox.com/pricing), [pricing by product](https://docs.mapbox.com/accounts/guides/pricing/). Mobile MAU is driven by users who display/use a map; reinstalls may create additional MAUs under the platform rules. [Maps SDK for iOS pricing guide](https://docs.mapbox.com/ios/maps/guides/pricing/).

Request drivers in current source:

| Driver | Structural maximum/current behavior | Evidence |
|---|---|---|
| Completed Activity final reconstruction | Map Matching windows of 80 with 24-step overlap, cap 33 matching requests per canonical segment; up to 3 Directions fallbacks/segment; 10-second overall completion loop, concurrency 4 | `app/src/services/routing/pedestrianFinalRoute.ts` and focused tests |
| Route initial match | one Map Matching request after downsampling to max 100 coordinates | `routeMatcher.ts` |
| Route brush edit | max 100 coordinates/request; one retry on network/timeout/5xx | `MapMatchingClient.ts` |
| Map Matching service limit | official endpoint supports up to 100 coordinates and documents 300 requests/minute | [Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/) |
| Directions fallback | request-billed service | [Directions API](https://docs.mapbox.com/api/navigation/directions/) |

The structural maximum is not actual usage. Actual cost requires telemetry counts by real Activity/segment plus Mapbox account metrics.

Backend/storage drivers include:

- raw and final Activity geometry JSON;
- individual Memory point rows and sync traffic;
- Route geometry JSON, Cairns, votes/reports, exports, telemetry, backups and egress;
- local Activity summary cache capped at 500;
- simulator logs capped at 512 KB/session and five sessions;
- internal debug logs capped at 50 MB/session and ten sessions;
- backend QA upload/merge caps (512 KB event payload, 8 MB merge) and general telemetry body cap (12 MB).

Voice-memo references are local file URIs and are not uploaded by the current backend. There is no Cairn image/media upload pipeline. Those facts constrain, but do not eliminate, device storage risk.

## Auditable unit-economics model

Use measured variables rather than invented invoices:

```text
Net subscription revenue
  = paid subscribers
    × storefront customer price
    × (1 - effective Apple commission - applicable tax/adjustment effects)
    - RevenueCat fee under actual account terms
    - refunds/chargebacks

Mapbox cost
  = mobile Maps MAU charge under actual tier
    + Map Matching request charge
    + Directions request charge
    + any contracted/offline-specific charge

Backend cost
  = compute + database/storage + backups + egress + email/observability

Contribution before labor/overhead
  = net subscription revenue - Mapbox cost - backend cost - other variable services
```

Suggested scenario worksheet—illustrative volumes only, **not forecasts**:

| Variable | Small worksheet | Medium worksheet | Required measured input |
|---|---:|---:|---|
| Map MAU | 100 | 2,500 | Mapbox account usage |
| Completed Activities/month | 200 | 10,000 | real production telemetry |
| Route create/edit operations | 50 | 2,000 | product events/API counts |
| Paid subscribers | 25 | 300 | ASC/RevenueCat active entitlement count |
| Matching requests | `activities × avg_matching_per_activity + route_ops × avg_matching_per_op` | same formula | actual diagnostic request counts, split real/sim |
| Directions requests | `activities × avg_directions_fallback_per_activity` | same formula | actual fallback telemetry |
| Revenue | formula above | formula above | NZ storefront proceeds + commission/program status |

At both illustrative sizes, public list thresholds suggest map/request charges could be zero if all account usage stays below free tiers, but that is an inference—not a bill—and must be reconciled with all apps/tokens under the account and current contract.

## Six-level evidence summary

| Capability | Source | User reachable | Automated proof | Deployed match | Device loaded | Real field |
|---|---:|---:|---:|---:|---:|---:|
| Native RevenueCat wrapper | YES | PARTIAL | PARTIAL | YES (native module) | UNKNOWN | NO |
| O56 RevenueCat initialization | YES | YES | PARTIAL | NO | UNKNOWN | NO |
| App Store offering/purchase | PARTIAL | PARTIAL | NO | NO | UNKNOWN | NO |
| Server-authoritative entitlement | NO | NO | NO | NO | NO | NO |
| Restore/account-switch lifecycle | PARTIAL | YES | PARTIAL | NO | UNKNOWN | NO |
| Paid capability enforcement | NO | PARTIAL | NO | NO | NO | NO |
| Mapbox map capability | YES | YES | PARTIAL | PARTIAL | UNKNOWN | PARTIAL |
| Current unit-economics measurement | PARTIAL | UNKNOWN | NO | UNKNOWN | UNKNOWN | UNKNOWN |
