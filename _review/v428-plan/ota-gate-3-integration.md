# OTA Gate #3 — Integration Review

## Verdict
**PASS_WITH_MINOR** — 可推 OTA,但有 1 个 active production issue 应立即推 OTA 收敛。

## Critical (block OTA)
无 hard blocker。但需注意:

**⚠️ ACTIVE PRODUCTION ISSUE (backend 已部署导致):**
v428 backend 现已在生产,siblings 返 `state: 'marked'|'walked'|'locked'`,不再返 `'explored'`。生产 v427 client `HierarchyPanel.tsx:103` filter `s.state === 'explored'` — 现在每个 v427 用户打开 Memory panel 只看到 [here] row,其余 siblings 全部消失(不 crash,但功能空)。**explored_count 仍在 payload,summary 文字 "N visited · M unvisited" 正常**。这已经在生产发生;推 OTA 越快越好,越晚每个活跃用户看到损坏 UI 越久。

## Concerns

1. **v427→v428 client AsyncStorage cache 兼容 — PASS**: `PANEL_CACHE_VERSION='v2'` + `POLYGON_CACHE_VERSION='v2'` 前缀,v1 key dormant 让其 expire,不 crash。`normalizeSibling` 处理 v427 `'explored'` fallback。**不会** crash 或错读。

2. **Boot performance — PASS**: `fetchPolygon` 在 `HighlightRegionLayer` 内 useEffect,仅 panel 打开 + 有 regionId 时触发。不 block Memory tab 首屏 mount。24h AsyncStorage cache 覆盖后续。

3. **Bundle size — LOW RISK**: SimWalkerOverlay 顶层 import (line 45 HikingScreen),`__DEV__` 只 DCE render 分支,不 DCE import chain。sim-walker 全套 (gpsInjector+routePlanner+store+overlay) **27KB 源码** 进 production bundle。gzip 后估 ~8-10KB — 可接受但非零。R2 建议改 dynamic import。HighlightRegionLayer + hierarchyService 新代码 ~7.5KB 源码,gzip ~2-3KB,可忽略。

4. **回退剧本 — PASS_WITH_MINOR**: `backend/scripts/seed-hierarchy/regions.sql` 存在于本地 + git tracked,rollback step 1b 可执行。**但** runbook 未指明:aliyun 侧 v428 部署前是否已把这个 regions.sql copy 到 `/var/www/cairn-backend/`?若 seed-geoboundaries deploy 覆盖了 backend repo 里的 v427 file,rollback checkout 需要 clean state。建议 runbook 加 `git status` 前置检查步骤,并明确 `regions_v428_backup` **RENAME** 后要 `CREATE TABLE regions` 再 mysql import(现在是 `DROP TABLE IF EXISTS regions_v428_backup; RENAME TABLE regions TO regions_v428_backup;` — 之后 `mysql < regions-v427.sql`,必须靠 v427 sql 自带 CREATE TABLE)。

5. **提交 / OTA 顺序 — SAFE**: backend 已先部署 v428 → 当前生产 v427 client 已经和 v428 backend 混跑 (issue #1)。commit → push → `npx eas update` 让 client 追平即可。**无 forward-race**:v428 client 上线后 backend 已就位;**backward-race 已发生**(v427 客户端 vs v428 后端)。建议加急推。

6. **cleanup-post-seed.sh — SAFE**: 只删 `backend/scripts/seed-geoboundaries/tmp/`, `regions-v428.sql[.gz]`, `audit-output.txt`。**不动** `_review/v428-plan/*` (name-rules.json / decisions-reviewed.json 安全) 和 `*.js/*.py/*.sh`。Aliyun 侧只清 `/tmp/regions-v428.sql*`,不动数据库。幂等安全。

7. **OTA_VERSION**: 仍为 427,需在推前改为 428 (`app/src/components/OtaBadge.tsx:33`)。

## Recommend proceed?

**YES — 加急推 OTA。** 
- Backend 已 v428 → v427 client panel siblings 空,每分钟都在损害用户体验
- Rollback 剧本 executable,数据 v427 seed 本地有,回退 3-5min 可行
- normalizeSibling 已给未来 fallback 兜底
- Cleanup 脚本安全,不误删

**推之前 checklist**:
1. `OtaBadge.tsx` OTA_VERSION 427 → 428
2. Runbook 补 `regions_v428_backup` RENAME 后需 v427 sql 自带 CREATE TABLE 的注释
3. `git add` 7 modified + 4 new,commit `v428: 3-in-1 (city polygon highlight + hierarchy 3-state + sim walker)`
4. push → `npx eas update --branch production --message "v428"` → 看 "Published!"
5. 24h 后跑 `bash backend/scripts/seed-geoboundaries/cleanup-post-seed.sh`
