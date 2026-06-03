# Real Device Test Plan — Cairn

**Version**: 1.0
**Created**: 2026-05-18
**Status**: Sprint 59 (中国本地) + Sprint 61+ (TestFlight境外众测) 执行依据
**Prerequisite**: `docs/debug-logger-spec.md` 已实现（Sprint 55-58交付）

---

## 目的

把"真机测试"从体感评价升级到**数据驱动的客观验证**。每项测试有：操作步骤、测量指标、verification脚本、验收阈值（对照PRD2 NFR）。

**两阶段**：
- **第一阶段（Sprint 59）**：中国本地测GPS逻辑/电池/后台/SOS/UI，地图tile看不到（GFW）
- **第二阶段（Sprint 61+）**：TestFlight众测找境外NZ用户跑真实Great Walks

---

## 阶段A：中国本地真机测试（Sprint 59）

### 前置条件 checklist

- [ ] Apple Developer Program $99/年已购买
- [ ] Mac电脑可用（EAS Build需要）
- [ ] iPhone真机（建议iPhone 13或更新，A15+芯片确保Mapbox流畅）
- [ ] EAS CLI已安装：`npm install -g eas-cli`
- [ ] Mapbox token已配置在`.env.local`
- [ ] 紧急联系人手机能收到测试SMS（找朋友配合，明确告知是测试）
- [ ] Debug Logger已交付（Sprint 55-58）
- [ ] 一份LINZ官方GPX（可选，方法C用）

### Day 1 — 静止精度基线测试

**目的**：建立"GPS报告精度"vs"实际精度"的诚实度基线。

**步骤**：
1. 找一个开阔点（家阳台 / 公园某地标），用Google Maps地图标定**ground truth坐标**（精度尽量高，记录到6位小数）
2. iPhone充电线接着，避免电池低电量影响
3. 打开Cairn，开Debug模式
4. 进入HikingScreen → "Start Hiking" → 选"Free Hiking"模式
5. 把手机平放在地面同一位置，**不要动**
6. 持续记录40分钟
7. "Stop" → 导出session → 命名`day1-static-baseline.json`

**分析**：
```bash
python scripts/ground-truth-static.py \
  --session day1-static-baseline.json \
  --truth-lat <ground_truth_lat> \
  --truth-lon <ground_truth_lon>
```

**输出报告应包含**：
- 总GPS点数
- 偏离ground truth的距离分布（mean / median / P95 / max）
- GPS报告的accuracy字段分布
- **诚实度比较**：实测偏离 / 报告accuracy 的比值（理想~1.0；>1.5 = GPS过度乐观；<0.5 = 过度悲观）
- 散布图（matplotlib）

**验收阈值（PRD2 NFR）**：
- 开阔地精度 < 10m → P95应 ≤ 10m
- 报告accuracy诚实度 0.8-1.5之间

**预期发现**：
- 室内/阳台静止时GPS会有"漂移圈"现象，半径几米到十几米
- accuracy字段一般偏乐观（实测偏离比报告大）

### Day 2 — 城市公园短tramp（验证基础流程）

**目的**：第一次跑动tracking + 后台 + Kalman + 偏离 + marker的端到端流程。

**步骤**：
1. 选公园里有明确路径的1km环线（理想是有水泥路标记的）
2. 在Cairn里**预先创建一条route**（手动绘制，与公园路径对齐）
3. 出门前确认：iPhone电量>80%、Debug模式开、紧急联系人已设
4. **Test Case 2.1（前台tracking）**：
   - 选这条route，点"Start Hiking"
   - 正常走完一圈（约15分钟）
   - 中途按一个marker（任意类型）
   - 完成后"Stop"
5. **Test Case 2.2（后台tracking + 锁屏）**：
   - 再次开始tracking
   - 走到中段时，**按iPhone侧键锁屏**，把手机放口袋
   - 继续走20分钟
   - 解锁打开app → 验证轨迹是否连续无断点
