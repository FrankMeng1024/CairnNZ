# O84 root causes and source changes

## Request lifecycle

The legacy `friend_requests(from_user_id,to_user_id)` unique key treated the
first attempt as the permanent pair identity. Rejecting it therefore left no
safe way to create a fresh same-direction attempt, while the outbound API and
cleanup job removed the only durable sender-visible outcome. Separate
directional duplicate checks also did not serialize opposite sends.

Migration 047 adds immutable attempt history, `sender_dismissed_at`, a
trigger-maintained unordered `pair_key`, and a nullable `active_pair_slot`.
Only `pending` occupies the unique active slot. API pair mutations take the two
user rows in a global numeric order, re-read authority inside the transaction,
and make accept/reject retry behavior explicit. Blocked, cancelled, declined
and accepted are distinct states. The backend refuses to boot on an O83 schema.

Rollback first archives all attempts, then collapses to the newest row per
direction because the legacy schema cannot represent history. The disposable
rehearsal archived all four rows, restored the legacy columns/index, and then
successfully re-applied migration 047.

## Client request truth and UI

The prior client converted request read failures into empty arrays and used
loosely typed boolean mutations. O84 returns typed success/error/superseded
results, carries the authenticated viewer generation through every call, and
uses only server-confirmed request/friend identities. Friends-local state also
has a viewer/generation fence so a late account-A read cannot paint account B.

Friends UI now implements the prompt's exact navigation, action order,
directional copy and per-friend toggle. The approved Pro image informed spacing
and hierarchy only. Existing artwork and icons remain; the only Home glyph
change is an optional weight passed to the existing Leave a Cairn path.

## Friend Fog

O83 coupled the visible result to close-time picker behavior and fetched all
contributors as one unit. That made checkboxes/toasts look successful even
when one projection was slow, revoked, stale or failed. O84 starts a projection
read on each successful selection while the picker remains open. Per-source
sequence, source-generation, account-generation, subscription and
authorization-version checks reject late or stale data. Errors are row-local;
one source cannot blank another or Mine. Deselect/revoke purges only that source
and serializes the durable cache write behind older writes.

The isolated proof uses database-generated eligible exploration cells and the
real HTTP authorization endpoints. The returned cells then pass through the
production stores, tiled geometry builders, `FogLayer`, web Mapbox adapter,
ShapeSource and FillLayer. The QA harness uses a source-free local Mapbox style
and intercepted local session response only to avoid needing a credential; it
does not replace the API polygons or production renderer components.

## Memory preparation

Home now schedules a cooperative Mine-only preparation after interactions,
after a short delay, and only when Activity tracking/transition/finish state is
idle. It imports the existing geometry/cache implementation lazily. A shared
account/content single-flight coordinator lets visible Memory join the same
job; if Home becomes stale and yields no result, visible Memory retries once.
No hidden Mapbox, GPS acquisition, BackgroundTask, force-quit promise or user
toast was introduced.
