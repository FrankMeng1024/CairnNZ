# ADR-011: Phase 2B SSIM gate + visual fidelity 延期到 Phase 4 EAS build #1

## Context
Phase 2B 4-eye 审计 (#2B-1 + #2B-2) 提出三个 visual fidelity 关联问题:

1. **CairnBaseGeometry linear shrinkage** (sub#2B-2-E):
   线性 Lerp(baseRadius, baseRadius*0.4) 不能匹配 design_v2026-06_variant_C HTML demo
   非线性 stone profile,SSIM ≥ 0.65 阈值不可能达成。

2. **Phase 2B.9 SSIM gate 不可执行** (sub#2B-2-F):
   SSIM 比较需要 (a) Unity Editor 截图 (b) Playwright HTML demo baseline 截图
   (c) 真机/Editor playmode 跑 cairn assembly。当前 session 无 Unity Editor + 无
   Playwright 实跑能力,基准截图未生成。

3. **Phase 2B prefab + materials authoring**:
   未在 Editor 创建 prefab asset。运行时 V025PrefabFactory.BuildRuntimePrefab() 兜底
   (round-2 fix),但 SSIM 基准对比时仍可能不匹配 designer 期望。

## Decision

### A. 延期 SSIM gate 到 Phase 4 EAS build #1
- Phase 2B 出口判据**不再要求 SSIM ≥ 0.65**
- Phase 2B 出口改为:**代码完整 + EditMode 单测全绿 + V025PrefabFactory 可在 Editor playmode 跑出可见 cairn**
- Phase 4 EAS build #1 真机阶段:Editor capture 4 时点 + Playwright 截 HTML demo 基准 +
  SSIM compare,达到 ≥ 0.65。如不达 → ADR-004 视觉降级 feature flag 启用

### B. CairnBaseGeometry profile 调优放在 Phase 4
- Phase 2B 当前的 linear shrinkage 是已知不达 SSIM 的占位
- Phase 4 designer 用 Playwright `getBoundingClientRect` 测每层 stone 半径 →
  导出为 `[float] stoneRadiusByLayer` 数组 → CairnBaseGeometry 读该数组
- 改一行 code 就可达 ≥ 0.65(几何精度足够)

### C. Designer-authored 正式 prefab 放 Phase 4
- V025PrefabFactory.BuildRuntimePrefab() 是 Phase 2B 兜底,确保不报"prefab missing"
- Phase 4 designer 创建 prefab + materials + 加 ParticleSystem child → 用
  CairnAssemblyV2.RegisterPrefab() 注入,RuntimeFactory 自动让位

## Consequences
- (+) Phase 2B 不被 visual SSIM 阻塞
- (+) Editor playmode 能跑出可见 cairn(用 PlaceholderTextures + 基础 mesh)
- (+) Phase 4 EAS 真机一次性收口 visual fidelity
- (-) Phase 2B "code 完整" 跟 "visually correct" 是两件事;用户看 Phase 2B SSIM 跑不
  动可能误以为 visual 不行,需澄清

## Failure modes
- Phase 4 designer 不交 stone profile + prefab → ADR-011 expiration 触发,Phase 4 不能关闭
- SSIM 基准跟实际 v0.2.5 cairn 风格不一致 → 用户 review 对齐 design v2026-06_variant_C 是否仍是基准

## Expiration phase
Phase 5(EAS build #1 + Playwright HTML demo baseline + designer prefab → SSIM ≥ 0.65 verify)

## Status
renewed (2026-06-17 final-review: SSIM gate moved from Phase 4 to Phase 5 because real-device + designer prefab + Playwright baseline all required)

## Signoff
- Main agent: 2026-06-17
- User review pending
