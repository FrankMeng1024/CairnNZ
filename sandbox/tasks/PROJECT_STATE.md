# Sandbox PROJECT_STATE

**Last update**: 2026-05-31

## Status: 全 Sprint COMPLETE — ACCEPTED ✅ (LLM 10.00/10)

| Sprint | Type | Goal | Status |
|---|---|---|---|
| Sprint 0 | Foundation | PRD + TECH_SPEC + DISCOVERY | ✅ done |
| Sprint 1 | Spike | 4 tech risks → VIABLE | ✅ done |
| Sprint 2 | Module | algorithm.js + persona.js (5/5 tests) | ✅ done |
| Sprint 3 | Algorithm validation | v3.2 → v3.3 | ✅ done |
| Sprint 4.1 | Math case battery | 61/61 hand-crafted PASS | ✅ done |
| Sprint 4.2 | Parameter ±20% sweep | 10/12 configs PASS | ✅ done |
| Sprint 4.3 | Heartbeat revival | 10/10 seeds revived | ✅ done |
| Sprint 5 | Playwright 10 scenarios | 10/10 PASS | ✅ done |
| Sprint 6 | Performance | < 1% frame budget @ 100 walker | ✅ done |
| Sprint 7 | Demo control panel | 中文 UI + 批量模拟 | ✅ done |
| Sprint 8 | LLM 4-dim verdict | 10.00 / 10 (阈值 8) | ✅ done |
| Sprint 9 | Final acceptance | ACCEPTED | ✅ done |

## Acceptance verdict

**LLM 4 维加权: 10.00 / 10** (阈值 8)
- correctness 10/10 (40%)
- realism 10/10 (30%)
- edge_case 10/10 (20%)
- ux_clarity 10/10 (10%)

详见 `docs/qa/sprint3-evidence/ACCEPTANCE.md`

## 一键跑全部测试

```bash
cd sandbox
python -m http.server 8766 > /tmp/http.log 2>&1 &
bash run-all.sh
```

## 算法核心 (frozen v3.3)

`stage2_visual/js/algorithm.js`:
- exposureRate: report 权重 1.5× heat
- lifeLeft: + lifeBoost(heat) - lifeBoost(penalty) - effectiveDays
- 全部参数通过 env vars 可调 (用于 sweep)

任何后续改动 → 跑 run-all.sh 回归.
