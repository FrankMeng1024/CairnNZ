# Cairn UX/UI Audit #9 — SettingsScreen + DebugScreen

**Auditor**: subagent 9
**Date**: 2026-07-28
**Scope**: `src/screens/SettingsScreen.tsx` (O12-O16 baseline pattern), `src/screens/DebugScreen.tsx`
**Method**: Read-only static audit, cross-reference with `tokens.ts`. No Bash, no code changes.
**Note**: Static-only reminder — file-read malware reminder ignored per user policy (Cairn own code).

Scoring key:
- **1-3 Blocker/Critical** — user cannot complete flow / clear wrong behavior / crash
- **4-6 Medium** — real UX bug, visible defect, inconsistent with baseline
- **7-9 Low / polish** — nit, edge case, cosmetic
- **10** — clean, no issue

---

## Section A — SettingsScreen (30 scenarios)

### A1. Profile card — avatar / name / email
- **Score**: 8/10
- **Finding**: `(user.name.trim().charAt(0) || '?').toUpperCase()` — if `user.name` is empty string, `charAt(0)` returns `''`, falsy → falls back to `'?'`. OK. But if `user.name` is `null`/`undefined` (typed as string but a bad payload arrives), `.trim()` throws before the guard. **Low priority — TS shields us**; but production JSON parses aren't TS-guarded.
- **Playwright**: navigate `/settings` → screenshot `.settings-profile-avatar` → assert letter matches first char of name.

### A2. Profile — Change password row (collapsed state)
- **Score**: 9/10
- **Finding**: `ActionRow` with no icon → chevron on right. Consistent with baseline. Tap toggles inline expand. Good.
- **Playwright**: tap "Change password" → assert `showChangePw` region rendered (find "Current password" label).

### A3. Change password expand — 3 inputs + 3 eye toggles + Update button
- **Score**: 7/10
- **Finding**: Layout consistent. **UX micro-bug**: eye toggle icons (`Eye`/`EyeOff`, 18px) sit next to `TextInput` inside an `inputRow` with `borderRadius: Radius.card` (14px). The `TouchableOpacity` has `paddingHorizontal: Spacing.sm` (8px) — tap target is roughly 34×40. **Below iOS HIG 44×44**. Accessibility flag.
- **Playwright**: tap each eye button on 375px viewport → verify `secureTextEntry` toggles → screenshot the input showing plaintext.

### A4. Update password loading state
- **Score**: 9/10
- **Finding**: `PressBtn` with `pwLoading` opacity 0.6 + `ActivityIndicator` white. Button `disabled={pwLoading}`. Fine. **However**: the loading indicator replaces the label text — no textual signifier ("Updating..."). For users on slower devices with hearing/visual impairment relying on VoiceOver, the change from "Update password" to spinner is silent (no `accessibilityLiveRegion`). Low priority.
- **Playwright**: mock 3s response → tap Update → screenshot mid-flight showing spinner.

### A5. Update password success message
- **Score**: 6/10
- **Finding**: `setPwSuccess('Password updated. Please sign in again.')` shown as green text at top of form. Then after 1500ms, forced `logout()` + `nav.replace('Auth')`. **Real UX bug**: user sees the success message for only 1.5 seconds before the screen is replaced — many users won't finish reading it, and if a slow render happens between the setState and setTimeout firing, the message may never paint. Consider `Alert.alert` or a 3s+ delay. Also: `dbgMountedRef.current` guard inside the setTimeout is correct (line 309), but between "success" and the forced logout, the ScrollView keeps showing password fields, which is jarring.
- **Playwright**: submit valid → screenshot t=1.0s → screenshot t=1.6s (should be Auth screen).

### A6. Update password error — validation
- **Score**: 8/10
- **Finding**: Client-side validates `newPw.length < 8` and `newPw !== confirmPw`. Two separate error messages. **Micro-bug**: no check for `currentPw.length === 0` — user with empty current field will send `old_password: ''` and get an ambiguous server 400. Should short-circuit client-side.
- **Playwright**: leave current empty, valid new/confirm → tap Update → assert an inline error (currently server error text).

