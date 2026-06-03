# v5 算法 Challenge 报告

> 审查范围: `algorithm-v5.mjs` (实为 algorithm-v4.mjs 文件名, 内含 v5 状态机)
> 审查时间: 2026-05-31
> 审查人: 产品 + 安全审查官

---

## 一句话评估

v5 算法在**主动恶意攻击 (brigade / 强举报)** 的防御上做了认真的多窗口设计, 在**全期 vs 近期权衡**上对短期攻击有韧性; 但在 **(1) 慢速渗透投票**、**(2) 死寂误杀**、**(3) DEAD 不可逆 + 无申诉造成的合法 mark 永久丢失**、**(4) 作者权威无验证机制**、**(5) 持续争议一刀切扼杀复杂地标** 五个方向, 都存在足以被有耐心的攻击者或正常用户群体误触发的真实漏洞。

最危险的不是被刷的算法漏洞, 而是**死亡不可逆 + 没有申诉机制 + 季节性死寂误杀**这一组合 — 一个真实的 DOC 危险标 (cairn 警示牌、雪崩警告) 完全可能因冬季无人到访被算法判 SUSPICIOUS → CRITICAL → DEAD, 而**这种"沉默死"是最难被察觉、危害最大的 false negative**。

---

## 漏洞清单 (按严重性)

### 🔴 严重

#### S1. 死寂误杀 + DEAD 不可逆 = 季节性危险标永久消失
**描述**: 触发条件 B (`isInSuspiciousPhase`) — 累积 ≥ 10 互动且近 60 天 0 新互动即进 SUSPICIOUS。在新西兰冬季, 高山步道 5-9 月可能整季无人到访, 一个夏天积累了 12 个 likes 的 DOC 雪崩警告标会在冬季第 60 天被判 SUSPICIOUS, 此时 `exposureRateV4` 因近期 0 样本走 fallback (`calendarDays < 30 ? 0.5 : 0.2`), 然后下一次 trendAnalysis 因为 `t.recent.sampleSize === 0` 走 `t.overall.sentiment * 0.8` 路径 — 但 SUSPICIOUS 触发不依赖 sentiment, 一旦进 SUSPICIOUS 而后续仍 0 互动, 累积 ratio 不变 (好的), 但**只要再来一个偶遇者基于"不像危险"误报一次**, ratio 就会被下拉到触发 CRITICAL → HEARTBEAT → DEAD 路径。

**攻击场景 (无须恶意)**:
- DOC 工作人员 2024-12-01 标 cairn 警告 "雪崩区域勿入"
- 整个夏天 (12-3月) 12 个徒步者点 like, ratio = 12/12 = 1.0
- 5-9月冬季封山, 0 互动
- 2025-09-15 (60 天死寂) → 进 SUSPICIOUS
- 2025-09-20 第一个开山徒步者觉得 "看不到雪了" 误报 outdated × 1.2
- 2025-10-01 又一人误报, ratio 12/14 = 0.857 (仍未触发 H), 但 recent14 有 2 reports 0 likes
- **关键**: 算法此时 recent_sentiment 已为 -1.0, 触发 isInSuspiciousPhase D 条件持续保持, 后续如果 6 个月内再有 3-5 个误报 (登山者觉得"我没看到雪"), 触发条件 E (`total >= 30 && cumLikes / total < 0.5`) 不到, 但触发条件 H (累积 30 + ratio < 0.55) 也不到 — 然而 `isInCriticalPhase` 第 1 条 `ratio < 0.40 && total >= 8` 一旦触发, 直接病危。

**当前算法表现**:
- DEAD 不可逆 (`reviveCheck` 的 C 档明确说"不可远程续命")
- 算法层无法区分"季节性死寂" vs "持续衰退"
- `revivedAt` 字段定义但 `reviveCheck` 返回 A 档时未在 `markerStatusV4` 中检查 trial 期保护

**严重性**: 🔴 — DOC 救命标的 false negative 可能直接导致登山者死亡。这是**生命安全级别**的漏洞。

