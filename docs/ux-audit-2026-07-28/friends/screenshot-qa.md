# Screenshot QA — friends

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's expected states in `friends/AUDIT.md`.

## S01-friends-empty.png — PASS
- Expected (FS-01 empty state): SafeAreaView header ("Friends" title + Back button + top-right "Add" pill), then centered `EmptyState`: `IllustrationHalo` + `EmptyFriends` (192px), heading "Cairn is better with trail companions" (h2 center), body copy, primary "Add a Friend" CTA.
- Observed:
  - Back button top-left (pill), centered "Friends" title, top-right green filled "Add" pill button with user-plus icon — matches header spec.
  - Center illustration: sepia/tan gradient rectangle band with 3 small cairn/stone piles at both ends connected by a dashed golden-tan trail. Simple, on-brand.
  - Heading "Cairn is better with trail companions" — bold h2, single-line centered on this width. Warm tone matches Cairn voice.
  - Body: "Invite friends to share markers and stay connected on the track." — centered, textSecondary sepia.
  - Primary CTA: filled dark-green "Add a Friend" pill with user-plus icon.
- All elements match AUDIT expected UI. Heading fits on one line at ~430px width (no wrap concern at this viewport). AUDIT noted 320px viewport wrap concern which cannot be checked at this width.

## S02-add-friend-sheet.png — PASS
- Expected (add-friend flow): Bottom sheet slides up over dimmed empty state. Sheet contains header icon (users glyph in green circle), "Add a Friend" title, subtitle explaining flow, "Their Cairn email" label + email input, "Send Request" primary button (may be disabled when empty), Cancel link.
- Observed:
  - Dimmed backdrop over the empty state (empty state faintly visible under 55% grey overlay — matches audit spec `rgba(20,20,20,0.55)`).
  - Bottom sheet with top drag handle.
  - Header icon: green circle with two-person icon (matches `Users` lucide glyph, `Colors.primary` bg).
  - Title "Add a Friend" bold h2 centered.
  - Subtitle: "Send them a friend request inside Cairn — they accept it next time they open the app." — warm, product-appropriate copy.
  - Label: "Their Cairn email" (small caption above input).
  - Input field: white rounded pill with mail icon + placeholder "The email they signed up with".
  - Primary button: pale sage-green muted "Send Request" pill with paper-plane icon — DISABLED state (correct for empty email input).
  - Bottom: "Cancel" text link.
- All elements match AUDIT expected UI. Disabled state visually distinct (pale bg) from enabled Add pill in header (saturated dark green). Good.

---

## Summary for friends
- **PASS**: 2 (S01 empty, S02 add-friend sheet)
- **FAIL**: 0
- **PARTIAL**: 0
- **Not shot yet**: FS-02+ populated list, FS-03+ pending requests, MarkerDetail family, MarkDetailSheet, MarkerPin (all pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- None from these shots. Empty state and add-friend sheet render cleanly.
