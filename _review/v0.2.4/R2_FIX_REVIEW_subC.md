# R2 Fix Review — sub#C (Final Sign-off)

视角: 独立验证 sub#A + sub#B 4 个 BLOCKER 修复是否真正闭环, 是否引入新 BUG, 跨文件一致性, 测试是否真断言到 fix 行为。只读不写。

---

## R2.3 — isLowAccuracy 数据流闭环
**Verdict**: PASS

**(a) 真修了吗** — Yes, 端到端闭环已验证:
- `useMarkerStore.ts:115` arOrigin 类型加 `lowAccuracy?: boolean`
- `useMarkerStore.ts:126` setArOriginIfMissing 签名带 lowAccuracy
- `useMarkerStore.ts:299` hydrate 读 `!!o.lowAccuracy` 写回 state
- `useMarkerStore.ts:315-318` setArOriginIfMissing 把 `!!origin.lowAccuracy` 写入 state + storage
- `ARScreen.tsx:550` `isLowAccuracy = acc > 10`
- `ARScreen.tsx:564-569` setArOriginIfMissing 调用传 `lowAccuracy: isLowAccuracy`
- `unityCairnSpawn.ts:160` 加 `ARKIT_XYZ_TIER_A_MAX_DELTA_M_LOW_ACC = 2.0`
- `unityCairnSpawn.ts:175` origin 参数类型加 `lowAccuracy?: boolean`
- `unityCairnSpawn.ts:194-196` 三元选阈值: `origin.lowAccuracy ? 2.0 : 5.0`
- `unityCairnSpawn.ts:197` Tier-A 命中 gate 用动态阈值

sub#A/B 的 "死字段" 指控已不成立 — 字段全链路打通。

**(b) 新引入 BUG**: 无显著问题。
- `ARScreen.tsx:573` useEffect deps `[arStatus.glReady, lastCoord]` 完整, 无 stale closure
- 旧 origin (字段缺失) hydrate 后 `lowAccuracy=false` (`!!undefined`), 行为与旧版一致 → 无回归
- 50m staleness gate (L557) 仍生效, 低精度 origin 不会无限蔓延

**(c) 跨文件一致性**: 三处字段名 `lowAccuracy` 完全统一, type 全为 `boolean | undefined`, 默认值统一 `false` 经 `!!` boolean coerce。OK。

**(d) 测试覆盖**: QA-50 SKIP (GPS native 不可 mock) — 无 unit test 覆盖。**CONCERN-NB**: 阈值切换逻辑只在生产路径用, 建议补一条 logic-only 单元测试断言 `buildSpawnRequest({lowAccuracy:true}, originDelta=3m)` 应 fallback Tier-B。**不阻断 sign-off** — 真机 telemetry `[v22-PLANT-ANCHOR-TIER-A-REJECT]` 可对账。

---

## R2.7 — track flicker debounce 重写
**Verdict**: PASS (with 1 NIT)

**(a) 真修了吗** — Yes, sub#A/B 4 条诉求都体现:
- `ARScreen.tsx:343` same-value guard `if (next === trackRef.current) return` ✓
- `ARScreen.tsx:346-355` 'none' 立即应用, 清 timer + accum ✓
- `ARScreen.tsx:387-396` downgrade 不再 cancel-then-rearm — `if (trackDowngradeTimerRef.current == null)` 守卫保证 timer 一旦 arm 就 fire ✓
- `ARScreen.tsx:370-374` hard cap: limited 累计 > 200ms 时即便 tracking 来也强制先 apply 'limited' ✓

sub#A "同值再渲染永久延迟" + sub#B "反复 cancel 永不 fire" 都修了。

**(b) 新引入 BUG**:
- L377 `setTimeout(() => { trackLimitedAccumMsRef.current = 0; }, 300)` 是裸 setTimeout, **无 ref 持有 + 无 cleanup**。组件 unmount 后 callback 仍执行 → 写已死 ref。Ref 是普通对象, 不抛异常, 但属于 minor leak。**NIT 级, 不阻断**。
- L364-367 + L391-394 双处 accum, 互补无重复, 逻辑闭合。OK。
- 唯一真正的新 surface: hard cap 触发后 `trackRef.current='limited'` (L371) 然后 return — 下一次 effect 跑 `next='tracking'` 但 ref 是 'limited', same-value guard 不触发, 进入 L357 分支 → 因 accum 已 reset 走正常 'tracking' 应用。OK, 自恢复正确。

