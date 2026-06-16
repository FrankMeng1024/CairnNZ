# ADR-005: 5 type SDF 纹理来源(允许引老 SDF)

## Context
"视觉自包含" = v0.2.5 v025 包内不引用老 v0.2.4 代码 / 资源。
但 5 type SDF 纹理(image/voice/video/text/route)在 v0.2.4 已绘制完成,质量优先 ⇒ 允许
v0.2.5 引用老 SDF 纹理,跟"视觉自包含"局部矛盾,以"质量优先"裁定。

## Decision
- v025/Visual/CairnTypeIconRenderer.cs 引用 `Assets/Resources/cairn_type_sdf/*.png`(老
  v0.2.4 资源路径)
- 资源文件不在 v025 目录,但 v025 代码可读
- 任何修改老 SDF 纹理 → ADR review

## Consequences
- 实现速度提升(不重画 SDF)
- v025 代码视觉自洽(纹理路径硬编码 Resources/)
- 删 v0.2.4 老代码时必须保留 cairn_type_sdf/ 目录

## Failure modes
- 老 SDF 路径变动 → 单测 SDFTextureExistTest 验证 5 个 .png 文件存在
- v0.2.7 重画 SDF → 直接覆盖文件,代码不需改

## Expiration phase
v0.2.6(届时评估是否需要重新绘制)

## Status
active

## Signoff
- Main agent: 2026-06-16
- User review pending
