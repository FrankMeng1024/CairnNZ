# Sprint 35 Goal

**Sprint**: 35
**Goal**: Real auth foundation — backend scaffold + JWT email auth wired to frontend, plus AuthScreen UI polish

**User-visible outcome**: A user can create an account (email/password), sign in, and their data is stored securely on a real backend with a real database. The AuthScreen flows are polished: correct button order, icon-inline title, focus ring fix, professional privacy policy.

**Sprint Scope**:
- STORY-00117: AuthScreen UI polish (button order, title layout, focus ring, privacy policy)
- STORY-00118: Backend scaffold — Node.js/Express + MySQL schema for users + JWT auth endpoints
- STORY-00119: Frontend wires to real backend — replace mock setLoggedIn() with real API calls
- STORY-00120: Google OAuth integration via expo-auth-session (web preview + Expo Go)

**Out of scope this Sprint**:
- Apple Sign In (requires physical device + Apple Developer account)
- User data sync (sessions, markers) — Phase B
- Push notifications, password reset email — Sprint 36+
