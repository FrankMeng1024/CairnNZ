# O94 测试结果

## PASS

| Gate | Fresh result |
|---|---:|
| O94 + Memory/Friends/Route/i18n focused | 144 / 144 |
| Additional Fog continuity/preparation/readiness | 34 / 34 |
| Relevant focused total | 178 / 178 |
| `verify:route` | 101 / 101 |
| O94 marker | 2 / 2 |
| Text catalog checker | PASS: 2540 entries, en-NZ 2540 complete, zero checker errors |
| iOS production JS export | PASS: 4255 modules, HBC SHA-256 `0d688803fef7de5f76cc502773c75e70c8aef7b5ab7f00990c0187ff1ce99364` |
| Candidate fingerprint | `eb6dc08fdfcc06f8084ea852406fd41d1df3169f`, exact O93 candidate match |

`verify:changed` 对精确产品 diff 的 Activity CORE 运行结果为 659 / 659 PASS；最终 clean marker candidate 再运行时无 Activity-impact rule，命令 PASS 但没有重复整组。

## Full verification — FAIL

一次新鲜 `verify:full`：**2870 PASS / 4 FAIL / 7 SKIP**。SKIP 未计为 PASS。

1. Raw GPS input-to-decision max 136.740 ms，冻结预算 `<120 ms`。
2. 10k Memory `tile_geometry` max 289 ms，冻结预算 `<150 ms`。同一未改 fixture 的隔离复测 PASS，max 112 ms、tile max 93 ms，但原失败保留。
3. Activity journal projection max 196 ms，预算 `<120 ms`。
4. Route scene status 在整套运行中超时未出现；同一测试隔离复测 1/1 PASS，最终 Route screen focused suite也 PASS。

O94 没有改变 Raw GPS、Activity journal 或 Memory geometry pipeline；没有提高阈值、缩小 fixture、删除/skip 测试或把偶发绿结果覆盖红结果。机器在并行测试时负载较高只能说明测量受调度影响的可能性，不能证明三个 performance failure 不存在。Raw GPS/Activity 性能风险继续开放。

## TypeScript

全仓 typecheck 仍有 O93 既有债务：Playwright types、observationId、Turf declaration、preview navigation unknown、diagnostic never 等。O94 touched/new files scoped check无新增错误；不能声称全仓 TypeScript PASS。

## Visual QA

- 本地真实生产组件 + Mapbox GL renderer，390 × 844。
- 15 camera gestures 后 snapshot request delta 0，loader 0 次。
- Day/Sunset/Night 三类 fill 均有 rendered features 和原始截图。
- Beijing Friends-only 目的点位于可见授权 geometry。
- Cairns/scope 40/40 且对齐。
- Memory location puck 可见；Route Web puck 未挂载，见 `ROUTE_LOCATION_MARKER.md`。
- `HOSTED_MAPBOX_STANDARD: NOT RUN`。
- `NATIVE_IPHONE: PENDING`。

## 未执行的发布动作

Backend deploy、native build、Android OTA、TestFlight、App Store、production DB write、Git push：均未执行。
