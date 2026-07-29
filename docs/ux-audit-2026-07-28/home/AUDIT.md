# HomeScreen Audit — Auditor #1

**Scope**: `app/src/screens/HomeScreen.tsx` (Sprint 41 full-screen layout, OTA O16, 2026-07-28)
**Method**: Static code review + scenario enumeration + Playwright script fragments for main-agent execution.
**Baseline for consistency comparison**: `app/src/screens/SettingsScreen.tsx` (O12–O16 pattern: SectionHeader / ActionRow / card + divider / Type-to-confirm Modal).
**Design tokens**: `app/src/components/tokens.ts`.

---

## Code Review — Structural Observations

### Layout composition
- Root: `SafeAreaView edges={['top','bottom']}` → `<OtaBadge>` (absolute-positioned floating unless downloading/ready) → `Animated.View` with `flex:1`, `paddingHorizontal: Spacing.base`, `paddingTop: Spacing.sm`, `paddingBottom: max(insets.bottom, Spacing.sm) + Spacing.xs`, `gap: Spacing.sm`.
- Vertical stack (top→bottom):
  1. `header` (logo + greeting, `justifyContent: 'space-between'`)
  2. `pendingBanner` (conditional; CloudOff icon + text on `Colors.surfaceMuted`)
  3. `statsRow` (conditional on `hasData`; two pill chips `Route`/`FlagMarker`)
  4. `RecentRow` (conditional on `hasRecent`; live-tracking OR last-hike-within-24h)
  5. `cardsArea` — `flex:1` gap, contains 3 `ActivityCard` (Hiking flex:1 / Running flex:1 / Leave a Cairn flex:0.4)
  6. `toolsRow` — 4× `ToolBtn` (Trails / Friends / Memory / Settings)
  7. `__DEV__` MarkDetail preview link (dev-only)

### Hardcoded values found (see Grep results)
- **HomeScreen line 464** `cardBg="#eef4e8"` (Hiking card background — pale green, not in `Colors`)
- **HomeScreen line 474** `cardBg="#e8f1f8"` (Running card — pale blue, not in `Colors`)
- **HomeScreen line 487** `lightBg="#fbe9d8"` (Leave a Cairn left-panel — flag orange tint, not in `Colors`)
- **HomeScreen line 488** `cardBg="#fff5e9"` (Leave a Cairn body — pale cream, not in `Colors`)
- **HomeScreen line 513** dev preview `color: '#8c7e72'` — value matches `Colors.textSecondary` but is inlined
- **HomeScreen line 548** `Colors.surfaceMuted ?? '#F5F0E5'` — safety fallback that duplicates the token's own value (harmless; not a bug, but redundant since O1 batch added `surfaceMuted`)
- **HomeScreen 559–620** widespread `rgba(255,255,255,...)` glassy fills + `shadowColor: '#000'` — not tokenised, but consistent per surface
- **cardStyles.title lines 602** `fontSize: 20, fontWeight: '800'` — 20 is not in `FontSize` (h1=28, h2=20 exists). Uses the numeric literal 20 rather than `FontSize.h2`.
- **cardStyles.accentLine 604** `width: 28, height: 3` — magic numbers.
- **cardStyles.chevron 606** `width: 36, height: 36, borderRadius: 18` — magic numbers.
- **recentStyles.row 617** `paddingVertical: 10` — magic (not from Spacing scale).
- **recentStyles.dot 623** `width: 28, height: 28, borderRadius: 8` — magic.
- **toolStyles.btn 638** `minHeight: 64` — matches SettingsScreen `rowStyles.row.minHeight: 64` (good).
- **toolStyles.iconWrap 642** `width: 30, height: 30, borderRadius: 15` — magic; not the same 32/8 pattern used in SettingsScreen `rowStyles.iconWrap`.
- **toolStyles.label 646** `fontSize: 11, fontWeight: '600'` — 11 = `FontSize.small`, but uses literal.

### Logic & state flow
- `getGreeting()` (line 33-41): boundaries 5-12 morning / 12-18 afternoon / else evening. Missing "night" (dawn 0-5 falls into "Good evening"). Te Reo variant only on morning.
- `RecentRow` gated live-mode: `status === 'tracking' && (liveDistanceM > 0 || liveDurationS > 5)` — 5-second grace prevents blank "in progress" flash.
- `RecentRow` zombie filter (line 123): `s.distanceM > 0 || s.durationS > 0` + startedAt truthy. Good.
- `RecentRow` age gate (line 129): `> 24h` → `return null`. Row disappears silently, no "yesterday" state.
- `insetsReady` gate (line 268–283): first paint deferred until `insets.bottom > 0` or 250ms timeout. Prevents tab-jump on OTA reload on iOS. Renders `<View style={styles.safe}/>` (blank cream) during gate.
- Location permission prompt (line 337–360): `setTimeout(800ms)` after mount → `expo-location.requestForegroundPermissionsAsync()`. iOS permission dialog appears 800ms after Home renders.
- Dev entry (line 507–515): rendered inside main `Animated.View` root — the `[dev] MarkDetail preview` button occupies vertical space at the bottom AFTER `toolsRow`, potentially pushing toolsRow up on very short devices in dev builds only.

