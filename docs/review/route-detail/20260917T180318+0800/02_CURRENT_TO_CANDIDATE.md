# Current-to-candidate behavior

| Surface/contract | Task-start behavior | O59 candidate |
|---|---|---|
| Post-create destination | Could remain in editor view mode | Resets to canonical Own Route Detail |
| Trails entry | Opened Route Detail, but identity/loading behavior was uneven | Opens the same stable object; local detail survives server read failure |
| Detail hierarchy | Edit-first, estimated fields, equal actions | Identity, real geometry metrics, origin, primary Use Route, secondary Edit/Delete |
| Unknown/stale ID | Indistinct missing/loading state | Separate loading, not-found, and retryable error states |
| Rename | Optimistic call could conceal failure | Pending payload edit is durable; synced rename waits for acknowledgement and retains old truth on failure |
| Editor draft | Inner and outer saves could read as equivalent | `Apply to draft` changes only draft; `Save Route` commits |
| Back/cancel | Could leave draft meaning unclear | Unsaved-change guard; discard leaves saved Route unchanged |
| Failed editor save | Alert-only behavior | Draft and screen remain, with a persistent understandable failure banner |
| Delete | Large/equal action and weak failure boundary | Secondary confirmation; tombstone for stable local identity; legacy remote delete waits for acknowledgement |
| Origin | Local extras only; lost after server-only reload | Owner-validated Activity identity, creation origin, source/current hashes, edit flag, and explicit Gap reconnect survive server round-trip after deployment |
| Response loss | Idempotency depended on request behavior | Per-owner `client_route_id` converges retries; tombstone prevents resurrection |
| Activity Gap | Section choice existed locally | Activity remains disconnected; explicit reconnect is labeled planned and belongs only to the new Route |
| Use Route | Direct mode behavior was not explicit enough | Detail mode picker -> matching pre-start -> explicit Start; copy says map reference, not turn-by-turn |
| Active Activity | Risk of replacing selection | Existing active-Activity guard wins; mode/reference are not silently replaced |
| Later Route edit during Activity | Live Route object could drift | Start captures an independent reference snapshot |
| Day/Sunset/Night editor | Fixed bright surfaces leaked into non-Day themes | Shared semantic surfaces/foreground roles are used across all three themes |
| No-op controls | Gear/Layers affordance could imply missing functionality | Visible no-op gear removed; no speculative panel added |

