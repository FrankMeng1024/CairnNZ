# RoutesScreen UX/UI Audit — Auditor #6

**Scope**: `src/screens/RoutesScreen.tsx` (3 sub-tabs: Activities / Routes / Flags) + `src/screens/RouteEditorScreen.tsx`.
**Baseline**: SettingsScreen (visual density, chip / row spacing, typography), tokens.ts, FRONTEND_STANDARDS.md.
**Date**: 2026-07-27.
**Method**: static read of source only (per audit rules — Read/Grep/Glob/Write only). Playwright scripts included per scenario for downstream runtime verification, but this file **does not** claim visual PASS on any scenario — that requires the main agent to run the scripts.
**Malware pre-check**: sources reviewed are legitimate app UI code (screen components, design tokens). No obfuscation, exfiltration, or unsafe eval. No augmentation applied per operating rule.

---

## Scoring rubric

Each scenario scored `1–5` on:
- **F** Functional correctness (does the code path reach the intended state?)
- **V** Visual fidelity (matches Baseline tokens + Segment/Chip patterns)
- **A** Affordance / clarity (first-time user understands what to do)
- **E** Edge-case handling (empty / error / long-string / slow-net)

`Severity`: **Blocker** (task cannot complete) / **Critical** (wrong output / confusing) / **Medium** (degraded) / **Low** (cosmetic).

`Truncate/clipping/overflow` per user policy = **Critical** minimum, never cosmetic.

---

## Enumerated scenarios (36 total)

### Group A — Top bar + tab switching

#### S01 · Header row (BackButton + centered "Routes" title)
- **Where**: `RoutesScreen` main, lines 1210–1215.
- **Findings**: `BackButton` variant "pill" + centered `Text` title. `<View style={{ minWidth: 60 }} />` is used to balance the back button width on the right — hard-coded 60px is fragile (if BackButton grows the title decenters). No visual defect at default sizes.
- **Score**: F5 V4 A5 E4. Severity: **Low**.
- **Playwright**:
```js
await page.goto('/routes');
await expect(page.getByText('Routes', { exact: true })).toBeVisible();
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S01-header.png' });
```

#### S02 · SegmentControl 3 tabs (Activities / Routes / Flags) order
- **Where**: `SegmentControl`, lines 67–86.
- **Findings**: Tab order **Activities → Routes → Flags** matches PO note in comment (line 68–71). `activeOpacity=0.8` on `TouchableOpacity` without `haptic` feedback — inconsistent with rest of app (haptic used in FlagEditSheet type selection, line 893).
- **Score**: F5 V4 A4 E5. Severity: **Medium** (missing haptic on tab switch).
- **Playwright**:
```js
await page.getByRole('button', { name: 'Routes' }).click();
await page.getByRole('button', { name: 'Flags' }).click();
await page.getByRole('button', { name: 'Activities' }).click();
```

#### S03 · SegmentControl active state animation
- **Where**: `segStyles.tabActive` (line 1448) — no `Animated.Value`, no cross-fade. Switch is instant.
- **Findings**: Sibling designs (Home/Marker) use fade transitions. Instant tab-switch here feels jarring next to a screen that otherwise uses smooth Animated timing (RouteSheet slide, ActivitySheet slide).
- **Score**: F5 V3 A4 E5. Severity: **Low**.
- **Playwright**:
```js
await page.getByRole('button', { name: 'Routes' }).click();
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S03-seg-switch.png' });
```

#### S04 · SegmentControl on small screen (iPhone SE 375w)
- **Where**: lines 1446–1451. `flexDirection: row` + `flex:1` per tab. `paddingVertical:10`. Text uses `FontSize.small` (11px).
- **Findings**: Text should not overflow at 3 tabs × ~125px width. However 11px is at the small end — accessibility risk for users with larger dynamic type. No `numberOfLines`/ellipsis fallback if OS scales the label to 130% — could push tab-active pill outside padding.
- **Score**: F5 V4 A3 E3. Severity: **Medium**.
- **Playwright**:
```js
await page.setViewportSize({ width: 375, height: 667 });
await page.goto('/routes');
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S04-small-tabs.png' });
```

