# UX/UI Audit — RouteEditor / MarkerDetailScreen / MarkerDetailSheet

**Auditor**: A12
**Date**: 2026-07-28
**Baseline**: SettingsScreen O12 (2026-07-27) — tokens.ts (`Colors` / `Spacing` / `Radius` / `FontSize` / `IconSize` / `Shadow`)
**Files reviewed**:
- `app/src/screens/RouteEditorScreen.tsx` (1150 lines)
- `app/src/screens/MarkerDetailScreen.tsx` (657 lines)
- `app/src/screens/MarkerDetailSheet.tsx` (170 lines)
- `app/src/components/tokens.ts` (design system)

---

## 1. Screen summary

### RouteEditorScreen (view + edit route)
Full-screen map hero with floating BackButton and a bottom rounded card. Two operational modes:
- **View-mode**: sage-tint summary card with editable name `TextInput`, stats inline, personal/friend permission chips, and a 2-3 button action row (Delete + Edit + Save; Delete hidden for save-as-route flow).
- **Edit-mode**: `EditOverlayV274` renders tool strip + Preview/Beautify/Save/Cancel; brush gesture layer + dual-line map layer.
- Uses tokens: `Colors.primary`, `Colors.primaryBg`, `Colors.surface`, `Colors.border`, `Colors.danger`, `Colors.textPrimary/Secondary/Muted`, `Spacing.*`, `Radius.button/pill/card/sheet`, `FontSize.h3/body/small/caption`, `Shadow.card/elevated`. Mostly tokenised.

### MarkerDetailScreen (marker detail full-screen)
`SafeAreaView` with map hero (min 280px, or `H - 480`), scrollable panel below. Header row: type badge + optional `SyncBadge` + visibility badge. Two modes:
- **View-mode**: title + body + meta list (date, coord) + optional publicSnapshot divergence banner + owner-only Delete/Edit buttons (disabled when offline).
- **Edit-mode**: type chip row + title `TextInput` + note multiline `TextInput` + permission chip row + "location locked" notice + Cancel/Save.
- Uses tokens **inconsistently** — many raw hex/pixel values, uses `MemoryColors.cream` / `sepia` / `sepiaDeep` (feature-scoped palette) rather than the global `Colors` tokens.

### MarkerDetailSheet (in-hike bottom sheet)
Animated absolute-fill overlay + bottom sheet with `Radius.sheet`, backdrop tap = close, slide-in from 400px. Header (type badge + close X), note or "(No note)" italic, meta rows (time-ago / coord / distance / approximate warning), two-stage Delete button (tap → "Confirm Delete" red state).
- Uses tokens: `Colors.surface`, `Radius.sheet/pill/button`, `Spacing.*`, `FontSize.*`, `IconSize.sm`, `Shadow.overlay`. Mostly clean.

---

## 2. Cross-screen consistency findings (Settings baseline)

