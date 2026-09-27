# Native boundary and owner build

Status: `NATIVE_BUILD_REQUIRED`

## Current identity

| Item | Value |
|---|---|
| Installed owner build stated by task | 62 |
| App version | 0.2.6 |
| Runtime | `0.2.6-o61` from `app.config.js` |
| Runtime policy in `app.json` | app version |
| Expo | 54.0.35 |
| `expo-location` | 19.0.8 |
| `expo-task-manager` | 14.0.9 |
| `@rnmapbox/maps` | 10.3.1 |
| RNMapbox Android default native SDK | 11.20.1 |
| RNMapbox iOS native SDK declaration | `~> 11.20.1`; exact installed patch unproven without generated native lock/build metadata |
| Minimum native build enforced for passive Memory | 63 |

No dependency, app version, runtime version, build number, or Android version code was changed.

## Native/config changes in the repair

- `app.json` now explains optional passive Memory in `NSLocationAlwaysAndWhenInUseUsageDescription`, instead of promising background location only for an active Hike/Run.
- Existing `UIBackgroundModes: [location]` and Android foreground/background location permissions are retained.
- A top-level task is registered through `expo-task-manager`; background updates are started with `expo-location` only after explicit consent and background permission.
- `PASSIVE_MEMORY_MINIMUM_NATIVE_BUILD = 63` blocks Build 62 even when the JavaScript runtime matches.
- Settings exposes the build boundary and does not silently convert prior foreground-only consent into passive-background consent.

Expo config/plugin changes take effect in a newly compiled native binary. An unchanged runtime only answers whether an update group can be selected; it does not rewrite an installed iOS purpose string, native manifest, entitlement, or compiled module behavior.

## What Build 62 can and cannot receive

| Capability | Build 62 technical boundary |
|---|---|
| Finish result, walked preview, Base/Final revision UI | Uses already embedded JS/native modules and is technically expressible in JS. |
| Journal rebase, sync fixes, distance metric, Final queue/governor | Technically expressible in JS/local storage. |
| Qualified-puck/source supervision | Uses the already embedded Expo Location module and is technically expressible in JS, subject to native-device validation. |
| Local RNMapbox rendered-feature queries | Uses the embedded wrapper/API, but exact Build 62 native behavior was not proven. |
| Passive Memory in normal background/lock | **Must not run on Build 62.** Its installed purpose disclosure predates optional passive Memory. The hard build gate disables it. |
| Complete tracking/Memory v2 candidate | **Cannot be delivered to Build 62** because a required contract is native-config gated. |

Therefore this branch is not an OTA candidate, even though `0.2.6-o61` is unchanged. No OTA was published.

## Required owner build boundary

The next manually initiated native candidate must:

1. assign a native build number of at least 63 so `Application.nativeBuildVersion` passes the capability gate;
2. compile the updated `app.json` purpose string and existing background-location modes/permissions;
3. retain the current app/runtime versions unless the owner deliberately chooses a separate versioning change;
4. confirm the resolved native Mapbox SDK from generated lock/build metadata rather than inferring it from wrapper 10.3.1;
5. run on a physical iPhone with background permission enabled; Expo Go is not evidence;
6. stop before OTA/release until the minimal and power tests in `OWNER_RETEST_MINIMAL.md` pass.

No EAS cloud build, submission, or signing operation was authorized or run in this repair.

## Supported lifecycle and honesty limits

- Normal app background and screen lock are in scope via the OS location task.
- User force-quit and reboot are not guaranteed to continue or restart collection.
- The OS controls scheduling; `timeInterval` is not a promise of an iOS callback every 15 seconds.
- A background callback still passes owner/consent/epoch and plausibility checks before it can write Memory.
- An active Activity has evidence priority, preventing duplicate passive business observations.
- OFF, logout, privacy reset, revoked permission, stale generation, and owner switch fence pending work.

## Battery design gate

The source design is bounded: one effective Activity acquisition owner, Balanced passive accuracy, 15 m movement threshold, 30 m/15 s deferred batching, automatic native pauses, no per-fix Mapbox request, and bounded recovery backoff. That passes the static/code-level power gate.

No physical battery percentage, GPS/radio duty cycle, thermal trace, or locked-screen execution duration was measured locally. Physical battery acceptance is `DEVICE_PENDING`, and the candidate remains `NATIVE_BUILD_REQUIRED` until the owner test records it.

References:

- https://docs.expo.dev/versions/v54.0.0/sdk/location/
- https://developer.apple.com/documentation/bundleresources/information-property-list/nslocationalwaysandwheninuseusagedescription
- https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates
- https://developer.apple.com/documentation/corelocation/getting-the-current-location-of-a-device
