# memory — Playwright Execution Log

## Environment
- 414×896. Web bypass. Reached via Home > Memory tool.
- No real GPS on web → permission needed state shown by default.

## Scenario S01 (first-visit onboarding modal): pass
- Screenshot: S01-memory-onboarding.png
- Observation: Full-screen modal on top of Memory screen:
  - Top bar: Back / (no title on Memory) / Mine/Friends segmented tabs on right
  - Modal card: "Walk to unlock your memory" title (h3 800 weight)
  - Body: "The map starts covered in fog. As you walk around, the fog clears and the places you have been become part of your memory."
  - "Cairns left by you and others appear as you discover them."
  - CTA "Got it" — solid dark brown/orange with white text (matches Plant compose CTA color)
- **Excellent UX**: this modal explains the core mental model of Memory (fog-of-war exploration) — probably one of the strongest onboarding beats in the app

## Scenario S02 (location permission needed state): pass
- Screenshot: S02-memory-permission-state.png
- Observation:
  - Empty background (no map — because permission denied on web)
  - Text stack: "Location permission needed" title + "Memory needs your location to draw the map." subtitle
  - Primary CTA "Open Settings" (solid brown)
  - Secondary link "Try again" (plain text)
- **UX bug**: On web, "Open Settings" won't do anything useful (no OS setting to open in browser). This flow is iOS-specific. On web the CTA should either be hidden or say something else.
- **Consistency**: "Open Settings" uses same dark-brown/orange as "Got it" (from onboarding) — good.
- **UX friction**: no map/fog preview shown behind the message. User has no visual sense of what Memory will look like once enabled.

## Scenarios S03-S05 (fog map, marker discovery, Friends tab): skip
- Reason: requires GPS + backend `/api/circle/fog` + `/api/memory-subscriptions` (both CORS-blocked). Not testable on web.
- Consistency check with Home top-right memory badge (per Auditor observation): cannot verify on web with no data.
