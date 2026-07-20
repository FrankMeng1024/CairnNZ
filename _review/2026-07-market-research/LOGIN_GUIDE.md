# 登录源操作教程 + 只读铁律

**用户要求**:提供登录凭证,但**必须保证只读不发布**。
**主 agent 铁律**:所有登录源仅用于**读取内容**,任何 `POST` / `send` / `发布` / `点赞` / `评论` / `关注` / `私信` 操作**绝对禁止**。

---

## 🚨 只读铁律(subagent + 主 agent 都必须遵守)

启动 playwright 使用你 cookie 的每一次会话,必须遵守:

| 允许 | 禁止 |
|---|---|
| `browser_navigate`(打开页面) | `browser_click` 在"发布 / 评论 / 点赞 / 关注 / 私信"按钮上 |
| `browser_snapshot`(截取内容) | `browser_type` 到任何输入框 |
| `browser_take_screenshot` | `browser_evaluate` 里出现 `POST` / `fetch(...method:'POST')` |
| `browser_evaluate` 只读取 DOM(`document.body.innerText`) | 任何调用发消息 API 的 script |

**Subagent prompt 必须包含**:
> "你使用的是用户登录 cookie。**绝对禁止**任何写操作(发帖/评论/点赞/关注/私信/修改设置)。只允许 navigate / snapshot / screenshot / evaluate 读取 DOM。发现自己要点击'关注'/'点赞'/'评论'按钮时,立即停止并 Write 'ABORT: attempted write action' 到进度文件。"

---

## 📚 5 个源的登录方式(逐个教你怎么提供)

### 1. Facebook — NZ Tramping Community + Te Araroa Trail 群

**你要做的**(约 5 分钟):

1. 在你日常浏览器(Chrome/Edge)登录 Facebook
2. 加入这两个群(如果还没加):
   - NZ Tramping Community: 搜"NZ Tramping" 找 4-5 万人群
   - Te Araroa Trail: 搜 "Te Araroa Trail" official group
3. **导出 cookie 给我**(3 种方式任选):

   **方式 A(推荐)—— 用浏览器扩展导出**:
   - Chrome 装 "Get cookies.txt LOCALLY" 扩展(纯本地,无联网)
   - 打开 facebook.com → 点扩展图标 → Export → 保存到 `_review/2026-07-market-research/credentials/fb_cookies.txt`
   - **注意**:文件保存到 `credentials/` 目录,该目录会加入 `.gitignore` 不会 commit

   **方式 B —— 浏览器 DevTools 手动复制**:
   - F12 → Application → Cookies → facebook.com
   - 复制 `c_user` 和 `xs` 两个值给我(这两个足够登录)

   **方式 C —— 我 playwright 打开浏览器你自己登**:
   - 我启动 playwright,你操作浏览器输入密码
   - 登录完的 session 存在 playwright 上下文里,后续 subagent 复用
   - 你不用给我密码

4. 加完群、登录好后告诉我"好了" —— 我启动 subagent 用这个 session 抓帖

**只读保证**:
- Subagent prompt 硬约束"绝对不能 click 发帖/评论按钮"
- 我 review subagent 的行为日志(browser action log)确认没写操作
- 抓取完成后你可以在 FB 上退出所有设备 → cookie 立即失效

---

### 2. 小红书 —— "世界迷雾" hashtag

**你要做的**:

1. 在浏览器登录 xiaohongshu.com
2. 用**方式 C(推荐)** —— 我启动 playwright,你只需要操作浏览器输入手机号 + 验证码,session 保存在 playwright 里
3. 或方式 A/B 导出 cookie

**只读保证同上**。抓完退出账号即可。

---

### 3. 微信"数字手账"公众号 / 群

**问题**:微信没有 web 版能登陆的方式(除了 web.wechat.com 但已停用)。

**替代方案 A** —— 你手动截图:
- 你搜关键词 "数字手账" 公众号,加 3-5 个大 V
- 关注后进入,截图 top 5 文章的**评论区** + 用户 profile
- 把截图发给我,我 OCR + 分析

**替代方案 B** —— 你自己复制粘贴 top 文章原文 + 评论,发给我
- 我不涉及登录,你手动搬运

**评估**:微信收益不高(公众号内容偏营销),**如果 A/B 都嫌麻烦,可以跳过**。我不硬要求。

---

### 4. Day One 官方社区论坛

**登录难度**:低。

**你要做的**:
1. 去 dayoneapp.com/community(如果有,或者他们用 Discord/Slack)
2. 用 Google/Apple 账号快速注册(免费)
3. 方式 A/B/C 之一提供 session

**替代**:如果没有官方论坛,r/dayoneapp 已经覆盖 95% —— 可跳过。

---

### 5. 其他你想到的登录源

如果你之后想到别的源需要登录(比如 Substack 大 V 付费专栏、Twitter/X 需登录看的账号、Bluesky),同样方式 A/B/C 提供即可。

---

## 🗂 凭证存储位置

所有 cookie / session 文件存到:
```
C:/ClaudeCodeProjects/Cairn/_review/2026-07-market-research/credentials/
├── fb_cookies.txt        (Facebook)
├── xhs_cookies.txt       (小红书)
├── dayone_session.json   (Day One)
└── .gitignore            (只有一行 *,强制不被 commit)
```

**主 agent 铁律**:
- 抓取完成后立即删除 `credentials/` 目录
- 期间任何 subagent 都不能把 cookie 内容 print / echo / Write 到其他文件

---

## 🔒 只读机制的 3 重保障

1. **Subagent Prompt 硬约束**:每次调用都强制"你使用用户 cookie,禁止写操作"
2. **Playwright 行为审计**:每次 subagent 结束,主 agent 检查其 `browser_click` 目标是不是发帖/评论按钮
3. **抓取后 cookie 失效**:
   - Facebook: 你在 FB → 设置 → "登出所有设备"
   - 小红书: xhs → 设置 → "登出所有设备"
   - Day One: 改密码

---

## 你要不要现在开始提供?

**不用现在**——先看下面 v3 CHECKLIST 骨架,决定要不要启动 Phase 1 免登陆部分,再决定要不要现在给 cookie。

如果决定要给,推荐顺序:
1. **Facebook NZ Tramping**(收益最大)
2. **小红书**(补 App Store 中国区拿不到的年轻女性视角)
3. **Day One 社区**(如存在)
4. **微信**(收益低,可选)
5. **Te Araroa Trail**(和 NZ Tramping 重叠度高,可选)
