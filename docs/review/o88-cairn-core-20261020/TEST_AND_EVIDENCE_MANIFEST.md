# Test and evidence manifest

## Automated verification

| Evidence | Result | Classification |
|---|---|---|
| Backend Node test corpus | 173/173 pass | production-code tests |
| `cd app && npm run verify:changed` | 662/662 pass | required scoped Activity regression gate |
| Focused Cairn/Plant/store Jest suites | 48/48 pass across 6 suites | production-code tests |
| Disposable MySQL 8/API acquisition replay | 30/30 pass; migrations 050–054 | isolated backend verified |
| Shanghai plan validation | 60 unique notes; 34/26; 14/18/14/14; manifest SHA stable | source/tool verified, not applied |
| Shanghai disposable lifecycle rehearsal | plan, apply 60, verify 60, advance 2, cleanup 60, verify 0 live: all pass | isolated MySQL verified; not field/production |
| Production fixture guard | rejected without explicit gate/Owner token | safety interlock verified |

Exact logs in the packaged review:

- `evidence/backend-tests.log`
- `evidence/app-verify-changed.log`
- `evidence/app-focused-tests.log`
- `evidence/mysql/cairn-memory-result.json`
- `evidence/mysql/backend.log`
- `evidence/mysql/harness-run.log`
- `evidence/shanghai-plan.json`
- `evidence/shanghai-rehearsal/01-plan.json` through `06-verify-cleaned.json`, plus `SUMMARY.json`

The rehearsal also made two expected fail-closed stops before the passing run: creators not classified `isolated_qa`, then Friends authors without bilateral friendship episodes. The disposable setup was corrected; neither product authorization check was weakened.

## Actual rendered evidence

Thirteen full-resolution Expo Web screenshots cover Only me/Friends/Public create, persisted success, owner Public detail, add-version, withdraw/delete consequence, I left, I found, retained latest detail, Memory encounter, and 360/430 Night/Sunset layout. A 390×844 interaction recording covers the main flow.

Provenance: actual application routes/components at the O88 candidate source, Chromium/Expo Web, isolated QA HTTP responses and normal client stores/outbox, no production data. Public capability is an isolated eligible fixture. Location is a disclosed native-shaped QA observation, not a claim that Web GPS proves physical arrival. The map provider token was absent, so the real fallback is visible.

O87 “before” images in the package come from the prior independent AS-IS audit at base `79b99a2…`; they remain labeled Web/QA and are not native evidence.

## Acceptance status

| Domain | Status | Notes |
|---|---|---|
| Plant visual system, semantic audiences, persisted success | PASS — WEB + TEST | native keyboard/Dynamic Type pending |
| Hike Plant identity/freshness adapter | PASS — SOURCE + TEST | merge with concurrent main and native resume telemetry pending |
| Run Plant | OWNER DECISION NEEDED | existing private empty quick action retained |
| Read/edit/version/delete consequences | PASS — WEB + MYSQL/TEST | native long-text/accessibility pending |
| Memory clustering 20/60/100 | PASS — UNIT/SERVER; MAPBOX PENDING | real Mapbox/Fog/native rendering not captured |
| Encounter Open/Later/update/dedupe | PASS — WEB + TEST + MYSQL | native haptic/frame rate pending |
| Legacy Friends API authorization | PASS — BACKEND TEST | deployment not performed |
| Placement provenance | PASS — CLIENT/BACKEND TEST | spoof resistance is not claimed |
| Notification consent/enqueue/deep-link logic | PASS — TEST | installed-iPhone delivery/background acquisition pending |
| Shanghai fixture tool/isolation/TTL | PASS — SOURCE/PLAN/TEST | field safety, Mapbox, same-backend apply all pending |
| Production seed/deploy/OTA | NOT DONE | prohibited without Owner approval |

## Secret/privacy review

The delivery manifest includes source, screenshots using fictional QA content, and sanitized logs only. It excludes `.env`, database credentials, tokens, signing material, browser profiles, real user records, and raw personal GPS tracks. Candidate fixture coordinates are QA synthetic/candidate points, not user traces; exact points should remain operator-controlled and must not be treated as field-approved.