**建议解决方向**:
- **算法**: `isInSuspiciousPhase B` 加季节性豁免 — 累积 ≥ 5 个 likes 且近 365 天有过 ≥ 1 like 时不触发死寂规则
- **平台**: DOC/SAR 标用单独的"权威 mark"通道, 不走口碑算法
- **UI**: SUSPICIOUS 状态下给 mark 作者 30 天倒计时 push 提醒"你的标快被下掉了"
- **架构**: DEAD 应有 30 天"墓地期", 期间任何新 like 立即复活

---

#### S2. authorRole 无验证 = 任何用户可声明 'official' 拿 1.5× 寿命
**描述**: `AUTHOR_ROLE_BOOST.official = 1.5`, 算法层接受 `authorRole` 字段无任何验证。如果 app 层只在创建时让用户勾选 "I'm DOC/SAR/Police", 而后端无身份认证, 任何攻击者声明 official 即获 1.5× baseLifetime + 救命级保护。

**攻击场景**:
- 攻击者注册账号, 在某商业步道创建 100 个 'scenic' mark, 每个 authorRole='official'
- 这些 mark 获得 baseLifetime = 180 × 1.5 = 270 天保护期
- 再叠加 ageDecay (≤ 365 天 = 1.0) → 实际寿命极长
- 即使收到 reports, 因 base 极长, 短期难以打到 DEAD 阈值

**当前算法表现**: 算法盲目信任 `marker.authorRole`, 没有任何 sanity check。`createMarkerV4({authorRole})` 是 string 入参, 无白名单。

**严重性**: 🔴 — 但这本质是"算法 vs 平台"职责划分问题, 算法可以合理地把这交给后端验证。

**建议解决方向**:
- **平台 (主)**: 后端在 createMarker 写入前必须验证用户身份, 算法层从此拿到的 authorRole 已是可信
- **算法 (辅)**: 加 defensive guard — `if (authorRole === 'official' && !marker.verifiedOfficial) authorRole = 'user'`

---

#### S3. 慢速渗透投票 (low-and-slow brigade) — 攻击者绕过 14 天 brigade 检测
**描述**: 触发条件 F (brigade 疑似) 要求 "近 14 天 5+ reports 且 0 likes", 这个窗口太窄。攻击者可用**4 个账号每月 1 个 report, 跨 24 个月共 96 个 reports**, 任何 14 天窗口都最多 1-2 个 report, 永远不触发 F。

**攻击场景**:
- 商业竞争对手要打掉对手商家附近的好 supply mark (累积 50 likes, ratio 1.0)
- 雇 30 个真人, 每人每 60 天 report 1 次, 跨 6 个月 = 90 reports
- 30 天窗口最多看到 15 reports, 14 天窗口最多 7 reports — 但因为是真实 GPS 物理到场, 设备指纹和 GPS 都过得了
- 6 个月后 ratio = 50/(50+90) = 0.357 → 触发条件 H (累积 ≥ 30 + ratio < 0.55 + 近期负) → SUSPICIOUS
- 再继续 → CRITICAL → HEARTBEAT → DEAD

**当前算法表现**: trendAnalysis 的 `ancient` 窗口是"90 天前的全部", 攻击 6 个月后, ancient.sentiment 已被 reports 污染, 趋势看起来"一直在恶化"而非"被攻击"。

**严重性**: 🔴 — 商业刷子完全可以用此手法系统性清除竞争对手附近的 supply mark。

**建议解决方向**:
- **平台**: 跨 mark reporter 行为分析 (这个用户在多个 mark 上 report 了同一商家附近?) — 但 prompt 明确说"算法看不到 reporter 跨 mark 行为"
- **算法**: 加入"reporter 多样性"指标 — 如果 90 天内 reports 来自 < N 个 unique users, 降低 negWeight 权重
- **UI**: 让用户看到 mark 的"举报来源是否多样化"信息, 自行判断

---

#### S4. 持续争议一刀切扼杀复杂地标
**描述**: 触发条件 G (`total >= 10 && ratio in [0.40, 0.65]`) 直接判 SUSPICIOUS, 触发条件 G 内嵌套的 sentimentMult cap 0.5 (line 322) 进一步压寿命。但**复杂地标本身就有争议性**: 例如一个有 50% 难度的瀑布 (一半人觉得壮观给 like, 一半人觉得难走给 dislike report), 这是合法的"对一半人有用的信息"。

