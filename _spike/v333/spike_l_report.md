# Spike L — Independent verification of "Looking for your position" flicker

Date: 2026-06-25
Verifier: independent subagent (no Spike D context inheritance)

## Verdict on Spike D

**Spike D conclusion is WRONG on root cause attribution.** Spike D claims the user sees a "fog-mask raster re-bind flash" that they verbally mislabel as the loading text. The evidence Spike D provides for this is server-log triangulation showing zero `memory.coord_changed` fires. That evidence is necessary but not sufficient — Spike D never independently disproves the literal `<Text>` could be rendered.

Spike D is correct that:
- The string `"Looking for your position…"` appears in exactly ONE place: `MemoryScreen.tsx:330` (Grep confirmed across `app/src`).
- The string does NOT exist anywhere in `@rnmapbox/maps` source (TS, Swift, Kotlin) nor in any other `node_modules` package (confirmed via Grep on `@rnmapbox`). Hypothesis (b) "Mapbox SDK placeholder text" is FALSE — Mapbox/rnmapbox emits no such literal.
- Hypotheses (a), (c), (d) from the brief are also FALSE: UserLocation puck/accuracy ring renders no text; Camera animation emits no text; LocationServices state changes emit no text.

But Spike D's positive claim — "user is mislabeling a raster flash as text" — is unfalsifiable from server logs alone. The user said "I tested again, still the same". If the user is literally seeing the text glyphs "Looking for your position…", server logs MUST show a `coord_changed → null` event for that frame, OR the log instrumentation is broken.

## Most likely true root cause

The text IS the literal `<Text>` node, and the missing `coord_changed` log is an instrumentation artifact, not proof the text didn't render.

Look at `MemoryScreen.tsx:227-243`:
```
const coordSignature = coord ? `${...}` : 'null';
const prevCoordSigRef = useRef<string>(coordSignature);
useEffect(() => {
  if (prevCoordSigRef.current !== coordSignature) {
    log('memory.coord_changed', {...});
    prevCoordSigRef.current = coordSignature;
  }
}, [coordSignature, ...]);
```

This `useEffect` only fires `memory.coord_changed` when `coordSignature` is *different from the last committed value*. If `coord` flips `value → null → value` within a single React commit cycle (e.g., a Suspense-like re-render where `watcherFix` is briefly evicted from the Zustand store and re-hydrated synchronously, or a `useMemoryStore` selector returning a fresh `null` mid-render before the next snapshot), the effect's stale-closure compare won't see two distinct values — it sees the new `coordSignature` equal to `prevCoordSigRef.current`, fires nothing, and the flash still rendered to screen.

Concretely: `watcherFix` is a Zustand selector. If `setLastWatcherFix` ever calls `set({ lastWatcherFix: null })` even momentarily during a store update (debounce reset, AppState change, etc.), MemoryScreen re-renders with `coord = null`, the else-branch `<Text>` mounts for one paint, then the next state update restores it. The `coord_changed` log effect runs AFTER commit, by which time `prevCoordSigRef` already matches the latest value.

## Modified mapping to brief's a/b/c/d

- (a) UserLocation accuracy ring — REJECTED (no text in SDK)
- (b) ImageSource placeholder — REJECTED (no such SDK feature, no string match)
- (c) Camera animation loading UI — REJECTED (no such SDK feature)
- (d) LocationServices state change — **PARTIAL**: not LocationServices itself, but the Zustand store-backed `watcherFix` momentarily nulling and triggering the literal `<Text>` to mount for 1 frame

Root cause = **(d-variant): transient store-state null causes the real text node to render for one paint**, NOT Spike D's "raster re-bind visual mislabeled as text".

## Required next step before fixing

`memory.coord_changed` instrumentation is unreliable for sub-frame transitions. Replace the effect-based diff with a render-time `log()` call guarded by a ref check, OR add a `useSyncExternalStore`-style subscription on `useMemoryStore` that logs every `lastWatcherFix` value transition INCLUDING `→ null → x` within a single tick. Until that lands, Spike D's "zero coord_changed fires" cannot rule out the literal text.

## Fix candidate (pending instrumentation confirmation)

In `MemoryScreen.tsx:215-221`, hold the last non-null `coord` in a `useRef` and prefer it over `null` for one extra paint cycle when the inputs all evaluate to null. This makes the `<Text>` mount only on true cold-start (ref also null), not on transient store hiccups. One-line guard, no UX regression because stale-fix path already exists for the same intent.

Do NOT ship Spike D's Fix part 1 + 2 (remove `currentZoom`, memoize `RasterLayer`) as the *primary* fix. They may be valid micro-optimizations but they do not address the reported symptom if the symptom is the real text. User said "still the same" — that is consistent with a fix that didn't touch the actual cause.

## Sources

- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/screens/MemoryScreen.tsx` lines 210-243, 287-335
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/components/MemoryMap.tsx` (no text node)
- `C:/ClaudeCodeProjects/Cairn/app/src/features/memory/components/FogLayer.tsx` (no text node)
- Grep `Looking for your position` on `app/src` → 4 files, all comments except MemoryScreen.tsx:330
- Grep `Looking for` on `@rnmapbox` → 0 matches
- WebSearch attempted, blocked by upstream API; node_modules grep is authoritative for the literal-string question
