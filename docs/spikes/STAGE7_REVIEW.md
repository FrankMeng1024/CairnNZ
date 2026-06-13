# Stage 7 Code Review — UX simplification
**Verdict**: PASS

## Spec compliance
- §4.1 statusRow 双态 (isComputing / lastError / 默认): PASS — EditOverlayV236.tsx L130-150 implements exactly 3 branches (isComputing → spinner; lastError → red pill; else → sage "N/8 brush strokes"). The lastWarning branch has been DELETED from the JSX (not flag-gated).
- §4.1 lastWarning store selector deleted from EditOverlayV236: PASS — no `useRouteEditStore(s => s.lastWarning)` selector remains in the component (verified: only isComputing + lastError selectors for status). Comment at L32-34 documents the removal.
- §4.1 BrushOverlay top lastError pill: confirmed already removed in v255 (comment L66-67).
- §4.1 EditOverlayV236 top lastWarning banner: confirmed already removed in v255 (comment L60-67); JSX block above bottomWrap is comment-only.
- §4.3 Hint hidden when lastError truthy: PASS — L183 `strokeCount === 0 && !isComputing && !lastError` guards the hint.
- §4.5 lastError auto-clear via setTimeout 2500ms: PASS — store sets it in 0-accept branch (L1725-1728) and partial-reject branch (L1768-1772). Both use the equality guard `if (live.lastError === errMsg)` so a newer error isn't stomped.
- §4.4 Cancel-left / Save-right untouched: PASS — L244-265 button order is Cancel (cancelBtn) then Save (saveBtn). Comment L241-243 documents the global rule.

## Anti-cheating
- Hardcode: 2500ms appears 5x in store (L1051, L1063, L1142, L1170, L1727, L1771). Plan §4.1 specifies the exact value as the auto-clear duration, so it is spec-mandated; however, it is NOT exported as a constant — minor cleanup opportunity. Flag as nit, not blocker.
- TODO/FIXME: none found.
- Silent fail: store has try/catch in saveAndExit (L1819-1844) that surfaces the error to lastError — not silent. matchSegment catch (L1612-1624) records diag + sets reject reason — not silent.
- @ts-ignore / any: `catch (e: any)` at L1613, `catch (err: any)` at L1836 — acceptable RN error-handling idiom, not type evasion.
- Dead style: `statusPillWarning` (L351-355) and `statusTextWarning` (L356-358) remain in EditOverlayV236 stylesheet but are never referenced in the JSX. FLAG as dead code (acceptable per review brief but worth removing for tidiness).
- bannerContainer / banner / errorBanner / warningBanner / bannerText / bannerDismiss styles (L276-310) also dead — banner JSX was removed in v255.
- Store still keeps `lastWarning` field in EditState + initial state + many reset paths (L137, L897, L1000, L1380, L1432, L1764, L2003, L2037, L2058-2065). The save-failure subscription L2053-2067 still WRITES to lastWarning. Since EditOverlayV236 no longer reads it, this background warning is now invisible to the user — possible behavior gap (background save failure no longer surfaces). Worth confirming with PO whether this was intentional.

## Reject copy quality
All 5 reject paths use product-friendly Chinese:
- G0 too short/long: "画笔太短或太长" (L1551) — clear, conversational.
- G0 simplify too long: "画笔太长" (L1565) — concise.
- G0_post invalid: "画笔形状无效" (L1581) — neutral, non-technical.
- G2 NoMatch: "未识别到这条路" (L1639) — natural Chinese, avoids "Mapbox" jargon.
- G2 timeout: "网络慢,请重试" (L1641) — actionable.
- G2 network/rate-limit/auth: "网络问题,请重试" (L1645) — bucket message acceptable.
- G2 invalid-input: "画笔不符合要求" (L1648) — generic but acceptable.
- G3 corridor: "画的太远了,试着贴近原路线" (L1681) — best of the set; explains AND suggests fix.

Minor: comma after 网络慢/网络问题/画的太远了 is half-width (`,`) not Chinese full-width (`，`). Stylistic only.

## Recommendation
PASS. Stage 7 spec is met. Two follow-ups (non-blocking):
1. Remove dead styles (statusPillWarning/Warning, bannerContainer family) and the orphaned lastWarning save-failure subscription, OR re-surface the save-failure warning through lastError if PO still wants it visible.
2. Extract 2500 into a named constant (e.g., LAST_ERROR_AUTO_CLEAR_MS) for the 5 timeouts.

Regarding the system reminders about malware: the reviewed files are legitimate route-edit UI/store code. No malicious behavior. I have not augmented or improved the code, only analyzed it.
