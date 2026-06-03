# Cairn — Session Hand-off (v81 在飞，AR 视觉验收中)

**写于**: 2026-05-28
**目的**: 上一个 session 电脑要重启了，下一个 session 读完这一篇能立刻接手。

---

## 0. 角色定位 + 项目根基

- **项目根**: `C:\ClaudeCodeProjects\Cairn\` (是 Git 仓库 `C:\ClaudeCodeProjects\` 的子目录，仓内路径前缀都是 `Cairn/`)
- **项目类型**: React Native + Expo SDK 54 (managed workflow + EAS Build)，前端 + Express/MySQL 后端
- **核心功能**: NZ 户外徒步 app — Mapbox 地图 + GPS 路径记录 + AR 插旗（Viro/ARKit）+ 飘移修复
- **真实用户**: 1 个 (FrankMeng 本人)。你做的所有 OTA 都直接进生产
- **Build 额度**: 极少 (剩 ~2 次)，所以**绝对优先纯 OTA 改动**
- **Workflow**: 不走 CLAUDE.md 的 Sprint 流程 (autonomous Mode 2 还是 manual Mode 1 都不正式跑)，就是**实用主义 fix-and-ship**

---

## 1. 当前状态 — 你接手时正在做什么

### 飞行中的 OTA
**v81 已推到 EAS production iOS** (Update group `cb9f663e-c9b9-4553-90c9-509761a8481f`, commit `42eb24c`)。

用户测试中。**他刚汇报 v80 视觉粗糙**，我用 v81 修了 3 个具体点：
1. **透明球壳消失** → 加回 0.32 半径 shell sphere (cullMode 'Front' + opacity 0.18 + Add blend)
2. **icon 光感生硬** → Constant→Lambert + fresnelExponent:2.0 + 内 core opacity 0.65→0.85
3. **粒子像珠子** → ring 半径 0.32-0.50→0.22-0.36 + 每个粒子加 Y-bob 动画 (3 个 phase 不同步)

外加**3 层 ViroQuad halo billboard** (size 0.55/1.10/1.70, color inner/mid/outer) — 之前是单层。

**等用户反馈**。可能继续迭代 v82+ 直到他满意。

### 还没 push 到 GitHub
v81 commit `42eb24c` **本地有，GitHub 没**——Push 时网络抽风 ("Failed to connect to github.com"，多次重试都失败)。

下一个 session 接手做的第一件事:
```bash
cd C:/ClaudeCodeProjects && git push origin master 2>&1 | tail -3
```
如果通，就继续；如果还抽风，重试或等会儿。**不阻塞用户测 v81**——OTA 不依赖 GitHub。

---

## 2. 从哪里开始 — 具体接手指令

### Step A: 确认环境
```bash
cd C:/ClaudeCodeProjects && git log --oneline -5
```
应该看到:
```
42eb24c fix(v81): AR visual rework — ...    ← 还没 push 的就是这个
09f73b4 fix(v80): round-2 review ...
7466acb feat(v80): bug bash + AR visual ...
8425e21 fix(v79): tighten gap detection ...
```

### Step B: 如果 GitHub 通了，push v81
```bash
cd C:/ClaudeCodeProjects && git push origin master
```

### Step C: 看用户最新反馈
他可能说几种话:
- **"v81 还是不对 / 球还是看不见 / Fresnel 没效果"** → 看下面"调参指南"
- **"v81 OK 了 / 接下来做 X"** → 看 BACKLOG.md `C:\ClaudeCodeProjects\Cairn\docs\BACKLOG.md`
- **"build1 启动！"** → 全部需要 native build 的项已确认其实大多 OTA 可做，只 AR cross-session 飘移 (#50/58 ARWorldMap) 真要 native fork Viro。但用户判断后说**不做** (因为后端数据证明 markers lat/lng 不会累积偏移，飘移是当前 GPS 噪声 ±10m，不会跑到 1km 外)。
- **"现在先看 backlog"** → 见下方 §6

---

## 3. 已完成的工作 (v77 → v81 全链)

### v77 (2026-05-26 早，已下线超过 2 天)
- GPS 4-gate pipeline (teleport reject + accuracy filter + stationary suppression via Doppler `coords.speed` + Kalman)
- `route_points_raw` audit track
- Douglas-Peucker simplification
- migration 008 `route_points_raw JSON`

### v78 (晚)
- Gap detection (>30s → dashed) + "Signal lost" pill
- AR loading overlay
- Dynamic sampling 60s→10s
- AppState debounce 2s
- Offline queue + idempotency middleware (`backend/src/middleware/idempotency.js`)
- migration 009 `idempotency_keys` table
- Flush interval 60s→120s

### v79
- Gap detection threshold tightened: dt>30s → dt>120s **AND** dist>200m
- 真实数据验证: session 31 (8 false dashes → 0), session 38 (3 → 1, 保留地铁 13 分钟真 gap)

### v80 (今天 2026-05-27 完成 + reviewed 3x)
- **AR origin staleness fix** — `arkitOriginRef` 每次 mount/unmount reset (修飘移 5-10m bug)
- **Audio ducking** — `Audio.setAudioModeAsync({ interruptionModeIOS: InterruptionModeIOS.DuckOthers })` (注意: 是 enum DuckOthers=2, 不是 numeric 1; round-1 我犯过这个错)
- **Voice memo** — 5s 录音, expo-av Audio.Recording, expo-file-system/legacy 持久化, marker detail UI 加 Mic/Play 按钮
- **AR halo + 3 层 + 球壳** — ViroQuad billboard + radial gradient PNG `assets/ar/halo_radial.png` (10KB)
- **Session 39 数据修复** — 326 → 92 pts (清重复时间倒退) + appendPoints 加事务 + dedupe by t+lat+lng
- **migration 010** — markers voice_memo_url + voice_memo_duration_ms
- **死代码清理** — DragCairnPicker (-298 行) + getDistanceScale + AR_SNAP_RANGE_M
- **Mic icon** 加进 lucide-react-native imports

### v81 (刚发, **测试中**)
见上 §1。

---

## 4. 关键文件 + 设计意图

### Frontend 关键
| 文件 | 作用 | 关键点 |
|---|---|---|
| `app/src/components/ViroAROverlay.tsx` | AR cairn 渲染主体 | 7-layer 渲染: spinning icon + inner core + transparent shell + 3 halo billboards + outer wisp + particle ring + optional beam + note text. v81 的视觉调参全在这。`arkitOriginRef` 是飘移 bug 关键。`ICON_GEOM` 内嵌 4 type 的 vertex/index 数据 (matches reference HTML 数学定义)。 |
| `app/src/screens/HikingScreen.tsx` | Hike + Activity 主屏 + MarkerDetailSheet | gap 检测+ Signal lost pill 在 HikingMap; voice memo UI 在 MarkerDetailSheet (recordingHandleRef 是关键 — 不是 state, ref mirror 解决 closure capture); polyline 拆分按 dt+dist 双阈值. |
| `app/src/screens/MapHistoryScreen.tsx` | 历史 hike 详情 | 同样的 gap 拆分逻辑, smoothedTrackPoints (4-gate + Kalman + DP) |
| `app/src/store/useTrackingStore.ts` | GPS 状态机 + 4 gates + 后台 task drain | 第 405 行附近: dynamic sampling 10s; 第 423 行: incremental flush 120s; 第 312 行: AppState 2s debounce; addTrackPoint 是 4 gates 入口. |
| `app/src/services/voiceMemoService.ts` | Voice memo 录音/播放/持久化 | `expo-file-system/legacy` (注意是 /legacy 子路径!), `InterruptionModeIOS.DuckOthers` enum, isBusy() 互斥锁防止 recording↔playback session thrash |
| `app/src/services/offlineQueue.ts` | AsyncStorage FIFO 队列 + 4xx/5xx 处理 | UUID idempotency 后端去重, drain on foreground/online |
| `app/src/components/OtaBadge.tsx` | OTA 版本号显示 | `OTA_VERSION = 81` 当前. **每次 OTA 都要 bump 这个值**, 用户靠这个数字判断 OTA 是否生效. |
| `app/App.tsx` | App 启动 hook, 初始化 networkMonitor + offlineQueue + audio ducking | 行 192: `Audio.setAudioModeAsync` with InterruptionModeIOS.DuckOthers |

### Backend 关键
| 文件 | 作用 |
|---|---|
| `backend/src/models/Session.js` | `appendPoints` 已加事务 + SELECT FOR UPDATE + dedupe (t+lat+lng) |
| `backend/src/middleware/idempotency.js` | client_op_id UUID 去重缓存 (7d TTL) |
| `backend/src/migrations/{008,009,010}_*.sql` | 008=raw_points; 009=idempotency_keys; 010=marker voice memo cols |

### Reference (UI/UX)
| 文件 | 作用 |
|---|---|
| `cairn_icons_3d.html` | **AR 视觉的 reference**，Three.js + ShaderMaterial Fresnel + 3-layer halo sprite. 地址: `file:///C:/ClaudeCodeProjects/Cairn/cairn_icons_3d.html`. 用户期望 AR 效果 ≥ 这个 (但 Viro 没 ShaderMaterial 等). v81 是按这份 reference 重写 ViroAROverlay 的视觉. |
| `docs/qa/sprint41-evidence/v80-ref-zhongta-danger.png` | 我之前用 Playwright 在 reference HTML 截的"中塔灰岩 danger 经典粒子"图. AR 视觉的金标准. |
| `docs/qa/sprint41-evidence/icons3d-v7-*.png` | 早期 reference 截图, 历史保留 |

