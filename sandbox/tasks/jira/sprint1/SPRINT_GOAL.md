# Sprint 1 — Spike Sprint

**Sprint**: 1
**Type**: Spike (technical risk reduction)
**Goal**: 验证 4 个关键技术风险, 输出 viable / not-viable 决策

---

## Spike 任务

### SPIKE-001: Canvas 2D 100 walkers 60fps 性能

**Risk**: A4 demo 已证明球能动, 但持续运行 365 天加速时性能未测

**Verification**:
- 写最小测试: 100 圆球同时 requestAnimationFrame 移动
- 加 30 marker + 路过检测 (无 quadtree, 看是否需要)
- Chrome DevTools performance tab 测帧率
- 跑 5 分钟看是否掉帧

**Output**:
- VIABLE: 60fps 稳定, 不需要 quadtree
- VIABLE WITH CONDITIONS: 需要 quadtree
- NOT VIABLE: 性能不达标, 需要降级到 WebGL

---

### SPIKE-002: Quadtree 空间索引

**Risk**: 100 walker × 30 marker × 60Hz = 18 万次距离运算/秒, 可能爆

**Verification**:
- 写 quadtree 实现 (或用 d3-quadtree)
- 路过检测 < 5ms/帧
- vs naive O(n×m) 对比测试

**Output**:
- VIABLE: quadtree < 5ms, 集成
- VIABLE WITH CONDITIONS: naive 也 < 5ms, 不需要 quadtree (简化)
- NOT VIABLE: 需要更激进优化

---

### SPIKE-003: Persona 概率抽样性能

**Risk**: 每帧 100 次 persona.decide() 抽样, 加载 JSON + alias method 是否快

**Verification**:
- 加载 personas_distribution.json
- 实现 5 情境分类逻辑 (high_like_low_report 等)
- 100 次 decide() < 1ms
- 测 1000 次决策结果分布是否符合 JSON 配置

**Output**:
- VIABLE: 性能达标 + 分布符合
- NOT VIABLE: 重新设计抽样方法

---

### SPIKE-004: v3.2 算法实现 (双时钟 + 心跳)

**Risk**: JS 实现公式可能与文档不一致, 浮点累积误差

**Verification**:
- 实现 LifeBoost / LifeLeft / 心跳曝光率
- 跑 v3.2 §7.5 6 个 case, 数值对照
- 跑 365 天循环看是否稳定 (无 NaN / Inf)

**Output**:
- VIABLE: 6 case 全过, 365 天稳定
- VIABLE WITH CONDITIONS: 需要参数微调
- NOT VIABLE: 公式本身有问题 (回头改 v3.2)

---

## Sprint 1 Verification

按 CLAUDE.md, Spike Sprint 不要 PO demo, 由 **Arch Code Review** 验证。

---

## 时间预算

- SPIKE-001: 1 小时 (有 A4 demo 做基础)
- SPIKE-002: 1 小时
- SPIKE-003: 30 分钟
- SPIKE-004: 1.5 小时

总计: 4 小时 (半天)

---

## Spike 完成后产出

```
sandbox/spike-results/
  ├── SPIKE-001-canvas-performance.md
  ├── SPIKE-002-quadtree.md
  ├── SPIKE-003-persona-sampling.md
  └── SPIKE-004-algorithm-v32.md
```

每个文件 PASS / VIABLE WITH CONDITIONS / NOT VIABLE 决策。
