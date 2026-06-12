# v0.2.4 完整执行计划

**日期**:2026-06-13
**状态**:Draft → 待 subagent challenge → 调整 → 开工
**约束**:不 push、不 EAS、不 OTA(除非用户明确确认)

---

## 0. 核心铁律(用户拍板,不可妥协)

| # | 铁律 | 违反 = 直接否决 |
|---|---|---|
| 1 | **不能飘** | 已 visible 的 cairn 本体永远不动 |
| 2 | **必须在地上** | cairn 永远贴真实地面,绝不在车顶/桌面/雪堆/人头/墙上/悬空(15s 兜底是用户忽略引导后的最后保险) |
| 3 | **必须能展示** | 用户走到该看见的位置就能看见,找不到率 = 0% 才及格 |
| 4 | **必须有动态效果** | cairn 出现 = variant_C_3D.html 1:1 仪式动画 |
| 5 | **必须有指引** | 远处箭头 / 近场扫地引导,用户不能自己摸黑 |

---

## 1. 用户行为剧本(产品规格)

### 1.1 状态机

```
       (App 打开,GPS / ARKit ready)
              │
              ▼
    ┌─────────────────────────┐
    │ FAR (>30m)               │ 屏幕箭头 + 距离 "32m →"
    │ 箭头方向: GPS-projected   │ 罗盘异常 → 引导走开阔
    └────────┬─────────────────┘
             │ 距离 ≤30m
             ▼
    ┌─────────────────────────┐
    │ APPROACH (30-10m)        │ 仍是箭头,触觉每减半一次
    │ 距离 10m: 提示"抬手机扫地"│
    └────────┬─────────────────┘
             │ 距离 ≤10m
             ▼
    ┌─────────────────────────┐
    │ ACQUIRE (≤10m)           │ 三条件检测:
    │                          │  1. 距离 ≤10m (anchor)
    │   引导扫地 (T=0)          │  2. 相机朝向 mark (dot>0.7 with hyst)
    │                          │  3. ARKit 扫到 floor plane
    │                          │ 引导分级见 §1.3
    └────────┬─────────────────┘
             │
        ┌────┴────────┐
        ▼             ▼
   三条件齐  →  IMMORTAL  ← 15s 强制兜底(仅当用户忽略引导)
        │             │
        ▼             ▼
   完整仪式动画   兜底显示(raycast hit / fallback 估算)
        │             │
        └─────┬───────┘
              ▼
    ┌─────────────────────────┐
    │ IMMORTAL (永久 visible)   │ 本体不动 (铁律 #1)
    │                          │ 用户走远 → mark 转回箭头
    │                          │ 用户回来 → 直接显示原位
    └─────────────────────────┘
```

### 1.2 关键时刻数字(我定,用户体验优先,OTA 可调)

