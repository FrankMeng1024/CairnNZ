# CR.md — Cairn

*Change Requests are appended here by PO. Where CR conflicts with PRD, CR takes precedence.*

---

## CR-001: UI Quality Uplift (Sprint 6)

User directive (post Sprint 5 review): UI framework direction is correct but quality is too low / too simple. Each page needs to be redesigned with higher design quality and UX. Approach: 1–3 sprints per page, finish one page before moving to next. Emoji icons must be replaced with SVG icon system. Animations and interactive feedback required on all elements.

**Status**: Approved — Sprint 6 begins execution

---

## CR-002: 防息屏 — Keep Screen Awake (Sprint 7)

Add `expo-keep-awake` to prevent screen sleeping during active running and hiking tracking states. Keep-awake activates only when `trackingState === 'tracking'` (hiking) or `runState === 'running'` (running). Automatically deactivates when activity ends.

**Status**: Approved — Sprint 7 execution target

---

## CR-003: Real Functionality — Enable Live Features (Sprint 7+)

Replace all mock data and static UI with real functionality: expo-location GPS tracking, real distance/pace calculation, flag planting writes to Zustand store, settings persistence via AsyncStorage. Implement page-by-page alongside UI quality uplift.

**Status**: Approved — Sprint 7+ execution target

---

## CR-004: Real Auth + Backend — E-001 Phase B (Sprint 35)

User directive (2026-05-16): Build real backend with database. Each user's data stored in their own account. Implement real login: email/password + Google OAuth + Apple Sign In. AuthScreen UI polish: swap button order (Sign In primary), icon inline with title, focus ring fix, professional privacy policy. Backend architecture: Node.js/Express, MySQL, JWT. Backend handles auth, user data, future session/marker sync.

**Status**: Approved — Sprint 35 begins execution
**Stories**: STORY-00117 (UI polish), STORY-00118 (backend), STORY-00119 (frontend wire), STORY-00120 (Google OAuth)

---

## CR-005: Auth UX Unification + User Data Isolation + Splash Uplift (Sprint 39)

Four issues found post-Sprint 38:

1. **Auth flow standardisation**: Social login buttons (Google/Apple) must appear identically on both Sign In and Create Account — no special-casing. Google button shows immediate inline loading spinner on tap, then opens OAuth popup. Industry standard (Strava/AllTrails/Komoot pattern).

2. **Form UX polish**: Email/password focus states should NOT trigger validation on blur of empty fields. Validation fires only after first submit attempt. Error messages inline under field, compact and non-intrusive.

3. **User data isolation**: Sessions currently loaded from shared localStorage (all users see same data). Must wire `fetchSessions()` from backend API into `useSessionStore.hydrate()` — sessions fetched per JWT token = per user. On logout, clear local session cache.

4. **Splash animation uplift**: Current cairn-stone-stack animation lacks "hiking trail" soul. Needs: trail path drawing (SVG stroke animation), flag/banner plant at top of cairn with bounce, subtle particle dust on flag impact. Reference: premium outdoor app onboarding (summit flag moment).

**Status**: Approved — Sprint 39 execution target


---

## CR-Friend-System-v1 — Approved (Sprint 67 execution target)
**Date**: 2026-06-27
**Source**: User multi-round product decisions
**Plan**: `_research/friend-system/FINAL_PRODUCT_PLAN_v4.md` (v4.2 final)

Three-tier visibility model (Personal/Friend/Public), trusted-circle friend system, Memory 5-friend subscription with paywall, stranger Public mark icon-only display, Like/Report UI without API. Full plan in v4.md.

## CR-Deferred-RouteEditor-Story-519-520
**Status**: Moved to backlog (Sprint 66 deferred contents)
**Reason**: Sprint 67 dedicated to Friend System F1 per user /project --auto invocation
**Stories**: STORY-00519 (RouteEditor runtime integration), STORY-00520 (trim/midpoint-drag interaction)
**Action**: To be re-scheduled after Friend System v1 (F5) ships, likely Sprint 72+

