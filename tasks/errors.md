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

## 2026-07-06 — github.com push blocked (Sprint 72 close)
- `git push origin master` failed twice: `Failed to connect to github.com port 443` after 21s.
- Local commits `c62e7a8` (backend) + `12dc53c` (v403 Sprint 72) are safe locally.
- OTA v403 published via EAS successfully (aliyun/expo servers reachable).
- Backend files already deployed via scp+docker cp (aliyun reachable).
- Retry pending; git push scheduled to retry at next commit trigger point.

## 2026-07-06 — v406 web test hook 待清理 (production release blocker)

**位置**:
- `app/App.tsx` — `__cairnStores` global exposure (Platform.OS==='web' guard)
- `app/src/navigation/RootNavigator.tsx` — `navigationRef` + `getCurrentRoute` exposure

**性质**: 测试后门。让 Playwright web 能直接操作 Zustand stores + navigation,不必模拟真实 UI 交互。native 侧 tree-shake 掉不影响 iOS/Android 行为。

**保留原因**: v405 replay session 191 全靠这套 hook 才能自动验证 (memory push / snap / auto-nav / back stack)。未来同类回归可复用。

**上线前必删**: production public release 之前把这两块代码删除,防止:
- Web 版本被第三方 injectscript 攻击 stores
- `__cairnStores` 名字被搜索引擎索引成 API 表面

**删除 checklist** (release-day):
1. `app/App.tsx` 里 v405 web hook 注释块整段删
2. `app/src/navigation/RootNavigator.tsx` 里 `navigationRef` export + `onReady` 里 web hook 分支删 (createNavigationContainerRef import 也删)
3. jest test 里若引用了 `globalThis.__cairnStores` 一并清
4. 搜 `__cairnStores` 全 repo 应 0 命中才算清完

## 2026-07-07 v408 git push 失败 (EAS 已发)
- Commit 897d009 (v408 telemetryWifiOnly hotfix)
- git push origin master → github.com:443 timeout (企业网络间歇)
- EAS Update 已 published (Update group d9eafbd1-2c43-4210-aa2b-a82114d254f1)
- 下次 commit 前重推,commit 会 accumulate
