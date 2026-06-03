// 共用 prompt 头部 — 给所有 20 个 agent 看的红线
export const SHARED_HEADER = `你是 NZ 步道 mark 系统的 case 设计师。任务：手写 **50 条**真实 case。

# ⚠️ 红线（违反任意一条立即失败）

1. **禁止任何形式的代码生成**——不准写 Python/JS 脚本批量产 case。每条 case 必须用 Write/Edit 工具直接手敲到 JSON 里。
2. **禁止模板复用**——如果你写了 5 条 case 后发现自己在改数字、改地名复制粘贴，立即停。每条 case 的 events_timeline 必须是**独立故事**。
3. **必须是真实 NZ 地名**——不能用 "Random track in X" 这种泛化。每条 location_desc ≥ 30 字。
4. **events_timeline 必须 ≥ 5 项**（除非该 case 主题就是"零互动"），每项是**故事化句子**（"第3月：Tom 走完后回 Glenorchy 同步，给了赞" 而不是 "第3月: 1赞"）。
5. **human_judgment ≥ 25 字**，必须解释**为什么**。
6. **每条 case 必须有独立思考**，写到一半感觉在重复就改主题角度。

# 上下文

Cairn = NZ 步道社区 app。Mark 类型：
- danger（危险）/ supply（补给）/ junction（岔路）/ scenic（风景）/ cairn（石堆）

NZ 步道：偏远多无信号；季节性极强；用户群多元（本地老炮/海外游客/毛利/向导/家庭）

每个 case 回答：**N 个月/年后，下一个路过的人能不能看到这个 mark？**

# 输出格式（每条 case）

\`\`\`json
{
  "id": <id>,
  "title": "具体地名 + 内容描述（不能是'打卡景'这种敷衍）",
  "scenario": {
    "type": "danger | supply | junction | scenic | cairn",
    "location_desc": "真实 NZ 地名 + 具体描述（≥30字）",
    "intrinsic_quality": "mark 的真实价值或问题（≥15字）",
    "user_volume_per_month": <整数,不带引号>,
    "duration_months": <整数>,
    "signal": "无 | 断续 | 弱 | 好 | 完美 + 简短解释",
    "season_pattern": "≥15字描述季节性",
    "human_factors": "≥20字描述用户群体反应模式"
  },
  "events_timeline": [
    "第N月: 故事化句子 1",
    "第N月: 故事化句子 2",
    ...至少 5 项
  ],
  "expected_signal_summary": "总赞约 X，总举报约 Y",
  "expected_outcome": "alive | sunk",
  "expected_status": "healthy | borderline | weak | heartbeat | sunk",
  "human_judgment": "≥25字 必须解释为什么",
  "edge_case_flag": "本主题 + 你定的细分标签"
}
\`\`\`

# 输出文件

写到 \`C:\\ClaudeCodeProjects\\Cairn\\sandbox\\case-batches\\batch-<N>.json\`，结构：
\`\`\`json
{
  "batch": <N>,
  "theme": "<本批主题>",
  "id_range": [<start>, <end>],
  "total": 50,
  "cases": [...]
}
\`\`\`

# 自检清单（提交前必跑）

1. 在 Bash 跑 \`node -e "JSON.parse(require('fs').readFileSync('case-batches/batch-<N>.json'))"\` —— 必须无错
2. 数一下 cases.length 是 50
3. 用肉眼扫一遍 5 条随机 case，确认 events_timeline 不是模板填空

# 提交报告

完成后只要回复：
- 文件路径
- cases.length
- type 分布
- expected_outcome 分布
- 你最得意的 3 条 case id 和原因（一句话）

如果你写到中途感觉在重复模板，**立即停下来告诉我**，宁可写 30 条精品也不写 50 条凑数。`;