---

### Group B — ActivitiesTab

#### S05 · Activities empty state ("No tracks walked yet")
- **Where**: line 722–724. `<EmptyState icon="Map" title="No tracks walked yet" hint="Start hiking or running..." illustration={<IllustrationHalo><EmptyRoutes size={192} /></IllustrationHalo>} />`.
- **Findings**: Empty state is passive — copy + illustration only, **no CTA**. Compare with Flags empty (line 1064–1072) which has a "Plant a new mark" CTA nav to Plant. Missing "Start tracking" button that opens HikingOrRunning launcher — Activities empty is a dead end for first-time user.
- **Score**: F4 V4 A2 E4. Severity: **Critical** (no affordance from empty state — user has to know they must go back to Home to start tracking).
- **Playwright**:
```js
// Precondition: clear sessions store
await page.evaluate(() => window.__cairnStores.session.setState({ sessions: [] }));
await page.getByRole('button', { name: 'Activities' }).click();
await expect(page.getByText('No tracks walked yet')).toBeVisible();
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S05-activities-empty.png' });
```

#### S06 · Activities with 1 session
- **Where**: `ActivitiesTab` render, lines 744–784.
- **Findings**: Single card renders with `borderLeftColor: accent`, badge, title + meta. `FlatList` OK for 1 row. No issue.
- **Score**: F5 V5 A5 E5. Severity: **none**.
- **Playwright**:
```js
await page.evaluate(() => window.__cairnStores.session.setState({ sessions: [MOCK_ONE_SESSION] }));
await page.getByRole('button', { name: 'Activities' }).click();
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S06-1session.png' });
```

#### S07 · Activities with N sessions (list rendering + scroll)
- **Where**: `visible` memo lines 709–720, `FlatList` line 744.
- **Findings**: `FlatList` uses default rendering — no `getItemLayout`, `initialNumToRender`, `windowSize`, `keyExtractor` is fine. At N=200+ this could cause jank first render. `contentContainerStyle={styles.listContent}` has `gap: Spacing.sm` — `gap` in FlatList `contentContainerStyle` is not fully honored across all RN versions (needs verification).
- **Score**: F4 V5 A5 E3. Severity: **Medium**.
- **Playwright**:
```js
await page.evaluate(() => window.__cairnStores.session.setState({ sessions: MOCK_50_SESSIONS }));
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S07-many.png' });
```

#### S08 · Pull-to-refresh on Activities
- **Where**: `FlatList` at line 744 — **no `refreshControl` prop, no `onRefresh` handler**.
- **Findings**: User cannot pull to refresh Activities. Sessions come from `useSessionStore` which loads on app start but has no explicit re-sync trigger from this screen. If server-side pending sync arrives, user has to leave + return to see it.
- **Score**: F3 V5 A2 E2. Severity: **Critical** (missing well-known iOS/Android UX affordance for a list of user-owned records).
- **Playwright**:
```js
const list = page.locator('[testID="activities-list"]');
// Attempt pull gesture — expect NO refresh spinner appears (verifies bug)
```

#### S09 · Activity card format (name + date + dist + duration)
- **Where**: lines 774–783.
- **Findings**: Two-line card: title (`item.name || 'Run'|'Hike'`) + meta (`dateStr · dist · duration`). Date is built manually: `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}` — locale-agnostic DMY, ignores user locale (US users expect MDY). No relative time ("2h ago") for very-recent activity — feels less alive.
- **Score**: F4 V4 A3 E4. Severity: **Medium** (locale-fixed date format).
- **Playwright**:
```js
await expect(page.locator('[testID="activity-card-0"]')).toContainText('/');
```

