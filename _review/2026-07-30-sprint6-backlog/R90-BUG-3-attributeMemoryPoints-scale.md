# R90 BUG-3: attributeMemoryPoints O(N) 全量重算 scale 问题

**日期**: 2026-07-30
**Severity**: MEDIUM(latency growth,非 correctness bug)
**Status**: Deferred — 需要 schema 变更 + 专门讨论

## 现状

`backend/src/lib/attributeMemoryPoints.js` 每次 sessions.js /save
或 memory.js POST /points 调用时:

1. 找到本批新点所在的所有 level=3 城市(spatial index 快)
2. **对每个受影响城市,重新 SELECT COUNT(*) 该 user 所有历史
   memory_points 中落在该 city 的**(ST_Contains scan)
3. 对每个受影响 country 做同样的全量聚合

问题:步骤 2 是 O(N × K),其中 N = user 累积 memory_points 总数,
K = 本批影响的城市数。用户走的越久,每次 save 越慢。

## 为什么现在不改

全量重算是**幂等性的来源**:客户端重试同一批 → 计数不会翻倍。
改成增量(`point_count = point_count + delta`)会失去这个保证:

- 并发 save 场景:A 和 B 时间范围重叠 → 都 count 到重叠段,delta 相加超实际
- 客户端上传老数据(补传):tsRange 覆盖已 count 过的点,delta 又加一次

要保持增量的正确性,需要 schema 变更:
- 加 `memory_points_regions` 关联表 (mp_id, region_id UNIQUE)
- 每个 memory_points 行只归属一次
- point_count 直接 `SELECT COUNT(*) FROM memory_points_regions WHERE region_id = ? AND user_id = ?`(索引扫,不用 ST_Contains)

## 触发条件

活跃用户 memory_points 累积到 ~50k+ 之后,每次 save
attribute 部分从 <100ms 慢到几秒。当前测试用户量还没到临界点,
所以生产没爆。

## 后续 Sprint 处理

- Sprint 7 或专门迁移 Sprint 里做
- 需要:schema migration + backfill 脚本 + attributeMemoryPoints 重写 + 回归测试
- 估计 3-5 天工作量
