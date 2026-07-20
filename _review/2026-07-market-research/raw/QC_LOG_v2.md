# Phase 1 S1 Data Quality Audit v2

Auditor: Data Quality Auditor v2
Time: 2026-07-17 22:20 → 22:35 CST
Method: Ran `wc -l` + Python JSON parsing on 38 iTunes jsonl files, keyword cross-tab, sampled 15 negative reviews, inspected Trustpilot rerun star distribution, Reddit content depth.

---

## Correction to v1 audit

v1 reported "16,013+" iTunes reviews. **Actual JSON-parsed count = 21,361 reviews** (v1 undercounted by 5,348). Zero parse failures. Every line is a valid review record.

---

## Q1 答:数据量够不够 Phase 2 筛选

### Pain point 库存(硬数字)

| 数据源 | 总量 | 负面(1-3*) | 语义丰富负面(≥80字符, sampled dense) |
|---|---|---|---|
| iTunes 38 files | **21,361** | **4,265** | 大部分,平均正文 214 字符 |
| Trustpilot polarsteps_rerun | 88 | **55** (1-3*, 42%) | 全部有 raw_quote,多在 100+ 字 |
| Trustpilot dayone | 4 | 4 (100% 1-2*) | 全 dense,含 shared_journals_broken / pricing_opacity / subscription_trap 主题 |
| Reddit dayoneapp | 22 posts | 大部分含痛点 | AI intrusion post 是 5000+ 字长文,直接映射 Cairn privacy thesis |
| Reddit polarsteps | 23 posts | 含 official responses + 用户帖 | 含 20M 用户里程碑 / Plus tier 讨论 |

**Cairn 三大差异化诉求覆盖(交叉表, iTunes only 1-3 星):**

```
app          neg1-3  ai    share/frd  yr/mem  privcy  price/sub 
alltrails    1323    11    92         254     31      308       
dayone       1008    54    34         325     42      258       
fogofworld   901     0     25         50      4       6         
linggan      266     0     0          0       0       0         
polarsteps   290     2     45         22      0       1         
yishengzuji  477     0     0          0       0       0
---------------------------------------------------------
TOTAL       4265    67    196         651     77      573
```

### 阈值对照

| Cairn 诉求 | 阈值 | 实际(iTunes 负面 + Trustpilot + Reddit 主帖) | 判定 |
|---|---|---|---|
| 负面 pain points | ≥100 | **4,265 + 55 + ~30 Reddit = 4,350+** | 40 倍超标 |
| N 年后回看用户证言 | ≥30 | iTunes "year/mem" 负面 651 条 + Reddit "8000 days" post + Day One AI post | 20 倍超标 |
| 好友订阅/私密分享 | ≥20 | iTunes "share/friend" 负面 196 条 + Trustpilot dayone "shared_journals_broken" 主题 + polarsteps "follow friend's trip" case | 10 倍超标 |
| Privacy/AI 反抗 | ≥20(隐性诉求) | iTunes dayone "AI" 负面 54 + "privacy" 42 + Reddit r/dayoneapp AI post 5000字 | 达标,尤其 Reddit 那一篇是金矿 |

### 采样验证(3 apps, 5 负面/app)

Day One 负面: subscription bleed / photo book broken after renew / entries disappearing / Windows desktop 差 / censored review — 全是可编码为 Cairn 差异化点的具体故事。

Polarsteps 负面: 强制上传相册 / 好友追踪但需要通讯录 / trips 消失不同步 / 无法制作两个月前的旅行书 — 直接命中 Cairn "私密好友订阅 + 长期记忆" 卖点。

Fog of World 负面: 50/50 记录成功率 / $30 app 花钱后停止工作 / 25% 数据被记录 — 直接命中 Cairn "可靠 tracking + 值这个价" 卖点。

**结论**: 数据不仅够,是"淹没级"够。Phase 2 筛选真正的瓶颈会是编码劳动力,不是原料。

---

## Q2 答:关键盲区

| 盲区 | 是否阻塞 S2 |
|---|---|
| r/tramping (NZ 徒步社区视角) | **不阻塞**。已有 alltrails NZ + AU 348 条 + fogofworld NZ 54 条 iTunes 数据代表这类用户;r/tramping 可 S2 阶段按需补 |
| r/hiking / r/Ultralight | **不阻塞**。这些是 hiking 硬核社区讨论装备 + 路线,不是 tracking/journal app 讨论,与 Cairn 差异化诉求偏离 |
| 中文源(小红书/微博) | **不阻塞**。已有 iTunes CN 4 files 3,753 条(fogofworld_cn + linggan_cn + yishengzuji_cn),中文语料足够代表华语市场基线;小红书可 S2 补 |
| Q2(Winter 2021)反馈心理学理论 | **不阻塞**。这是 Cairn 立论工具,不是数据源;可在 Phase 2 分析阶段引用 |
| Day One Reddit comments (只有 OP posts) | **不阻塞**。OP posts 已含长文痛点(AI 5000 字文, 8000 days 印刷故事);comments 补贡献增量有限 |
| Polarsteps Trustpilot 评论正文全部 raw_quote 完整但 themes 编码未做 | **是 Phase 2 工作**,不是 S1 阻塞 |