6. **Test Case 2.3（故意偏离）**：
   - 第三次开始
   - 走到一半时，**故意偏离路径50米以上**
   - 等2分钟（cooldown）
   - 应该收到偏离播报
   - 在偏离时按L4标注按钮"deviation_false_positive"或"deviation_missed"
   - 返回路径，验证恢复
7. 导出3个session，命名`day2-foreground.json` / `day2-background.json` / `day2-deviation.json`

**分析**：
```bash
python scripts/analyze-session.py --session day2-background.json
```

**重点验证**：
- **Background tracking连续性**：日志里`app_state_change`后`gps_fix`是否持续？有没有断超过30秒的gap？
- **Kalman filter效果**：`kalman_output`的input vs output距离差，平均改善多少？
- **偏离检测延迟**：L2 `deviation_start`时间 vs 实际偏离时间（用户标注L4 deviation_missed对照）
- **Marker插入精度**：`marker_placed`的accuracy_m是否合理？

**验收阈值**：
- ✅ 后台tracking 20分钟无断点（允许偶发<30s gap）
- ✅ Kalman平均jitter改善 ≥ 30%
- ✅ 偏离检测在50m+持续15s后触发（不能太敏感）
- ✅ 电池消耗 < 8%/h（PRD2徒步NFR）

### Day 3 — 郊外山路真徒步（核心场景）

**目的**：最接近NZ tramping的环境（中国境内类似难度），考验Kalman对**树林/山谷accuracy差点**的处理。

**选址建议**（中国境内）：
- 北京：香山 / 妙峰山
- 上海：佘山
- 广州：白云山
- 深圳：梧桐山 / 七娘山
- 杭州：北高峰 / 灵隐西线

**理想特征**：
- 路径长度3-5km
- 包含密林段（GPS信号弱）
- 包含开阔山脊段（GPS良好）
- 全程2-3小时

**步骤**：
1. **出发前**：
   - iPhone电量100%
   - Debug模式开
   - 在Cairn创建一条route（用Google Maps或OSM预先看好的轨迹）
   - 提前告知一个朋友"我去爬山N小时"（不是测SOS，是真实安全）
2. **徒步中**：
   - 正常tracking
   - **每30分钟在沿路放一个marker**（不同类型轮换：danger/scenic/supply/junction）
   - 进入密林段时，**按L4 "gps_inaccurate"按钮**（如果感觉GPS漂移）
   - 故意偏离2次，间隔1小时（测试cooldown）
   - 中途**锁屏放包里15分钟**测后台稳定性
3. **回家后**：
   - 导出session，命名`day3-real-tramp.json`
   - 拍2张GPS轨迹截图（一张密林段、一张开阔段）

**分析**：
```bash
python scripts/analyze-session.py --session day3-real-tramp.json
```

**重点验证**（这是最关键的session）：
- **GPS精度分段表现**：密林段accuracy分布 vs 开阔段
  - 密林段P95 < 25m合格，>30m需调Kalman
- **Kalman filter真实效果**：raw vs filtered轨迹差异（用python出图对比）
- **后台tracking在山区的稳定性**：`app_state_change → background`后3分钟内是否有gps_fix中断？
- **电池消耗在长session**：3小时实测%/h，对比PRD2 NFR
- **L4标注与L2事件相关性**：用户感觉GPS不准的时刻，accuracy是否真的高？

**验收阈值**：
- ⚠️ 密林段P95 accuracy ≤ 25m
- ✅ 偏离检测误报率 < 20%（统计：用户没主观感觉偏离 但L2 deviation_start触发的次数）
- ✅ 电池消耗 ≤ 8%/h
- ✅ 至少1次锁屏后台tracking连续无中断

**这次session的报告就是PRD2 NFR最有力的真机验证**。

### Day 4 — SOS完整链路测试

**目的**：验证SOS的完整triggering chain和SMS fallback。

**前置**：联系一个朋友配合（明确告知**今天某时段**会发测试SOS，不要报警）。

**步骤**：

