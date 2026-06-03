# QA Knowledge Base

## Product Understanding

Cairn is a React Native (Expo SDK 54) outdoor activity tracking app targeting NZ and Global markets. Web preview at http://localhost:8082/. Sign in: test@cairn.app / password123. Privacy policy checkbox requires click ~20px left of the "I agree to the Privacy Policy" text.

## Screens

- **AuthScreen** — Sign in / Create account. No real checkbox element for privacy policy; must click at ~20px left of text.
- **HomeScreen** — Stats bar (sessions, km, flags), recent activity card, Hiking/Running feature cards, Tools grid (Map, Routes, Friends, Settings)
- **HikingScreen** — GPS tracking, flag planting with name input (30 char limit), flag type selection
- **RunningScreen** — GPS tracking with lock mode, start/stop, voice guidance
- **MapScreen** — Interactive map with GPS pulse, flag planting
- **MapHistoryScreen** — Session history list, expandable session cards with "Preview" label and 3-row stagger expand
- **FriendsScreen** — Friend sharing toggles, entrance animation on load and remount
- **SettingsScreen** — App settings

## Known Pre-existing Issues (NOT test failures)

- **expo-keep-awake wake-lock errors** (4 total): Web API denial errors appearing as `r0`, `r1`, `r2`, `r3`. Present since Sprint 21. Appear only after starting HikingScreen/RunningScreen sessions. NOT Sprint regressions — exclude from error counts.
- **useNativeDriver web warnings**: Platform limitation — useNativeDriver not supported on web. Not actionable.
- **shadow* style props deprecated warnings**: Minor deprecation warning. Not actionable.

## Test Strategies

### Animation Testing
- Static screenshots confirm visual presence of animation (concentric rings, card states, etc.)
- Animation timing/smoothness cannot be verified from static capture — code correctness verified via Arch review
- Wait 1000-1200ms after navigation before taking screenshot to allow animations to complete

### Haptic Testing
- Web preview produces no tactile/audio output — haptics are web-platform limited
- Verify via: (1) absence of bundle errors, (2) Arch code review of haptic call placement
- Key haptic calls: flag type selection (Light), Start tracking (Medium), Stop tracking (Medium), double-tap unlock (Success)

### Char Count Testing
- HikingScreen and MapScreen flag name inputs: 30 char limit
- Amber threshold at exactly 22/30 — changes counter text AND input border color
- Below 22: grey/dark counter
- At/above 22: amber counter + amber input border

### Navigation Regression
- Test all 6 route pairs: Home↔Settings, Home↔Friends, Home↔MapHistory, Home↔Hiking, Home↔Map, Home↔Running
- Run browser_console_messages(level="error") after each navigation
- Only fail on NEW errors — exclude 4 pre-existing wake-lock errors

## Sprint 33 Updates (2026-05-16)

- GPS pulse animation: concentric rings + center dot visible on both HikingScreen and MapScreen map areas
- Char count amber threshold at 22/30 confirmed — affects both counter text AND input border on both screens
- MapHistoryScreen expanded card label: "Preview" (shortened from previous "Route Preview")
- FriendsScreen entrance animation re-runs on remount (navigate away and back)
- HomeScreen nudge card: conditional render confirmed — hidden when sessions.length > 0; text would be "Complete your first hike to see activity here"
- RunningScreen handleStop() haptic (Medium) confirmed fixed in Sprint 33 (was missing initially)
- All navigation regressions: clean across Sprint 33 changes

## Regression Checklist

For each Sprint, verify these are still working:
- [ ] Sign in flow (test@cairn.app / password123 + privacy checkbox workaround)
- [ ] HomeScreen stats bar (sessions, km, flags counts)
- [ ] Navigation to all screens from HomeScreen
- [ ] HikingScreen flag planting with char count
- [ ] MapScreen flag planting with char count
- [ ] MapHistoryScreen session list + expand/collapse
- [ ] FriendsScreen friend list + sharing toggles
- [ ] RunningScreen start/stop/lock cycle
