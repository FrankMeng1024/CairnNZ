# UX/UI Audit #8 — FriendsScreen + MarkerDetail Family + MarkerPin + MarkDetailSheet

**Auditor**: subagent #8
**Date**: 2026-07-28
**Files audited** (all under `C:\ClaudeCodeProjects\Cairn\app`):
- `src/screens/FriendsScreen.tsx` (799 lines)
- `src/screens/MarkerDetailScreen.tsx` (657 lines) — full-route detail
- `src/screens/MarkerDetailSheet.tsx` (170 lines) — HikingScreen bottom sheet
- `src/screens/MarkerPin.tsx` (62 lines) — web-fallback pin
- `src/features/marks/components/MarkDetailSheet.tsx` (425 lines) — Sprint 68 friend/tier sheet

**Score legend**: 10 = flawless, 9 = ship-worthy small nit, 8 = ship with follow-up, 7 = noticeable friction, ≤6 = bug/blocker.

**Playwright scripts** target web build at `http://localhost:8766/?v=…` (per `feedback_web_playwright_before_iphone.md`) — real machine gate afterwards.

---

## Part A — FriendsScreen (`FS-XX`)

### FS-01 Empty state (no friends, no requests) — 9/10
**File**: FriendsScreen.tsx:286-300, 555-557
**What good**: `<EmptyState>` renders `IllustrationHalo` + `EmptyFriends` (192px), heading "Cairn is better with trail companions", body copy, "Add a Friend" primary CTA. Copy is warm and product-appropriate.
**Nit**: Heading uses `FontSize.h2` + `textAlign: 'center'` — verify at 320px viewport it does not wrap into 3 lines (short-name device). No live viewport testing here.
**Playwright**:
```js
await page.goto('http://localhost:8766/?v=friends-empty');
await page.click('text=Friends');
await page.waitForSelector('text=Cairn is better with trail companions');
await page.screenshot({ path: 'fs-01-empty.png' });
```

### FS-02 Friends list populated — 9/10
**File**: 520-532, `FriendCard` 79-125
**What good**: mapped from `useFriendStore`, staggered entrance anim (`cardAnims`, 60ms stagger, 220ms), 12-slot pool.
**Issue (LOW)**: Pool cap = 12. If a user has 11+ friends, the 12th friend gets `cardAnims[?].opacity ?? 1` fallback = instant show, breaking stagger. Not a bug (fallback works), but the "no realloc" comment (390) is technically fragile.
**Playwright**:
```js
await page.evaluate(() => window.__cairnStores.friends.setFriends([...seedN(6)]));
await page.reload();
await page.screenshot({ path: 'fs-02-list.png', fullPage: true });
```

### FS-03 Pending friend requests — single request card — 8/10
**File**: 432-518, condition line 440 `incomingRequests.length > 1 && !requestsExpanded`
**What good**: Section label "1 friend request", per-request card with initials avatar, accept (Check) + reject (X). `busyRequestId` gates both buttons.
**Issue (MED)**: `handleAccept` awaits `Promise.all([loadFriendsFromBackend(), loadRequests()])` **then** fires `void loadCircleMarkers()` — the marker-refresh is fire-and-forget with no error surface. If it fails silently, the "friend accepted but their flags don't show up" bug returns.
**Playwright**:
```js
await page.evaluate(() => window.__cairnStores.friends.setRequests([mockReq1]));
await page.screenshot({ path: 'fs-03-req.png' });
await page.click('[testID="request-accept"]');
```

### FS-04 Pending friend requests — collapsed multi-summary — 8/10
**File**: 440-460
**What good**: When >1 request and not expanded, renders one "N friend requests / From Alice, Bob and 3 more" summary row with ChevronDown.
**Issue (LOW)**: `slice(0, 2).map(r => r.from_name).join(', ')` — if any name is >16 chars ("Christopher Kim-Watson"), the summary sub line overflows. No `numberOfLines={1}` on `requestSummarySub` (styles 623). Truncation would be silent per `feedback_truncate_is_bug.md`.
**Playwright**:
```js
await page.evaluate(() => window.__cairnStores.friends.setRequests(seedN(5)));
await page.screenshot({ path: 'fs-04-collapsed.png' });
```

### FS-05 Pending requests expanded — 9/10
**File**: 462-514, collapse button 469-478
**What good**: `ChevronUp` collapse button (28×28 pill), full request list below.
**Playwright**:
```js
await page.click('text=/\\d+ friend requests/');
await page.screenshot({ path: 'fs-05-expanded.png' });
```

### FS-06 Add Friend top-right button — 9/10
**File**: 420-424, styles.addTopBtn 582-592
**What good**: v373 fix aligned Add pill dimensions with BackButton (paddingVertical=7, FontSize.small, fontWeight=600). Solid primary bg for affordance.
**Nit**: `paddingHorizontal: Spacing.md` — visually smaller than expected. Verify hit-target ≥ 44×44pt on iOS.

### FS-07 Add Friend flow — sheet entrance — 9/10
**File**: `AddFriendSheet` 130-283, animation 141-159
**What good**: v374 fix — matches Hiking "choose a route" sheet exactly (translateY 300→0, 280ms Easing.out(cubic), backdrop 220ms). Consistent motion language.

