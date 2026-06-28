# v383 Plan Final — Defense (sub#3)

**Role**: 防守方 reviewer. 立场: 看好这份 plan, 任务是写出能让用户信服 plan 可以下场写代码的最强 3 条证据.
**Method**: 反证法 — 每条证据先说"如果 plan 不这样做会发生什么", 再说"plan 这样做后被消除".
**Scope**: 只读 plan-final / review#1 / review#2; 不假设代码细节.

---

## 证据 1 — plan §0 用 5 个 backend 事实 把 review#1 的 4 个 Blocker 中的 3 个直接证伪了 (不是 mitigate, 是消除)

**支撑**:
- plan-final §0 第 1 行: `DELETE FROM memory_points WHERE user_id = ?` (bulk hard-delete) — 来自 `backend/src/routes/memory.js:180-191` 真读, 不是猜.
- plan-final §0 第 2 行: `POST /api/sessions` 不强制 ts 严格递增, 也不强制 ts 字段存在 — 来自 `backend/src/routes/sessions.js:36-39` 真读.
- plan-final §0 第 5 行: 9163 真实 session (id=46, 87 点 / 877m / 1073s) 的 `route_points` **完全没有 ts 字段**, 只有 `{lat, lng, alt}` — Aliyun DB 查询.
- plan-final §0 第 4 行: `GET /api/auth/me` 真实存在, 返回 `{user: {id, email, name, ...}}` — `backend/src/routes/auth.js:275-287` 真读.
- 这 4 个事实直接对应消除:
  - Review#1 §3.1 [Blocker]: "DELETE /api/memory/points 是否 wired 未验证" → §0 第 1 行已读 `routes/memory.js:180-191`, 确认是 bulk hard-delete. plan §A3 落地 wipe + post-wipe verify 两步.
  - Review#1 §2.1 [Blocker]: "Loop concat ts seam will duplicate ts" → §0 第 2 + 第 5 行联合证伪: 真实 hike 根本不存 ts. plan §A2 直接 DROP ts 字段, seam 问题不存在.
  - Review#1 §4.1 [Blocker]: "Backend ts strict-increase constraint unknown will POST 400" → §0 第 2 + 第 5 行联合证伪: backend 不强制 ts, 9163 也没 ts. plan §A2 写 `[{lat, lng}, ...]` only, 跟 9163 一致.
  - Review#1 §7.5 [Medium]: "ALLOWED_UIDS check missing in A2 fix sequence" → §0 第 4 行确认 `/api/auth/me` 存在, plan §A0 第 3 步落地 `assert user.id ∈ ALLOWED_UIDS`, 不是空喊.

**为什么这一条最强**:
反证: 如果 plan 不做这 5 个 backend fact-check, 而是按 v383-plan.md 原稿 (Directions API + ts seam + 不验 DELETE) 下场写代码, 会发生什么?
1. mock 脚本 POST /api/sessions 会把 ts 字段写进去 — 跟 9163 不一致, 用户立刻看出"和正常 hike 不一样" (违反用户原话铁律 1).
2. DELETE /api/memory/points 调一次但不验, 如果 endpoint 是 per-point 或者 soft-delete, memory wipe 静默失败 — 用户下次打开 app 还看到旧 memory (违反用户原话 2 的根因).
3. Loop concat 在 seam 处 ts duplicate 触发 backend 拒绝或 client replay 卡顿 — mock 数据视觉上有"停顿尖角" — 违反铁律 1.

plan §0 这一步把这 3 个失败模式从"可能发生且 mitigate 难"降级到"不可能发生因为前提就不成立". 这是**消除**, 不是 mitigate. Review#1 同意 (§0 自己说 R1.4.1/4.2 Blockers **moot**).

这一条最强的原因: **它是整份 plan 唯一一处把上一轮 review 的 Blocker 用真实数据直接证伪而不是绕过去的地方**. 其他段落是设计选择 (可争议), §0 是事实陈述 (不可争议).