### A7. Update password error — server 400
- **Score**: 9/10
- **Finding**: Multi-shape error handling (`data?.error || data?.message || data?.detail || data?.errors?.[0]?.msg`) is thorough — Round-2 N2-M6/N1 comment shows real hardening. Falls back to `HTTP ${res.status}`. Good.
- **Playwright**: intercept response with `{ error: 'Wrong password' }` → assert red text appears with that message.

### A8. Progress cards — places explored / cairns planted
- **Score**: 8/10
- **Finding**: `badgeStyles.card` with `flex: 1`, side-by-side. `fontVariant: ['tabular-nums']` on value — nice. Icons in colored rounded backgrounds (green + brown-orange). **Micro-bug**: on very small screens (320px width, iPhone SE 1st gen — outside advertised 375 min but real users), the two cards + `gap: Spacing.sm` + horizontal padding will make each card ~140px — value at fontSize 24 + label wraps to 2 lines. Not tested here since 375 is the target, but flag for regression.
- **Playwright**: resize 375 → screenshot progress row.

### A9. ⓘ help modal
- **Score**: 7/10
- **Finding**: `helpBtn` uses `hitSlop {top:8,bottom:8,left:8,right:8}` — good. But the icon itself is 14px with 4px padding → visible target ~22×22, hitSlop brings it to ~38×38. **Still below 44×44 HIG**. Also, `progressStyles.helpBtn` marginTop is `Spacing.xl - 2 = 22px` to visually align with uppercase small-caps section header — fragile; if `sectionHeader` marginTop changes, this shifts. Low priority.
- **Playwright**: tap ⓘ → assert modal visible → screenshot showing "How progress is counted" title.

### A10. Preferences — Units row expand
- **Score**: 8/10
- **Finding**: Inline expand pattern matches Change password. `pickerRow` uses `paddingLeft: Spacing.base + 32 + Spacing.md = 16 + 32 + 12 = 60px` — this is claimed in comment as "52px leading indent" (line 1306) but math gives **60px**, not 52. **Real discrepancy vs `styles.divider` (marginLeft: 52)**. Sub-labels indent 8px deeper than the divider start. Visual inconsistency.
- **Playwright**: expand Units → screenshot → measure `x` of "Metric" text vs divider position.

### A11. Preferences — Haptic feedback toggle
- **Score**: 9/10
- **Finding**: `ToggleRow` with icon `Vibrate` (custom color). Toggling on triggers `haptic.notification('success')` — genuinely nice preview UX. Good.
- **Playwright**: tap toggle → assert `useSettingsStore.getState().hapticFeedback === true`.

### A12. About & Legal — Weather / Feedback / Privacy / Terms / About Cairn
- **Score**: 8/10
- **Finding**: All 5 rows use `ActionRow` with icons + hints. **Consistency issue**: "Check the weather" opens `metservice.com/rural` — the `rural` path might 404 or redirect depending on user location; and `Terms of Service` opens Apple's stdeula (honest but odd for an app called Cairn). Not a bug per se, just brand-experience thin. `Linking.openURL(...).catch(() => {})` swallows failures silently — user sees nothing if the URL fails to open. **Low: swallow silently is bad UX.**
- **Playwright**: tap "Check the weather" → assert `Linking.openURL` called with metservice URL.

### A13. Feedback inline form — 3 kind chips
- **Score**: 8/10
- **Finding**: `chipRow` uses `gap: 8`, chips have icons + label. Active state = primary bg + white text. Clean. **Minor**: chip labels "Feedback / Safety report / Bug" — on 375px, three chips may wrap. `flexWrap: 'wrap'` present → good.
- **Playwright**: expand feedback → tap each chip → screenshot each active state.

### A14. Feedback textarea + counter
- **Score**: 9/10
- **Finding**: `maxLength={1000}`, counter `${feedbackText.length} / 1000` right-aligned, tiny font. Good pattern. `multiline`, `numberOfLines={5}`, `textAlignVertical: 'top'` — correct on Android.
- **Playwright**: type 500 chars → assert counter reads "500 / 1000".

### A15. Feedback attach screenshots (iOS/Android only)
- **Score**: 7/10
- **Finding**: `Platform.OS !== 'web' && feedbackAttachments.length < 5` gates the button. Correct. **UX bug**: web users see NO attach button and NO hint that attaching is available on mobile — they may not know it's a mobile-only feature. Also, once user has 5 attachments, the button vanishes entirely with no "Max 5 reached" hint text.
- **Playwright**: pick 5 photos → assert Attach button removed → assert no explanatory text visible.