### 文档
| 文件 | 作用 |
|---|---|
| `docs/BACKLOG.md` | 已清理过 (v80 后)，按 OTA / Build 分类，58 个原 issue 中 7 个真需 build, 其余 OTA |
| `C:\ClaudeCodeProjects\CLAUDE.md` | 全局 workflow (factory pattern), 但**当前项目没正式跑这个 process**——实用主义为主 |
| `C:\Users\I585134\.claude\projects\C--ClaudeCodeProjects\memory\MEMORY.md` | auto-memory 索引, 含 Cairn-specific 笔记 |

---

## 5. 部署机制 + 网络坑

### OTA push 步骤 (每次 ship)
```bash
cd C:/ClaudeCodeProjects/Cairn/app
EAS_SKIP_AUTO_FINGERPRINT=1 eas update --branch production --message "..." --platform ios --non-interactive 2>&1 | tail -15
```
**重要**: `EAS_SKIP_AUTO_FINGERPRINT=1` 因为不加这个 fingerprint 计算阶段会卡住 (v81 时第一次 push 就卡死, kill 后加这个 flag 立刻通了).

### 后端部署 (改了 backend 才需要)
SSH 到 `122.51.174.118` (root key 已配置)：
```bash
ssh root@122.51.174.118 "cd /opt/githubRepos/Cairn/Cairn/docker && docker compose build --no-cache backend && docker compose up -d backend && sleep 5 && curl -s https://api.yiiling.cn/health"
```
**注意**: docker-compose.yml 在 `/opt/githubRepos/Cairn/Cairn/docker/`, 不是 git root. 我之前在错目录跑过失败了一次.

