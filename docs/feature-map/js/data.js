/* ════════════════════════════════════════════════════════════
   data.js — Default seed data
   Initial values derived from docs/feature-map.html (legacy snapshot).
   App project scan results merged in via PROJECT_FACTS overlay.
   ──────────────────────────────────────────────────────────── */

const DEFAULT_DATA = {
  "version": 18,
  "overview": {
    "tagline": "Cairn",
    "subtitle": "在山里，留下你走过的痕迹",
    "description": "一个人走在新西兰的山里，你以为只有自己。\n\n但走着走着，会在某个雨夜发现一面陌生人留下的标记——\"前方有避雨亭\"。\n\n你不知道是谁留下的，也永远不会认识他。但那一刻你知道——有人来过，有人想着你。\n\n你也可以默默留下你的——给下一个走到这里的人。",
    "howItWorks": [
      {
        "icon": "🚶",
        "step": "01",
        "title": "走你的路",
        "desc": "打开 Cairn，GPS 自动记录轨迹。没有网也照用——全程离线，DOC 官方步道数据内置，不需要手机信号。"
      },
      {
        "icon": "🚩",
        "step": "02",
        "title": "停下，插一个标记",
        "desc": "在让你停脚的地方，举起手机，AR 视角里插下一个标记。位置锁定到 GPS + 地形，放置距离最远 30 米。可以是危险提示、水源、岔路口指引，也可以只是一句\"这里风景大到让我想哭\"。"
      },
      {
        "icon": "✨",
        "step": "03",
        "title": "下次再来，撞见自己",
        "desc": "重走旧路时，当时留下的标记还在那里等你——走到 30 米以内，可以查看当时录的那句话。你也可能撞见陌生人悄悄留下的。那种感觉，在路上才懂。"
      }
    ],
    "personas": [
      {
        "id": "p-passer",
        "emoji": "🥾",
        "name": "Jamie · 不爱说话的独行者",
        "role": "本地 tramper · 周末日行，长假 Great Walks",
        "accent": "--persona-a",
        "scenario": "工作日被会议追着跑。周末把车停在登山口，走进山里就只剩鸟叫和自己的脚步。走在 Mt Holdsworth 那种暴露的山脊上，长时间的空旷会压着人。",
        "painpoint": "一个人走太久会觉得空。但又不想为此加好友、回评论、刷动态——那只会让他更累。",
        "wants": "不需要认识谁，也不想被打扰。\n只是希望走在山里时，能感觉到——这条路上，曾有人来过。\n经过一个陌生人留下的标记，停一秒，继续走。就够了。"
      },
      {
        "id": "p-hutbagger",
        "emoji": "🏕️",
        "name": "Murray · 收集 hut book 签名的人",
        "role": "Hut bagger · 走遍南岛 backcountry hut 网络",
        "accent": "--persona-b",
        "scenario": "每年给自己定目标——再签下 20 本 hut book。从 Mid Caples 到 Welcome Flat，从无人问津的 bivvy 到 Great Walks 的山屋。这些路他走了太多遍，每一处水源、每一个岔路口，心里都有数。",
        "painpoint": "走过太多了，他想留点什么给后来的人。但不想被认识，也不要回报。",
        "wants": "那个让人走错的岔路口，他比任何人都清楚在哪里。\n在那里插一个标记，\"右边才是正道\"。\n下一批人不走那段冤枉路，就够了。\n——这种标记，不能乱插。他认真对待每一个。"
      },
      {
        "id": "p-runner",
        "emoji": "🏃",
        "name": "Alex · 与昨天的自己赛跑",
        "role": "Trail runner · 步行探路，跑步重走",
        "accent": "--persona-c",
        "scenario": "上周末他用整整一天走完 Tararua 一段新路线，在一棵孤树下录了一句话——当时风很大，他停下来说了什么，他自己都忘了。这周末他想用跑步的速度重走那段路。",
        "painpoint": "每次走新路，回来就是一个数字。他不想要一个跑步软件，他想要——一条真正属于自己的路，下次还能回来的那种。",
        "wants": "一键沿用上次的路线。经过那棵孤树，30 米内手机轻震一下，当时录的那句话自动响起。\n\n他不知道说了什么。但在风里听见自己上周末的声音——\n那一刻不是在赶路，是在相遇。"
      }
    ],
    "principles": [
      {
        "id": "pr-cairn",
        "icon": "🪨",
        "title": "每一个标记，都是前人留给你的",
        "desc": "Cairn——登山者堆在岔路口的石堆，是走过这里的人，留给下一个来的人的指引。\n\n我们把这件事做进了 Cairn 里。\n在一个让你停下脚步的位置，举起手机，AR 视角里插下一个标记。\n\n下一个走到这里的人，会在视野里突然看见它——\n那一刻知道，自己不是一个人。"
      },
      {
        "id": "pr-solo",
        "icon": "🌿",
        "title": "进山就是进山，不是进软件",
        "desc": "进山之前，把手机调成飞行模式的那种人——Cairn 是为他们做的。\n\n没有通知，没有红点，没有排行榜，没有\"谁在线\"。全程离线——Fiordland、Tararua、Nelson Lakes，没有信号的地方 Cairn 照样跑。DOC 图层、步道状态、GPS 轨迹，全部内置好了。\n\n打开 Cairn，你看见的是山，不是社交动态。\n撞见陌生人留下的那个标记，是惊喜，不是任务。"
      },
      {
        "id": "pr-private",
        "icon": "📒",
        "title": "你的山，先是你的",
        "desc": "每一公里、每一个标记，默认只是你自己的。\n\n有些路只想自己记得。有些标记只想留给某个特定的人。不是每一次发现都需要变成要分享的东西，不是每一段故事都需要观众。\n\n想分享给朋友，一键即可。想公开给陌生人，你来决定。\n你的山是你的山——不是 Cairn 的，不是平台的，不是任何人的。"
      }
    ]
  },
  "story": {
    "activities": [
      {
        "id": "act-map",
        "icon": "🗺",
        "name": "查看地图",
        "sub": "打开软件 · 看周围情况"
      },
      {
        "id": "act-move",
        "icon": "🥾",
        "name": "徒步 / 跑步",
        "sub": "出发 · 记录轨迹 · 安全回来"
      },
      {
        "id": "act-flag",
        "icon": "📍",
        "name": "留下标记",
        "sub": "发现值得记录的地方 · 告知后人"
      },
      {
        "id": "act-record",
        "icon": "📖",
        "name": "记录与路线",
        "sub": "看历史 · 把走过的路存下来"
      },
      {
        "id": "act-friend",
        "icon": "🤝",
        "name": "好友",
        "sub": "加好友 · 分享路线"
      },
      {
        "id": "act-sos",
        "icon": "🆘",
        "name": "安全保障",
        "sub": "SOS · 告知家人我在哪"
      },
      {
        "id": "act-settings",
        "icon": "⚙️",
        "name": "账号 · 设置",
        "sub": "登录 · 个人偏好"
      },
      {
        "id": "act-resilience",
        "icon": "🔋",
        "name": "离线 · 容错",
        "sub": "没信号 · GPS 弱 · 数据不丢"
      }
    ],
    "phases": [
      {
        "id": "ph-done",
        "label": "✅ 已完成",
        "sprint": "Sprint 42–54",
        "status": "done",
        "order": 0
      },
      {
        "id": "ph-wip1",
        "label": "🔄 进行中",
        "sprint": "Sprint 55–56 · 路线系统 + AR Unity 重建",
        "status": "wip",
        "order": 1
      },
      {
        "id": "ph-ready",
        "label": "⏳ 准备进行",
        "sprint": "",
        "status": "ready",
        "order": 2
      },
      {
        "id": "ph-planned",
        "label": "📅 计划中",
        "sprint": "Sprint 57+",
        "status": "planned",
        "order": 3
      }
    ],
    "cards": [
      {
        "id": "c-map-1",
        "activityId": "act-map",
        "phaseId": "ph-done",
        "status": "done",
        "title": "打开看到新西兰全境地图",
        "sub": "Mapbox · 新西兰全境 · 可缩放",
        "order": 0
      },
      {
        "id": "c-map-2",
        "activityId": "act-map",
        "phaseId": "ph-done",
        "status": "done",
        "title": "在地图上看到自己的标记",
        "sub": "本人标记叠加显示 · 可点击查看",
        "order": 1
      },
      {
        "id": "c-map-off",
        "activityId": "act-map",
        "phaseId": "ph-done",
        "status": "done",
        "title": "没信号时地图也能打开",
        "sub": "离线地图包 · 不依赖网络",
        "order": 2
      },
      {
        "id": "c-map-topo",
        "activityId": "act-map",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "看到 NZ 风格地形图",
        "sub": "Cairn Topo 样式 · cream 底色 · 等高线",
        "order": 0
      },
      {
        "id": "c-map-doc",
        "activityId": "act-map",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "看到 DOC 步道状态",
        "sub": "官方开放 / 关闭信息叠加在地图",
        "order": 1
      },
      {
        "id": "c-map-weather",
        "activityId": "act-map",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "出发前查步道天气",
        "sub": "接入天气 API · 和地图位置联动",
        "order": 2
      },
      {
        "id": "c-map-seed",
        "activityId": "act-map",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "第一次打开地图就有内容",
        "sub": "DOC hut · 危险点作为初始标记",
        "order": 3
      },
      {
        "id": "c-hike-1",
        "activityId": "act-move",
        "phaseId": "ph-done",
        "status": "done",
        "title": "走路时轨迹画在地图上",
        "sub": "GPS 实时定位 · Kalman 滤波平滑 · 速度异常丢点 · 4级精度门控",
        "order": 0
      },
      {
        "id": "c-hike-2",
        "activityId": "act-move",
        "phaseId": "ph-done",
        "status": "done",
        "title": "跑步时看配速和距离",
        "sub": "跑步模式 · 实时数据显示",
        "order": 1
      },
      {
        "id": "c-hike-3",
        "activityId": "act-move",
        "phaseId": "ph-done",
        "status": "done",
        "title": "太短的走动不计入记录",
        "sub": "too-short 过滤 · 不污染历史",
        "order": 2
      },
      {
        "id": "c-hike-nav",
        "activityId": "act-move",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "地图上叠加路线轨迹",
        "sub": "路线折线已显示在地图 · 跟随导航 / 偏离提醒未接入",
        "order": 0
      },
      {
        "id": "c-hike-offroute",
        "activityId": "act-move",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "偏离路线时听到提醒",
        "sub": "偏离检测算法 (offRoute.ts) 已有 · 语音播报 + UI 触发待接入",
        "order": 0
      },
      {
        "id": "c-hike-watch",
        "activityId": "act-move",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "不掏手机也能感知方向",
        "sub": "Apple Watch 震动提示",
        "order": 1
      },
      {
        "id": "c-flag-1",
        "activityId": "act-flag",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "在地图上留一个标记",
        "sub": "UI 现有 4 类：危险/风景/补给/路口 · v105 重构到 5 类（danger/junction/water/hut/cairn）进行中",
        "order": 0
      },
      {
        "id": "c-flag-ar",
        "activityId": "act-flag",
        "phaseId": "ph-done",
        "status": "done",
        "title": "用 AR 看到现实里的标记",
        "sub": "ViroReact + ARKit 世界跟踪 · GPS→ARKit 世界坐标 · 真北对齐",
        "order": 1
      },
      {
        "id": "c-flag-ar2",
        "activityId": "act-flag",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "AR 标记用 Unity 重做",
        "sub": "Phase 1 Spike 已验证（DS shader + 4柱场景通过 EAS CI） · UnityAROverlay + unityBridge 已有 · USE_UNITY_AR=false 待 EAS embed 稳定后开启",
        "order": 0
      },
      {
        "id": "c-flag-vote",
        "activityId": "act-flag",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "对别人的标记说有用 / 没用",
        "sub": "后端投票/举报接口已实现 · useCommunityStore 已有 · UI 待接入",
        "order": 1
      },
      {
        "id": "c-flag-voice",
        "activityId": "act-flag",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "录一段语音附在标记上",
        "sub": "5 秒语音留言 · 后人到达时播放",
        "order": 0
      },
      {
        "id": "c-flag-6th",
        "activityId": "act-flag",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "留一个 cairn 石堆给陌生人",
        "sub": "第6种标记类型 · sepia 棕色",
        "order": 1
      },
      {
        "id": "c-rec-1",
        "activityId": "act-record",
        "phaseId": "ph-done",
        "status": "done",
        "title": "结束后看距离时长爬升",
        "sub": "活动统计 · 轨迹地图回顾",
        "order": 0
      },
      {
        "id": "c-rec-2",
        "activityId": "act-record",
        "phaseId": "ph-done",
        "status": "done",
        "title": "查看所有历史活动",
        "sub": "路线/标记列表 · 地图回顾 · 类型/时间筛选未实现",
        "order": 1
      },
      {
        "id": "c-rec-route",
        "activityId": "act-record",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "把走过的路存成路线",
        "sub": "复制活动轨迹 · 样式还在打磨",
        "order": 0
      },
      {
        "id": "c-rec-snap",
        "activityId": "act-record",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "路线编辑时 snap-to-road",
        "sub": "RouteEditorScreen · snapToRoadAndTrim · OSM 路网贴合",
        "order": 1
      },
      {
        "id": "c-rec-edit",
        "activityId": "act-record",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "调整路线的节点",
        "sub": "地图上拖拽调整 · 编辑功能待完善",
        "order": 0
      },
      {
        "id": "c-rec-gpx",
        "activityId": "act-record",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "从其他软件导入路线",
        "sub": "GPX 格式 · 兼容主流户外平台",
        "order": 1
      },
      {
        "id": "c-fr-1",
        "activityId": "act-friend",
        "phaseId": "ph-done",
        "status": "done",
        "title": "添加好友",
        "sub": "用邮箱搜索 · 双方确认",
        "order": 0
      },
      {
        "id": "c-fr-list",
        "activityId": "act-friend",
        "phaseId": "ph-done",
        "status": "done",
        "title": "看好友列表",
        "sub": "好友名单 · 接受 / 拒绝申请",
        "order": 1
      },
      {
        "id": "c-fr-share",
        "activityId": "act-friend",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "把路线分享给好友",
        "sub": "路线分享流程待实现",
        "order": 0
      },
      {
        "id": "c-fr-realtime",
        "activityId": "act-friend",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "知道好友此刻在哪",
        "sub": "实时位置共享 · 双方同意后开启",
        "order": 1
      },
      {
        "id": "c-sos-1",
        "activityId": "act-sos",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "SOS 按钮长按触发（组件已做）",
        "sub": "SOSButton + sosService 完整实现 · 未挂载到任何页面",
        "order": 0
      },
      {
        "id": "c-sos-contact",
        "activityId": "act-sos",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "设置紧急联系人",
        "sub": "addEmergencyContact / getEmergencyContacts 已实现 · UI 待接入",
        "order": 1
      },
      {
        "id": "c-sos-send",
        "activityId": "act-sos",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "遇险时发出求救",
        "sub": "sendSOS · 短信预填 + GPS 坐标 + 离线队列 · UI 待接入",
        "order": 2
      },
      {
        "id": "c-sos-plan",
        "activityId": "act-sos",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "设置预计回程时间",
        "sub": "超时自动通知联系人",
        "order": 3
      },
      {
        "id": "c-set-auth",
        "activityId": "act-settings",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "注册 / 登录账号",
        "sub": "邮箱 + 验证码已完成 · Google OAuth OTA crash 暂时禁用（AuthScreen.tsx:462）",
        "order": 0
      },
      {
        "id": "c-set-mode",
        "activityId": "act-settings",
        "phaseId": "ph-wip1",
        "status": "wip",
        "title": "切换 Explorer / Navigator 模式",
        "sub": "uiMode 存储 + SettingsScreen 切换已完成 · 仅 HikingScreen 读取（bearing stat） · 其他页面未响应",
        "order": 1
      },
      {
        "id": "c-set-personal",
        "activityId": "act-settings",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "设置附近标记提醒距离",
        "sub": "个性化阈值 · 偏好管理",
        "order": 0
      },
      {
        "id": "c-res-offline",
        "activityId": "act-resilience",
        "phaseId": "ph-done",
        "status": "done",
        "title": "没信号时地图和 GPS 照常用",
        "sub": "离线地图包 · GPS 不依赖网络",
        "order": 0
      },
      {
        "id": "c-res-sync",
        "activityId": "act-resilience",
        "phaseId": "ph-done",
        "status": "done",
        "title": "操作失败后自动重试上传",
        "sub": "标记和活动进离线队列 · 有信号自动补发",
        "order": 1
      },
      {
        "id": "c-res-gps",
        "activityId": "act-resilience",
        "phaseId": "ph-done",
        "status": "done",
        "title": "GPS 点跳动时轨迹不乱",
        "sub": "滤波平滑 · 速度异常丢点 · 虚线表示无信号段",
        "order": 2
      },
      {
        "id": "c-res-bg",
        "activityId": "act-resilience",
        "phaseId": "ph-planned",
        "status": "planned",
        "title": "锁屏后轨迹记录不中断",
        "sub": "后台定位保活 · 语音播报照常",
        "order": 0
      }
    ]
  },
  "modules": [
    {
      "id": "mod-map",
      "icon": "🗺",
      "iconBg": "rgba(99,102,241,.15)",
      "title": "地图页",
      "meta": "底部 Tab 1 · 默认页",
      "progress": 70,
      "progressColor": "var(--done)",
      "order": 0,
      "features": [
        {
          "id": "f-mp-1",
          "title": "Mapbox 真实地图渲染",
          "status": "done"
        },
        {
          "id": "f-mp-2",
          "title": "离线分区地图包",
          "status": "done"
        },
        {
          "id": "f-mp-3",
          "title": "GPS 实时定位 (Kalman)",
          "status": "done"
        },
        {
          "id": "f-mp-4",
          "title": "地图图钉标注",
          "status": "done"
        },
        {
          "id": "f-mp-5",
          "title": "旗帜详情弹窗（编辑/删除）",
          "status": "done"
        },
        {
          "id": "f-mp-6",
          "title": "DOC 官方风险图层",
          "status": "planned"
        },
        {
          "id": "f-mp-7",
          "title": "Cairn Topo 地图样式",
          "status": "p4"
        },
        {
          "id": "f-mp-8",
          "title": "离线区域包下载 UI",
          "status": "p4"
        },
        {
          "id": "f-mp-9",
          "title": "SOS FAB 前置",
          "status": "p4"
        },
        {
          "id": "f-mp-10",
          "title": "社区旗帜聚合",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-hiking",
      "icon": "🏃",
      "iconBg": "rgba(34,197,94,.15)",
      "title": "徒步页 / 跑步页",
      "meta": "徒步模式 · 跑步模式 · Tab 2/3",
      "progress": 55,
      "progressColor": "var(--wip)",
      "order": 1,
      "features": [
        {
          "id": "f-hk-1",
          "title": "轨迹路线绘制层",
          "status": "done"
        },
        {
          "id": "f-hk-2",
          "title": "路线偏离检测",
          "status": "planned"
        },
        {
          "id": "f-hk-3",
          "title": "语音播报服务",
          "status": "planned"
        },
        {
          "id": "f-hk-4",
          "title": "途经点到达播报",
          "status": "planned"
        },
        {
          "id": "f-hk-5",
          "title": "GPS状态栏 精度/卫星",
          "status": "done"
        },
        {
          "id": "f-hk-6",
          "title": "动态GPS采样频率",
          "status": "done"
        },
        {
          "id": "f-hk-7",
          "title": "Tell Someone 软提示",
          "status": "p4"
        },
        {
          "id": "f-hk-8",
          "title": "Apple Watch 简版",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-marker",
      "icon": "🚩",
      "iconBg": "rgba(239,68,68,.15)",
      "title": "植旗系统",
      "meta": "FAB 入口 · 5 类型 · 投票/举报后端已实现 · UI 待接入",
      "progress": 75,
      "progressColor": "var(--wip)",
      "order": 2,
      "features": [
        {
          "id": "f-mk-1",
          "title": "标记类型重构（v105 · UI 待更新）",
          "status": "wip"
        },
        {
          "id": "f-mk-2",
          "title": "投票接口（UI 待接入）",
          "status": "wip"
        },
        {
          "id": "f-mk-3",
          "title": "举报接口（UI 待接入）",
          "status": "wip"
        },
        {
          "id": "f-mk-4",
          "title": "标记数据后端同步",
          "status": "done"
        },
        {
          "id": "f-mk-5",
          "title": "Cairn 石堆第6种类型",
          "status": "planned"
        },
        {
          "id": "f-mk-6",
          "title": "图钉多层视觉升级",
          "status": "planned"
        },
        {
          "id": "f-mk-7",
          "title": "语音 memo 5秒",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-ar",
      "icon": "🥽",
      "iconBg": "rgba(167,139,250,.15)",
      "title": "AR页",
      "meta": "地图内切换 · Phase 1 Spike 通过（DS shader CI 验证） · Sprint 55 修罗盘 + ARWorldMap",
      "progress": 70,
      "progressColor": "var(--wip)",
      "order": 3,
      "features": [
        {
          "id": "f-ar-1",
          "title": "坐标系转换",
          "status": "wip"
        },
        {
          "id": "f-ar-2",
          "title": "朝向计算（watchHeadingAsync 已接入）",
          "status": "done"
        },
        {
          "id": "f-ar-3",
          "title": "3D 旗帜配置 (4种外观)",
          "status": "wip"
        },
        {
          "id": "f-ar-4",
          "title": "拖拽精确放置",
          "status": "planned"
        },
        {
          "id": "f-ar-5",
          "title": "光线不足优雅降级",
          "status": "planned"
        },
        {
          "id": "f-ar-6",
          "title": "首次使用教学动画",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-friends",
      "icon": "🤝",
      "iconBg": "rgba(244,114,182,.15)",
      "title": "好友页",
      "meta": "好友系统 · Sprint 55 修 AddFriend 键盘",
      "progress": 80,
      "progressColor": "var(--done)",
      "order": 4,
      "features": [
        {
          "id": "f-fr-1",
          "title": "邮箱添加 + 双向确认",
          "status": "done"
        },
        {
          "id": "f-fr-2",
          "title": "好友状态存储（请求/接受/静音）",
          "status": "done"
        },
        {
          "id": "f-fr-3",
          "title": "后端接口认证同步",
          "status": "done"
        },
        {
          "id": "f-fr-4",
          "title": "屏蔽 / 删除好友",
          "status": "done"
        },
        {
          "id": "f-fr-5",
          "title": "\"在线状态\"异步改造",
          "status": "p4"
        },
        {
          "id": "f-fr-6",
          "title": "好友旗帜共享设置",
          "status": "planned"
        },
        {
          "id": "f-fr-7",
          "title": "好友路线分享",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-sos",
      "icon": "🆘",
      "iconBg": "rgba(239,68,68,.15)",
      "title": "安全功能",
      "meta": "SOS 服务已实现 · SOSButton 未挂载 · Tell Someone 进行中",
      "progress": 45,
      "progressColor": "var(--wip)",
      "order": 5,
      "features": [
        {
          "id": "f-so-1",
          "title": "SOS服务 GPS+短信兜底",
          "status": "wip"
        },
        {
          "id": "f-so-2",
          "title": "SOS长按3秒+倒计时（组件已做）",
          "status": "wip"
        },
        {
          "id": "f-so-3",
          "title": "紧急联系人 API",
          "status": "wip"
        },
        {
          "id": "f-so-4",
          "title": "Tell Someone 软提示",
          "status": "p4"
        },
        {
          "id": "f-so-5",
          "title": "SOS FAB MapScreen 前置",
          "status": "p4"
        },
        {
          "id": "f-so-6",
          "title": "行程分享超时通知",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-nz",
      "icon": "🇳🇿",
      "iconBg": "rgba(249,115,22,.15)",
      "title": "NZ 本土化（PRD3）",
      "meta": "字体/Te Reo/术语已交付 · Topo50 待 Sprint 56",
      "progress": 75,
      "progressColor": "var(--p4)",
      "order": 6,
      "features": [
        {
          "id": "f-nz-1",
          "title": "字体 Inter 全屏迁移 (E-012)",
          "status": "p4"
        },
        {
          "id": "f-nz-2",
          "title": "DOC橙 #F26522 + 5级阶梯 (E-016)",
          "status": "p4"
        },
        {
          "id": "f-nz-3",
          "title": "Cairn Topo 地图样式 (E-013)",
          "status": "p4"
        },
        {
          "id": "f-nz-4",
          "title": "Te Reo 第一波 10+ strings (E-014)",
          "status": "p4"
        },
        {
          "id": "f-nz-5",
          "title": "NZ术语 track/hut (E-018)",
          "status": "p4"
        },
        {
          "id": "f-nz-6",
          "title": "标记多层视觉升级",
          "status": "planned"
        },
        {
          "id": "f-nz-7",
          "title": "空状态 SVG 插画 × 3 (E-019)",
          "status": "planned"
        }
      ]
    },
    {
      "id": "mod-settings",
      "icon": "⚙️",
      "iconBg": "rgba(100,116,139,.15)",
      "title": "设置页",
      "meta": "OfflineMapSheet 已建 · Sprint 55 重组中",
      "progress": 75,
      "progressColor": "var(--done)",
      "order": 7,
      "features": [
        {
          "id": "f-st-1",
          "title": "账号登录（邮箱已完成 · Google/Apple 暂时禁用）",
          "status": "wip"
        },
        {
          "id": "f-st-2",
          "title": "GPS / 通知权限",
          "status": "done"
        },
        {
          "id": "f-st-3",
          "title": "徒步/跑步模式切换",
          "status": "done"
        },
        {
          "id": "f-st-4",
          "title": "播报密度开关（消费方未实现）",
          "status": "wip"
        },
        {
          "id": "f-st-5",
          "title": "隐私设置 toggle",
          "status": "done"
        },
        {
          "id": "f-st-6",
          "title": "离线地图下载 UI",
          "status": "p4"
        },
        {
          "id": "f-st-7",
          "title": "隐私文案简明化",
          "status": "p4"
        }
      ]
    }
  ],
  "timeline": [
    {
      "id": "tl-p1",
      "name": "✅ Phase 1–2.5",
      "color": "var(--done)",
      "sprint": "Sprint 42–54 · 完成",
      "progress": 85,
      "faded": false,
      "order": 0,
      "items": [
        {
          "id": "t-1-1",
          "dotColor": "var(--done)",
          "text": "Mapbox 真实离线地图 (NZ)",
          "sub": "zoom 10-17 / 区域包架构"
        },
        {
          "id": "t-1-2",
          "dotColor": "var(--done)",
          "text": "GPS卡尔曼滤波",
          "sub": "动态采样 / 误差<10m"
        },
        {
          "id": "t-1-3",
          "dotColor": "var(--done)",
          "text": "植旗系统 (5种 + 三级权限)",
          "sub": "后端同步 useMarkerStore"
        },
        {
          "id": "t-1-4",
          "dotColor": "var(--wip)",
          "text": "语音播报 + 路线偏离检测",
          "sub": "服务层已实现 · voiceService/offRoute 未挂载到任何页面"
        },
        {
          "id": "t-1-5",
          "dotColor": "var(--wip)",
          "text": "SOS (SMS fallback)",
          "sub": "SOSButton + sosService 完整实现 · 未挂载到任何页面"
        },
        {
          "id": "t-1-6",
          "dotColor": "var(--done)",
          "text": "好友系统",
          "sub": "邮箱双向确认 / 接口同步"
        },
        {
          "id": "t-1-7",
          "dotColor": "var(--wip)",
          "text": "天气 + DOC步道实时状态",
          "sub": "weatherService 已实现 · DOC图层未接入 · 均未挂载"
        },
        {
          "id": "t-1-8",
          "dotColor": "var(--wip)",
          "text": "登录认证（邮箱/谷歌/苹果）",
          "sub": "邮箱完成 · Google OTA crash 禁用 · Apple alert 占位（AuthScreen.tsx:1052）"
        }
      ]
    },
    {
      "id": "tl-p3",
      "name": "🔄 Phase 3",
      "color": "var(--wip)",
      "sprint": "Sprint 51–54 · 已完成 + Sprint 55 修 bug",
      "progress": 75,
      "faded": false,
      "order": 1,
      "items": [
        {
          "id": "t-3-1",
          "dotColor": "var(--done)",
          "text": "AR页架构（坐标转换 + 朝向）",
          "sub": "Sprint 53 · 已完成"
        },
        {
          "id": "t-3-2",
          "dotColor": "var(--done)",
          "text": "社区数据存储",
          "sub": "Sprint 54 · 聚合/投票/举报/bad-words"
        },
        {
          "id": "t-3-3",
          "dotColor": "var(--done)",
          "text": "AR 罗盘 watchHeading",
          "sub": "Sprint 55 · STORY-00204 · watchHeadingAsync 已接入 ARScreen"
        },
        {
          "id": "t-3-4",
          "dotColor": "var(--done)",
          "text": "ARKit 跨 session 原点持久化",
          "sub": "useMarkerStore AR_ORIGIN_KEY v118 · 已完成 · 消除 5-15m 跨 session 漂移"
        },
        {
          "id": "t-3-5",
          "dotColor": "var(--plan)",
          "text": "AR 拖拽放置",
          "sub": "光线降级 / 首次教学动画 · Sprint 59"
        },
        {
          "id": "t-3-6",
          "dotColor": "var(--plan)",
          "text": "社区旗帜展示开放",
          "sub": "用户量 >1000 + 法务确认后"
        }
      ]
    },
    {
      "id": "tl-s55",
      "name": "🔧 Sprint 55 Hotfix",
      "color": "var(--wip)",
      "sprint": "Sprint 55 · 23-bug 修复批 (2026-05-20 起)",
      "progress": 50,
      "faded": false,
      "order": 2,
      "items": [
        {
          "id": "t-55-1",
          "dotColor": "var(--wip)",
          "text": "STORY-00200 Auth + AsyncStorage",
          "sub": "清理 auto-bypass / 登录 crash"
        },
        {
          "id": "t-55-2",
          "dotColor": "var(--wip)",
          "text": "STORY-00201 SignOut + Run Complete",
          "sub": "闪退 + 无 Back 按钮"
        },
        {
          "id": "t-55-3",
          "dotColor": "var(--wip)",
          "text": "STORY-00202 GPS 时间戳去重",
          "sub": "AppState 切换 pipeline"
        },
        {
          "id": "t-55-4",
          "dotColor": "var(--wip)",
          "text": "STORY-00203 Hike phase 同步",
          "sub": "重入 + chip 布局"
        },
        {
          "id": "t-55-5",
          "dotColor": "var(--wip)",
          "text": "STORY-00204 AR 罗盘",
          "sub": "watchHeadingAsync"
        },
        {
          "id": "t-55-6",
          "dotColor": "var(--wip)",
          "text": "STORY-00205 Routes + AddFriend",
          "sub": "map 展示 / 键盘遮挡"
        },
        {
          "id": "t-55-7",
          "dotColor": "var(--wip)",
          "text": "STORY-00206 UI/UX 微调",
          "sub": "夜间模式 / z-index / Share / Back blur"
        },
        {
          "id": "t-55-8",
          "dotColor": "var(--wip)",
          "text": "STORY-00207 Telemetry",
          "sub": "自动上传 + extended metrics"
        },
        {
          "id": "t-55-9",
          "dotColor": "var(--wip)",
          "text": "STORY-00208 Settings 重组",
          "sub": "Account 优先 / SignOut 红色"
        },
        {
          "id": "t-55-10",
          "dotColor": "var(--wip)",
          "text": "STORY-00209 App icon NZ 设计",
          "sub": "NZ 绿 + 3 石堆"
        }
      ]
    },
    {
      "id": "tl-p4",
      "name": "🎯 第4阶段 · NZ化",
      "color": "var(--p4)",
      "sprint": "Sprint 56–58 · NZ 本土化重磅",
      "progress": 60,
      "faded": false,
      "order": 3,
      "items": [
        {
          "id": "t-4-12",
          "dotColor": "var(--done)",
          "text": "E-012 Inter 字体",
          "sub": "✅ 已交付 · @expo-google-fonts/inter"
        },
        {
          "id": "t-4-16",
          "dotColor": "var(--done)",
          "text": "E-016 DOC橙 + 5级阶梯",
          "sub": "✅ 已交付 · severity Green→Black"
        },
        {
          "id": "t-4-14",
          "dotColor": "var(--done)",
          "text": "E-014 Te Reo 第一波",
          "sub": "✅ 已交付 · 11 Great Walks + 8 地名"
        },
        {
          "id": "t-4-18",
          "dotColor": "var(--done)",
          "text": "E-018 NZ 术语审计",
          "sub": "✅ 已交付 · trail→track 全替换"
        },
        {
          "id": "t-4-13a",
          "dotColor": "var(--p4)",
          "text": "E-013 Cairn Topo 地图样式",
          "sub": "Sprint 56 · cream底+sepia等高线"
        },
        {
          "id": "t-4-13b",
          "dotColor": "var(--p4)",
          "text": "E-013 离线包激活",
          "sub": "Sprint 56 · OfflineMapSheet 连接 Mapbox"
        },
        {
          "id": "t-4-13c",
          "dotColor": "var(--p4)",
          "text": "E-013 Topo50 等高线图层",
          "sub": "Sprint 56 · TerrainV2 ShapeSource"
        },
        {
          "id": "t-4-17",
          "dotColor": "var(--p4)",
          "text": "E-017 Tell Someone + SOS 前置",
          "sub": "Sprint 57 · MSC 安全活动联动"
        }
      ]
    },
    {
      "id": "tl-p5",
      "name": "📅 Phase 5",
      "color": "var(--plan)",
      "sprint": "Sprint 59–60 · 计划中",
      "progress": 0,
      "faded": false,
      "order": 4,
      "items": [
        {
          "id": "t-5-1",
          "dotColor": "var(--plan)",
          "text": "E-015 Marker 多层视觉升级",
          "sub": "发光环+底座+弹簧动画 · Sprint 59"
        },
        {
          "id": "t-5-2",
          "dotColor": "var(--plan)",
          "text": "E-015 Cairn 石堆第6类型",
          "sub": "sepia棕 / 陌生人留言"
        },
        {
          "id": "t-5-3",
          "dotColor": "var(--plan)",
          "text": "E-019 空状态 SVG 插画 × 3",
          "sub": "空路线/空标记/空好友 · Sprint 60"
        },
        {
          "id": "t-5-4",
          "dotColor": "var(--plan)",
          "text": "E-019 路线/标记照片字段",
          "sub": "数据结构就位，UI v1.1"
        }
      ]
    },
    {
      "id": "tl-p6",
      "name": "🔮 Phase 6 · v1.0后",
      "color": "var(--sub)",
      "sprint": "Sprint 61+ · 待评估",
      "progress": 0,
      "faded": true,
      "order": 5,
      "items": [
        {
          "id": "t-6-1",
          "dotColor": "var(--sub2)",
          "text": "Klim高端字体（Söhne / Founders Grotesk）",
          "sub": ""
        },
        {
          "id": "t-6-2",
          "dotColor": "var(--sub2)",
          "text": "sepia棕主色 A/B 测试",
          "sub": ""
        },
        {
          "id": "t-6-3",
          "dotColor": "var(--sub2)",
          "text": "全 UI Te Reo 双语",
          "sub": ""
        },
        {
          "id": "t-6-4",
          "dotColor": "var(--sub2)",
          "text": "Apple Watch 简版",
          "sub": ""
        },
        {
          "id": "t-6-5",
          "dotColor": "var(--sub2)",
          "text": "澳大利亚 / 日本市场扩展",
          "sub": ""
        },
        {
          "id": "t-6-6",
          "dotColor": "var(--sub2)",
          "text": "多语言（英/中/日）",
          "sub": ""
        }
      ]
    }
  ]
};

window.DEFAULT_DATA = DEFAULT_DATA;