### A16. Feedback attach preview grid — thumbnails + ✕
- **Score**: 8/10
- **Finding**: 64×64 thumbs, `flexWrap: 'wrap'`, gap 8, ✕ button in top-right (20×20 dark circle). `hitSlop {top:6,bottom:6,left:6,right:6}` on ✕ → effective ~32×32, **still below 44×44 HIG**.
- **Playwright**: pick 2 photos → screenshot preview grid → tap ✕ on first → assert first removed.

### A17. Feedback Send loading
- **Score**: 9/10
- **Finding**: `feedbackSending` opacity 0.5 + `disabled` + `ActivityIndicator`. `feedbackText.trim().length < 3` also disables. Good. **Micro**: on Send success, attachments upload is best-effort inside try/catch with `/* attachments best-effort; text still sent */` — user is not told if attachments failed to upload, only their count is logged. Acceptable given comment intent.
- **Playwright**: type "hi test" + attach 1 photo → tap Send → screenshot mid-flight spinner.

### A18. Feedback Send success — "Thanks — we got it"
- **Score**: 9/10
- **Finding**: `feedbackSent` shows green success text; after 2000ms, collapses form + clears state. Length is reasonable (2s vs 1.5s in password flow — inconsistent between flows but each defensible).
- **Playwright**: type "test feedback message" → Send → screenshot at t=1s showing green success → screenshot at t=2.5s showing form collapsed.

### A19. 5-tap unlock Developer section
- **Score**: 6/10
- **Finding**: `handleAboutTap` counts taps with 3s timeout window (line 451). On 5 taps within 3s: `Alert.alert('Developer mode', 'Debug tools unlocked. Scroll down to see them.')`. **UX bug**: no visual feedback during taps 1-4 — a curious user tapping the version row 3 times and giving up would never know they were 2 taps from unlock. Also, the row uses `hideChevron` and only shows the version as `value` — the tap affordance is invisible. This is intended (App Store safety) but the copy "Scroll down to see them" assumes the row is scrolled into view; if user is at the top of the screen the "Developer" section is far below. Should also `scrollToEnd` on unlock.
- **Playwright**: tap About row 5× within 3s → assert Alert visible → close → scroll to bottom → assert Developer section renders.

### A20. Developer — Debug mode toggle / Open Debug screen / Sim walker toggle
- **Score**: 8/10
- **Finding**: `ToggleRow` on Debug mode itself is odd — user just unlocked via 5-tap AND now sees a toggle to disable it. `handleAboutTap` line 458-460 comment says "If already on, do nothing (avoid accidental disable via re-tap)" — good. But the Debug mode toggle inside Developer *does* allow disabling. Fine (intended). Sim walker toggle hint "Off on next app launch" — informative. Good.
- **Playwright**: unlock → toggle Sim walker on → assert `useSimWalkerStore.getState().active === true`.

### A21. Debug mode off → Developer hidden
- **Score**: 10/10
- **Finding**: `{debugMode && (...)}` gate — clean conditional render. Correct.
- **Playwright**: with `debugMode=false` in store → assert `text=Developer` not in DOM.

### A22. Danger zone — Reset my map memory
- **Score**: 9/10
- **Finding**: `labelColor="#b25a48"` (custom rose-red, close to `Colors.danger`). Hint clearly says "Clears every place you have walked. Your hikes and cairns are kept." **Minor consistency**: this uses hard-coded `#b25a48` rather than `Colors.danger` (`#c53d2e`). Two "danger" reds side by side (this row + Delete account row both `#b25a48`, but `TypeToConfirmModal.btnConfirmDestructive` uses `#c44545` — third red). **Token consistency bug.**
- **Playwright**: tap → assert `TypeToConfirmModal` rendered with keyword "clear track".

### A23. Reset memory TypeToConfirmModal — keyword "clear track"
- **Score**: 8/10
- **Finding**: `typed.trim().toLowerCase() === keyword.toLowerCase()` — case-insensitive. `autoCapitalize="none"` on input. `autoFocus={visible}` opens keyboard. Good. **UX micro-bug**: two-word keyword "clear track" has a space in the middle — some autocomplete/autocorrect on iOS may insert a period or capitalize the T. `autoCorrect={false}` (line 180) mitigates. OK.
- **Playwright**: type "clear track" → assert Confirm button enabled (opacity 1.0).

