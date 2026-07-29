# friends — Playwright Execution Log

## Environment
- 414×896. Web bypass. Reached via Home > Friends tool.
- `/api/friends` + `/api/friends/requests` fail (CORS) — expected on web.

## Scenario S01 (empty state): pass
- Screenshot: S01-friends-empty.png
- Observation:
  - Top bar: Back (white pill) / "Friends" (centered title) / "Add" (green pill with icon)
  - Empty state hero: illustration of 2 cairns connected by dotted trail, title "Cairn is better with trail companions", subtitle "Invite friends to share markers and stay connected on the track."
  - Primary CTA "Add a Friend" (solid green pill with icon)
- **Consistency**: Two "Add" affordances (top-right pill + center CTA) — top-right is compact, center is emphasized. Good on empty state but should probably hide the top-right one when list is empty to reduce duplication.

## Scenario S02 (Add a Friend sheet): pass
- Screenshot: S02-add-friend-sheet.png
- Observation: Bottom sheet with:
  - Users icon in circle
  - Title "Add a Friend"
  - Subtitle explaining flow: "Send them a friend request inside Cairn — they accept it next time they open the app."
  - Label "Their Cairn email" + email textbox with mail icon + placeholder "The email they signed up with"
  - Primary CTA "Send Request" (muted/disabled state, paper plane icon)
  - Text link "Cancel"
- **UX bug**: No visible way to close the sheet by tapping backdrop — must use Cancel text link
- **Consistency**: sheet has same shape as Plant route sheet (S02 in Plant audit); good pattern reuse

## Scenarios S03+ (Send Request success/error, friend list populated, remove friend, etc.): skip
- Reason: backend CORS-blocked on web; no injectable test state.
