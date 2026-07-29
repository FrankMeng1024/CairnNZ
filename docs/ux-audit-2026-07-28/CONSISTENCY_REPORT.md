# Cross-Screen Consistency Report — 2026-07-28

**Auditor**: A-CONS
**Method**: Read 13 per-screen AUDIT files + `SettingsScreen.tsx` (O12 baseline) + `tokens.ts` (design system). Extract patterns by primitive and flag mismatches.
**Baseline**: `SettingsScreen.tsx` O12-O16 (`ActionRow` / `ToggleRow` / `SectionHeader` / `card` grouping / `TypeToConfirmModal`).
**Tokens source of truth**: `C:\ClaudeCodeProjects\Cairn\app\src\components\tokens.ts`
**Note**: this is a *cross-screen* pass. Per-screen bugs already logged by A1-A12 are not repeated here except where they compose into a system-level pattern.

---

## Executive summary

Cairn's design system is **strong at the token level and drift-y at the composition level**. `tokens.ts` is well-defined (Colors / Spacing / Radius / FontSize / IconSize / Shadow), and Settings/Auth/Routes/Home mostly use these tokens. The problems are:

1. **Danger red is fragmented** — 3 different reds coexist for destructive UI (`Colors.danger #c53d2e`, `#b25a48`, `#c44545`).
2. **Card backgrounds are fragmented** — Home hardcodes 4 pale tints (`#eef4e8`, `#e8f1f8`, `#fbe9d8`, `#fff5e9`) not in `Colors`.
3. **MarkerDetailScreen is the outlier** — uses `MemoryColors.sepia*` / `cairnPublic` cross-feature palette + 20+ hardcoded hex/px values. It reads like a different app.
4. **The `Route` icon is semantically overloaded** — Home stat chip + Home Trails tool + Routes tab-bar. Same glyph for three different destinations.
5. **`numberOfLines={1}` guards are inconsistent** — Flag names have them, Route names don't; ToolBtn labels have them, ActivityCard titles don't; MarkerDetail title/body have none at all. Overflow policy is not uniform across the app.
6. **Sheet vs Modal vs Alert** — used interchangeably for destructive actions. Settings has TypeToConfirmModal, MarkerDetailSheet has two-stage red button, MarkerDetailScreen uses native `Alert.alert`, Running Discard has *no* confirm at all.
7. **Icon system is Lucide-only in principle** — but voice memo (Plant S20) uses emoji "🎤", MarkerDetail approximate row uses caution icon inconsistently, and the Google sign-in "G" is a hand-rolled monochrome block that violates Google Brand Guidelines.
8. **Tap-target < 44pt HIG** — flagged in Settings (eye toggle, ⓘ, attach ✕), Plant (zoom/style/target 36px), Memory (scope toggle ~28px), Pin adjust (36×36), Auth (eye padding 4px). Systemic accessibility gap.
9. **Loading pattern varies** — ActivityIndicator (Settings/Auth/Feedback), custom spinner + progress bar concurrent (Plant GPS), text-only "Loading friends' routes…" (Routes Friends), null-render blank green (MapHistory), "coming soon" alert (MapHistory Plan Route). No unified spec.
10. **Empty states have no shared vocabulary** — Home has none, Routes-Activities has none, Routes-Routes has IllustrationHalo + CTA, Friends has IllustrationHalo + CTA, MapHistory has icon + CTA, Memory has world-fog with modal-once-only. Same product, five different "you have nothing yet" languages.

Below, findings are tabulated by primitive.

---

## Design system compliance

### Danger red — 3 distinct values in codebase

| Where | Value | Source |
|-------|-------|--------|
| Settings Reset memory row / Delete account row `labelColor` | `#b25a48` | SettingsScreen (per A9 §A22, §A25) |
| Settings `TypeToConfirmModal.btnConfirmDestructive.backgroundColor` | `#c44545` | SettingsScreen (per A9 §C1) |
| `tokens.Colors.danger` (canonical) | `#c53d2e` | tokens.ts:29 |
| MarkerDetailSheet "Confirm Delete" state | `Colors.danger` (canonical) | markerdetail AUDIT §S32 |
| FAB badge in MapScreen | `Colors.danger` (canonical) | mapscreen §16 |
| Running Stop button | `danger` red (canonical) | running §20 (unspecified hex) |
| Auth apiBanner | `dangerBg` (canonical) | auth §S19 |
| RouteEditor Delete alert (destructive style) | Native iOS destructive red | routes ROUTE_EDITOR §27 |

**Recommendation**: Consolidate all three literal hex reds (`#b25a48`, `#c44545`, `#c53d2e`) to a single canonical `Colors.danger`. If designer needs a softer "rose" for row labels, add `Colors.dangerSoft` to tokens.ts and reference it — do NOT let one-off hex live in components. Native `Alert.alert` uses OS red — acceptable.

**Severity**: Medium (visible when Reset memory row (rose) sits next to Confirm modal button (bright red)).

---

### Card backgrounds — 5 distinct tints in codebase

| Where | Value | Source |
|-------|-------|--------|
| `Colors.surface` (canonical white) | `#ffffff` | tokens.ts:23 |
| `Colors.surfaceMuted` (canonical cream chip/banner) | `#F5F0E5` | tokens.ts:24 |
| Home Hiking card `cardBg` | `#eef4e8` (pale green) | HomeScreen (A1 §Hardcoded) |
| Home Running card `cardBg` | `#e8f1f8` (pale blue) | HomeScreen (A1) — note `Colors.runningCardBg` = `rgba(61,122,181,0.08)` exists but different value |
| Home Leave-a-Cairn left panel `lightBg` | `#fbe9d8` (flag orange tint) | HomeScreen (A1) |
| Home Leave-a-Cairn body `cardBg` | `#fff5e9` (pale cream) | HomeScreen (A1) |
| Settings card bg | `Colors.surface` white | Settings baseline |
| MarkerDetailScreen edit chip active bg | `'rgba(0,0,0,0.03)'` | markerdetail §5.1 line 638 |
| MarkerDetailScreen `MemoryColors.cream` | (out-of-scope palette) | markerdetail AUDIT §2 |

**Note**: `Colors.runningCardBg` exists but Home Running card uses `#e8f1f8` instead — token drift on the same concept.

**Recommendation**: Move all 4 Home tints into `tokens.ts` as first-class named tokens (`Colors.hikingCardBg`, reuse `Colors.runningCardBg`, `Colors.flagLightBg`, `Colors.flagCardBg`). MarkerDetail should stop importing `MemoryColors` for anything outside the memory feature scope. Alignment with future dark-mode support hinges on this.

**Severity**: Low individually, Critical cumulatively (MarkerDetail alone contains 20+ hardcoded pixel/color values per A12 §5.1).

---

### Text tokens — hardcoded font sizes found

