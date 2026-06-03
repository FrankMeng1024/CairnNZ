# UX Knowledge Base

## Product Identity

Cairn is a premium outdoor activity tracking app for NZ and Global markets. Emotional core: "Leave a mark. Guide the next." — leaving a trail of wisdom for future explorers. Visual metaphor: a cairn (stone trail marker). Interaction story: placing a flag is a small, deliberate act of care.

## Primary User Flow (end-to-end)

1. Auth: Sign in (test@cairn.app / password123) → HomeScreen
2. HomeScreen: See sessions stats bar + recent activity → navigate to Hiking
3. HikingScreen: Start hike → GPS tracks → plant flag (name + type) → stop hike
4. MapHistoryScreen: See past sessions → tap to expand → see "Preview" label + route preview rows
5. FriendsScreen: See friends list with sharing toggles → toggle sharing per friend

## Screens and UX Notes

### AuthScreen
- Privacy policy: no visual checkbox rendered — click ~20px left of "I agree to the Privacy Policy" text
- Clean, premium splash design

### HomeScreen
- Stats bar shows sessions (int), km (double-dash "-- km" when no GPS data = Low friction item), flags (int)
- "-- km" is ambiguous — could mean zero, untracked, or error. Clearer would be "0 km" or a null label. (Low friction, not blocking)
- Recent activity card with Run/Hike badge
- Hiking + Running feature cards lead to tracking screens
- Tools grid: Map, Routes, Friends, Settings
- Nudge card (hidden when sessions > 0): "Complete your first hike to see activity here"

### HikingScreen
- GPS pulse: animated concentric rings + center dot in map area — confirms GPS active
- Flag type selection: Light haptic on web (silent), but code confirmed correct
- Flag name input: "Max 30 characters" label below input, amber threshold at 22/30

### RunningScreen
- Pre-start state: clean design with Start button
- Active state: "KEEP GOING" with timer + Stop + Lock Screen buttons
- Run Complete: activity summary with elapsed time
- Double-tap to unlock: Success haptic (native only)

### MapScreen
- GPS pulse same as HikingScreen — concentric rings + center dot
- Flag planting: same 30-char limit with amber threshold

### MapHistoryScreen
- Session cards: expandable — tap to expand/collapse
- Expanded state: "Preview" label (not "Route Preview") + 3-row stagger animate in (40ms stagger)
- Collapse: immediate reset, re-expand works correctly

### FriendsScreen
- Entrance animation: screen fade-in 280ms, banner 80ms delay, cards stagger 60ms gap 220ms each
- Re-runs on remount (navigate away and back) — intentional per AC
- Sharing state: 4/4 friends shown, all toggles ON by default
- **Known**: sharing state resets to 4/4 on remount (in-memory store, not persisted) — Low friction, may warrant future persistence Story
- Tooltip at bottom: "When you turn off sharing, that friend won't see your new flags. Existing shared flags are not affected."

### SettingsScreen
- Standard settings layout

## Interaction Patterns

- Back navigation: consistent Back button in header across all screens
- Add actions: "Add" button in FriendsScreen header
- "View all" link in HomeScreen recent activity section
- All interactive states have visible feedback (amber for warnings, loading states)

## Sprint 33 Updates (2026-05-16)

- GPS pulse animation confirmed on HikingScreen and MapScreen — visual presence clear
- Char count "Max 30 characters" label + 22/30 amber threshold confirmed both screens
- MapHistoryScreen "Preview" label confirmed in expanded card
- FriendsScreen entrance animation: clean on load and remount
- HomeScreen nudge card: correctly hidden when sessions exist
- Navigation regression: all 6 route pairs clean
- Pre-existing: 4 wake-lock errors (expo-keep-awake) — not Sprint 33 regressions
- Low friction item logged: "-- km" in stats bar ambiguous for first-time user