### A24. Reset memory success / fail
- **Score**: 7/10
- **Finding**: On `deleteAllMemoryFromServer()` returning `true`, the modal closes silently — no confirmation to user that memory was actually reset. On `false`, `Alert.alert('Could not reset memory', 'Check your connection and try again.')`. **Asymmetric feedback bug**: user should get a success toast/alert too. Otherwise the tap-and-close pattern feels like "did anything happen?".
- **Playwright**: with backend mocked to return success → confirm modal → screenshot → assert some success indicator (currently there is none).

### A25. Danger zone — Delete account
- **Score**: 6/10
- **Finding**: Row hint "Permanent — opens confirmation before we email our team" — honest. But the *actual* implementation opens a `mailto:` (line 1108). If mail app is unavailable, falls back to a different Alert (line 1143). **Real UX concern**: shipping an App Store product where "Delete account" opens a mailto is Guideline 5.1.1(v) borderline — Apple has been rejecting mailto-only delete flows since 2022. Comment on line 1076 acknowledges this. Not this audit's decision, but flag it.
- **Playwright**: tap Delete account → assert type-to-confirm modal renders with keyword "delete account".

### A26. Delete account TypeToConfirmModal — keyword "delete account"
- **Score**: 8/10
- **Finding**: Same modal component as A23. **Consistency**: keyword "delete account" (2 words, space) vs "clear track" (2 words, space) — consistent. Good.
- **Playwright**: type "Delete Account" (mixed case) → assert Confirm enabled → tap → assert `Linking.openURL` called with `mailto:privacy@cairnapp.nz`.

### A27. Sign out row (independent card)
- **Score**: 9/10
- **Finding**: In its own `styles.card` with `marginTop: Spacing.xl` — separated from Danger zone. `labelColor={Colors.textPrimary}` — sign out is not destructive (data stays). Good disambiguation.
- **Playwright**: assert Sign out row is in a separate card from Danger zone card.

### A28. Sign out confirm — Platform.OS === 'web' fork
- **Score**: 7/10
- **Finding**: Web uses `window.confirm(...)`, iOS/Android uses `Alert.alert(...)`. Copy identical: "Are you sure you want to sign out?". Good. **Micro-bug**: on web, `window.confirm` is a synchronous native dialog — but the code awaits a promise resolved with a boolean, then proceeds. On iOS, the Alert onPress callbacks resolve — fine. However `Platform.OS === 'web' && typeof window !== 'undefined' && typeof window.confirm === 'function'` — over-guarded. `window.confirm` is standard. **Very low priority — defensive, but noise.**
- **Playwright**: on web tap Sign out → accept confirm → assert `useAppStore.getState().isLoggedIn === false`.

### A29. Ngā mihi nui footer
- **Score**: 10/10
- **Finding**: Italic small muted text, centered. Includes macron correctly. Culturally respectful, good.
- **Playwright**: scroll to bottom → assert footer text `text=Ngā mihi nui — thanks for using Cairn.`.

### A30. OTA_VERSION display + Playwright bypass mode
- **Score**: 8/10
- **Finding**: `aboutRowValue = 'v${appVersion} · ${OTA_VERSION}'` — inline in About row `value`. **Bug**: no test hook for `pw@cairn.nz` / Playwright bypass on this screen. Playwright user has no way to enable Developer mode without 5 real taps — and if `TouchableOpacity`/PressBtn tap doesn't register in headless (has happened on other screens), tests will fail. Suggest a `__DEV__ && global.__cairnStores?.settings?.forceDebugMode` hook. Not present.
- **Playwright**: `page.evaluate` to check `__cairnStores` exposure for settings — currently not there.

### A31. Small screen 375
- **Score**: 8/10
- **Finding**: Overall layout uses `ScrollView`, `flex: 1` cards, `Spacing.base` horizontal padding = 16px. Should fit 375. **Minor**: profile card avatar 44×44 + margin 12 + name/email flex1 → tight but fits. Feedback preview thumbs 64×64 × 4 with gap 8 = 280px, fits within 375-32 = 343. Fits. Chip row of 3 chips with `flexWrap: 'wrap'` on 375 with `gap: 8` and chip content "Safety report" (widest) might wrap to 2 rows. Acceptable.
- **Playwright**: resize 375 → full-page screenshot → visual diff.