| Token / pattern | Settings baseline | RouteEditor | MarkerDetailScreen | MarkerDetailSheet |
|---|---|---|---|---|
| Card radius | `Radius.card` (14) | `Radius.card` OK | `Radius.md` (12) drift | n/a |
| Button radius | `Radius.button` (12) | `Radius.button` OK | `Radius.md` (12) drift | `Radius.button` OK |
| Sheet radius | `Radius.sheet` (20) | `Radius.sheet` OK | n/a | `Radius.sheet` OK |
| Primary color | `Colors.primary` (#5d7c46) | `Colors.primary` OK | `MemoryColors.sepia` drift | mainly `Colors.danger` for delete |
| Text primary | `Colors.textPrimary` | `Colors.textPrimary` OK | `MemoryColors.sepiaDeep` drift | `Colors.textSecondary` (note) |
| Body font | `FontSize.body` (15) | `FontSize.body` OK | raw `14` drift | `FontSize.body` OK |
| Title font | `FontSize.h3` (17) | `FontSize.h3` OK | raw `24` and `22` drift | n/a |
| Caption | `FontSize.caption` (13) | `FontSize.caption` OK | raw `11`, `12`, `10` drift | `FontSize.caption/small` OK |
| Spacing scale | tokenised | tokenised | mostly tokenised (a few raw px) | tokenised |
| Border color | `Colors.border` | `Colors.border` OK | `Colors.border` OK | `Colors.border` OK |

**Verdict**: MarkerDetailScreen has the worst design-system hygiene of the three — 20+ hardcoded pixel values and diverges from the global `Colors` palette in favor of `MemoryColors`. RouteEditor and MarkerDetailSheet are mostly clean. This creates a visible "the marker detail page is from another app" impression when navigating between marker → route → settings.

---

## 3. Scenarios table

Columns: Screen | 功能 | 小功能 | 场景 | 预期UI | 一致性1-10 | UX1-10 | Issues

| # | Screen | 功能 | 小功能 | 场景 | 预期UI | 一致性 | UX | Issues |
|---|---|---|---|---|---|---|---|---|
| 1 | RouteEditor | View route | existing route with name + points | Map fit bounds, sage bottom card name/stats/permission/Edit+Save | 8 | 7 | I-01: Save always enabled while name non-empty — no diff detection (comment admits PO option a) |
| 2 | RouteEditor | View route | empty name | Save button opacity 0.4 grayed | 9 | 6 | I-02: `viewSaveBtnDisabled` only sets `opacity: 0.4`, still catches touches; `activeOpacity=0.85` flashes press feedback, misleading |
| 3 | RouteEditor | Save as route | fromSessionId, sessionTrackPoints < 2 | Show loading state | 6 | 4 | I-03 CRITICAL: renders `enterEditError='Loading route data — please try again in a moment.'` — loading state disguised as error banner |
| 4 | RouteEditor | Name input | 200-char name | Single-line TextInput, scrolls or truncates | 6 | 4 | I-04: `viewSummaryName` has no `numberOfLines`, no `maxLength`; long name silently horizontal-scrolls |
| 5 | RouteEditor | Name input | 1-char "a" | Save enables | 9 | 7 | I-05: `name.trim().length > 0` allows single char; no min-length hint |
| 6 | RouteEditor | Cancel edit | Android back / in-screen Cancel | Alert "Discard edits?" | 9 | 8 | I-06: iOS lacks equivalent — swipe-back exits edit silently, data lost. Should set `gestureEnabled=false` when editing |
| 7 | RouteEditor | Save existing | update flow, backend 500 | Alert "Save failed" | 8 | 6 | I-07: `saving` state has no timeout; 30s hang gives no cancel option |
| 8 | RouteEditor | Delete route | Owner taps Delete | Alert with cancel/destructive | 9 | 8 | I-08: alert message does not include the route name (user could delete wrong route) |
| 9 | RouteEditor | Permission chips | Toggle Just me / Friends | Border primary, bg primaryBg | 9 | 8 | I-09: no Public option in v1 (intentional per v4 §11), but no tooltip explains it |
| 10 | RouteEditor | Permission chips | 375 viewport | Two chips inline | 7 | 6 | I-10: fits English but i18n (Chinese/German) would overflow |
| 11 | RouteEditor | Keyboard | name TextInput focus | KeyboardAvoidingView padding | 8 | 7 | I-11: `keyboardVerticalOffset={0}` — no header offset, permission chips can hide behind soft keyboard |
| 12 | RouteEditor | Delete visibility | save-as-route new flow | Delete hidden | 10 | 9 | OK — `{routeId && ...}` correct |
| 13 | RouteEditor | Error banner | enterEditError shown | Red border, alert triangle, text | 9 | 8 | I-12: `numberOfLines={2}` truncates long backend messages |
| 14 | RouteEditor | 393 viewport | iPhone 14 | Panel auto height | 8 | 8 | no issue |
| 15 | RouteEditor | 428 viewport | Pro Max | Panel with wider gutter | 8 | 8 | no issue |
| 16 | MarkerDetailScreen | View marker | Full title + body | 24pt title, 14pt body, meta list | 5 | 7 | I-13: `fontSize: 24` hardcoded (not in scale — h1=28 / h2=20). Uses `MemoryColors.sepiaDeep` for text |
| 17 | MarkerDetailScreen | View marker | No title | "Untitled cairn" italic muted | 7 | 6 | I-14: `titleEmpty fontSize: 22` hardcoded, `MemoryColors.cairnPublic` cross-feature palette import |
| 18 | MarkerDetailScreen | Long note overflow | 2000-char body | Scroll | 7 | 6 | I-15: no `numberOfLines`, no fold — 2000 chars fill screen, requires 30+ swipes |
| 19 | MarkerDetailScreen | Long title overflow | 200-char title no spaces | Wrap or ellipsis | 5 | 4 | I-16 CRITICAL: `styles.title` no `numberOfLines`, wraps 4+ rows, pushes body offscreen. Feedback memory: truncate/clipping = bug |
| 20 | MarkerDetailScreen | Edit mode enter | Owner taps Edit | Chips + Title + Note + Perm + Save/Cancel | 6 | 7 | I-17: no transition animation, layout swaps abruptly. 5 type chips wrap awkwardly at 375 |
| 21 | MarkerDetailScreen | Edit title input | maxLength titleMaxChars | Single TextInput | 6 | 6 | I-18: no character counter (unlike Settings password field) |
| 22 | MarkerDetailScreen | Edit note textarea | maxLength textMaxChars multiline | 90 minHeight | 6 | 6 | I-19: `textArea minHeight: 90` no maxHeight — long note pushes Save button below fold. `textAlignVertical:'top'` is Android-only (harmless but noisy) |
| 23 | MarkerDetailScreen | Edit save | Network fail | Alert "Could not save" | 8 | 6 | I-20: offline detection covers Edit/Delete buttons but not the Save button inside edit mode — inconsistent |
| 24 | MarkerDetailScreen | Delete marker | Owner confirms delete | Alert then nav.goBack | 8 | 7 | I-21: after Plant→replace flow, back lands on camera page, not memory map |
| 25 | MarkerDetailScreen | Not owner | Friend's marker | No Edit/Delete row | 10 | 9 | OK — `isOwner` fixed in v416 |
| 26 | MarkerDetailScreen | 375 viewport | iPhone SE | Map 280, panel scrolls | 7 | 6 | I-22: SE has H=667 so `MAP_H = 280` forced. Panel ~380pt with edit form = Save falls below fold |
| 27 | MarkerDetailScreen | 428 viewport | Pro Max | Wider gutters | 8 | 8 | no issue |
| 28 | MarkerDetailScreen | Snapshot divergence | Public snap differs | Banner "Public viewers see..." | 8 | 8 | I-23: uses `«»` guillemets hardcoded — cultural i18n miss |
| 29 | MarkerDetailScreen | Sync badge | pending state | Badge in header row | 7 | 7 | I-24: three-badge header uses `flexWrap` — at 375 the badges wrap to a second line, visually uneven |
| 30 | MarkerDetailSheet | Show sheet | User taps marker mid-hike | slide-up 400px, 280ms cubic | 9 | 9 | no issue |
| 31 | MarkerDetailSheet | Dismiss | Backdrop tap or X | slide-down 220ms | 9 | 9 | OK |
| 32 | MarkerDetailSheet | Two-stage delete | Tap Delete then Confirm | Red filled state | 9 | 8 | I-25: `deleteConfirm` state has no timeout — after accidental first tap, state persists indefinitely |
| 33 | MarkerDetailSheet | No note | Empty note | "(No note)" italic muted | 9 | 9 | OK |
| 34 | MarkerDetailSheet | Approximate GPS | marker.approximate | Yellow caution row | 9 | 9 | OK — severity tokens used correctly |
| 35 | MarkerDetailSheet | Very long note | 500-char note | Sheet expands unbounded | 7 | 6 | I-26: note has no `numberOfLines`, sheet can cover map |
| 36 | MarkerDetailSheet | Distance NaN | No last coordinate | "--" fallback | 10 | 9 | OK |
| 37 | MarkerDetailSheet | 375 viewport | SE | Sheet padding xxl | 8 | 8 | no issue |
| 38 | MarkerDetailSheet | Keyboard | no input | n/a | — | — | n/a |
| 39 | MarkerDetailSheet | Interaction while sheet open | User tries to pan map below | Backdrop tap closes | 8 | 6 | I-27: backdrop absoluteFillObject intercepts ALL taps — cannot pan map without closing sheet |
| 40 | MarkerDetailSheet | Handle indicator | Top 40x4 rounded bar | Visual suggests drag | 9 | 5 | I-28: handle bar has no PanResponder bound — visual promise of swipe-down dismiss not honored (dark pattern) |

---

## 4. Playwright script fragments (per scenario)

Format: directive-style (per A10 spec). Web bypass enabled — target `http://localhost:8080/?screen=<name>`.

### Setup
```
browser_navigate url=http://localhost:8080/?bypass=1
browser_resize width=393 height=852
```

### RouteEditor scenarios

**S1: View existing route**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_wait_for text=Route name
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S01-view.png
browser_console_messages level=error
```

**S3: Save-as-route loading state**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&fromSessionId=EMPTY_SESSION
browser_wait_for time=1
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S03-loading.png
# Expect: enterEditError banner shows loading text (bug — should be spinner)
```

**S4: Long name overflow**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_click ref=[textInput placeholder="Route name (required)"]
browser_type text=Very long trail name AAAAAA... (200 chars)
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S04-longname.png
# Expect: horizontal scroll or wrap — either is a bug
```

**S6: iOS swipe-back during edit (data loss)**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_click ref=[button "Edit"]
browser_wait_for text=Preview
browser_evaluate function=(page)=>{ window.history.back(); }
browser_console_messages level=error
# Expect: no discard alert on web/iOS — silent data loss
```

**S8: Delete without name context**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_click ref=[button "Delete"]
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S08-delete-alert.png
# Expect: Alert "Delete route?" without name
```

**S10: Small viewport permission chips**
```
browser_resize width=320 height=568
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S10-320-perm.png
```

**S11: Keyboard overlay test**
```
browser_navigate url=http://localhost:8080/?screen=RouteEditor&routeId=demo-1
browser_click ref=[textInput "Route name (required)"]
browser_resize width=393 height=430
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S11-keyboard.png
# Expect: permission chips visible above soft keyboard
```

### MarkerDetailScreen scenarios

**S16: View with full content**
```
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-full
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S16-full.png
browser_evaluate function=(page)=>{ 
  const t = document.querySelector('[data-testid="marker-title"]');
  return t ? window.getComputedStyle(t).fontSize : null;
}
# Expect: 24px — drift from h1=28 / h2=20 scale
```

**S18: 2000-char note overflow**
```
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-longnote
browser_take_screenshot fullPage=true filename=docs/ux-audit-2026-07-28/markerdetail/S18-longnote.png
# Expect: entire note fills screen without collapse
```

**S19: 200-char title no-space overflow (CRITICAL)**
```
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-longtitle
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S19-longtitle.png
# Expect: title wraps 4+ rows, pushes body offscreen
```

**S20: Edit mode entry, 5 type chips at 375**
```
browser_resize width=375 height=812
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-full
browser_click ref=[button "Edit"]
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S20-edit-chips.png
# Expect: chips wrap 2 rows unevenly
```

**S23: Save offline (button state)**
```
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-full&offline=1
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S23-offline-view.png
browser_click ref=[button "Edit · Needs internet"]
# Expect: button disabled — but Save inside edit mode has no such treatment
```

**S24: Delete + navigation history**
```
# Simulate Plant → replace → MarkerDetail
browser_click ref=[button "Delete"]
browser_click ref=[button "Delete"]  # confirm
# Expect: nav.goBack lands on camera (wrong) — should be memory map
```

**S26: 375 viewport edit — Save button fold test**
```
browser_resize width=375 height=667
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-full
browser_click ref=[button "Edit"]
browser_take_screenshot fullPage=true filename=docs/ux-audit-2026-07-28/markerdetail/S26-se-edit.png
# Expect: Save button below fold
```

**S28: Snapshot divergence banner**
```
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-divergent
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S28-snap.png
# Expect: banner with «...» guillemets
```

**S29: 3-badge header row wrap**
```
browser_resize width=375 height=812
browser_navigate url=http://localhost:8080/?screen=MarkerDetail&markerId=demo-pending
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S29-3badge.png
# Expect: badges wrap to second line
```

### MarkerDetailSheet scenarios

**S30: Sheet slide-in**
```
browser_navigate url=http://localhost:8080/?screen=Hiking&openMarkerSheet=demo-1
browser_wait_for time=0.3
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S30-sheet-open.png
```

**S31: Backdrop dismiss**
```
browser_click ref=[div at coord 200,100]
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S31-dismiss.png
```

**S32: Two-stage delete**
```
browser_click ref=[button "Delete Flag"]
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S32-confirm.png
browser_wait_for time=4
# Expect: still red — should auto-reset after 3s
```

**S35: Very long note**
```
browser_navigate url=http://localhost:8080/?screen=Hiking&openMarkerSheet=demo-longnote
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S35-longsheet.png
# Expect: sheet grows past map
```

**S40: Handle bar (no gesture)**
```
browser_navigate url=http://localhost:8080/?screen=Hiking&openMarkerSheet=demo-1
browser_drag startRef=[div.handle] endRef=[300,700]
browser_take_screenshot filename=docs/ux-audit-2026-07-28/markerdetail/S40-handle-drag.png
# Expect: sheet does NOT move — dark pattern
```

---

## 5. Code-level issues (grouped)

### 5.1 Design-system drift (MarkerDetailScreen)
Hardcoded values that should use tokens:
- **Line 507**: `visBadgeText fontSize: 11` → `FontSize.small`
- **Line 513-517**: `title fontSize: 24, fontWeight: '600', color: MemoryColors.sepiaDeep` → out of h1(28)/h2(20) scale; use `Colors.textPrimary`
- **Line 519-521**: `titleEmpty fontSize: 22, fontWeight: '500', color: MemoryColors.cairnPublic` → drift + wrong palette (cross-feature import)
- **Line 526-527**: `body fontSize: 14, color: MemoryColors.sepiaDeep, lineHeight: 20` → `FontSize.body (15)`, `Colors.textPrimary`, lineHeight 22
- **Line 559-563**: `snapshotHeader fontSize: 11, letterSpacing: 0.4` — letterSpacing not tokenised
- **Line 566**: `snapshotBody fontSize: 12` → `FontSize.caption (13)`
- **Line 571**: `snapshotFootnote fontSize: 10` → `FontSize.tiny (9)` or `small (11)`
- **Line 586**: `actionBtn paddingVertical: 12` → `Spacing.md`
- **Line 590**: `actionBtnPrimary backgroundColor: MemoryColors.sepia` → `Colors.primary`
- **Line 592**: `actionBtnPrimaryText fontSize: 14` → `FontSize.body`
- **Line 598**: `actionBtnGhostText color: MemoryColors.sepiaDeep` → `Colors.textPrimary`
- **Line 601-607**: `fieldLabel fontSize: 11` — raw
- **Line 612-613**: `input fontSize: 14, color: MemoryColors.sepiaDeep` — drift
- **Line 623-631**: `typeChip paddingHorizontal: 10, paddingVertical: 7, borderRadius: 18` — raw pixel values
- **Line 632**: `typeChipLabel fontSize: 12` — raw
- **Line 638**: `backgroundColor: 'rgba(0,0,0,0.03)'` — should be `Colors.surfaceMuted` or similar
- **Line 644-645**: `lockedFieldText fontSize: 11` — raw
- **Line 651**: `notFoundTitle fontSize: 18, fontWeight: '500'` — near `FontSize.h3 (17)` but drift
- **Line 654**: `notFoundSub fontSize: 13` — matches caption but not tokenised

**Total**: ~20 hardcoded font-size/color/spacing values in MarkerDetailScreen alone.

### 5.2 Truncation / overflow bugs (P0 per feedback memory rule)
- **RouteEditor L897-900**: `viewSummaryName` TextInput lacks `maxLength` and single-line clamp — long names silently horizontal-scroll and clip.
- **RouteEditor L889**: `errorBannerText numberOfLines={2}` — truncates long backend errors.
- **MarkerDetailScreen L371, L512-517**: `title` no `numberOfLines` and no auto-shrink — long title breaks layout.
- **MarkerDetailScreen L376, L525-530**: `body` no `numberOfLines` and no fold — 2000-char note fills screen.
- **MarkerDetailScreen L336-340**: `textArea minHeight: 90` no `maxHeight` — grows unbounded.
- **MarkerDetailScreen L394**: snapshot body renders `«${sn.title || sn.body || 'Untitled'}»` with no truncation.
- **MarkerDetailSheet L99**: `note` no `numberOfLines` — 500+ char note grows sheet unbounded.

### 5.3 Interaction / affordance bugs
- **MarkerDetailSheet L145-148**: Handle bar has visual affordance (40x4 rounded) but no PanResponder / gesture. Dark pattern.
- **MarkerDetailSheet L86**: `TouchableOpacity absoluteFillObject` backdrop intercepts ALL taps — user cannot pan map behind sheet without closing.
- **MarkerDetailSheet L77-81**: `deleteConfirm` state has no timeout — accidental confirm state persists indefinitely.
- **RouteEditor L288-316**: `BackHandler` for Android only — iOS swipe-back lacks discard prompt. Should set `gestureEnabled=false` when editing.
- **RouteEditor L963-964**: `viewSaveBtnDisabled` uses `opacity: 0.4` but keeps `activeOpacity: 0.85` — user sees press feedback then nothing happens.

### 5.4 Loading / error state gaps
- **RouteEditor L413**: `enterEditError='Loading route data — please try again in a moment.'` — loading state disguised as error signal.
- **RouteEditor L522-644**: `saving` state has no timeout — 30s hang leaves user with app-kill only.
- **MarkerDetailScreen L423-425**: Edit/Delete buttons show "Needs internet"; Save inside edit mode does not — inconsistent offline treatment.
- **MarkerDetailScreen L177-191**: `notFound` fallback lacks retry — user can only back out.

### 5.5 Nav / flow bugs
- **MarkerDetailScreen L170**: `nav.goBack()` after delete — if entered via `nav.replace` from Plant flow, back lands on camera page.
- **MarkerDetailScreen L83**: `MAP_H = Math.max(280, H - 480)` — SE (H=667) forces 280 map, leaves ~380pt panel; edit form with 5+ chips + 2 inputs + Save falls below fold.
- **RouteEditor L625-637**: save-as-route uses `CommonActions.reset` (good) but existing route edit uses `nav.goBack()` — inconsistent post-save behavior.

### 5.6 Accessibility
- No `accessibilityLabel` on BackButton wrappers (relies on component default).
- Chip toggles rely on color contrast only — no `accessibilityState={{selected}}` announced.
- MarkerDetailSheet handle bar has no `accessibilityRole="button"` and no dismiss label.
- Delete buttons across all three: no `accessibilityHint="Deletes this cairn permanently"`.

### 5.7 i18n readiness
- MarkerDetailScreen L394 uses French guillemets `«»` hardcoded — not culturally universal.
- All labels ("Just me", "Friends", "Untitled cairn", "Delete this cairn?", "Discard edits?") are plain English string literals — no `i18n.t()` wrapper.
- Permission chip `flexWrap` not applied — Chinese/German labels overflow at 375.

---

## 6. Priority summary

### Blocker (fix before O2 OTA)
- **I-04**: Long name silently clips in RouteEditor name input. `maxLength={80}` + `numberOfLines={1}` on TextInput.
- **I-16 CRITICAL**: MarkerDetailScreen title has no bounds — 200-char breaks layout entirely.
- **I-15**: MarkerDetailScreen body has no bounds — 2000-char fills screen.
- **I-26**: MarkerDetailSheet note has no bounds — sheet grows past screen.
- **I-28**: MarkerDetailSheet handle bar promises drag-to-dismiss but doesn't work — add `PanResponder` or remove handle.

### Critical (this sprint)
- **I-03**: Loading state disguised as error in RouteEditor auto-enter edit.
- **I-13, I-14**: MarkerDetailScreen font-size/color drift (20+ instances) — inconsistency with Settings/Route.
- **I-06**: iOS swipe-back on RouteEditor loses edits silently.
- **I-27**: MarkerDetailSheet backdrop intercepts map pan.
- **I-25**: Two-stage delete never resets — dangerous.
- **I-22**: SE viewport edit form Save button falls below fold.
- **I-21**: Delete → goBack lands on wrong screen from Plant flow.

### Medium
- I-01, I-02, I-05, I-07, I-08, I-11, I-12, I-17, I-18, I-19, I-20, I-23, I-24, I-29, I-30

### Low / Polish
- I-09, I-10 (i18n readiness), accessibility labels, `«»` guillemets, `textAlignVertical` Android-only.

### Consistency scoring (10 = perfect match to Settings baseline)
- **RouteEditorScreen**: 8/10 (uses tokens correctly, minor hardcoded pixel values in stat row)
- **MarkerDetailScreen**: 5/10 (extensive `MemoryColors` + hardcoded fonts, worst-diverged of the three)
- **MarkerDetailSheet**: 8/10 (clean token use, but handle-bar dark pattern drags UX score down)

---

## 7. Recommendations (bugs to file — not to fix here)

1. BUG-A12-01 (Blocker): Add bounds to marker title / body / route name / sheet note. Track under one "text overflow hardening" story.
2. BUG-A12-02 (Blocker): Fix MarkerDetailSheet handle bar — bind `PanResponder` for swipe-down dismiss or remove visual.
3. BUG-A12-03 (Critical): Normalize MarkerDetailScreen to global `Colors` / `FontSize` tokens; retire `MemoryColors` from this screen (keep in memory feature scope only).
4. BUG-A12-04 (Critical): RouteEditor edit mode should set `screenOptions.gestureEnabled=false` to block iOS swipe-back silent discard.
5. BUG-A12-05 (Critical): MarkerDetailSheet delete-confirm state needs 3s auto-reset.
6. BUG-A12-06 (Critical): MarkerDetailScreen delete post-nav — always route back to memory map, not `nav.goBack()`.
7. BUG-A12-07 (Medium): Add name character length min-max validation + counter on both edit surfaces.
8. BUG-A12-08 (Medium): Add save/edit timeout (30s) with cancellable spinner.
9. BUG-A12-09 (Medium): Route Delete alert should include route name in message.
10. BUG-A12-10 (Low): i18n prep — extract all string literals; replace `«»` with locale-aware quotes.

---

**End of audit.**
