# Playwright 10 场景测试

**生成时间**: 2026-05-31T04:49:02.608Z
**通过**: 10/10

| ID | 场景 | 状态 | 用时 | 详情 |
|---|---|---|---|---|
| T01 | demo.html 加载 + 5 marker 渲染 | ✅ | 1164ms | {"cardCount":5} |
| T02 | 点击 1 次点赞 → likes +1 | ✅ | 535ms | {"likes":1} |
| T03 | 点击 5 次点赞 → 状态健康 | ✅ | 1016ms | {"likes":5,"status":"健康"} |
| T04 | 点击 5 次举报 → 状态降级 | ✅ | 1016ms | {"status":"心跳"} |
| T05 | 大量举报 → 进沉底 | ✅ | 1250ms | {"status":"沉底"} |
| T06 | +30 天 → 旧 likes 衰减 | ✅ | 1214ms | {"initialHeat":5,"finalHeat":1.8} |
| T07 | 重置 → likes/reports 清零 | ✅ | 552ms | {"likes":0} |
| T08 | 危险类 marker +30 天 → 自然 sunk | ✅ | 515ms | {"status":"沉底"} |
| T09 | cairn 类 +30 天 → 仍存活 | ✅ | 516ms | {"status":"边界"} |
| T10 | reset 然后多次 like → 计数累加 | ✅ | 750ms | {"likes":3} |

## 浏览器 console 错误

- console.error: Failed to load resource: the server responded with a status of 404 (File not found)

## 截图

每个场景一张, 保存在本目录下 `T*.png`.
