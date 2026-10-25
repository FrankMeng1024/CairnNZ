# Reproducible Commands

从 repository root：

```sh
cd app
npx jest --runInBand src/features/route/__tests__/routeFogLayerOrdering.test.ts src/features/route/__tests__/routeContracts.test.ts src/screens/__tests__/orderedRouteEditorScreen.test.tsx src/features/memory/__tests__/preparedMemoryCoverageStore.test.ts src/features/memory/__tests__/memorySyncReconcile.test.ts src/i18n/__tests__/cairnText.test.tsx
npx jest --runInBand src/features/route/__tests__/routeDisplayGeometry.test.ts src/features/route/__tests__/canonicalRouteGeometry.test.ts src/features/route/__tests__/orderedRouteDraft.test.ts
npm run verify:route
npm run verify:changed
npm run check:text
npm run verify:full
npx tsc --noEmit --pretty false
NODE_ENV=production npx expo export --platform ios --output-dir /tmp/cairn19-ios-export --clear
```

Backend contract：

```sh
cd backend
node --test src/routes/__tests__/o85Phase2Contracts.test.js src/services/__tests__/memoryCoverageSnapshot.test.js
```

10k 五次测试应串行运行，避免人为制造并发负载；每次把测试产生的 `revision-03-memory-scale.json` 复制到独立 scratch evidence path。预算/fixture 不应通过环境变量改写。

Route visual（先用 Expo Web 启动当前候选；使用 scratch output）：

```sh
CAIRN_QA_URL=http://127.0.0.1:8082 \
CAIRN_QA_LOCAL_STYLE=1 \
CAIRN10_VISUAL_FIXTURE=two-pass \
CAIRN10_ROUTE_VISUAL_OUTPUT=/tmp/cairn19-route-visual/headless \
node scripts/cairn10-route-visual-gate.mjs

CAIRN_QA_URL=http://127.0.0.1:8082 \
CAIRN_QA_LOCAL_STYLE=1 \
CAIRN_VISUAL_HEADED=1 \
CAIRN10_VISUAL_FIXTURE=two-pass \
CAIRN10_ROUTE_VISUAL_OUTPUT=/tmp/cairn19-route-visual/headed \
node scripts/cairn10-route-visual-gate.mjs
```

当前旧 Mac 环境预期忠实得到 FAIL/BLOCKED；不要把它作为“应变绿”的 fixture。受支持图形环境中再移除 `CAIRN10_VISUAL_FIXTURE` 执行完整矩阵，并以 report verdict 和原图为准。