| 时刻 | 距离 | 状态 | 引导 |
|---|---|---|---|
| 远场 | >30m | 箭头 | 距离实时 |
| 距离减半 | 30→15→7m | 箭头脉动 | 触觉震动一次 |
| 进入 acquire | =10m | 触发引导 | "抬起手机,慢慢扫描脚下地面" + 2s 示意动画 |
| T+3s | 仍 ≤10m | 加强引导 | "继续扫描,慢慢转动手机" |
| T+5s | 仍 ≤10m | 加重 | "镜头朝向地面" + 箭头变金色脉动 + 短震 |
| T+10s | 仍 ≤10m | 教学 | "蹲下或前后走动几步" + 蹲姿小图 |
| **T+15s** | **≤5m** | **强制兜底** | "为你显示标记" + mark 出现(铁律 #5 兜住) + 长震 |
| 任意时刻 | — | 三条件齐 | 立刻仪式动画 + 成功音效 |

**关键产品决定**(用户原话):"**忽略引导才有强制保底**"
- 用户朝向地面但 plane 没收敛 → 引导继续,**不强制**
- 用户**完全不抬起手机扫**(忽略引导)→ 15s 强制
- 强制兜底 = 最后保险,正常用户根本到不了

### 1.3 引导分级

第一次教学浮层(per-device 一次):
> "Cairn 出现需要扫描地面"
> [3s GIF:手机往下移,屏幕中地面网格亮,cairn 长出来]
> [ "知道了" ]

之后引导按 §1.2 时刻表渐进。

---

## 2. 三档跨设备策略(简化版,符合"上海测试 100% 通过")

| 档 | 适用 | 方案 |
|---|---|---|
| **A: 同手机重开** | iPhone X 自己 plant 自己找 | ARKit ARWorldMap 序列化 + relocalize on app start |
| **B: 跨手机/跨人 / Geospatial 可用** | 上海/Auckland 城区有 Street View 覆盖 | ARCore Geospatial Earth Anchor(免费层,符合"小额付费类似 mapbox") |
| **C: 兜底** | 偏远 trail 无 Geospatial | GPS+IMU+气压计扎实化(精度 5-15m,但箭头永远准确指向 anchor) |

**档位锁定铁律**:cairn 一旦 anchored 到某档,本 session 永不切档。下次冷启动重新评估。

**v0.2.4 上海测试范围**:
- 档 A 必测(同手机短期回访)
- 档 B 必测(Geospatial 在上海城区可用)
- 档 C 实现但不重点测(NZ trail 是未来)

---

## 3. 视觉:variant_C_3D.html 1:1 移植(Branch C)

**保留(用户已满意)**:
- 现有底座(青色 pebble + 圆环)
- CairnConeCore.shader(hollow rim + 2-layer flow noise)
- CairnConeOutline.shader

**新建/重写**:

### 3.1 圆环描边动画 — `PortalRingShader.shader` 扩展
- 加 `_SweepAngle` uniform(0..2π)
- Fragment 用 `atan2(localXZ)` 与 `_SweepAngle` 比较 discard
- 单 DrawCall 不重建 mesh

### 3.2 SDF rune 中心徽章 — 新建 `RuneSDFShader.shader`
- 5 个 type 各自图形,branch by `_TypeId` int
- HLSL 程序生成(ellipse stack / triangle / teardrop / pentagon / fork)
- `fwidth()` 抗锯齿
- 替换现有 PebbleStack 当 cairn type 主中心(pebble 退到次要)

### 3.3 仪式 timeline — 新建 `CeremonyController.cs`
- Coroutine 0→1.0s
- 0-0.5s:`_SweepAngle` lerp 0→2π(圆环描边)
- 0.5-0.85s:rune `_Reveal` lerp 0→1 + scale 0.7→1.0
- 0.85-1.0s:丝带 + type 粒子启动 + 标签淡入

### 3.4 5 type 粒子 — 新建 5 个 ParticleSystem prefab
- cairn:碎石蹦起(box mesh + collision plane)
- water:水珠(sphere + 内向初速度)
- danger:火星(sphere + 上升 + opacity flicker)
- hut:暖光(sphere + noise lateral drift)
- junction:6 cone 绕轨(用 `JunctionArrowsController.cs` C# 控制,不用 ParticleSystem)

### 3.5 不死板丝带 — 新建 `RibbonSilkV2.shader` + `SilkRibbonV2.cs`
- 5-vertex 程序 mesh(port JS line 277-419)
- HLSL feature(Branch C 报告 §3.3):
  - flutter(per UV.y sine)
  - 2-layer flow noise
  - height-based color lerp(base type tint → tip 浅色/天空色)
  - alpha pow(1-uv.y, 1.6)淡出
  - day/night `_DayMul` / `_NightMul`(已有 `CairnDayNightAdapter`)
  - 横向 energy band(travel up,Pokemon GO raid 风格)
- `RibbonTipEmitter.cs` 在 ribbon 顶端 sub-emitter 飘走小光包(脱离感)

### 3.6 LOD — 扩展 `CairnRibbonLOD.cs`
- 近(<5m):full hero(丝带 + 粒子 + 仪式)
- 中(5-15m):mid(简化丝带,无粒子)
- 远(>15m):**不画 cairn,只画箭头**

---

## 4. AR 修复(Branch A + B)

### 4.1 GroundYResolver 不动 anchor 子物件 (Branch A Step 1, R1 致命 1 修复)

**改 `GroundYResolver.cs:651-728` Update 循环**:

```csharp
for (int i = _tracks.Count - 1; i >= 0; i--) {
    var t = _tracks[i];
    // v0.2.4: anchor 是 truth,resolver 不再干预
    if (t.go.GetComponentInParent<ARAnchor>() != null) {
        // telemetry: emit once
        continue;
    }
    // 原有 lerp 逻辑(仅对未 anchored cairn 有效)
    ...
}
```

### 4.2 Anchor 失败 retry 不立即 Destroy (R1 修复)

**改 `PortalSpawner.cs:609-627`**:

```csharp
if (anchorOnSpawn != null) {
    // 现有路径
} else {
    // v0.2.4: 不再 worldspace fallback,改 retry queue
    container.SetActive(false);  // 暂时隐藏
    var retry = container.AddComponent<PendingAnchorRetry>();
    retry.Init(spawnX, groundY, spawnZ, deadline: 1.0f);
}
```

新建 `PendingAnchorRetry.cs`:
- 每帧重试 raycast
- 命中 → AttachAnchor + container.SetActive(true) + 仪式动画
- 1s 仍失败 → 调用 `bridge.SendToRN("SpawnRejected")` 让 RN 提示用户重试
- **不 Destroy 立即**(v0.2.3 旧行为)

### 4.3 三条件触发器 + 单向锁存 (R1 致命 3 修复)

新建 `CairnAcquireController.cs`(per cairn):

```csharp
enum State { FAR, APPROACH, ACQUIRE, IMMORTAL }

void Update() {
    if (state == IMMORTAL) return;  // 锁存,不再回查

    float distAnchor = Vector3.Distance(camera.position, anchor.position);

    // FAR / APPROACH 状态切换(允许 toggle)
    if (distAnchor > 30) state = FAR;
    else if (distAnchor > 10) state = APPROACH;
    else state = ACQUIRE;

    // ACQUIRE 状态:三条件检测
    if (state == ACQUIRE) {
        // hysteresis: 进入需 cos>0.7 持续 0.8s,退出需 cos<0.3 持续 1.2s
        bool facing = CheckFacingHysteresis();
        bool planeReady = CheckFloorPlaneNearAnchor();

        if (facing && planeReady) {
            TriggerCeremony();
            state = IMMORTAL;  // 锁存
            return;
        }

        // 引导分级
        UpdateGuidance(timeInAcquire);

        // 强制兜底(用户忽略引导)
        if (timeInAcquire > 15.0f && distAnchor < 5.0f) {
            ForceFallbackSpawn();
            state = IMMORTAL;
        }
    }
}
```

### 4.4 距离判定用 Anchor 距离 不用 GPS (R1 修复)

**v0.2.4 入口流程改**:
1. RN 把 mark 数据发给 Unity:lat/lng + plant_anchor_y + plant_tier
2. Unity bulk-spawn 时:
   - GPS lat/lng → ARKit XZ(用 sessionOffset,允许 5-15m 偏)
   - 注入一个**临时 ARAnchor** 在该 XZ + 历史 Y(此 anchor 仅作为"目标位置"持有,不渲染)
3. 之后所有距离判定 = `Vector3.Distance(camera.position, targetAnchor.position)` — **用 anchor 距离**
4. ACQUIRE 三条件齐 → 销毁临时 anchor,重新 attach 到当下扫到的 floor plane(永久 anchor)

### 4.5 Plane 验收硬条件 (R1 致命 1 / 2 修复)

新建 `FloorPlaneValidator.cs`:

```csharp
bool IsValidFloorPlane(ARPlane p, Vector3 worldHitPoint, float cameraY) {
    // 1. 必须 horizontal up
    if (p.alignment != PlaneAlignment.HorizontalUp) return false;

    // 2. LiDAR 设备硬性 floor classification
    if (HasLiDAR && (p.classifications & PlaneClassifications.Floor) == 0) {
        // 但允许 LargePlane 面积 ≥1m² 当 floor 用(草地/泥地)
        if (p.size.x * p.size.y < 1.0f) return false;
    }

    // 3. 法线偏差 ≤20°(防斜坡误判)
    if (Vector3.Angle(p.normal, Vector3.up) > 20f) return false;

    // 4. hit 点高度低于相机 1.0m(防桌面/车顶)
    if (worldHitPoint.y > cameraY - 1.0f) return false;

    // 5. plane extent 稳定 ≥1.5s(防第一帧未收敛)
    if (Time.time - p.firstSeenTime < 1.5f) return false;

    // 6. 面积 ≥0.5m²
    if (p.size.x * p.size.y < 0.5f) return false;

    return true;
}
```

### 4.6 强制兜底(15s,只在 ≤5m,用户忽略引导后)

```csharp
void ForceFallbackSpawn() {
    // 优先:从 camera.position 向下 raycast,找任何水平面
    var hits = new List<ARRaycastHit>();
    if (raycastManager.Raycast(new Ray(camera.position, Vector3.down), hits)) {
        var h = hits.OrderBy(x => x.distance).First();
        SpawnAt(h.pose.position);
        return;
    }

    // 失败:用 camera.y - 1.5m(估计用户身高)spawn 悬空
    var fallbackY = camera.position.y - 1.5f;
    SpawnAt(new Vector3(target.x, fallbackY, target.z));
    // 标记此 cairn 为 "estimated_ground" 上后端 telemetry
}
```

### 4.7 Snap-on-reopen (Branch B v2)

**Spawn 入口**:
- bulk-spawn 时,如果 plant_anchor_y 与当前 ARKit floor plane Y 差 >0.2m → snap 到当前 plane Y
- 历史 Y 仅用于 estimated 兜底(用户从来没扫到地面的极端场景)
- 实际 Y 永远来自当下 ARKit hit.pose

### 4.8 后台 >30s 重定位 (R1 修复)

新建 `ARSessionResumeHandler.cs`:
- 监听 app foreground/background
- background 累计 >30s → 标记需要 relocalize
- foreground 时:
  - 所有 IMMORTAL cairn fade out(0.3s)
  - 调用 `arSession.Reset()` 或等 ARKit 自身 relocalize
  - tracking state 恢复 normal → 重新 raycast snap → fade in
  - 用户感受:屏幕闪一下,cairn 又在那

---

## 5. RN 侧改动(Branch UI)

### 5.1 ARScreen.tsx — handlePlantCairn 简化
- 删除 line 796 "No GPS Available" 强制 require GPS 的 alert
- 改为:有 GPS 用 GPS,没 GPS 用 ARKit world coord(arFrame.camera.position + forward * distance)
- 持久化时:lat/lng + plant_anchor_y(从 Unity 回传)+ plant_tier

### 5.2 远场箭头 UI 新组件 `<DistantMarkerArrow>`
- 监听 mark 列表 + arFrame.camera
- mark 距离 >10m 显示箭头 + 距离
- 箭头方向 5Hz EMA α=0.3 平滑
- 距离 ≤10m 切换到 Unity AR 渲染(隐藏 RN 箭头)

### 5.3 引导提示 UI 新组件 `<AcquireGuidance>`
- 接收 Unity 发来的 acquire-state 事件
- 渲染分级提示文字 + 教学小图
- 第一次教学浮层(localStorage 记忆 per-device)

---

## 6. Backend 改动(最小)

### 6.1 markers schema 新增字段
```sql
ALTER TABLE markers ADD COLUMN plant_anchor_y FLOAT NULL;
ALTER TABLE markers ADD COLUMN plant_surface_tier TEXT NULL;
ALTER TABLE markers ADD COLUMN plant_lidar_available BOOLEAN DEFAULT FALSE;
```

### 6.2 telemetry 新事件
- `v22-ACQUIRE-START` — 进入 ACQUIRE state
- `v22-ACQUIRE-CEREMONY` — 三条件齐触发仪式
- `v22-ACQUIRE-FORCE-FALLBACK` — 15s 强制兜底
- `v22-CAIRN-IMMORTAL` — IMMORTAL 状态确立
- `v22-RESUME-RELOCALIZE` — 后台回前台 relocalize
- 全部上 阿里云 debug_snapshots

---

## 7. OTA 参数清单(全部默认开,可调)

```
GuidanceStartDistance: 10.0
GuidanceForceFallbackDistance: 5.0
GuidanceForceFallbackDuration: 15.0
GuidanceTipT0: 0  # 进入 acquire 立即提示
GuidanceTipT1: 3  # 继续扫描
GuidanceTipT2: 5  # 镜头朝下
GuidanceTipT3: 10 # 蹲下/走动教学
ArrowUpdateHz: 5.0
ArrowEMAAlpha: 0.3
AcquireFacingHystEnter: 0.7
AcquireFacingHystExit: 0.3
AcquireFacingHystEnterDuration: 0.8
AcquireFacingHystExitDuration: 1.2
PlaneValidatorMaxNormalAngle: 20.0
PlaneValidatorMinAreaM2: 0.5
PlaneValidatorMaxHeightBelowCam: 1.0
PlaneValidatorMinExtentStableSec: 1.5
ARMeshManagerEnabled: true
ARMeshClassificationEnabled: true
ResumeRelocalizeBgThresholdSec: 30
ARWorldMapPersistenceEnabled: true
ARCoreGeospatialEnabled: false  # v0.2.4 默认关,城区测试时打开
PendingAnchorRetryDeadlineSec: 1.0
```

---

## 8. 文件改动清单

### 新建
- `UnityARLib/Assets/Scripts/CairnAcquireController.cs`
- `UnityARLib/Assets/Scripts/FloorPlaneValidator.cs`
- `UnityARLib/Assets/Scripts/PendingAnchorRetry.cs`
- `UnityARLib/Assets/Scripts/ARSessionResumeHandler.cs`
- `UnityARLib/Assets/Scripts/CeremonyController.cs`
- `UnityARLib/Assets/Scripts/JunctionArrowsController.cs`
- `UnityARLib/Assets/Scripts/SilkRibbonV2.cs`
- `UnityARLib/Assets/Scripts/RibbonTipEmitter.cs`
- `UnityARLib/Assets/Shaders/RuneSDFShader.shader`
- `UnityARLib/Assets/Shaders/RibbonSilkV2.shader`
- `UnityARLib/Assets/Prefabs/Particles/Particle_cairn.prefab`
- `UnityARLib/Assets/Prefabs/Particles/Particle_water.prefab`
- `UnityARLib/Assets/Prefabs/Particles/Particle_danger.prefab`
- `UnityARLib/Assets/Prefabs/Particles/Particle_hut.prefab`
- `app/src/components/DistantMarkerArrow.tsx`
- `app/src/components/AcquireGuidance.tsx`
- `backend/src/migrations/013_marker_anchor_y.sql`

### 修改
- `UnityARLib/Assets/Scripts/GroundYResolver.cs` — 不动 anchor 子物件
- `UnityARLib/Assets/Scripts/PortalSpawner.cs` — anchor retry,不立即 Destroy
- `UnityARLib/Assets/Scripts/PortalSpawnerV199.cs` — 同步策略到 V199 异步路径
- `UnityARLib/Assets/Scripts/MultiSpawner.cs` — 同步
- `UnityARLib/Assets/Scripts/CairnBridge.cs` — sessionOffset 5m 软门 + 平滑
- `UnityARLib/Assets/Scripts/CairnGlobalsExt.cs` — 加新 OTA keys
- `UnityARLib/Assets/Scripts/CairnRibbonLOD.cs` — 三档 LOD shader keyword
- `UnityARLib/Assets/Shaders/CairnConeCore.shader` — 接 RibbonSilkV2 思想(向上变浅,顶端淡出)
- `UnityARLib/Assets/Shaders/PortalRingShader.shader` — `_SweepAngle` discard
- `app/src/screens/ARScreen.tsx` — 删 GPS require,加 DistantMarkerArrow + AcquireGuidance
- `app/src/services/unityCairnSpawn.ts` — 加 plant_anchor_y / plant_tier 字段

### 删除/弃用
- v0.2.3 PortalSpawnerV199.cs:1126-1144 anchor-async-FAIL Destroy 路径
- ARScreen.tsx:796 "No GPS Available" alert
- GroundYResolver Tier-A 用 plane.center.y 的代码(留 hit.pose.y 路径)

---

## 9. 测试范围(上海 100% 通过)

### 9.1 必测场景

| 场景 | 设备 | 期望 |
|---|---|---|
| 同手机 plant + 5min 后回访 | iPhone X | ARWorldMap 重定位,0 偏移 |
| 同手机 plant + 切微信 30s 回 | iPhone X | fade out + relocalize + fade in,无感 |
| 同手机 plant + cold start | iPhone X | bulk-spawn snap-to-current-ground,贴地 |
| Plant 在桌面 / 椅子 / 沙发 / 地毯 | iPhone X | 正常实化(plant 接受任何表面) |
| 重开后 plant 桌面的 cairn | iPhone X | snap 到当下扫到的真地面(桌面已撤走) |
| 远场箭头跟随用户走 100m | iPhone X | 箭头永远准确,无抖动 |
| 走近 10m 抬手机扫地 | iPhone X | 1-3s 内仪式 |
| 走近 ≤5m **故意不抬手机** | iPhone X | 15s 后强制兜底 spawn |
| 走近后退后再来 | iPhone X | mark 永久在原位,无飘 |
| 同时 5 个 cairn 在视野 | iPhone X | LOD 工作,无性能崩 |

### 9.2 跨设备(选测,非阻塞)
- iPhone X plant → Android 找(ARCore Geospatial 上海可用)
- 跨账号好友分享(GPS 兜底)

### 9.3 不在 v0.2.4 范围
- NZ 真机测试(用户:"NZ 是未来的事")
- 5 年长期跨设备验证(技术路径已建立,实测留 v0.3+)
- 自实现照片指纹 ML(留 v1.0+ 护城河)

---

## 10. 工作量估计

| 模块 | 估时 |
|---|---|
| Branch A: GroundYResolver / PortalSpawner / Anchor retry / sessionOffset | 1 周 |
| Branch B: Plant accept-anywhere / Snap-on-reopen / 三条件 / 强制兜底 | 1.5 周 |
| Branch C: 5 type 粒子 / 仪式 / RibbonSilkV2 / SDF rune | 3 周 |
| Branch D: ARWorldMap / Geospatial / GPS+IMU 三档 + 锁定 | 1.5 周 |
| RN UI: DistantMarkerArrow / AcquireGuidance / handlePlant 重构 | 1 周 |
| Backend: schema migration + telemetry events | 0.5 周 |
| 上海真机测试 + 调优 | 1 周 |
| **合计** | **9-10 周** |

---

## 11. 风险列表

| 风险 | 缓解 |
|---|---|
| ARWorldMap 跨光线/季节 relocalize 失败 | confidence <0.7 强制降级到档 B/C |
| ARCore Geospatial 上海郊外覆盖差 | 档 C GPS+IMU 兜底 |
| iOS 18→19 升级 ARWorldMap 兼容性 | 序列化时存 ARKit version,版本不匹配走重建 |
| iPhone SE 老设备性能 | LOD + 同屏仪式上限 1 + 粒子降级 |
| 用户 plant 时 ARKit 还没收敛 | extent 稳定 ≥1.5s 才接受 plane(已纳入 FloorPlaneValidator) |
| GPS 在隧道/室内乱跳 | 箭头冻结最后已知方向 + 灰色 |
| 强制兜底 spawn 在错位置 | 第一次 telemetry 后 OTA 调整阈值 |

---

## 12. 不做(明确范围,避免膨胀)

- ❌ 多模态 re-find(plant 时拍 4 张照片)— 用户拒绝,系统负担
- ❌ "就在这里"应急按钮 — 用户拒绝,保持严谨
- ❌ NZ trail 真机测试 — 未来事
- ❌ 自实现照片指纹 ML — v1.0+ 护城河
- ❌ Niantic Lightship VPS — vendor lock + NZ 无 wayspot
- ❌ ARWorldMap 跨设备(Apple 不支持)
- ❌ 30m 外显示半透明 ghost cairn — 改路线为箭头

---

## 13. 完成定义(DoD)

- [ ] 上海真机所有 §9.1 必测场景通过
- [ ] 所有 OTA key 默认值 ship,可后期调
- [ ] Telemetry 事件全上后端
- [ ] 5 type 粒子 / 仪式 / RibbonSilkV2 / SDF rune 与 variant_C_3D.html 视觉等效
- [ ] 5 铁律全部满足:不飘 / 在地 / 能展示 / 有动效 / 有指引
- [ ] 不 push github(用户铁律)
- [ ] 不 EAS build / 不 OTA(除非用户确认)
- [ ] commit 记录大改动(用户允许)

---

## 14. 接下来流程

1. **Subagent challenge** — 独立挑战这份 plan(技术 / UX / 数据三视角)
2. **来回讨论** — 我和 subagent 收敛
3. **全部技术问题解决** → 开工
4. **产品问题** → 回来问用户
