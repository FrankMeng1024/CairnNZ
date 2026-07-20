# Google Email 登录 Bug 根因诊断报告 (2026-07-20)

## 🎯 Bug 总览

Google Sign-In 按钮显示但**完全不可用**，点击只弹 alert "Coming in next app update"。

## 🔍 3 个独立根因（全部要修才能通）

### 根因 #1: expo-auth-session 缺 `scheme` 配置
- **File**: `app/app.json`
- **问题**: `scheme` 字段缺失（bundleIdentifier `com.yiiling.cairn` 有，但 scheme 没）
- **影响**: expo-auth-session 的 `makeRedirectUri()` 无法生成合法的 iOS deep-link redirect URL
- **历史**: 2026-05-21 OTA bisect 定位到 Google OAuth hook 会导致 sign-out crash — 根因就是没 scheme
- **代码**: `AuthScreen.tsx:472-479` — Google OAuth 被主动禁用，注释说 "Real fix requires app.json scheme for makeRedirectUri to work — coming in next build"
- **修复**: `app.json.expo.scheme = "cairn"`
- **需要**: **native rebuild**（EAS build），不能 OTA 修
- **工作量**: 加 1 行 config + 一次 EAS build（30 分钟触发,~40 分钟 build 队列）

### 根因 #2: **GFW 阻断 aliyun→Google 出口** (真正的硬阻塞)
- **服务器位置**: 上海 (`122.51.174.118`, Tencent Cloud, region=Shanghai, country=CN)
- **测试结果**:
  - DNS 解析正常（`oauth2.googleapis.com → 74.125.20.95` 拿得到）
  - TCP 443 连接**被 GFW 拒**（`nc -zv 172.217.194.95 443 → blocked`）
  - HTTPS 请求 → HTTP 000 (connection failed) after 4-7s timeout
- **代码调用链**:
  ```
  frontend loginWithGoogle(idToken)
    → POST /api/auth/google
    → backend googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })
    → google-auth-library 内部调 oauth2.googleapis.com/certs
    → ⚠️ 超时挂起 → 前端看到 nginx 504 Gateway Timeout
  ```
- **影响**: 就算根因 #1 修好、iOS app 拿到 id_token 发到 backend，backend 也**永远无法验证 token**
- **修复选项** (4 选 1):
  - **A. 前端直接调 Google + 白名单转发** — 前端已能拿 id_token（用户设备可以访问 Google），后端跳过 verifyIdToken,只用 payload 里的 email/sub 建/找 user。**降低安全性**（伪造 id_token 无法防御）。
  - **B. Cloudflare Worker 代理** — 加中间层 `oauth-proxy.cairn.workers.dev`，backend 请求走 Worker，Worker 从香港/新加坡机房调 Google。**加 100-200ms 延迟**，但安全性保留。
  - **C. 迁 backend 到海外** — 用户在 NZ,应该本来就应该在 NZ/AU/HK 部署。**大迁移，1-2 天**。
  - **D. 弃 Google OAuth** — 只留 email/password 登录。用户会失去一键登录，注册率下降。
- **推荐**: **B (Cloudflare Worker)** — 保留 Google OAuth 又不改架构，加 2-3 小时

### 根因 #3: Backend `/api/auth/google` 是好的
- **Verified**: Joi 验证 ✅ (empty body → 400 with details)
- **Verified**: 完整实现 ✅ (findByEmail / OAuth link / new user create / JWT signing 都对)
- **Verified**: `GOOGLE_CLIENT_ID` env 已配置
- **无问题** — 只是被根因 #2 卡死

## 🛠️ 修复顺序

### 立刻可做 (无 blocker)
1. **添加 `app.json.expo.scheme = "cairn"`** (根因 #1)
2. **决定根因 #2 走哪条路**（这需要你判断）— 我推荐 B (Cloudflare Worker)

### 需要 native build
3. 触发 EAS build（因为 app.json scheme 改动是 native config，不能 OTA）
4. 提交 TestFlight / Play Store

## 📊 当前用户体验

用户点 "Continue with Google":
1. 看到 spinner "Connecting…" (500ms)
2. 弹 alert "Coming in next app update. Please use email sign-in."
3. 关掉 alert 回到 Sign In 表单

**每次都是这个死循环**，因为 `promptGoogleAsync` 直接短路成 alert (line 476-479)。

## 🎓 教训

- **早期开发在中国部署 backend + 用外国 OAuth = 结构性冲突**
- 我们之前**只讨论**了根因 #1 的 native scheme 问题,**没意识到**根因 #2 GFW 硬阻塞
- 就算今天有人给你一份完美的 iOS Google OAuth id_token,当前 aliyun backend **也验不出来**

**下一步**: 你决定走 A/B/C/D 哪条路后我再动手。
