# Memory Cairns 控件

- 只把 Memory 地图入口 `memory.library.button` 的 en-NZ 文案从 Library 改为 Cairns。
- 导航目的地仍为既有 `AllCairns`；没有全局重命名其他 Library 概念。
- 文案仍来自唯一 catalog `app/src/i18n/cairnText.ts`；生产 runtime 仍固定 en-NZ，没有新增 locale 切换或日语工作。
- Cairns 与右侧 scope control 使用同一 `MEMORY_TOP_CONTROL_HEIGHT = 40`、surface/border/radius/shadow 体系和对齐基线；各自保留足够 hit slop。
- 未改变 safe area、Mapbox attribution 或交互行为。

390 × 844 实际组件 QA：Cairns 可见高度 40，scope 可见高度 40，顶部/垂直对齐判定为 true。截图见 `EVIDENCE/MAP_VISUALS/memory-controls-day-390x844.png`。
