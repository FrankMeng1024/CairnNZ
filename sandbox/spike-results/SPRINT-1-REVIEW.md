# Sprint 1 — Spike Review

**Sprint**: 1
**Date**: 2026-05-30
**Reviewer**: Arch (autonomous mode)
**Verdict**: ✅ ALL VIABLE — proceed to Sprint 2

---

## 4 Spikes — Results

### SPIKE-001: Canvas 2D Performance ✅ VIABLE

```
Setup: 100 walkers + 30 markers + naive O(n×m) encounter check
Test:  300 frames synchronous loop

Results:
  Avg frame work time: 0.152ms (rendering+logic)
  Max frame work time: 3.500ms
  Theoretical max FPS: 6578.9
  
Conclusion: 60fps trivially achievable on this hardware.
            naive O(n×m) is sufficient. NO quadtree needed.
```

---

### SPIKE-002: Quadtree vs Naive ✅ NAIVE WINS

```
Setup: 100 walkers, 30 markers, 1000 iterations
Test:  Compare naive O(n×m) vs grid index

Results:
  Naive:      112.5ms total = 0.113ms per frame
  Grid index: 134.0ms total = 0.134ms per frame
  Speedup:    0.84× (naive is FASTER at this scale)
  
Conclusion: At n=100, m=30, grid index overhead exceeds savings.
            Use naive. Re-evaluate only if scale grows >5×.
```

---

### SPIKE-003: Persona Probability Sampling ✅ VIABLE

```
Setup: Load personas_distribution.json, sample 100,000 times
Test:  Verify distribution match + speed

Results:
  100,000 samples in 8.7ms (0.09ns per sample)
  expected: like:0.45 report:0.02 ignore:0.53
  actual:   like:0.450 report:0.020 ignore:0.530
  errors:   like=0.0001 report=0.0004 (within 0.05% of target)
  
Conclusion: Sampling extremely fast and accurate.
            JSON loading works. Distribution faithful.
```

---

### SPIKE-004: v3.2 Algorithm — 6 Cases ✅ ALL PASS

```
6/6 cases verified against v3.2 §7.5 expected behavior:

  ✓ Case 1: 新建 0赞               lifeLeft = 30.00 (expected ≈ 30) ✓
  ✓ Case 2: 1年 100赞 最近90天0赞   lifeLeft = -322.78 (expected < 0, sunk) ✓
  ✓ Case 3: 30天 100赞 最近还在涨   lifeLeft = 317.64 (expected > 0, alive) ✓
  ✓ Case 4: 5赞集中(当天)           heat = 4.84 (expected ≈ 5) ✓
  ✓ Case 5: 90天 0赞 → 5赞当天     lifeLeft = -35.00 (expected < 0) ✓
  ✓ Case 6: 12赞当天 (复活门槛)    lifeLeft = 0.00 (expected ≥ 0, revival) ✓

Conclusion: v3.2 algorithm formula implementation is correct.
            Numerical results match documented predictions.
            No NaN, no Infinity, no precision drift.
```

---

## Sprint 1 Verdict

**ALL 4 SPIKES VIABLE**

- Performance: trivially OK at target scale
- Algorithm: v3.2 公式经实现验证, 6/6 case 通过
- Persona: 概率分布抽样准确高效
- Architecture: 简化为 vanilla JS + Canvas 2D + naive checks

---

## Decisions Locked

| 决策 | 结果 |
|---|---|
| Canvas 2D 还是 WebGL? | **Canvas 2D**（足够） |
| 路过检测算法 | **Naive O(n×m)**（quadtree 不需要） |
| Persona 抽样 | **JSON 概率表 + Math.random()**（无需 alias method） |
| 算法实现 | **直接用 SPIKE-004 代码**（已验证） |

---

## Sprint 2 Plan (next)

实现完整算法引擎 + persona 决策系统:
- 加载 personas_distribution.json
- 实现 5 情境分类器（high_like / low_like / neutral / matches / contradicts）
- 实现 v3.2 完整公式
- 输出 algorithm.js + persona.js 两个模块

时间: 1 天

---

**Evidence**:
- Test runner: `sandbox/spike-results/spike-runner.html`
- Screenshot: `sandbox/spike-results/spike-results-screenshot.png`

---

**Next**: 进入 Sprint 2 (核心算法实现)