| Screen | Value | Should be |
|--------|-------|-----------|
| Home `cardStyles.title` | `fontSize: 20` literal | `FontSize.h2` (20) |
| Home `toolStyles.label` | `fontSize: 11` literal | `FontSize.small` (11) |
| Home recentStyles.row `paddingVertical: 10` | magic | not in `Spacing` scale |
| Home toolStyles.iconWrap `width/height: 30, radius: 15` | magic | doesn't match Settings iconWrap 32/8 |
| Auth `splashCta` (S38) | inline `fontSize: 12, marginTop: 12, lineHeight: 16` | tokens |
| Auth `staySignedIn` uses `Colors.textMuted` at same size as `divText` | slot-color collision | should have hierarchy |
| MarkerDetail title `fontSize: 24, fontWeight: '600'` | out-of-scale (h1=28, h2=20) | pick h1 or h2 |
| MarkerDetail body `fontSize: 14` | `FontSize.body` (15) |
| MarkerDetail multiple counters `fontSize: 10` / `11` / `12` | not tokenised | pick from scale |
| Plant title counter `fontSize: 10` | not tokenised | `FontSize.small` (11) |
| Route trackStatValue `FontSize.caption` (13) for primary stat display | wrong level for a hero metric | should be `FontSize.body` or larger |

**Total**: MarkerDetailScreen has ~20 hardcoded font/color/spacing values (A12 §5.1). Home has ~10 magic-number layout values (A1). Auth has ~5 inline styles bypassing tokens (auth §S38).

**Severity**: Medium — visible when navigating Settings → MarkerDetail, feels like two different apps.

---

## Button styles

### Save / Update button

| Screen | Style | Loading state | Disabled state |
|--------|-------|---------------|----------------|
| Settings Change password Update | `PressBtn` primary green, spinner replaces label | `ActivityIndicator` white | opacity 0.6 |
| Settings Feedback Send | `PressBtn`, spinner replaces label | `ActivityIndicator` white | opacity 0.5 |
| Auth Sign In / Create Account | primary btn `minHeight: 56` + green pill, spinner + label | `ActivityIndicator` white | opacity 0.5 |
| Auth Apple button | black pill `minHeight: 52` | n/a (unimplemented) | n/a |
| Auth Google button | white pill `minHeight: 52` + border | spinner + "Connecting…" (flashes 1 frame — no real OAuth) | n/a |
| Hiking StopSummarySheet Save | green solid, spinner + "Saving…" | ActivityIndicator size=small #fff | opacity 0.7 |
| Running Stop button | danger red gradient | n/a | n/a |
| Plant "Plant Cairn" | primary, no spinner, label swaps to "Planting…" | text-only ("Planting…") no spinner | opacity 0.4, no explanation |
| RouteEditor view-mode Save | primary flex:1 with icon+label, `ActivityIndicator` replaces content | ActivityIndicator | opacity 0.4 but touch still fires |
| MarkerDetail edit Save | primary, `ActivityIndicator` on save | ActivityIndicator | (see A12 §5.4 offline gap) |
| MarkerDetailSheet Delete | two-stage: gray → red "Confirm Delete" | n/a | n/a — no timeout on confirm state |
| Feedback Attach Send | ActivityIndicator + `feedbackSending` | opacity 0.5 | disabled at text < 3 chars |

**Inconsistencies**:

- **Auth CTA height mismatch**: Sign In `minHeight: 56` vs Apple/Google `minHeight: 52` → 4px step in the same button column (auth §S03 / §10).
- **Save button feedback varies**: Auth/Settings/Hiking show spinner. Plant shows text-only. RouteEditor spinner replaces the label. No single pattern.
- **Disabled state feedback varies**: opacity 0.4 (Plant, RouteEditor) vs 0.5 (Auth Google) vs 0.6 (Settings Update password) vs 0.7 (Hiking Save). All different for the same concept.
- **Running Plant button `disabled` has no visible disabled treatment at all** (running §26 / BUG-R-15) — Critical, contrasts with every other button in the app.
- **Some "disabled" buttons still fire the press animation** (RouteEditor view-save uses `activeOpacity=0.85` while `disabled=true` — misleading, per routeeditor #2 / C-5).

**Recommendation**: Publish a single `PressBtn` variant (primary / secondary / destructive) with fixed loading + disabled treatments, and require every save/submit/destructive CTA to use it. This is a Definition-of-Done bar for the next UI Sprint.

**Severity**: Medium.

### Cancel / Back / Discard

| Screen | Pattern |
|--------|---------|
| Settings | `BackButton` pill (top-left) |
| Auth all views | `BackButton` pill + `titleRow` w/ CairnLogo (hack: `marginTop: -7` on login/register but not verify → 7px baseline drift, auth §S37) |
| Routes header | `BackButton` pill + centered title + `<View style={{ minWidth: 60 }} />` right-spacer (fragile hard-coded 60px, routes §S01) |
| Hiking mid-track back | `BackButton onPress={() => nav.goBack()}` **no confirm** (hiking §33) |
| Running stopped-screen back | `BackButton inline` **no confirm** on real session (running §30 BUG-R-17) |
| Plant step 1 Cancel | plain `TouchableOpacity` text link "Cancel" |
| Plant step 2 Back | `BackButton pill` |
| Plant step 3 Back | `BackButton pill` |
| RouteEditor edit-mode Cancel | `Alert.alert('Discard edits?', ...)` — but only on Android hardware back; iOS soft `BackButton` bypasses (routeeditor C-4, Blocker) |
| MarkerDetailScreen edit Cancel | inline "Cancel" button in bottom action row |
| StopSummarySheet Discard | **one-tap = data gone, no confirm** (hiking §25, Critical) |
| MarkerDetailSheet Delete | two-stage "Delete → Confirm Delete" red state |
| Auth privacy expanded close | tap "Privacy Policy" link again to collapse (S36) |
| Sheet backdrop dismiss | RouteSheet ✓, MarkDetailSheet ✓, RoutePicker (Running) has NO scrim color (invisible backdrop, running §6 / BUG-R-05) |

**Blocker inconsistencies**:

- **RouteEditor iOS BackButton silently discards edits** (routeeditor #50 / C-4). iOS-only path, data loss.
- **StopSummarySheet Discard has no confirmation** (hiking §25). Contrasts with UnfinishedRecoveryModal which requires two-button interaction.
- **Hiking mid-track BackButton no confirm** during active tracking (hiking §33).

**Medium**:

- **Auth CairnLogo alignment hack** — `marginTop: -7` in login/register `titleRow`, no hack in verify — 7px baseline drift (auth §S37).
- **Plant step 1 uses text-link Cancel; steps 2/3 use pill BackButton** — two different patterns for the same "leave the flow" action (plant §S26).
- **Route picker backdrop** in Running has no scrim color (running §6). Every other bottom sheet has one.

**Recommendation**: All destructive back-navigation (unsaved edits, active hike discard, mid-track back) requires a `TypeToConfirmModal` or at least a native `Alert.alert`. Publish `<BackButton onDiscardConfirm={...}>` variant.

---

## Icon overloading

The `Route` Lucide icon appears in **three different roles**:

1. Home stat chip: "N sessions" (HomeScreen A1 §S28)
2. Home Trails tool button (bottom row)
3. Routes tab-bar segment (RoutesScreen "Routes" tab)

The `Map` icon appears in:

1. Home Memory tool button
2. RoutesScreen empty state icon
3. MapScreen fallback title icon

The `Users` icon appears in:

1. Home Friends tool button
2. Memory Scope toggle "Pick friends"
3. Marker permission chip (group visibility)

The `Target` icon appears in:

1. Plant PinAdjust recenter button
2. Memory Recenter button
3. Running Route pill (picker trigger)

**Concern**: When a user sees the `Route` icon in the Home stat chip and immediately below it the `Route` icon on the Trails tool button, the visual system says "these are the same thing" — but they navigate to different destinations (nowhere vs `Routes` screen). Same for `Target` (Plant vs Memory: both are "recenter" but on different maps).

**Recommendation**:
- Trails → change to `Compass` or `MapPin` glyph (per A1 recommendation).
- Marker permission group icon → keep `Users`, but consider `UserRound` to distinguish from Friends nav.
- Memory Recenter and Plant Recenter — same semantics, keep `Target`, but never allow a *different* recenter action to use the same icon.

**Severity**: Low individually, Critical for the "Route" case (three distinct semantic slots in one screen family).

---

## Sheet vs Modal vs Alert

| Screen | Destructive/confirmation action | Pattern |
|--------|--------------------------------|---------|
| Settings Reset memory | Type "clear track" | `TypeToConfirmModal` |
| Settings Delete account | Type "delete account" | `TypeToConfirmModal` (mailto flow — App Store risk per A9 §A25) |
| Settings Sign out | Web: `window.confirm`; iOS/Android: `Alert.alert` | Platform-forked |
| Settings Change password success | Inline green text, 1.5s → forced logout | ephemeral text |
| Auth Apple/Google buttons | Coming soon | `Alert.alert` |
| Auth privacy expanded | inline expandable region (`ScrollView` 220px maxHeight) | inline |
| Hiking Stop | `StopSummarySheet` bottom sheet slides up 280ms | Bottom sheet |
| Hiking Discard from StopSummary | one-tap, no confirm | **none** (Critical bug hiking §25) |
| Hiking UnfinishedRecoveryModal | 2 buttons Continue/Discard | Modal |
| Hiking TooShortSheet | 2 buttons Got it/End anyway | Sheet with scrim `rgba(0,0,0,0.55)` |
| Routes Activities long-press | `ActivitySheet` bottom sheet (only "View" button — CC-1 redundant) | Bottom sheet |
| Routes Routes long-press | `RouteSheet` bottom sheet | Bottom sheet |
| Running Stop | goes to stopped-screen (full replace) | full-screen state |
| Running TooShortSheet | 2 buttons | Sheet |
| Running Route picker | Bottom sheet, NO scrim color | Bottom sheet (styling bug) |
| Plant step 1 GPS retry | Retry button | inline button |
| Plant step 2 Confirm | Confirm button | inline button |
| Plant step 3 Submit | "Plant Cairn" | inline button |
| Plant commit failure | `Alert.alert('Could not plant cairn', ...)` w/ raw error string | Native alert |
| MapScreen tap marker | `MarkDetailSheet` bottom sheet | Bottom sheet |
| MapScreen viewOnly deep link | `EditMarkerSheet` auto-opens | Sheet |
| MapScreen Delete marker | `Alert.alert` | Native alert |
| MapScreen Hide marker | `Alert.alert` | Native alert (post UX-Med-4 fix, honest copy — mapscreen §826) |
| MarkerDetailScreen full screen from Routes | full screen | Screen |
| MarkerDetailScreen delete | `Alert.alert` | Native alert |
| MarkerDetailSheet (Hiking-map bottom sheet) | two-stage Delete (gray→red confirm state, no timeout — Critical) | Bespoke two-stage button |
| Memory hint on cold entry | `Modal animationType="fade"`, no backdrop-tap dismiss | Modal |
| Memory permission denied | Two-button "Open Settings" / "Try again" | inline hero |
| Memory reveal cairn | `RevealedCairnSheet` w/ 3 disabled action pills (like/report/hide handlers never wired — Blocker per A7 §S14) | Bottom sheet |
| Friends Add friend | `AddFriendSheet` matching Hiking sheet | Bottom sheet |
| MapHistory delete list-mode | inline red button below list w/ 2-tap confirm | inline |
| MapHistory delete detail-mode | inline red equal-weight w/ Save-as-Route | inline |

**Findings**:

- **`MarkerDetail` has two presentations**: full screen (from Routes / MarkerDetailScreen) and bottom sheet (from HikingMap). Two very different UIs for the same underlying entity. Confirmed intentional (A12 §1) but the API for what user sees when they tap a pin varies by entry point — this is fine as a decision, but the presentations should share the same visual language (currently MarkerDetailScreen uses `MemoryColors.sepia*` while MarkerDetailSheet uses `Colors.textPrimary`).
- **Destructive actions use 5 different patterns**: TypeToConfirmModal (Settings) / two-stage red button (MarkerDetailSheet) / native `Alert.alert` (MapScreen, MarkerDetail, RouteEditor) / no-confirm one-tap (Hiking Discard, Hiking BackButton mid-track) / inline 2-tap (MapHistory). No single spec.
- **"Coming soon" placeholders coexist**: Auth Apple/Google (`Alert.alert`), MapHistory Plan Route (`Alert.alert`), Plant voice memo (`🎤 …coming soon)` disabled box, MarkerDetailSheet handle bar (visual affordance without gesture — dark pattern, A12 §S40). Four different ways to say "not yet built".

**Recommendation**: Publish a decision matrix — destructive-with-recovery → sheet-with-scrim + 2 buttons; destructive-irreversible → TypeToConfirmModal; informational → toast/banner; blocking OS-native failure → Alert.alert. Kill the "handle bar without PanResponder" dark pattern (MarkerDetailSheet §S40).

---

## Loading indicators

| Screen | Pattern |
|--------|---------|
| Settings any Save | `ActivityIndicator` size=small color=#fff replacing button label |
| Auth Sign In / Create Account | `ActivityIndicator` in button |
| Auth Google Loading | text swap "Connecting…" (flashes 1 frame — no real OAuth) |
| Auth Splash cold boot | staged AnimatedCairn 2.5s (setInterval every 16ms — performance concern low-end iOS) |
| Hiking Save success | `ActivityIndicator` + "Saving…" label, sheet retains 30s |
| Running Locked distance/pace acquiring | "-- km · -- min/km" dashes only (no "GPS acquiring" state, running #11 / BUG-R-08) |
| Plant GPS lock progress | ActivityIndicator **AND** deterministic 4px progress bar concurrent (double loading signal, plant §S02) |
| Plant Submit | text-only "Planting…" (no spinner) |
| Routes Friends loading | text-only "Loading friends' routes…" no spinner/skeleton (routes §S16, §S28) |
| Memory GPS acquiring | ActivityIndicator + "Looking for your position…" 12s timeout |
| Memory tile loading | Staged copy: 0-2s "Loading map…" / 2-5s "Loading your trails…" / 5s+ "Network is slow" |
| Memory slow-network banner | Frosted-pill white banner with spinner (memory §S21) |
| MapScreen tile load | `mapContainer` shows `Colors.primaryBg` sage — NO spinner/skeleton (mapscreen §1) |
| MapScreen loadingCircle / loadingSubs | subscribed in state but **never rendered** (mapscreen §44/45 — dead state) |
| MapHistory route data fetch | renders `null` in map area (blank green) for up to 15s (mapshistory §31, Medium) |
| RouteEditor lazy-loading points | no loading indicator; empty state shown (routeeditor §2, Critical) |
| RouteEditor enter-edit | ActivityIndicator subtle inside Edit button + fake error "Loading route data — please try again in a moment." (routeeditor §26, Critical — loading disguised as error) |
| Friends Add sheet Send | `ActivityIndicator` in button |

**Findings**:

- **5 different loading vocabularies**: (1) button-spinner + label swap (Settings/Auth/Hiking/Friends — canonical), (2) text-only "Loading…" (Routes Friends), (3) staged copy over time (Memory), (4) null-render blank map (MapScreen, MapHistory, RouteEditor), (5) double indicator (Plant).
- **Memory's staged loading is the best pattern** — it acknowledges perceived latency and communicates progress honestly. But no other screen uses it.
- **MapScreen/MapHistory/RouteEditor blank-screen loading is the worst pattern** — user cannot distinguish "loading" from "broken". A 15s wait with no signal is unacceptable per Performance Standards.

**Recommendation**: Publish one loader spec — `<InlineLoader>` for buttons (spinner + label swap) and `<AreaLoader>` for maps/lists (spinner + short copy, `Colors.textSecondary`). Delete `loadingCircle`/`loadingSubs` dead state OR render them (mapscreen §44/45).

**Severity**: Medium (individually), Critical cumulatively (MapScreen, MapHistory, RouteEditor all have silent long waits).

---

## Empty states

| Screen | Style | CTA |
|--------|-------|-----|
| Home (0 sessions, 0 markers) | No dedicated hero. Cards float on `Colors.bg`. Stats row hidden. | none (home §S02) |
| Auth splash (logged-out) | Cairn animation + wordmark + Sign In / Create | full CTA (canonical) |
| Routes Activities empty | `EmptyState icon="Map"` + copy + IllustrationHalo/EmptyRoutes 192px | **NO CTA** (routes §S05 Critical, CC-6) |
| Routes Routes empty | Hero + illustration + copy + "View Activities" primary CTA | CTA (good, canonical) |
| Routes Flags empty | Hero + illustration + copy + "Plant a new mark" CTA | CTA (good) |
| Friends empty | IllustrationHalo + EmptyFriends 192px + heading + body + "Add a Friend" CTA | CTA (canonical, friends §FS-01) |
| MapScreen empty (0 markers) | No dedicated empty state — MapBottomPanel likely blank (mapscreen §3) | none (Blocker) |
| MapHistory empty | Icon + "No sessions yet" + subtitle + "Start a Hike" CTA (but uses `nav.replace` — removes MapHistory from back stack, mapshistory §28) | CTA (broken back stack) |
| Memory zero-points | Solid world fog, no CTA. Only the onboarding Modal explains once. | none (memory §S7 Medium) |
| Memory Friends-scope 0 subs | Silent — fog looks identical to Mine-scope with same points. Misleading (memory §S3, Critical) | none |
| Auth verify page (waiting) | Single input with placeholder "123456" (not 6 cells) | inline (canonical inconsistency, auth §S08) |
| Plant flow (no permissions) | Two-button "Open Settings" / "Try again" | 2 CTAs (Memory §S5 does similar) |
| RouteEditor empty (no points loaded) | Empty stats row, blank map, empty name field | none (Critical, routeeditor §2) |
| MapScreen viewOnly deep-link to deleted marker | Falls through to empty list (mapshistory §46 for MapHistory equivalent) | Critical — should say "Session not found" |

**Findings**:

- **5 distinct empty-state visual languages**:
  1. Full hero + Lucide icon + illustration halo + CTA (Routes Routes/Flags, Friends — best pattern)
  2. Icon + text + CTA no illustration (MapHistory — but broken back stack)
  3. Icon + text no CTA (Routes Activities — dead end for first-time user)
  4. Cards without hero (Home)
  5. Silent nothing (Memory zero-points, MapScreen 0-markers, RouteEditor no-points)
- **Illustrations** (`IllustrationHalo` + `EmptyRoutes` / `EmptyFriends`) exist for Routes and Friends but not Activities/Home/MapScreen/Memory.

**Recommendation**: Every list screen must have a hero + IllustrationHalo + CTA when empty. Home needs an explicit "your first cairn awaits" hero for first-run zero-state. Routes Activities is the highest-impact gap because it's the primary entry point for the app's core data.

**Severity**: Critical (Routes Activities, Home, RouteEditor, MapScreen).

---

## Header patterns

| Screen | Pattern |
|--------|---------|
| Settings | `BackButton pill` top-left, no title |
| Auth (all views) | `BackButton` + `titleRow` (CairnLogo 28px + h1 title 800-weight) with `marginTop: -7` hack on login/register only (auth §S37, verify view has no hack → 7px drift) |
| Routes | `BackButton` left + centered "Routes" title + right spacer `minWidth: 60` (fragile) |
| MapScreen | `SafeAreaView edges={['top']}` + Back chip + GPS chip stacked with `Spacing.lg` paddingTop → 79pt from top on Dynamic Island phones (mapscreen §5 / §39) |
| Home | `SafeAreaView edges={['top','bottom']}` + floating absolute `<OtaBadge>` top-right + no explicit top-bar |
| Hiking | full-bleed map + floating BackButton + GPS/route chips |
| Running (locked/unlocked) | full-bleed map, no explicit header, stats bar at top |
| Plant | 3 different headers per step (Cancel text-link / BackButton pill / BackButton pill) |
| Memory | topBar SafeAreaView + BackButton left + MemoryScopeToggle right (memory §S22) |
| RouteEditor | floating BackButton over full-bleed map, no title in header |
| MarkerDetailScreen | SafeAreaView + Back + type badge + optional SyncBadge + visibility badge — three badges wrap at 375 (markerdetail §S29) |
| MarkerDetailSheet | 40x4 handle bar + close X + type badge |
| MapHistory list mode | "Route Map" title (mapshistory §24 — user came from History, expected "History") |
| MapHistory detail mode | "Activity Detail" title + centered with 60px right spacer |
| Friends | topBar with BackButton + "Friends" title + "Add a Friend" pill right (added v373 fix, aligned dimensions with BackButton) |
| OtaBadge | inline on Auth splash (32px fixed slot) vs floating absolute on Home |

**Findings**:

- **OtaBadge behaves differently on Auth vs Home** — inline vs absolute-positioned. When switching between the two, the badge visually jumps (home §S01 8/10).
- **Auth CairnLogo alignment hack** — verify view is 7px lower than login/register due to `marginTop: -7` inconsistency (auth §S37).
- **MapScreen paddingTop stacks with SafeAreaView inset** — wastes space on Dynamic Island phones (mapscreen §5, §39).
- **Routes title-row uses fragile right-spacer hack** (`minWidth: 60`) instead of a proper 3-col layout (routes §S01).
- **MapHistory list mode calls itself "Route Map"** but user entered from Home > History (mapshistory §24 Low).
- **MarkerDetailScreen 3-badge header wraps at 375** (markerdetail §S29).
- **Plant flow has 3 different header patterns per step**.

**Recommendation**: Publish `<AppHeader title? leftAction? rightAction?>` component. Fix Auth CairnLogo hack by wrapping `<TitleRow icon title />`. Kill the Routes 60px spacer hack. Fix Auth OtaBadge to use the same absolute/inline treatment as Home.

**Severity**: Medium.

---

## Text truncation guards (`numberOfLines={1}`)

Screens that **have** `numberOfLines` guards on user-generated text:
- Home ToolBtn label (`{1}`) — good
- Auth verify view input (single-line by default)
- Routes Flag card `flagName` (`{1}` + `ellipsizeMode="tail"`) — good
- Running route pill `activeRouteName` — good (line 515)
- Friends `nothing` — see below
- MarkerDetailSheet has `title numberOfLines={1}` (only in sheet, not full screen)
- Settings ActionRow labels — implicit single-line by design

Screens/components **missing** `numberOfLines` guards:
- Home ActivityCard title (S15) — static today, risk if i18n'd
- Home `plural(sessions.length, 'session')` — unbounded but text-fixed
- Routes Route card `cardTitle` — user-editable name (routes §S18, **Critical**, CC-3)
- Routes Activity card title/meta — no guard (routes §S18 same class of bug)
- Routes Route picker `routePickerName` (running §5 / BUG-R-04, hiking §36, Critical)
- Friends `FriendCard.name` and `.meta` — long names wrap 2 lines, shifts online-dot column (friends §FS-16 Medium)
- Friends request-summary sub line (`slice(0,2).join(', ')`) — 16+ char names overflow silently (friends §FS-04)
- Auth welcome-name `appName` at 56pt — no `numberOfLines`, no `adjustsFontSizeToFit` (auth §S11 / §S26)
- MarkerDetailScreen title/body — no guards (markerdetail §S16 / §S18 / §S19, **Blocker**)
- MarkerDetailSheet note — no guard (markerdetail §S35, sheet expands unbounded)
- RouteEditor `viewSummaryName` TextInput — no `maxLength` (routeeditor #6 / C-5, Blocker; also §37)
- MapScreen type card labels — labels like "Landmark" may wrap at 78px width on iPhone SE (mapscreen §19)
- MapScreen note input `numberOfLines={2}` is iOS hint only, not enforced (mapscreen §283)
- MapHistory `routeCardTitle`, `routePrimary`, `routeMeta` — no guards (mapshistory §41, Critical)
- Running `lockSecondary` row — no flex-wrap on 320w devices (running §13 / BUG-R-09)
- Running `routeLabel` (compass area) — no `numberOfLines` (running §32 / BUG-R-18)

**Cross-cutting rule** (from Cairn memory `feedback_truncate_is_bug`): truncation/clipping/overflow = Critical, never cosmetic.

**But the opposite is also true**: unbounded wrapping that pushes layout is equally a bug. Currently the app has **both failures simultaneously**:

- Some screens truncate silently → violates the memory rule.
- Some screens over-wrap → breaks layout.
- The consistent rule (every user-facing user-generated text gets `numberOfLines={1}` + `ellipsizeMode="tail"` + `maxLength` on inputs) is not enforced anywhere.

**Recommendation**: Add ESLint rule / audit to reject `<Text>` on user-generated content without `numberOfLines`. Enforce `maxLength` on every `TextInput` that persists (route name 60, marker title 30, marker body 200, friend note 50 — already varied). Bump Auth `appName` and MarkerDetail title to `adjustsFontSizeToFit`.

**Severity**: Blocker cumulatively (this is a shipping-visible pattern of layout breakage).

---

## Tap targets (< 44pt HIG)

| Screen | Element | Effective size |
|--------|---------|----------------|
| Settings | Password eye toggle | ~34×40 (A9 §A3) |
| Settings | Attachment ✕ button (hitSlop 6) | ~32×32 (A9 §A16) |
| Settings | Progress ⓘ helpBtn (hitSlop 8) | ~38×38 (A9 §A9) |
| Auth | Password eye button (padding `Spacing.xs`=4) | < 44pt (auth §S05) |
| Plant | +/- zoom buttons | 36×36 (plant §S11) |
| Plant | Style toggle button | 36×36 (plant §S12) |
| Plant | Recenter Target button | not measured but small (plant §S15) |
| Memory | MemoryScopeToggle segment | ~26-28px tall (memory §S3, Critical) |
| Routes | SegmentControl tab | `paddingVertical: 10` — 30-35px height (routes §S02 / §S04) |
| Friends | Add Friend pill in top bar | not confirmed 44pt (friends §FS-06 Medium) |
| MapScreen | GPS chip amber label | inert `<View>` — but even as CTA would be small |
| MapScreen | Permission pills in CreateMarkerSheet | `Spacing.xs`=4 vertical padding, marginal (mapscreen §24) |
| RouteEditor | Permission chips | 12pt caption text + 6px vertical → ~28px (routeeditor §10, Medium) |

**Rule**: Apple HIG minimum tap target is 44×44pt. Anything below is an accessibility bug.

**Recommendation**: Publish a single `<TapArea minSize={44}>` wrapper or enforce hitSlop everywhere. Consolidate the eye-toggle icon size and padding across Auth + Settings.

**Severity**: Cumulative Critical for accessibility. Individually Medium.

---

## Card styles

| Screen | Background | Border | Radius | Shadow |
|--------|------------|--------|--------|--------|
| Settings card | `Colors.surface` (white) | 1px `Colors.border` | `Radius.card` (14) | `Shadow.card` |
| Settings profile card | same | 1px | 14 | same |
| Home Hiking card | `#eef4e8` (hardcoded pale green) | white-alpha | `Radius.cardLg` (20) | `Shadow.card` |
| Home Running card | `#e8f1f8` | white-alpha | 20 | same |
| Home Leave-a-Cairn (2-panel) | `#fbe9d8` + `#fff5e9` | white-alpha | 20 | same |
| Routes Route card | `Colors.surface` | 1px border | 14 (per baseline) | Shadow.card |
| Routes Activity card | `Colors.surface` + `borderLeftColor: accent` | 1px + accent stripe | 14 | Shadow.card |
| Friends FriendCard | `Colors.surface` | 1px | (default) | Shadow.card |
| Friends dashed CTA "Add" card | dashed primary border on surface | dashed 1.5px | (per convention) | none |
| MapHistory session card | `Colors.surface` + activityMode accent | 1px | 14 | Shadow.card |
| MapHistory pending session card | `Colors.surface` + `opacity: 0.55` | 1px | 14 | Shadow.card |
| MarkerDetail edit-mode field wrap | `'rgba(0,0,0,0.03)'` (hardcoded) | 1px `Colors.border` | 12 (`Radius.md`) | none |
| MarkerDetail typeChip | outlined | 1.5px `Colors.border` | 18 (hardcoded pixel) | none |
| RouteEditor view-mode bottom panel | `Colors.surface` (pure white) | none | 20 (`Radius.sheet`) | `Shadow.elevated` |
| DebugScreen row | `#fff` each row (per-row card style) | none | 14 | Shadow.card (mismatched with Settings' single-card + dividers) |
| PlantScreen bottom bar | (not audited by A5 but flows) | | | |

**Findings**:

- **Home cards are visually distinct from every other screen** — deliberately colour-coded per activity. Defensible design choice. Not a bug, but should be tokenised (see Card backgrounds section).
- **Routes uses accent-stripe cards** (`borderLeftColor: accent`) while MapHistory uses accent-stripe + activityMode color — same entity (session), two different card visual languages (mapshistory §1 / CC vs A6).
- **DebugScreen uses per-row cards** while SettingsScreen uses grouped-card + divider — dev-facing screens should share pattern (A9 §C7).
- **MarkerDetail edit-field wrap uses `rgba(0,0,0,0.03)`** instead of `Colors.surfaceMuted` (A12 §5.1). Not tokenised.
- **Card corner radius** — Settings is 14, Home 20, MarkerDetail is 12 (`Radius.md`). Three different radii for "a card".

**Recommendation**: Publish `<Card variant="default|hero|debug|dashed">` where each variant maps to one radius+bg+border+shadow combo. Deprecate all hardcoded card styles.

**Severity**: Medium.

---

## Toast / Alert / Banner patterns

| Screen | Success feedback | Error feedback |
|--------|-----------------|----------------|
| Settings Change password success | inline green text 1.5s → forced logout (A9 §A5 Medium — user can't read before nav) |
| Settings Feedback success | inline green text 2s → collapse |
| Settings Reset memory success | modal closes silently (A9 §A24 Medium — asymmetric) |
| Settings Delete account | opens mailto (App Store risk per A9 §A25 / Guideline 5.1.1v) |
| Settings Update password error | inline red text |
| Auth apiBanner | `dangerBg` bg + TriangleAlert icon + error text |
| Auth 429 rate limit | raw backend text passed through (auth §S20) |
| Auth 409 email exists | friendly message (special-case) |
| Auth network offline | friendly "Cannot reach the server…" (auth §S23) |
| Hiking network error on save | silent — wall-timeout dismisses sheet (hiking §29-30 Medium) |
| Hiking StopSummary save success | no toast, no haptic — sheet dismisses + nav swap (hiking §24 Medium) |
| Running plantToast success | 1500ms "Cairn planted" toast (running §25) |
| Running plantToast error | 2000ms "Failed to plant cairn" toast |
| Plant commit success (online) | 250ms haptic ceremony + nav.replace (plant §S24) |
| Plant commit success (offline) | `Alert.alert('Cairn planted (offline)…')` |
| Plant commit failure | `Alert.alert('Could not plant cairn', <raw error string>)` (plant §S25 Medium — leaks server text) |
| MapScreen loadCircleMarkers error | silent (`void` prefix, no catch) — user never sees (mapscreen §45, Critical) |
| MapScreen Hide alert | native `Alert.alert` w/ honest copy (mapscreen §826) |
| MapHistory delete confirm | inline red button → red-filled Confirm Delete (2-tap inline) |
| MarkerDetailSheet delete | two-stage red state (no timeout — Critical) |
| MarkerDetailScreen save error | `Alert.alert('Could not save', ...)` |
| RouteEditor save error | `Alert.alert('Save failed', e.message)` (raw string, routeeditor §17) |
| Memory slow-network banner | Frosted pill top-right with spinner + X (best-in-class copy: "Weak signal — still loading map…") |
| Friends Add friend success | 2s in-sheet CircleCheck + auto-dismiss |
| Friends Add friend error | inline red text in sheet |
| OtaBadge (Auth inline) | shows all states including error |
| OtaBadge (Home floating) | hides on error (Home §S14 Medium) |

**Findings**:

- **Success confirmation is asymmetric** — some paths show ephemeral toast (Running, Plant offline), some show only-brief inline text (Settings 1.5s), some show nothing at all (Settings Reset memory, Hiking save success). No unified feedback contract.
- **Error surfaces raw backend strings** in 4 places (Auth 429, Plant commit, RouteEditor save, MarkerDetail save). Should be mapped to friendly copy.
- **OtaBadge shows error state on Auth but hides on Home** (home §S14 vs auth §S32). Same component, different behavior per host.
- **MapScreen loadCircleMarkers error is silent** — subscribed but never rendered (mapscreen §44/45, Critical).
- **Hiking save success has no toast/haptic** while Running Plant success has a 1500ms toast. Inconsistent celebration of user's completed action.
- **Memory slow-network banner is the best-in-class pattern** — pill + spinner + X + min-show 2s + auto-close. Should be the template for all "background operation" feedback.

**Recommendation**: Publish `<Toast level="success|error|info">` for ephemeral (2-3s), `<Banner>` for persistent (until dismissed), `Alert.alert` reserved for OS-critical failures with recovery actions. All error surfaces map raw backend strings through a friendly-copy layer.

**Severity**: Medium.

---

## Voice / language / copy

Sampled cross-screen inconsistencies:

- **Emoji leak**: Plant voice memo box shows "🎤 Voice memo (coming soon, max 30s)" (plant §S20) — every other icon in the app is Lucide. Same voice-memo file header docs reference the feature but JSX doesn't render it.
- **Chinese-only string**: Hiking SimWalker StartAnchorHint shows `已走 Xm/Xkm` in Chinese despite app UI being English (hiking §10). Rest of the app is English (Cairn is NZ-targeted).
- **Guillemets**: MarkerDetail snapshot body wraps user text with French `«»` (markerdetail §S28 / A12 §5.7 Low) — inconsistent with straight quotes used elsewhere.
- **"Familiar ground"** memory-preview jargon (hiking §21) — first-time users have no vocabulary for it.
- **"Free Hiking" / "Free Run"** — never explained on first mount (hiking §1 / running §1).
- **"Enable GPS" hardcoded** on MapScreen even when GPS is enabled (mapscreen §6, Blocker fake affordance). Also on Running pre-run GPS chip (running §BUG-R-01 Critical). Same class of bug across screens.
- **"friend"** as welcome fallback (auth §S12) — off-brand for a NZ outdoor product; consider "kaimahi"/"explorer".
- **"Route data unavailable"** shown in activity-mode color (green for hiking / blue for running) — success color for failure state (mapshistory §49 Medium).
- **"Showing raw GPS trace"** (RouteEditor snap warning banner, routeeditor §S56) — developer-speak, not user-friendly.
- **"coming soon"** appears in 4 places (Auth Apple, Auth Google, MapHistory Plan, Plant voice memo, MarkerDetailSheet handle gesture) — no unified pattern for "not built yet".
- **Placeholder character set**: mostly consistent U+2019/U+2026 curly quotes and ellipsis, but "coming soon, max 30s" (Plant §S31) and "Finding your ground" use plain ASCII while others don't. Minor drift.
- **`toLocaleDateString()`** on MapScreen bottom panel (mapscreen §32) — cross-user inconsistent format. Should be a proper time-ago.
- **Session date format inconsistency**: Routes Activities uses `getDate()/getMonth()+1/getFullYear()` DMY (routes §S09, US users expect MDY). MapHistory uses `toLocaleDateString()`. Same data, two formats.

**Recommendation**: Publish a copy style guide + i18n keys. Ban emoji in production UI. Standardize date/time-ago on `getRelativeTime` from utils/geo.

**Severity**: Medium.

---

## Screen-level composite scores (from per-screen audits)

| Screen | Composite score (auditor) | Blockers | Criticals |
|--------|---------------------------|----------|-----------|
| Home (A1) | mixed; S32 iPhone SE dense-state clip is Critical | 0 | 1 |
| Auth (A2) | strong; 3 P1 launch blockers | 3 (Apple Sign In, Google G brand, iPad layout) | 6 |
| Hiking (A3) | 7.1/10 | 0 | 2 (Discard no-confirm, No dark mode) |
| Running (A4) | mean 7.2/10 | 0 | 3 (BUG-R-01/15/19) |
| Plant (A5) | avg 6.7/10 | 1 (permission-denied dead-end S04/S05) | 3 |
| Routes (A6) | mixed | 0 | 7 (S05, S08, S12, S13, S18, S33 + cross) |
| MemoryScreen (A7) | mixed | 2 (S14 unwired handlers, S27 report broken) | 4 |
| Friends+MarkerDetail (A8) | strong | 0 | 2 |
| Settings (A9) | strong | 0 | 5 Medium |
| Debug (A9 §B) | 8-9 | 0 | 0 |
| MapScreen (A10) | weak | 3 (fake GPS chip, silent-plant, no fly-to; +clustering) | 10 |
| MapHistory (A11) | mixed | 0 | 6 |
| MarkerDetail full+sheet (A12) | 5-8 varying | 5 (I-04/16/15/26/28 all truncation + handle-bar dark pattern) | 7 |
| RouteEditor (A12b) | mixed | 4 (camera no re-fit, iOS BackButton discard, waypoints IA mismatch, save-as-route<2pts stranded) | 6 |

**Total unique Blockers across all audits**: ~18.
**Total unique Criticals**: ~55.

---

## Priority summary — release-blocking consistency issues

Ranked by cross-screen impact (not per-screen severity):

1. **Truncation policy is not enforced anywhere in the app** — user-editable route names / marker titles / marker bodies / friend names / activity names all lack `numberOfLines` guards on some screens and lack `maxLength` on inputs (routes S18, mapshistory §41, markerdetail §S16 / §S19, routeeditor #6, friends FS-16). Both truncation *and* overflow bugs coexist. Cairn memory `feedback_truncate_is_bug` says truncation = Critical; the current implementation is inconsistent enough that it hits both failure modes.

2. **Destructive-action confirmation is not unified** — Hiking StopSummary Discard has no confirm; Hiking mid-track BackButton has no confirm; iOS RouteEditor BackButton silently discards edits; MarkerDetailSheet two-stage red button has no auto-reset timeout. Settings and MapHistory 2-tap patterns are safe. Publish a single spec.

3. **App-Store review risk in Auth** — Apple Sign In unimplemented (HIG 4.8); Google "G" hand-rolled monochrome logo (Google Brand Guidelines violation); Settings Delete account uses mailto (Guideline 5.1.1v risk). All flagged by A2 and A9 as P1 launch blockers.

4. **Fake affordances**:
   - MapScreen "Enable GPS" is a `<View>` not `TouchableOpacity` (mapscreen §7, Blocker)
   - MarkerDetailSheet handle bar has no PanResponder (markerdetail §S40, Blocker per A12)
   - Memory RevealedCairnSheet like/report/hide buttons never wired (memory §S14/§S26/§S27, Blocker; Apple 1.2 UGC review risk on Report specifically)
   - Auth Apple/Google buttons trigger `Alert.alert('Coming soon')`
   - MapHistory "Plan Route" trigger `Alert.alert('coming soon')`
   - Plant voice memo box with emoji placeholder

5. **Silent-plant bug on MapScreen** — `handleAddMarker` substitutes region.center when `lastCoord` is null. Data-integrity Blocker (mapscreen §26).

6. **Danger red fragmentation** — 3 different reds (#b25a48, #c44545, Colors.danger #c53d2e) coexist. Consolidate to `Colors.danger`.

7. **Card backgrounds not tokenised** — Home hardcodes 4 pale tints. Move to `tokens.ts`.

8. **MarkerDetailScreen design-system drift** — 20+ hardcoded font/color/spacing values, imports `MemoryColors` cross-feature (A12 §5.1). This screen reads as a different app.

9. **Loading pattern varies wildly** — 5 different vocabularies. MapScreen/MapHistory/RouteEditor all show blank green rectangles for up to 15s (Performance Standards violation for first-load < 3s).

10. **Route icon overloading** — same glyph for stat-chip, Trails tool, Routes tab. Also applies to Map / Users / Target icons in weaker forms.

11. **Empty state has 5 different visual languages** — Routes Activities has NO CTA (routes §S05 + CC-6), Home has no hero for zero-state, RouteEditor no-points state is blank, MapScreen no-markers has no state at all. All the same product.

12. **Tap targets < 44pt HIG** — systemic across Settings / Auth / Plant / Memory / Routes / RouteEditor.

13. **Sim-walker not visually marked** — Hiking sim-mode is invisible to the user, data provenance risk (hiking §9 / §12, Medium).

14. **Backend error strings leak to users** — Auth 429, Plant commit error, RouteEditor save error, MarkerDetail save error. Map to friendly copy.

15. **`__cairnStores` production hook** — memory `project_v406_web_test_hook.md` says must be stripped pre-launch. Confirmed still present in every screen. Verify in build hooks before App Store submission (Auth S30/S23, Memory S23).

---

## All findings (by severity)

### Blocker
- Apple Sign In unimplemented (auth §S13 / P1)
- Google "G" logo brand violation (auth §S14 / P1)
- Auth iPad no layout (auth §S29 / P1)
- MapScreen GPS chip is fake affordance — `<View>` not `TouchableOpacity` (mapscreen §7)
- MapScreen silent-plant at region.center when no GPS (mapscreen §26)
- MapScreen no camera fly-to-user (mapscreen §42)
- MapScreen no clustering (mapscreen §4)
- Memory RevealedCairnSheet unwired handlers (memory §S14 / §S26 / §S27)
- Hiking StopSummary Discard no confirm (hiking §25)
- MarkerDetailSheet handle bar without gesture (markerdetail §S40)
- MarkerDetailScreen title/body/note have no bounds (markerdetail §S16/§S18/§S19/§S35)
- MarkerDetailScreen edit Save button falls below fold on iPhone SE (markerdetail §S26)
- RouteEditor iOS BackButton silently discards edits (routeeditor §50 / C-4)
- RouteEditor camera doesn't re-fit after lazy-loaded points (routeeditor §45 / C-6)
- RouteEditor waypoints spec mismatch — RoutesScreen advertises "N waypoints" but editor has no waypoint UI (routeeditor §52)
- RouteEditor save-as-route with <2 GPS points strands user (routeeditor §4)
- Plant permission denied dead-end no Settings deep-link (plant §S04/§S05)
- Home iPhone SE dense-state Leave-a-Cairn card clip (home §S32)
- `__cairnStores` production hook not stripped (multi)

### Critical
- 3 different reds for danger (multi §Danger)
- 4 hardcoded card tints in Home (home §Hardcoded)
- MarkerDetail 20+ hardcoded values + MemoryColors cross-feature (markerdetail §5.1)
- Truncation guards missing on Route name / Route card title / Activity title / Marker title/body / Friend name / MapHistory session title (routes §S18, mapshistory §41, markerdetail §S16, friends §FS-16, running §5)
- Loading states blank-screen: MapScreen tile load, MapScreen loadingCircle dead, MapHistory 15s blank, RouteEditor lazy-load
- Empty state gaps: Routes Activities no CTA, Home no hero, MapScreen no markers, RouteEditor no points, MapHistory `nav.replace` breaks back stack
- Hiking mid-track BackButton no confirm (hiking §33)
- Hiking Discard no confirm (hiking §25)
- Running Plant button disabled no visual (running §26 / BUG-R-15)
- Running zombie state: runState local diverges from store status (running §33 / BUG-R-19)
- Running "Enable GPS" hardcoded regardless of permission (running §1 / BUG-R-01)
- Running route picker backdrop no scrim color (running §6 / BUG-R-05)
- Auth CairnLogo alignment hack -7px (auth §S37)
- Auth CTA height mismatch primary=56 / social=52 (auth §S03)
- Auth hint/error slot collision (auth §S07 / §S16)
- Auth 429 backend text leak (auth §S20)
- Auth verify BackButton preserves data but clears errors (auth §S08)
- Memory scope toggle 26-28pt tap target (memory §S3)
- Memory scope=friends 0 subs silent (memory §S3)
- Memory city-tap bbox center may fly to ocean on antimeridian bboxes (memory §S11)
- Plant pin color mismatch — orange in step 2, red in step 3 for Danger type (plant §S13)
- Plant Mapbox tile load failure no fallback (plant §S16)
- Plant voice memo placeholder consumes UI real estate (plant §S20)
- Plant empty content validation dim button no explanation (plant §S27)
- Plant commit error leaks server strings (plant §S25)
- Plant iPhone SE Save button off-screen with keyboard (plant §S28)
- Plant zoom / style / target tap targets 36px (plant §S11)
- Routes Activities no CTA in empty (routes §S05 / CC-6)
- Routes no pull-to-refresh (routes §S08)
- Routes zombie sessions display "0 m · 0s" (routes §S12)
- Routes no pending sync banner (routes §S13)
- Routes long Route name overflow (routes §S18)
- Routes silent Nearest→Recent fallback when no GPS (routes §S33)
- Routes Route card long-press redundant sheet (routes §S11 / §S19 / CC-1)
- MapHistory 100-session ScrollView perf (mapshistory §6)
- MapHistory delete decoupled from selection (mapshistory §22)
- MapHistory dead `flags` tab code (mapshistory §36)
- MapHistory deep-link to deleted session falls to empty (mapshistory §46)
- MapHistory Plan Route "coming soon" alert (mapshistory §40)
- MapHistory routePreviewCard is decorative-only (mapshistory §11)
- Friends offline / fetchFriendRequests failure unhandled (friends §FS-18)
- Friends self-invite guard dropped (friends §FS-12)
- Settings password success message 1.5s → forced logout (A9 §A5)
- Settings reset-memory success silent (A9 §A24)
- Settings mailto delete-account App Store risk (A9 §A25)
- MapScreen loadingCircle / loadingSubs dead state (mapscreen §44/§45)
- MapScreen fabBadge 3+ digit overflow (mapscreen §17)
- MapScreen createSheet permission resets to personal on every open (mapscreen §27)
- MapScreen type-card label wrap on iPhone SE (mapscreen §19)
- MapScreen stranger opacity 0.6 desaturates icon (mapscreen §11)
- MapScreen `topBar` paddingTop wastes space on Dynamic Island (mapscreen §5 / §39)
- MapScreen back chip → `nav.goBack()` no canGoBack guard (mapscreen §8)
- MarkerDetailSheet two-stage delete confirm no timeout (markerdetail §S32)
- MarkerDetailSheet backdrop intercepts map pan (markerdetail §S39)
- MarkerDetailScreen delete → goBack wrong destination after Plant flow (markerdetail §S24 / A12 §5.5)
- MarkerDetailScreen no offline gate on Save inside edit (markerdetail §S23)

### Medium — see per-screen AUDITs. Broad categories:
- Font-size / spacing drift (Home, Auth, MarkerDetail, RouteEditor)
- Icon-only permission filters with no accessibilityLabel (Routes §S31)
- Locale-fixed date format (Routes §S09, MapScreen §32)
- Sort chip has no non-default indicator (Routes §S25 / §S32)
- Route selectedRoute not persisted (Running §2 / BUG-R-02)
- Multiple screens ignore sync state (Routes, Home statChip zombie double-count)
- Redundant tap-vs-longpress sheets (Routes CC-1)
- Backend error copy inconsistent across Auth / Plant / RouteEditor / MarkerDetail
- Chip flex layout doesn't handle i18n long labels (RouteEditor §10)
- No "coming soon" pattern

### Low — cosmetic drift, dev-only, per-screen polish items already documented in per-screen AUDITs.

---

## Recommended cross-cutting Stories for O2/O3 backlog

1. **STORY: Design-system consolidation pass** — move all hardcoded hex/px in Home, MarkerDetail, RouteEditor into `tokens.ts`. Deprecate `MemoryColors` outside memory feature scope. Consolidate 3 danger reds to `Colors.danger`. Ban new hardcoded values via lint rule.

2. **STORY: Truncation + overflow policy** — every user-generated text gets `numberOfLines={1}` + `ellipsizeMode="tail"`. Every TextInput gets `maxLength`. Publish a single `<UserText>` wrapper. Audit all screens.

3. **STORY: Confirmation policy** — publish spec (destructive-with-recovery → sheet-with-scrim, destructive-irreversible → TypeToConfirmModal). Migrate Hiking Discard, Hiking mid-track back, RouteEditor iOS back, MarkerDetailSheet delete-confirm timeout.

4. **STORY: Loading state policy** — publish `<InlineLoader>` + `<AreaLoader>`. Kill blank-screen loading in MapScreen / MapHistory / RouteEditor. Adopt Memory's staged-copy pattern for anything > 3s.

5. **STORY: Empty state policy** — hero + IllustrationHalo + CTA everywhere. Fix Routes Activities (no CTA), Home (no zero-state hero), MapScreen (no markers).

6. **STORY: Tap target audit** — 44×44 minimum. Fix Settings eye toggle, Plant zoom/style/target, Memory scope, Routes segment, RouteEditor permission chips.

7. **STORY: Icon disambiguation** — rename Route→Compass or MapPin for Trails tool. Publish icon-role registry to prevent overload.

8. **STORY: Copy pass** — map backend error codes to friendly text (Auth 429, Plant commit, RouteEditor save, MarkerDetail save). Kill Chinese-only strings, emoji leaks, dev-speak ("raw GPS trace"). Standardize date format on `getRelativeTime`.

9. **STORY: Kill fake affordances** — remove MapScreen `<View>`-as-CTA, MarkerDetailSheet handle-bar-no-gesture, Plant voice-memo emoji box; wire Memory RevealedCairnSheet handlers OR hide the row entirely; implement Apple Sign In (App Store gate).

10. **STORY: Strip production `__cairnStores` hook** — build-time flag verified pre-App-Store submission.

11. **STORY: Header component** — publish `<AppHeader>` and migrate all screens off ad-hoc BackButton + title-row hacks.

---

## Design-system consistency score

Weighted rollup per screen (10 = perfect match to Settings O12 baseline):

| Screen | Score |
|--------|-------|
| Settings (baseline) | 10 |
| Auth | 7 (tokens correct, but CTA height + logo hack + inline styles) |
| Friends | 8 (clean, matches Hiking sheet pattern) |
| Hiking | 7 (strong happy path, silent failures + no confirmation on Discard) |
| Running | 7 (strong lock UI, several BUG-Rs) |
| Routes | 6 (visual drift in cards, weak empty states, no pull-to-refresh) |
| Home | 6 (hardcoded card colors, magic layout numbers, icon overloading) |
| Plant | 6 (adhoc styles per component, no Row primitives, dead voice-memo affordance) |
| MapHistory | 5 (session card diverges from RoutesScreen, dead flags tab, blank-screen loads) |
| MarkerDetailSheet | 8 (clean tokens, handle-bar dark pattern) |
| RouteEditor | 8 (tokens correct, but iOS back data-loss + camera bug + no waypoint UI) |
| MapScreen | 4 (fake affordances, silent-plant, no clustering, dead state, missing camera fly-to) |
| Memory | 7 (strong fog rendering, but unwired handlers + scope semantics) |
| MarkerDetailScreen | 5 (extensive MemoryColors + hardcoded fonts — worst-diverged of the app) |
| DebugScreen | 6 (per-row cards diverge from Settings grouped-card) |

**Cross-app mean**: ~6.5 / 10. Ship-worthy for internal iteration but **below the NZ launch bar** without addressing the top 3 stories above.

---

**End of consistency report.**
