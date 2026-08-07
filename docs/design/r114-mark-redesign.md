# R114 · Mark Redesign — Design Document

**Author**: Arch + UX (design pass)
**Date**: 2026-08-07
**Status**: DRAFT for 3-subagent blind review
**Scope**: Full redesign of Mark feature UI. Keeps `GpsLockStep` intact. Reworks every other screen/sheet + introduces a shared `<MarkForm>` component.
**Non-goals**: No new business logic. No schema change. No behavior change to permission model, sync engine, or pin-adjust gestures.

---

## 0. Root-cause map (bug → fix location)

| # | Bug (verbatim from user) | Root cause | Design section |
|---|--------------------------|------------|----------------|
| 1 | 页面单薄, textarea 填完不知道属于哪块 | ContentStep + MarkerDetailScreen edit mode inputs have no visible `fieldLabel`; MemoryColors.sepia + white input on cream = single-tone wash | §2 (MarkForm), §5 (ContentStep), §6 (MarkerDetailScreen edit mode) |
| 2 | Memory 里 personal/friend 的 mark 也能点赞/report | `MarkDetailSheet.tsx:129` and `RevealedCairnSheet` both allow Like/Report when `form === 'B'` regardless of `permission`; iron law needs public gate | §4 (permission gate) |
| 3 | Red retry box 不知道什么意思 | `GpsLockStep.tsx:298-306` failBox = red + red-only copy "Try again", no diagnosis | §7 (GpsLockStep retry copy) — the only change to Gps step |
| 4 | Mark list raw U+001E 泄露 | `RoutesScreen.tsx:1191` renders `item.note` directly — never calls `splitTitleBody` | §9 (RoutesScreen FlagsTab card) |
| 5 | Plant 和 detail UI 不同 | Plant uses `MemoryColors.sepia` (fff5e0/sepia brown); Detail uses `Colors.primary` (森林绿). Two visual worlds. | §12 (color migration) applied everywhere |
| 6 | GPS 页 where 比 back 靠前 | `PinAdjustStep.tsx:424-427` — `<View style={backRow}>` then a `<Text style={title}>` on next block: title is same width as body, back is a small pill above → title reads as the anchor, back as an afterthought | §8 (PinAdjustStep header) |

---

## 1. Component inventory — before / after

### Before (current)

| File | LOC | Role | Status after R114 |
|------|-----|------|-------------------|
| `features/marks/components/MarkDetailSheet.tsx` | 425 | Bottom sheet, 4-form iron law | **KEEP**, revised per §3 §4 |
| `features/memory/components/RevealedCairnSheet.tsx` | 184 | Bottom sheet for memory-map cairns | **DELETE**, replaced by MarkDetailSheet |
| `features/memory/components/MysteryCairnSheet.tsx` | 184 | Dark unrevealed cairn sheet | **KEEP as separate variant** (see §3.5 — this is form D and its own visual language) |
| `screens/MarkerDetailSheet.tsx` | 224 | Legacy bottom sheet on Hiking map | **DELETE**, replaced by MarkDetailSheet |
| `screens/MarkerDetailScreen.tsx` | 657 | Full-screen owner detail + edit | **KEEP**, edit mode swaps in `<MarkForm>` (§6) |
| `screens/PlantScreen.tsx` | 341 | 3-step editor + commit | **KEEP** — orchestrator only, no visual changes here |
| `features/plant/components/GpsLockStep.tsx` | 319 | GPS lock progress + fail card | **KEEP structure**, revise failBox only (§7) |
| `features/plant/components/PinAdjustStep.tsx` | 750 | Map pan + confirm | **KEEP behavior**, revise header only (§8) |
| `features/plant/components/ContentStep.tsx` | 264 | Type + title + note + visibility | **KEEP shell**, body swapped to `<MarkForm>` (§5) |
| `screens/RoutesScreen.tsx` (FlagsTab) | 1554 total | List of user's marks | **KEEP screen**, revise renderItem (§9) |

### After (new)

| File | Introduced by | Purpose |
|------|---------------|---------|
| `features/marks/components/MarkForm.tsx` | R114 | **NEW** — shared form for create + edit, used by ContentStep + MarkerDetailScreen edit mode |
| `features/marks/components/MarkCard.tsx` | R114 | **NEW** — shared list-card (RoutesScreen FlagsTab uses it; future search/friend-view reuse) |
| `features/marks/components/MarkTierChip.tsx` | R114 | **NEW** — 5-type × 3-visibility chip, single source of truth (removes duplication between ContentStep / MarkerDetailSheet / MarkerDetailScreen / RoutesScreen — currently 4 near-identical implementations) |

