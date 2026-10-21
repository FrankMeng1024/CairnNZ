# E03 — dependency and runtime decisions

## Reproducible state

- Node `v24.11.1`, npm `11.6.2`, macOS 12.7.6 x86_64.
- App lock SHA-256 `a6522139ccf62a45651c74949305bf6076f92333042c9f2f566539ec59a484ae`.
- Backend lock SHA-256 `f6543d77cab299be4524041ef228f8e7b47f8625dc1797522dfc2a0332ba46bb`.
- App `npm ci --ignore-scripts`: exit 0 with peer warnings; the legacy-peer variant also exits 0.
- Backend `npm ci --ignore-scripts`: exit 0.
- App `npm ls --all` and omit-dev variants: exit 1 because the installed v8 umbrella includes `@vis.gl/react-mapbox` with a GL >=3.5 peer while root GL is 2.15.0.
- Exact `npx tsc --noEmit --pretty false`: exit 2, exactly the recorded 159 diagnostics, zero delta and zero diagnostics in closure-changed files.

## Audit result and reachability

App full audit reports 50 high + 16 moderate = 66 package entries; omit-dev reports 26 high + 16 moderate = 42. Backend full and omit-dev audits report 0. Aggregate findings on `expo`, Expo modules and `react-native` are effects of the leaf chains below, not separate proof that packaged screen code executes the vulnerable function.

| Leaf chain | Installed exposure | Decision |
| --- | --- | --- |
| `node-forge` via Expo CLI / `expo-updates` CLI code-signing tools | Build/CLI certificate generation and verification; not imported by `expo-updates` runtime entry | Update through an Expo-supported toolchain. Protect CI inputs/signing material. Do not force-upgrade a transitive leaf. |
| `postcss` via `@expo/metro-config` | Metro/Web build CSS and source-map parsing | Treat untrusted build assets as hostile; upgrade with Expo. Not a backend request path. |
| `image-size` via Metro | Build-time asset dimension parsing | Do not feed user-controlled assets into the build; update with Metro/Expo. |
| `ws` via Expo CLI/Metro/dev middleware/jsdom/devtools | Development/build/test WebSocket services | Never expose dev servers publicly; upgrade with supported parents. Not the production backend WebSocket stack. |
| `brace-expansion`, `braces`, `micromatch` | Expo CLI, Metro, React Native codegen and Jest glob processing | Build/test denial-of-service surface; use trusted repositories/inputs and supported parent upgrades. |
| `sprintf-js` → `argparse` → `js-yaml` | Istanbul/Jest configuration | Test/tooling only in this app; update through test toolchain. |
| `uuid` → `xcode` → Expo config plugins | Native project/config generation | Build-time; update through Expo config tooling. |

This is a justified reachability classification, not “all 42 safe.” Compromised repository/build inputs can still attack developer or CI processes. No `audit fix --force` was run. Backend audit 0 does not prove application-level security; the real authorization/MySQL suites are separate evidence.

## Mapbox decision

Installed native `@rnmapbox/maps@10.3.1` declares `mapbox-gl ^2.9.0`; root `mapbox-gl@2.15.0` satisfies it. `react-map-gl@8.1.1` exposes two Web paths: official v8 guidance requires `/mapbox` for GL >=3.5 and `/mapbox-legacy` for GL <3.5. The app incorrectly used `/mapbox`; exact source now imports `/mapbox-legacy` for both values and `MapRef`. A source guard prevents regression, scoped TypeScript passes, and the exact-final hosted GL2 Mapbox run has zero failed resources/runtime errors.

The package still installs its unused `@vis.gl/react-mapbox` GL3 subtree, so `npm ls` remains non-zero. Runtime is supported as currently locked, but dependency metadata is not clean. An integration owner may retain v8 legacy with the documented install warning or approve a coordinated dependency change; do not install a second GL major or upgrade native Mapbox blindly. Native proof still requires an iOS and Android build/device run. Sources: react-map-gl v8 upgrade guide (`https://visgl.github.io/react-map-gl/docs/upgrade-guide`) and RNMapbox install/rebuild guidance (`https://rnmapbox.github.io/docs/install`).

## Other compatibility decisions

`npx expo install --check` exits 1 because unused `react-native-view-shot@5.1.1` differs from Expo 54's expected 4.0.3. No app or QA source imports it. Removal or Expo-compatible downgrade changes the native matrix and requires Owner approval plus native build evidence; it was not changed here.

`node-cron@4.6.0` exact-final smoke validates all six production expressions/entry names, six stopped registrations, two real executions, zero overlaps, overlap prevention, stop without further execution, destroy/shutdown and registry return to baseline. Result: PASS.

Decision: **safe enough as currently locked for independent merge review and verified Web execution; native release remains blocked pending supported dependency resolution/build proof.**

## Separate whole-app visual issues

The historical global audit remains a separate release track: Trails control density, sparse Memory states, inconsistent legacy detail sheets, weak Sunset separation, broad green Night planes, and local surface/color drift in Settings/Hiking/Running/Memory/Mystery Cairn. The Found Detail sheet now uses the canonical shared frame. No new Cairn P0/P1 was demonstrated; this closure does not claim a new exhaustive whole-app audit.
