# Reproducible Commands

从 repository root：

```sh
cd app
npx jest --runInBand \
  src/features/route/__tests__/routeFogLayerOrdering.test.ts \
  src/features/route/__tests__/routeContracts.test.ts \
  src/screens/__tests__/orderedRouteEditorScreen.test.tsx \
  src/features/route/__tests__/routeDisplayGeometry.test.ts \
  src/features/route/__tests__/canonicalRouteGeometry.test.ts \
  src/features/route/__tests__/orderedRouteDraft.test.ts \
  src/features/memory/__tests__/preparedMemoryCoverageStore.test.ts \
  src/i18n/__tests__/cairnText.test.tsx
npm run verify:route
npm run verify:changed
npm run check:text
npm run verify:full
npx tsc --noEmit --pretty false
NODE_ENV=production npx expo export --platform ios --output-dir /tmp/cairn20-ios-export --clear
```

Direct browser renderer control（local style，无 hosted request）：

```sh
cd app
CAIRN20_WEBGL_CONTROL_OUTPUT=/tmp/cairn20-mapbox-webgl-direct \
node scripts/cairn20-mapbox-webgl-control.mjs
```

真实 Cairn Editor/Detail A–E gate（需已有 Expo Web server）：

```sh
cd app
CAIRN_QA_URL=http://127.0.0.1:8081 \
CAIRN_QA_LOCAL_STYLE=1 \
CAIRN20_CONTROL_MATRIX=1 \
CAIRN10_VISUAL_FIXTURE=two-pass \
CAIRN10_ROUTE_VISUAL_OUTPUT=/tmp/cairn20-route-controls \
node scripts/cairn10-route-visual-gate.mjs
```

报告 verdict 非 PASS 时命令应非零退出；不要只检查 source/layer，也不要删除失败截图。当前环境的真实 app gate 是间歇性的，重复命令只适合刻画稳定性，不能选择性保留绿色运行。

受支持且有授权 token 的 hosted Mapbox 环境，以及物理 RNMapbox iPhone，属于后续 Owner 授权边界。不要把 token 写进命令历史、报告或 Git。
