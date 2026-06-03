# TECH_SPEC — Cairn Algorithm Sandbox

## §type
Web App (single-page, Vanilla JS + HTML5 Canvas 2D)

## §acceptance
`acceptance_mode: auto`
CP1: style demo 选择
CP2: Sprint 1 spike 计划确认

## §stack

| Layer | Tech | Reason |
|---|---|---|
| Frontend | Vanilla JS (ES6 modules) | 沙盒不需要框架 |
| Render | HTML5 Canvas 2D | 500 人 60fps 够用 |
| State | 单文件 in-memory | 无需后端 |
| Algo (Stage 1) | Python 3 | 数学验证脚本 |
| Algo (Stage 2) | JavaScript | 沙盒中实时运行 |
| Test | Playwright + Node.js | 自动化 + 截图 |
| LLM | Claude API (Haiku/Sonnet) | 仅最终评估一次 |
| Data | JSON 文件 | personas + marker templates |

## §viewports
- Primary: Desktop 1920×1080
- Secondary: Desktop 1366×768
- 不支持 mobile (沙盒是开发工具)

## §start-script
`sandbox/start.sh` — 启动 dev server (python -m http.server 或 npx http-server)

## §test-runner
`sandbox/stage3_playwright/playwright.config.js`

## §test-config
`sandbox/stage3_playwright/scenarios/*.spec.js`

## §git
- Strategy: A (auto-commit)
- Branch: 直接 main (子项目独立 commit, 标 sandbox: 前缀)

## §deploy
- Development: `file://` 直接打开 HTML
- 测试: localhost dev server
- Production: 不部署（沙盒是验证工具）

## §performance-targets

| Metric | Target |
|---|---|
| 100 人 + 30 marker 帧率 (可视化) | ≥ 60fps |
| 100-1000 人 headless 跑 365 天 | ≤ 60s |
| 路过检测/帧 | < 5ms |
| State 导出 JSON | < 100ms |
| 截图响应 | < 500ms |
| 单场景 Playwright 跑完 | < 240s |

## §rendering-modes

**双模式架构**:

| Mode | 人数 | 渲染 | 用途 |
|---|---|---|---|
| **Visual** | 100 (默认) | Canvas 60fps | 用户观察, demo 展示 |
| **Headless** | 100-1000 | 无渲染 | Playwright batch test, Monte Carlo |

两模式共享算法 + persona 引擎, 仅渲染层不同。

## §spike-decision

Sprint 1 必做 spike：

1. **Canvas 2D 500 人 60fps 性能**
   - 验证: 500 圆圈 + 30 旗帜 + 网格 + 卡片，60fps 不掉帧
   - 路径: 写最小 demo, 用浏览器 performance tab 测

2. **Quadtree 空间索引**
   - 验证: 路过检测 < 5ms/帧
   - 库选: 自写 vs d3-quadtree

3. **群体行为同步移动**
   - 验证: 70% 结伴时 leader-follower 不振荡
   - 路径: 实现简化 boids，观察轨迹

4. **概率抽样性能**
   - 验证: 每帧 500 次 persona.decide() 调用 < 1ms
   - 路径: persona JSON 加载 + alias method

## §ux-thresholds
- 视角切换响应: < 100ms
- 调节滑块响应: 实时 (下一 tick 生效)
- 截图按钮响应: < 500ms

## §file-structure

```
sandbox/
├── docs/                          # 本子项目文档
│   ├── DISCOVERY.md
│   ├── PRD.md
│   └── TECH_SPEC.md
├── stage0_research/               # ✅ 已完成
│   ├── personas_distribution.json
│   ├── marker_content_templates.json
│   └── research_report.md
├── stage1_math/                   # Sprint 2
│   ├── formula.py
│   ├── test_cases.py
│   ├── run.py
│   └── results.json
├── stage2_visual/                 # Sprint 3+4
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── algorithm.js
│       ├── persona.js
│       ├── walker.js
│       ├── marker.js
│       ├── renderer.js
│       ├── ui_panel.js
│       ├── view_switcher.js
│       ├── quadtree.js
│       └── exporter.js
├── stage3_playwright/             # Sprint 5
│   ├── playwright.config.js
│   ├── tests/
│   │   ├── default.spec.js
│   │   ├── crowded.spec.js
│   │   └── ... (10 个)
│   ├── analyzer.js                # LLM 评估
│   └── reports/                   # 自动生成
├── style-demos/                   # Sprint 0 CP1
│   ├── demo-A-minimal.html        # 极简风格
│   ├── demo-B-game.html           # 游戏感风格
│   └── demo-C-data.html           # 数据可视化风格
├── tasks/jira/                    # Sprint 文件
└── spike-results/                 # Sprint 1 spike 报告
```

## §parent-project-relation

```
父项目: C:/ClaudeCodeProjects/Cairn/
  ├── (主 app 代码, 不动)
  └── sandbox/                    ← 本子项目根
      └── (独立 Sprint, 独立文档)

父项目 v3.2 文档:
  docs/discussions/public-marker-feedback-v3.2.md
  → 本子项目验证此文档中的算法

父项目沙盒计划:
  docs/discussions/algorithm-sandbox-plan-v2.1.md
  → 本子项目按此计划执行

子项目结果反哺:
  阶段 1+2+3 通过 → 父项目 v3.2 → v3.3 (锁定参数)
  → 父项目 PRD4 → Sprint Planning → 实施
```

## §decisions

| Decision | Choice |
|---|---|
| Framework | Vanilla JS (no React/Vue) |
| Bundler | None (ES6 modules direct import) |
| CSS | Plain CSS (no Tailwind) |
| Charts | None (Canvas 直接绘) |
| Date | YYYY-MM-DD format only |
| Number format | en-US (1,234.56) |
| 默认人数 | **100 (visual)** / 1000 (headless) |
| 默认地图 | **Leaflet + OpenStreetMap (NZ Tongariro 区域)** |
| 默认地图大小 | 跟 Leaflet zoom level 走 |
| 默认速度 | 100× (1 天 = 14.4s) |
| 默认 seed | Date.now() |