### Consistency issues vs SettingsScreen baseline
| Aspect | SettingsScreen | HomeScreen | Note |
|---|---|---|---|
| Top-bar | SafeAreaView + BackButton, no floating badge | SafeAreaView + floating OtaBadge (top-right, absolute) | Home has no explicit top-bar; OtaBadge lives above header content |
| Row iconWrap | 32×32, borderRadius 8 | ToolBtn 30×30 rounded circle | Different geometry |
| Section separators | `SectionHeader` (text label) + `styles.card` + `styles.divider` between rows | No sections. Cards float on `Colors.bg` | Home has visual hierarchy through card shape, not section labels |
| Card background | `Colors.surface` (#ffffff) with 1px `Colors.border` | Custom `#eef4e8` / `#e8f1f8` / `#fff5e9` + white-alpha border | Home cards deliberately tinted per activity — intentional colour-coding |
| Type scale | `FontSize.body/small/h3` used consistently | Mix of tokens + literals (20, 11 in cardStyles/toolStyles) | Mild drift; not user-visible |

---

## Scenarios

Score legend: **一致性** = design coherence with rest of app / **UX** = first-time user usability. 10 = ship, 5 = borderline, ≤4 = bug.

### S01: Cold boot logged-out
- 功能: If not signed in, AuthGate intercepts → Auth screen shown (not Home). If bypass hook active on web, Home renders directly.
- 预期 UI: Auth screen. If bypassed: Home with logo + greeting + no stats/recent, three ActivityCards, tools row.
- 一致性: 8/10 — OtaBadge floats top-right on Home; on Auth it renders inline above the title. Cognitive break between the two.
- UX: 7/10 — Splash background (`Colors.bg` cream) shown for up to 250ms via `insetsReady` gate; can look like a hang on cold boot.
- Issues:
  - 破碎: none
  - 丑: brief blank cream splash before first paint (up to 250ms)
  - 不一致: OtaBadge position differs between Auth (inline) vs Home (floating top-right)
- Notes: Auth vs Home shift is deliberate but jarring.

### S02: Cold boot logged-in, empty state (0 sessions, 0 markers in current region)
- 功能: `hasData = false` → statsRow hidden. `hasRecent = false` → RecentRow hidden. Cards + tools only.
- 预期 UI: Header → Cards (huge, filling ~70% viewport) → Tools row.
- 一致性: 8/10 — no achievement/onboarding hint for zero-state; contrasts with SettingsScreen's polite Memory badge with big numbers.
- UX: 6/10 — an empty first-run home has three big cards but no "Start your first hike" hero. User must infer that tapping Hiking begins.
- Issues:
  - 破碎: no
  - 丑: no
  - 不一致: SettingsScreen actively celebrates progress with badges; Home has no equivalent first-run celebration/prompt
- Notes: Consider a "Kia ora — your first cairn awaits" empty-state under the greeting.

### S03: Logged-in, 1 session, within 24h
- 功能: statsRow shows "1 session"; RecentRow shows last hike badge + distance + relative time + chevron.
- 预期 UI: header · stats(1 session, 0 flags) · RecentRow · cards · tools.
- 一致性: 8/10 — RecentRow uses same shadow/glass surface as statChip; visually a family.
- UX: 8/10 — clear entry point back to last hike.
- Issues:
  - 破碎: none
  - 丑: statsRow "0 flags" chip still shows even when count is 0 — plural helper produces "0 flags" not hidden — this is intentional but visually redundant on first-hike day
  - 不一致: none
- Notes: FlagMarkerIcon in statChip is 14px, but Route icon is 12px — 2px asymmetry.

### S04: Logged-in, many sessions (N=25), varied dates
- 功能: Latest session picked by reduce max startedAt. Others invisible on Home.
- 预期 UI: statsRow "25 sessions"; RecentRow may or may not appear (depends on 24h gate on latest).
- 一致性: 8/10
- UX: 7/10 — no way to see history from Home directly (must go to Trails tool). RecentRow gives one entry point at most.
- Issues:
  - 破碎: none
  - 丑: "25 sessions" static number doesn't communicate cumulative distance / big win
  - 不一致: SettingsScreen Memory badges show "N places explored" with icon flair; Home stat chip is small and grey by comparison
- Notes: Consider promoting stats visually when data is dense.

### S05: Latest hike is >24h old
- 功能: `ageMs > 24*60*60*1000` → RecentRow returns null.
- 预期 UI: statsRow shown (still `hasData=true`), but no RecentRow.
- 一致性: 7/10 — asymmetric: stats visible ("1 session") but no easy way to re-open it from Home. User must tap Trails.
- UX: 6/10 — feels like the app "forgot" recent activity abruptly at hour 25.
- Issues:
  - 破碎: none (works as designed)
  - 丑: cliff at 24h — no "yesterday" tier
  - 不一致: `getRelativeTime` in `utils/geo.ts` supports "yesterday" and "N days ago", but RecentRow filters them out
- Notes: Consider extending to 48h with a softer visual for "yesterday" entries.

### S06: Live tracking in progress (Hiking mode, distance > 0)
- 功能: `status === 'tracking' && liveDistanceM > 0` → live variant. Pulse animation on dot. Tap → nav to Hiking screen (Resume).
- 预期 UI: green dot (pulsing scale 1↔1.4 over 900ms) + "Hiking in progress" + `X.XX km · MM:SS` + green "Resume" text + chevron.
- 一致性: 9/10 — matches RecentRow shape.
- UX: 8/10 — clear.
- Issues:
  - 破碎: none
  - 丑: none
  - 不一致: none
- Notes: This is the flagship case for RecentRow.

### S07: Live tracking, distance=0 but duration >5s
- 功能: OR gate — live variant still renders because `liveDurationS > 5`.
- 预期 UI: live variant with `0.00 km · 00:05` (or higher).
- 一致性: 8/10
- UX: 7/10 — 0.00 km looks broken to a first-time user even though it's technically correct at 5s.
- Issues:
  - 破碎: none
  - 丑: "0.00 km" numeric fluttering at start of hike
  - 不一致: distance format uses 2 decimals for live (`dist.format(liveDistanceM, 2)`), 1 decimal for last hike (`dist.format(last.distanceM, 1)`) — see line 110 vs 136
- Notes: Format inconsistency is intentional (live = precision, past = summary) but user-visible.

### S08: Zombie session (name=undefined, distance=0, duration=0)
- 功能: Filter `(s.distanceM > 0 || s.durationS > 0) && s.startedAt` (line 123) drops them.
- 预期 UI: as if that session didn't exist. But `sessions.length` in statsRow (line 444) uses raw `sessions.length` — so stat chip still counts the zombie.
- 一致性: 6/10 — stat count and RecentRow disagree about what's a session.
- UX: 5/10 — "3 sessions" chip but only 1 in history feels inconsistent.
- Issues:
  - 破碎: minor — `plural(sessions.length, 'session')` at line 444 is NOT filtered against zombies
  - 丑: none
  - 不一致: statsRow session count includes zombies; RecentRow's `validSessions` filter does not
- Notes: **Bug candidate — likely Medium.** statsRow should count `validSessions.length` too.

### S09: pendingCount = 1 (offline hike waiting to sync)
- 功能: `sessions.filter(syncState pending|syncing && hasContent).length > 0` → banner renders under header, above stats.
- 预期 UI: `Colors.surfaceMuted` cream banner, CloudOff icon, "1 hike pending sync — will complete when online".
- 一致性: 8/10 — uses tokenised colours; matches subtle banner pattern.
- UX: 8/10 — clear, reassuring copy.
- Issues:
  - 破碎: none
  - 丑: none
  - 不一致: banner sits between header and stats, pushes stats down — layout shift on come-back-online
- Notes: Good.

### S10: pendingCount ≥ 2
- 功能: Copy pluralises: "3 hikes pending sync — will complete when online".
- 预期 UI: same banner shape.
- 一致性: 8/10
- UX: 8/10
- Issues: none.

### S11: OTA badge — checking state on cold boot (floating mode)
- 功能: Floating badge hidden while `state === 'checking'` (line 444–446).
- 预期 UI: nothing at top-right. User doesn't see the check.
- 一致性: 9/10 — matches "silent until actionable" pattern.
- UX: 8/10.
- Issues: none.

### S12: OTA badge — downloading state
- 功能: Fade-in from 0→1 over 280ms. Spinner + "O16 · Downloading update".
- 预期 UI: floating pill top-right, ~10px below top inset.
- 一致性: 8/10 — matches inline OtaBadge in Auth cognitively.
- UX: 9/10 — very reassuring.
- Issues:
  - 破碎: none
  - 丑: pill sits near iPhone 14/15 Pro Dynamic Island — `topOffset = insets.top + 10` should clear it
  - 不一致: none

### S13: OTA badge — ready state (downloaded, awaiting restart)
- 功能: Pulse animation (1↔1.06 over 700ms). Tap → modal "Restart now / Later". Auto-reload also scheduled 600ms after download → briefly visible.
- 预期 UI: amber dot, "O16 · Update downloaded" pill.
- 一致性: 9/10 — modal style consistent with SettingsScreen TypeToConfirmModal shape.
- UX: 9/10.
- Issues: none.

### S14: OTA badge — error state (floating mode)
- 功能: Floating mode hides on error (line 444–446). User never sees.
- 预期 UI: nothing.
- 一致性: 6/10 — silent failures.
- UX: 5/10 — user has no way to know an OTA check failed → possibly running old bundle without knowledge.
- Issues:
  - 破碎: none
  - 丑: none
  - 不一致: inline OtaBadge (Auth screen) DOES show error state ("Couldn't check · tap to retry"), floating mode does NOT
- Notes: **Product decision worth revisiting.** Consider surfacing error state on Home too.

### S15: Long name overflow — activity card title
- 功能: `cardStyles.title` has no `numberOfLines`. Cairn's titles are static ("Hiking" / "Running" / "Leave a Cairn here").
- 预期 UI: three cards, title fits on one line at 20pt.
- 一致性: 9/10.
- UX: 8/10.
- Issues:
  - 破碎: none for static content
  - 丑: none
  - 不一致: `ToolBtn` label uses `numberOfLines={1}` (line 222), ActivityCard title does not. If ever i18n'd to a longer NZ Te Reo compound word, title could wrap or overflow.
- Notes: Trivial today; risk if labels ever come from data.

### S16: Long "N sessions" label
- 功能: `plural(n, 'session')` unbounded. For 100+ sessions text stays short.
- 预期 UI: `statText` sits inline in pill.
- 一致性: 8/10.
- UX: 8/10.
- Issues: none.

### S17: Imperial vs Metric units
- 功能: `useDistance()` returns `{format, unit}`. Both live variant (line 110) and last-hike variant (line 136) use it.
- 预期 UI: `1.23 mi · 05:32` when imperial.
- 一致性: 9/10.
- UX: 9/10 — no visible fault.
- Issues:
  - 破碎: none
  - 丑: none
  - 不一致: none
- Notes: The 10-meter cutover (line 135 `last.distanceM > 10 ? ... : formatDuration(...)`) is metric-only in threshold. In imperial that's `10m ≈ 32.8ft`, so a 10-yard walk shows duration instead of distance. Small edge case.

### S18: Morning greeting (5:00–11:59)
- 功能: Returns "Kia ora, Explorer" (Te Reo touch).
- 预期 UI: `.greeting` text right-aligned in header.
- 一致性: 8/10.
- UX: 9/10 — nice cultural touch.
- Issues: none.

### S19: Afternoon greeting (12:00–17:59)
- 功能: "Good afternoon, Explorer".
- 一致性: 8/10.
- UX: 9/10.
- Issues: none.

### S20: Evening greeting (18:00–4:59)
- 功能: Includes hours 0-4 (technically night). "Good evening" fires for a 3am open.
- 一致性: 7/10.
- UX: 7/10 — "Good evening" at 3am is off.
- Issues:
  - 破碎: none
  - 丑: greeting doesn't match wall clock outside sensible windows
  - 不一致: comment on line 36 says only morning/afternoon/evening — deliberate but slightly wrong for night owls
- Notes: Consider adding "Kia po, Explorer" or "Good night, Explorer" for 22:00-04:59.

### S21: Small screen (iPhone SE 375×667)
- 功能: `ActivityCard` `panelW = min(round(screenW * 0.32), 130)` → 375*0.32 = 120 → panelW=120. iconSize=66.
- 预期 UI: three cards stacked flex 1/1/0.4 = 2.4 total. Given fixed header/tools/gap the cardsArea has ~430px. Each unit ≈ 179px. So Hiking + Running ≈ 179px each, Leave-a-Cairn ≈ 71px.
- 一致性: 8/10 — golden-ratio doesn't hold on shortest screens; Leave-a-Cairn card compresses.
- UX: 6/10 — third card can look cramped with 3-line copy at 71px height.
- Issues:
  - 破碎: potential — Leave-a-Cairn subtitle "Drop a note for friends or your future self" is 8 words + accent line + chevron; at 71px height with padding, subtitle may clip or wrap awkwardly
  - 丑: yes on iPhone SE
  - 不一致: none

### S22: Large screen (iPhone 15 Pro Max 430×932)
- 功能: `panelW = min(round(430*0.32), 130) = min(138, 130) = 130`. Cap engaged.
- 预期 UI: cards feel more spacious. Bottom inset larger.
- 一致性: 9/10.
- UX: 9/10.
- Issues: none.

### S23: Playwright bypass mode (web dev)
- 功能: `__cairnStores` and `navigationRef` test hooks — declared as pre-launch cleanup pending per memory `project_v406_web_test_hook.md`.
- 预期 UI: full Home visible on web without going through Auth.
- 一致性: N/A (dev-only).
- UX: N/A.
- Issues:
  - Not user-facing. Note left in memory says this must be removed before production. Confirm before App Store submission.

### S24: Real user mode (device)
- 功能: `Platform.OS === 'ios'` → `insetsReady` gate honoured. `expo-location` prompt after 800ms.
- 预期 UI: normal Home + iOS permission dialog once after mount.
- 一致性: 9/10.
- UX: 8/10 — 800ms delay is enough to see Home first (good), but permission dialog covers the tools row.
- Issues:
  - 破碎: none
  - 丑: none
  - 不一致: no in-app rationale card before the OS prompt — some competitors show a soft prompt first

### S25: Tap Hiking card
- 功能: `nav.navigate('Hiking')`. Card scale animates 1→0.97→1 on press.
- 一致性: 9/10.
- UX: 9/10.
- Issues: none.

### S26: Tap Running card
- 功能: `nav.navigate('Running')`. Same animation.
- 一致性: 9/10.
- UX: 9/10.

### S27: Tap Leave-a-Cairn card
- 功能: appLog `home.tap_plant` → `nav.navigate('Plant')`.
- 一致性: 8/10 — only card with an appLog side-effect. Others don't log. Inconsistency in observability.
- UX: 9/10.
- Issues:
  - 不一致: only "Plant" is logged; Hiking/Running have no equivalent log

### S28: Tap Trails / Friends / Memory / Settings tool
- 功能: nav to `Routes` / `Friends` / `Memory` / `Settings`. Scale 1→0.93.
- 一致性: 8/10 — icons are Lucide `Route`, `Users`, `Map`, `Settings2`. Trails uses the same `Route` icon as the statChip → mild ambiguity ("Route" chip up top vs "Trails" tool at bottom).
- UX: 8/10.
- Issues:
  - 不一致: `Route` icon reused for both stats and tools row → semantically overloaded

### S29: MarkDetail dev preview button visibility
- 功能: `__DEV__ ? <TouchableOpacity/> : null`. Text `[dev] MarkDetail preview` in `#8c7e72` at 11pt, centred.
- 一致性: N/A (dev-only, but colour matches `Colors.textSecondary`).
- UX: N/A.
- Issues:
  - 破碎: in DEV builds this button sits BELOW the toolsRow inside the main Animated.View — on iPhone SE it may push tools up or clip. In production builds this is invisible.
- Notes: fine for prod.

### S30: Loading state during hydrate (insetsReady=false on iOS)
- 功能: `return <View style={styles.safe} />` — blank cream screen.
- 一致性: 5/10 — a totally blank screen with no indication.
- UX: 5/10 — up to 250ms of blank cream can look like a hang on cold boot; the user has no signal.
- Issues:
  - 破碎: none
  - 丑: yes — silent blank
  - 不一致: rest of app shows loaders or splash; this is a 250ms flash of `Colors.bg` with no logo
- Notes: Consider rendering just the CairnLogo centred during this window.

### S31: Network offline (affects OtaBadge and pending banner)
- 功能: OtaBadge check will timeout after 30s → error state → silent in floating mode. pendingBanner will render if there are queued sessions.
- 一致性: 7/10 — silent OTA on Home vs visible error on Auth.
- UX: 7/10.
- Issues:
  - 不一致: user with no wifi has NO indication OTA check happened/failed on Home

### S32: Pending banner + statsRow + RecentRow all visible simultaneously (worst-case density)
- 功能: banner (~40px) + statsRow (~32px) + RecentRow (~52px) + cardsArea (flex:1) + toolsRow (~72px). On iPhone SE (~600px usable height): 40+32+52+72 = 196 fixed, cardsArea = ~404px. Split 1/1/0.4 = 168/168/68.
- 一致性: 8/10.
- UX: 6/10 — Leave-a-Cairn card at 68px will clip subtitle for sure.
- Issues:
  - 破碎: **likely Critical on SE** — Leave-a-Cairn card subtitle clipped when all three optional rows visible
  - 丑: yes
  - 不一致: cards' flex allocation is fixed 1/1/0.4 regardless of vertical budget
- Notes: **Bug candidate — Critical on SE class devices.**

---

## Consistency vs SettingsScreen baseline

| Concern | Home | Settings | Verdict |
|---|---|---|---|
| Top-bar treatment | Absolute-positioned OtaBadge; no back button | BackButton + no floating badge | Different by role (Home is root); acceptable |
| Card colour | Custom `#eef4e8/#e8f1f8/#fff5e9` per activity | `Colors.surface` neutral white | Home cards deliberately colour-coded (activity → colour); intentional |
| Card corner radius | `Radius.cardLg = 20` | `Radius.card = 14` | Home is more prominent — intentional |
| Row iconWrap | ToolBtn 30×30 borderRadius 15 (circle) | rowStyles iconWrap 32×32 borderRadius 8 (rounded square) | Inconsistent; different geometry across screens |
| Type scale | Mix tokens + literals (20, 11) | Tokens only | Home has minor drift; not user-visible |
| Divider | none (cards float) | `styles.divider` (52px indent) between rows | Different layout style, both fine |
| Font weight for CTA-ish text | Cards title `800`, ToolBtn label `600` | ActionRow label `500` | Home is more emphatic (root screen); intentional |
| Presence of SectionHeader | none | yes | Home doesn't group; Settings does |
| Modal use | none direct; OtaBadge modal (nested) | TypeToConfirmModal | Different needs |
| Shadow | `Shadow.card` (elevated=6) for ActivityCard, `Shadow.card` for ToolBtn | `Shadow.card` | Consistent |

**Net**: Home vs Settings are visually two families sharing the same tokens. The intentional differences (rounded circle vs rounded square icon frames, colour-coded cards, no dividers) are defensible design choices. **The one drift-y point is `ToolBtn`'s 30×30 circle icon vs Settings' 32×32 rounded-square** — same role (row-leading icon), different geometry.

---

## Playwright scripts (for main agent to execute)

Base URL assumed `http://localhost:8086/` (web dev with `__cairnStores` bypass hook available). Adjust per real host.

```
### S01
NAVIGATE http://localhost:8086/
WAIT 1500
SCREENSHOT home/S01-cold-boot.png
```

```
### S02
EVALUATE window.__cairnStores?.session?.setState({ sessions: [] }); window.__cairnStores?.marker?.setState({ markers: [] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1200
SCREENSHOT home/S02-empty-logged-in.png
FULLPAGE_SCREENSHOT home/S02-empty-fullpage.png
```

```
### S03
EVALUATE window.__cairnStores?.session?.setState({ sessions: [{ id:'s1', activityMode:'hiking', startedAt: Date.now()-3600000, distanceM: 1234, durationS: 900, syncState:'synced' }] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S03-one-session-24h.png
```

```
### S04
EVALUATE (() => { const now = Date.now(); const rows = Array.from({length:25}, (_,i) => ({ id:'s'+i, activityMode: i%2? 'hiking':'running', startedAt: now - i*3600*1000*3, distanceM: 500 + i*200, durationS: 300+i*60, syncState:'synced' })); window.__cairnStores?.session?.setState({ sessions: rows }); })();
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S04-many-sessions.png
```

```
### S05
EVALUATE window.__cairnStores?.session?.setState({ sessions: [{ id:'sold', activityMode:'hiking', startedAt: Date.now()-40*3600*1000, distanceM: 5000, durationS: 3600, syncState:'synced' }] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S05-latest-over-24h.png
```

```
### S06
EVALUATE window.__cairnStores?.tracking?.setState({ status:'tracking', activityMode:'hiking', distanceM: 1234, durationS: 300 });
NAVIGATE http://localhost:8086/#/Home
WAIT 1500
SCREENSHOT home/S06-live-hiking.png
WAIT 1000
SCREENSHOT home/S06-live-hiking-pulse.png
```

```
### S07
EVALUATE window.__cairnStores?.tracking?.setState({ status:'tracking', activityMode:'hiking', distanceM: 0, durationS: 7 });
NAVIGATE http://localhost:8086/#/Home
WAIT 1200
SCREENSHOT home/S07-live-zero-distance.png
```

```
### S08
EVALUATE window.__cairnStores?.session?.setState({ sessions: [{ id:'z1', startedAt: Date.now()-10000, distanceM: 0, durationS: 0, syncState:'synced' }, { id:'v1', activityMode:'hiking', startedAt: Date.now()-3600000, distanceM: 1000, durationS: 600, syncState:'synced' }] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S08-zombie-session.png
```

```
### S09
EVALUATE window.__cairnStores?.session?.setState({ sessions: [{ id:'p1', activityMode:'hiking', startedAt: Date.now()-1800000, distanceM: 2000, durationS: 1200, syncState:'pending' }] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S09-pending-1.png
```

```
### S10
EVALUATE (() => { const now=Date.now(); window.__cairnStores?.session?.setState({ sessions: [ {id:'p1',activityMode:'hiking',startedAt:now-3600e3,distanceM:2000,durationS:1200,syncState:'pending'}, {id:'p2',activityMode:'running',startedAt:now-7200e3,distanceM:3000,durationS:1500,syncState:'pending'}, {id:'p3',activityMode:'hiking',startedAt:now-10800e3,distanceM:800,durationS:400,syncState:'syncing'} ] }); })();
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S10-pending-many.png
```

```
### S11
EVALUATE window.__ota_force_state = 'checking';
NAVIGATE http://localhost:8086/#/Home
WAIT 500
SCREENSHOT home/S11-ota-checking.png
```

```
### S12
EVALUATE window.__ota_force_state = 'downloading';
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S12-ota-downloading.png
```

```
### S13
EVALUATE window.__ota_force_state = 'ready';
NAVIGATE http://localhost:8086/#/Home
WAIT 1500
SCREENSHOT home/S13-ota-ready.png
CLICK "Update downloaded"
WAIT 500
SCREENSHOT home/S13-ota-modal.png
```

```
### S14
EVALUATE window.__ota_force_state = 'error';
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S14-ota-error-hidden-on-home.png
```

```
### S15
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S15-card-titles-default.png
```

```
### S16
EVALUATE (() => { const rows = Array.from({length:250}, (_,i) => ({ id:'z'+i, activityMode:'hiking', startedAt: Date.now()-i*3600e3, distanceM: 500+i*10, durationS: 300, syncState:'synced' })); window.__cairnStores?.session?.setState({ sessions: rows }); })();
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S16-huge-session-count.png
```

```
### S17
EVALUATE window.__cairnStores?.settings?.setState({ units: 'imperial' }); window.__cairnStores?.session?.setState({ sessions: [{ id:'s1', activityMode:'hiking', startedAt: Date.now()-1800000, distanceM: 1609, durationS: 900, syncState:'synced' }] });
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S17-imperial.png
```

```
### S18
EVALUATE Date.prototype.getHours = () => 8;
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S18-greeting-morning.png
```

```
### S19
EVALUATE Date.prototype.getHours = () => 14;
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S19-greeting-afternoon.png
```

```
### S20
EVALUATE Date.prototype.getHours = () => 3;
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S20-greeting-late-night.png
```

```
### S21
RESIZE 375x667
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S21-iphone-se.png
FULLPAGE_SCREENSHOT home/S21-iphone-se-fullpage.png
```

```
### S22
RESIZE 430x932
NAVIGATE http://localhost:8086/#/Home
WAIT 1000
SCREENSHOT home/S22-15-pro-max.png
FULLPAGE_SCREENSHOT home/S22-15-pro-max-fullpage.png
```

```
### S23
NAVIGATE http://localhost:8086/?bypassAuth=1
WAIT 1200
SCREENSHOT home/S23-playwright-bypass.png
```

```
### S24
NAVIGATE http://localhost:8086/#/Home
WAIT 3000
SCREENSHOT home/S24-real-user-post-permission.png
```

```
### S25
NAVIGATE http://localhost:8086/#/Home
WAIT 800
CLICK "Hiking"
WAIT 800
SCREENSHOT home/S25-after-tap-hiking.png
```

```
### S26
NAVIGATE http://localhost:8086/#/Home
WAIT 800
CLICK "Running"
WAIT 800
SCREENSHOT home/S26-after-tap-running.png
```

```
### S27
NAVIGATE http://localhost:8086/#/Home
WAIT 800
CLICK "Leave a Cairn here"
WAIT 800
SCREENSHOT home/S27-after-tap-plant.png
```

```
### S28
NAVIGATE http://localhost:8086/#/Home
WAIT 800
CLICK "Trails"
WAIT 800
SCREENSHOT home/S28a-trails.png
NAVIGATE http://localhost:8086/#/Home
WAIT 500
CLICK "Friends"
WAIT 800
SCREENSHOT home/S28b-friends.png
NAVIGATE http://localhost:8086/#/Home
WAIT 500
CLICK "Memory"
WAIT 800
SCREENSHOT home/S28c-memory.png
NAVIGATE http://localhost:8086/#/Home
WAIT 500
CLICK "Settings"
WAIT 800
SCREENSHOT home/S28d-settings.png
```

```
### S29
NAVIGATE http://localhost:8086/#/Home
WAIT 800
SCREENSHOT home/S29-dev-preview-button.png
```

```
### S30
EVALUATE window.__forceInsetsBottomZero = true;
NAVIGATE http://localhost:8086/#/Home
WAIT 100
SCREENSHOT home/S30-hydrate-blank.png
WAIT 300
SCREENSHOT home/S30-hydrate-after.png
```

```
### S31
EVALUATE window.__cairnStores?.session?.setState({ sessions: [{ id:'p1', activityMode:'hiking', startedAt: Date.now()-1800000, distanceM: 1000, durationS: 600, syncState:'pending' }] }); window.__forceOtaError = true;
NAVIGATE http://localhost:8086/#/Home
WAIT 1500
SCREENSHOT home/S31-offline.png
```

```
### S32
RESIZE 375x667
EVALUATE (() => { const now = Date.now(); window.__cairnStores?.session?.setState({ sessions: [ {id:'p1',activityMode:'hiking',startedAt:now-3600e3,distanceM:2000,durationS:1200,syncState:'pending'}, {id:'v1',activityMode:'running',startedAt:now-1800e3,distanceM:3000,durationS:1500,syncState:'synced'} ] }); window.__cairnStores?.marker?.setState({ markers:[{id:'m1',regionCode:'nz',lat:-41,lng:174}] }); })();
NAVIGATE http://localhost:8086/#/Home
WAIT 1200
SCREENSHOT home/S32-worst-density-se.png
FULLPAGE_SCREENSHOT home/S32-worst-density-fullpage.png
```

---

## Suggested Fixes (priority order)

1. **[Critical] iPhone SE dense-state clip** (S32): When pending banner + statsRow + RecentRow all show, Leave-a-Cairn card compresses to <80px and subtitle wraps/clips. Consider (a) hide Leave-a-Cairn card when vertical budget is tight, or (b) drop its `flex: 0.4` to `flex: 0` and give it a fixed `minHeight: 96`. Verify via Playwright S32 screenshot.
2. **[Medium] Zombie sessions counted in statsRow but not in RecentRow** (S08): `plural(sessions.length, 'session')` at line 444 should use the same `(s.distanceM > 0 || s.durationS > 0) && s.startedAt` filter used inside `RecentRow` (line 123). Otherwise stat chip and recent row disagree.
3. **[Medium] 24h RecentRow cliff** (S05): extend to 48h with a softer visual for "yesterday"; leverage `utils/geo.getRelativeTime` which already supports "yesterday" and "N days ago".
4. **[Medium] Silent OTA error on Home** (S14, S31): floating OtaBadge hides on `error` state → user has no way to notice OTA check failed. Consider showing a subtle grey "Couldn't check · tap to retry" on Home too.
5. **[Medium] Blank cream splash during insetsReady gate** (S30): 0–250ms fully blank screen. Render at least the `CairnLogo` centred during the gate.
6. **[Low] getGreeting missing "night"** (S20): "Good evening" at 3am. Add night branch for 22:00-04:59.
7. **[Low] Hardcoded card background colours** (lines 464, 474, 487, 488): move `#eef4e8` / `#e8f1f8` / `#fbe9d8` / `#fff5e9` into `tokens.ts` as `Colors.hikingCardBg` / `Colors.runningCardBg` (already exists) / `Colors.flagLightBg` / `Colors.flagCardBg` for future dark-mode support.
8. **[Low] Icon geometry drift** (S28 vs Settings): ToolBtn iconWrap 30×30 borderRadius 15 (circle) doesn't match SettingsScreen rowStyles.iconWrap 32×32 borderRadius 8 (rounded square). Decide on one system-wide.
9. **[Low] `Route` icon reused** (S28): stats chip AND Trails tool both use `Route`. Consider `Compass` or `MapPin` for Trails.
10. **[Low] Live vs last-hike decimal inconsistency** (S07): live shows 2 decimals ("0.00 km"), last-hike shows 1 decimal. Not visible drift but reads slightly inconsistent.
11. **[Low] Dev-only MarkDetail preview button pushes toolsRow up on SE** (S29): in DEV builds only, but consider moving to a hidden dev overlay rather than into the main layout column.
12. **[Info] `__cairnStores` + `navigationRef` web test hooks**: memory `project_v406_web_test_hook.md` says these must be removed before production. Confirm before App Store submission (S23).

---

**End of audit.** All 32 scenarios independently scored. Playwright fragments target `localhost:8086` — main agent should adjust host/route as needed and drive execution.