#### S10 · Activity card tap → nav MapHistory
- **Where**: line 762 `onPress={() => nav.navigate('MapHistory', { sessionId: item.id })}`.
- **Findings**: Direct nav (per v261 comment). No loading spinner while MapHistory hydrates. If session is heavy (long track), tap → blank screen → map appears; user perceives lag. No pre-navigate haptic.
- **Score**: F5 V5 A4 E3. Severity: **Medium**.
- **Playwright**:
```js
await page.locator('[testID="activity-card-0"]').tap();
await expect(page).toHaveURL(/MapHistory/);
```

#### S11 · Activity card long press → ActivitySheet
- **Where**: line 763 `onLongPress={() => setSelectedSession(item)}`.
- **Findings**: Long press opens `ActivitySheet` bottom sheet (lines 431–532). Sheet shows only View button now (Delete removed per v120 comment). This creates redundancy — tap goes to detail directly, long-press also opens a sheet whose only action is "View". The sheet's value is unclear.
- **Score**: F4 V4 A2 E4. Severity: **Medium** (redundant affordance; consider adding rename / share / start-from-here or removing sheet).
- **Playwright**:
```js
await page.locator('[testID="activity-card-0"]').press('longpress');
await expect(page.getByRole('button', { name: 'View' })).toBeVisible();
```

#### S12 · Zombie session filtering (distance=0 duration=0)
- **Where**: `visible` memo, lines 709–720. **No filter for `distanceM===0 && durationS===0`**.
- **Findings**: If tracking was started + stopped instantly, the session persists with 0/0/0 stats and renders "0m · 0s" in the meta. Per Memory §"Truncate/clipping/overflow = bug" the zombie session is not a truncation issue, but it IS a data-integrity display bug: a "0m 0s Hike" undermines trust.
- **Score**: F3 V4 A3 E2. Severity: **Critical**.
- **Playwright**:
```js
await page.evaluate(() => window.__cairnStores.session.setState({ sessions: [{ id:'z', distanceM:0, durationS:0, startedAt: Date.now(), activityMode:'hiking' }] }));
await expect(page.getByText('0 m · 0s')).toBeVisible(); // if visible = bug
```

#### S13 · Pending sync banner (Activity uploaded / offline queued)
- **Where**: **not implemented in `ActivitiesTab`**.
- **Findings**: HomeScreen (per tokens comment on `surfaceMuted`) uses a pending banner for offline queue. RoutesScreen has no equivalent — user cannot see which sessions are pending server sync. Combined with lack of pull-to-refresh (S08), this silently hides sync state.
- **Score**: F3 V4 A2 E2. Severity: **Critical**.
- **Playwright**:
```js
// Set store to pending-count > 0 and expect a banner (currently expect fail)
```

---

### Group C — RoutesTab

#### S14 · Routes empty state (Mine, 0 saved)
- **Where**: lines 590–611. Hero + illustration icon + 2-line body + primary CTA "View Activities".
- **Findings**: Good — hero state with actionable CTA (nav to Activities). Copy explains derivation ("Routes are paths you've already walked").
- **Score**: F5 V5 A5 E5. Severity: **none**.
- **Playwright**:
```js
await page.getByRole('button', { name: 'Routes' }).click();
await expect(page.getByText('No saved routes yet')).toBeVisible();
```