#### Test Case 4.1 — 长按取消（防误触）
1. 触发SOS长按
2. 在3秒长按完成前松开
3. 验证：日志里有`sos_triggered stage=longpress_start`但没有`longpress_complete`
4. 朋友的手机不应该收到SMS

#### Test Case 4.2 — 倒计时取消
1. 长按3秒完成
2. 进入5秒倒计时
3. 在倒计时期间点"Cancel"
4. 验证：日志有`countdown_start`和`countdown_cancelled`，无`sms_sent`

#### Test Case 4.3 — 完整发送（在线）
1. 确认网络在线
2. 长按3秒+等5秒倒计时
3. SMS发送
4. 验证：
   - 日志有完整链路：longpress_start → longpress_complete → countdown_start → sms_sent
   - 朋友的手机**实际收到SMS**（截图保存）
   - SMS内容含GPS坐标且坐标准确（与同时刻gps_fix一致）

#### Test Case 4.4 — 离线SOS队列
1. 打开飞行模式
2. 触发完整SOS
3. 验证：日志有`sos_triggered stage=queued_offline`
4. 关闭飞行模式
5. 等30秒
6. 验证：`sos_triggered stage=sms_sent`触发，朋友收到SMS

**导出**：所有session合并为`day4-sos-complete.json`

**验收**：
- ✅ 防误触：长按<3s不触发
- ✅ 倒计时可取消
- ✅ SMS实际发送（不是假发送）
- ✅ GPS坐标在SMS里准确
- ✅ 离线队列回网后正常重发

### Day 5 — 数据汇总 + 写基线报告

**步骤**：
1. 把Day 1-4的所有session JSON收集到`docs/qa/sprint59-evidence/`
2. 对每个session跑`analyze-session.py`，输出report存为`.txt`
3. 写`docs/real-device-baseline-cn.md`：

**报告模板**：
```markdown
# Real Device Baseline (China) — 2026-05-XX

## 测试设备
- iPhone XX / iOS XX.X
- 测试时间：2026-05-XX 至 2026-05-XX

## NFR对照表
| NFR | 目标 | 实测 | 状态 |
|---|---|---|---|
| 冷启动 | <3s | X.Xs | ✅/❌ |
| GPS精度（开阔） | <10m | X.Xm (P95) | ✅/❌ |
| GPS精度（密林） | — | X.Xm (P95) | 📝记录 |
| 电池消耗（徒步） | <8%/h | X.X%/h | ✅/❌ |
| 电池消耗（跑步） | <5%/h | — | ⏳待测 |
| 播报延迟 | <2s | X.Xs (avg) | ✅/❌ |
| 后台tracking连续性 | 锁屏不中断 | ✅/❌ | — |
| SOS发送成功率 | 100% | X/Y | — |

## 发现的问题
1. **问题1**：偏离检测在...场景下误报率较高
   - 数据：Day 3 session 12%误报率
   - 建议：增加duration_threshold从0s到15s
2. ...

## 待修复（优先级）
1. P0: ...
2. P1: ...

## NFR pass率
X / Y items passed
```

4. **决定**：
   - 所有P0 NFR pass → 可以进Sprint 60启动PRD3
   - 有P0 NFR fail → Sprint 60先修，再进PRD3

---

## 阶段B：TestFlight境外众测（Sprint 61+）

### 前置条件

- [ ] App Store Connect账号已创建
- [ ] TestFlight build已上传
- [ ] 审核通过（External Testing）
- [ ] 招募了至少3位境外NZ tramper测试员
- [ ] 阶段A中国测试已通过（不要把已知bug推给境外测试）

### 招募渠道

1. Reddit `r/tramping` 发帖（先读subreddit规则避免被ban）
2. NZ tramping Facebook groups（如"NZ Mountain Safety"、"Tramping NZ"）
3. 境外朋友介绍
4. Te Araroa Trust官方community（如有官方推荐渠道）

