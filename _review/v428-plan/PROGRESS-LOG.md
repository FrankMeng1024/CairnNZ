# v428 Progress Log

**Version**: v428 (from v427)
**Date**: 2026-07-22
**Status**: Data pipeline complete, awaiting subagent round-2 verification + user approval for aliyun deploy

## Scope Recap (3 changes)

1. **全球城市高亮** — Mapbox fill+line layer 显示当前选中 region 真实 polygon 轮廓
2. **Memory hierarchy 4 bug 修** — 三态色, 点绿钻入, ↑ 不闪, legend 语义清
3. **Sim-walker debug 模式** — Settings 加 Switch, in-memory active state (关 app 归零)

## Timeline & Milestones

### Plan 阶段
- PLAN.md → PLAN-v2.md → PLAN-v3.md (三轮 4-eye review)
- 2 subagent (架构 + 产品) 独立审, 两轮 PASS_WITH_CHANGES
- 主 agent 综合 review 反馈,每轮 revise plan
- User 决策点: 层级 = ADM1 (city 级), 命名规则 = 只英文, 高亮策略 = 只高亮选中不加 mask, 数据源 = geoBoundaries + DataV + OSM + Natural Earth 4 家对比

### 数据准备
- geoBoundaries 全球 213 ADM0 metadata + 166 国 ADM1 (88.5MB simplified)
- DataV 阿里云 33 中国省 boundary polygon
- OSM Overpass 6 抽样城市 (限速)
- Natural Earth v427 已有 (9 大国 294 ADM1 + 全球 country polygons)

### 数据审查 (关键流程)
- `compare-sources.js` 4 源对比 → 147 一致 / 56 name_diff / 12 shape_diff / 2561 单源
- name-rules subagent 起草 43 ADM0 override + 12 后缀 + 29 例外 + 56 name_diff resolution
- decisions-worksheet subagent 68 条独立复核 → 47 agree + 12 disagree + 9 needs_human
- **抓到 3 类关键问题**:
  - 21 条印度州带 macron 未清 (subagent 抓)
  - 3 条 missing records (Moscow Oblast / Altai Krai / Washington DC)
  - 8 个环大湖州 land-only 一致性
- **第二轮 subagent 复核**又抓到 2 blocker:
  - India POLYGON EMPTY (gb 无 IND ADM0)
  - Moscow Oblast iso 错 (RU-MOS 是市不是州)
- 主 agent 全修:
  - Manual add India from NE `countries.geojson`
  - iso_3166_2 RU-MOS → RU-MOW (真州 5°×2.7°)
  - Great Lakes 8 州 turf 面积对比确认 gb 是 land-only 正确
  - World / Continent 全部 POLYGON EMPTY (per user "不高亮" 决定)

### 最终 SQL
- 2847 rows: 1 world + 7 continent + 213 country + 2626 ADM1
- 162.5 MB, gzip 后估 ~20MB
- 全 UTF-8, 无 macron 残留, 命名统一

## Code changes

### Backend
- `backend/src/routes/hierarchy.js`:
  - `/deepest` 加 ST_Contains + bbox fallback
  - `/panel` sibling counting 用 spatial JOIN + bbox fallback
  - `/panel` here_count 用 spatial + bbox fallback
  - 新增 `/polygon/:region_id` endpoint, ST_AsGeoJSON + gzip cache 24h
- `backend/scripts/seed-geoboundaries/` (新目录):
  - `download.js` — geoBoundaries API 下载
  - `download-datav.js` — DataV 阿里云中国省下载
  - `download-osm.js` — OSM Overpass 抽样
  - `compare-sources.js` — 4 源对比
  - `decisions-worksheet.js` — 决策清单生成
  - `audit-names.py` — 名字审计工具
  - `seed.js` — 主 seed 脚本 (macron strip / 3 missing add / manual IND / continent empty)
  - `deploy-seed.sh` — 阿里云一键部署
  - `cleanup-post-seed.sh` — 入库后清理临时文件

### Client
- `app/src/features/memory/components/HighlightRegionLayer.tsx` (新) — Mapbox 高亮 layer
- `app/src/features/memory/components/MemoryMap.tsx` — 挂 HighlightRegionLayer, 加 highlightRegionId prop
- `app/src/features/memory/screens/MemoryScreen.tsx` — 传 highlightRegionId, 加 hierarchyDrill state
- `app/src/features/memory/services/hierarchyService.ts` — 加 fetchPolygon, normalize v427 兼容, cache v2 key
- `app/src/features/memory/components/HierarchyPanel.tsx` — 三态 legend "Marked/Walked/Never", testID, empty banner, stale opacity, 长名字 adjustsFontSizeToFit
- `app/src/features/memory/config/highlightLayerIds.ts` (新) — HL_SOURCE_ID / HL_FILL_LAYER_ID / HL_LINE_LAYER_ID 常量
- `app/src/dev/simWalker/useSimWalkerStore.ts` (新) — in-memory Zustand store (active + position, no persist)
- `app/src/utils/devFlags.ts` — 移除 isSimMode env-var gate
- `app/src/screens/HikingScreen.tsx` — 挂载 gate 改为 debugMode && simWalkerActive
- `app/src/screens/SettingsScreen.tsx` — 加 Sim walker Switch + "Off on next app launch." sub-copy

## Review docs

- `_review/v428-plan/PLAN.md` / `PLAN-v2.md` / `PLAN-v3.md`
- `_review/v428-plan/compare-report.md` / `.json`
- `_review/v428-plan/name-rules.json` / `name-rules-notes.md`
- `_review/v428-plan/decisions.md` / `.json`
- `_review/v428-plan/decisions-reviewed.json` (subagent 独立复核)
- `_review/v428-plan/audit-fix-verification.md` (fix 后独立复核)
- `_review/v428-plan/v428-playwright-checks.md` (Playwright 测试清单)
- `_review/v428-plan/city-overrides-draft.json` (100 城市 override 草稿, subagent 起草)
- `docs/runbook-v428-rollback.md` (回退剧本)

## Remaining steps (等 subagent + user approval)

1. Subagent round-2 verification PASS
2. User approve deploy-seed.sh 上传阿里云
3. Backend docker restart 加载 v428 code
4. Playwright web 5 城市高亮抽测
5. 3-subagent OTA gate 独立审 (backend / client / integration)
6. OTA push: OTA_VERSION 427 → 428, commit, push, eas update
7. 清理 tmp/ 188MB + regions-v428.sql 162MB (aliyun 上下都清)

## Known limitations (v428 已知, R2 补)

- **纽约市 / 悉尼 / 洛杉矶** 没单独 polygon (metro 由多 county 组成, geoBoundaries 无对应 ADM 单元) — 用户点 NYC → 显示 "New York" 州, 高亮全州 (含 upstate). R2 会用自定义 union polygon 补
- **英格兰用户** 面板显示 "England" 而非 "London". R2 若从 OSM 大伦敦 polygon 补 override, 可精化
- **OSM 抽样** 只拿到 6 城市, 其余 20 被限速 — 不阻塞 v428, 后续对比再补
- **2561 单源** ADM1 只有 gb 数据, 无第 2 源可对比 (US Great Lakes 8 州 turf 抽查过 gb 是 land-only 无问题, 其他国家未逐个对比)