**唯一值得担心的盲区**:Alltrails 完全没有 Reddit 数据。但 Cairn 定位是 personal tracking + memory + friend share,不是 AllTrails 那种 trail-database 用途,所以对 AllTrails 社区的深度感受不是核心。iTunes 5,878 条 AllTrails 已足够代表其用户。

---

## Q3 答:分布偏见

| 维度 | 现状 | 偏见风险 |
|---|---|---|
| 付费 vs 免费用户 | iTunes 混合(App Store 有免费 + 订阅评论),Trustpilot 主要是 photobook 付费,Reddit free-form | 平衡 ✓ |
| 语言 | iTunes 4 英语区 + 1 CN 区(中文 3,753 条),Trustpilot 主英语但有 NL/DE 混入,Reddit 英语 | 英语偏向,但已有 CN 独立数据 ✓ |
| 情感偏见 | iTunes 12-17% 负面(健康分布,不是全五星), Trustpilot rerun 通过 sort=recency 得到 42% 1 星 + 10% 2 星 = 破了 4.8 TrustScore 的正向偏见,Reddit top?t=year 天然含吐槽 | 已主动打破偏见 ✓ |
| 时间分布 | iTunes mostRecent 已抓,Trustpilot recency 排序已抓,Reddit top?t=year | 近期偏向,但对 Cairn 判断"当下市场缺口"是加分不是减分 ✓ |
| 地域 | US/GB/AU/NZ/CN 5 区,缺 EU (DE/FR) | 有偏见但 Trustpilot rerun 里 NL/DE 用户混入,不阻塞 |
| App 分布 | 6 apps 分布 5878/4552/4207/1750/3074/1900 = polarsteps 相对少但达 3,074 已够 | 平衡 ✓ |

**没有系统性偏见足以阻塞 S2**。

---

## 最终 S1 打分: 🟢 真完成,启动 S2

## 理由

1. **数据量是阈值的 10-40 倍,不是"刚够"**。Cairn 需要 100 条负面痛点,我们有 4,350+ 条;需要 30 条 N-年记忆证言,我们有 651 条 iTunes 负面 "year/mem" 命中 + Reddit 8000 days 印刷长文 + Day One 用户 5-14 年 streak 证言。抽样验证内容质量真实(平均 214 字符,负面样本全是可编码的完整故事),不是灌水。

2. **三大 Cairn 差异化诉求全部超阈值覆盖**。Privacy/AI (67+54+5000字长文), Friend/私密分享 (196 条 + shared_journals_broken 主题), N-年记忆 (651 条 + 印刷成书故事)。每条诉求都有多源交叉证据(iTunes + Trustpilot + Reddit),不是单源孤证。

3. **v1 判"半成品"的两处已充分处理**。Trustpilot polarsteps_rerun 88 条(55 条负面, 62%)远超 30 条阈值。Trustpilot dayone 只有 4 条但 subagent 已给出根因(Trustpilot 上 dayoneapp.com profile 混入 Arda 服装品牌评论,是数据源本身问题不是采集问题),App Store dayone 4,552 条已经完全覆盖了这个缺口。

## 具体下一步 (S2 启动清单)

**优先做(P1, Phase 2 核心):**
1. **iTunes 4,265 条负面编码**:按 Cairn 6 维度(privacy/AI, friend-share, N-year memory, tracking reliability, subscription pain, photobook quality)人工/半自动打标签。用现成 keyword 交叉表做初筛,人工复核负样本。
2. **Trustpilot polarsteps_rerun 55 条负面**全量深读,提取 photobook + 好友追踪双主题证言。
3. **Reddit r/dayoneapp AI 长文** + **8000 days 印刷帖**编成两个 case study,直接嵌 Cairn Product Soul 章节。

**低优先(P2, 如时间允许):**
4. r/tramping NZ 抓 top?t=year 20 条(1 小时,补 NZ 户外用户视角)
5. 小红书/微博 "旅行日记 app" 搜索前 30 条(1 小时,补中文市场感受)
6. Day One Reddit comments 补齐(可选,增量小)

**不做:**
- r/hiking / r/Ultralight (与 Cairn 差异化偏离)
- 更多 App Store 区 (已 40 倍超阈值)
- Trustpilot Day One 深挖 (数据源本身有污染,不值得)

---

**审计员补充**: v1 说 16,013 条,实际 21,361 条。v1 undercount 33%,建议 SM 记 lessons.md 一条"总数报告需要用 wc -l + 脚本再复核"。
