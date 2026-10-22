# Encounter notification capability

## What is implemented

- Expo SDK `~54.0.35`, React Native `0.81.5`, `expo-notifications ~0.32.17`, `expo-location ~19.0.8`, and `expo-task-manager ~14.0.9` are installed.
- iOS declares the existing location background mode and location usage descriptions; the Notifications config plugin is present.
- After a successful `/api/cairn-memory/discover` transaction, the server enqueues one `memory_hit` notification per presentation group.
- `memory_hit` defaults off. Migration 054 resets historical rows off because no prior value could represent informed O88 consent.
- Settings exposes explicit encounter-notification enable/disable. Permission is requested only from the user action; later login resume does not prompt and requires server preference authority.
- The push token must register successfully before enable reports success.
- Foreground notification presentation suppresses a duplicate system banner while the in-app encounter card is available.
- Payloads contain kind, notification log id, presentation group id, and viewer id. They contain no note, author identity, or coordinates.
- Tap/cold-start handling reauthorizes viewer identity after auth hydration, refreshes authoritative retained state, and navigates to exact acquired detail only when unambiguous; otherwise it opens `I found`.
- Account switching clears stores and rejects mismatched payload viewers.

## What is not proven

- APNs/Expo receipt, lock-screen display, Focus/summary timing, haptic, and tap behavior on an installed iPhone are **NATIVE PENDING**.
- The passive background location task currently journals evidence. This branch does not establish that it performs a server discovery request in background or while terminated. Therefore background/terminated acquisition and “instant encounter” are not claimed.
- iOS decides background execution opportunities; a notification cannot guarantee immediate delivery.
- No EAS Build was run and no native binary was changed or deployed.

## Minimal iPhone proof

1. Use an Owner-approved non-production or isolated QA backend with a real second account and one qualified marker.
2. Install a build containing the declared native plugins; verify notification settings before enabling in-app.
3. Enable Encounter notifications explicitly and verify server `memoryHits=true` plus one registered device token.
4. Perform foreground acquisition; record durable acquisition id, one notification-log row, and whether foreground banner is suppressed.
5. Repeat background/locked using real current GPS evidence. Record acquisition separately from enqueue, provider receipt, system display, and tap.
6. Test permission denied, offline recovery, account switch, withdrawn content, and app termination without asserting guaranteed background execution.
7. Inspect notification payload/logs for absence of coordinates, note text, and author identity.
