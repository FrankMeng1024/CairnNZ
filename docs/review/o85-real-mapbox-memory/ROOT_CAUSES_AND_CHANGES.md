# O85 root causes and focused corrections

## Route and Activity geometry

Production Routes 92–96 and Activity session 2134 were read only. No saved
Route, Activity, grant, subscription or Fog record was changed.

`Test a 2` is the confirmed destructive case. A closure stroke began at the
current terminal near an older occurrence of the same geography. The Draw
classifier built valid-looking interval replacement options and chose replace
before it considered append. That passed a short candidate into
`replaceOrderedInterval`, which had no Activity-wide destructive-replacement
invariant. Route 96 therefore retained only the short chord while immutable
session 2134 remained intact.

The classifier now gives the current terminal ownership before coincident
interior occurrences. The mutation boundary independently rejects an Activity
replacement that covers at least 80% of the existing vertices and length but
shrinks that interval below 35%. The second guard is intentional defense in
depth: a future classifier regression or a forced intent cannot bypass it.

`Test a 1` was a provider-policy failure, not a painted line cap. Current
walking Directions returns 1,528.71 m for endpoints 198.88 m apart, a 7.69×
detour. Point previously accepted it because the start/target shifts remained
within snapping tolerances. Nearby Point candidates now also need a bounded
route/direct ratio; rejection preserves the Route and suggests Draw rather
than fabricating a pedestrian chord or whole-Activity retrace.

For `Test1`, `Test2` and `Test3`, production preserves only saved canonical
geometry. The historical native finger pixels, map-local projection, camera
transform, original provider request/response and selection trace do not
exist. Current walking Map Matching accepts all three saved paths and closely
tracks their saved lengths, but that cannot identify the first historical
divergence. The implementation therefore fixes proven future behavior only:
a shape-divergent or genuine no-match Draw retains the actual captured line
with manual provenance, and accepting an already highlighted occurrence does
not run Mapbox again. There is no smoothing or rewrite of the Owner's Routes.

## Editor ownership

Trim preview and committed history previously had separate owners. Undo could
move history without closing/resetting the preview. Undo now reconciles the
preview first, resets fractions, enters Browse and performs at most one valid
history transition.

Point's Retry UI did not distinguish a transient provider failure from a
completed no-route decision. Retry is now reserved for a frozen transient
request. No-route and absurd-detour responses return to movable Point mode;
Cancel and tapping Point again both exit cleanly. Existing operation ID,
revision and abort fences remain the single mutation authority.

Normal Draw shape divergence and valid no-match were also routed through an
extra decision state. Selecting an already known interval could then restart
matching and strand `Finding`. These paths now commit the preserved raw line
once as `draw-manual`. A real network failure remains pending and never becomes
a fake success.

## Friend Fog and Route exploration

The Route editor exposed a combined label but never hydrated the subscription
and projection stores. It now uses the same viewer-scoped stores as Memory,
loads selected projections, forwards `combined` to `FogLayer`, and does not
change grants, selections or camera.

Two renderer defects were independently reproduced. First, changing authority
discarded an already authorized Mine mask while combined tiles were prepared,
causing the first-tap flash. Second, the module cache stored the main combined
mask but not its friend/overlap classification shapes. Reusing that cache after
Mine→Friends made the build effect see an exact signature and exit with no
visible friend color. Mine is now a safe transition fallback, while any scope
with friend cells rebuilds the bounded classification shapes.

The production-data failure had two separate causes. Source A's 16 historical
Activities predated independent Memory collection; valid timestamped native GPS
had never been attributed into cumulative Memory. An idempotent backfill
recovered 415 accepted points and left 913 unprovable observations unknown.
Source B had nine delayed accepted rows, but the retired 250 m endpoint/private-
place mask removed every derived cell. O85 removes that obsolete mask, retains
explicit one-way grants and the 30-minute delay, and rebuilds materialized
projections. Production now returns 19 + 49 = 68 cells.

Current-session reauthorization makes durable Fog fail closed across focus,
logout and account switching. Passive source status and projection use the same
server-accepted presence witnesses. Post-deploy production payloads render in
both Memory and Route through live Mapbox WebGL; this is not represented as
native iPhone proof.

## Bounded UI corrections

- The planning map renders the installed RNMapbox `UserLocation` only after
  permission and map readiness, without camera following or Route mutation.
- Context actions share compact visible geometry with 44 pt effective targets.
- Friend picker name, status and accessory slots remain geometrically stable.
- The Friends scope action sits beside its label while preserving its hit area.
- Directional sharing status stays in the flexible text column.
- Duplicate accepted/outgoing/incoming emails are classified before mutation;
  the keyboard and sheet remain stable on inline errors.

No icon, visual direction, app/runtime/build version or native dependency
changed. Backend source, migrations 049/050 and scoped Cairn internal test data
did change under the Owner's authorization.
