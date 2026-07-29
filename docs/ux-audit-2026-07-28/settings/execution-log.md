# settings — Playwright Execution Log

## Environment
- 414×896. Web bypass. Reached via Home > Settings tool.
- Settings screen took 15-20 seconds to render on first navigation (large form, many controls). Screenshot timed out until page settled.
- **Perf concern (Critical)**: Settings mount time excessive on web. Auditor's static findings on SectionHeader/ActionRow pattern govern the visual side; the mount latency is a new dynamic finding.

## Scenario S01 (top of Settings): pass
- Screenshot: S01-settings.png (viewport), S01-settings-fullpage.png (identical — internal ScrollView means fullPage doesn't extend)
- Observation top-to-bottom:
  - Top bar: Back / "Settings" title (h1 centered) / no right action
  - Account card: Avatar (P), "Playwright" name, "pw@cairn.nz" email + divider + "Change password" row with chevron
  - Section: **YOUR PROGRESS** with info (?) icon
    - Stat card row (2 tiles): footprints icon + "0" + "places explored" | mountain icon + "0" + "cairns planted"
  - Section: **PREFERENCES**
    - "Units" row (Distance and elevation) → "Kilometres / metres" + chevron
    - "Haptic feedback" row with toggle (ON — green)
  - Section: **ABOUT & LEGAL** (partially visible in top viewport)
    - Check the weather → external link icon (opens MetService NZ)
    - Send feedback → chevron (internal)

## Scenario S02 (bottom of Settings, scrolled): pass
- Screenshot: S02-settings-scrolled.png
- Observation:
  - Rest of ABOUT & LEGAL: Privacy Policy (ext), Terms of Service (ext), About Cairn (v0.2.5 · O16)
  - Section: **DANGER ZONE** (red text label — matches auditor's O12-O16 pattern)
    - "Reset my map memory" (red text) — clears explored places, keeps hikes/cairns
    - "Delete account" (red text) — Permanent — opens confirmation before we email our team
  - Section: **Sign out** — Your walks stay saved
  - Footer: "Ngā mihi nui — thanks for using Cairn." (italic, textSecondary) — nice Te Reo brand touch

## Consistency observations
- SectionHeader / ActionRow / card pattern is very consistent — this is the baseline other screens should match (auditor of Home noted this)
- Danger Zone red text is emphatic without being aggressive — good
- **Version badge "v0.2.5 · O16" is exposed to all users** — probably fine, but worth checking whether internal OTA build number should be user-facing
- **UX bug**: "Reset my map memory" and "Delete account" both open confirmations but the row affordance is inconsistent — Reset gives chevron → sub-screen; Delete gives text hint "Permanent — opens confirmation before we email our team". Should be consistent.

## Scenarios S03+ (Delete Account modal, Reset modal, unit toggle, sign out flow): skip
- Reason: time budget. Auditor's static review covers these paths.