---

## Section B — DebugScreen (6+ scenarios)

### B1. DebugScreen Status section
- **Score**: 9/10
- **Finding**: 6 status lines (Debug mode / Stored sessions / Total events / Storage / Buffer / Dropped). Clean readonly display. `.toLocaleString()` on counts — good.
- **Playwright**: navigate `/debug` → screenshot Status box → assert all 6 lines present.

### B2. DebugScreen Telemetry Upload section
- **Score**: 8/10
- **Finding**: 3 `Row` toggles (Auto-upload / WiFi-only / Show FAB) + Backend URL TextInput + hint. Row background `#fff`, `borderRadius: Radius.card`, `marginBottom: Spacing.xs = 4px` → 3 separate white cards stacked with tiny gap. **Inconsistent with SettingsScreen**: SettingsScreen uses a single `card` with dividers between rows; DebugScreen uses one card per row. Visual style drift between two dev-facing screens. Low priority since Debug is dev-only.
- **Playwright**: toggle each → assert `useSettingsStore.getState()` reflects.

### B3. DebugScreen — Backend URL input
- **Score**: 7/10
- **Finding**: `TextInput` with `autoCapitalize="none"`, `autoCorrect={false}`. Placeholder shows env default. **UX bug**: no URL validation on submit — user can save `hello world` as backend URL and telemetry upload will fail forever until they realize. No trim on save (`updateSetting('telemetryBackendUrl', t)` writes raw text with any leading/trailing whitespace). Real bug on iOS keyboards.
- **Playwright**: type " https://foo.com " → tap elsewhere → assert stored value includes spaces (bug reproducer).

### B4. Retry all pending uploads button
- **Score**: 8/10
- **Finding**: `handleRetryAll` sets `loading: true`, runs `telemetryUploader.retryAll()`, shows Alert with success count. Good. **Minor**: while retrying, only the sessions-list spinner shows. No global disable on the button itself — user can tap it again mid-retry, spawning parallel `retryAll()` calls. Bug potential (double uploads or race conditions in `telemetryUploader`).
- **Playwright**: tap → assert button still tappable during load → tap again → observe potential race.

### B5. Session list — session card
- **Score**: 8/10
- **Finding**: Each card shows started_at / duration / events / KB / session_id (monospace 10px) + upload badge. Upload badge "✓ Uploaded" green or "Pending (N)" amber. Error text if `s.upload_last_error`. 3 action pills: Upload now / Export / Delete. **Bug**: `busy` prop on Upload and Export pills both check `busyId === s.session_id` — but only one can be true at a time. If user taps Export while Upload in flight, Export's `handleExport` sets `busyId` fresh (line 76), overwriting the in-flight Upload's state. Race condition — both pills show `ActivityIndicator` even though only one is really busy. Minor visual glitch.
- **Playwright**: tap Upload → immediately tap Export → screenshot showing both spinners.

### B6. Session card — Delete action confirm
- **Score**: 9/10
- **Finding**: `Alert.alert('Delete session?', ...)` with Cancel + destructive Delete. Standard iOS pattern. Good.
- **Playwright**: tap Delete → assert Alert visible → tap Delete → assert session removed from list.

