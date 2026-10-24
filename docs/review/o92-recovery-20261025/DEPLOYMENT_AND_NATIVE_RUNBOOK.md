# 后续 deployment / OTA / native 验收准备（本任务未执行）

## 当前硬停止

`PUSH / PRODUCTION DEPLOY / PRODUCTION WRITE / BUILD / PREBUILD / OTA = NOT DONE`。Home O marker 保持 O92；App 0.2.6 与 runtime policy 未改。Japanese selection 不得作为发布语言启用。

## 独立 Pro review

1. 核对六个 commits A–F、`733fd74..final` patch、SHA-256 manifest、dirty/clean receipt。
2. 复跑 `cd app && npm run verify:changed`、`npm run check:text`，以及 backend snapshot tests。
3. 查看 real disposable MySQL result，确认 9 pages/totals/revision/revoke/old-client compatibility；不要把 synthetic data 当 production data。
4. 对同 camera 的 U/O/Fog/Back/Library Web证据做源码关联，但保持 native pending。

## 若未来批准 backend deployment

严格按 `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`。先确认部署 source SHA、现行 backend SHA/ledger、兼容旧 O92 endpoints；本候选是 additive routes，无破坏性 endpoint replacement。部署后只做授权 read-only smoke：empty、Mine manifest/page、Friend grant、revision change/revoke；不得创建生产 fixtures或改变 Owner consent。发现错误时回滚 backend code 到部署前 SHA；无 schema migration 时不得伪造 migration rollback。

## Owner 最小 native checks

仅覆盖本地无法取得的证据，不要求新 outdoor walk：

1. Build 65 compatible candidate 中用现有 Activity/Route 的只读 clone：normal Create、`bad` clone、saved Route；只观察 loading-map-only 是否进入，并完成 Draw→Point/NoSegment recovery→Trim→Undo→Save/reopen。
2. 已有 Mine/Friends：最后取消（可模拟网络离线）应立即 Mine；快速 reselect；Recenter/city/pan 不闪 Memory loader、不丢已加载 regions。
3. Cairn preview 背景、Back baseline/safe area、Library icon+label+badge、Friends row flicker、Fog palette、Mapbox logo/attribution位置。
4. U/O overview/z18/高 zoom 与断开/平行负例；只验 display，source Activity/route geometry 不应改变。
5. en-NZ/ja QA override/pseudo 与大字：locale change 保留 Route draft、Friends selection、camera；不要判断 ja 文案发布质量。

## 若未来批准 client release

- 先合并/部署必要 backend additive API，再做真实授权 snapshot smoke；否则 M11 production 仍是 release blocker。
- human 决定是否增 O marker；本调查/实现没有增量。不得复用先前 OTA 权限。
- Native permission plist/plugin copy 当前与目录 8 项 MATCH；未来改这些文案需要批准的新 binary build，不能靠 OTA 声称已应用。
- 只有 Pro review + backend deployed/verified + minimal native checks +明确 release authority 都满足后，才准备 OTA；本文件不授予该权限。

## 自动诊断政策

现有 ingest/read-only retrieval contract 已在隔离环境验证；事件包含 request ID、operation stage、selection/auth/dataset revisions、expected/received pages、timings、failure class 和 renderer callbacks，不含 precise coordinates。Owner production QA enrollment/readability 在现有材料中为 `UNKNOWN/PENDING`；需要未来按现行一键 policy由授权方确认，禁止管理员替 Owner 开 consent，也不要求手工导出每次 incident。

