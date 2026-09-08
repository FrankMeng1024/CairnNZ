# Batch 3 OTA correction gate

Focused 390×844 Expo Web evidence for the Friends Profile and Add Friend correction.

The JPG/PNG captures named below are reproducible local-only outputs and are
ignored by Git. Recreate them with
`node app/scripts/batch3-ota-correction-qa.mjs`; the tracked assertions and
runtime-error text remain the durable review evidence.

- `before-after-board.jpg` compares Profile and Add Friend in Day, Sunset, and Night.
- `after/remove-friend-normal-390x844.png` and `after/remove-friend-confirmation-390x844.png` prove the destructive hierarchy.
- `after/overlay-parent-suppressed-390x844.png` proves that underlying list rows and the persistent CTA are suppressed while Add Friend is open.
- `after/assertions.json` records the automated focus, value-retention, first/second backdrop tap, explicit close, and parent-suppression checks.
- `after/runtime-errors.txt` records browser runtime errors observed during the focused pass.

iOS software-keyboard, safe-area, and interactive keyboard-animation behavior still require human native/OTA confirmation because Xcode and Simulator are unavailable in this environment.