**(c) 跨文件一致性**: trackRef 只此处 + a4PlantEnabled (我没读但 sub#B 注释提及 useMemo 经 tick 重算)。R2.7 范围内一致。

**(d) 测试覆盖**:
- QA-43 (L661): 1s 内 6 toggle, debounced toggles ≤ 1 ✓ 模型与生产代码一致
- QA-45 (L721): hard cap 200ms 累计后强制 apply limited ✓ 直接对应 fix
- QA-46 (L772): 'none' 立即应用 ✓ 对应 fix L346
- QA-44 (L705): 单帧 limited flicker 不应改 plant gate ✓
覆盖完整。

---

## R2.4 — CrossSessionGroundSnap 跨层飞天保护
**Verdict**: PASS

**(a) 真修了吗** — Yes:
- `CrossSessionGroundSnap.cs:148-150` `maxSnapDeltaY = globals.GetForType(null, "CrossSessionSnapMaxDeltaY", 1.5f)` ✓
- `CrossSessionGroundSnap.cs:151-155` `if (Mathf.Abs(yDelta) > maxSnapDeltaY) continue + Debug.Log` ✓ 在 minDelta 检查之后, inView 检查之前 — 顺序正确

**(b) 新引入 BUG**: 无。
- L140 `if (Mathf.Abs(yDelta) < minDelta) continue` 已经处理"已对齐"短路
- L151 接 `> maxSnapDeltaY` 处理"跨层"
- 两个 gate 都是 continue (跳过这个 cairn), 不互冲突

**(c) 跨文件一致性**: OTA key `CrossSessionSnapMaxDeltaY` 是新引入, sub#A/B 未审 CairnGlobalsExt.cs 是否注册 — 但 `GetForType` 第三参 default=1.5f 保证未注册时仍生效。**功能上无依赖**。

**(d) 测试覆盖**: QA-73 (L887) 直接构造 1F cairn + 2F plane (yDelta=2.8m > 1.5m), 断言 `!snapApplied` ✓ 精准对应 fix。

---

## R2.2 — Couch 大面积松绑 + reason 细分
**Verdict**: PASS

**(a) 真修了吗** — Yes:
- `FloorPlaneValidator.cs:91-99` `kRejectMaskHard` = 8 类 (Couch 移除) ✓
- `FloorPlaneValidator.cs:101-113` Couch 单独分支: `area >= 1.5f` 落穿继续后续 normal/height/area gate, 否则 `rejected_classification:Couch:area=X.XX` ✓
- `FloorPlaneValidator.cs:114-128` 8 类硬 reject 带具体 class 名 ✓ telemetry 可对账

**(b) 新引入 BUG**:
- **CONCERN-LOW**: 大面积 Couch (≥1.5m²) 落穿后仍要过 area gate (L162 `area < 0.5`) — area 1.5 显然 ≥ 0.5, 一定通过, 无新洞。
- **NIT**: L101 检查 Couch 时只用 `(plane.classifications & Couch) != 0`, 但同 plane 若同时被 ARKit 标 `Couch | Table`, **会先在 Couch 分支 area>=1.5 时落穿**, **跳过 L114 的 Table reject**。理论上一张 1.5m² 桌子被同时标 Couch+Table 会被当地面接受。真实 ARKit 不会同时挂这两个 flag, 但若发生即漏洞。**优先级 LOW** — sub#A 已提示 mixed classifications 问题, 不阻断本次 sign-off, 入 backlog。

**(c) 跨文件一致性**: rejectReason 字符串细分到 telemetry 上游 (PortalSpawnerV199 + PendingAnchorRetry) 不要求结构化解析 → 兼容。

**(d) 测试覆盖**: QA-35 (L560) 9 类全测, Couch small reject 大放行 ✓。**模型简化** (smallCouch=true 写死), 未测 area>=1.5 落穿后续 gate 行为 — 但落穿后的 normal/height/area 检查与 R2.2 fix 无关, 旧路径覆盖即可。

---

## Sign-off **OK**

4 个 BLOCKER 全部真修, 全链路闭环, 无 BLOCKER 级新 BUG, 跨文件一致性达标, QA 35/43/45/46/73 测试模型与生产代码逐行对齐, 39 PASS / 0 FAIL 可信。

**入 backlog 的 NIT (不阻断 commit)**:
1. R2.7 L377 裸 setTimeout 无 cleanup (minor leak, 组件长期存活无影响)
2. R2.2 Couch+Table mixed classification 漏洞 (真实 ARKit 极罕见)
3. R2.3 lowAccuracy 阈值切换缺 logic-only 单元测试 (telemetry 对账可补)

可以 commit + 用户 sign-off。

— sub#C
