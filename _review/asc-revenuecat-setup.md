# ASC / RevenueCat 建立步骤 (你手动操作, 30-60 分钟)

## Step 1: App Store Connect — 创建订阅产品 (15-20 分钟)

1. 打开 https://appstoreconnect.apple.com/ → 登录你的 Apple Developer 账号
2. 选 **Cairn** app (bundleID: `com.yiiling.cairn`)
3. 左边栏 → **App Store** → **In-App Purchases and Subscriptions** → **Subscriptions**
4. 点 **+ 号 → Auto-Renewable Subscription**
5. 首先创建 **Subscription Group**:
   - Reference Name: `Cairn Premium`
   - 保存
6. 在 group 里 **+ 号** 加 subscription:
   - **Reference Name**: `Cairn Premium Monthly`
   - **Product ID**: `cairn.premium.monthly` (记住这个, 我代码里要用)
   - 下一步
7. **Subscription Duration**: 1 Month
8. **Subscription Prices**:
   - Add Price → New Zealand → **NZ$5.99**
   - (可选加其他国家, 或者先只 NZ)
   - Save
9. **Localizations** (App Review 会看):
   - English (NZ): 
     - Display Name: `Cairn Premium Monthly`
     - Description: `Unlock unlimited memory subscriptions, share your fog-of-war map, and support Cairn's development.` (你可以改)
10. **Review Information**:
    - Screenshot: 上传一张 paywall 页面截图 (可以先用现有 PaywallSheet 截图)
    - Review Notes: `Monthly subscription to Cairn Premium features` (可以改)
11. **Save** — 状态会是 "Ready to Submit"
12. **Submit for Review** — Apple 内部审核 24-48h

**同时创建年费版** (可选):
- 重复 5-11 步, Product ID: `cairn.premium.yearly`, Duration: 1 Year, Price: NZ$59.99

## Step 2: ASC — 创建 Sandbox Tester (5 分钟)

1. ASC 首页 → **Users and Access** → 左边 **Sandbox** → **Testers**
2. **+ 号**
3. 填假名 + 假邮箱 (**不能**和你 Apple ID 一样, 也不能是真实存在的 email — 用 `sandbox+test@example.com` 或类似)
4. 密码自定义 (记下来)
5. Country: New Zealand
6. Save
7. **重要**: 你在 iPhone 上 Settings → App Store → Sandbox Account → 用这个 sandbox 账号登入 (**不是登入设备**, 只是 sandbox App Store 账号). 这样测 IAP 时会用 sandbox 环境.

## Step 3: RevenueCat 注册 + 配置 (15-25 分钟)

1. 打开 https://app.revenuecat.com/ → 注册免费账号 (用你的邮箱)
2. **Create new Project** → 名字: `Cairn`
3. Project 里 → **Project Settings** → **Apps** → **+ New app** → iOS
4. 填:
   - App name: `Cairn`
   - App Store Connect API Key: 
     - 你要在 ASC → Users and Access → Integrations → App Store Connect API → **+ Generate API Key**
     - Access: Admin (或 Developer 也行)
     - 下载 `.p8` 文件, 记下 Key ID 和 Issuer ID
     - RC 里上传 .p8 + 填 Key ID + Issuer ID
   - Bundle ID: `com.yiiling.cairn`
5. Save
6. **Products** 标签 → RC 会自动从 ASC 拉商品列表 (需要几分钟). 如果没自动出现, 手动 **+ New Product**:
   - Store: App Store
   - Identifier: `cairn.premium.monthly` (跟 ASC 一致)
7. **Entitlements** → **+ New Entitlement**:
   - Identifier: `premium`
   - 关联 Product: `cairn.premium.monthly` (以及年费, 如果建了)
8. **Offerings** → **+ New Offering**:
   - Identifier: `default`
   - 添加 Package:
     - Identifier: `$rc_monthly` (RC 标准)
     - 关联 Product: `cairn.premium.monthly`
   - (如果建了年费, 加另一个 package `$rc_annual`)
9. **API Keys** → **Public app-specific API keys** → iOS → **复制这个 key** 发给我 (前端代码要用)
10. **Webhooks** (后端后续用):
    - Endpoint URL: `https://api.yiiling.cn/api/iap/webhook` (我后续在后端建这个)
    - 现在先记住, RC 后台 → Project Settings → Webhooks → Add Webhook
    - 我建完 endpoint 你再回来加

## 完成后告诉我

- ✅ ASC 商品 `cairn.premium.monthly` 提交审核 (等 24-48h)
- ✅ ASC Sandbox tester 账号建了
- ✅ RevenueCat public API key 给我 (前端集成用)
- ✅ (可选) Annual 商品 `cairn.premium.yearly` 也建了

**24-48h 后 ASC 商品 approved 会邮件通知你**. Approved 后我们才能真跑 sandbox 购买流.

---

## 补充: 如果你 Apple Developer 账号有问题

- 账号年费 $99 USD/年 — 请确认已付, 没过期
- 到期日在 https://developer.apple.com/account/ 可以看
- 过期会导致所有 App 下架

---

## 我下一步 (async, 不等你)

- 修 plan v3 → plan v4 (加 Pre-Build 关卡 + 显式 backend deploy 策略 + IAP 前置章节)
- 你审 v4 后开工 B6.0 Onboarding
- 你 async 建 ASC + RC (今天/明天)
- 24-48h 后 ASC approved, B6.8 IAP 就能真跑 sandbox
