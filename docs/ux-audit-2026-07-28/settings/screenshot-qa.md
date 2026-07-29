# Screenshot QA — settings

Reviewed by A-SSQA on 2026-07-28. This is the O12 baseline screen per multiple audits — every other screen's consistency is measured against it.

## S01-settings.png — PASS
- Expected: Header (Back + centered "Settings" title), Account card (avatar + name + email + Change password row), Your Progress section (2 stats cards side-by-side), Preferences section (Units row + Haptic feedback toggle), About & Legal section beginning.
- Observed:
  - Back button top-left (pill, green chevron), centered "Settings" h1.
  - Account card: green circle avatar with "P" initial, "Playwright" bold name, "pw@cairn.nz" email subtitle. Divider. "Change password" row with chevron.
  - "YOUR PROGRESS" section header (caption/uppercase textSecondary) + small info icon.
  - Two stats cards side-by-side, each in white surface with rounded corners:
    - Left: green circle with footprint icon (matches Running color), big "0" number, "places explored" subtitle.
    - Right: sepia circle with cairn glyph, big "0", "cairns planted" subtitle.
  - "PREFERENCES" section header.
  - Preferences card: "Units" row (rounded-square icon + "Distance and elevation" subtitle + "Kilometres / metres" value + chevron), divider, "Haptic feedback" row (icon + subtitle + green toggle switch — ON).
  - "ABOUT & LEGAL" section header.
  - Legal card: "Check the weather / Opens MetService NZ" with external-link icon; divider; "Send feedback / Feedback, safety report, or bug — with optional screenshot" with chevron; divider; "Privacy Policy / How we handle your data" with external-link; divider; "Terms of Service / Apple's standard app terms — a Cairn-specific version is coming" with external-link; "About Cairn" partially visible at bottom with "v0.2.5 · O16" version.
- All elements match the O12 design system baseline: SectionHeader (uppercase caption) + rounded-square iconWrap 32×32 (borderRadius 8) + card with divider between rows + tokenised colors. No visual defect.

## S01-settings-fullpage.png — PASS
- Expected: Same content, fullpage may extend below viewport.
- Observed: Visually identical to S01 viewport shot at this scroll position. Fits viewport at Pro Max scale.

## S02-settings-scrolled.png — PASS
- Expected: Scrolled view showing lower sections — About & Legal continuation, Danger Zone, Sign Out, footer.
- Observed:
  - Top of scroll shows tail of Preferences (Units row partial + Haptic feedback row).
  - "ABOUT & LEGAL" section fully visible: Check the weather / Send feedback / Privacy Policy / Terms of Service / About Cairn (v0.2.5 · O16 shown on same row as About Cairn label — right-aligned metadata).
  - "DANGER ZONE" section header.
  - Danger card: "Reset my map memory" (red text, "Clears every place you have walked. Your hikes and cairns are kept." subtitle, chevron), divider, "Delete account" (red text, "Permanent — opens confirmation before we email our team" subtitle, chevron).
  - Separate card: "Sign out" row (dark text — NOT red, unlike Reset/Delete) with "Your walks stay saved" subtitle + chevron.
  - Footer: italic textMuted "Ngā mihi nui — thanks for using Cairn." (Māori for "many thanks" — good cultural touch, matches NZ launch strategy).
- All elements match O12 baseline. Danger Zone uses red text for destructive actions but Sign Out is neutral in its own card (below Danger Zone) — good visual separation of "destructive" vs "just log out".

---

## Summary for settings
- **PASS**: 3 (S01 viewport, S01 fullpage, S02 scrolled)
- **FAIL**: 0
- **PARTIAL**: 0
- **Not shot yet**: Interaction states — password change modal, Delete account confirm modal, Sign out confirm, Units modal, Reset map memory confirm (all pending A-PLAY output)

### Design system baseline confirmation
This is the reference screen for the O12 design system. The following patterns are cleanly demonstrated and should be treated as canonical:
- Section header: uppercase caption, textSecondary color, spacing before card.
- ActionRow: 32×32 rounded-square iconWrap (borderRadius 8), title + optional subtitle, right-aligned value or chevron.
- Card: white surface, rounded corners, subtle shadow, hairline divider between rows.
- Two-column stats grid: circle icon + big number + caption.
- Danger Zone: red text for destructive labels, neutral subtitle, in its own titled section.
- Footer: italic small text, textMuted color, Māori greeting.

Cross-screen deviations from this baseline (documented in home/running audits):
- HomeScreen ToolBtn: 30×30 CIRCLE iconWrap (borderRadius 15) — differs from Settings' 32×32 rounded-square.
- HomeScreen ActivityCards: colored backgrounds (#eef4e8 / #e8f1f8 / #fff5e9) — intentional deviation for activity color coding.
- Sign-in / Create Account primary buttons: minHeight 56 vs Apple/Google 52 — audited in auth AUDIT.

### Broken UI caught (visual evidence beyond audit text)
- None from these three shots. Settings screen renders cleanly and demonstrates the design baseline correctly.
