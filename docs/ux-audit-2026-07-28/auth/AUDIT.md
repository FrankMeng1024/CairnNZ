# AuthScreen Audit

**Auditor**: Cairn UX/UI Auditor #2
**Date**: 2026-07-28
**Scope**: `src/screens/AuthScreen.tsx` (splash + login + register + verify + welcome + all error/loading states)
**Baseline**: `src/screens/SettingsScreen.tsx`
**Method**: static read of source + design token comparison + Playwright script per scenario

---

## Scenarios (28)

### S01: Splash cold boot (logged-out, no cached creds)
- 功能: Auth gate, first paint after cold start
- 预期 UI: SafeAreaView, animated Cairn (3 stones rising over ~2.5s then flag drops+waves), wordmark "Cairn" (56pt, 900 weight, letterSpacing -2.5), 2-line tagline "Leave a mark." / "Guide the next.", OtaBadge inline slot (32px fixed height), Sign In primary (green pill), Create Account secondary (white pill w/ border), 12pt textSecondary hint "Your hiking data is securely stored..."
- 一致性: 9/10 — 与 SettingsScreen 共享 tokens (Colors.primary, Radius=28 pill, Shadow.fab, Spacing.xl). tagline lineHeight 26 匹配全局 h3
- UX: 8/10 — 分阶段动画 (stone1 → stone2 → stone3 → flag drop + wave) 传递 "堆石成塔" 品牌隐喻,但完整入场 ≈2.5s,回归用户每次冷启都要等
- Issues:
  - 破碎: `AnimatedCairn` 使用 setInterval + setState 每 16ms rerender (line 154, 198),iOS 低端机可能掉帧;waveTimer 未 unmount 时组件切换到 login 前不会立即清 (依赖 useEffect cleanup)
  - 丑: `appName` 用 `marginTop: -2` 强对齐 (line 1188),视觉 hack
  - 不一致: `splashOtaWrap` 固定 32px 高度 (line 1198-1203) 与其它界面 OtaBadge (SettingsScreen 顶部) 无对齐规范
  - **潜在坑**: 回归用户 (`rememberMe=true`) 冷启还是要看完 2.5s 动画才能点 Sign In — 应该考虑 skip button 或短版动画

### S02: Splash — back from login (re-enters splash via Back)
- 功能: 从 login view 返 splash 时 stones 应从头重播
- 预期 UI: `splashMountKey` 递增导致 AnimatedCairn 完全 remount,stones 从 y=30 重新升起
- 一致性: 9/10
- UX: 6/10 — 回退动作被 2.5s 动画 "惩罚",用户可能感觉卡
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: back 到 splash 每次都重播完整动画,而进入 login/register 表单没有等长动画,节奏不匹配

### S03: Sign In view — empty state, first render
- 功能: email + password 输入 (autofocus email),Remember me checkbox,Sign In 按钮,分割线 "or continue with",Apple + Google 按钮
- 预期 UI: BackBtn top-left, titleRow (CairnLogo 28px + "Sign In" h1 800 weight),Email label + FieldInput (Mail icon),Password label + PasswordInput (KeyRound icon + eye toggle),rememberRow,primary submit,`staySignedIn` copy "You'll stay signed in for 30 days.",divider,Apple 黑,Google 白+border
- 一致性: 9/10 — button/border radius/shadow 与 SettingsScreen 一致
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: `staySignedIn` 用 `Colors.textMuted` 与下方分割线 `divText` 同色同字号,信息层次糊在一起 (line 1278-1281 vs 1285)
  - 不一致: Apple 按钮 minHeight=52,Google 按钮 minHeight=52,但 primary Sign In 按钮 minHeight=56 (styles.primaryBtn),同一列 CTA 高度差 4px 视觉不齐

### S04: Sign In view — email input focus (autoFocus)
- 功能: `autoFocus={!isRegister}` 自动打开键盘
- 预期 UI: email 输入框 border 变 primary (`inputFocused`),bg 变 primaryBg,icon 从 textMuted 变 primary
- 一致性: 10/10
- UX: 9/10 — focus 状态明显
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S05: Sign In view — password reveal eye toggle
- 功能: 点 eye icon 切换 secureTextEntry
- 预期 UI: EyeOff ↔ Eye icon 切换,密码明文/星号切换
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: eye button 没有 accessibilityLabel,VoiceOver 用户只听到 "button"
  - 丑: eye button padding 只有 Spacing.xs (4px),tap target < 44pt Apple HIG 最低标准
  - 不一致: -

### S06: Create Account view — empty
- 功能: name (autofocus) + email + password + confirm + privacy checkbox
- 预期 UI: 同 Sign In 但多 Name/Confirm/Privacy 字段,submit 按钮改成 "Create Account" + UserPlus icon
- 一致性: 8/10
- UX: 7/10
- Issues:
  - 破碎: `autoFocus={isRegister}` 在 Name 字段 (line 1006) + `autoFocus={!isRegister}` 在 Email (line 1021),register 时同时有两个 autoFocus,RN 行为未定义 (先渲染的赢),iOS/Android 可能不一致
  - 丑: Confirm Password 下方缺少 "8+ characters" 提示 (只 Password 字段有 line 1035-1037)
  - 不一致: register 视图无 "or continue with" 分割线和 social login,而 login 有 — 用户想用 Google 注册无路径

