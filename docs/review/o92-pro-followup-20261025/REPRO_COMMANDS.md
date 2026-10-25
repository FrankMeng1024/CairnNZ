# Reproducible Commands

从 repository root 执行：

```sh
cd app
npm test -- --runInBand src/features/route/__tests__/routeDisplayGeometry.test.ts src/features/route/__tests__/routeContracts.test.ts src/features/memory/__tests__/preparedMemoryCoverageStore.test.ts src/features/memory/__tests__/memorySyncReconcile.test.ts src/i18n/__tests__/cairnText.test.tsx
npm run check:text
npm run verify:changed
npm run verify:full
NODE_ENV=production npx expo export --platform ios --output-dir /tmp/cairn18-ios-export --clear
```

Found Detail 稳定态（先启动 Expo Web；本轮使用 8082）：

```sh
CAIRN_QA_URL=http://127.0.0.1:8082 \
CAIRN18_FOUND_DETAIL_ONLY=1 \
CAIRN_O88_REVIEW_DIR=/tmp/cairn18-found-final \
node scripts/cairn-o88-review-capture.mjs
```

Route installed Mapbox GL + source-free local QA style：

```sh
CAIRN_QA_URL=http://127.0.0.1:8082 \
CAIRN_QA_LOCAL_STYLE=1 \
CAIRN10_ROUTE_VISUAL_OUTPUT=/tmp/cairn18-route-final \
node scripts/cairn10-route-visual-gate.mjs
```

此环境当前应忠实返回 FAIL/BLOCKED，而不是预期绿灯。要完成发布级视觉门禁，独立 reviewer 应在有授权 hosted token 的受支持浏览器环境运行同一 runner，再在现有安装版 iPhone 上检查 Editor/Detail 同相机。不要用 `CAIRN_QA_LOCAL_STYLE=1` 的像素替代 hosted provider 或 native 证据。