**攻击场景 (无须恶意)**:
- 一个高级技术攀岩点, mark type=danger
- 100 个互动: 50 个高手点 like, 50 个新手 report "unsafe_to_visit"
- ratio = 0.5, 触发 G + 持续争议 cap → sentimentMult ≤ 0.5
- danger base = 90, 寿命压到 ≤ 45 天
- 6 个月后死亡, 但这条信息对 50 个高手仍然有效

**当前算法表现**: 算法把"50/50 争议"等同于"质量差", 但这忽略了 "对部分用户群体有价值"的可能。

**严重性**: 🔴 — 在新西兰户外场景, 难度评级和地形偏好造成的争议是常态, 不该被一刀切。

**建议解决方向**:
- **算法**: 持续争议 mark 不进 SUSPICIOUS, 改为 "降曝光 50%" + "UI 标记: 评价分歧大"
- **UI**: 显示分歧而非压制 — "60% 人觉得有用, 40% 人觉得不该来"
- **不解决**: 也是合理选择, 但需要在 PRD 明确"高争议 mark 会被算法弱化"

---

### 🟡 中等

#### M1. 强心剂回退路径未实现
**描述**: prompt 提到"CRITICAL/HEARTBEAT 阶段如果近期出现 likes 应能让算法回退", 但 `markerStatusV4` 只有单向状态判定 — 每次都从空白判定。`isInCriticalPhase` 第 1 条 `ratio < 0.40 && total >= 8` 一旦触发, 即使近 30 天来 5 个新 likes, ratio 仍 < 0.40, 不会回退到 SUSPICIOUS, 直接保持 CRITICAL。

**攻击场景 (合法用户视角)**:
- 一个 mark 被慢速攻击打到 CRITICAL: 8 likes, 13 reports, ratio 0.38
- 真实用户群体反扑, 1 个月内 10 个 likes, 0 reports
- 新累积: 18 likes, 13 reports, ratio = 0.58
- ratio 已不满足 critical 条件, 但 `isInSuspiciousPhase G` 仍触发 (0.40 ≤ 0.58 ≤ 0.65)
- mark 在 SUSPICIOUS 卡住, 30% 曝光下难以快速吸引更多 likes 救命

**当前算法表现**: 状态判定是无状态 + 顺序优先级, 没有 "history-aware" 回退。但因为顺序是 DEAD → HEARTBEAT → CRITICAL → SUSPICIOUS → 健康判断, 当条件不满足时确实会自动"降级"到下一个判断分支, 所以技术上能回退, 只是**回退后仍卡在 SUSPICIOUS 不容易回 HEALTHY**。

**严重性**: 🟡 — 不会造成死亡, 但救命周期长。

**建议解决方向**:
- **算法**: 加 "近 30 天 likeRatio > 0.7 且 ≥ 5 likes" → 直接 BORDERLINE, 跳过 SUSPICIOUS 长尾

---

#### M2. 持续争议 cap 与 SUSPICIOUS 双重触发 — 病情确诊但症状已重
**描述**: line 322 — 持续争议 (累积 ≥ 15 + 60 天 + 0.42-0.58) 直接 cap sentimentMult ≤ 0.5, 同时 `isInSuspiciousPhase G` (累积 ≥ 10 + 0.40-0.65) 也触发。这两个条件高度重叠但作用机制不同 (一个压寿命, 一个改状态), 双重打击下 mark 短时间内寿命崩溃。

**当前算法表现**: 一个 ratio=0.50, total=20 的 mark, sentimentMult ≤ 0.5 + 状态 SUSPICIOUS, 寿命 = 180 × 0.5 - eff, 容易快速进 CRITICAL。

**严重性**: 🟡 — 加速合法争议 mark 的下沉。

**建议解决方向**:
- **算法**: 合并两条规则, 触发争议条件后只压曝光不压寿命, 让 mark 有更长时间收集信号

---

#### M3. ancient 窗口边界产生"沉默期保护漏洞"
**描述**: line 157 — `ancient = sentimentInWindow(marker, now - 90 * MS_PER_DAY, Infinity)`。这是从 90 天前往前看的整体, **包括 mark 创建以来的所有数据但截止到 now-90**。如果 mark 创建于 30 天前, ancient.sampleSize 永远 = 0, trend = 0。攻击者可以专挑**新 mark 的第 31-89 天**集中投放 reports — 此时 ancient.sampleSize < 3, trend 检测失效, 但 recent (30天) 已有大量 reports, weightedSentiment 完全由 recent 主导, 短期攻击无 trend dampener。

