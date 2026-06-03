# Arch Code Review — Sprint 28

**Verdict**: PASS
**Reviewer**: Arch subagent (claude-opus-4-6)
**Sprint**: 28
**Stories**: STORY-00080, STORY-00081, STORY-00082, STORY-00083, STORY-00084

## Issues

| Severity | Description | Story |
|---|---|---|
| Medium | STORY-00082: Named route gradient and routeCardSelected background still contain hardcoded `rgba(61,122,181,...)` blue values — should be tokenized in a follow-up Sprint. Non-blocking. | STORY-00082 |
| Medium | STORY-00084: downloadBtn opacity at 0.85 deviates from 0.95 overlay standard. Intentional (map-overlay control needs more contrast against varied tile backgrounds). Documented in Story Notes. | STORY-00084 |

## Spec Drift Confirmed Fixed

- ✅ `.replace()` string manipulation for color opacity removed from HikingScreen, HomeScreen, FriendsScreen — replaced with named tokens
- ✅ Hardcoded `'#5a4fcf'` night mode color replaced with `Colors.night` token
- ✅ Overlay surfaces standardized toward 0.95 opacity (trackBtn, trackStatBar, tabBar)
- ✅ trackingBar elevated card uses `Colors.surface` (opaque) — correct classification

## Notes

All Sprint 28 changes are pure token substitution and minor style adjustments. No API contract changes. No logic errors. No security issues. No new dependencies.
