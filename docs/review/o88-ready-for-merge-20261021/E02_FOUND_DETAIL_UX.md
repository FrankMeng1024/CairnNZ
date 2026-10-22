# E02 — Found Detail visual and interaction closure

## Delivered experience

The acquired note, bounded source identity, acquisition time and exact retained version remain the primary surface. Persistent `Manage this collection` prose and the always-visible Archive/Remove row were replaced by one accessible approximately 44-point secondary Manage control. It opens the shared `BottomSheetFrame` family with separate Archive and Remove actions and consequence copy at decision time.

Remove uses a deliberate in-sheet confirmation and Cancel. Archive remains reversible under the existing implementation. Remove is described as stopping future automatic encounters with no current in-app restore; it is not described as erasing other users, returning the note to the world, or destroying retained history.

Collection operations are single-flight and account-bound. Cancel and server/network failure retain the exact page, note and sheet; 403/404/410 invalidate authority. A late account-A response cannot close or mutate account B's replacement view.

## Evidence

- Focused interaction suite: 12/12 within the exact-final 246-suite app run, including duplicate taps, archive/remove failures, Cancel/Close, page preservation, success return and account transition.
- Found Detail matrix: 24 settled screenshots, 9/9 base theme × viewport/content cells, Day/Sunset/Night, 360×780 / 390×844 / 430×932, English and Chinese, 1/2/5 versions, Manage and confirmation in all themes, loading/empty/network failure/under-review/offline states, action failure/success and a 135% Web zoom stress case. Runtime errors: 0.
- Focused Web video SHA-256: `a898633ddce36ebc37f7bd2aa55294ced84f6f5c54a7259dde0b64f863d04f73`.
- The screen Git object is identical at `863acbc…` and exact source `c3b765e…`: `8de0f644beb6a8e0f59212a9ef1b8f18cca8d7e1`. The later source change affected only the Web Mapbox adapter and its guard test.
- Exact-final core journey: 26 actual Expo Web captures. Hosted Mapbox made 39 requests, completed 36, failed 0; one request was intentionally aborted by explicit reload. Runtime errors: 0.

Exact-final motion wall times were Save 386 ms, retained Update failure 1,157 ms, successful Update 1,024 ms, Withdraw 670 ms, normal Close 464 ms, Archive 1,006 ms, exact revision Open 1,764 ms, and Reduce Motion Close 210 ms. These include network/navigation settlement, not animation duration alone.

One retained cold-run diagnostic measured Reduce Motion Close at 702 ms against the harness's 700 ms wall guard. Source inspection confirmed the reduced branch completes synchronously; the warm repeat measured 210 ms. The cold failure is preserved and classified as cold Metro/navigation scheduling variance, not silently discarded.

## Human quality judgment and boundary

Normal-scale review found the short note intentional rather than stranded, long English and five-version Chinese content readable, Manage subordinate but discoverable, destructive hierarchy clear, and Day/Sunset/Night surfaces distinguishable. The 135% browser zoom sheet remained reachable and scrollable, but background wrapping at that artificial narrow effective width is Web stress evidence—not native Dynamic Type proof.

Blocked pending native hardware: Dynamic Type, VoiceOver focus/rotor, physical keyboard compression, haptics, native frame timing and iOS/Android Mapbox rendering. No native claim is made.