**攻击场景**:
- 一个新 supply mark 创建, 第 1-30 天积累 10 likes (在保护期内 timeWeight = 1.0)
- 第 31-60 天, 攻击者投 8 reports
- 30 天后 (mark 第 60 天), recent.sampleSize = 8 (全 reports), ancient.sampleSize = 0 (因为 ancient 看 mark 创建第 1 天到 -30 天, 但 -30 天那时 mark 还没出生)
- trend = 0 (没有 ancient 比较), weightedSentiment 全由 recent.sentiment = -1 主导

等等 — 让我重读: ancient = `sentimentInWindow(marker, now - 90 * MS_PER_DAY, Infinity)` 意思是 "把 now 当成 (now - 90), 然后 windowDays = Infinity" — 即 "从远古到 90 天前" 全部数据。如果 mark 才 60 天, 90 天前的"现在视角"是 mark 出生前 30 天, ancient 就是空的, 这部分确实会绕过 trend 检测。

**严重性**: 🟡 — 仅适用于新 mark, 攻击窗口有限。

**建议解决方向**:
- **算法**: 当 ancient.sampleSize < 3 时, 用 mark 创建至 30 天前作为 ancient 替代, 确保 trend 永不为 0

---

#### M4. info_wrong/wrong_location 1.5× 在小样本下产生"一票否决"
**描述**: `REPORT_SEVERITY` info_wrong = 1.5, wrong_location = 1.5。一个 mark 累积 5 likes, 1 个用户报 info_wrong, posWeight = 5, negWeight = 1.5, sentiment = (5-1.5)/(5+1.5) = 0.538 — 立刻进入 SUSPICIOUS 触发条件 G (0.40-0.65)。

**攻击场景**:
- 攻击者只需在新 mark 累积 3-7 个 likes 后, 投 1 个 info_wrong (有耐心) 或 wrong_location
- 立刻把 ratio 拉进 SUSPICIOUS 区间
- 因为 ratio 用 length 而非 weight 计算, 实际 cumLikes/total = 5/6 = 0.833 不会触发 G — **这反而救了一命**

让我重新看 — `cumLikes = (marker.likes || []).length` 是**计数, 不加权**。所以 ratio 计算是看次数比, 不看 severity 加权。这意味着 1 个 info_wrong = 1 个普通 report 在 ratio 上的贡献, severity 只影响 sentiment。

**当前算法表现**: ratio 用 count, sentiment 用 weighted — 这是双轨制。`isInSuspiciousPhase` 用 ratio 判 G, 用 sentiment 判 A/D, 两者都可被触发。攻击者用 info_wrong 拉低 sentiment 触发 A 比拉低 ratio 容易得多。

**严重性**: 🟡 — info_wrong/wrong_location 1.5× 严重度过高, 鼓励"用一个最重的 reason"成为攻击习惯。

**建议解决方向**:
- **算法**: severity 多样性奖励 — 同一 reason 在 N 天内重复时降权
- **UI**: report 时强制选择多个具体原因, 减少"一键最重"

---

#### M5. cumLikes / total 用 .length, 但被互斥操作篡改
**描述**: `addLikeV4` 互斥删除该用户的 reports — 这意味着如果用户 A 先 report, 后 like, marker.reports 中 A 的 report 被物理删除, 永久丢失。如果攻击者钓鱼让用户先 report (恶意奖励) 再 like (假道歉), 历史 report 痕迹永久消失。

**攻击场景**:
- 攻击者建一个钓鱼活动 "为我的 mark 点赞领奖" 
- 100 个目标用户曾真实 report 这个 mark (因为信息真的不对)
- 现在他们为了奖励来点 like → 100 个 reports 全部从历史中消失
- 算法只能看到 100 个 likes, 完全看不到曾经的负向信号

**当前算法表现**: 互斥规则物理删除而非 "覆盖标记", 历史信号永久丢失。

**严重性**: 🟡 — 钓鱼成本高但可行, 在商业场景值得防。