#### S15 · Routes empty state (Friends, 0 shared, hasFetched)
- **Where**: lines 617–628. Different hero: no CTA (correct — user can't create friend routes for them).
- **Findings**: Fine, though "will show up here" copy could suggest an action ("Invite friends" nav to FriendsScreen).
- **Score**: F5 V4 A4 E5. Severity: **Low**.
- **Playwright**:
```js
// Set circleRoutes to [] hasFetchedFriends=true and inspect
```

#### S16 · Routes Friends loading placeholder
- **Where**: lines 612–616. Renders "Loading friends' routes…" as `emptyHint` style.
- **Findings**: Text-only loading — no skeleton / spinner. Feels dead if request hangs. Loading state is centered, but uses caption-size text, low contrast.
- **Score**: F4 V3 A3 E3. Severity: **Medium**.
- **Playwright**:
```js
await page.getByRole('button', { name: 'Friends' }).click();
// Freeze fetch and capture the loading state
```

#### S17 · Routes list rendering (mine, N items)
- **Where**: lines 647–681.
- **Findings**: Card layout has gradient badge + title + meta + chevron. `dist.format(item.distanceM, 1)` + waypoint count. Card is clean.
- **Score**: F5 V5 A5 E5. Severity: **none**.

#### S18 · Route card format (name / dist / waypoints)
- **Where**: lines 675–678.
- **Findings**: `<Text style={styles.cardTitle}>{item.name}</Text>` — **no `numberOfLines={1}` guard**. Long route name (user-editable up to arbitrary length) will wrap and inflate row height, breaking the fixed FlatList row rhythm. Meta `cardMeta` also lacks `numberOfLines`.
- Per user policy: overflow/truncation = **Critical**.
- **Score**: F5 V3 A4 E1. Severity: **Critical**.
- **Playwright**:
```js
await page.evaluate(() => window.__cairnStores.route.setState({ routes: [{ id:'r1', name:'A very very very long route name that will span multiple lines and break the card', distanceM: 1200, waypoints:[], updatedAt: Date.now(), activityMode:'hiking' }] }));
await page.screenshot({ path: 'docs/qa/sprintN-evidence/S18-longname.png' });
```

#### S19 · Route card tap → RouteEditor (not RouteSheet)
- **Where**: line 667 `onPress={() => nav.navigate('RouteEditor', { routeId: item.id })}`.
- **Findings**: Tap goes straight to editor (view-mode), long-press opens RouteSheet (line 668). Same redundant-sheet issue as S11. RouteSheet renders (only "View" button) then dismisses to editor — feels like an extra step.
- **Score**: F5 V4 A3 E5. Severity: **Medium**.

#### S20 · RouteSheet detail modal (long press)
- **Where**: lines 304–428.
- **Findings**: Sheet slides up, `Animated.parallel` transitions; snapshot pattern prevents flash during close. Stats row shows dist / elevation gain / waypoints / times used. Good. **BUT** title (`data.name`) uses `numberOfLines={1}` (line 368) — good for the sheet, but the underlying card in S18 doesn't.
- **Score**: F5 V5 A4 E5. Severity: **Low**.

#### S21 · RouteSheet friend (readOnly)
- **Where**: lines 414–424. Button reads "Friend route (view only)", `disabled={readOnly}`, opacity 0.5.
- **Findings**: Clear communication. Tapping does nothing (early return in onPress). No hint how to view the map anyway — a friend's route becomes non-navigable from this sheet, which is a dead end.
- **Score**: F4 V4 A2 E3. Severity: **Medium** (readOnly kills the primary affordance without offering an alternative "View on map" nav).

#### S22 · RouteEditor entry from card tap
- **Where**: RouteEditorScreen line 79. Reads `routeId` param.
- **Findings**: Loads existing route detail if points empty (line 187–191). Bottom panel shows View/Edit/Save actions. Auto-load OK.
- **Score**: F5 V4 A4 E4. Severity: **Low**.

#### S23 · Add Route button
- **Where**: **not present** in `RoutesTab` (comment line 651–654 confirms manual drawing forbidden per route-rules.md §2.3).
- **Findings**: By design. Correct.
- **Score**: F5 V5 A5 E5. Severity: **none**.

#### S24 · Search bar
- **Where**: **not present** (comment line 651–654 says removed in v124).
- **Findings**: OK for small route counts, but no fallback for power users with 50+ routes. Filter chips + sort are the only tools.
- **Score**: F5 V4 A3 E3. Severity: **Medium** (at scale).

#### S25 · Filter/Sort bar visual weight vs SettingsScreen baseline
- **Where**: `FilterSortBar` lines 179–229 + styles `filterBarStyles` 1411–1443.
- **Findings**: Chip pattern (pill `Radius.pill=20`, `Colors.primaryBg`) matches baseline. Sort chip uses `primaryBg` background always (whether default or non-default sort) — visually indistinguishable from "modified" state. Sort chip active state = the same as inactive.
- **Score**: F5 V3 A3 E4. Severity: **Medium** (no visual indicator when sort is non-default).

---

### Group D — FlagsTab

#### S26 · Flags empty state (Mine, 0 planted)
- **Where**: lines 1045–1076. Hero illustration + hero title + body + CTA "Plant a new mark" nav to Plant screen.
- **Findings**: Good empty state with correct CTA. Matches Routes empty pattern.
- **Score**: F5 V5 A5 E5. Severity: **none**.

#### S27 · Flags empty state (Friends, 0 shared)
- **Where**: lines 1089–1102. Hero without CTA (correct — cannot force friends to share).
- **Findings**: Fine. Same "add invite CTA" suggestion as S15.
- **Score**: F5 V4 A4 E5. Severity: **Low**.

#### S28 · Flags Friends loading placeholder
- **Where**: lines 1084–1088. Same "text-only loading" pattern as S16.
- **Score**: F4 V3 A3 E3. Severity: **Medium**.

#### S29 · Mine/Friends sub-tab bar
- **Where**: `ScopeTabBar` lines 91–117 + styles lines 119–155.
- **Findings**: Underline-style tabs (borderBottom). Fine visual pattern. `minWidth: 88`, centered. `justifyContent: 'center'` means two tabs sit in the middle with lots of empty space at 375w — acceptable but slightly wasteful. Comment (line 120–125) says v2 fix made it bigger — good iteration.
- **Score**: F5 V4 A5 E5. Severity: **Low**.

#### S30 · Flags type filter (5 chips: All / Danger / Cairn / Water / Junction)
- **Where**: `FLAG_FILTERS` lines 51–57 + render lines 1116–1121.
- **Findings**: Horizontal scroll chip row. At 375w, all 5 chips likely fit inline (roughly ~330px width) — no scroll needed in practice, but `ScrollView horizontal` is defensive. Chips are text-only (no icon), but `FLAG_TYPES` has icons available — mixing icon+text would parallel MapScreen. Text-only is fine.
- **Score**: F5 V4 A4 E5. Severity: **Low**.

#### S31 · Flags permission filter (3 icon toggles: Lock / Users / Globe)
- **Where**: `PERM_FILTERS` lines 978–982 + render lines 1122–1136.
- **Findings**: 28×28 circular toggle group inside a pill container. Icon-only, no label. First-time user might not decode Lock=personal, Users=group, Globe=public. Missing accessibility label (`accessibilityLabel` on TouchableOpacity). Icon-only for permission filter is standard iOS pattern but risks confusion.
- **Score**: F5 V4 A2 E4. Severity: **Medium** (accessibility + first-run clarity).

#### S32 · Flags sort chip (Recent / Nearest)
- **Where**: line 1139–1146. Toggle button — one tap swaps `sort`.
- **Findings**: Same "no visual differentiation when non-default" issue as S25. Chip background is always `primaryBg`. Icon `ArrowUpDown` is a *sort* icon not a *toggle* icon — user might expect a menu, not a swap.
- **Score**: F4 V3 A2 E4. Severity: **Medium**.

#### S33 · Nearest sort requires GPS
- **Where**: lines 1029–1043. `if (!lastCoord) return [...filtered].sort((a, b) => b.createdAt - a.createdAt);`.
- **Findings**: Falls back silently to "recent" ordering if `lastCoord` is null — user tapped "Nearest" but sees recent ordering with no indication why. No banner "GPS unavailable — sorting by recent instead".
- **Score**: F4 V4 A1 E2. Severity: **Critical** (silent fallback = misleading state).
- **Playwright**:
```js
await page.evaluate(() => window.__cairnStores.tracking.setState({ lastCoordinate: null }));
await page.getByRole('button', { name: 'Nearest' }).click();
// Currently expected: order is by createdAt but chip says "Nearest" → misleading
```

#### S34 · Flag card format (icon / title / distance / permission / chevron)
- **Where**: lines 1154–1180.
- **Findings**: Row with badge + note + type label + distance + permission icon + chevron. `<Text style={styles.flagName} numberOfLines={1} ellipsizeMode="tail">` **good** — this one IS guarded. Note fallback: `item.note || '(No note)'` — reasonable. `distanceStr` shown only when `lastCoord` present.
- **Score**: F5 V5 A4 E4. Severity: **Low**.

#### S35 · Long flag note truncation
- **Where**: line 1171. `numberOfLines={1} ellipsizeMode="tail"`.
- **Findings**: Correctly bounded. Max 50 chars enforced at input (line 923), so overflow risk is low but the ellipsis still fires around ~30 chars depending on width. Correct behavior.
- **Score**: F5 V5 A5 E5. Severity: **none**.

#### S36 · FlagEditSheet — no longer used in FlagsTab
- **Where**: lines 794–975 (component present but per line 1184–1185 "FlagEditSheet removed — Flags now navigate to read-only MarkerDetailScreen").
- **Findings**: The `FlagEditSheet` component is **dead code** in RoutesScreen (still defined + styled but no caller). This inflates the module and adds maintenance burden. However Marker create-flow (MapScreen / Plant) may still use similar patterns — verify before deletion.
- **Score**: F4 V5 A5 E5. Severity: **Medium** (dead code — cleanup lesson per O2 rules "unused code must have explored root cause").

---

## Cross-cutting findings

### CC-1 · Consistent tap→direct vs long-press→sheet redundancy (S11, S19)
Both Activity and Route cards use `tap → nav to detail` + `long-press → sheet`. The sheet's only meaningful action is "View", which duplicates the tap. Either (a) remove the sheet entirely, or (b) enrich the sheet with rename / duplicate / share / delete actions.
Severity: **Medium**.

### CC-2 · Silent state fallbacks (S33, S13, S08)
Three separate silent fallbacks: Nearest→Recent when no GPS, no pending-sync banner, no pull-to-refresh. Each hides state that would help the user reason about the app. Together they make the screen feel static and untrustworthy on flaky networks.
Severity: **Critical** (cumulative).

### CC-3 · Long-text guards inconsistent (S18 vs S35)
Flag names use `numberOfLines={1}` guard; Route names do not. Route names are user-editable and unbounded — this is the exact class of bug the user's Memory rule targets ("truncate/clipping/overflow = Critical"). Route cards will wrap on any long name.
Severity: **Critical**.

### CC-4 · Sort chip lacks non-default indicator (S25, S32)
Sort chip has identical styling whether user set a non-default sort or not. Only the text label differs. When scanning the list, no visual cue tells the user "sort changed".
Severity: **Medium**.

### CC-5 · Locale-fixed date in Activity meta (S09)
`${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}` produces D/M/YYYY globally. Users in US locale expect M/D. Use `date.toLocaleDateString()` with user locale.
Severity: **Medium**.

### CC-6 · Empty-state CTA inconsistency (S05 vs S14 vs S26)
Routes empty has "View Activities" CTA. Flags empty has "Plant a new mark" CTA. Activities empty has **no CTA**. The critical entry point (Activities is the source of all data) is the most passive empty state.
Severity: **Critical**.

### CC-7 · Missing haptic on SegmentControl (S02)
FlagEditSheet uses `haptic.impact('light')` on type selection (line 893). SegmentControl at the top does not. Inconsistent tactile feedback across the same screen.
Severity: **Low**.

### CC-8 · Dead code — FlagEditSheet (S36)
`FlagEditSheet` component (lines 794–975 including local Alert imports) is unused per line 1184–1185. ~180 lines. Per O2 audit rule "every line of code must have purpose in the app" — either delete or reference.
Severity: **Medium** (tech debt, not user-facing).

---

## Severity summary

| Severity | Count | Scenario IDs |
|---|---|---|
| **Blocker** | 0 | — |
| **Critical** | 7 | S05, S08, S12, S13, S18, S33 + CC-2/CC-3/CC-6 (cross) |
| **Medium** | 14 | S02, S04, S07, S09, S10, S11, S16, S19, S21, S24, S25, S28, S30, S31, S32, S36, CC-1, CC-4, CC-5, CC-8 |
| **Low** | 8 | S01, S03, S15, S17, S20, S22, S23 (design), S27, S29, S34, S35, CC-7 |

---

## Playwright master script skeleton

```js
// docs/qa/sprintN-evidence/routes-audit.spec.js
import { test, expect } from '@playwright/test';
const EVIDENCE = 'docs/qa/sprintN-evidence';

test.describe('RoutesScreen audit', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8081/routes');
  });

  test('S05 Activities empty has no CTA (regression: current bug)', async ({ page }) => {
    await page.evaluate(() => window.__cairnStores.session.setState({ sessions: [] }));
    await page.getByRole('button', { name: 'Activities' }).click();
    await expect(page.getByText('No tracks walked yet')).toBeVisible();
    // Verify the bug: no visible CTA button
    expect(await page.locator('button', { hasText: /start|track|new/i }).count()).toBe(0);
    await page.screenshot({ path: `${EVIDENCE}/S05-activities-empty.png`, fullPage: true });
  });

  test('S08 Activities lacks pull-to-refresh', async ({ page }) => {
    await page.getByRole('button', { name: 'Activities' }).click();
    // Assert refreshControl absent
  });

  test('S12 zombie session displays', async ({ page }) => {
    await page.evaluate(() => window.__cairnStores.session.setState({
      sessions: [{ id:'z', distanceM:0, durationS:0, startedAt: Date.now(), activityMode:'hiking' }],
    }));
    await page.getByRole('button', { name: 'Activities' }).click();
    await expect(page.locator('[testID="activity-card-0"]')).toContainText(/0\s*(m|km).*0s/);
    await page.screenshot({ path: `${EVIDENCE}/S12-zombie.png` });
  });

  test('S18 Route long-name overflow', async ({ page }) => {
    await page.evaluate(() => window.__cairnStores.route.setState({
      routes: [{ id:'r1', name:'A very very very long route name that will span multiple lines', distanceM:1200, waypoints:[], updatedAt: Date.now(), activityMode:'hiking' }],
    }));
    await page.getByRole('button', { name: 'Routes' }).click();
    const card = page.locator('[testID="route-card-0"]');
    const boundingBox = await card.boundingBox();
    // Card should stay at single-row height (~72px); if >100px it wrapped = bug
    expect(boundingBox.height).toBeLessThan(90);
    await page.screenshot({ path: `${EVIDENCE}/S18-longname.png` });
  });

  test('S33 Nearest without GPS silently falls back', async ({ page }) => {
    await page.evaluate(() => window.__cairnStores.tracking.setState({ lastCoordinate: null }));
    await page.getByRole('button', { name: 'Flags' }).click();
    await page.getByRole('button', { name: /Recent|Nearest/ }).click();
    // Now sort chip says Nearest but ordering is by createdAt — capture
    await page.screenshot({ path: `${EVIDENCE}/S33-nearest-nogps.png` });
  });
});
```

---

## Recommendation priorities (not applied — audit only)

Downstream work suggested for the team, in priority order:

1. **Critical:** add `numberOfLines={1}` + `ellipsizeMode` to `styles.cardTitle` used by Route + Activity cards (S18, CC-3).
2. **Critical:** add CTA to Activities empty state (S05, CC-6).
3. **Critical:** filter zombie sessions (`distanceM < 5 && durationS < 5`) from `ActivitiesTab.visible` memo (S12).
4. **Critical:** add pending-sync banner + pull-to-refresh to Activities (S08, S13, CC-2).
5. **Critical:** show explicit "GPS unavailable" indicator when Nearest sort falls back (S33, CC-2).
6. **Medium:** haptic on SegmentControl tap (S02); rethink tap-vs-longpress redundant sheet (CC-1).
7. **Medium:** localize date format (S09); indicate non-default sort visually (CC-4).
8. **Medium:** clean up dead `FlagEditSheet` component (S36 / CC-8).

All fixes must go through SM → Story → QA subagent verification per CLAUDE.md; this audit is descriptive only.