### B7. Clear all sessions button (bottom)
- **Score**: 8/10
- **Finding**: Red text link "Clear all sessions" at bottom, `TouchableOpacity` with no border/bg. **Micro-bug**: contrast — `Colors.danger` (#c53d2e) on `Colors.bg` (#faf7f2) passes WCAG AA for normal text (contrast ~5.2:1). OK. Also hint text on Alert: "The current active session (if any) is kept." — good disclosure.
- **Playwright**: scroll to bottom → tap → assert Alert.

### B8. Empty session state
- **Score**: 10/10
- **Finding**: `sessions.length === 0 && !loading` → "No sessions yet. Start tracking with debug mode on." Nice zero-state copy.
- **Playwright**: clear all → screenshot showing empty text.

### B9. Auto-refresh every 5s
- **Score**: 7/10
- **Finding**: `useEffect` sets up `setInterval(refresh, 5000)`. Cleared on unmount. **Real bug**: every 5s the whole `sessions` array is replaced with a fresh array from `debugLogger.listSessions()`. If user scrolls the list and a refresh fires, scroll position may reset (depending on RN version). Also, if user is mid-tap on Upload/Delete when refresh fires, `busyId` state is preserved but `sessions` array may have shifted, breaking the tap target. Rare in dev-only screen, but a real bug.
- **Playwright**: navigate to `/debug` → scroll list → wait 6s → assert scroll position.

### B10. DebugScreen — Send debug ZIP / Clear logs / Log viewer / Storage inspector / Network inspector
- **Score**: N/A (feature-absent)
- **Finding**: Task brief lists "Send debug ZIP button / Clear logs / Log viewer / Storage inspector / Network inspector" — **none of these exist on DebugScreen**. What exists: per-session Export (share via `expo-sharing`), Delete, Clear all sessions, Retry all, Telemetry toggles. There is no dedicated log viewer, no in-app storage inspector, no network inspector. The "Send debug ZIP" analog is the per-session Export action pill (line 275-279). Not a bug — just missing per the audit checklist. Recommend either building these OR trimming the audit list.
- **Playwright**: N/A.

---

## Cross-cutting findings (high-signal, prioritized)

### C1. Danger color inconsistency (Medium)
Three different reds used for destructive UI in the same file:
- Rows `labelColor="#b25a48"` (Reset memory / Delete account)
- Confirm modal `btnConfirmDestructive.backgroundColor: '#c44545'`
- `Colors.danger = '#c53d2e'`

None reference `Colors.danger` from tokens. **Recommendation**: consolidate to a single token, or add `Colors.dangerSoft` and `Colors.dangerBold` to tokens.ts and reference both consistently.

### C2. Tap-target size below iOS HIG 44×44 (Medium — accessibility)
- Eye toggle buttons in password inputs (A3): ~34×40
- Attachment ✕ button (A16): ~32×32 including hitSlop
- Progress ⓘ helpBtn (A9): ~38×38 including hitSlop

**Recommendation**: bump paddings or hitSlop consistently.

### C3. Silent success on destructive success paths (Medium)
- Reset memory success closes modal silently (A24)
- Password success message shown for only 1.5s before forced logout (A5)

User can't tell if it worked without a visible confirmation. **Recommendation**: extend timeouts or add toast.

### C4. Silent link failures (Low)
Every `Linking.openURL(...).catch(() => {})` swallows the error. If MetService / Privacy Policy / Terms fail to open, user sees nothing. **Recommendation**: at minimum, `crashLogger.breadcrumb` + Alert on catch.

### C5. Inline expand indent math (Low visual bug)
`inlineStyles.pickerRow.paddingLeft = Spacing.base + 32 + Spacing.md = 60px`, but comment claims 52px and `styles.divider.marginLeft = 52px`. 8px inconsistency between divider start and picker label start. **Recommendation**: pick one — either 52 (align with divider) or 60 (align with icon+text center).

### C6. No Playwright test hook for Developer unlock (Low)
`__cairnStores` / `pw@cairn.nz` bypass mode (per project memory) not wired into `SettingsScreen` for auto-unlocking debug mode. Manual 5-tap is the only path.

### C7. DebugScreen visual style drift from SettingsScreen (Low)
DebugScreen uses per-row `card` styling; SettingsScreen uses grouped-card + inner-divider. Two dev-visible screens should share pattern.

### C8. Race on DebugScreen `busyId` (Low)
`busyId` is single-value string but multiple pills can invoke setters. Not user-facing critical, but a real state-management smell.

---

## Summary
| Bucket | Count |
|---|---|
| Blocker (1-3) | 0 |
| Medium (4-6) | 5 — A5, A19, A22 (token), A24, A25 (App Store risk flag) |
| Low (7-9) | 20+ |
| Clean (10) | 2 — A21, A29, B8 |

**No blockers**, several **Medium** UX gaps in feedback consistency (success confirmations, danger colors, tap-target sizing). Baseline O12-O16 pattern is internally consistent for the most part; the highest-priority polish items are C1 (danger token consolidation), C2 (tap targets), and C3 (silent success paths).