**建议解决方向**:
- **算法**: 互斥时不删除, 改为 "用最新行为覆盖" — 在 likes/reports 都存, 但加 `superseded: true` 标记, sentimentInWindow 跳过 superseded
- **不解决**: 也合理, 因为追溯权属于平台, 不一定算法层管

---

#### M6. trend 计算只取"绝对值最大"丢失多窗口信息
**描述**: line 168-171 — `for (const tt of trends) { if (Math.abs(tt) > Math.abs(trend)) trend = tt; }` 只保留绝对值最大的趋势。如果 30 天 trend = -0.5 (短期攻击), 90 天 trend = +0.3 (中期向好), 算法只看到 -0.5, 完全丢失 90 天向好信号。

**当前算法表现**: 趋势是单一方向, 无法表达"短期负 + 中期正 = 攻击"和"短期负 + 中期负 = 真衰退"的区别。

**严重性**: 🟡 — 误判有耐心的攻击者为真衰退。

**建议解决方向**:
- **算法**: 保留 trend30 和 trend90 两个变量, 让 sentimentMult 计算时区分 "短期反转 vs 全期下行"

---

### 🟢 轻微 (边界 case)

#### L1. 新 mark < 30 天保护期内 timeWeight = 1.0, 攻击者集中刷
- 第 1-30 天攻击者投 10 reports, 全 timeWeight = 1.0, 没有任何"早期事件衰减"保护
- 但因为 mark 还在年龄 < 365 天 ageDecay = 1.0, 影响有限
- 解决: 前 7 天给 timeWeight 1.5 加成保护新 mark

#### L2. effectiveAgeV4 cap 在 total < 5 时 cap = 0.7, 但 base × 0.7 仍可能 > sentiment-positive base × 0.15
- 一个 5 likes 的 scenic mark, eff cap = base × 0.15 = 27 天
- 一个 4 likes 的同样 mark, eff cap = base × 0.7 = 126 天
- **第 5 个 like 反而压寿命 100 天** — 反直觉但实际可能, 因为之前的 cap 是宽容, 触发 5 后算法变严
- 解决: cap 转换平滑过渡, 不要在 5 那里跳变

#### L3. wilsonLowerBound 函数定义但未被实际调用
- line 97-105 定义 wilsonLowerBound, 全文只在 import 路径外没有调用点
- 死代码, 不影响行为但 prompt 说"Wilson 小样本宽容"实际没用 Wilson, 用的是 (pos-neg)/(pos+neg) 简单 sentiment
- 这跟 prompt 描述不一致, 算法实际没有 Wilson 保护

#### L4. exposureRateV4 老 mark 0 互动 = 0.2, 新 mark 0 互动 = 0.5 — 边界 30 天跳变
- 第 29 天 0 互动 → 0.5
- 第 30 天 0 互动 → 0.2
- 一夜之间曝光降 60%, 不平滑

#### L5. revivedAt 字段定义但 lifeLeft / status 函数都未使用
- `marker.revivedAt = now` 设置但 `markerStatusV4` 不读取
- 续命试用期不影响实际寿命计算, 续命功能形同虚设

#### L6. recent14 (条件 F) 要求 negCount ≥ 5 但 brigade 攻击者会精确投放 4 reports
- 攻击者读源码后, 14 天投 4 reports, 永远不触发 F
- 解决: 改为 ≥ 4 或加随机 jitter

#### L7. ratio 在 total 小时极不稳定
- total = 3 时, ratio 取值只能是 0/3, 1/3, 2/3, 3/3
- 任何 SUSPICIOUS 触发条件用 ratio 时都是粗粒度
- 但条件 G 要求 total ≥ 10, 已经规避

#### L8. 极偏远 mark (年访客 < 10) viewCount 极低, effectiveAgeV4 中 viewBasedDays 小, 几乎不老化
- 这是设计意图 (保护偏远 mark), 但**长寿垃圾** mark 也受益
- 攻击者建一个偏远商业 mark, 自己 1 个 like, 0 view, 几乎不老化, 寿命接近 base × ageDecay 全长
- 解决: 0 view 给最低视图老化下限, 而非按比例

