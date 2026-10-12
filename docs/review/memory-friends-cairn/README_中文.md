# Memory / Friends / Cairn 实现检查点

本检查点延续 O75 的实际候选，没有重启项目或覆盖 Owner 工作。源码基线是
`24587efb19b272ff440280fc859c240f5e03f5de`，B2 审核闭环检查点是
`a5967b50bc7336304380f1b8ff6ae9c349639fa3`。

## 已实现

- Memory 继续使用同一真实位置生命周期；Mine、Friends Union、城市选择和
  三主题保持地图优先，不写回或伪造个人 Fog。
- 分享按好友、按方向显式授权；每条贡献由服务端强制至少 30 分钟延迟，
  私密地点整体遮罩；切换账号会同步清掉授权和精确私密地点缓存。
- Cairn 保存不可变内容修订与取得历史；Left/Found、Archive、Remove、Read、
  Thanks、Report/Appeal 和 revision/source 两种审核范围有独立持久状态。
- 在线发现要求两条新鲜可信位置证据。Activity 证据还必须与服务器已确认的
  active route prefix 或 Finish 后 canonical geometry 的时间、坐标和 segment
  一致；缺少 JS 日志不被当成原生 GPS 根因。
- 当前好友符合资格的 Friend-only/Public Cairn 100% 取得，可突破普通 3 条
  容量；其余容量在 Updated/New Public 间公平抽取。没有全局发现 cooldown。
- 访问、取得、20 秒展示合并、180 秒 haptic 资格、announced/read 是不同状态。
- `(viewer, cairn, content revision)` 由服务端唯一约束保证跨受众快照幂等；
  同一逻辑修订的审核状态作用于 Friend/Public/历史读取。
- 旧 `/friend-content/encounters/verify` 已明确返回 410，页面载入不再创建取得权；
  Public 发现同时校验 viewer pilot allowlist。
- 作者只看到匿名聚合 Thanks 数，不含身份、时间、坐标或路线；自己不能
  Thanks 自己的 Cairn。

## 保持不变

- GPS 接受/拒绝、静止漂移抑制、WAL、Activity canonical truth、距离/时间、
  物理 segment、Local/Selected Final、Snap 阈值与 Mapbox 请求预算。
- 原 Home 背景、美术资产、主要框架和 Day/Sunset/Night UI DNA。
- Account deletion policy、全局 Fog 几何、Hike/Run 页面与 Routes 尚未在本批改。
- 没有 deploy、production migration、push、merge、native build、OTA 或 TestFlight。

## 结论边界

Memory/Cairn 的非设备生产路径已在一次性 MySQL 通过；100 个 Friend Cairn 的
单次事务本轮约 6.00–7.18 秒，是明确性能风险。Friends-only 内容修改另有独立的
毫秒级 `content_changed_at` 前沿，避免与同秒 visit 进入顺序混淆。Native Mapbox、iOS 后台 GPS、电量、
haptic 和真机可达性仍是 Owner/build gate。本包截图是 `WEB_FIXTURE`，地图无
Web token 且未合成，不能当作原生 Mapbox 证明。

首先阅读：`CONTINUATION_STATE.md`、`TEST_RESULTS.md`、
`REQUIREMENT_EVIDENCE.json` 与 `REVIEW_FINDINGS.md`。