### FS-08 Add Friend flow — email validation — 9/10
**File**: `isValidEmail` 43-45, submit 178-200
**What good**: RFC-style regex, "Enter a valid email" inline error, red border via `sheetStyles.inputError`.
**Issue (LOW)**: Regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` accepts `a@b.c` but rejects real corner cases (Unicode local parts). Fine for MVP but note.

### FS-09 Add Friend flow — loading state — 9/10
**File**: 264-266, `ActivityIndicator size="small" color="#fff"`
**What good**: Send button becomes spinner, `disabled` gates re-tap via `addState === 'loading'`.

### FS-10 Add Friend flow — success state — 9/10
**File**: 221-228 + 189-195
**What good**: CircleCheck icon, "Friend request sent", email echoed. 2s timeout then auto-dismiss.
**Issue (MED)**: `minHeight: 380` (line 769) on `successState` — sheet grows tall to match form height, but comment says "form-state at ~360-400px". Verify success state does not visually shrink after form dismount (jarring reflow).

### FS-11 Add Friend flow — backend error — 8/10
**File**: 196-199
**What good**: `result.error || 'Failed to send request'` — error surfaced inline as red text, state resets to idle so user can edit + retry.
**Issue (LOW)**: On error, `successEmail.current` was already set (line 186) but never cleared. If user retries with different email then hits error, then eventually succeeds, does old email leak into success screen? Trace: `successEmail.current = trimmed` runs before every submit → OK, no leak.

### FS-12 Add friend — self-invite guard — 6/10
**File**: 41 comment says "OWN_EMAIL removed — declared but never used"
**BUG (MED)**: Cannot-invite-yourself check appears to have been dropped in O1 batch 37. Backend `sendFriendRequest` may still catch it, but frontend now shows a generic backend error instead of the friendly "Can't invite yourself". Comment header line 3 still promises "Can't invite yourself" — copy drift.
**Fix owner**: Backend Dev / SM Story to restore client-side guard or update header comment.

### FS-13 Add friend — cancel button — 9/10
**File**: 274-276, 764
**What good**: Explicit Cancel PressBtn separate from backdrop tap. Standard iOS convention.

### FS-14 Add friend — backdrop tap dismiss — 9/10
**File**: 205-209
**What good**: `TouchableOpacity` fills `backdropTouch` area with `activeOpacity={1}` (no opacity flash).

### FS-15 Add friend — keyboard avoidance — 9/10
**File**: 212-215
**What good**: `KeyboardAvoidingView` with `Platform.OS === 'ios' ? 'padding' : 'height'`. Correct pattern.

### FS-16 Long username / email — friend card — 7/10
**File**: `FriendCard` 106-121
**BUG (MED)**: `name`, `meta` `Text` blocks have no `numberOfLines`. Long name "Alexander Christopherson-Williamson" wraps to 2 lines and shifts the online dot column. Per `feedback_truncate_is_bug.md`, truncation is a Critical UI bug — but here we have unbounded wrap instead, which is a different visual break. Add `numberOfLines={1}` + `ellipsizeMode="tail"`.
**Playwright**:
```js
await page.evaluate(() => window.__cairnStores.friends.setFriends([{ name: 'Alexander Christopherson-Williamson-Kim', ... }]));
await page.screenshot({ path: 'fs-16-longname.png' });
```

### FS-17 Loading state — screen entrance — 9/10
**File**: `screenOpacity` 386, 399
**What good**: 280ms fade-in on mount, `cardAnims` stagger starts at 160ms. Feels premium.

### FS-18 Network offline / fetchFriendRequests failure — 6/10
**File**: `loadRequests` 341-353
**BUG (MED)**: `fetchFriendRequests` failure path unhandled. If backend returns 500 or network dies, `reqs` will throw during `.map()` or be an empty array. No error banner, no retry affordance. First-time user opening Friends offline sees permanent empty state without knowing why.
**Fix**: try/catch + `<OfflineBanner />` or an inline "Couldn't load requests" row.

### FS-19 Status dot color logic — 8/10
**File**: `getStatusDotColor` 68-77
**Issue (LOW)**: Regex-based lastSeen parsing (`/^(\d+)m ago$/i`) — couples display formatting to state logic. If backend returns "45 minutes ago" or ISO timestamp instead of "45m ago", dot silently defaults to `Colors.border` (gray = "inactive"). Comment line 83-84 acknowledges backend doesn't return status → `sharing: false` initialized (line 322). Currently all friends show gray dot only if `sharedMarkers > 0` (via `hasStatus` line 85). Fragile but correct today.

### FS-20 Shared markers indicator — 9/10
**File**: 114-120
**What good**: Flag icon + count only shown when `sharedMarkers > 0`. Icon color = `Colors.flag`, size 12. Clean.

### FS-21 Add-friend card in list (below friends) — 9/10
**File**: 540-550, styles 653-665
**What good**: Dashed border primary CTA card as list terminator. Clear affordance to add without scrolling up.

---

