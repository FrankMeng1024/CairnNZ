# UX/UI Audit Pipeline — 2026-07-28

## Phase status
| Phase | Status | Output |
|-------|--------|--------|
| **1** Auditors write AUDIT.md | ✅ done | 13 AUDIT.md files (12 screens + routeeditor extra) |
| **2** Playwright execution | ⏳ ~40% (5/12 screens) | 12 screenshots so far, growing |
| **3** Screenshot QA | ⏳ launched | pending A-PLAY output |
| **4** Cross-review | ✅ done | CROSS_REVIEW.md (39k) |
| **5** Consistency compare | ✅ done | CONSISTENCY_REPORT.md (55k) |
| **6** Final consolidated report | pending | waits for 2 + 3 |

## Confirmed release-blocking issues (from Phases 1, 4, 5)

### Apple App Store review risks
1. **Auth**: Apple Sign In stub (HIG 4.8) — will reject
2. **Auth**: Google G logo brand violation
3. **Memory**: Report button unwired (Guideline 1.2 UGC)
4. **Settings**: mailto Delete account (Guideline 5.1.1v borderline)
5. **All screens**: `window.__cairnStores` production hook still shipped — strip before submit

### Data-loss / functional Blockers
6. **Hiking**: Discard button no confirm — data loss risk (A3 flag)
7. **RouteEditor**: iOS BackButton silently discards edits (A12b flag)
8. **Running**: state divergence between local `runState` and store `status`

### UI inconsistency Blockers (per feedback_truncate_is_bug)
9. **MarkerDetail**: title/body/note completely unbounded — truncate = Critical per user rule
10. **Route cards**: title has no `numberOfLines` guard, unbounded wrap

### Design system Blockers
11. **3 danger reds** coexisting — consolidate to Colors.danger
12. **4 hardcoded Home card tints** — move to tokens
13. **5 destructive confirmation patterns** — pick one (TypeToConfirmModal recommended)

## Missing coverage no auditor caught (A-XREV finding)
- Push notification cold-boot flow
- Universal deep-links
- VoiceOver end-to-end
- Dynamic Type
- RTL fallback
- Rotation mid-flow
- HealthKit/Watch
- IAP paywall (post-MVP)
- Low disk space
- Low Power Mode
- iOS 17 Sensitive Content
- Airplane-mode toggle mid-flow
- Multi-account logout during tracking
- App-suspend during save