### S07: Create Account — 密码 hint "Minimum 8 characters"
- 功能: register 且无 error 时显示 hint (line 1035-1037)
- 预期 UI: 灰色 (textSecondary) 常规字重的 fieldError 样式
- 一致性: 7/10 — 复用 `fieldError` 样式但改颜色和字重,style override 双重定义
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: hint 与 error 用同一 slot,当用户输错时 hint 消失,视觉抖动
  - 不一致: 复用 error style 表达 "提示",语义混乱 (应有独立 `fieldHint` style)

### S08: Verify email code page
- 功能: 6-digit code 输入,Verify button,Resend link (60s cooldown)
- 预期 UI: BackBtn → register,titleRow "Check your email" + CairnLogo 28px,sub text 含高亮 email,单 Lock icon input placeholder "123456" (number-pad, autofocus, textContentType=oneTimeCode)
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: BackBtn 返 register 会保留原表单数据 (name/email/password 状态未清),但 `handleViewChange` 会 `resetErrors()` — 数据保留但错误状态清空,行为半吊子
  - 丑: 6-digit 用单行 TextInput + placeholder "123456" 而非 6 个独立 code cells (业界标准 iOS Passcode UI),缺乏 "输入进度感"
  - 不一致: input 的 label 是 "Verification Code" 但 title 是 "Check your email",placeholder 是 "123456" — 三处文案不同源

### S09: Verify — resend cooldown active
- 功能: 60s 倒计时,链接文字 "Resend in Ns" 灰色不可点
- 预期 UI: `resendCooldown > 0` → textSecondary 色,`disabled`
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: disabled state 通过 color 表达,但 TouchableOpacity 仍会响应 press ripple (opacity 0.2),视觉误导
  - 丑: -
  - 不一致: 倒计时格式 "Resend in 59s" 单数复数不区分 (1s vs 59s)

### S10: Verify — resend cooldown complete
- 功能: 60s 归零后 "Resend code" 变绿色可点
- 预期 UI: primary 色链接
- 一致性: 10/10
- UX: 9/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S11: Welcome screen (post-register, with name)
- 功能: 注册成功 verify 通过后展示 1.8s 后自动跳 Home
- 预期 UI: CircleCheck 56px 绿,`Welcome, {welcomeName}!`(用 styles.appName 56pt/900),"Nau mai, haere mai" 副标, "Your track starts now."
- 一致性: 8/10 — 复用 styles.appName 但语义变了 (从品牌 wordmark 变问候语),字号可能过大
- UX: 8/10
- Issues:
  - 破碎: 长名字 (>15 char) 会溢出 (56pt 无 fontShrink),测试用例 "Christopher Alexander" 会被 wrap 到 2 行
  - 丑: 只显示 1.8s (line 686 `setTimeout(...,1800)`) 用户没读完就跳
  - 不一致: 用 setTimeout 硬转 Home 而不是 setState + Navigator listener,如果 unmount 时 timer 未清可能 crash (虽然实测未见)

### S12: Welcome — no name fallback "friend"
- 功能: `welcomeName || 'friend'` (line 684, 773)
- 预期 UI: "Welcome, friend!"
- 一致性: 9/10
- UX: 6/10 — "friend" 有点老美自来熟,新西兰用户可能感觉 off-brand
- Issues:
  - 破碎: -
  - 丑: 语气与 Cairn "户外/严肃" 品调不匹配
  - 不一致: -

### S13: Apple Sign In button — press
- 功能: 未实装,Alert.alert("Coming soon", ...)
- 预期 UI: 全黑按钮,Apple icon + "Continue with Apple"
- 一致性: 8/10
- UX: 4/10 — Blocker: Apple HIG 规定 App Store 上 iOS app 若有第三方登录 (Google) 就必须提供 Apple Sign In 实装,否则拒审 (指引 4.8)。当前 "Coming soon" 是**上架 blocker**
- Issues:
  - 破碎: Apple button 无实功能,点了弹 Alert
  - 丑: -
  - 不一致: **App Store rejection risk** — Apple HIG 4.8

