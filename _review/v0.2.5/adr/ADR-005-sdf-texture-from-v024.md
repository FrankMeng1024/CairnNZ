# ADR-005: 5 type SDF 纹理来源(允许引老 SDF)

## Context
"视觉自包含" = v0.2.5 v025 包内不引用老 v0.2.4 代码 / 资源。
但 5 type SDF 纹理(image/voice/video/text/video/route)v0.2.4 假设已绘制完成,质量优先 ⇒ 允许
v0.2.5 引用老 SDF 纹理。

**Phase 2B 4-eye 实际审计发现** (#2B-1-B2 + #2B-2.A):
v0.2.4 老资源中只有 `cairn / danger / hut / junction / water`(5 个老 marker 类型),
没有 v0.2.5 plan 要求的 `image / voice / video / text / route`。Plan 假设错。

## Decision (修订)
- **保留代码路径**:CairnTypeIconRenderer 仍从 `Resources/cairn_type_sdf/{name}.png` 加载
- **资源策略变更**:不再"引老 SDF",改为 Phase 4(EAS build #1 真机阶段)创建新 SDF
  - 新 SDF 由 designer 用 design_v2026-06_variant_C HTML demo 中的 5 个 icon 转 PNG (256×256, alpha=SDF)
  - 临时占位:Phase 2B 写 PlaceholderTextures.cs 在 Awake 时 runtime-build 5 个 256×256 alpha 纹理
    (简单几何形状区分 5 type:circle/triangle/square/star/arrow),让 Editor 跑得起来
- **Phase 4 真机** 替换为正式 SDF
- **视觉自包含**约束局部退让:Phase 2B 用 placeholder 纹理(自包含),Phase 4 引入正式
  设计师产出的 SDF(可能从 v0.2.4 design pipeline 派生,但属于 v0.2.5 资产)

## Consequences
- (+) Phase 2B Editor playground 可以渲染(有 placeholder 纹理)
- (+) Phase 4 正式 SDF 替换为单点改动(只改 Resources/cairn_type_sdf/)
- (+) 视觉自包含从"绝对"变为"分阶段达成"(Phase 4 完成时全自包含)
- (-) Phase 2B SSIM gate 与 HTML demo 的对比不严格(placeholder 不像 demo 图标)→ Phase 4 才能真测
- (-) ADR-005 expiration 从 v0.2.6 提前到 Phase 4

## Failure modes
- Designer 不交 SDF → ADR-005 expiration 触发,verify_progress.py 阻止 Phase 4 关闭
- Placeholder 纹理在 Phase 2B SSIM 跑出 < 0.65 → 已知,不阻塞,Phase 4 修

## Expiration phase
Phase 5 (EAS build #1 — designer SDF replacement)

## Status
renewed (2026-06-17 final-review: PlaceholderTextures shipped Phase 2B; designer SDF replacement is Phase 5 entry task)

## Signoff
- Main agent: 2026-06-17 修订
- User review pending