---

## 证据 2 — plan §B0 + §B2 直击用户原话的 "原句执行" — 不是猜, 不是经验, 是逐字对照

**支撑**:
- 用户原话 3: "Flag detail 圆圈太大了" → Review#2 §2 [High] 抓出原 plan 错误方向: "removing scale 0.75 makes detail bigger, opposite of user complaint." plan-final §B2 完全反转, 明确写出 `PIN_SIZE_MEMORY = 52` 和 `PIN_SIZE_DETAIL = 36`, 并在 plan §B2 里逐字回应: "Detail at 36px is smaller than v382's effective 39px (52 × 0.75). User's complaint is addressed."
  - 36 < 39 是算术事实, 用户看 detail pin 一定更小. 这条 AC 不靠"我们觉得". 靠数字.

- 用户原话 2: "Memory 我看到很多皇冠 但是他们的圆呢 没有了" → Review#2 §1 [High] 抓出原 plan 假设 "iOS clips PointAnnotation children" 没证据, 跟现象矛盾 (detail 页同组件不 clip). plan-final §B0 引入 **30 分钟 root-cause 实验** 作为 B-section 所有代码的强制 gate:
  1. `onLayout` log + iOS 3x 截图, 测 core 实际宽高 + 位置.
  2. 三叉决策树 (clipping / 0px / shadow-bleed) 决定走哪条 fix path.
  3. "No B code lands without this evidence" — 写在 plan §B0 末尾, 不是建议是 gate.

