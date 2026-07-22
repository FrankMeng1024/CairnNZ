# OTA Gate #1 — Backend Review

## Verdict
PASS_WITH_MINOR

## Critical (block OTA)
None. Code is production-safe given生产已验证 (2847 rows, 5城 point-in-polygon 通, 3 endpoint 实测正确).

## Concerns (fix post-OTA)

1. **`/panel` spatial 查询无 LIMIT，大 sibling 集会慢**
   hierarchy.js:210-217 `INNER JOIN regions s ON s.id IN (...) AND ST_Contains(s.geom, ...)` 对 `memory_points p` 全表笛卡尔。当 user 点数 >数千 + siblings 是 33 中国省时,单条 query 会扫 points × 33 次 spatial contains. 无索引覆盖 (spatial idx 在 s.geom, 但 join 顺序取决于 optimizer). 建议:先按 bbox 粗筛 (`p.lng BETWEEN s.bbox_min_lng AND s.bbox_max_lng AND p.lat BETWEEN ...`) 再 ST_Contains 精筛. 当前用户 916 只有 ~100 点没暴露, 但 100+ 点用户会显现.

2. **`/polygon/:id` gzip + nginx**
   express 默认无 gzip. Cache-Control `public, max-age=86400` 生效 (nginx 通常 pass-through Cache-Control 除非显式重写). 但 `regions-v428.sql` 300MB 提示单个 polygon (e.g. Russia MultiPolygon) 可能几 MB, response 未压缩. 需确认 nginx 前端 `gzip on; gzip_types application/json;` 否则首次 fetch 用户流量爆炸. Cache 生效后 CDN/浏览器 24h 缓解.

3. **spatial fallback 正则过宽**
   hierarchy.js:78, 225, 302 `/Unknown column|ST_IsEmpty|ST_Contains/` 会吞掉 ST_Contains 的**任何** error, 包括 SRID mismatch 或 geom 数据损坏. 生产已入库 OK, 但未来 seed 更新如有坏 row, error 会被静默吞下 fallback 到 bbox heuristic, QA 抓不到. 建议改为 `err.code === 'ER_BAD_FIELD_ERROR'` 精确匹配.

4. **seed.js clamp 精度损失**
   line 519-520 `c[0] <= -180 → -179.9999` 会把太平洋边界岛屿 (Fiji 部分岛在 lng=-180 附近) 略微内缩 ~10m, 无实际影响.

5. **`/deepest` no-match 返回 world**
   line 93-96 bbox fallback 无 candidate 时直接返 world. 极地/远洋点合理, 但也意味 spatial ST_Contains 全空 + bbox 全空 → 用户看到 "World" 面板. 可接受.

6. **v427 client 兼容**
   backend 保留 `explored_here` / `here_point_count` / `explored_count` legacy 字段 (line 358-368) 同时新增 `marked_count` / `here_state`. v427 client 打 v428 backend 应无破坏.

7. **中国 33 省覆盖**
   DATAV_ADCODE_TO_NAME 硬编码 33 条 (含 HK/Macao,不含 Taiwan). Taiwan (710000) 缺失是明确选择 (NZ App Store 政治敏感), 但生产 SELECT 会导致 lng 121.5, lat 25 (Taipei) point-in-polygon 命中 CHN level=2 而非 TW/CN-taiwan level=3. 已知 gap.

8. **SQL injection**
   全部 `?` 参数化, `sibIds` 用 `idPlaceholders = sibIds.map(() => '?').join(',')` 也参数化, 安全. `escSql` 只用在 seed.js SQL 生成(离线), 非 runtime.

## Recommend proceed?
yes

Concerns 1-3 是性能/健壮性, 非正确性. 生产 API 已实测通过, v427 client 兼容字段完整. OTA 推送可行, concerns 进 backlog Sprint N+1 修.