**招募话术建议**：
> "Hey! I'm building Cairn, an NZ-focused outdoor safety app (think AllTrails but with safety markers and offline Topo50). Looking for 3-5 NZ trampers to test on a real Great Walk and give me data-driven feedback. Free TestFlight access. The app records anonymous session data (GPS quality, battery, etc.) — you can review what's exported before sharing. Interested?"

### 提供给测试员的资料

每位测试员收到：
1. **TestFlight邀请链接**
2. **`docs/tester-onboarding.md`**（新写）：
   - 安装步骤
   - 如何开Debug Mode（5次tap About区）
   - 如何在徒步中按L4标注按钮
   - 如何徒步后export session JSON
   - 如何把JSON发回（Email / 上传链接）
3. **隐私说明**：
   - 哪些数据被记录（GPS轨迹/电池/网络/事件时序）
   - 哪些不记录（marker文本/联系人/账号）
   - 用户可以review JSON后再发送
4. **测试任务清单**：
   - 走至少一段Great Walk（不限哪条）
   - 至少2小时连续tracking
   - 至少3次marker放置
   - 至少1次锁屏后台
   - SOS测试**可选**（不强制，避免误报真警）

### 重点验证项（境外才能测的）

阶段B要回答的问题（阶段A答不了的）：

1. **真实NZ高山GPS精度**：
   - Tongariro火山带 / Routeburn峡谷段 / Milford峡湾 — 这些地形中国境内没有equivalent
2. **离线Topo50真实使用**：
   - 在NZ无网络环境下，离线包是否真的能完整加载？tile加载延迟？
3. **自定义Mapbox style在NZ地形**：
   - PRD3 E-013自定义的Topo50 style在真实NZ tile上可读性如何？
4. **真实长session电池**：
   - 一次Great Walk 6-8小时连续tracking的电池表现
5. **SOS在NZ手机网络**：
   - 不同运营商（Spark / One NZ / 2degrees）的SMS送达率
6. **NZ用户主观体验**：
   - 通过L4标注+TestFlight feedback收集"NZ用户感觉怎么样"

### 数据汇总

每收到一份session JSON：
```bash
python scripts/analyze-session.py --session tester-{id}-{date}.json
```

最终输出`docs/real-device-baseline-nz.md`，对比Sprint 59的中国基线，看：
- NZ高山GPS精度比中国差多少？（高山GPS信号通常更好，开阔少遮挡）
- 离线Topo50加载性能在真实NZ网络环境
- PRD2 NFR真实环境是否仍达标

### 测试员激励

- 一句话致谢 + 在app的`Settings → About → Acknowledgments`放名字（可选）
- 优先获得v1.0正式版邀请
- 不付费（避免数据偏差）

---

## 不在本plan的（明确边界）

- ❌ Android真机测试（v1.0 iOS only）
- ❌ Apple Watch（PRD2 Phase 3 Could-Have）
- ❌ AR真机测试（需要@viro-community/react-viro EAS build，单独plan）
- ❌ 云端log analytics dashboard（v1.1+）
- ❌ Crashlytics / Sentry集成（v1.0用Debug Logger的`error`事件足够）

---

## 验收标准

### Sprint 59交付
- [ ] `docs/real-device-baseline-cn.md`完成
- [ ] PRD2核心NFR有实测数据（GPS精度/电池/后台/SOS）
- [ ] 至少识别出3个待修复issue（无论P0还是P1）
- [ ] 决定：进Sprint 60启动PRD3 还是 Sprint 60先修bug

### Sprint 61+交付（TestFlight）
- [ ] 至少3位NZ tester完成至少1次Great Walk session
- [ ] `docs/real-device-baseline-nz.md`完成
- [ ] 中国vs NZ基线对比表
- [ ] PRD3 E-013（离线Topo50 + Mapbox自定义style）有真实NZ数据验证

---

## 文档维护

- 每次真机测试完更新`docs/real-device-baseline-{cn|nz}.md`
- 测试中发现需要补的event类型或埋点 → 加到`debug-logger-spec.md`的backlog
- 测试方法学习的lessons → `tasks/lessons.md`