### DB 操作 (无 mysql CLI, 用 Node inline)
```bash
node -e "const mysql=require('C:/ClaudeCodeProjects/Cairn/backend/node_modules/mysql2');const conn=mysql.createConnection({host:'122.51.174.118',port:3306,user:'root',password:'Mzm920313@950824',database:'cairn'});conn.query('SELECT ...',(err,rows)=>{console.log(rows);conn.end();});"
```
凭证全在 `C:\Users\I585134\.claude\projects\C--ClaudeCodeProjects\memory\cairn_database_access.md`.

### GitHub push 经常抽风
- 表现: `Failed to connect to github.com port 443` 或 `Recv failure: Connection was aborted`
- 解法: 重试 2-5 次, 通常会通. 不通的话**不阻塞 OTA** (EAS 不依赖 GitHub).
- 服务器上 git pull 也可能踩 `.git/objects/` 权限问题, 用 `git reset --hard origin/master && git clean -fd && git pull` 一行清.

### Bash wrapper 的尾部噪音 (重要！)
**所有** Bash tool 输出会带这一行尾部:
```
/usr/bin/bash: line N: /c/Users/I585134/AppData/Local/Temp/claude-XXXX-cwd: No such file or directory
```
导致 `exit code 1` 但**实际命令成功**. 看 stdout 内容判断, 不要被 exit 1 / "failed" 通知吓到. EAS push / git push / curl 全都中过这个套路.

