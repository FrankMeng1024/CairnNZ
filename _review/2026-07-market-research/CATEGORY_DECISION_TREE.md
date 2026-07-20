# 6 类别决策树 + 锚点示例(Phase 2 subagent 用)

**用途**: Phase 2 subagent 筛选打标时用,防止主观拍脑袋。

## 决策树

一条原文进来,subagent 按顺序回答 6 个问题,选**第一个 Yes 的分类**作为 primary:

```
Q1: 是不是在抱怨具体功能不好用/缺失/有 bug?
    → 是 → primary = "pain"
    → 否 → Q2

Q2: 是不是在明确夸具体功能?("love this feature" / "changed my life")
    → 是 → primary = "praise"
    → 否 → Q3

Q3: 是不是主要在提定价/流失/退订/付费意愿?
    → 是 → primary = "pricing"
    → 否 → Q4

Q4: 是不是在讲情感体验?(N 年后回看 / 善意时刻 / 回忆 / "cried" / "nostalgia")
    → 是 → primary = "emotion"
    → 否 → Q5

Q5: 是不是在讲和别人的关系?(分享 / 私密 / 公开 / "family" / "close friends" / "strangers")
    → 是 → primary = "relation"
    → 否 → Q6

Q6: 其他抱怨(bug 已排除,是产品/公司/AI/隐私层面不满)
    → 是 → primary = "complaint"
    → 否 → **跳过这条**(是噪音,不入库)
```

**Secondary tags**: 一条数据可以有 0-3 个 secondary(除 primary 外还符合的类别)。

## 5 条锚点示例(校准用)

### 锚点 1
- **原文**: "I wish Polarsteps had a way to add offline notes to specific locations"
- **决策**:
  - Q1: 是,feature 缺失 → primary = **pain**
  - Q2-6: 都不是明显 → secondary = []
- **intensity**: 3(wish 是中等诉求,不带情绪)
- **cairn_relevance**: 5(Cairn marker 就是这个功能)

### 锚点 2
- **原文**: "I've been using Day One for 8 years. Opened my journal from 2016 last night and absolutely love the on this day feature. It's like meeting old me."
- **决策**:
  - Q1: 否
  - Q2: 是,明确夸 on this day → primary = **praise**
  - Q4: 也是,情感体验 → secondary = ["emotion"]
- **intensity**: 5(8 年老用户 + "absolutely love" + "meeting old me")
- **cairn_relevance**: 5(N 年后回看 = Cairn 灵魂)

### 锚点 3
- **原文**: "$34.99/yr is too much for a journal app. Canceling after 2 years. Diarly does the same for cheaper."
- **决策**:
  - Q3: 是,定价 + 流失 → primary = **pricing**
  - Q6: 也是抱怨 → secondary = ["complaint"]
- **intensity**: 4(明确要退,提替代方案)
- **cairn_relevance**: 4(定价数据 = Q4 商业模式核心)

### 锚点 4
- **原文**: "Only want to share my hikes with my hiking club, not the world. Polarsteps forcing followers is annoying."
- **决策**:
  - Q1: 否(不是缺失,是 forcing)
  - Q5: 是,关系(私密 vs 公开)→ primary = **relation**
  - Q6: 也是抱怨 forcing → secondary = ["complaint"]
- **intensity**: 3(明确偏好但不强烈)
- **cairn_relevance**: 5(Cairn 好友订阅 = 这个诉求)

### 锚点 5
- **原文**: "Last week I checked Milford Track, weather at hut 3 was rough — thanks to whoever left that note yesterday, saved my ass"
- **决策**:
  - Q4: 是,善意时刻 → primary = **emotion**
  - Q5: 也是,陌生人关系 → secondary = ["relation"]
- **intensity**: 5(saved my ass = 强情感)
- **cairn_relevance**: 5(DS 陌生人善意灵魂,marker 用途)

## 明确剔除的(不入库)

| 原文类型 | 剔除理由 |
|---|---|
| "Milford Track is amazing, must-do" | 纯路线推荐,和 app 无关 |
| "Osprey vs Deuter which pack better?" | 装备比价 |
| "Kalman filter accuracy on iOS 17" | 技术地形学 |
| "Look at my sunset photo from Roys Peak!" | 炫耀照片 |
| "Election news blah blah" | 无关时事 |

## Intensity 打分参考

- **1**: 中性描述,无情绪("The app has GPS tracking.")
- **2**: 轻微偏好("It works okay.")
- **3**: 明确诉求或抱怨,不带强烈情绪("I wish X" / "It's annoying")
- **4**: 强烈情绪 + 具体行动("Canceling my subscription because...")
- **5**: 极端强烈(大写 / 表情 / 重复强调 / "changed my life" / "saved my ass" / "cried")