- 用户原话 4: "皇冠颜色非常淡" → Review#2 §3 [High] 抓出原 plan 的 stroke 0.5 跨平台不一致 + 暗黑模式没考虑. plan-final §B3 按平台拆分:
  - iOS: SVG `<feDropShadow>` filter (跟 v10 HTML 一致, 不是近似).
  - Android: 双绘 fallback (大一号 tierGlow halo + 正常 crest 上层).
  - 暗黑地图: 自动切换 stroke 颜色到 `rgba(255,255,255,0.7)`.
  - **不偷偷改 crest 尺寸** (Review#2 §3(c) 抓的 Spec Drift, plan §B3 末尾明确写 "Crest geometry stays 20×16 — no stealth size change to 24×20").

**为什么这一条最强**:
反证: 如果 plan 不做 §B0 实验 + 不引入 PIN_SIZE_DETAIL 常量, 直接按原 plan 下场写代码, 会发生什么?
1. detail pin 从 39px 变 52px, 用户立刻发回弹: "我说太大了你做得更大了" — 直接二次返工.
2. Memory map 走错 fix 路径 (假如 root cause 是 shadow-bleed 而 plan 当成 clipping), 改了 layout 但 core 还是看不见 — 用户再次发回弹 "皇冠在但圆还是没有".
3. iOS 用上 Android 的 stroke fallback, 牺牲了 v10 原本就有的 drop-shadow glow — iOS 视觉**比 v382 更差**. Review#2 §3(d) 已经预警这是 "regresses iOS from could-have-proper-glow to doubled-up dark outline".

plan-final §B0 + §B2 + §B3 这三段是**逐条 verbatim 对照用户原话再下设计**. 每一条都引数字 (39 vs 36) 或引证据要求 (onLayout log + iOS 截图) 或引 v10 HTML baseline (filter). 不是"我们觉得用户会喜欢", 是"用户原话第 N 句要求 X, 我们做 X".

这一条最强的原因: **它把用户原话从"模糊感受"翻译成"可证伪 AC"**. plan §D3 表第 3 行 "iOS native pin render" 就是用 Expo dev client 在 3 个 viewport + 暗黑 + 亮模式拍 native 截图做 4-eye qualitative review — 跟用户最终验收同口径.

---

## 证据 3 — plan §A7 + §C 用"程序化检测 + 严格隔离 + sprite-as-canonical" 三件套消除了 review 反复警告的 LLM 主观判断盲区

**支撑**:
- Review#1 §6.1 [Blocker]: "4-eye review 看同一张 PNG 两个 subagent 给出几乎一样的判断, 不是 4 眼是 2 眼 + LLM rubber-stamp." → plan-final §A7 三层消除:
  1. **shapely + Overpass programmatic gate** (§A7 第 2 段): polyline ∩ buildings via `shapely.intersects`, 输出 `crossings.json` (lat/lng + OSM way id). 不依赖 LLM 看图. 数字: crossings > 0 → mock 脚本直接 abort.
  2. **Adversarial subagent framing** (§A7 第 3 段): sub#1 = "defend this polyline is real hike", sub#2 = "find 3 problems". 不同 prompt → 不同 reasoning path. 不是双 cover 同一意见.
  3. **不同 evidence**: sub#1 给 z17 PNGs, sub#2 给 z14 + crossings.json + OSM building overlay. 看的东西不一样, 不可能 rubber-stamp.

- Review#1 §6.2 [Critical]: "z14 看不清 building, 穿楼检测是 theater." → plan-final §A7 第 1 段 "Visual gate uses z17 minimum" + shapely 跑前置, z14 只给 sub#2 当 second evidence. 检测不再靠肉眼看 z14 的 3-pixel building blob.

- Review#2 §4 [Medium-High]: "SSIM 0.92 uncalibrated, gradient vs flat fill 必然不达标." → plan-final §B4 选 **(b) sprite-as-canonical**: SymbolLayer 直接渲染从 v10 HTML 烤出来的 PNG, iOS/Android 同一份 PNG. **SSIM gate 取消**. visual gate 变成 "bake script PNG vs v10 HTML PNG, ≥ 95% pixels within delta-E 8, 用 v10 HTML vs 自己 (=100%) 和 v10 HTML vs v382 flat render (~60%) 做 calibration anchor". 这是有 lower bound + upper bound 的数字, 不是凭感觉拍 0.92.

- Review#2 §5 [High] free legacy 类型: → plan-final §C2 落地 Mapbox `coalesce` style expression: `iconImage: ['coalesce', ['get', 'sprite'], 'pin-self-cairn']`. 即使未来出现新 type 没烤 sprite, 也不会静默消失, fallback 到 cairn-default. 这是**编译期无关 runtime 容错**, sub#4 攻击不到.

- Review#2 §7 [High] onPress underspecified → plan-final §C4 给出完整 TS 代码 + Mapbox style 表达式, **包括 stable feature.id** (避免 Mapbox 重传整个 collection 引起 flicker), 包括 symbolSortKey self pin 优先, 包括 zoom < 13 禁止 tap 的 a11y mitigation.

- Review#2 §9.4 [High] OTA sprite cache → plan-final §C8 直接落: sprite 名带版本后缀 `pin-{tier}-{type}-v383.png`. 每次 OTA 改 sprite 就 bump suffix → Mapbox image cache 必然 miss → 新 sprite 必然加载. **零成本**.

**为什么这一条最强**:
反证: 如果 plan 不做 §A7 三件套 + §B4 sprite-as-canonical + §C2 coalesce, 而是按原 plan 用 SSIM 0.92 + 主观 4-eye PNG review + 严格 5 type sprite, 会发生什么?
1. 穿楼检测靠 LLM 看 z14: 跟 v333 review-loop premise check 失败模式一样 — sub#1 + sub#2 同样的 Opus 看同样的 z14 PNG, 同样 anchor 在 polyline 颜色上, 同样判断 "看起来 OK", 然后用户真机一看穿了 3 栋楼. 跟 v236 radius=unlimited bug 一类 (memory note `feedback_api_integration_test.md`: 必须靠真实 integration test 不能靠静态 review).
2. SSIM 0.92 因为 RN 用 flat fill 而 v10 用 radial gradient, 必然不达标 → gate 永远 fail → 要么改门槛 (失去意义) 要么写 gradient (爆 scope). plan §B4 (b) 直接绕开: 用 SymbolLayer + sprite, 沟里没有.
3. 严格 5 type sprite 在生产 DB 出现一条 free type 时, SymbolLayer 静默不渲染 → 用户看不见一个 pin → "皇冠和圆都没有" 第二季. plan §C2 coalesce 一行 Mapbox 表达式消除.

这一条最强的原因: **它直面 LLM 作为 reviewer 的根本盲区 (mode collapse, anchoring), 并给出**三层**不靠 LLM 的客观 gate**:
- 第 1 层: shapely 程序化 (数学事实, 不靠 LLM).
- 第 2 层: adversarial 不同 prompt + 不同 evidence (即使 LLM mode collapse, 也是在不同维度 collapse).
- 第 3 层: sprite-as-canonical (烤出来什么样就什么样, iOS/Android 同一份 PNG, 没有跨平台渲染差异需要 LLM 判断).

跟用户 memory `feedback_review_loop_premise_check.md` (v333 FLOOR_RADIUS 11 轮 review 同参数摇摆) + `feedback_subagent_double_check.md` (subagent "100% confirmed" 是幻觉) + `feedback_user_reports_are_truth.md` 一致同口径.

---

## 诚实声明 (plan 还薄弱的地方, 留给 sub#4)

我作为防守方, 即使站在看好的立场, 必须诚实标记这些地方仍然薄弱, 沒在以上 3 条强证据里:

1. **§B0 实验本身是 30 分钟的承诺**: 如果 onLayout 实验数据不能干净分类成"clipping / 0px / shadow-bleed"三档, 而是显示混合症状, plan 没有第四条分支. 实际开发可能卡在这.

2. **§A1 Matching → Directions → cycling 三重 fallback 没指定每一档的成功率假设**: 如果 8 个 uid 里有 3 个连 cycling 都 fail, plan §A1 第 5 步 "skip this uid, log loud error" 是 acceptable 但用户铁律 1 是"7 个 mock 都得真实", 1 个 skip 是否触发用户回弹未知.

3. **§C9 + §C10 (dark mode pin + a11y) 都是 known limitation 推到 v384**: 如果用户真机一看 dark map 下 public pin 几乎看不见, 这是不是新一轮"圆没了"? plan 没给临时遮丑.

4. **§A0 第 2 步 authLimiter probe 用 throwaway invalid creds**: 如果 backend authLimiter 对 invalid creds 也计数, probe 本身就消耗配额 — 这个 chicken-and-egg 没说明.

5. **§C3 sprite bake 在 Win vs Linux 子像素差异**: plan §C3 说 "Pin Chromium version + CI lints, manual rebake if drift", 但没说 drift 检测自动 fail CI 还是只 warn. 工艺细节.

这 5 条不阻塞下场写代码 (都不是 Blocker), 但 sub#4 应该挑这些攻.

---

## 最终 Verdict

**APPROVE_WITH_CAVEATS**

3 条强证据足以说服用户 plan 可以下场写代码:
1. §0 backend fact-check 把上一轮 3 个 Blocker 直接证伪 (不是 mitigate).
2. §B0 + §B2 + §B3 逐条 verbatim 回应用户 5 句原话, 用数字 + 实验 + 平台拆分给出可证伪 AC.
3. §A7 + §B4 + §C2/4/8 用 shapely 程序化 + adversarial framing + sprite-as-canonical + coalesce 表达式三件套, 消除 LLM 看图盲区, 不依赖 LLM 主观判断做 gate.

caveats 是上方"诚实声明" 5 条, 但都不阻塞下场. 建议:
- 实施 §E 第 4 步 (B0 root-cause 实验) 之后, 根据实验结果再开 1 轮 mini-review 决定 B-section 走哪条分支.
- §A1 fallback 链跑出第一份 dry-run 之后, 用户人眼过一遍 8 个 uid 的 z17 + crossings.json, 给"7-out-of-8 还是必须 8-out-of-8"的明确接受度.

其他直接下场.