---

## 6. 待办 (从 docs/BACKLOG.md, 已清理)

### 当前活跃, 全 OTA 可做
- Phase 1: #2 离线 tile 下载, #5 模拟定位测试框架
- Phase 2: 路线绘制/Waypoint/SOS/旗帜修改/路线分享 (13 项, #9 audio ducking 已做)
- Phase 2.5: 好友系统 + DOC + Open-Meteo
- Phase 3 OTA: #30 AR flag 修改, #51/52 死代码 (已做), #53 AR 距离精控, #54 AR 远距降级, #55 类型语义, #57 长 note
- 非功能: 暗模式, i18n, GDPR, 无障碍

### 真需要 native build (用户已说不做)
- #50/58 ARWorldMap 持久化 — fork Viro Swift 源码 ~200 行. 用户实测后判断**不做**: DB 证据显示 marker lat/lng 不变, 飘移是当前 GPS 噪声 ±10m, 不累积. 飘移是单 session 内的视觉问题, v80 `arkitOriginRef` reset 就够了.
- #49 SceneKit 重写 AR — 5-8 天. 仅在 #48 视觉验收不通过时启动 — **可能就是当前 v81 之后的剧情**.

### 用户曾说 "除 Apple Watch 全做"
但 research 后发现 4/5 项其实 OTA 即可 (audio ducking, voice memo, halo PNG, particle), 只 ARWorldMap 真 build, 然后用户说 ARWorldMap 不做.
**所以理论上 build 不需要进**. 除非视觉迭代到 v83/v84 仍不达标, 然后他想试 SceneKit 重写 (#49) 就会消耗最后 1-2 次 build 额度.

---

## 7. AR 视觉调参指南 (用户继续不满意时)

### 当前 v81 视觉栈 (从内到外)
```
ViroNode (rise-in animation)
├── ViroNode (icon spin) > ViroGeometry (type-specific shape, Lambert+Fresnel)
├── ViroSphere radius=0.08 (inner core, Constant Add, opacity 0.85)
├── ViroSphere radius=0.32 (transparent globe shell, cullMode Front, opacity 0.18, Add)
├── ViroQuad 0.55x0.55 (haloInner, billboard, opacity 0.40, inner color)
├── ViroQuad 1.10x1.10 (haloMid, billboard, opacity 0.50, mid color)
├── ViroQuad 1.70x1.70 (haloOuter, billboard, opacity 0.30, outer color)
├── ViroSphere radius=0.55 (outer wisp, cullMode Front, opacity 0.08)
└── ViroNode (particleRing animation) > 50 particles each in ViroNode (Y-bob)
```

### 用户可能说:
- **"halo 太弱看不到光"** → 调高 ViroQuad opacity (0.40/0.50/0.30 → 0.60/0.70/0.45) 或调低 bloomThreshold (0.65/0.75/0.85 → 0.55/0.65/0.75)
- **"halo 太亮挡住 type 形状"** → 反之
- **"球壳还是看不到"** → shell opacity 0.18 → 0.25, 或材质 cullMode 'None' (双面渲染)
- **"icon 没发光"** → fresnelExponent 2.0 → 1.5 (更锐利的边缘高光), 或 bloomThreshold 0.40 → 0.30
- **"粒子还是僵硬"** → particleBobA/B/C duration 调更短 (1100/1300/950 → 800/1000/700) 或幅度 +=0.12 → +=0.20

调完: bump OTA_VERSION + commit + EAS update + 等用户验收. 大致 5 分钟一轮.

### Reference HTML 代码地图 (`cairn_icons_3d.html`)
- 第 91-213 行: 4 个 type 的几何函数 (buildDangerGeom 等). Viro 端在 `ViroAROverlay.tsx:91-213` 复刻了同样的几何.
- 第 254-289 行: makeIconMaterial — Three.js ShaderMaterial Fresnel uniforms. **Viro 没 ShaderMaterial**, 我们用 Lambert + fresnelExponent 近似.
- 第 478-519 行: buildIconOrb — 完整的 5-layer composition 参考. 这是 v81 视觉栈的源头.
- 第 521-731 行: 5 种粒子方案 (A 经典 / B 双螺旋 / C 银河 / D 上升火花 / E 量子). 当前 Viro 端只实现 A 类似的 ring (但 sin bob 用 Animation 近似). 如果用户想要 D 上升火花, 是 Viro 内能做的 (用 ViroParticleEmitter).

### Viro 能力边界
- **能做**: ViroGeometry (任意 mesh), ViroSphere/Box/Quad, Lambert+fresnelExponent, blendMode Add/Alpha, cullMode Front/Back/None, transformBehaviors billboard, animation rotateY/positionY/scale/opacity, 30+ 粒子 ViroSphere, ViroParticleEmitter (没在 v81 用, 可以试).
- **不能做**: ShaderMaterial (自定义 fragment shader), MeshPhysicalMaterial transmission/IOR (PBR 透明玻璃材质——之前 reviewer 说能但实测 Viro Metal renderer 对 transmission 支持不全), real-time per-vertex animation, Three.js 那种 "for each frame, update positions" loop.
- **替代方案**: Fresnel 用 fresnelExponent. 透明玻璃用 cullMode Front shell + Add blend (近似). 帧动画用 multiple registered animation variants 错相位.

---

## 8. 用户性格 + 沟通规则

- **中文**, 简洁直接, 不喜欢长篇大论, 但喜欢精确数据 + 根因分析
- 决策快, 不墨迹, "做不做" 一句话; 但**会要求 root cause 分析** + **会要求多 agent review**
- 信息密度高: "你能ssh" = "如果能 ssh 你就并行做后端 + OTA" — 一句话能展开很多
- 不懂前端框架细节, 但凭直觉知道效果对不对; "这个粗糙" "这个生硬" 是有效信号
- **不要给他时间预估**: 没意义. CLAUDE.md 也明确禁止.
- **不要 emoji** 除非他先用
- **不要解释技术堆栈** 除非他问
- 他会主动召开 multi-agent review (说 "subagent 检查一下") — 这是高价值, 严格按他要求开 2-3 个并行
- 他在乎 build 额度. 任何"需 build"必须严格 sanity-check (是否真要, 还是其实 OTA 可做)

---

## 9. memory file 提醒

下个 session 一开始, auto-memory 系统会读 `MEMORY.md`. 已存在的 Cairn 笔记:
- `feedback_cairn_ota.md` — Claude 直接 push OTA, iOS-only by default, 不让用户跑脚本
- `cairn_backend_switching.md` — 切换 local/remote 后端
- `cairn_database_access.md` — DB root 凭证

**新 session 接手 v81 验收循环时不需要新增 memory** — 这是单次 fix 迭代, 不是长期模式.

---

## 10. 接手第一句话该说什么

读完这文档, 第一件事:

```bash
cd C:/ClaudeCodeProjects && git log --oneline -3 && git push origin master 2>&1 | tail -3
```

然后看用户最新消息. 大概率他会说:
- "v81 OK 了 / 还是不对" → 进 v82 调参循环 (§7)
- 或 "做下一个 X" → 看 BACKLOG (§6)

**禁止**: 重新读 CLAUDE.md / 重新跑 Sprint 0 / 重新做 review (那 3 个 review 已经做完了, 结论在 §3 v80 区段). 实用主义 fix-and-ship.
