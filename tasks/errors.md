2026-05-16 Sprint 36 planning commit: push failed (ERR: Could not connect to server github.com:443). Retry at next trigger point.
2026-05-16T04:41:34Z — git push origin master failed: Recv failure: Connection was aborted. 3 commits pending: fix(auth) hydrated flag, test(sprint35) AC8+AC9 evidence, feat(sprint36) planning.
2026-05-30T07:25:53Z v119 commit 4d0b0b6 git push to GitHub failed (Recv failure: Connection was aborted) — OTA already shipped, will retry next session
2026-05-31T12:55:14+08:00 push failed: github.com:443 timeout. commit 2b5f74d staged for next push trigger.

## 2026-06-06 — git push to origin/master failed (network)

After commit ee21997 (5-round AR audit fix), git push origin master failed:
```
fatal: unable to access 'https://github.com/FrankMeng1024/CairnNZ.git/':
Recv failure: Connection was aborted (and on retry: Failed to connect to
github.com port 443 after 21281 ms)
```

curl probe: github.com and google.com both unreachable (HTTP 000, timeout
> 15s). Outbound network down on this machine — likely VPN/proxy issue,
not GitHub-side.

Local state: clean. Branch master is 4 commits ahead of origin/master.
- ee21997 fix(unity-ar): 5-round audit — IL2CPP + lifecycle + diag + ARKit loader
- 6d25cc0 diag(ar): throttle parser-recovered + camera-perm log + ota bundle id (OTA #183)
- a669a65 fix(ar): camera gate + parser robustness + diagnostic breadcrumbs (OTA #182)
- 0f1c2d8 fix(podfile): exact-match anchor in insertAfterAnchor

Action: retry push when network restored. Commits intact, no data loss.
DO NOT discard the commits.
[2026-06-24] git push origin master failed: GitHub secret scanning rejected
  _review/fog_research_2026-06-21/results.md:229 has secret (commit not from this session — historical)
  6 commits unpushed including 58954ab (v311 OTA).
  OTA已经成功推送 (eas update production channel 完成).
  Resolution path: scrub secret from history OR unblock via GitHub link in error message.

## 2026-06-25 — git push blocked by GitHub secret scanning
- Commit 8348cbc (v300) contains _review/fog_research_2026-06-21/results.md:229 with a third-party Mapbox token scraped from a public CSDN blog
- Not our secret, but GitHub secret scanning blocks the push
- Local commits: 24 ahead of origin/master (up to b9fd191 v329)
- OTA v329 published successfully to EAS (production branch)
- Resolution options: (a) user unblocks via https://github.com/FrankMeng1024/CairnNZ/security/secret-scanning/unblock-secret/3FcVx5gbQozl3iAaO7KLkH4Fmop  (b) rewrite history to scrub line 229 from commit 8348cbc onward
- Per §Git Strategy: commit is the guarantee, push retries at next trigger point; will accumulate
