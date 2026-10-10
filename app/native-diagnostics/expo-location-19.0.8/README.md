# Native GPS callback evidence — iOS build gate

Status: `SOURCE_READY / NATIVE_BUILD_AND_DEVICE_REQUIRED`.

The current Cairn binary can prove Expo/JavaScript receipt, filtering, WAL,
store publication, synchronization and Final selection. It cannot prove that
`CLLocationManagerDelegate` fired before Expo delivered a callback. Missing JS
logs therefore do not identify an iOS-native cause.

This directory contains an exact-version, coordinate-free instrumentation
candidate for `expo-location@19.0.8`:

- `CairnNativeGpsEvidence.swift` writes a 512 KiB local JSONL ring outside the
  callback thread. It records receipt and observation clocks, source, batch
  count, accuracy bounds, lifecycle and permission state, but no coordinates.
  Version 2 also records a process-run ID, explicit retention epochs and a
  60-second collector heartbeat. It reads an opaque Activity scope only on its
  utility queue, so raw native evidence is exportable only to its exact owner.
- `expoLocationIosPatch.js` verifies SHA-256 identities for the three upstream
  Expo sources, then inserts four boundary calls: foreground/background native
  callback receipt and foreground/background handoff toward JS/TaskManager.
- `nativeGpsPatchContract.test.ts` runs the transformation against the exact
  installed package and fails closed on any source/version drift.
- `nativeGpsEvidence.ts` creates the opaque owner-scoped context without
  blocking Start, fails closed for the old unscoped v1 file, and emits an
  export-time cross-ledger report. Callback-to-native-delivery batch IDs are
  exact; native-delivery-to-JS remains explicitly time-window evidence because
  the Expo payload is intentionally unchanged. A current binary reports
  `not-observable-current-binary` explicitly.

The transformer is intentionally not wired into `app.config.js`. Enabling it
changes native pod sources and therefore requires a new signed binary. The
owner gate must add an explicit prebuild integration, compile both Swift and
Objective-C hooks, and validate on a physical iPhone. In particular, verify:

1. the generated `ExpoLocation-Swift.h` import name for the pinned pod;
2. callback latency and energy overhead during a multi-hour background track;
3. foreground and TaskManager native batch-ID correlation after process
   restarts, plus the documented lack of a shared per-point JS payload ID;
4. a cold airplane-mode route, lock-screen delivery, and foreground recovery;
5. heartbeat behavior while iOS is active/backgrounded/suspended, file
   protection, retention epochs, Settings export and owner privacy purge;
6. zero change to Expo location payloads, cadence, filter inputs and ordering.

Do not infer native callback failure until a binary containing these hooks has
captured native evidence (or its explicit absence while its own heartbeat is
known to be running).
