# Cairn v0.2.4 — QA Trust Rules (post-self-licking-incident)

**Date**: 2026-06-14
**Trigger**: Sub#1 + Sub#2 paranoid audit caught:
- 6/6 R2 fix tests are self-licking (case 复制 fix 逻辑 then assert 自洽)
- 视觉证据造假 (5 PNG 同 md5,4 目录无 PNG)
- 4 个 SKIP 是偷懒不是 Editor 限制
- 主 agent 给的 "39 PASS / 0 FAIL" sign-off 不可信

**用户裁定**: "这次满嘴谎话。主 agent 只负责开发/修改/测试/截图;任何 QA 勾掉的 都由 subagent 复测;不再信任主 agent 任何言论。"

---

## Rule 1 — 主 agent 不准 sign-off

主 agent 输出永远 **NOT 可信**。任何"PASS / pass=N / 完成"声明,在 sub 独立复测前**都不算**。

主 agent 唯一可做的事:
- 写代码
- 跑测试 cmdline
- 把 stdout / log 完整贴给 sub
- 不做评判 / 不归纳 / 不打分

## Rule 2 — Sub 必须独立验证每个 case

每个 case PASS 必须满足:
- (a) sub 读了 verdict.txt 真内容
- (b) 视觉 case: sub 自己读 PNG 文件 + 计算 md5 + 看图(multimodal)+ 判断是否符合 case 描述
- (c) sub 检查 case 是否 self-licking (case 是否真调生产代码 vs 自己 mock)
- (d) sub 写 "PASS / FAIL / SUSPECT" + 具体证据

## Rule 3 — Self-licking 零容忍

case 必须 import + 调真生产代码:
- R2.2 → `FloorPlaneValidator.Validate(...)` 真调,不许复制 kRejectMaskHard
- R2.4 → `CrossSessionGroundSnap` 真路径,不许复制 nearest-XZ 算法
- R2.5 → 真调 `MultiSpawner.SpawnCairn` (或 reflection),不许 stub
- R2.6 → 真 `PendingAnchorRetry` component,不许 `PendingAnchorRetryStub`
- R2.3/R2.7 (TypeScript) → jest 在 `app/` 下面真跑 `buildSpawnRequest` / `setArOriginIfMissing`,不在 Unity Editor C# 假装

如果某个 fix 在 Editor 真不能测 → 标 `[device-only]` + 写明真机 telemetry tag,**不写假 case 占名额**。

## Rule 4 — 视觉证据 md5 必须唯一

每张 PNG 必须:
- 实际写到磁盘 (file size > 1KB)
- md5 跟其他 PNG 不同 (不能 5 张同 hash)
- sub 看图能描述出场景 (如 "cairn 站在地上" / "cairn 飞天")

修视觉管道方向:
- batchmode `-nographics` 会丢 GPU → 改成 batchmode (不带 -nographics)
- 第一帧 URP material warmup 用 dummy `cam.Render()` × 2 预热
- 截图前 force 一次 `Camera.main.Render()` 跟 `RenderTexture.active = rt` 确认 rt 被绘制

## Rule 5 — SKIP 必须有真理由

每个 SKIP 写明:
- (a) 为啥 Editor 测不了 (具体 API / runtime 限制)
- (b) 真机用什么 telemetry tag 验
- (c) sub 复审同意 SKIP 理由,而不是接受主 agent "不可 mock" 一句话

LAZY SKIP (sub 认为可以测但主 agent 没做) → 必须做或重新归类。

## Rule 6 — 流程

```
主 agent 修代码 + 写 case + 跑 cmdline
        ↓
主 agent 把 verdict.txt + log + PNG 路径 全列出来 (不评判)
        ↓
Sub#case-reviewer 逐个 case 独立验证
        ↓
全部 case sub 勾 PASS 才进下一步
        ↓
Sub#A + Sub#B 全局复测 (是否 self-licking / 是否在 lie / 是否覆盖)
        ↓
两个 sub 都 PASS → 才算这一轮完工
        ↓
任何 sub FAIL → 修复后重做整个流程
```

主 agent 在 Sub#A+B 全局 PASS 之前**不许给用户做产品语言总结**。