#### L9. recent30 在 isDead 中要求 "近 30 天 0 likes" 才判死, 但攻击者可在死前精准制造 1 个 like 让其卡 HEARTBEAT
- 但 HEARTBEAT 5% 曝光基本等于死亡, 这是细节
- 解决: 不必修, HEARTBEAT 已经接近死亡

#### L10. 递归性 — 用户视图触发 view++ 但 0 互动时不影响算法; 但 viewCount 会持续增加, 在 effectiveAgeV4 中计算 rawViewDays = views/3, 长期高 view + 低互动 mark 反而 effectiveAge 更大寿命更短
- 一个网红打卡点, 大量 view 但少有人 like (路过看一眼就走), eff 被推高, 反而被算死
- 解决: 高 view 时如果 ratio 仍高, 不应该被 eff 杀

---

## 状态切换合理性

| 切换 | 合理性 | 问题 |
|---|---|---|
| HEALTHY → BORDERLINE → WEAK | ✅ 平滑 | 仅 exposureRate 阈值跳变, 0.5/0.8 边界微抖动可接受 |
| HEALTHY → SUSPICIOUS | ⚠️ 不平滑 | 触发条件 A-H 任一立刻进, 没有"接近触发"的 BORDERLINE_RISKY 中间态 |
| SUSPICIOUS → CRITICAL | ✅ 自然 | ratio 阈值连续, 通过持续信号逐步过渡 |
| CRITICAL → HEARTBEAT | ⚠️ 跳变 | ratio 0.40 → 0.25 是阈值跳, 但状态判定是无状态的, 实际可能瞬间从 0.41 → 0.24 跳 2 级 |
| HEARTBEAT → DEAD | ✅ 严格 | 多重条件 (ratio < 0.15 + total ≥ 10 + 近 30 天 0 likes) 防误杀 |
| 任何 → 救命期回退 | ❌ 不存在 | **没有显式回退机制**, 全靠条件不再满足自然脱出, 但 SUSPICIOUS 条件 G 黏滞 (0.40-0.65 占 25% ratio 区间), 难脱出 |
| DEAD → 任何 | ❌ 永不可逆 | 这是 PRD 决定, 但与"季节性死寂"+"无申诉"组合 = 致命漏洞 |

**核心问题**: 状态机是**单向 + 阈值驱动**, 缺乏 "曾经死亡近邻 + 信号反转 = 给救命机会"的回升路径。`reviveCheck` 函数定义了三档判定但 `revivedAt` 字段在主流程中没人读, **续命机制实际未接入**。

---

## 产品现实 vs 算法 mismatch

### 1. AR 打开 = 流量
**问题**: viewCount 在 `recordView` 里 +1, 但 AR 打开后用户可能 30 秒内反复进出, viewCount 暴涨而不代表真实关注度。
**算法影响**: effectiveAgeV4 中 viewBasedDays 被稀释, 高 view 但低互动的 mark 寿命变短。
**建议**: 平台层做防抖 (60 秒内同 mark 同用户只算 1 view), 算法层不变。

### 2. 没有作者认证系统
**问题**: `authorRole = 'official'` 由用户自报, 算法盲目信任 1.5×。
**算法影响**: 见 S2, 中等可被滥用。
**建议**: 平台必须先验证, 不在算法层解决。

### 3. authorRole = 'commercial_spam' 0.5× 的设置时机
**问题**: 这个值什么时候被设上? 平台事后判定后改写? 但 mark 已经积累 sentiment 了, 修改 authorRole 不会重算历史 sentiment, 只影响 baseLife。
**算法影响**: 已被识别的商业刷子的历史信号仍然算入 sentiment, 不公平。
**建议**: 平台识别 commercial_spam 后, 算法层应支持 "重新评估全期 sentiment" 或 "discount 该作者所有历史 likes"。

### 4. 一人一 mark 互斥 (赞/举报二选一)
**问题**: 用户改主意时旧记录物理删除 (见 M5), 历史信号丢失。
**建议**: 改为 "覆盖" 而非 "删除", 保留历史。

### 5. Report severity 假设
**问题**: REPORT_SEVERITY 把 dislike = 0.3 (主观), info_wrong = 1.5 (事实), 但 prompt 强调"没有图片证据, 不给事实型过高权重"。然而 1.5 已经是除 offensive (2.0) 外最高, 与原则相悖。
**建议**: info_wrong/wrong_location 降到 1.0, 与平均看齐, 真实事实型问题靠**多人重复举报**累积, 而非单人重击。

