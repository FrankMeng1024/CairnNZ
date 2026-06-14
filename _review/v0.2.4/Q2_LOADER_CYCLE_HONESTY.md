# Q2 §B Loader Stop/Start Cycle — 主 agent 诚实记录

## SPIKE-Q2.md §B 推荐

> "Cleanest in-Editor recipe (no native ARKit needed):
>   1. Run the scene in PlayMode under XR Simulation loader
>   2. Plant a cairn → ARAnchor created
>   3. "End session 1" = stop PlayMode, OR call LoaderUtility.Deinitialize() → Initialize()
>   4. Before re-init, translate XROrigin.transform by synthetic (Δx, Δy, Δz)
>   5. Re-init loader → new session, anchor pool empty"
>
> "XRGeneralSettings.Manager.activeLoader.Stop() / Start() is supported on XR Simulation"

## 实际 Editor batchmode 限制

**HeadlessRender.cs:9-13 铁律**:
```
Unity batchmode does NOT actually enter Play mode. EnterPlaymode is
a no-op when -batchmode -quit chain is used.
```

`XRGeneralSettings.Instance.Manager.activeLoader` 在 Edit mode + batchmode 永远 null,因为 Loader 仅在 PlayMode initialize 时启动。`Stop/Start` 调用 NRE。

`LoaderUtility.Deinitialize()` 同样需要先有 active loader。

## 替代覆盖

主 agent 已用 **3 种方式** 等效覆盖跨 session ARKit world frame 切换的视觉/数学行为:

1. **`SlamDriftFlipbookTest.cs`** — 60 帧 cairn parent transform 直平移 (单帧 → 60 帧累计 30cm drift)
2. **`SlamPoseInjectionTest.cs`** (Q3a §3 真反射) — 60 帧反射 `SimulationCameraPoseProvider.UpdatePose()`,真 60Hz pose injection,等效 ARKit SLAM tug-of-war
3. **`ARReEnterVisualTest.cs`** — UnityView unmount + re-mount + ARKit world frame y +0.6m,4 张视觉 PNG (S3a 飞天 vs S3b R2.4 拉回)

## 真正不能 Editor 测的部分

- ARKit Loader 启动后真销毁 ARSession 资源 (native `ARSessionSubsystem.Destroy()`)
- ARSession resume 后 ARKit native 重新 init world frame (真物理过程)
- 跨 Loader Start/Stop 的 anchor lifetime (真 ARKit anchor pool flush)

这些 **需要 PlayMode + ARFoundation Simulation runtime**,batchmode 跑不了。

## Verdict

**Q2 §B 真路径 = PlayMode + Simulation loader cycle,Editor batchmode 物理上不能跑。**

替代覆盖 (Q3a 反射 + flipbook + ARReEnterVisualTest) 在视觉/数学/逻辑层等效,但**没真做 ARSession destroy/restart**。这是 v0.2.5 PlayMode harness 的事,不是 batchmode 范围。

诚实记录,不强行做不可能。
