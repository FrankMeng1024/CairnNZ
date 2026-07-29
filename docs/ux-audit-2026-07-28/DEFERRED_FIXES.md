# Deferred Fixes — Not 100% safe

## iPhone SE Home overlap (Blocker, from A-SSQA)
- **Screenshot**: home/screenshots/S21-iphone-se.png
- **File**: HomeScreen.tsx:482-495 (Leave a Cairn card, flex={0.4})
- **Analysis**: cardsArea has 3 cards flex 1+1+0.4 = 2.4 units. On 375x667 iPhone SE with header + toolsRow taking ~200px, remaining ~400px / 2.4 = ~166px per unit. Leave a Cairn gets ~66px — insufficient for icon + title + subtitle + chevron + accentLine, causing overlap.
- **Why deferred**: Fix requires either (a) minHeight per card, (b) different layout on small viewports, (c) removing accentLine on flex<1 cards. All are design decisions.
- **Recommended for morning**: Move Leave a Cairn to a smaller row style (e.g. wrapped inside toolsRow, or below toolsRow), OR add `minHeight: 80` to ActivityCard so small-flex cards remain readable.

## Telemetry default vs privacy policy contradiction (Critical, from LAUNCH_CHECKLIST 2.6)
- **File**: useSettingsStore.ts:54 (default true), privacy.html:37 ("only when you have opted in")
- **Analysis**: two valid fixes: (a) change default to false + add first-run opt-in prompt, (b) update privacy.html copy to say "on by default, toggleable in Settings"
- **Why deferred**: Legal/privacy team should sign off on which direction
- **Recommended**: Ask user in morning. If pressed, go with (b) since it matches actual code behavior and doesn't break existing users.

## Hardcoded Home card tints (Medium, from CONSISTENCY)
- **File**: HomeScreen.tsx:464,474,487,488
- **Values**: `#eef4e8`, `#e8f1f8`, `#fbe9d8`, `#fff5e9`
- **Analysis**: Colors.runningCardBg exists but is `rgba(61,122,181,0.08)` — different tint. Adding new tokens (hikingCardBg, plantCardBg, plantLightBg) OR remapping tints would change appearance.
- **Why deferred**: Design decision.

## Missing Delete Account backend (Blocker from LAUNCH_CHECKLIST 1.1)
- **File**: SettingsScreen.tsx:1108 (mailto), backend/src/routes/ (no DELETE /api/account)
- **Analysis**: Needs full backend endpoint + 7-day soft-delete + cron cleanup + email confirm
- **Why deferred**: Requires backend work + email infrastructure

## Apple Sign In implementation (Blocker from LAUNCH_CHECKLIST 1.5)
- **File**: AuthScreen.tsx:1132-1145 (Alert.alert stub)
- **Why deferred**: Requires native OAuth + Apple Developer setup + backend token verification

## Google Sign In implementation (Blocker from LAUNCH_CHECKLIST 1.5)
- **Why deferred**: Same as Apple

## Cairn EULA (Blocker from LAUNCH_CHECKLIST 1.2)
- **Why deferred**: Legal drafting required

## iPad layout support
- **Why deferred**: Major layout work

## Push notifications
- **Why deferred**: Missing subsystem

## Full i18n framework
- **Why deferred**: Missing subsystem, English-only for launch is acceptable per LAUNCH_CHECKLIST 6.1