### 6. DOC 标如何区分?
**问题**: `marker.isDoc` 字段存在但全文未被任何函数读取。`docParams` 函数兼容老接口但实际就是 `TYPE_PARAMS_V4[type]`。
**算法影响**: DOC 标和普通用户标在算法里完全一视同仁, 仅靠 authorRole 区分。
**建议**: 要么删除 isDoc 死字段, 要么真正用上 (例如 DOC + danger 组合 baseLife 加倍)。

---

## 我建议的"合理可接受"清单 (这些漏洞**不必修**)

1. **L1 新 mark 前 30 天集中攻击** — 攻击成本仍高 (10 个真人物理到场), 平台层 GPS 验证已挡。
2. **L4 30 天边界 exposure 跳变** — 用户感受不到 30% 差异。
3. **L7 small total ratio 不稳定** — total ≥ 10 才用 ratio, 已规避。
4. **L9 HEARTBEAT 黏滞** — 5% 曝光等于死亡, 多撑几天不影响产品。
5. **S2 authorRole 无验证** — 这是**平台职责**, 算法只是 trust 输入, 后端验证是正确的边界划分。
6. **M5 互斥删除历史** — 平台可在 audit log 保留, 算法层不必改。
7. **M3 ancient 窗口对新 mark 失效** — 新 mark 本就缺数据, trend = 0 是合理保守行为。
8. **L10 高 view 低互动惩罚** — 网红打卡点本就该被怀疑 "看了不点赞 = 不值得"。

---

## 我建议的"应修复"清单 (按优先级)

### P0 — 生命安全级
1. **S1 季节性死寂误杀** — `isInSuspiciousPhase B` 加豁免: `total >= 5 && hasLikeIn(365days) → skip B`. 解决冬季高山救命标永久丢失。
2. **DEAD 应有 30 天墓地期** — 给"被误杀"一个最后窗口, 期间 ≥ 1 个 like 自动复活到 SUSPICIOUS。

### P1 — 核心攻击面
3. **S3 慢速渗透投票** — 加入 reporter 多样性指标: 90 天内 reports 来自 < 5 个 unique users 时, negWeight × 0.5。
4. **S4 持续争议一刀切** — 触发 G 时不进 SUSPICIOUS, 改为 "降曝光 + UI 标分歧大"。
5. **M1 强心剂回退路径** — 加 fast-track: 近 30 天 likeRatio > 0.7 + 至少 5 likes → 直接 BORDERLINE。
6. **L5 + reviveCheck 接入** — `revivedAt` 必须被 `markerStatusV4` 读取, 试用期 30 天保护免疫 SUSPICIOUS 触发。

### P2 — 算法精度
7. **M2 双重打击** — 持续争议合并为单一规则。
8. **M4 info_wrong 1.5× 过高** — 降至 1.0, 配合多人累积。
9. **M6 trend 单一值** — 保留 trend30 + trend90 区分短期攻击 vs 真衰退。
10. **L3 wilsonLowerBound 死代码** — 要么真正调用 (调研推荐方向), 要么删除, 不要让 prompt 描述与代码不符。

### P3 — 一致性
11. **L5 isDoc 死字段** — 删除或真正使用。
12. **L8 偏远 mark 0 view 长寿** — 给 effectiveAge 一个绝对地板下限。

---

## 最后一句

v5 的核心思想 (趋势驱动 + 多窗口 + 医院模型) 是对的, 但实现层面有几处**机制不匹配 prompt 设计**的地方 — 最显著的是**续命机制定义但未接入主流程**和 **Wilson 函数定义但未调用**。这些不是漏洞, 是"设计意图与实现的 drift"。

最该警惕的不是任何单一漏洞, 而是 **"DEAD 不可逆 + 无申诉 + 季节性死寂误杀"** 这个组合 — 它是低概率高代价的"沉默杀手", 即使发生 1 次也可能造成实质伤害。其他漏洞最多是"商业刷子打掉竞争对手", 损失是经济性的; 这个漏洞损失可能是登山者生命。

**优先级序**: S1 > S3 > S4 > M1 > 其他
