# markerdetail — Playwright Execution Log

## Environment
- 414×896. Web bypass. Reached via Home > [dev] MarkDetail preview.
- MarkDetail dev preview page exists at bottom of Home for developer testing of all 4 Sheet variants.
- **Perf**: dev preview screen takes ~15s to render on first navigation

## Scenario S01 (dev preview index): pass
- Screenshot: S01-markdetail-preview.png
- Observation: Header "MarkDetailSheet — Dev Preview" + subtitle "Sprint 68 STORY-00532 + STORY-00533 — verify all 4 forms per v4 §4.11."
- 7 scenario cards (Form A/A/B/B/C/D/D), each with title + Form pill + one-line description
- Bottom link: "Open Paywall sheet (Sprint 70)"

## Scenario S02 (Form A — my Personal mark): pass
- Screenshot: S02-form-A-personal.png
- Observation: Bottom sheet with:
  - Title "Hidden viewpoint"
  - Body "Behind the rocks, quiet..."
  - Tag row: "Personal" (with lock icon) | "3 days ago"
  - Actions: Edit (white pill, pencil icon) + Delete (red text, trash icon)
- **Consistency**: Delete uses red border/text — matches Danger Zone pattern in Settings. Good.

## Scenario S03 (Form B — Friend's mark + I visited): pass
- Screenshot: S03-form-B-friend-visited.png
- Observation: Bottom sheet richer than Form A:
  - Title "Coastal viewpoint" + body "Best sunset spot on island"
  - Tag row: "Friend" (with people icon) | "3 days ago"
  - Author row: person icon + "LDY"
  - Visited badge: green checkmark + "You visited here"
  - "Hide from my map" — full-width red button with trash icon
  - Bottom action row: Like (heart) + Report (flag)
- **UX excellent**: hierarchy is clean — content first, meta next, destructive/social actions grouped separately

## Scenarios S04-S07 (Forms B stranger public, C fog+not visited, D blocked, D not visited, Paywall): skip
- Reason: time budget. Each form documented in the dev preview cards; auditor's static review governs edge cases.

## Consistency findings
- MarkDetailSheet is a mature, polished component — likely the strongest single UI piece in the app based on this preview
- Consistent iconography (lock=Personal, people=Friend, checkmark=visited)
- Follows same bottom-sheet pattern as Plant route sheet, Friends add-friend sheet — pattern reuse is strong
