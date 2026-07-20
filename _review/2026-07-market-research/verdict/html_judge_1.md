[STARTED T+2026-07-17]

# HTML Judge 1: 证据链完整度

## 每维度打分

### 1. 证据链引用密度: 10/10
- 24 主题, cites 分布: min=2 / max=3 / **avg=2.88** — 每主题都 >=2 条 quote 引用,零违规。
- 3 战略结论 cites: 6 / 5 / 5 条,超出 "每 strat >=2" 门槛数倍。
- Total cited IDs = 41 (D.stats.cited_ids_count), 全部完整加载入 citations map。
- 达标要求: 每主题 >=2 条 raw_quote → 满足。

### 2. 可回溯性: 10/10
- HTML 有完整 **modal**(#modal-bg, line 207-215): 打开显示 id / source / app / region / author / captured_at / category / intensity / cairn_relevance / language / rating / **raw_quote 全文** / 打开原网页 URL 按钮。
- 每 `[quote_id]` 是可点 `.quote-btn` span,`onclick=showQuote(id)` (line 249, 273)。
- Appendix 表格每行 `tr.onclick=showQuote(r.id)` (line 338) → 点击附录任意行也进 modal。
- ESC 关闭 + 点背景关闭 + × 按钮 三种关闭方式。
- Fallback 逻辑 (line 359-368): id 不在 citations map 但在 appendix 里,也能显示 preview。

### 3. 原文真实性: 10/10
抽 8 个 metadata id 全部真实存在于 data.js:
- a009307: ✅ 1 match
- a006324: ✅ 1 match
- a014201: ✅ 1 match
- a004169: ✅ 1 match (在 Q3.1 和 Q3.2 复用,合理)
- a017694: ✅ 1 match
- a018112: ✅ 1 match
- rp0031: ✅ 1 match (Reddit polarsteps prefix)
- a008992: ✅ 1 match
零编造。ID 命名一致(appstore=a 前缀 / reddit_polarsteps=rp / etc.)。

### 4. Source URL: 10/10
- 41/41 citations 都有 `source_url` 字段(node -e 验证)。
- Modal 中 `#m-url` element 在 source_url 存在时 显示 "→ 打开原网页" 链接,target=_blank rel=noopener (line 213, 384)。
- source_url 无时自动隐藏 (line 385)。

### 5. 附录可搜/筛: 9/10
- 18,943 行 appendix 全量 embedding。
- 5 个筛选控件 (line 189-195): text search / cat / src / intensity / cairn_relevance。search 支持 id + quote 内容 (line 322-324)。
- Cat/src option 从数据动态生成(line 302-307),不 hardcode。
- 懒加载 200 行/批(CHUNK=200,line 297),按钮 "加载更多"。
- 显示 counter "显示 X / Y (总 Z)"。
- **小扣分点**: 无按 offset/date/rating 排序功能; 无 CSV 导出。用户可能想按日期倒序看最新的。但达标已够用。

## 综合打分: **9.8/10**

## 优点
- 每一条结论 -> 主题 -> quotes -> raw_quote + URL 的证据链完整闭环,零断裂。
- Modal 补 fallback,即使 citations map 里没有(41 vs 18943)也能从 appendix 回退,不 crash。
- ID 命名系统性(a/rp/prefix),抽 8 全命中,可靠。
- 战略结论(6/5/5 cites)超出主题密度(2.88 avg),重量级结论 = 重量级证据配比。
- 附录 18,943 行不塞死浏览器(CHUNK=200 懒加载)。
- Data 与 UI 解耦(独立 data.js 6MB),视图逻辑纯。

## 缺陷
- 附录无排序功能(intensity/rating/date desc/asc),18K 行数据下想找最激烈 rage 需先筛再看,不能一步到位。
- Modal 无 "上一条 / 下一条" 导航,用户看完一条要关掉再点新的。
- 无 CSV/JSON 下载按钮 (报告读者可能想拿数据做二次分析)。
- Sources 列表 26 项在 stats 里但没在 UI 显示(可以在报告顶部小图表展示每源记录数)。

## 是否达标?
- [x] **≥9/10 GO**
- [ ] 8-9 微调建议
- [ ] <8 必须重做

用户睡前铁律 "每一条依据不明就没做完" —— **通过**。24 主题全部有 >=2 条真实、可点击、可外链的证据,附录 18,943 行可筛可搜。这是把 raw evidence 焊到结论上的做法。

## 具体改进(可选,不强求)
1. 附录增加按 intensity DESC / captured_at DESC 排序 (5 行 JS: `appFiltered.sort(...)`)
2. Modal 里加 "← 上一条 / 下一条 →" 键盘导航(Left/Right key)
3. 顶部 stats-grid 加一格 "26 sources" 可点击展开源列表

[COMPLETE T+2026-07-17, score 9.8/10]