### S14: Google Sign In button — press
- 功能: 未实装,Alert.alert("Google Sign In", "Coming in next app update...")
- 预期 UI: 白色 button + border,自制 Google "G" 字块 (blue #4285F4 on white)
- 一致性: 5/10 — 自制 "G" logo 不符 Google Brand Guidelines (应用官方 SVG multi-color G)
- UX: 4/10
- Issues:
  - 破碎: Google button 无实功能 (line 448-454 `googleRequest=null`)
  - 丑: `googleG` 是 20×20 白底加 blue 大写 G,Google 官方多彩 G logo 完全不同 — 品牌违规
  - 不一致: **Google Brand Guidelines violation** — 商用发布可能被 Google 索赔或拒审

### S15: Error — invalid email format (register)
- 功能: submit 时 `validateEmail` 触发,line 577 register 才做 regex
- 预期 UI: inputWrap borderColor 变 danger,`fieldError` "Please enter a valid email"
- 一致性: 10/10
- UX: 7/10
- Issues:
  - 破碎: **login 时不校验 email 格式** (line 577 `if (view === 'register')`) — 用户 login 输 "abc" 会送到 backend 才拒,浪费一次 round-trip
  - 丑: -
  - 不一致: register vs login 校验规则不一

### S16: Error — password too short (register)
- 功能: submit 时 `validatePassword`,register 要 ≥ 8 char
- 预期 UI: PasswordInput danger border, "Minimum 8 characters"
- 一致性: 10/10
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: 与 S07 hint 用同一 slot,error 出现时 hint 消失 → 视觉抖动

### S17: Error — passwords don't match (register)
- 功能: submit 时 confirm != password 且 `onBlur` 时也校验
- 预期 UI: Confirm 字段 danger border, "Passwords do not match"
- 一致性: 10/10
- UX: 8/10
- Issues:
  - 破碎: onBlur (line 1066) `if (confirm && confirm !== password) setConfirmError(...)` 但**不会清错**,用户改对了 confirm 也没 clear (line 1063 `onChangeText` 会 clear)—OK
  - 丑: -
  - 不一致: -

### S18: Error — privacy not checked (register)
- 功能: submit 时 privacyChecked=false
- 预期 UI: fieldError "Please agree to continue" (line 1093)
- 一致性: 9/10
- UX: 7/10
- Issues:
  - 破碎: 错误文字 "Please agree to continue" 显示在 privacy row 下方但不与 checkbox 视觉关联 (无 danger border 高亮 checkbox)
  - 丑: -
  - 不一致: 其它字段用 inputWrap border color 表达 error,privacy checkbox 只有文字 error,视觉一致性缺

### S19: Error — backend 401 wrong password
- 功能: `login()` 返 `{error: '...'}`,apiError banner 顶部显示
- 预期 UI: dangerBg 背景 banner + TriangleAlert icon + 错误文字
- 一致性: 10/10
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S20: Error — backend 429 rate limit
- 功能: 同 S19 走 apiError 通道
- 预期 UI: banner 显示 backend 返的原始 error message
- 一致性: 9/10
- UX: 5/10 — Blocker level: banner 展示 raw backend 错误 (line 615 `setApiError(result.error)`),可能是 `"Too Many Requests"` 或 `"Rate limit exceeded, try again in 60s"` — 未做 UX friendly 转换
- Issues:
  - 破碎: 无 429 专门 handling,依赖 backend 文案质量
  - 丑: -
  - 不一致: 只有 409 (email exists) 有专门 friendly message (line 612-614),其它 status code 全用原文

### S21: Error — verify code wrong
- 功能: `verifyCode()` 返 error,setVerifyError
- 预期 UI: input danger border + apiBanner
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: 错完不会自动清 input,用户要手动删
  - 丑: -
  - 不一致: -

### S22: Error — verify code expired
- 功能: 依赖 backend 返 "Code expired" 或类似
- 预期 UI: 同 S21 走 verifyError banner
- 一致性: 8/10
- UX: 6/10
- Issues:
  - 破碎: 无 "expired vs wrong" 分类文案,expired 状态下应该自动触发 resend 提示
  - 丑: -
  - 不一致: -

### S23: Error — network offline (fetch fail)
- 功能: catch block 检测 TypeError/Network request failed/Failed to fetch,统一转 "Cannot reach the server..."
- 预期 UI: apiError banner 友好中英文
- 一致性: 10/10
- UX: 9/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: verify 路径 (line 760 `verifyCode`) 无这个 network catch,verify 时断网会直接展示 raw error

### S24: Loading state — login in progress
- 功能: `loading=true`,submit button disabled,button 内 ActivityIndicator 白色替换 icon
- 预期 UI: 按钮 opacity 0.5,button 文字保留 "Sign In",spinner 在文字前
- 一致性: 10/10
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S25: Loading state — Google sign in in progress
- 功能: `googleLoading=true`,Google button 显示 spinner + "Connecting…"
- 预期 UI: `googleGText` G 替换为 spinner,文字换 "Connecting…"
- 一致性: 9/10
- UX: 7/10 — Blocker: 由于 `promptGoogleAsync` 是 Alert (line 452),loading state 实际只闪一下就结束,配置了 UI 但功能不通
- Issues:
  - 破碎: 走通完整 spinner state 需要真 OAuth,当前 Alert 立即返回,spinner 只可能出现一帧
  - 丑: -
  - 不一致: -

### S26: Overflow — long name (register)
- 功能: name field 60+ 字符
- 预期 UI: 输入框内文字水平滚动 (RN TextInput 默认),不 wrap
- 一致性: 9/10
- UX: 7/10
- Issues:
  - 破碎: **welcome screen 长名字会导致 appName (56pt) wrap 到多行,可能溢出容器** (S11 已提)
  - 丑: -
  - 不一致: -

### S27: Overflow — long email (login)
- 功能: email 输入 60+ 字符
- 预期 UI: 输入框水平滚动
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: apiBanner (line 992) 用 flex:1,长 error 文字会 wrap,但 primary btn label 无 wrap 逻辑,极端场景 (超长错误信息) 挤压 icon

### S28: Keyboard covers submit button on iPhone SE (375×667)
- 功能: KeyboardAvoidingView (behavior='padding' on iOS) 上推整个 ScrollView
- 预期 UI: 键盘弹起后 submit button 应仍可见,或 ScrollView 可滚动到底
- 一致性: 8/10
- UX: 7/10
- Issues:
  - 破碎: register 视图字段多 (name+email+pw+confirm+privacy+expanded policy+submit),iPhone SE 加键盘可能挤到 privacy expanded scrollview 内部滚动嵌套,双层 ScrollView 手势冲突
  - 丑: -
  - 不一致: `keyboardShouldPersistTaps="handled"` 但 privacy expanded 用 `nestedScrollEnabled` — 嵌套滚动在 iOS 有已知手势竞争

### S29: iPad landscape
- 功能: SafeAreaView + Dimensions.get('window').height 拿到宽屏
- 预期 UI: `logoArea` minHeight = 42% 屏高
- 一致性: 5/10
- UX: 4/10
- Issues:
  - 破碎: **无 iPad 适配** — 表单全宽拉满 (Spacing.xl padding + flex),在 iPad 上 primary btn 会 800px+ 宽,极其难看
  - 丑: 56pt wordmark 在 iPad 上比例失衡
  - 不一致: SettingsScreen 也无 iPad 布局,但 auth 是首屏,更需要

### S30: Playwright bypass mode
- 功能: 无源码级 bypass hook (与 web-test 的 `__cairnStores` 不同,此屏未 export)
- 预期 UI: 无
- 一致性: N/A
- UX: N/A
- Issues:
  - 破碎: web Playwright 只能通过 email/password 走真流程 (需真 backend),QA 需一组已知测试账号
  - 丑: -
  - 不一致: -

### S31: OTA badge on splash — idle
- 功能: `<OtaBadge inline />` 未设 `idleHidden`,idle 状态下会显示 pill
- 预期 UI: 32px 高固定容器,idle 状态下 pill 内容为空或 "Latest" (取决 OtaBadge 实现)
- 一致性: 7/10
- UX: 6/10
- Issues:
  - 破碎: `splashOtaWrap` 固定 32px 高即使 idle 也占位,视觉留白 (设计意图)
  - 丑: 但 OtaBadge 组件 idle 不 hide 时会显示某种状态,与 splash 品牌感冲突
  - 不一致: **应该传 `idleHidden` prop 到 OtaBadge** (line 827),splash 只在有真更新时显示 pill

### S32: OTA badge — checking / downloading / ready / error
- 功能: OtaBadge 状态机 (line 289+)
- 预期 UI: `checking` — spinner + text; `downloading` — progress; `ready` — pulse + 可点; `error` — red
- 一致性: 9/10
- UX: 8/10
- Issues:
  - 破碎: inline 模式 (splash 用) `useEffect` line 303-312 直接 return,只在 floating 模式做 fade;splash 上状态切换无过渡动画
  - 丑: -
  - 不一致: floating 模式和 inline 模式动画行为不同,QA 需要额外覆盖

### S33: Auto-fill from iOS Keychain
- 功能: `textContentType="emailAddress"` + `autoComplete="email"` (email); `textContentType="password"` + `autoComplete="password"` (login pw); `newPassword`/`password-new` (register)
- 预期 UI: iOS 键盘上方 QuickType 显示 "Passwords" 建议
- 一致性: 10/10
- UX: 9/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S34: Password autocomplete attributes — register vs login
- 功能: PasswordInput `isNew` 切换 `newPassword`/`password-new`
- 预期 UI: register 触发 "Suggest Strong Password"; login 触发 "Passwords"
- 一致性: 10/10
- UX: 9/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: -

### S35: Focus state clarity
- 功能: `inputFocused` (border primary + primaryBg 背景)
- 预期 UI: 焦点变深绿边框 + 淡绿底
- 一致性: 10/10
- UX: 9/10
- Issues:
  - 破碎: -
  - 丑: -
  - 不一致: privacy checkbox / rememberMe checkbox 无 focus ring (键盘 tab 导航时无视觉反馈,iPad 用户 keyboard navigation 会迷失)

### S36: Privacy policy expanded — read policy
- 功能: 点 "Privacy Policy" 链接 `setPrivacyExpanded(true)`
- 预期 UI: 嵌套 ScrollView (maxHeight 220px) 内展示完整 policy text
- 一致性: 8/10
- UX: 6/10
- Issues:
  - 破碎: 嵌套 ScrollView 在 iOS 键盘弹起时手势冲突 (S28 已提)
  - 丑: 220px maxHeight 太小,policy 需滚 6+ 次才读完,不如打开外链或全屏 modal
  - 不一致: policy 全屏体验和其它 modal (Settings 里的 About/Legal) 未对齐

### S37: Consistent title row w/ CairnLogo
- 功能: login/register/verify 三个视图都用 `titleRow` (CairnLogo 28 + h1 title)
- 预期 UI: 一致的品牌头
- 一致性: 8/10
- UX: 8/10
- Issues:
  - 破碎: login/register 用 `marginTop: -7` hack 对齐 (line 977),verify 无 hack (line 874),两处 CairnLogo 视觉位置**不一致**
  - 丑: hack 值 -7 无注释解释推导过程 (line 975-977 有注释但无数学依据)
  - 不一致: **verify 路径 CairnLogo 高 7px** — 直接可见的 layout drift

### S38: Splash CTA hint text
- 功能: "Your hiking data is securely stored..." 提示 (line 843-854)
- 预期 UI: 12pt textSecondary,居中,paddingHorizontal 24
- 一致性: 6/10
- UX: 7/10
- Issues:
  - 破碎: **inline styles 不用 tokens** (line 844-854 全 hardcode `marginTop:12`, `fontSize:12`, `lineHeight:16`),违反 tokens.ts 单点原则
  - 丑: -
  - 不一致: 其它文本用 `FontSize.small` (11) 或 `FontSize.caption` (13),这里独用 12 — 无 token 对应

---

## Playwright scripts

> 环境: `http://localhost:8086/` (Expo web dev server)
> 支持指令: NAVIGATE / CLICK / TYPE / WAIT / SCREENSHOT / FULLPAGE_SCREENSHOT / RESIZE / EVALUATE

### S01: Splash cold boot
```
NAVIGATE http://localhost:8086/
EVALUATE localStorage.clear()
WAIT 500
NAVIGATE http://localhost:8086/
WAIT 500
SCREENSHOT auth/S01-splash-0s.png
WAIT 1500
SCREENSHOT auth/S01-splash-2s.png
WAIT 2000
SCREENSHOT auth/S01-splash-final.png
FULLPAGE_SCREENSHOT auth/S01-splash-full.png
```

### S02: Splash back-from-login remount
```
NAVIGATE http://localhost:8086/
EVALUATE localStorage.clear()
WAIT 500
NAVIGATE http://localhost:8086/
WAIT 3000
CLICK text=Sign In
WAIT 500
SCREENSHOT auth/S02-login-view.png
CLICK text=Back
WAIT 500
SCREENSHOT auth/S02-splash-remount-0s.png
WAIT 1500
SCREENSHOT auth/S02-splash-remount-2s.png
```

### S03: Sign In view empty
```
NAVIGATE http://localhost:8086/
EVALUATE localStorage.clear()
WAIT 500
NAVIGATE http://localhost:8086/
WAIT 3000
CLICK text=Sign In
WAIT 800
FULLPAGE_SCREENSHOT auth/S03-signin-full.png
SCREENSHOT auth/S03-signin-viewport.png
```

### S04: Email input focus
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
CLICK placeholder="your@email.com"
WAIT 300
SCREENSHOT auth/S04-email-focused.png
```

### S05: Password eye toggle
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
CLICK placeholder="••••••••"
TYPE placeholder="••••••••" secretpass123
SCREENSHOT auth/S05-password-hidden.png
CLICK [aria-label="Eye"]  # or first eye icon after password field
WAIT 200
SCREENSHOT auth/S05-password-shown.png
```

### S06: Create Account empty
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
WAIT 500
FULLPAGE_SCREENSHOT auth/S06-register-full.png
SCREENSHOT auth/S06-register-viewport.png
```

### S07: Password hint minimum 8
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
WAIT 300
CLICK placeholder="Min. 8 characters"
SCREENSHOT auth/S07-pw-hint-visible.png
TYPE placeholder="Min. 8 characters" abc
CLICK placeholder="Your name"
WAIT 200
SCREENSHOT auth/S07-pw-error-replaces-hint.png
```

### S08: Verify code page
```
# needs to trigger register flow with test email — depends on backend test account
NAVIGATE http://localhost:8086/
CLICK text=Create Account
TYPE placeholder="Your name" QA Tester
TYPE placeholder="your@email.com" qa-test-2026-07-28@cairnapp.nz
TYPE placeholder="Min. 8 characters" qatestpass123
TYPE placeholder="Re-enter password" qatestpass123
CLICK text="Privacy Policy" # first click checkbox tap zone
CLICK text=Create Account  # submit btn
WAIT 3000
SCREENSHOT auth/S08-verify-view.png
```

### S09: Verify resend cooldown active
```
# continue from S08
SCREENSHOT auth/S09-cooldown-active.png
WAIT 30000
SCREENSHOT auth/S09-cooldown-30s.png
```

### S10: Verify resend cooldown complete
```
# continue from S09, wait for 60s total
WAIT 30000
SCREENSHOT auth/S10-cooldown-done.png
```

### S11: Welcome with name
```
# continue from S08 after entering valid verify code from backend/email inbox
TYPE placeholder="123456" 123456  # use real code
CLICK text="Verify Email"
WAIT 500
SCREENSHOT auth/S11-welcome-with-name.png
WAIT 1500
SCREENSHOT auth/S11-welcome-before-nav.png
```

### S12: Welcome no name fallback
```
# manually construct via EVALUATE to skip register form
NAVIGATE http://localhost:8086/
EVALUATE localStorage.clear()
# would need test hook exposing setWelcomeName('') + setView('welcome')
SCREENSHOT auth/S12-welcome-friend-fallback.png
```

### S13: Apple button press
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
CLICK text="Continue with Apple"
WAIT 500
SCREENSHOT auth/S13-apple-coming-soon-alert.png
```

### S14: Google button press
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
CLICK text="Continue with Google"
WAIT 500
SCREENSHOT auth/S14-google-alert.png
```

### S15: Invalid email (register)
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
WAIT 300
TYPE placeholder="Your name" QA
TYPE placeholder="your@email.com" notavalidemail
TYPE placeholder="Min. 8 characters" abcdefgh
TYPE placeholder="Re-enter password" abcdefgh
CLICK checkbox  # privacy
CLICK text="Create Account"  # submit
WAIT 500
SCREENSHOT auth/S15-invalid-email-error.png
```

### S16: Password too short
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
TYPE placeholder="Your name" QA
TYPE placeholder="your@email.com" qa@cairnapp.nz
TYPE placeholder="Min. 8 characters" abc
TYPE placeholder="Re-enter password" abc
CLICK checkbox
CLICK text="Create Account"
WAIT 500
SCREENSHOT auth/S16-short-password.png
```

### S17: Passwords don't match
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
TYPE placeholder="Your name" QA
TYPE placeholder="your@email.com" qa@cairnapp.nz
TYPE placeholder="Min. 8 characters" pass1234
TYPE placeholder="Re-enter password" different5678
CLICK checkbox
CLICK text="Create Account"
WAIT 500
SCREENSHOT auth/S17-passwords-mismatch.png
```

### S18: Privacy not checked
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
TYPE placeholder="Your name" QA
TYPE placeholder="your@email.com" qa@cairnapp.nz
TYPE placeholder="Min. 8 characters" pass1234
TYPE placeholder="Re-enter password" pass1234
# skip privacy checkbox
CLICK text="Create Account"
WAIT 500
SCREENSHOT auth/S18-privacy-required.png
```

### S19: 401 wrong password
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
TYPE placeholder="your@email.com" real-account@cairnapp.nz
TYPE placeholder="••••••••" wrongpassword
CLICK text="Sign In"
WAIT 2000
SCREENSHOT auth/S19-401-banner.png
```

### S20: 429 rate limit
```
# Need to hammer backend 30+ times in a minute — best via EVALUATE loop
NAVIGATE http://localhost:8086/
CLICK text=Sign In
EVALUATE for(let i=0;i<40;i++){fetch('/api/auth/login',{method:'POST',body:JSON.stringify({email:'x@x.com',password:'x'}),headers:{'content-type':'application/json'}})}
WAIT 3000
TYPE placeholder="your@email.com" real@cairnapp.nz
TYPE placeholder="••••••••" realpass
CLICK text="Sign In"
WAIT 2000
SCREENSHOT auth/S20-429-banner.png
```

### S21: Verify code wrong
```
# after S08 register flow reaches verify view
TYPE placeholder="123456" 000000
CLICK text="Verify Email"
WAIT 2000
SCREENSHOT auth/S21-wrong-code.png
```

### S22: Verify code expired
```
# Wait 15+ min for real expiry (backend-dependent) or trigger via test endpoint
WAIT 900000  # 15min — best as separate scheduled test
TYPE placeholder="123456" 123456
CLICK text="Verify Email"
WAIT 2000
SCREENSHOT auth/S22-expired-code.png
```

### S23: Network offline
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
EVALUATE window.__origFetch = window.fetch; window.fetch = () => Promise.reject(new TypeError('Network request failed'))
TYPE placeholder="your@email.com" any@cairnapp.nz
TYPE placeholder="••••••••" anypass
CLICK text="Sign In"
WAIT 2000
SCREENSHOT auth/S23-offline-banner.png
EVALUATE window.fetch = window.__origFetch
```

### S24: Loading state login
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
EVALUATE window.__origFetch = window.fetch; window.fetch = (...a) => new Promise(r=>setTimeout(()=>r(window.__origFetch(...a)),3000))
TYPE placeholder="your@email.com" test@cairnapp.nz
TYPE placeholder="••••••••" testpass
CLICK text="Sign In"
WAIT 500
SCREENSHOT auth/S24-loading-spinner.png
EVALUATE window.fetch = window.__origFetch
```

### S25: Google loading
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
CLICK text="Continue with Google"
# spinner will flash for 1 frame — need video capture, not screenshot
WAIT 100
SCREENSHOT auth/S25-google-loading-flash.png
```

### S26: Long name overflow
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
TYPE placeholder="Your name" ChristopherAlexanderMcAllisterVonWittgensteinTheThird
SCREENSHOT auth/S26-longname-input.png
# skip to welcome — would need test hook
```

### S27: Long email overflow
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
TYPE placeholder="your@email.com" reallylonguseremailaddress-with-extra-domains@sub.department.example-organization.co.nz
SCREENSHOT auth/S27-longemail-input.png
```

### S28: iPhone SE keyboard cover
```
RESIZE 375 667
NAVIGATE http://localhost:8086/
CLICK text=Create Account
WAIT 500
CLICK placeholder="Re-enter password"
WAIT 500  # emulate keyboard slide up (web has no native keyboard; verify KeyboardAvoidingView layout on iOS real device or Xcode sim)
FULLPAGE_SCREENSHOT auth/S28-iphone-se-register-full.png
CLICK text="Privacy Policy"
WAIT 500
FULLPAGE_SCREENSHOT auth/S28-iphone-se-privacy-expanded.png
```

### S29: iPad landscape
```
RESIZE 1366 1024
NAVIGATE http://localhost:8086/
WAIT 3000
SCREENSHOT auth/S29-ipad-splash.png
CLICK text=Create Account
WAIT 500
FULLPAGE_SCREENSHOT auth/S29-ipad-register.png
```

### S30: Playwright bypass
```
# No source-level bypass hook on AuthScreen — QA must use real test account:
# email: qa-e2e@cairnapp.nz
# password: <redacted, stored in test config>
NAVIGATE http://localhost:8086/
CLICK text=Sign In
TYPE placeholder="your@email.com" qa-e2e@cairnapp.nz
TYPE placeholder="••••••••" <real-test-password>
CLICK text="Sign In"
WAIT 3000
SCREENSHOT auth/S30-post-signin.png
```

### S31: OTA idle
```
# force OtaBadge to idle state (no update)
NAVIGATE http://localhost:8086/
EVALUATE localStorage.clear()
WAIT 500
NAVIGATE http://localhost:8086/
WAIT 5000
SCREENSHOT auth/S31-splash-ota-idle.png
```

### S32: OTA states
```
# each state needs backend/env manipulation
# checking
NAVIGATE http://localhost:8086/
WAIT 500
SCREENSHOT auth/S32-ota-checking.png
# downloading (mock)
EVALUATE window.__mockOtaState && window.__mockOtaState('downloading')
WAIT 500
SCREENSHOT auth/S32-ota-downloading.png
# ready
EVALUATE window.__mockOtaState && window.__mockOtaState('ready')
WAIT 500
SCREENSHOT auth/S32-ota-ready.png
# error
EVALUATE window.__mockOtaState && window.__mockOtaState('error')
WAIT 500
SCREENSHOT auth/S32-ota-error.png
```

### S33: iOS Keychain autofill
```
# only reproducible on real iOS device with saved Cairn credentials in Keychain
# manual step — not scriptable on web Playwright
```

### S34: Password autocomplete strong-password (register)
```
# manual iOS device test — QuickType suggestion "Suggest Strong Password"
# not scriptable on web Playwright
```

### S35: Focus state clarity
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
CLICK placeholder="your@email.com"
SCREENSHOT auth/S35-email-focus.png
CLICK placeholder="••••••••"
SCREENSHOT auth/S35-password-focus.png
# tab navigation
EVALUATE document.activeElement.blur()
# click checkbox
CLICK text="Remember me on this device"
SCREENSHOT auth/S35-checkbox-focus.png
```

### S36: Privacy expanded
```
NAVIGATE http://localhost:8086/
CLICK text=Create Account
WAIT 500
CLICK text="Privacy Policy"
WAIT 500
SCREENSHOT auth/S36-privacy-expanded.png
FULLPAGE_SCREENSHOT auth/S36-privacy-full.png
```

### S37: CairnLogo alignment drift (login vs verify)
```
NAVIGATE http://localhost:8086/
CLICK text=Sign In
WAIT 500
SCREENSHOT auth/S37-login-title-row.png  # note logo baseline
# now enter verify (requires register flow — use S08 setup)
# then compare S08 verify title row vs S37 login title row side-by-side
```

### S38: Splash CTA hint text
```
NAVIGATE http://localhost:8086/
WAIT 3000
SCREENSHOT auth/S38-splash-cta-hint.png
```

---

## Consistency findings (与 SettingsScreen 及全局 tokens 对比)

1. **CTA button 高度不一致** (S03): primary btn minHeight=56, Apple/Google btn minHeight=52 — Sign In 视觉主 CTA 与 social CTA 在同一列 4px 台阶
2. **Google "G" logo brand violation** (S14): 自制蓝色单色 "G" 与 Google Brand Guidelines (multi-color G) 相冲,发布后有 IP 风险
3. **CairnLogo 对齐 hack** (S37): login/register 用 `marginTop: -7` 强推,verify 视图不用,视觉基线偏移 7px,直接可见
4. **Inline styles 违反 tokens 原则** (S38): splash CTA 提示文字全 hardcode,应该用 FontSize/Spacing/Colors tokens
5. **register vs login 校验规则不一** (S15): email regex 仅在 register 生效
6. **hint 与 error 共享 slot** (S07, S16): "Minimum 8 characters" 灰色提示和 "Minimum 8 characters" 红色错误使用同一 fieldError 组件,error 出现时 hint 消失,视觉抖动
7. **429 无专门 UX 转换** (S20): 只有 409 (email exists) 有 friendly message,其他 backend 错误全 raw pass-through
8. **verify path 无 network catch** (S23): 只有 handleAuth 有网络错误统一处理,handleVerify/handleResend 缺
9. **Apple Sign In 未实装** (S13): **App Store 上架 blocker** — HIG 4.8 强制要求
10. **Register 无 social login 选项** (S6): 用户想用 Google 注册无路径 (login 有 Continue with Google/Apple,register 没有)
11. **OtaBadge idleHidden prop 未传** (S31): splash 上 idle 状态会一直占位,应传 `idleHidden`
12. **Welcome screen "friend" 语气 off-brand** (S12): NZ 户外品牌不宜自来熟,应改 "kaimahi" (工人/伙伴) 或 "explorer" 等更贴品调
13. **Long name welcome 溢出** (S11): 56pt appName 无 numberOfLines/fontShrink
14. **iPad 无适配** (S29): 表单 full-width 拉伸,button 800px+ 宽
15. **eye toggle tap target 过小** (S5): padding Spacing.xs = 4px,总触区 < 44pt HIG 最低标准,且无 accessibilityLabel
16. **checkbox 无 focus 视觉** (S35): 键盘 tab 到 privacy/remember checkbox 无焦点环
17. **verify code 单行 input** (S8): 业界标准是 6 独立 code cell,当前实现降体验感
18. **privacy policy 220px maxHeight** (S36): 需要滚 6+ 次读完,过小

---

## Suggested fixes (按优先级,优先级 1=Blocker,3=nice-to-have)

### P1 — 上架 blocker / 商业风险
- **Apple Sign In 实装** — 阻断 App Store 审核 (HIG 4.8),必须在 iOS 上架前完成。使用 `expo-apple-authentication`
- **Google "G" logo 换官方多色 SVG** — Google Brand Guidelines 合规,避免商标风险
- **iPad 布局** — 表单 maxWidth: 480px 居中,不然 iPad app 会被 Apple reject "not designed for iPad"

### P2 — 明显破碎/一致性
- **CairnLogo 对齐**: 统一封装 `<TitleRow icon title />` 组件,不再逐屏 hack `marginTop`
- **CTA 按钮高度**: 全部 CTA 统一 `minHeight: 56` (primary/Apple/Google)
- **login 侧 email regex 补齐**: 与 register 一致,submit 前本地校验
- **verify handler 增加 network catch**: 抽 `handleAuth` 的 network catch block 为共用函数
- **429/friendly error map**: 建立 backend errorCode → UX friendly text 映射,不再 raw pass
- **hint vs error 分 slot**: 新增 `fieldHint` 样式独立于 `fieldError`
- **OtaBadge 传 idleHidden={true}** 到 splash
- **eye toggle**: padding 提到 12px,加 accessibilityLabel="Show password"/"Hide password"
- **6-digit code UI**: 改成 6 个独立 cell (业界标准),用 auto-advance 且支持粘贴

### P3 — 品牌/细节打磨
- **welcome "friend" 改词**: 用 "kaiwhakamahi" / "explorer" 或直接用 email prefix
- **welcome 名字 fontShrink**: `<Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.6}>`,长名字自动缩
- **splash CTA hint 换 tokens**: `fontSize: FontSize.small, marginTop: Spacing.md, lineHeight: 18`
- **checkbox 键盘 focus ring**: 加 `focused && { borderWidth: 3, borderColor: Colors.primary }`
- **privacy policy 全屏 modal**: 220px 太小,改成 bottom sheet 或全屏
- **register 补 social login**: "or continue with" 分割线 + Apple/Google 也放到 register 视图
- **splash 回归用户 skip 动画**: 检测 `hasCredentials()`,如果 remember-me 有值,动画时长压到 800ms

### P4 — 内部质量
- **AnimatedCairn setInterval 换 requestAnimationFrame**: 更省电,16ms 精度不保证
- **welcome nav 用 event 而非 setTimeout**: 用 Navigator listener 保证 unmount 时不 leak
- **verify view 不清 register 表单**: back 时应完全清 name/pw/confirm state,避免用户困惑
- **socialHint/dead code 清理**: 已注释 `O1 batch 39` 说明部分死码已删,但 line 452 `promptGoogleAsync` 假实现留在生产,应 flag 或封装成 `NotImplementedYet` component
- **测试账号 hook**: 加 `window.__cairnAuthBypass` (dev-only) 用于 web Playwright,方便 QA 快速进入 authed state (但生产 build 必删)

---

## 潜在坑 / 隐藏 bug 清单 (超出 UX 但可能触发用户问题)

1. **register 时 name+email 双 autoFocus 冲突** (S6): RN 未定义行为,iOS/Android 差异未测
2. **welcome screen setTimeout(1800) 未清理**: 如果用户在 1.8s 内 手动 nav 或 crash,timer 可能触发已 unmount 组件的 nav.replace
3. **AnimatedCairn setInterval 泄漏**: `waveTimerRef` unmount cleanup 依赖 useEffect return,若组件在 mid-anim 快速切换 (splash → login → splash),可能积累孤儿 timer
4. **remember-me 存明文密码到 SecureStore**: 虽然 SecureStore 加密,但存整密码而非 refresh token 是安全反模式;iOS Keychain 泄漏 = 完整凭据暴露
5. **verify email 变更**: 用户 register 后到 verify view,若发现邮箱输错,只能 Back 重来,name/pw 已丢失 (会清)但用户体感差
6. **backend rate limit 无 client 侧限流**: 用户 spam Sign In 会打爆 backend,无 client 侧 debounce (虽然 loading state 有 disabled)
7. **PressBtn scale animation 与 disabled 交互**: `disabled` 时 onPressIn 早退,但 activeOpacity=0.5 让按钮变透,状态双重表达可能视觉噪声
8. **googleFlowActive.current** (line 440): 用来避免 blur 触发 email/password 校验,但如果 Google promise 永不 resolve,ref 会永远为 true,导致 email 字段 blur 永不校验

---

## 结论

AuthScreen 整体架构稳,tokens 使用规范,动画品牌感强,error handling 覆盖网络/backend/校验多层。主要问题集中在:

- **发布 blocker**: Apple Sign In 未实装 (HIG 4.8), Google "G" logo 品牌违规, iPad 无适配
- **视觉一致性**: CairnLogo 对齐 hack、CTA 高度差、hint/error slot 复用
- **UX 半吊子**: verify 6-digit 单行 input、welcome "friend" 语气、welcome 1.8s 太短、register 无 social login
- **隐藏坑**: register 双 autoFocus, setTimeout unmount 泄漏, remember-me 明文, Google flow ref 状态泄漏

建议在下一次 Sprint 前用 P1 三项做 blocker fix,P2 六项列入 Sprint N,P3/P4 进 backlog。
