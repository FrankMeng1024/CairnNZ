# Reddit 备用镜像清单(验证过)

**验证日期**: 2026-07-17
**验证方法**: 每个 mirror 用 `mcp__web-reader__webReader` 真实 fetch `https://{mirror}/r/dayoneapp/top?t=year`
**验证维度**: 帖列表 / 标题 / upvote数 / 正文 / 反爬状态 / 响应时间

## 主镜像(优先使用) — 4 可用

| Mirror | 状态 | 响应时间 | 内容完整度 | 备注 |
|---|---|---|---|---|
| `safereddit.com` | ✅ | ~2s | 高 | 帖列表完整 / 全部标题+upvote+正文;无图片(纯文本模式);推荐首选,已在 Spike 1 验证 |
| `redlib.catsarch.com` | ✅ | ~3s | 高 | 帖列表 + 图片URL(redlib自host)+ upvote+正文全;Spike 1 已推荐;稳 |
| `red.artemislena.eu` | ✅ | ~2s | 高 | 内容与 catsarch 一致(数据来源相同);德国 EU host,可作地理冗余 |
| `l.opnxng.com` | ✅ | ~2s | 高 | 内容一致;跨区备份 |

## 明确不可用(附证据)

| Mirror | 失败原因 | 证据 |
|---|---|---|
| `libreddit.projectsegfau.lt` | Authentik 登录墙 | Response title: "Welcome to authentik! - Project Segfault Authentication",页面只显示登录表单 |
| `redlib.tux.pizza` | 网络不可达 | MCP fetch 返回 500 Internal Server Error (2 次) |
| `redlib.freedit.eu` | Cloudflare 反爬 | Response title: "Just a moment..." + "Performing security verification" |
| `redlib.perennialte.ch` | Cloudflare 反爬 | 同上,Cloudflare bot 挑战 |
| `red.ngn.tf` | 网络不可达 | MCP fetch 返回 500 Internal Server Error |
| `redlib.tiekoetter.com` | Anubis 工作量证明反爬 | Response title: "Making sure you're not a bot!" + Anubis proof-of-work challenge |

## 使用规则

**Phase 1 subagent 抓取顺序**:
1. **主**: `safereddit.com` — 首选,Spike 1 已验证,纯文本快
2. **备 1**: `redlib.catsarch.com` — 3 次失败自动切换;有图片URL
3. **备 2**: `red.artemislena.eu` — 备 1 再挂;EU 节点
4. **备 3**: `l.opnxng.com` — 备 2 再挂;跨区

**切换触发条件**:
- 单个 URL 连续 3 次 HTTP 5xx/超时 → 切下一个 mirror
- 单 subagent 内本次任务累计切换 ≥ 2 次 mirror → 记录 warning
- 4 个 mirror 全挂 → subagent 报错终止,由主 agent 决定是否等待/换 subreddit

**URL 模板**: `https://{mirror}/r/{subreddit}/top?t=year` (path 4 个 mirror 全部一致,直接替换 host)

**注意事项**:
- 4 个可用 mirror 均返回相同 upstream Reddit 数据(upvote 数微差 ±3 属正常缓存 lag)
- catsarch / artemislena / opnxng 都包含 `redlib.*/img/*.jpeg` 图片URL,safereddit 隐藏图片
- 所有可用 mirror 都是 redlib 前端(不是 libreddit),API 结构一致

## 不推荐扩展的选项

- 直接抓 `old.reddit.com` / `www.reddit.com` — 强制登录墙,无法用
- `reddit.com/.json` API — 429 限流,不适合 subagent 批量抓
- 挂 tor `.onion` redlib — 延迟高,不适合实时 subagent