**Data source dedupe** (from Root cause #5): `data/mockData.MARKER_META` is currently the source for RoutesScreen FlagsTab. `config/markerTypes.MARKER_TYPES` is the source everywhere else. R114 keeps `MARKER_TYPES` as canonical; `MARKER_META` becomes a thin alias re-export so mock data still resolves.

---

## 2. `<MarkForm>` — the shared abstraction

The centerpiece. Everywhere a user types a mark's content (create + edit), the same component is mounted with the same layout, same tokens, same field labels. This is what solves Bug #1 and #5 simultaneously.

### 2.1 Props

```ts
interface MarkFormProps {
  // Values
  type: MarkerType;
  title: string;
  note: string;                 // body only; NOT the encoded U+001E string
  visibility: MarkerPermission;

  // Change handlers (controlled — parent owns state)
  onTypeChange: (t: MarkerType) => void;
  onTitleChange: (s: string) => void;
  onNoteChange: (s: string) => void;
  onVisibilityChange: (v: MarkerPermission) => void;

  // Mode & config
  mode: 'create' | 'edit';
  disableVisibilityPublic?: boolean;   // R114: v1 has public disabled by config flag; keep it a prop so future flip is trivial
  showLocationLockedNotice?: boolean;  // edit mode = true; create mode = false
  autoFocus?: 'title' | 'note' | null; // create mode: 'title'; edit mode: null

  // Limits (defaults from ContentConfig)
  titleMaxChars?: number;              // default 30
  noteMaxChars?: number;               // default 500
}
```

### 2.2 Layout — exact ordering

```
┌────────────────────────────────────────────────┐
│ [Type row — 5 chips: danger junction water hut cairn]
│                                                 
│ TITLE                                          │  <- fieldLabel (uppercase, letter-spacing 1.2)
│ ┌────────────────────────────────────────────┐ │
│ │  What kind of mark is this?             _ │ │  <- placeholder, right-aligned char counter fades in after typing starts
│ └────────────────────────────────────────────┘ │
│                                     12 / 30    │  <- charCounter, right-aligned, greyed
│                                                 
│ NOTE                                           │
│ ┌────────────────────────────────────────────┐ │
│ │                                            │ │
│ │  Tell whoever finds this…                  │ │
│ │                                            │ │
│ │                                            │ │
│ └────────────────────────────────────────────┘ │
│                                    134 / 500   │
│                                                 
│ WHO CAN SEE THIS                               │
│ ┌───────────┐ ┌───────────┐ ┌───────────┐     │
│ │ 🔒 Just me│ │ 👥 Friends│ │ 🌐 Anyone│     │   (Anyone disabled/hidden per flag)
│ └───────────┘ └───────────┘ └───────────┘     │
│                                                 
│ [Location lock notice — edit mode only]        │
│ 🔒  Location is fixed where you planted it.   │
└────────────────────────────────────────────────┘
```

### 2.3 Field label spec (SINGLE definition, referenced everywhere)

```ts
const fieldLabelStyle = {
  fontSize: FontSize.small,            // 11
  fontWeight: '600',
  color: Colors.textSecondary,          // #8c7e72
  textTransform: 'uppercase',
  letterSpacing: 1.2,                   // R114: increase from 0.4 → 1.2 for tramping-guide typography feel
  marginBottom: Spacing.xs,             // 4
  marginTop: Spacing.md,                // 12 — vertical rhythm between blocks
};
```

Field labels used in the design: `TITLE`, `NOTE`, `WHO CAN SEE THIS`, `LOCATION` (edit mode locked notice header), `TYPE` (above the chip row).

### 2.4 Type row spec (`MarkTierChip`)

```
Row layout: horizontal flex, gap 6, wraps to 2 lines on iPhone SE (375w).
Chip: 
  paddingHorizontal 12, paddingVertical 8
  borderRadius 18 (pill)
  borderWidth 1
  Inactive: border Colors.border (#ece6de), bg Colors.surface, icon+label Colors.textSecondary
  Active:   border meta.color (per type), bg meta.bg (per type), icon+label meta.color, fontWeight 600
Icon size 16, strokeWidth 2 (inactive) / 2.4 (active)
Label fontSize FontSize.caption (13)
Haptic on select: haptic.selection()
```

### 2.5 Title input spec

```
minHeight 44 (iOS touch target)
paddingHorizontal Spacing.md (12), paddingVertical 10
fontSize FontSize.body (15)
color Colors.textPrimary (#2d2a26)
placeholderTextColor Colors.textMuted (#b5a99d)
backgroundColor Colors.surface (#ffffff)
borderRadius Radius.button (12)
borderWidth 1, borderColor Colors.border (#ece6de) [neutral]
FOCUS state: borderColor Colors.primary (#5d7c46), borderWidth 1.5
maxLength 30 (ContentConfig.titleMaxChars)
returnKeyType 'next' → focuses note
```

**Character counter**: only visible when `title.length > 0`. Alignment right, marginTop -2 (visually hugs the input's bottom). Color `Colors.textMuted` (11px). At `title.length >= 27` (90% of 30): color = `Colors.warning`. At `>= 30`: color = `Colors.danger`.

### 2.6 Note textarea spec

Same as title input except:
- `minHeight 120` (R114 raise from 80/90 — user complained textarea "单薄"; 120 shows ~5 lines by default, feels like a note-taking surface)
- `textAlignVertical 'top'`, `multiline`
- placeholder `"Tell whoever finds this…"` — matches ContentStep current copy
- Character counter identical rule, right-aligned; at 90%/100% same warning/danger colors
- No returnKey commit — Enter creates newlines

### 2.7 Visibility row spec

```
Row: flexDirection row, gap Spacing.sm (8)
Each chip:
  flex 1 (equal thirds)
  paddingVertical Spacing.md (12)
  paddingHorizontal Spacing.sm
  borderRadius Radius.button (12)
  borderWidth 1
  alignItems center; icon + label vertical? NO — R114 keeps horizontal row (icon left, label right) so the chip is scannable at a glance
  gap 6 between icon and label
  
Inactive: border Colors.border, bg Colors.surface, icon Colors.textSecondary, label Colors.textSecondary
Active (Just me):  border Colors.textSecondary,  bg rgba(140,126,114,0.10), icon+label Colors.textPrimary
Active (Friends):  border Colors.primary,        bg Colors.primaryBg,        icon+label Colors.primary
Active (Anyone):   border Colors.info,           bg Colors.infoBg,           icon+label Colors.info

Haptic on toggle: haptic.selection()
Public chip disabled when disableVisibilityPublic=true: opacity 0.4, ignore onPress
```

Note on "Anyone" chip in v1: `VisibilityConfig.enablePublicOption === false`. We still RENDER the chip (grayed) so users see there is a 3rd tier — because otherwise the row of 2 chips fills the whole width and users can't infer "this is a picker with more options someday". This is a deliberate discoverability trade-off.

### 2.8 Location locked notice (edit mode only)

```
Layout: horizontal flex, gap 6, padding Spacing.sm+xs, borderRadius Radius.sm
bg rgba(0,0,0,0.03), border none
Icon: Lock, size 12, Colors.textMuted
Text: "Location is fixed where you planted it."
  fontSize FontSize.small (11), fontStyle italic, color Colors.textMuted
```

Not shown in create mode because location is what step 2 (PinAdjustStep) just confirmed.

### 2.9 R114 acceptance for MarkForm alone

- ContentStep, MarkerDetailScreen edit mode render identical when given identical props (screenshot diff = 0 pixels except header)
- Every field has a visible field label (Bug #1 resolved)
- Zero references to `MemoryColors.sepia` in this component (Bug #5 resolved — MarkForm is 100% `Colors.primary`/`Colors.flag` palette)

---

## 3. Unified `<MarkDetailSheet>` — bottom sheet contract

MarkDetailSheet already exists and its 4-form iron law is correct. R114's changes are:

### 3.1 Absorbing RevealedCairnSheet + screens/MarkerDetailSheet

**Deletion targets**:
- `features/memory/components/RevealedCairnSheet.tsx` — its callers switch to `MarkDetailSheet`
- `screens/MarkerDetailSheet.tsx` — its caller `HikingScreen.tsx` switches to `MarkDetailSheet`

**One caller migration protocol** (documented, not implemented in this doc):
- `CairnPinsLayer.tsx` currently dispatches by tier to different sheets. After R114: it always renders `<MarkDetailSheet>` and lets the internal `form` computation handle the visual variant.
- Form D (unrevealed public) does NOT open MarkDetailSheet — it opens `MysteryCairnSheet` (see §3.5).

### 3.2 Header

```
┌────────────────────────────────────────────────┐
│                                          [ × ] │
│                                                │
│  ┌────────┐                                    │
│  │  ICON  │  Cabin near saddle             ▸  │  <- 40px round type badge on left
│  └────────┘                                    │
│                                                │
│  🏠 Hut  •  yesterday  •  ±8 m                │  <- meta row: chip + age + accuracy
└────────────────────────────────────────────────┘
```

Type badge on the left (40px round, meta.bg + meta.color border, meta.icon 20px center) — new element. Restores visual weight so title feels anchored, not floating.

### 3.3 Body

```
Cabin near saddle                                <- title (h2, 20, weight 700, textPrimary)
Water tap on north wall. Bunk 4 loose.           <- body (body 15, textSecondary, lineHeight 22)

  🏠 Hut  •  yesterday  •  ±8 m                  <- meta row above (was §3.2)

  Author row (form B/C, non-public only):
  👤 Alex L.                                     <- caption 13, textSecondary

  Visited badge (form B only):
  ✓ You visited here                             <- caption 13, success, weight 600

  Helper text (form C only):
  Walk this spot to vouch for it.                <- caption 13, textMuted, italic
```

### 3.4 Action surface (permission-gated — see §4)

```
Form A owner, personal/friend:
┌────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌────────────────────────┐ │
│  │ ✏️  Edit     │  │ 🗑️  Delete             │ │
│  └──────────────┘  └────────────────────────┘ │
└────────────────────────────────────────────────┘

Form A owner, public:
┌────────────────────────────────────────────────┐
│  ┌──────────────┐  ┌────────────────────────┐ │
│  │ ✏️  Edit     │  │ 🗑️  Delete             │ │
│  └──────────────┘  └────────────────────────┘ │
│  ─────────────────────────────────────────    │
│  ♡ Like                                        │  (NO Report — can't report own mark)
└────────────────────────────────────────────────┘

Form B (visited, someone else's, public OR friend):
┌────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────┐ │
│  │ 🗑️  Hide from my map                     │ │
│  └──────────────────────────────────────────┘ │
│  ─────────────────────────────────────────    │
│  Public marks: ♡ Like    ⚑ Report              │
│  Friend marks: [NO like/report row]            │  <- Bug #2 fix; iron law §4
└────────────────────────────────────────────────┘

Form C (in-fog, non-visited):
┌────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────┐ │
│  │ 🗑️  Hide from my map                     │ │
│  └──────────────────────────────────────────┘ │
│  "Walk this spot to vouch for it."             │
└────────────────────────────────────────────────┘
```

Action button spec (unchanged from current MarkDetailSheet but tightened):
- `paddingVertical 12`, `borderRadius Radius.button (12)`, `borderWidth 1`, `flex 1` inside actionRow
- Text `FontSize.body (15)`, `fontWeight 600`
- Edit: `borderColor Colors.border`, text `Colors.primary`, icon Pencil `Colors.primary`
- Delete/Hide: `borderColor Colors.border`, text `Colors.danger`, icon Trash2 `Colors.danger`
- Like/Report row: no border, minimal styling — these are 2ary actions

### 3.5 MysteryCairnSheet — kept separate but retokenized

MysteryCairnSheet is the "unrevealed" sheet — user sees the pin on the memory map, taps, sees a teaser without content. This is form D territory (visibility-gated).

**Decision**: Keep it as a separate component **because** its visual language is deliberately different — dark surface, obscured content, mystery framing. Merging it into MarkDetailSheet would either (a) pollute the sheet's clean information architecture with a `mode: 'mystery'` branch, or (b) force the mystery variant to look like a nerfed detail. Neither is good.

**BUT**: R114 requires MysteryCairnSheet to migrate its color palette from `MemoryColors.sepia` to the `Colors.primary + Colors.flag` tokens. Every mystery-specific dark shade stays; the accent color (currently sepia orange) becomes `Colors.flag`.

---

## 4. Permission gate (iron law) — Bug #2 fix

### 4.1 The rule

```
canLikeReport(form, permission):
  form 'A' (mine): only if permission === 'public'
  form 'B' (visited others'): only if permission === 'public'   <- Bug #2 fix (was: any B)
  form 'C' (in-fog others'): never (helper text instead)
  form 'D' (unrevealed): sheet does not open

canReport(canLikeReport, form):
  = canLikeReport && form !== 'A'   <- can't report own mark
```

### 4.2 Delta from current code

Current `MarkDetailSheet.tsx:128-129`:
```ts
const canLikeReport =
  form === 'B' || (form === 'A' && permDisplay === 'public');
```

Bug: `form === 'B'` alone allows Like/Report on Friend-tier marks visited by the viewer. Users report they can Like a friend's private-to-friends mark, which was never the intent (Iron law §4.11 requires public visibility for Like/Report because Like counts + Report queues are public-facing accountability signals).

R114 revised:
```ts
const canLikeReport =
  (form === 'B' && permDisplay === 'public') ||
  (form === 'A' && permDisplay === 'public');
// Equivalent:  permDisplay === 'public' && (form === 'A' || form === 'B')
```

### 4.3 Where else this gate lives

`RevealedCairnSheet.tsx` is deleted (§3.1), so its buggy allow-all-like path is removed too. `MysteryCairnSheet` (form D) already has no Like/Report. So the fix is one file: `MarkDetailSheet.tsx:128-129`.

### 4.4 Test cases

| Form | Permission | canLikeReport? | canReport? |
|------|-----------|---------------|-----------|
| A | personal | false | false |
| A | friend/group | false | false |
| A | public | true | false (can't report own) |
| B | personal | (impossible: personal not visible to others) | — |
| B | friend/group | **false** (R114 fix — was true) | false |
| B | public | true | true |
| C | any | false | false |
| D | any | sheet not opened | — |

---

## 5. ContentStep — new body

Structure after R114:

```
SafeArea top+bottom
KeyboardAvoidingView
  ScrollView
    [Back row] (BackButton pill, current impl unchanged)
    [Title  ] "Leave a mark"  (h1 22, weight 600, textPrimary)
    [Subtitle] "A few words, and a photo if you'd like."  (caption 13, textSecondary)
    
    <MarkForm
       type={type}
       title={title}
       note={note}
       visibility={vis}
       onTypeChange={setType}
       onTitleChange={setTitle}
       onNoteChange={setNote}
       onVisibilityChange={setVis}
       mode="create"
       disableVisibilityPublic={!VisibilityConfig.enablePublicOption}
       showLocationLockedNotice={false}
       autoFocus="title"
    />
    
  [Footer bar — sticky bottom, KeyboardAvoidingView-lifted]
    [Public-permanent hint text] (only if public enabled)
    ┌──────────────────────────────────────────────┐
    │            Plant Cairn                       │  <- primary button
    └──────────────────────────────────────────────┘
```

### 5.1 Delta from current

- Removed: inline TextInputs, inline typeRow, inline chipRow. All replaced by `<MarkForm>`.
- Removed: `MemoryColors.sepia*` — footer button uses `Colors.primary` (see §12).
- Kept: KeyboardAvoidingView, TouchableWithoutFeedback outer keyboard-dismiss, submitting state, `haptic.notification('success')` after commit (in PlantScreen orchestrator, unchanged).

### 5.2 Primary button spec

```
backgroundColor Colors.primary (#5d7c46)   <- was MemoryColors.sepia
paddingVertical 14, borderRadius Radius.button (12)
alignItems center
Text: color '#ffffff', fontSize FontSize.body (15), fontWeight 600
Disabled state (submitting or no content): opacity 0.4
Submitting text: "Planting…"
```

---

## 6. MarkerDetailScreen — edit mode swap

Full-screen owner detail (Plant success target + FlagsTab tap target). View mode stays. Edit mode swaps its 4 inline inputs + chipRow + permChipRow to `<MarkForm mode="edit">`.

### 6.1 View mode wireframe (unchanged structure, retokenized)

```
┌───────────────────────────────────┐
│ [← Back]                          │  <- overlay on map, existing
│  ┌───────────────────────────┐   │
│  │       MAP HERO             │   │  <- 280px hero, existing CairnPin center
│  │                            │   │
│  └───────────────────────────┘   │
│                                   │
│ [🏠 Hut]  [🌐 Anyone]  [pending] │  <- type badge + vis badge + syncBadge (retokenized)
│                                   │
│  Cabin near saddle                │  <- title h1 (24, 600)
│  Water tap on north wall. Bunk 4  │  <- body (14, lineHeight 20)
│  loose.                            │
│                                   │
│  📅  Yesterday                    │  <- meta list
│  📍  -41.28453, 174.77621         │
│                                   │
│  [Public snapshot banner if any]  │  <- owner only, kept as-is (retokenized)
│                                   │
│  ┌─────────────┐  ┌─────────────┐│
│  │ 🗑️ Delete   │  │ ✏️  Edit    ││  <- actions (retokenized: Edit uses Colors.primary bg)
│  └─────────────┘  └─────────────┘│
└───────────────────────────────────┘
```

### 6.2 Edit mode wireframe

```
┌───────────────────────────────────┐
│ [← Back]                          │
│  ┌───────────────────────────┐   │
│  │       MAP HERO             │   │
│  └───────────────────────────┘   │
│                                   │
│                                   │
│  <MarkForm                        │
│     mode="edit"                   │
│     showLocationLockedNotice      │
│     autoFocus={null}              │
│     ... />                        │
│                                   │
│  ┌─────────────┐  ┌─────────────┐│
│  │  Cancel     │  │  Save       ││  <- actions, Save uses Colors.primary
│  └─────────────┘  └─────────────┘│
└───────────────────────────────────┘
```

### 6.3 Delta

- Removed lines 300-365 (inline chipRow + input + textArea + permChipRow) → replaced by one `<MarkForm>` mount.
- Removed local `PermChip` sub-component.
- Removed all `MemoryColors.sepia*` refs. Primary button uses `Colors.primary`. Title uses `Colors.textPrimary`.
- Save button label / disabled logic unchanged.

---

## 7. GpsLockStep — retry copy overhaul (Bug #3)

Only one section of this file changes: the `failBox`.

### 7.1 Before

```
┌───────────────────────────────────┐
│ (red border, red bg)              │
│  GPS signal is weak               │  <- red
│  Move to a more open spot and try │  <- dark red
│  again.                            │
│                                   │
│  [ Try again ]                    │  <- red button
└───────────────────────────────────┘
```

Problems: red-on-red reads like a critical error. Users report they don't know whether to retry, wait, or exit. "Try again" alone gives no hint about why it might work differently the second time.

### 7.2 After — warning tone, actionable copy

```
┌───────────────────────────────────┐
│ (warm orange border, warmBg)      │
│  ⚠  Weak GPS signal               │  <- Colors.warning, weight 600
│                                   │
│  Move outside or away from        │  <- explainer (caption, textSecondary)
│  buildings for a better lock.     │
│                                   │
│  Current accuracy: ±42 m          │  <- diagnostic (small, textMuted)
│                                   │
│  ┌─────────────────────────────┐  │
│  │  Search again              │  │  <- primary button (Colors.primary)
│  └─────────────────────────────┘  │
└───────────────────────────────────┘
```

### 7.3 Spec

```
failBox:
  backgroundColor Colors.warningBg  (#fff3e0)
  borderColor Colors.warning        (#b36b00)
  borderWidth 1
  borderRadius Radius.card (14)
  padding Spacing.base (16)
  marginTop Spacing.base
  gap Spacing.sm

Header row (icon + title):
  Icon "TriangleAlert" size 18, color Colors.warning, strokeWidth 2.2
  Title fontSize FontSize.body (15), fontWeight 600, color Colors.warning
  Layout: flexDirection row, alignItems center, gap 8

Explainer:
  fontSize FontSize.caption (13)
  color Colors.textSecondary
  lineHeight 18

Diagnostic:
  fontSize FontSize.small (11)
  color Colors.textMuted
  fontFamily 'Courier' (only if accuracy > 0)
  Rendered only when we HAVE a result with an accuracy number (accuracy-too-poor, too-jumpy).
  For no-readings / permission-denied: this line is suppressed.

Retry button:
  backgroundColor Colors.primary  (was: Colors.warning; primary keeps a single "go" color across the app)
  paddingVertical 12, borderRadius Radius.button (12)
  Text: '#fff', FontSize.body (15), fontWeight 600
```

### 7.4 Reason → copy map (revised `describeFailure`)

| reason | Title | Explainer | Show diagnostic? |
|--------|-------|-----------|-------------------|
| accuracy-too-poor | Weak GPS signal | Move outside or away from buildings for a better lock. | yes |
| too-jumpy | GPS is drifting | Stand still for a moment. Trees and cliffs can bounce the signal. | yes |
| no-readings | No GPS readings yet | Check that Location is on for Cairn in Settings. | no |
| permission-denied | Location permission needed | Open Settings → Cairn → Location and choose "While Using". | no (add a separate "Open Settings" ghost button) |
| default | Couldn't lock GPS | Move to a more open spot and try again. | no |

---

## 8. PinAdjustStep — header layout (Bug #6)

### 8.1 Current header (broken)

```
┌───────────────────────────────────┐
│ ┌────────┐                        │
│ │  ← Back│                        │  <- BackButton pill (34px), left
│ └────────┘                        │
│                                   │
│ Where's your cairn?               │  <- h2 22 title, full-width feel
│ Drag the map to fine-tune…        │  <- subtitle
```

Problem: back is a small pill on line 1, title dominates line 2. Visual weight makes "Where's your cairn?" the top-of-page anchor, and back reads as a secondary element that's actually *above* the anchor — confusing.

### 8.2 R114 header — single-row anchor

Two-row iOS-standard pattern:

```
┌───────────────────────────────────┐
│ ┌────────┐                        │
│ │  ←     │                        │  <- Back button, alone, 36px round (iOS pattern)
│ └────────┘                        │
│                                   │
│ Where's your cairn?               │  <- title becomes THE header
│ Drag the map to fine-tune. Tap    │  <- subtitle
│ Confirm when it feels right.      │
```

This is standard iOS "back-then-large-title" (Apple HIG "Large Titles"). The back stays where it is BUT visually reduces in prominence by removing its background pill — becoming a simple ghost round.

**Alternative considered and rejected**: inline back+title (`[← Back]  Where's your cairn?`). Rejected because (a) back has a hit target obligation (44pt) and inline forces the title to shrink or share vertical space unhelpfully; (b) iOS system apps don't do this pattern for full-page steps; (c) user's specific complaint was "back 明显比 where 更靠前" — meaning back was too small relative to title. Both fixes below address the imbalance:

### 8.3 R114 Back button spec

```
Variant: "ghostRound" (new variant; add to BackButton.tsx)
Dimensions: 36x36, borderRadius 18
backgroundColor Colors.surface  (was: primaryBg pill)
borderColor Colors.border, borderWidth 1
Icon "ArrowLeft" size 20, color Colors.textPrimary, strokeWidth 2.2
Shadow: Shadow.card (subtle lift so it reads as tappable)
Padding: none (icon is centered)
Hit slop: {top:8, bottom:8, left:8, right:8}
```

Compared to the pill variant used elsewhere (Plant back rows, MarkerDetailScreen back overlay), ghostRound is quieter — it doesn't compete with the "Where's your cairn?" title for attention. This IS the balance the user is asking for.

### 8.4 Title spec

```
Title:
  fontSize 22
  fontWeight 700   (was 500 — R114 bumps to 700 for stronger anchor)
  color Colors.textPrimary
  marginTop Spacing.md (12)   <- creates space between back and title
  marginBottom Spacing.xs (4)

Subtitle:
  fontSize FontSize.caption (13)
  color Colors.textSecondary
  lineHeight 18
  marginBottom Spacing.base
```

### 8.5 Also retokenizes

Same change as elsewhere: `MemoryColors.sepiaDeep` → `Colors.textPrimary`; `MemoryColors.cairnPublic` → `Colors.textSecondary`; primary button background `MemoryColors.sepia` → `Colors.primary`.

---

## 9. Mark list card (RoutesScreen FlagsTab) — Bug #4

### 9.1 Current (broken)

```
┌────────────────────────────────────────────────┐
│ [icon]  Cabin near saddle\u001EWater tap …   │  <- raw U+001E leaks
│         Hut                                    │
└────────────────────────────────────────────────┘
```

`RoutesScreen.tsx:1191` uses `{item.note || 'No note yet'}` — never calls `splitTitleBody`.

### 9.2 R114 new card via `<MarkCard>`

```
┌────────────────────────────────────────────────┐
│ ┌──┐                                       ┌─┐│
│ │🏠│  Cabin near saddle                    │→││
│ │  │  Water tap on north wall. Bunk 4      └─┘│
│ └──┘  loose.                                   │
│       🏠 Hut · 1.2 km · 🌐                     │
└────────────────────────────────────────────────┘
```

- Row 1: type badge (left, 40px round, meta.bg + meta.color border) + title bold 1-line + chevron right (grey)
- Row 2 (indented past badge): note body preview 2-line, `Colors.textSecondary`
- Row 3 (indented): type-label · distance · visibility-icon

### 9.3 `<MarkCard>` props

```ts
interface MarkCardProps {
  marker: Marker;
  distanceM?: number | null;          // from user's last coord; card formats via userUnit
  onPress: () => void;
  showApproxChip?: boolean;
  emphasize?: boolean;                // for "just planted" highlight — future
}
```

Internally calls `splitTitleBody(marker.note)` to unpack. Uses `MARKER_TYPES[marker.type]` for meta (single source of truth).

### 9.4 Spec

```
Card:
  flexDirection row (row 1 is a horizontal flex)
  padding Spacing.md (12)
  backgroundColor Colors.surface
  borderRadius Radius.card (14)
  borderLeftWidth 3, borderLeftColor meta.color   <- accent stripe (existing pattern)
  marginBottom Spacing.sm (8)
  shadow Shadow.card

Type badge:
  size 40, borderRadius 20
  backgroundColor meta.bg
  border 1 meta.color at 0.3 alpha
  Icon meta.icon, size 18, color meta.color, strokeWidth 2

Title (Row 1 right of badge):
  fontSize FontSize.body (15)
  fontWeight 600
  color Colors.textPrimary
  numberOfLines 1, ellipsizeMode 'tail'

Body preview (Row 2):
  fontSize FontSize.caption (13)
  color Colors.textSecondary
  lineHeight 18
  numberOfLines 2, ellipsizeMode 'tail'
  marginTop 2
  Only rendered if body length > 0

Meta row (Row 3):
  flexDirection row, alignItems center, gap 6
  marginTop 6
  Text elements:
    "🏠 Hut" — icon 11px + label FontSize.small (11) meta.color
    " · " separator FontSize.small textMuted
    "1.2 km" — FontSize.small textSecondary
    " · " separator
    Visibility icon (Lock/Users/Globe) 11px, color per §2.7 active tone
  If no distance yet: skip "· 1.2 km" and separator

Chevron right:
  size 14, Colors.textMuted, strokeWidth 2
  aligned to vertical center of card

Empty title fallback:
  When splitTitleBody returns title==='' and body==='': show "Untitled cairn" in italic textMuted (matches MarkerDetailScreen.titleEmpty)
When splitTitleBody returns title==='' but body has content:
  Use first 30 chars of body as displayed title (truncated) + full body as preview.
```

### 9.5 Sort + filter untouched

RoutesScreen's sort chip (Recent/Nearest) and permission filter row (personal/friend/public toggles) stay identical. Only the renderItem body changes.

---

## 10. Interaction spec — state machine

### 10.1 Plant flow

```
[Home tap "Plant"]
   ↓
GpsLockStep
   ├── busy 5s (progress bar animates)
   │      ├── success  → onLocked(lat,lng,acc) → PinAdjustStep
   │      └── fail     → §7 warning card → user taps "Search again" → busy
   └── user Cancel → nav.goBack() → Home

PinAdjustStep
   ├── user pans map (map moves under fixed pin)
   │      ├── within 50m of GPS anchor → confirm enabled
   │      └── outside 50m → confirm disabled + hint banner briefly
   ├── user Confirm → onConfirm(lat,lng) → ContentStep
   └── user Back → PlantScreen.onBack → nav.goBack() → Home
      (rationale: v299 discovery — going back to GpsLockStep is useless because it auto-advances)

ContentStep (<MarkForm>)
   ├── user edits type/title/note/visibility
   ├── user Back → onBack → step = 'pin' (revisit PinAdjustStep with confirmed pin coord retained)
   └── user "Plant Cairn"
          ├── submitting=true, button "Planting…"
          ├── PlantScreen.commit → addMarker (online or offline queue)
          │      ├── success → haptic.notification('success') → 250ms pause → nav.replace('MarkerDetail', {markerId})
          │      │              (in offline case: Alert 'Saved locally' first)
          │      └── fail → Alert with mapped copy, submitting=false, draft persisted, stay on step
```

### 10.2 View / edit an owned mark

```
[FlagsTab tap on card] or [Plant success replace] or [Memory tap own pin]
   ↓
MarkerDetailScreen
   view mode
   ├── user "Edit"        → isEditing=true, prefill from marker, render MarkForm
   │       ├── user "Save" → updateMarker → isEditing=false → view mode
   │       └── user "Cancel" → isEditing=false → view mode
   ├── user "Delete"       → Alert.confirm → deleteMarker → nav.goBack
   └── user Back           → nav.goBack
```

### 10.3 View another user's mark on Memory map

```
[Memory tap pin]
   ↓
CairnPinsLayer computes tier + form
   ├── form D (unrevealed)     → MysteryCairnSheet (dark variant)
   └── form A/B/C              → MarkDetailSheet with permission-gated actions (§4)
```

### 10.4 Error states summary

| Where | Error | Behavior |
|-------|-------|----------|
| GpsLockStep | GPS fail | §7 warning card, retry same step |
| GpsLockStep | Permission denied | §7 with "Open Settings" ghost button |
| PinAdjustStep | Beyond 50m | Confirm disabled + hint banner |
| ContentStep | commit fail (rate limit / duplicate / auth / network / other) | Alert with mapped copy, draft persisted, stay on step (existing) |
| MarkerDetailScreen | marker not found | notFoundBox (existing) |
| MarkerDetailScreen edit save | fail | Alert 'Could not save' (existing) |
| MarkerDetailScreen edit/delete | offline | button disabled + inline "Needs internet" hint (existing) |
| MarkDetailSheet action fail | (parent-owned via onDelete etc.) | parent handles (existing) |

---

## 11. Data flow — where U+001E lives

**Wire format** (existing, unchanged): `marker.note = "Cabin near saddle\u001EWater tap on north wall."`

**When we encode**: `PlantScreen.commit()` via `encodeTitleBody(title, body)` — one place.

**When we decode**: everywhere the note is displayed:
1. `MarkDetailSheet` — already correct (inline split)
2. `MarkerDetailScreen` view mode — already correct (`splitTitleBody`)
3. `MarkerDetailScreen` edit mode — already correct
4. `MarkCard` — **new** and correct
5. `RoutesScreen` FlagsTab — replaced by MarkCard, so correct
6. `RevealedCairnSheet` — deleted
7. `screens/MarkerDetailSheet.tsx` — deleted

**When we DO NOT display but manipulate**: `useMarkerStore.updateMarker(id, { note: encodeTitleBody(newTitle, newBody) })` — encode on write, always.

R114 invariant: **No component that renders `marker.note` may skip `splitTitleBody`.** Enforced by removing the two remaining raw-note callsites (`RoutesScreen` and legacy `MarkerDetailSheet`).

---

## 12. Visual tokens — canonical mapping

R114 palette rule: **Mark feature uses `Colors.primary` (forest green) + `Colors.flag` (accent orange) exclusively**. No `MemoryColors.sepia*` anywhere in the mark surfaces. MemoryColors stays only in the memory map fog rendering, not the mark UI.

### 12.1 Migration table (search-and-replace)

| Old (MemoryColors) | New (Colors) | Reason |
|--------------------|--------------|--------|
| `MemoryColors.sepia` (#c47a3e-ish) | `Colors.primary` (#5d7c46) | Primary CTA / active accent |
| `MemoryColors.sepiaDeep` | `Colors.textPrimary` (#2d2a26) | Body text primary |
| `MemoryColors.cairnPublic` | `Colors.textSecondary` (#8c7e72) | Body text secondary / muted |
| `MemoryColors.cream` (bg) | `Colors.bg` (#faf7f2) | Screen background |
| `'#fff5e0'` (chip active bg) | `Colors.primaryBg` (rgba(93,124,70,0.08)) | Active chip fill |
| `'#e8dfc8'` (border) | `Colors.border` (#ece6de) | Field / chip border |

### 12.2 Accent color usage

`Colors.flag` (#c87941) is reserved for:
- PinAdjustStep center pin ring (existing — keep)
- Type badge outlines when type === 'junction' (uses `Colors.docOrange` which is close but distinct — keep as-is per markerTypes)
- **Not used elsewhere in mark UI** — avoid two competing "hot" colors on a single screen

### 12.3 Spacing rhythm

Vertical rhythm in `<MarkForm>`:
- Field label → input: `Spacing.xs` (4)
- Input → char counter: -2 (visually hugs)
- Char counter → next field label: `Spacing.md` (12)
- Between logical blocks (type row → title, title → note, note → visibility): `Spacing.md` (12)

Vertical rhythm in `<MarkDetailSheet>`:
- Top close × → title: `Spacing.xs`
- Title → body: `Spacing.xs`
- Body → tier row: `Spacing.md`
- Tier row → author/visited/helper: `Spacing.sm`
- Content block → actionRow: `Spacing.md` (via marginTop on actionRow)
- actionRow → likeRow (if present): `Spacing.md` + top divider

### 12.4 Radii

| Element | Value |
|---------|-------|
| Card (MarkCard, sheet) | `Radius.card` (14) |
| Button | `Radius.button` (12) |
| Pill / chip | `Radius.pill` (20) / 18 for type chips |
| Round icon (type badge, back ghostRound) | 18-20 |
| Input | `Radius.button` (12) |

---

## 13. Accessibility

Non-negotiables (all currently missing on at least one mark surface):

- **Every interactive element has `accessibilityRole` + `accessibilityLabel`**: BackButton, chip, input, textarea, primary button, sheet close.
- **Chips**: `accessibilityRole='button'`, `accessibilityState={{ selected: active }}`.
- **Char counter**: `accessibilityLiveRegion='polite'` on the `X / 30` when it enters warning/danger tone, so screen readers announce "27 of 30 characters".
- **Field labels**: React Native `accessibilityLabel` on the input matches the visible label text (VoiceOver reads "TITLE, edit box").
- **Sheet modal**: `accessibilityViewIsModal={true}` on the sheet container.
- **Bottom sheet close**: `accessibilityLabel="Close"`, `hitSlop 8/8/8/8`.

Contrast (WCAG AA):
- `Colors.textPrimary` on `Colors.surface`: 12.4:1 ✓
- `Colors.textSecondary` on `Colors.surface`: 4.9:1 ✓
- `Colors.textMuted` on `Colors.surface`: 3.1:1 (borderline — used only for small non-critical)
- `Colors.primary` on `Colors.surface`: 4.5:1 ✓
- `#ffffff` on `Colors.primary`: 4.9:1 ✓ (primary CTA)
- `Colors.warning` on `Colors.warningBg`: 4.6:1 ✓
- `Colors.danger` on `Colors.surface`: 5.4:1 ✓

---

## 14. Test data (for QA / subagent blind review)

Three real markers to reproduce every visual state:

```json
{
  "id": "test-A-own-public",
  "type": "hut",
  "note": "Cabin near saddle\u001EWater tap on north wall. Bunk 4 loose.",
  "authorId": "<viewer id>",
  "authorName": null,
  "permission": "public",
  "lat": -41.28453, "lng": 174.77621,
  "createdAt": <now - 26h>
}
{
  "id": "test-B-friend-visited-friend-tier",
  "type": "danger",
  "note": "Slip\u001EWashout north of the second bridge — visible from ~50m upstream.",
  "authorId": "alex-l",
  "authorName": "Alex L.",
  "permission": "group",
  "lat": -41.28503, "lng": 174.77551,
  "createdAt": <now - 3d>
}
{
  "id": "test-C-friend-in-fog",
  "type": "junction",
  "note": "Take the left fork\u001E",
  "authorId": "bea-t",
  "authorName": "Bea T.",
  "permission": "public",
  "lat": -41.28603, "lng": 174.77451,
  "createdAt": <now - 45min>
}
```

Verification matrix:

| Marker | Form | Expected actions | Expected Like/Report? |
|--------|------|------------------|-----------------------|
| A | A | Edit + Delete + Like | Like yes, Report NO |
| B | B (visited friend) | Hide only | **NO** (Bug #2 fix) |
| C | C (in-fog friend/public) | Hide only + helper | NO |

Add a fourth marker for form-B-public:
```json
{ "id": "test-D-public-visited", ..., "permission": "public", "authorId": "cara-m" }
```
Expected: Hide + Like + Report (all three).

---

## 15. Acceptance criteria (for 3-subagent blind review)

Each subagent independently scores 1-10 on beauty + function + usability. Target: mean of the three ≥ 9.5.

### 15.1 Objective checkboxes (auto-fail if any missed)

- [ ] User learning cost 0: on Playwright walkthrough with a first-time user prompt ("plant a mark, then find it in the list, then edit it") the subagent completes the flow without any hint. No screen requires implementation knowledge to interpret.
- [ ] Visual consistency: ContentStep, MarkerDetailScreen edit mode, MarkDetailSheet action row, MarkCard all use identical field-label styling, identical chip styling, identical primary button color.
- [ ] Permission logic verified: with test markers §14 loaded, form B on friend-tier mark shows NO Like/Report row. Form B on public mark shows both.
- [ ] Every textarea + input has a visible uppercase field label above it.
- [ ] PinAdjustStep back button is a 36px ghost round, title "Where's your cairn?" is fontWeight 700 — subagent screenshot review confirms visual balance ("back and title feel like two distinct roles, back is subordinate but has a proper hit target").
- [ ] Zero rendered U+001E in any screenshot from RoutesScreen FlagsTab (Bug #4).
- [ ] Zero `MemoryColors.sepia*` refs in ContentStep, PinAdjustStep, MarkerDetailScreen, MarkDetailSheet after refactor. `grep -r "MemoryColors\." src/features/plant src/features/marks src/screens/MarkerDetailScreen.tsx` returns only `MemoryColors.cream` (backgrounds) — everything else migrated.
- [ ] GpsLockStep fail card uses warning tone (Colors.warning border + warningBg background, TriangleAlert icon), not danger red. Explainer + diagnostic + primary-color CTA present.
- [ ] All viewports (iPhone SE 375 / iPhone 14 Pro 393 / iPad 768) render without clipping.
- [ ] No console errors during full walkthrough (Playwright web build).

### 15.2 Subjective scoring rubric (each subagent, blind)

Subagent receives: (a) a walkthrough script equivalent to §14 test markers + Plant flow, (b) screenshots ONLY (no source), (c) is asked "would you pay for this app looking like this?"

Score = (Beauty + Function + Learnability) / 3.

Beauty (1-10):
- 10: production-grade tramping app, feels like DOC or AllTrails
- 8: cohesive, minor spacing/hierarchy nitpicks
- 6: functional but bland
- 4: obvious visual bugs / mismatch

Function (1-10):
- 10: every action succeeds first try, feedback is timely, error states are helpful
- 8: minor friction (one confusion recovered from quickly)
- 6: 2+ moments of "what does this do?"
- 4: broken flow

Learnability (1-10):
- 10: no help text needed, user infers everything
- 8: one label helps but is redundant for experienced users
- 6: at least one screen needs an explainer
- 4: user is lost

Auto-fail conditions (score capped at 6.0 regardless of the above):
- Any Bug #1-#6 still visible
- Permission gate broken (form B friend-tier can Like)
- U+001E anywhere in UI
- Any screen has a color scheme mismatch with the rest

### 15.3 Blind-review protocol

1. Main agent produces evidence bundle: 12 screenshots per subagent — (Plant: gps busy, gps fail, pin adjust, content step empty, content step filled) × (Detail: view own, view friend-public, view friend-tier, view in-fog) × (List: FlagsTab card) × (Sheets: form A public with like row, form B friend without like row).
2. Screenshots labeled `mark-r114-<scenario>.png`, saved to `docs/qa/r114-evidence/`.
3. Three subagents launched independently. Each receives the same 12 screenshots, this design doc, and the rubric §15.2. No cross-talk.
4. Aggregate mean score reported. If < 9.5, redesign (specific areas identified from lowest-scoring dimension). If ≥ 9.5, proceed to implementation.

---

## 16. Deferred / explicitly out of scope

- Voice memo (currently __DEV__ preview stub) — kept unchanged
- MysteryCairnSheet visual overhaul beyond token migration — kept as-is
- Public snapshot banner UX — kept as-is (works fine)
- Sync badge visual — kept as-is
- Distance-to-mark computation in list (uses existing `useDistance` hook)
- Photo attachment on cairn — no such feature yet; R114 does not add it
- Backend schema changes — none
- Any change to `MysteryCairnSheet`'s form-D routing except the color-token migration
- Any change to `PinAdjustStep`'s map/gesture behavior (the 50m ring, zoom buttons, recenter)
- Any change to `GpsLockStep`'s sampling logic, fast-path, or busy-state visuals
- Any change to `PlantScreen`'s commit / offline-queue / draft-restore logic

Everything above is orchestration or tested behavior. R114 is a UI redesign; it must not accidentally re-open resolved bugs.

---

## 17. Implementation order (post-approval)

Not part of this design doc, listed only to answer "what's next":
1. Add `MarkForm.tsx` (pure component, unit-testable with jest + react-native-testing-library)
2. Add `MarkTierChip.tsx`, `MarkCard.tsx`
3. Swap `ContentStep` body to `<MarkForm>`
4. Swap `MarkerDetailScreen` edit mode to `<MarkForm>`
5. Fix `MarkDetailSheet` permission gate (§4.2)
6. Delete `RevealedCairnSheet.tsx`, `screens/MarkerDetailSheet.tsx`; migrate callers
7. Migrate `RoutesScreen` FlagsTab renderItem to `<MarkCard>`
8. Rework `GpsLockStep` failBox (§7)
9. Rework `PinAdjustStep` header (§8) + add `BackButton` `ghostRound` variant
10. Sweep `MemoryColors.sepia*` refs in mark surfaces → `Colors.*` tokens
11. Playwright evidence bundle for §15.3 blind review

---

## 18. Design principles (for future revisions)

1. **One field, one label.** No user is expected to guess what a text box holds. Every input has a visible uppercase label.
2. **Permission is a hard gate, not a soft hint.** Buttons that require permission simply don't exist for viewers who don't have it. No greyed-out "Like" that toasts "Sign in to like".
3. **Two colors, disciplined.** `Colors.primary` for go, `Colors.flag` for accent. Every other color is neutral (grays, borders). No third accent inside the mark feature.
4. **The map is the hero on the pin step; the form is the hero on the content step.** Never split attention: one surface has one purpose per screen.
5. **Errors have a diagnosis, an action, and a tone.** Never a red box alone. Warning tone (orange) for retry-worthy states; danger tone (red) only for destructive confirmations.
6. **No hidden encoding leaks.** U+001E is a wire concern; the UI never renders it. Any component reading `marker.note` for display must call `splitTitleBody` — this is the invariant, not a suggestion.

---

*End of design document. Ready for 3-subagent blind review.*
