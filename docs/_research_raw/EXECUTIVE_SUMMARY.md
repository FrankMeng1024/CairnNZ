# Cairn 三方 Subagent 交叉汇总 — 2026-07-17

**输入**：3 份独立 subagent 报告
- `competitor_deepdive_5.md` — 5 家竞品 12 维度深挖
- `progress/audit_findings.md` — 竞品分析挑刺审计（14 findings）
- `progress/blindspots.md` — 战略盲区（8 盲区）

**方法**：三方独立分析后交叉，识别一致结论、冲突点、URGENT action items

---

## 三方一致结论（高置信度）

1. **Cairn 独特性没原判断那么独特**（三方独立指出）
   - 世界迷雾（fog-of-war 118 元买断先例，中国市场早验证）
   - Day One 2026.7 加 On This Day + Location Moments + Strava 集成，直接吃 N 年后回看场景
   - Polarsteps 2000 万用户 + 2026 推 Plus 订阅
   - Pokemon Go Wayfarer / Google Local Guides 是"陌生人可见 waymark"大规模验证

2. **Death Stranding 哲学被过度简化**
   - 缺互惠价值（marker 应帮到别人）
   - 缺"只 like 无踩"设计
   - 陌生人也可见（不只好友）

3. **单人 + UGC + 位置数据 = 存在性风险**
   - iOS 审核三重高风险交集
   - 无 moderation 是倒计时炸弹

---

## 竞品清单修订

### 加入
- 世界迷雾 → A 类直接 🔴
- Pokemon Go Wayfarer → B 类间接 🔴
- Google Local Guides → B 类间接 🔴

### 重分类
- Wanderlog: A → 移除（planning 不是 memory）
- Strava Heatmap: A → D 类 NZ 参照物
- Randonautica: B → 历史脚注

### 数据更新
- Polarsteps: 300 万 → **2000 万** 用户 + 2026 Plus 订阅
- Day One: 纯文字 → **2026.7 加 Strava/On This Day/Location Moments/AI Daily Chat**

### NZ 生态修正
- **Plan My Walk 是 NZMSC 做的，不是 DOC**

---

## 三方冲突（待你决策）

### 冲突 1：NZ 优先 vs 全球华人优先
- 深挖：NZ 空白 = 机会
- 盲区：NZ TAM = $30k/年，转全球华人徒步

### 冲突 2：utility 层 vs 纯情感层
- 盲区：抄 Strava/Duolingo utility 层，别只做情感
- 用户原意：纯情感 + 记录

### 冲突 3：陌生人可见 保留还是砍掉
- 审计：应加强（DS 灵魂）
- 盲区：私密 + 陌生可见 = 精神分裂，二选一

---

## 三方一致 URGENT ACTIONS

### URGENT-1：20 用户付费意愿访谈（本周）
- 决策规则：愿付 $3+/月 <30% → pivot；>60% → 加速；30-60% → 重定位
- 目的：v416 前提是有人要，现在必须验证

### URGENT-2：2 周内上 UGC moderation
- AI 预审（<$0.001/marker） + 关键词黑名单 + 举报 auto-hide + 敏感地理围栏
- 陌生 marker 已上生产 = 倒计时炸弹

### URGENT-3：本 Sprint 加 Data Portability
- 每月 email zip（GPX + marker JSON + photos）
- 死亡开关（6 个月无 commit → read-only）
- PRD/App Store 改：承诺 exportability，不承诺 permanence

---

## 核心决策（必须用户做）

1. **陌生人可见：保留 / 砍掉？** — 所有下游决策的分岔点
2. **市场：NZ / 全球华人？** — 决定 marketing 语言和调性
3. **utility 加多少？** — 决定产品灵魂纯度

## 综合判断

- ✅ 工程 v416 领先大部分 solo，灵魂清晰，fog-of-war 是真差异化
- ⚠️ Day One + Polarsteps 直接抢场景
- ⚠️ 定位矛盾未解
- ⚠️ 无 moderation + 无 data portability = 双雷未拆

**不要用工程精度做没人要的产品**——URGENT-1 是所有后续投入的前置条件。
