# Screenshot QA Summary

Reviewed by A-SSQA on 2026-07-28. Final pass — A-PLAY output has been stable for ~9 minutes; treating as complete.

## Totals (final)
- Screens with any screenshots: 9 (auth, home, hiking, running, plant, friends, memory, routes, settings, markerdetail)
- Screens with zero screenshots (never captured by A-PLAY): 2 (mapscreen, mapshistory)
- Total screenshots reviewed: 24
- **PASS**: 17
- **FAIL / BROKEN RENDER**: 1
- **PARTIAL**: 6

## Per-screen breakdown

| Screen | PASS | FAIL | PARTIAL | Total shots | Pending |
|---|---|---|---|---|---|
| auth | 0 | 0 | 1 | 1 | S02-S38 |
| home | 4 | 1 | 0 | 5 | S02-S20, S23, S25-S32 |
| hiking | 1 | 0 | 2 | 3 | S04-S33 |
| running | 1 | 0 | 0 | 1 | S02-S35 |
| plant | 2 | 0 | 1 | 3 | S04-S28 |
| friends | 2 | 0 | 0 | 2 | FS-02 populated + MarkerDetail family |
| memory | 1 | 0 | 1 | 2 | Scene S3-S25 (fog states, hierarchy panel, cairn sheets) |
| routes | 1 | 0 | 0 | 1 | S02-S36 (Routes tab, Flags tab, populated, RouteEditor) |
| settings | 3 | 0 | 0 | 3 | Modal states (password change, delete confirm, sign-out) |
| markerdetail | 3 | 0 | 0 | 3 | Form A Public, Form B stranger, Form C fog, Form D null |
| mapscreen | — | — | — | 0 | ALL — A-PLAY never captured |
| mapshistory | — | — | — | 0 | ALL — A-PLAY never captured |

## Failed screenshots (needs re-shoot or fix)

- **home/S21-iphone-se.png** — BROKEN RENDER. Confirms the Critical bug predicted in `home/AUDIT.md` §S21 and §S32: "Leave a Cairn here" title is clipped at the top by the overlapping Running card at 375×667. The flex 1/1/0.4 card allocation collapses the third card below its content minimum. This is not a shooting problem — the shot is the ground-truth evidence of a real production bug. Recommended fix suggestion #1 in AUDIT.md applies (drop `flex: 0.4` → `flex: 0` + `minHeight: 96`, or hide the card in dense state).

## Partial screenshots (state mismatch or missing empty-state copy)

- **auth/S01-splash-bypassed.png** — Rendered Home (bypass hook active) instead of splash. Auth splash visuals not verified. A-PLAY needs to re-shoot without `__cairnStores` bypass to verify splash animation, wordmark, tagline, OtaBadge inline, and Sign In / Create Account buttons.
- **hiking/S02-route-sheet.png** — Route picker sheet renders correctly, but AUDIT S02 flagged missing empty-state copy ("You have no saved routes yet — try Free Hiking or import a GPX from Routes"). Sheet only shows the single "Free Hiking" row; no explanatory text. Confirms AUDIT S02 finding.
- **hiking/S03-start-attempt-no-gps.png** — State shift: GPS chip escalated amber "Enable GPS" → red "GPS Offline". Route pill DISAPPEARED from the bottom card (only Start Hiking button remains). No error banner or toast explains why Start Hiking is inactive. New emergent finding beyond AUDIT scenarios.
- **plant/S01-plant-entry.png** — GpsLockStep skipped (fast-path resolved before capture); screenshot shows PinAdjustStep. Progress bar animation and accuracy affordance from AUDIT S01/S02 cannot be verified.
- **memory/S01-memory-onboarding.png** — Modal chrome correct; confirms AUDIT S1 finding that map underneath is entirely dimmed with no loading affordance. First-time user has no signal what's happening below the modal.

## Broken UI caught in screenshots (visual evidence beyond audit text)

1. **home/S21-iphone-se.png**: Text truncation confirmed — "Leave a Cairn" title clipped by overlapping Running card at 375×667. Per user policy this is Critical minimum (never cosmetic). Highest-priority OTA fix candidate from this audit round.
2. **hiking/S03-start-attempt-no-gps.png**: Route pill disappears from the bottom card after a failed start-attempt. Not documented in AUDIT.md scenarios. Also "Start Hiking" button stays visually enabled while GPS chip is "GPS Offline" red — mismatched affordance state.
3. **running/S01-running-idle.png**: Confirms BUG-R-01 — "Enable GPS" chip renders in web-mode where permissions aren't a concept. Already documented in AUDIT as Critical.

## Cross-screen consistency findings surfaced

- **Web map fallback inconsistent**: Plant screen renders **real Mapbox map on web** (S01/S02 pin adjust). Hiking + Running fall back to sage placeholder "Real Map (EAS Build)". Same web build, three sibling screens, different fallback behaviour. → CONSISTENCY_REPORT candidate.
- **Primary CTA style drift Hiking vs Running**: Hiking uses white/outlined "Start Hiking" pill; Running uses filled dark-green "Start Running" pill. Both are the same role (primary activity start button on parallel sibling screens). → CONSISTENCY_REPORT candidate.
- **Focus-state inconsistency**: Plant textarea focus = thin dark border. Auth inputs focus = green primary border + primaryBg tint. → CONSISTENCY_REPORT candidate.
- **iconWrap geometry**: Settings uses 32×32 rounded-square (borderRadius 8) throughout Account/Preferences/Legal/Danger cards. Home ToolBtn uses 30×30 circle (borderRadius 15). Cross-screen iconWrap system split. → CONSISTENCY_REPORT.

## Screens with ZERO shots — A-PLAY gap

- **mapscreen/** and **mapshistory/** received zero screenshots during this run. Both directories have AUDIT.md files but no screenshots directory contents. A-PLAY either skipped them entirely or the Playwright fragments for these screens failed silently. **Recommendation**: file a note for the next A-PLAY run to prioritize these two screens.

## Design system baseline

Settings screen (3 shots — all PASS) is the O12 design baseline. Canonical patterns confirmed:
- SectionHeader: uppercase caption, textSecondary, spacing before card.
- ActionRow: 32×32 rounded-square iconWrap, title + optional subtitle, right-aligned value or chevron.
- Card: white surface, rounded corners, subtle shadow, hairline divider between rows.
- Danger Zone: red text for destructive labels, separate titled section, Sign Out in its own card (neutral).
- Footer: italic small text, textMuted color, Māori greeting ("Ngā mihi nui").

## Highest-priority actions

1. **Fix home/S21 iPhone SE clipping** — Critical bug with direct visual evidence.
2. **Re-shoot auth/S01 without bypass** — no splash coverage from this run.
3. **Fix hiking route-pill disappearance on failed start** — new bug found in screenshots, not in AUDIT.
4. **Fix running BUG-R-01 hard-coded "Enable GPS" chip** — visually confirmed.
5. **Cross-screen consistency pass**: web-map fallback (Plant vs Hiking/Running), CTA style (Hiking vs Running), iconWrap geometry (Home ToolBtn vs Settings).
6. **A-PLAY re-run for mapscreen + mapshistory** — zero coverage.
